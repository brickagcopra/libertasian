"""LIBERTASIAN Worker Service — Daily incremental crawl tasks.

Two Celery Beat tasks (``ingestion.crawl_scel_since_last`` and
``ingestion.crawl_lawphil_since_last``) that fetch only decisions published
since the last successful crawl. Cursor is advanced in the ``crawl_state``
table — but only after every new candidate has been durably enqueued for
processing, so a transient fetch failure never skips a decision.

Reuses the existing ingestion pipeline: new candidates are written as
``ingestion_candidates`` rows and dispatched via
``ingestion.process_candidate``. No duplicate persistence path.

Both tasks are no-ops unless ``WORKER_CRAWL_DAILY_ENABLED=true``. This
lets operators deploy the code first and then turn the schedule on
deliberately after observing a manual run.
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime
from typing import Any

import psycopg2.extras
from celery import shared_task

from ..backfill.fetch_window import is_in_fetch_window
from ..clients import ingestion_db_client as ingestion_db
from ..clients.db_client import get_connection
from ..config import settings
from ..fetchers.registry import get_fetcher
from ..normalizers.text_normalizer import compute_similarity_key
from .ingestion_tasks import process_ingestion_candidate

logger = logging.getLogger(__name__)


# Source domain → (parser_type, fetcher_key). Used to look up the
# canonical ``sources`` row and dispatch to the right fetcher.
SCEL_DOMAIN = "elibrary.judiciary.gov.ph"
LAWPHIL_DOMAIN = "lawphil.net"


def _load_source_by_domain(domain: str) -> dict[str, Any] | None:
    """Return (id, name, type, fetch_strategy, endpoints) for a source by domain."""
    with get_connection() as conn, \
            conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT id, name, type, domain, fetch_strategy
               FROM sources
               WHERE domain = %s AND enabled = true
               LIMIT 1""",
            (domain,),
        )
        source = cur.fetchone()
        if not source:
            return None
        result = dict(source)

        cur.execute(
            """SELECT id, endpoint_url, parser_type
               FROM source_endpoints
               WHERE source_id = %s AND status = 'active'
               ORDER BY id ASC""",
            (result["id"],),
        )
        result["endpoints"] = [dict(row) for row in cur.fetchall()]
        return result


def _get_crawl_cursor(source_id: str) -> str | None:
    """Load the last_cursor value from crawl_state, or None if no row yet."""
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT last_cursor FROM crawl_state WHERE source_id = %s",
            (source_id,),
        )
        row = cur.fetchone()
        return row[0] if row and row[0] else None


