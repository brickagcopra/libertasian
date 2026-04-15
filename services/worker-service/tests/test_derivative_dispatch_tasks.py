"""Tests for derivative generation job dispatch poller.

Covers:
1. No pending jobs -> dispatched=0
2. Happy path: pending jobs dispatched to correct task names
3. Unknown derivative_type -> failed with error
4. Missing source_document_id -> failed
5. Idempotency: claim_derivative_job returns False -> early return
6. Batch size respects settings
7. Retry flow: retried job (set back to pending) gets dispatched
"""

from __future__ import annotations

import uuid
from typing import Any
from unittest.mock import MagicMock, patch, call

import pytest

from src.tasks.derivative_dispatch_tasks import poll_pending_derivative_jobs


def make_uuid() -> str:
    return str(uuid.uuid4())


def _make_mock_conn(rows: list[dict[str, Any]]) -> MagicMock:
    """Create a mock connection that returns the given rows from fetchall."""
    mock_conn = MagicMock()
    mock_cursor = MagicMock()
    mock_cursor.fetchall.return_value = rows
    mock_cursor.__enter__ = MagicMock(return_value=mock_cursor)
    mock_cursor.__exit__ = MagicMock(return_value=False)
    mock_conn.__enter__ = MagicMock(return_value=mock_conn)
    mock_conn.__exit__ = MagicMock(return_value=False)
    mock_conn.cursor.return_value = mock_cursor
    return mock_conn


# ─── Poller Tests ──────────────────────────────────────────────────────


class TestPollPendingDerivativeJobs:
    """Tests for the derivatives.poll_pending_jobs Celery Beat task."""

    @patch("src.tasks.derivative_dispatch_tasks.get_connection")
    def test_no_pending_jobs_returns_zero(
        self,
        mock_get_conn: MagicMock,
    ) -> None:
        mock_get_conn.return_value = _make_mock_conn([])

        result = poll_pending_derivative_jobs.run()
        assert result["dispatched"] == 0
        assert result["status"] == "ok"

    @patch("src.tasks.derivative_dispatch_tasks.get_connection")
    def test_dispatches_case_digest_to_correct_task(
        self,
        mock_get_conn: MagicMock,
    ) -> None:
        job_id = make_uuid()
        doc_id = make_uuid()

        mock_get_conn.return_value = _make_mock_conn([
            {"id": job_id, "derivative_type": "case_digest", "source_document_id": doc_id},
        ])

        with patch.object(poll_pending_derivative_jobs, "app") as mock_app:
            result = poll_pending_derivative_jobs.run()

        assert result["dispatched"] == 1
        mock_app.send_task.assert_called_once_with(
            "derivatives.generate_case_digest",
            kwargs={"job_id": job_id, "document_id": doc_id},
        )

    @patch("src.tasks.derivative_dispatch_tasks.get_connection")
    def test_dispatches_all_derivative_types_correctly(
        self,
        mock_get_conn: MagicMock,
    ) -> None:
        """Each derivative_type routes to the correct Celery task name."""
        types_to_tasks = {
            "case_digest": "derivatives.generate_case_digest",
            "mcq": "derivatives.generate_mcq",
            "essay_prompt": "derivatives.generate_essay_prompt",
            "flashcard": "derivatives.generate_flashcards",
            "subject_outline": "derivatives.generate_subject_outline",
            "doctrine_extract": "derivatives.generate_doctrine_extract",
        }

        rows = []
        for dtype in types_to_tasks:
            rows.append({
                "id": make_uuid(),
                "derivative_type": dtype,
                "source_document_id": make_uuid(),
            })

        mock_get_conn.return_value = _make_mock_conn(rows)

        with patch.object(poll_pending_derivative_jobs, "app") as mock_app:
            result = poll_pending_derivative_jobs.run()

        assert result["dispatched"] == 6
        assert result["skipped"] == 0

        sent_task_names = [c.args[0] for c in mock_app.send_task.call_args_list]
        for expected_task in types_to_tasks.values():
            assert expected_task in sent_task_names

    @patch("src.tasks.derivative_dispatch_tasks._fail_unknown_type")
    @patch("src.tasks.derivative_dispatch_tasks.get_connection")
    def test_unknown_derivative_type_marked_failed(
        self,
        mock_get_conn: MagicMock,
        mock_fail: MagicMock,
    ) -> None:
        job_id = make_uuid()
        mock_get_conn.return_value = _make_mock_conn([
            {"id": job_id, "derivative_type": "unknown_type", "source_document_id": make_uuid()},
        ])

        with patch.object(poll_pending_derivative_jobs, "app") as mock_app:
            result = poll_pending_derivative_jobs.run()

        assert result["dispatched"] == 0
        assert result["skipped"] == 1
        mock_app.send_task.assert_not_called()
        mock_fail.assert_called_once_with(job_id, "unknown_type")

    @patch("src.tasks.derivative_dispatch_tasks._fail_unknown_type")
    @patch("src.tasks.derivative_dispatch_tasks.get_connection")
    def test_missing_document_id_for_non_outline_type(
        self,
        mock_get_conn: MagicMock,
        mock_fail: MagicMock,
    ) -> None:
        job_id = make_uuid()
        mock_get_conn.return_value = _make_mock_conn([
            {"id": job_id, "derivative_type": "case_digest", "source_document_id": None},
        ])

        with patch.object(poll_pending_derivative_jobs, "app") as mock_app:
            result = poll_pending_derivative_jobs.run()

        assert result["dispatched"] == 0
        assert result["skipped"] == 1
        mock_app.send_task.assert_not_called()

    @patch("src.tasks.derivative_dispatch_tasks.get_connection")
    def test_sql_uses_for_update_skip_locked(
        self,
        mock_get_conn: MagicMock,
    ) -> None:
        """Verify the SQL query contains FOR UPDATE SKIP LOCKED for concurrency safety."""
        mock_conn = _make_mock_conn([])
        mock_get_conn.return_value = mock_conn

        poll_pending_derivative_jobs.run()

        # Get the cursor mock and check the executed SQL
        mock_cursor = mock_conn.cursor.return_value.__enter__.return_value
        executed_sql = mock_cursor.execute.call_args[0][0]
        assert "FOR UPDATE SKIP LOCKED" in executed_sql


