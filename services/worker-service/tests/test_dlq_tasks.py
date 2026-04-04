"""Tests for dead-letter queue Celery tasks.

Mocks: db (ingestion_db_client).
Verifies: audit logging, editorial flag creation, entity ID extraction,
error message truncation.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest

from .conftest import make_uuid


class TestHandleDeadLetter:
    """Tests for the handle_dead_letter task."""

    def test_logs_audit_entry(
        self,
        mock_dlq_db: MagicMock,
        job_id: str,
    ) -> None:
        from src.tasks.dlq_tasks import handle_dead_letter

        handle_dead_letter(
            task_name="ingestion.process_candidate",
            task_args={"job_id": job_id},
            error_message="Connection refused",
            retry_count=3,
        )

        mock_dlq_db.create_audit_log.assert_called_once()
        call_args = mock_dlq_db.create_audit_log.call_args
        assert call_args.kwargs["action"] == "ingestion.dead_letter"
        assert call_args.kwargs["entity_type"] == "ingestion_task"

    def test_entity_id_from_candidate_id(
        self,
        mock_dlq_db: MagicMock,
        candidate_id: str,
    ) -> None:
        from src.tasks.dlq_tasks import handle_dead_letter

        handle_dead_letter(
            task_name="ingestion.process_candidate",
            task_args={"candidate_id": candidate_id},
            error_message="Parse error",
            retry_count=3,
        )

        call_args = mock_dlq_db.create_audit_log.call_args
        assert call_args.kwargs["entity_id"] == candidate_id

    def test_entity_id_from_job_id_when_no_candidate(
        self,
        mock_dlq_db: MagicMock,
        job_id: str,
    ) -> None:
        from src.tasks.dlq_tasks import handle_dead_letter

        handle_dead_letter(
            task_name="ingestion.run_job",
            task_args={"job_id": job_id},
            error_message="Timeout",
            retry_count=3,
        )

        call_args = mock_dlq_db.create_audit_log.call_args
        assert call_args.kwargs["entity_id"] == job_id

    def test_candidate_id_takes_priority_over_job_id(
        self,
        mock_dlq_db: MagicMock,
        candidate_id: str,
        job_id: str,
    ) -> None:
        """candidate_id is checked first via `or` short-circuit."""
        from src.tasks.dlq_tasks import handle_dead_letter

        handle_dead_letter(
            task_name="ingestion.process_candidate",
            task_args={"candidate_id": candidate_id, "job_id": job_id},
            error_message="Error",
            retry_count=1,
        )

        call_args = mock_dlq_db.create_audit_log.call_args
        assert call_args.kwargs["entity_id"] == candidate_id

    def test_creates_editorial_flag_for_document(
        self,
        mock_dlq_db: MagicMock,
        document_id: str,
    ) -> None:
        from src.tasks.dlq_tasks import handle_dead_letter

        handle_dead_letter(
            task_name="ingestion.validate_and_publish",
            task_args={"document_id": document_id},
            error_message="Validation failed",
            retry_count=3,
        )

        mock_dlq_db.create_editorial_flag_for_failed_task.assert_called_once_with(
            document_id=document_id,
            candidate_id=None,
            task_name="ingestion.validate_and_publish",
            error_message="Validation failed",
        )

    def test_creates_editorial_flag_for_candidate(
        self,
        mock_dlq_db: MagicMock,
        candidate_id: str,
    ) -> None:
        from src.tasks.dlq_tasks import handle_dead_letter

        handle_dead_letter(
            task_name="ingestion.process_candidate",
            task_args={"candidate_id": candidate_id},
            error_message="Parse error",
            retry_count=3,
        )

        mock_dlq_db.create_editorial_flag_for_failed_task.assert_called_once_with(
            document_id=None,
            candidate_id=candidate_id,
            task_name="ingestion.process_candidate",
            error_message="Parse error",
        )

    def test_no_editorial_flag_without_document_or_candidate(
        self,
        mock_dlq_db: MagicMock,
        job_id: str,
    ) -> None:
        """No document_id or candidate_id in args → skip editorial flag."""
        from src.tasks.dlq_tasks import handle_dead_letter

        handle_dead_letter(
            task_name="ingestion.poll_pending_jobs",
            task_args={"job_id": job_id},
            error_message="Redis down",
            retry_count=1,
        )

        mock_dlq_db.create_editorial_flag_for_failed_task.assert_not_called()

    def test_returns_logged_status(
        self,
        mock_dlq_db: MagicMock,
        document_id: str,
    ) -> None:
        from src.tasks.dlq_tasks import handle_dead_letter

        result = handle_dead_letter(
            task_name="ingestion.validate_and_publish",
            task_args={"document_id": document_id},
            error_message="Failed",
            retry_count=3,
        )

        assert result["status"] == "logged"
        assert result["task_name"] == "ingestion.validate_and_publish"
        assert result["entity_id"] == document_id

    def test_error_message_truncated_to_1000_chars(
        self,
        mock_dlq_db: MagicMock,
    ) -> None:
        """Error message in audit metadata is truncated to 1000 chars."""
        from src.tasks.dlq_tasks import handle_dead_letter

        long_error = "x" * 2000

        handle_dead_letter(
            task_name="ingestion.process_candidate",
            task_args={},
            error_message=long_error,
            retry_count=3,
        )

        call_args = mock_dlq_db.create_audit_log.call_args
        metadata = call_args.kwargs["metadata"]
        assert len(metadata["error_message"]) == 1000

    def test_audit_metadata_includes_task_info(
        self,
        mock_dlq_db: MagicMock,
        candidate_id: str,
    ) -> None:
        from src.tasks.dlq_tasks import handle_dead_letter

        handle_dead_letter(
            task_name="ingestion.process_candidate",
            task_args={"candidate_id": candidate_id},
            error_message="Out of memory",
            retry_count=5,
        )

        call_args = mock_dlq_db.create_audit_log.call_args
        metadata = call_args.kwargs["metadata"]
        assert metadata["task_name"] == "ingestion.process_candidate"
        assert metadata["task_args"] == {"candidate_id": candidate_id}
        assert metadata["retry_count"] == 5
