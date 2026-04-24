"""LIBERTASIAN Worker Service — PostgreSQL client for backfill engine.

Database operations for the backfill pipeline tables:
backfill_batches, backfill_checkpoints, ingestion_jobs (backfill-triggered).

Per CLAUDE.md: Python services read/write their own tables but Prisma owns
schema migrations. All table/column names use snake_case via Prisma @@map/@map.
"""

import json
import logging
import uuid
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

import psycopg2.extras

from .db_client import get_connection

logger = logging.getLogger(__name__)

VALID_TRANSITIONS: dict[str, list[str]] = {
    "pending": ["enumerating", "failed"],
    "enumerating": ["running", "failed"],
    "running": ["paused", "halted_budget", "halted_admin", "completed", "failed"],
    "paused": ["running", "failed"],
    "halted_budget": ["running"],
    "halted_admin": ["running"],
}


# ─── Read Operations ─────────────────────────────────────────────────────


def get_batch(batch_id: str) -> dict[str, Any] | None:
    """Fetch a backfill batch by ID."""
    with get_connection() as conn, \
            conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT id, source_id, source_endpoint_id, name,
                      year_start, year_end, month_start, month_end,
                      status, budget_ceiling_usd, budget_consumed_usd,
                      candidates_discovered, candidates_processed,
                      candidates_skipped, candidates_failed,
                      documents_created, documents_updated,
                      checkpoint_state, started_at, finished_at,
                      last_tick_at, created_by_user_id,
                      created_at, updated_at
               FROM backfill_batches
               WHERE id = %s""",
            (batch_id,),
        )
        row = cur.fetchone()
        return dict(row) if row else None


def get_batches_by_status(status: str, limit: int = 10) -> list[dict[str, Any]]:
    """Fetch batches in a given status, oldest first."""
    with get_connection() as conn, \
            conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT id, source_id, source_endpoint_id, name,
                      year_start, year_end, month_start, month_end,
                      status, budget_ceiling_usd, budget_consumed_usd,
                      candidates_discovered, candidates_processed,
                      candidates_skipped, candidates_failed,
                      documents_created, documents_updated,
                      checkpoint_state, started_at, finished_at,
                      last_tick_at, created_by_user_id,
                      created_at, updated_at
               FROM backfill_batches
               WHERE status = %s
               ORDER BY created_at ASC
               LIMIT %s""",
            (status, limit),
        )
        return [dict(row) for row in cur.fetchall()]


def get_inflight_jobs_count(batch_id: str) -> int:
    """Count IngestionJobs for this batch in status 'pending' or 'running'."""
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """SELECT COUNT(*)
               FROM ingestion_jobs
               WHERE backfill_batch_id = %s
               AND status IN ('pending', 'running')""",
            (batch_id,),
        )
        row = cur.fetchone()
        return int(row[0]) if row else 0