def _set_crawl_cursor(source_id: str, new_cursor: str | None) -> None:
    """UPSERT crawl_state with new cursor + updated timestamps.

    Only called when a crawl task has successfully enqueued every new
    candidate. If called with ``new_cursor=None`` the cursor column is
    cleared but the row still records ``last_crawled_at`` so monitoring
    can see the task ran.
    """
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO crawl_state (source_id, last_crawled_at, last_cursor, updated_at)
               VALUES (%s, NOW(), %s, NOW())
               ON CONFLICT (source_id)
               DO UPDATE SET last_crawled_at = EXCLUDED.last_crawled_at,
                             last_cursor = EXCLUDED.last_cursor,
                             updated_at = NOW()""",
            (source_id, new_cursor),
        )


def _run_incremental_crawl(
    domain: str,
    task_label: str,
) -> dict[str, Any]:
    """Shared crawl logic for both SCEL and LawPhil daily tasks.

    Returns a telemetry dict:
        {
          "source": "...",
          "source_id": "...",
          "cursor_before": str | None,
          "cursor_after": str | None,
          "candidates_found": int,
          "candidates_enqueued": int,
          "skipped_duplicates": int,
          "errors": [...],
          "advanced": bool,  # whether crawl_state cursor moved
        }
    """
    if not settings.crawl_daily_enabled:
        logger.info("%s skipped: WORKER_CRAWL_DAILY_ENABLED is false", task_label)
        return {"skipped": True, "reason": "disabled"}

    if not is_in_fetch_window():
        logger.info("%s skipped: outside fetch window", task_label)
        return {"skipped": True, "reason": "outside_fetch_window"}

    source = _load_source_by_domain(domain)
    if not source or not source["endpoints"]:
        logger.warning("%s skipped: no enabled source for domain %s", task_label, domain)
        return {"skipped": True, "reason": "no_source_or_endpoint"}

    source_id: str = source["id"]
    # Daily crawl uses the first active endpoint — fetchers' fetch_since
    # internally walks monthly pages so one entry point is enough.
    endpoint = source["endpoints"][0]
    parser_type: str = endpoint["parser_type"]
    endpoint_url: str = endpoint["endpoint_url"]

    fetcher = get_fetcher(parser_type)
    if fetcher is None:
        logger.error("%s: no fetcher for parser_type=%s", task_label, parser_type)
        return {"skipped": True, "reason": f"no_fetcher:{parser_type}"}

    cursor_before = _get_crawl_cursor(source_id)
    try:
        new_candidates, new_cursor = fetcher.fetch_since(endpoint_url, cursor_before)
    except Exception as exc:
        logger.exception(
            "%s: fetch_since failed for %s — cursor NOT advanced",
            task_label,
            endpoint_url,
        )
        return {
            "source": source["name"],
            "source_id": source_id,
            "cursor_before": cursor_before,
            "cursor_after": cursor_before,
            "candidates_found": 0,
            "candidates_enqueued": 0,
            "errors": [{"phase": "fetch", "message": str(exc)}],
            "advanced": False,
        }

    enqueued = 0
    skipped = 0
    errors: list[dict[str, Any]] = []

    for candidate in new_candidates:
        try:
            sim_key = compute_similarity_key(
                title=candidate.title,
                citation=candidate.gr_no,
                date=candidate.decision_date,
            )
            existing = ingestion_db.find_candidate_by_similarity_key(
                source_id=source_id, similarity_key=sim_key,
            )
            if existing:
                skipped += 1
                continue

            candidate_id = ingestion_db.create_ingestion_candidate(
                source_id=source_id,
                detected_url=candidate.url,
                detected_title=candidate.title,
                detected_document_type=candidate.document_type,
                similarity_key=sim_key,
            )

            process_ingestion_candidate.delay(
                candidate_id=candidate_id,
                source_id=source_id,
                url=candidate.url,
                parser_type=parser_type,
                candidate_metadata={
                    "title": candidate.title,
                    "gr_no": candidate.gr_no,
                    "document_type": candidate.document_type,
                    "decision_date": candidate.decision_date,
                    "ponente": getattr(candidate, "ponente", None),
                    "court": getattr(candidate, "court", None),
                    "trigger": "daily_incremental",
                },
            )
            enqueued += 1
        except Exception as exc:
            logger.exception(
                "%s: failed to enqueue candidate %s — cursor NOT advanced",
                task_label,
                candidate.url,
            )
            errors.append({"url": candidate.url, "message": str(exc)})

    advanced = False
    if errors:
        # Any per-candidate failure keeps the cursor where it was so the
        # next run re-attempts everything newer than last-known-good.
        logger.warning(
            "%s: %d error(s) enqueuing candidates — holding cursor at %s",
            task_label,
            len(errors),
            cursor_before,
        )
        cursor_after = cursor_before
    else:
        cursor_after = new_cursor
        if cursor_after != cursor_before:
            _set_crawl_cursor(source_id, cursor_after)
            advanced = True
        else:
            # Even on a no-op success, record that the task ran.
            _set_crawl_cursor(source_id, cursor_after)

    logger.info(
        "%s: source=%s found=%d enqueued=%d skipped=%d errors=%d advanced=%s "
        "cursor_before=%s cursor_after=%s",
        task_label, source["name"], len(new_candidates), enqueued, skipped,
        len(errors), advanced, cursor_before, cursor_after,
    )

    return {
        "source": source["name"],
        "source_id": source_id,
        "cursor_before": cursor_before,
        "cursor_after": cursor_after,
        "candidates_found": len(new_candidates),
        "candidates_enqueued": enqueued,
        "skipped_duplicates": skipped,
        "errors": errors,
        "advanced": advanced,
        "ran_at": datetime.now(UTC).isoformat(),
    }


@shared_task(
    bind=True,
    name="ingestion.crawl_scel_since_last",
    acks_late=True,
    reject_on_worker_lost=True,
    max_retries=0,
)
def crawl_scel_since_last(self: Any) -> dict[str, Any]:  # noqa: ARG001 — Celery self
    """Daily incremental crawl of Supreme Court E-Library."""
    return _run_incremental_crawl(SCEL_DOMAIN, "crawl.scel_incremental")


@shared_task(
    bind=True,
    name="ingestion.crawl_lawphil_since_last",
    acks_late=True,
    reject_on_worker_lost=True,
    max_retries=0,
)
def crawl_lawphil_since_last(self: Any) -> dict[str, Any]:  # noqa: ARG001
    """Daily incremental crawl of lawphil.net."""
    return _run_incremental_crawl(LAWPHIL_DOMAIN, "crawl.lawphil_incremental")


__all__ = [
    "crawl_scel_since_last",
    "crawl_lawphil_since_last",
    "_run_incremental_crawl",
    "_load_source_by_domain",
    "_get_crawl_cursor",
    "_set_crawl_cursor",
]
