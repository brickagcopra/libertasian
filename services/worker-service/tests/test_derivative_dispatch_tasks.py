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

from src.tasks.derivative_dispatch_tasks import _TASK_ROUTING, poll_pending_derivative_jobs


# ─── API ↔ worker contract ─────────────────────────────────────────────
#
# Source of truth for the set of admin-enqueueable derivative types:
#   apps/api/src/modules/derivatives-admin/derivatives-admin.service.ts
# Keep this list in sync manually (no shared enum across TS/Python yet).
# The student-side read DTO (list-derivatives.query.dto.ts) is a SUPERSET
# that advertises read-only types without generator tasks; those are not
# admin-enqueueable and intentionally absent here.
_ADMIN_ENQUEUEABLE_TYPES = {
    "case_digest",
    "doctrine_extract",
    "mcq_question",
    "essay_prompt",
    "flashcard",
    "subject_outline",
}


@pytest.mark.parametrize("derivative_type", sorted(_ADMIN_ENQUEUEABLE_TYPES))
def test_every_admin_enqueueable_type_is_routable(derivative_type: str) -> None:
    """Every admin-enqueueable derivative_type must have a routing entry,
    otherwise the poller silently fails jobs with {'message': '<type>'}.
    """
    assert derivative_type in _TASK_ROUTING, (
        f"Derivative type '{derivative_type}' is admin-enqueueable but not "
        f"mapped in _TASK_ROUTING. Add a routing entry in "
        f"derivative_dispatch_tasks.py, or remove it from the admin DTO."
    )


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
            "mcq_question": "derivatives.generate_mcq",
            "essay_prompt": "derivatives.generate_essay_prompt",
            "flashcard": "derivatives.generate_flashcards",
            "subject_outline": "derivatives.generate_subject_outline",
            "doctrine_extract": "derivatives.generate_doctrine_extract",
        }

        rows = []
        for dtype in types_to_tasks:
            # subject_outline dispatches via subject_code (not document_id)
            # since 2026-04-22; all other types dispatch via document_id.
            if dtype == "subject_outline":
                rows.append({
                    "id": make_uuid(),
                    "derivative_type": dtype,
                    "source_document_id": None,
                    "subject_code": "criminal_law",
                })
            else:
                rows.append({
                    "id": make_uuid(),
                    "derivative_type": dtype,
                    "source_document_id": make_uuid(),
                    "subject_code": None,
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

    # ----- subject-level outline dispatch (2026-04-22) -----

    @patch("src.tasks.derivative_dispatch_tasks.get_connection")
    def test_outline_dispatches_with_subject_code_kwarg(
        self,
        mock_get_conn: MagicMock,
    ) -> None:
        """Outline rows dispatch via subject_code, not document_id.

        Per-doc outline violates the validator's ≥3 sections + ≥2 cited
        docs invariant (190/206 failures on 2026-04-22). Outline rows
        carry source_document_id=NULL + subject_code=<code> and must be
        dispatched with subject_code=... kwarg.
        """
        job_id = make_uuid()
        mock_get_conn.return_value = _make_mock_conn([
            {
                "id": job_id,
                "derivative_type": "subject_outline",
                "source_document_id": None,
                "subject_code": "criminal_law",
            },
        ])

        with patch.object(poll_pending_derivative_jobs, "app") as mock_app:
            result = poll_pending_derivative_jobs.run()

        assert result["dispatched"] == 1
        assert result["skipped"] == 0
        mock_app.send_task.assert_called_once_with(
            "derivatives.generate_subject_outline",
            kwargs={"job_id": job_id, "subject_code": "criminal_law"},
        )

    @patch("src.tasks.derivative_dispatch_tasks._fail_unknown_type")
    @patch("src.tasks.derivative_dispatch_tasks.get_connection")
    def test_outline_without_subject_code_fails_fast(
        self,
        mock_get_conn: MagicMock,
        mock_fail: MagicMock,
    ) -> None:
        """Outline row missing subject_code is marked failed — not dispatched."""
        job_id = make_uuid()
        mock_get_conn.return_value = _make_mock_conn([
            {
                "id": job_id,
                "derivative_type": "subject_outline",
                "source_document_id": None,
                "subject_code": None,
            },
        ])

        with patch.object(poll_pending_derivative_jobs, "app") as mock_app:
            result = poll_pending_derivative_jobs.run()

        assert result["dispatched"] == 0
        assert result["skipped"] == 1
        mock_app.send_task.assert_not_called()
        mock_fail.assert_called_once()
        # Error reason names the missing field for operator debugging
        assert "subject_code" in mock_fail.call_args.args[1]

    @patch("src.tasks.derivative_dispatch_tasks.get_connection")
    def test_select_query_returns_subject_code(
        self,
        mock_get_conn: MagicMock,
    ) -> None:
        """The SELECT RETURNING clause must include subject_code.

        Guards against regressing the schema wiring — without this column
        in the SELECT, outline jobs would silently dispatch without a
        subject and fail downstream.
        """
        mock_conn = _make_mock_conn([])
        mock_get_conn.return_value = mock_conn

        poll_pending_derivative_jobs.run()

        mock_cursor = mock_conn.cursor.return_value.__enter__.return_value
        executed_sql = mock_cursor.execute.call_args[0][0]
        assert "subject_code" in executed_sql

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