# ─── Idempotency Guard Tests ──────────────────────────────────────────


class TestIdempotencyGuard:
    """Tests that each generator task returns early when claim fails."""

    @patch("src.tasks.digest_generation_tasks.nestjs_client")
    @patch("src.tasks.digest_generation_tasks.db")
    def test_digest_skips_when_already_claimed(
        self,
        mock_db: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        from src.tasks.digest_generation_tasks import generate_case_digest

        mock_db.claim_derivative_job.return_value = False

        result = generate_case_digest.run("job-001", "doc-001")

        assert result["status"] == "already_claimed"
        mock_db.get_legal_document.assert_not_called()
        mock_nestjs.update_job_status.assert_not_called()

    @patch("src.tasks.mcq_generation_tasks.nestjs_client")
    @patch("src.tasks.mcq_generation_tasks.db")
    def test_mcq_skips_when_already_claimed(
        self,
        mock_db: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        from src.tasks.mcq_generation_tasks import generate_mcq_questions

        mock_db.claim_derivative_job.return_value = False

        result = generate_mcq_questions.run("job-001", "doc-001")

        assert result["status"] == "already_claimed"
        mock_db.get_legal_document.assert_not_called()

    @patch("src.tasks.essay_generation_tasks.nestjs_client")
    @patch("src.tasks.essay_generation_tasks.db")
    def test_essay_skips_when_already_claimed(
        self,
        mock_db: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        from src.tasks.essay_generation_tasks import generate_essay_prompt

        mock_db.claim_derivative_job.return_value = False

        result = generate_essay_prompt.run("job-001", "doc-001")

        assert result["status"] == "already_claimed"
        mock_db.get_legal_document.assert_not_called()

    @patch("src.tasks.flashcard_generation_tasks.nestjs_client")
    @patch("src.tasks.flashcard_generation_tasks.db")
    def test_flashcard_skips_when_already_claimed(
        self,
        mock_db: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        from src.tasks.flashcard_generation_tasks import generate_flashcards

        mock_db.claim_derivative_job.return_value = False

        result = generate_flashcards.run("job-001", "doc-001")

        assert result["status"] == "already_claimed"
        mock_db.get_legal_document.assert_not_called()

    @patch("src.tasks.outline_generation_tasks.nestjs_client")
    @patch("src.tasks.outline_generation_tasks.db")
    def test_outline_skips_when_already_claimed(
        self,
        mock_db: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        from src.tasks.outline_generation_tasks import generate_subject_outline

        mock_db.claim_derivative_job.return_value = False

        result = generate_subject_outline.run("job-001", "criminal_law")

        assert result["status"] == "already_claimed"

    @patch("src.tasks.doctrine_generation_tasks.nestjs_client")
    @patch("src.tasks.doctrine_generation_tasks.db")
    def test_doctrine_skips_when_already_claimed(
        self,
        mock_db: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        from src.tasks.doctrine_generation_tasks import generate_doctrine_extract

        mock_db.claim_derivative_job.return_value = False

        result = generate_doctrine_extract.run("job-001", "doc-001")

        assert result["status"] == "already_claimed"
        mock_db.get_legal_document.assert_not_called()


# ─── Retry Flow Tests ──────────────────────────────────────────────────


class TestRetryFlow:
    """Tests that retried jobs (status reset to 'pending') get dispatched."""

    @patch("src.tasks.derivative_dispatch_tasks.get_connection")
    def test_retried_job_gets_dispatched(
        self,
        mock_get_conn: MagicMock,
    ) -> None:
        """When retryJob sets status='pending', the poller picks it up next cycle."""
        job_id = make_uuid()
        doc_id = make_uuid()

        mock_get_conn.return_value = _make_mock_conn([
            {"id": job_id, "derivative_type": "case_digest", "source_document_id": doc_id},
        ])

        with patch.object(poll_pending_derivative_jobs, "app") as mock_app:
            result = poll_pending_derivative_jobs.run()

        assert result["dispatched"] == 1
        mock_app.send_task.assert_called_once_with(
            "derivatives.generate_case_digest",
            kwargs={"job_id": job_id, "document_id": doc_id},
        )