def get_stuck_enumerating_batches(
    stale_after_minutes: int = 5,
    limit: int = 5,
) -> list[dict[str, Any]]:
    """Batches stuck in 'enumerating' with no tick ever recorded.

    Covers two failure modes:
    1. SQL-inserted batches whose enumerate was never dispatched.
    2. Worker crashed mid-enumerate before checkpoint write — acks_late should
       requeue, but if the task is lost, the batch is orphaned.

    ``last_tick_at IS NULL`` is safe because ``_tick_single_batch`` is the only
    code that sets ``last_tick_at``; enumerate never touches it. A running
    enumerate naturally has NULL and is indistinguishable from a stuck one, so
    the ``stale_after_minutes`` gate avoids rescuing a genuinely in-flight
    enumerate (prod enumerates complete in under 25 min; we default to 5 min
    and rely on the Redis lock for idempotency).
    """
    with get_connection() as conn, \
            conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT id, source_id, source_endpoint_id, name,
                      year_start, year_end, month_start, month_end,
                      status, checkpoint_state, last_tick_at,
                      created_at, updated_at
               FROM backfill_batches
               WHERE status = 'enumerating'
                 AND last_tick_at IS NULL
                 AND created_at < NOW() - make_interval(mins => %s)
               ORDER BY created_at ASC
               LIMIT %s""",
            (stale_after_minutes, limit),
        )
        return [dict(row) for row in cur.fetchall()]


def get_batch_budget_remaining(batch_id: str) -> Decimal:
    """Return budget_ceiling_usd - budget_consumed_usd for a batch."""
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """SELECT budget_ceiling_usd, budget_consumed_usd
               FROM backfill_batches
               WHERE id = %s""",
            (batch_id,),
        )
        row = cur.fetchone()
        if not row:
            return Decimal("0")
        ceiling = Decimal(str(row[0])) if row[0] is not None else Decimal("0")
        consumed = Decimal(str(row[1])) if row[1] is not None else Decimal("0")
        return ceiling - consumed


# ─── Write Operations ────────────────────────────────────────────────────


def transition_batch(batch_id: str, new_status: str, **extra_fields: Any) -> bool:
    """Atomically transition batch status. Validates against VALID_TRANSITIONS.

    extra_fields can include: started_at, finished_at, last_tick_at,
    admin_notes, checkpoint_state.
    Returns False if current status doesn't allow the transition.
    """
    # Find which current statuses allow transition to new_status
    allowed_from = [
        current for current, targets in VALID_TRANSITIONS.items()
        if new_status in targets
    ]
    if not allowed_from:
        logger.warning(
            "No valid transition to '%s' exists in VALID_TRANSITIONS",
            new_status,
        )
        return False

    # Build the SET clause with optional extra fields
    set_parts = ["status = %s", "updated_at = NOW()"]
    params: list[Any] = [new_status]

    for field, value in extra_fields.items():
        if field == "checkpoint_state":
            set_parts.append(f"{field} = %s::jsonb")
            params.append(json.dumps(value) if isinstance(value, dict) else value)
        elif field == "admin_notes":
            set_parts.append(f"{field} = %s")
            params.append(value)
        elif field in ("started_at", "finished_at", "last_tick_at"):
            set_parts.append(f"{field} = %s")
            params.append(value)

    set_clause = ", ".join(set_parts)

    # Build WHERE with status IN (allowed_from) for atomic transition
    placeholders = ", ".join(["%s"] * len(allowed_from))
    params.append(batch_id)
    params.extend(allowed_from)

    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            f"""UPDATE backfill_batches
                   SET {set_clause}
                   WHERE id = %s AND status IN ({placeholders})""",
            params,
        )
        success = bool(cur.rowcount > 0)

    if success:
        logger.info("Transitioned batch %s to '%s'", batch_id, new_status)
    else:
        logger.warning(
            "Failed to transition batch %s to '%s' (current status not in %s)",
            batch_id,
            new_status,
            allowed_from,
        )
    return success


def update_batch_counters(batch_id: str, **counters: Any) -> None:
    """Increment batch counters (candidates_discovered, candidates_processed, etc.).

    Also supports last_tick_at as a direct-set field.
    """
    if not counters:
        return

    set_parts = ["updated_at = NOW()"]
    params: list[Any] = []

    # Counter fields that get incremented
    counter_fields = {
        "candidates_discovered",
        "candidates_processed",
        "candidates_skipped",
        "candidates_failed",
        "documents_created",
        "documents_updated",
    }

    for field, value in counters.items():
        if field in counter_fields:
            set_parts.append(f"{field} = COALESCE({field}, 0) + %s")
            params.append(value)
        elif field == "last_tick_at":
            set_parts.append(f"{field} = %s")
            params.append(value)

    if len(set_parts) == 1:
        # Only updated_at, no real changes
        return

    set_clause = ", ".join(set_parts)
    params.append(batch_id)

    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            f"""UPDATE backfill_batches
                   SET {set_clause}
                   WHERE id = %s""",
            params,
        )
    logger.info("Updated batch %s counters: %s", batch_id, counters)


def update_checkpoint(
    batch_id: str,
    checkpoint_state: dict[str, Any],
    candidates_seen: int,
) -> None:
    """Update checkpoint_state on batch AND write a BackfillCheckpoint row."""
    checkpoint_id = str(uuid.uuid4())
    checkpoint_json = json.dumps(checkpoint_state)

    with get_connection() as conn, conn.cursor() as cur:
        # Update the batch's checkpoint_state
        cur.execute(
            """UPDATE backfill_batches
                   SET checkpoint_state = %s::jsonb, updated_at = NOW()
                   WHERE id = %s""",
            (checkpoint_json, batch_id),
        )

        # Write a checkpoint log row (write-ahead log)
        cur.execute(
            """INSERT INTO backfill_checkpoints
                   (id, backfill_batch_id, cursor_json, candidates_seen, created_at)
                   VALUES (%s, %s, %s::jsonb, %s, NOW())""",
            (checkpoint_id, batch_id, checkpoint_json, candidates_seen),
        )

    logger.info(
        "Updated checkpoint for batch %s: candidates_seen=%d",
        batch_id,
        candidates_seen,
    )


def create_backfill_ingestion_job(
    source_id: str,
    source_endpoint_id: str | None,
    backfill_batch_id: str,
    triggered_by_user_id: str,
) -> str:
    """Create an IngestionJob with trigger_type='backfill' and backfill_batch_id set.

    Returns the new job ID.
    """
    job_id = str(uuid.uuid4())
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO ingestion_jobs
                   (id, source_id, source_endpoint_id, job_type, status,
                    trigger_type, backfill_batch_id, triggered_by_user_id)
                   VALUES (%s, %s, %s, 'crawl', 'pending', 'backfill',
                           %s, %s)""",
            (job_id, source_id, source_endpoint_id, backfill_batch_id,
             triggered_by_user_id),
        )
    logger.info(
        "Created backfill ingestion job %s for batch %s",
        job_id,
        backfill_batch_id,
    )
    return job_id
