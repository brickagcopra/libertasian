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
from collections import Counter
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
from ..normalizers.text_normalizer import compute_similarity_key

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

        # If every monthly page errored and we discovered nothing, the run is
        # a failure, not a legitimate zero-result enumeration. Fail the batch
        # instead of letting it transition to running -> completed with 0
        # documents (prod incident 2026-04-24: LawPhil IP-blocked the VPS,
        # all 12 months returned "No route to host", batch silently completed
        # as if the year had no decisions). An all-empty year stays on the
        # happy path.
        errored_months = [
            m for m in month_statuses
            if m["status"] in ("error", "cloudflare_blocked")
        ]
        if not all_candidates and errored_months:
            reason_counts: Counter[str] = Counter()
            for m in errored_months:
                label = (
                    "CloudflareBlockedError"
                    if m["status"] == "cloudflare_blocked"
                    else (m.get("reason") or "unknown")[:80]
                )
                reason_counts[label] += 1
            reasons_text = ", ".join(
                f"{k}={v}" for k, v in reason_counts.most_common()
            )
            admin_notes = (
                f"Enumeration yielded 0 candidates across {len(monthly_urls)} "
                f"monthly pages. {len(errored_months)}/{len(monthly_urls)} "
                f"months errored. Top reasons: {reasons_text}."
            )[:500]
            logger.warning(
                "Enumeration failed for batch %s — all %d months errored "
                "with no candidates discovered",
                batch_id,
                len(errored_months),
            )
            backfill_db.transition_batch(
                batch_id, "failed",
                admin_notes=admin_notes,
            )
            return {
                "batch_id": batch_id,
                "status": "failed",
                "reason": "all_months_errored",
                "errored_months": len(errored_months),
                "candidates_discovered": 0,
            }

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


# ─── Rescue helper ────────────────────────────────────────────────────────


def _try_dispatch_enumerate(batch_id: str, lock_ttl_sec: int = 1800) -> bool:
    """SETNX-based lock to prevent double-dispatch of enumerate for a batch.

    Returns True if dispatch was fired, False if a prior dispatch is
    (presumably) still in flight.
    """
    r = _get_redis_client()
    key = f"backfill:enum_lock:{batch_id}"
    acquired = r.set(key, "1", nx=True, ex=lock_ttl_sec)
    if not acquired:
        return False
    enumerate_backfill_candidates.delay(batch_id)
    return True


# ─── Task 2: Periodic Tick ───────────────────────────────────────────────


def _inflight_key(batch_id: str) -> str:
    """Redis key for the per-batch in-flight dispatch counter."""
    return f"backfill:inflight:{batch_id}"


def _get_inflight_count(batch_id: str) -> int:
    """Read the per-batch Redis in-flight counter (0 if unset)."""
    raw = _get_redis_client().get(_inflight_key(batch_id))
    if raw is None:
        return 0
    try:
        return max(0, int(str(raw)))
    except (TypeError, ValueError):
        return 0


