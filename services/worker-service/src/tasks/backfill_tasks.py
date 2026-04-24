"""LIBERTASIAN Worker Service — Backfill engine Celery tasks.

Three tasks implementing the backfill pipeline:
1. enumerate_backfill_candidates — discover candidate URLs for a batch
2. run_backfill_batch_tick — periodic tick advancing running batches
3. check_backfill_budgets — periodic budget check halting over-budget batches

Per CLAUDE.md:
- Celery tasks: idempotent (acks_late + reject_on_worker_lost)
- Rate limiting: 2-second delay between requests to same source domain
- NestJS is the single gateway — backfill creates IngestionJob rows that
  the existing poll_pending_ingestion_jobs task picks up
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

import redis
from celery import shared_task

from ..clients import backfill_db_client as backfill_db
from ..clients import ingestion_db_client as ingestion_db
from ..config import settings
from ..fetchers.base import CloudflareBlockedError
from ..fetchers.registry import get_fetcher

logger = logging.getLogger(__name__)

MONTH_CODES = [
    "jan", "feb", "mar", "apr", "may", "jun",
    "jul", "aug", "sep", "oct", "nov", "dec",
]

# Capitalised month codes used by the SC E-Library URL scheme.
MONTH_CODES_TITLE = [c.title() for c in MONTH_CODES]

MAX_INFLIGHT_JOBS_PER_BATCH = 5


# ─── Monthly URL builders ────────────────────────────────────────────────


def _build_lawphil_monthly_urls(
    year_start: int,
    year_end: int,
    month_start: int | None = None,
    month_end: int | None = None,
) -> list[dict[str, Any]]:
    """Generate LawPhil monthly page URLs for the batch's year/month range."""
    urls: list[dict[str, Any]] = []
    for year in range(year_start, year_end + 1):
        start_month = month_start if (month_start and year == year_start) else 1
        end_month = month_end if (month_end and year == year_end) else 12
        for month_idx in range(start_month, end_month + 1):
            code = MONTH_CODES[month_idx - 1]
            url = (
                f"https://lawphil.net/judjuris/juri{year}"
                f"/{code}{year}/{code}{year}.html"
            )
            urls.append({"year": year, "month": month_idx, "url": url})
    return urls


def _build_scel_monthly_urls(
    year_start: int,
    year_end: int,
    month_start: int | None = None,
    month_end: int | None = None,
) -> list[dict[str, Any]]:
    """Generate Supreme Court E-Library monthly docmonth URLs.

    Pattern: ``/thebookshelf/docmonth/{Mon}/{YYYY}/1`` where ``Mon`` is the
    title-cased three-letter month code (e.g. ``Jan``, ``Feb``). The trailing
    ``/1`` is the category ID for Decisions & Signed Resolutions.
    """
    urls: list[dict[str, Any]] = []
    for year in range(year_start, year_end + 1):
        start_month = month_start if (month_start and year == year_start) else 1
        end_month = month_end if (month_end and year == year_end) else 12
        for month_idx in range(start_month, end_month + 1):
            code = MONTH_CODES_TITLE[month_idx - 1]
            url = (
                "https://elibrary.judiciary.gov.ph"
                f"/thebookshelf/docmonth/{code}/{year}/1"
            )
            urls.append({"year": year, "month": month_idx, "url": url})
    return urls


# Maps a SourceEndpoint.parser_type to the monthly-URL builder for that
# source. Keep in sync with FETCHER_REGISTRY in fetchers/registry.py — if a
# parser_type is absent here, batches for that source will fail fast instead
# of silently enumerating the wrong site.
MONTHLY_URL_BUILDERS: dict[
    str,
    Callable[[int, int, int | None, int | None], list[dict[str, Any]]],
] = {
    "lawphil": _build_lawphil_monthly_urls,
    "supreme_court_elibrary": _build_scel_monthly_urls,
}


def _min_supported_year_for(parser_type: str) -> int | None:
    """Return the fetcher's minimum-supported year floor, or None.

    Reads the ``MIN_SUPPORTED_YEAR`` class attribute off the fetcher registered
    for ``parser_type``. Used by enumerate to reject year_start values below
    the floor with a clear admin message instead of silently producing zero
    candidates.
    """
    fetcher = get_fetcher(parser_type)
    if fetcher is None:
        return None
    return getattr(fetcher.__class__, "MIN_SUPPORTED_YEAR", None)


def _get_redis_client() -> redis.Redis:
    """Create a Redis client from worker settings."""
    return redis.Redis.from_url(settings.redis_url, decode_responses=True)


