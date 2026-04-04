"""LIBERTASIAN Worker Service — Dead-letter queue tasks.

Handles permanently failed ingestion tasks by logging to audit_logs
and creating editorial_flags entries for manual review.
"""

from __future__ import annotations

import logging
from typing import Any

from celery import shared_task

from ..clients import ingestion_db_client as db

logger = logging.getLogger(__name__)


@shared_task(
    name="ingestion.handle_dead_letter",
    acks_late=True,
    reject_on_worker_lost=True,
    max_retries=1,
    default_retry_delay=30,
)
def handle_dead_letter(
    task_name: str,
    task_args: dict[str, Any],
    error_message: str,
    retry_count: int,
) -> dict[str, Any]:
    """Handle a permanently failed task by logging and flagging for review.

    Called when an ingestion task exhausts all retries. Creates an audit log
    entry and an editorial flag so admins can investigate.

    Args:
        task_name: Name of the failed Celery task.
        task_args: Original keyword arguments of the failed task.
        error_message: Final error message from the last retry attempt.
        retry_count: Number of retries that were attempted.
    """
    logger.error(
        "Dead-letter: task=%s args=%s error=%s retries=%d",
        task_name,
        task_args,
        error_message,
        retry_count,
    )

    # Log to audit_logs
    db.create_audit_log(
        action="ingestion.dead_letter",
        entity_type="ingestion_task",
        entity_id=task_args.get("candidate_id") or task_args.get("job_id"),
        metadata={
            "task_name": task_name,
            "task_args": task_args,
            "error_message": error_message[:1000],
            "retry_count": retry_count,
        },
    )

    # Create editorial flag if there's a document or candidate involved
    document_id = task_args.get("document_id")
    candidate_id = task_args.get("candidate_id")

    if document_id or candidate_id:
        db.create_editorial_flag_for_failed_task(
            document_id=document_id,
            candidate_id=candidate_id,
            task_name=task_name,
            error_message=error_message,
        )

    return {
        "status": "logged",
        "task_name": task_name,
        "entity_id": document_id or candidate_id,
    }