def _tick_single_batch(batch: dict[str, Any]) -> dict[str, Any]:
    """Process one tick for a single batch.

    Pulls the next N URLs from ``checkpoint_state.candidate_urls``, creates
    an ``ingestion_candidate`` row per URL (deduped by similarity_key), and
    dispatches ``process_ingestion_candidate`` — the same path daily-crawl
    uses. The old pattern of creating generic ``ingestion_jobs`` re-ran the
    source's default discovery endpoint and never processed the enumerated
    URLs (prod incident 2026-04-24).
    """
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
        # Terminal transition: drop the inflight key so a re-creation of a
        # batch with the same id doesn't inherit stale counts.
        _get_redis_client().delete(_inflight_key(batch_id))
        return {"batch_id": batch_id, "status": "completed"}

    # Check batch budget
    remaining = backfill_db.get_batch_budget_remaining(batch_id)
    if remaining <= Decimal("0"):
        backfill_db.transition_batch(
            batch_id, "halted_budget",
            admin_notes=f"Budget ceiling reached. Consumed: {batch.get('budget_consumed_usd')}",
        )
        _get_redis_client().delete(_inflight_key(batch_id))
        return {"batch_id": batch_id, "status": "halted_budget"}

    # Redis-backed in-flight cap. Decrement happens in
    # process_ingestion_candidate's completion hook when
    # candidate_metadata["trigger"] == "backfill".
    inflight = _get_inflight_count(batch_id)
    slots_available = max(0, MAX_INFLIGHT_JOBS_PER_BATCH - inflight)
    if slots_available == 0:
        return {
            "batch_id": batch_id,
            "status": "waiting_inflight",
            "inflight": inflight,
        }

    # Resolve parser_type once per tick (one DB roundtrip).
    source_id_str = str(batch["source_id"])
    source = ingestion_db.get_source_with_endpoints(source_id_str)
    endpoints = source.get("endpoints", []) if source else []
    parser_type = endpoints[0].get("parser_type") if endpoints else None
    if not parser_type:
        logger.error(
            "Cannot tick batch %s — no parser_type on source %s",
            batch_id, source_id_str,
        )
        return {
            "batch_id": batch_id,
            "status": "error",
            "reason": "no_parser_type",
        }

    # Avoid circular import: process_ingestion_candidate lives in
    # ingestion_tasks which imports daily_crawl_tasks which imports this
    # module transitively via the Celery app registry.
    from .ingestion_tasks import process_ingestion_candidate

    candidates_dispatched = 0
    candidates_skipped = 0
    new_index = current_index
    for i in range(slots_available):
        idx = current_index + i
        if idx >= total:
            break
        entry = candidate_urls[idx]
        entry_url = entry.get("url")
        if not entry_url:
            # Malformed checkpoint entry — advance past it rather than
            # wedge the batch.
            logger.warning(
                "Batch %s checkpoint entry at index %d has no url; skipping",
                batch_id, idx,
            )
            candidates_skipped += 1
            new_index = idx + 1
            continue

        year = entry.get("year")
        month = entry.get("month")
        decision_date = (
            f"{year}-{int(month):02d}-01"
            if year is not None and month is not None
            else None
        )

        sim_key = compute_similarity_key(
            title=entry.get("title"),
            citation=entry.get("gr_no"),
            date=decision_date,
        )
        existing = ingestion_db.find_candidate_by_similarity_key(
            source_id=source_id_str,
            similarity_key=sim_key,
        )
        if existing:
            candidates_skipped += 1
            new_index = idx + 1
            continue

        candidate_id = ingestion_db.create_ingestion_candidate(
            source_id=source_id_str,
            detected_url=entry_url,
            detected_title=entry.get("title"),
            detected_document_type=None,
            similarity_key=sim_key,
        )

        process_ingestion_candidate.delay(
            candidate_id=candidate_id,
            source_id=source_id_str,
            url=entry_url,
            parser_type=parser_type,
            candidate_metadata={
                "title": entry.get("title"),
                "gr_no": entry.get("gr_no"),
                "document_type": "decision",
                "decision_date": decision_date,
                "trigger": "backfill",
                "backfill_batch_id": batch_id,
            },
        )
        candidates_dispatched += 1
        new_index = idx + 1

    # Update checkpoint + counters.
    checkpoint["current_index"] = new_index
    backfill_db.update_checkpoint(batch_id, checkpoint, new_index)
    counter_updates: dict[str, Any] = {"last_tick_at": datetime.now(UTC)}
    if candidates_skipped:
        counter_updates["candidates_skipped"] = candidates_skipped
    backfill_db.update_batch_counters(batch_id, **counter_updates)

    # Bump the Redis inflight counter by the number dispatched. The
    # completion hook in process_ingestion_candidate decrements it by 1
    # per job regardless of success or failure.
    if candidates_dispatched:
        _get_redis_client().incrby(_inflight_key(batch_id), candidates_dispatched)

    return {
        "batch_id": batch_id,
        "status": "ticked",
        "candidates_dispatched": candidates_dispatched,
        "candidates_skipped": candidates_skipped,
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
    # Rescue pass: batches stuck in 'enumerating' with last_tick_at NULL
    # for >5 min are orphans (SQL-inserted batches whose enumerate was never
    # dispatched, or worker crash before dispatch landed on the queue).
    # Re-dispatch under a Redis SETNX lock to prevent double-dispatch if the
    # previous tick already rescued the same batch.
    stuck = backfill_db.get_stuck_enumerating_batches(
        stale_after_minutes=5, limit=5,
    )
    rescued = 0
    for batch in stuck:
        if _try_dispatch_enumerate(str(batch["id"])):
            logger.warning(
                "Rescuing stuck enumerating batch %s (created_at=%s) — "
                "re-dispatching enumerate",
                batch["id"],
                batch.get("created_at"),
            )
            rescued += 1

    running_batches = backfill_db.get_batches_by_status("running")
    if not running_batches:
        return {
            "status": "idle",
            "batches_processed": 0,
            "rescued_enumerating": rescued,
        }

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
        "rescued_enumerating": rescued,
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
            _get_redis_client().delete(_inflight_key(batch_id))
            halted_count += 1
            continue

        # Check per-batch budget
        remaining = backfill_db.get_batch_budget_remaining(batch_id)
        if remaining <= Decimal("0"):
            backfill_db.transition_batch(
                batch_id, "halted_budget",
                admin_notes=f"Batch budget ceiling reached. Consumed: {batch.get('budget_consumed_usd')}",
            )
            _get_redis_client().delete(_inflight_key(batch_id))
            halted_count += 1

    return {
        "status": "ok",
        "batches_checked": checked_count,
        "batches_halted": halted_count,
        "global_budget_exceeded": global_budget_exceeded,
    }