# ─── Task 1: Enumerate Backfill Candidates ───────────────────────────────


@shared_task(
    bind=True,
    name="backfill.enumerate_candidates",
    acks_late=True,
    reject_on_worker_lost=True,
    max_retries=3,
    retry_backoff=True,
)
def enumerate_backfill_candidates(self, batch_id: str) -> dict[str, Any]:
    """Walk the source's index pages and count candidates for a backfill batch.

    This task runs once when a batch transitions from pending -> enumerating.
    It does NOT fetch document content — just discovers URLs.

    For LawPhil:
    1. Build monthly page URLs for every (year, month) in the batch's range
    2. Call fetcher.discover() on each monthly page
    3. Collect all CandidateDoc URLs
    4. Write candidates_discovered count to the batch
    5. Store the full URL list in checkpoint_state
    6. Transition batch to 'running'
    """
    logger.info("Starting enumeration for batch %s", batch_id)

    batch = backfill_db.get_batch(batch_id)
    if not batch:
        logger.error("Batch %s not found", batch_id)
        return {"batch_id": batch_id, "status": "error", "reason": "batch_not_found"}

    if batch["status"] != "enumerating":
        logger.warning(
            "Batch %s status is '%s', expected 'enumerating'. Skipping.",
            batch_id,
            batch["status"],
        )
        return {
            "batch_id": batch_id,
            "status": "skipped",
            "reason": f"unexpected_status:{batch['status']}",
        }

    # Get the source to determine parser_type
    source = ingestion_db.get_source_with_endpoints(str(batch["source_id"]))
    if not source:
        backfill_db.transition_batch(
            batch_id, "failed",
            admin_notes="Source not found during enumeration",
        )
        return {"batch_id": batch_id, "status": "failed", "reason": "source_not_found"}

    # Determine parser_type from source endpoints
    endpoints = source.get("endpoints", [])
    parser_type = None
    if endpoints:
        parser_type = endpoints[0].get("parser_type")

    if not parser_type:
        backfill_db.transition_batch(
            batch_id, "failed",
            admin_notes="No parser_type found on source endpoints",
        )
        return {"batch_id": batch_id, "status": "failed", "reason": "no_parser_type"}

    fetcher = get_fetcher(parser_type)
    if not fetcher:
        backfill_db.transition_batch(
            batch_id, "failed",
            admin_notes=f"No fetcher registered for parser_type={parser_type}",
        )
        return {"batch_id": batch_id, "status": "failed", "reason": "no_fetcher"}

    # Each source has its own monthly listing URL scheme. Fail fast rather
    # than silently enumerating the wrong site if the parser_type isn't
    # wired up yet.
    url_builder = MONTHLY_URL_BUILDERS.get(parser_type)
    if url_builder is None:
        backfill_db.transition_batch(
            batch_id, "failed",
            admin_notes=(
                f"No monthly URL builder for parser_type={parser_type}. "
                "Register one in backfill_tasks.MONTHLY_URL_BUILDERS."
            ),
        )
        return {
            "batch_id": batch_id,
            "status": "failed",
            "reason": "no_url_builder",
        }

    # Enforce the fetcher's minimum supported year. SCEL cannot serve pages
    # for pre-JSP years; running a 1920 SCEL batch would silently yield 0.
    min_year = _min_supported_year_for(parser_type)
    if min_year is not None and batch["year_start"] < min_year:
        backfill_db.transition_batch(
            batch_id, "failed",
            admin_notes=(
                f"{parser_type} historical {batch['year_start']} not supported "
                f"(min supported year: {min_year})"
            ),
        )
        return {
            "batch_id": batch_id,
            "status": "failed",
            "reason": "year_below_min_supported",
        }

    try:
        # Build monthly page URLs for the batch range
        monthly_urls = url_builder(
            batch["year_start"],
            batch["year_end"],
            batch.get("month_start"),
            batch.get("month_end"),
        )

        # Discover candidates from each monthly page. We record a per-month
        # status in the checkpoint so admins reviewing a completed batch can
        # tell "genuinely empty" apart from "URL 404'd" apart from "source
        # errored." ``skip_empty_months`` is implicit: an empty or 404 month
        # contributes nothing to ``candidate_urls`` and is counted under
        # ``candidates_skipped``, leaving the batch's cursor to advance
        # cleanly to the next month.
        all_candidates: list[dict[str, Any]] = []
        month_statuses: list[dict[str, Any]] = []
        skipped_months = 0

        for monthly in monthly_urls:
            status = "ok"
            reason: str | None = None
            count = 0
            try:
                candidates = fetcher.discover(monthly["url"])
                count = len(candidates)
                if count == 0:
                    status = "empty"
                    skipped_months += 1
                for candidate in candidates:
                    all_candidates.append({
                        "url": candidate.url,
                        "title": candidate.title,
                        "gr_no": candidate.gr_no,
                        "year": monthly["year"],
                        "month": monthly["month"],
                        "index": len(all_candidates),
                    })
            except CloudflareBlockedError as exc:
                status = "cloudflare_blocked"
                reason = exc.cf_type
                skipped_months += 1
                logger.warning(
                    "Cloudflare blocked %s during enumeration: %s",
                    monthly["url"],
                    exc,
                )
                # Continue with other months — source is rate-limiting us,
                # not a correctness problem with this batch.
            except Exception as exc:
                status = "error"
                reason = str(exc)[:200]
                skipped_months += 1
                logger.warning(
                    "Failed to discover candidates from %s: %s",
                    monthly["url"],
                    exc,
                )
                # Continue with other months — don't fail the whole batch.

            month_statuses.append({
                "year": monthly["year"],
                "month": monthly["month"],
                "url": monthly["url"],
                "status": status,
                "reason": reason,
                "candidates": count,
            })

        # Store checkpoint with all candidate URLs + per-month diagnostics.
        checkpoint_state = {
            "candidate_urls": all_candidates,
            "current_index": 0,
            "total_candidates": len(all_candidates),
            "month_statuses": month_statuses,
            "skipped_months": skipped_months,
        }

        backfill_db.update_checkpoint(batch_id, checkpoint_state, len(all_candidates))
        backfill_db.update_batch_counters(
            batch_id,
            candidates_discovered=len(all_candidates),
            candidates_skipped=skipped_months,
        )

        # Transition to running
        backfill_db.transition_batch(
            batch_id, "running",
            started_at=datetime.now(UTC),
        )

        logger.info(
            "Enumeration complete for batch %s: %d candidates discovered, "
            "%d months skipped (empty / 404 / error)",
            batch_id,
            len(all_candidates),
            skipped_months,
        )
        return {
            "batch_id": batch_id,
            "status": "running",
            "candidates_discovered": len(all_candidates),
            "monthly_pages_scanned": len(monthly_urls),
            "skipped_months": skipped_months,
        }

    except Exception as exc:
        logger.exception("Enumeration failed for batch %s", batch_id)
        backfill_db.transition_batch(
            batch_id, "failed",
            admin_notes=f"Enumeration error: {str(exc)[:500]}",
        )
        if self.request.retries < self.max_retries:
            raise self.retry(exc=exc) from exc
        return {"batch_id": batch_id, "status": "failed", "reason": str(exc)[:200]}


