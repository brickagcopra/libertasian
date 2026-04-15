"""LIBERTASIAN Worker Service — Derivative generation job dispatcher.

Celery Beat poller that picks up pending derivative_generation_jobs and
dispatches them to the correct generator task based on derivative_type.

Uses FOR UPDATE SKIP LOCKED to prevent double-claiming in multi-worker
deployments.

Per CLAUDE.md:
- Celery tasks must be idempotent (acks_late + reject_on_worker_lost)
- Pattern matches ingestion_tasks.py poller
"""

from __future__ import annotations

import logging
from typing import Any

from celery import shared_task

from ..clients.db_client import get_connection
from ..config import settings

import psycopg2.extras

logger = logging.getLogger(__name__)

# Mapping from derivative_type DB value -> Celery task name
_TASK_ROUTING: dict[str, str] = {
    "case_digest": "derivatives.generate_case_digest",
    "mcq": "derivatives.generate_mcq",
    "essay_prompt": "derivatives.generate_essay_prompt",
    "flashcard": "derivatives.generate_flashcards",
    "subject_outline": "derivatives.generate_subject_outline",
    "doctrine_extract": "derivatives.generate_doctrine_extract",
}


@shared_task(
    bind=True,
    name="derivatives.poll_pending_jobs",
    acks_late=True,
    reject_on_worker_lost=True,
    max_retries=0,
)
def poll_pending_derivative_jobs(self: Any) -> dict[str, Any]:
    """Poll for pending derivative generation jobs and dispatch workers.

    Runs every 30 seconds via Celery Beat. Atomically claims pending jobs
    (status='pending' -> 'dispatched') using FOR UPDATE SKIP LOCKED,
    then dispatches the appropriate generator task for each.
    """
    batch_size = getattr(settings, "derivative_poll_batch_size", 10)

    with get_connection() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            # Atomically select + update pending -> dispatched
            cur.execute(
                """UPDATE derivative_generation_jobs
                   SET status = 'dispatched', started_at = NOW()
                   WHERE id IN (
                       SELECT id FROM derivative_generation_jobs
                       WHERE status = 'pending'
                       ORDER BY created_at ASC
                       LIMIT %s
                       FOR UPDATE SKIP LOCKED
                   )
                   RETURNING id, derivative_type, source_document_id""",
                (batch_size,),
            )
            jobs = [dict(row) for row in cur.fetchall()]

    if not jobs:
        logger.debug("No pending derivative generation jobs found")
        return {"dispatched": 0, "status": "ok"}

    dispatched = 0
    skipped = 0

    for job in jobs:
        job_id = str(job["id"])
        derivative_type = job["derivative_type"]
        document_id = str(job["source_document_id"]) if job["source_document_id"] else None

        task_name = _TASK_ROUTING.get(derivative_type)
        if not task_name:
            logger.warning(
                "Unknown derivative_type '%s' for job %s — skipping",
                derivative_type,
                job_id,
            )
            # Mark as failed so it doesn't get re-polled forever
            _fail_unknown_type(job_id, derivative_type)
            skipped += 1
            continue

        if not document_id and derivative_type != "subject_outline":
            logger.warning(
                "Job %s (%s) has no source_document_id — skipping",
                job_id,
                derivative_type,
            )
            _fail_unknown_type(job_id, f"missing source_document_id for {derivative_type}")
            skipped += 1
            continue

        logger.info(
            "Dispatching %s for job %s (document=%s)",
            task_name,
            job_id,
            document_id,
        )

        # Build kwargs based on task signature
        kwargs: dict[str, Any] = {"job_id": job_id}
        if document_id:
            kwargs["document_id"] = document_id

        self.app.send_task(task_name, kwargs=kwargs)
        dispatched += 1

    logger.info(
        "Dispatched %d derivative jobs (%d skipped)",
        dispatched,
        skipped,
    )
    return {"dispatched": dispatched, "skipped": skipped, "status": "ok"}


def _fail_unknown_type(job_id: str, reason: str) -> None:
    """Mark a job as failed when we can't route it."""
    import json

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """UPDATE derivative_generation_jobs
                   SET status = 'failed',
                       finished_at = NOW(),
                       error_json = %s::jsonb
                   WHERE id = %s""",
                (json.dumps({"message": reason}), job_id),
            )