# ─── Task 2: Periodic Tick ───────────────────────────────────────────────


def _tick_single_batch(batch: dict[str, Any]) -> dict[str, Any]:
    """Process one tick for a single batch."""
    batch_id = str(batch["id"])
    checkpoint = batch.get("checkpoint_state") or {}
    candidate_urls = checkpoint.get("candidate_urls", [])
    current_index = checkpoint.get("current_index", 0)
    total = checkpoint.get("total_candidates", len(candidate_urls))

    # Check if we've processed all candidates
    if current_index >= total:
        backfill_db.transition_batch(
            batch_id, "completed",
            finished_at=datetime.now(UTC),
        )
        return {"batch_id": batch_id, "status": "completed"}

    # Check batch budget
    remaining = backfill_db.get_batch_budget_remaining(batch_id)
    if remaining <= Decimal("0"):
        backfill_db.transition_batch(
            batch_id, "halted_budget",
            admin_notes=f"Budget ceiling reached. Consumed: {batch.get('budget_consumed_usd')}",
        )
        return {"batch_id": batch_id, "status": "halted_budget"}

    # Check in-flight jobs (max per batch)
    inflight = backfill_db.get_inflight_jobs_count(batch_id)
    slots_available = max(0, MAX_INFLIGHT_JOBS_PER_BATCH - inflight)
    if slots_available == 0:
        return {
            "batch_id": batch_id,
            "status": "waiting_inflight",
            "inflight": inflight,
        }

    # Create child ingestion jobs for the next N candidates
    jobs_created = 0
    new_index = current_index
    for i in range(slots_available):
        idx = current_index + i
        if idx >= total:
            break
        # Create an IngestionJob that the existing pipeline will pick up
        backfill_db.create_backfill_ingestion_job(
            source_id=str(batch["source_id"]),
            source_endpoint_id=(
                str(batch["source_endpoint_id"])
                if batch.get("source_endpoint_id")
                else None
            ),
            backfill_batch_id=batch_id,
            triggered_by_user_id=str(batch["created_by_user_id"]),
        )
        jobs_created += 1
        new_index = idx + 1

    # Update checkpoint
    checkpoint["current_index"] = new_index
    backfill_db.update_checkpoint(batch_id, checkpoint, new_index)
    backfill_db.update_batch_counters(
        batch_id, last_tick_at=datetime.now(UTC),
    )

    return {
        "batch_id": batch_id,
        "status": "ticked",
        "jobs_created": jobs_created,
        "progress": f"{new_index}/{total}",
    }


@shared_task(
    bind=True,
    name="backfill.tick",
    acks_late=True,
    reject_on_worker_lost=True,
    max_retries=0,  # Don't retry ticks — next beat interval will try again
)
def run_backfill_batch_tick(self) -> dict[str, Any]:
    """Periodic tick task — advances all running backfill batches.

    Runs every 30 seconds via Celery Beat.

    For each batch in status='running':
    1. Check batch budget (budget_ceiling_usd - budget_consumed_usd)
    2. Check max in-flight jobs (default 5)
    3. Read cursor from checkpoint_state
    4. Create N child IngestionJob rows for the next N candidates
    5. Advance cursor
    6. Persist checkpoint
    7. If cursor reached the end, transition to 'completed'
    """
    running_batches = backfill_db.get_batches_by_status("running")
    if not running_batches:
        return {"status": "idle", "batches_processed": 0}

    results = []
    for batch in running_batches:
        try:
            result = _tick_single_batch(batch)
            results.append(result)
        except Exception as exc:
            logger.exception("Tick failed for batch %s", batch["id"])
            results.append({
                "batch_id": str(batch["id"]),
                "status": "error",
                "reason": str(exc)[:200],
            })

    return {
        "status": "ok",
        "batches_processed": len(results),
        "results": results,
    }


# ─── Task 3: Budget Check ───────────────────────────────────────────────


@shared_task(
    bind=True,
    name="backfill.check_budgets",
    acks_late=True,
    reject_on_worker_lost=True,
    max_retries=0,
)
def check_backfill_budgets(self) -> dict[str, Any]:
    """Check global budget and pause running batches if exceeded.

    Runs every 5 minutes via Celery Beat. Checks:
    1. Global monthly budget from Redis
    2. Per-batch budget from Postgres
    Transitions batches to halted_budget if either is exceeded.
    """
    running_batches = backfill_db.get_batches_by_status("running")
    if not running_batches:
        return {"status": "idle", "batches_checked": 0}

    # Check global monthly budget from Redis
    global_budget_exceeded = False
    try:
        r = _get_redis_client()
        global_budget_raw = r.get("llm:config:monthly_budget_usd")
        now = datetime.now(UTC)
        usage_key = f"llm:usage:{now.strftime('%Y-%m')}.estimated_cost_usd"
        current_spend_raw = r.get(usage_key)

        if global_budget_raw and current_spend_raw:
            global_budget = Decimal(str(global_budget_raw))
            current_spend = Decimal(str(current_spend_raw))
            if current_spend >= global_budget:
                global_budget_exceeded = True
                logger.warning(
                    "Global monthly budget exceeded: %s / %s",
                    current_spend,
                    global_budget,
                )
    except Exception as exc:
        logger.warning("Failed to check global budget from Redis: %s", exc)

    halted_count = 0
    checked_count = 0

    for batch in running_batches:
        batch_id = str(batch["id"])
        checked_count += 1

        # Halt if global budget exceeded
        if global_budget_exceeded:
            backfill_db.transition_batch(
                batch_id, "halted_budget",
                admin_notes="Global monthly LLM budget exceeded",
            )
            halted_count += 1
            continue

        # Check per-batch budget
        remaining = backfill_db.get_batch_budget_remaining(batch_id)
        if remaining <= Decimal("0"):
            backfill_db.transition_batch(
                batch_id, "halted_budget",
                admin_notes=f"Batch budget ceiling reached. Consumed: {batch.get('budget_consumed_usd')}",
            )
            halted_count += 1

    return {
        "status": "ok",
        "batches_checked": checked_count,
        "batches_halted": halted_count,
        "global_budget_exceeded": global_budget_exceeded,
    }
