"""Tests for the queued/chunked bar exam answer generation job (Phase 3b).

Covers:
- chunk chaining: a chunk re-enqueues itself while queued items remain
- finalization: completed vs completed_with_failures
- cancel: a cancel mid-chunk releases the remaining claims and stops
- budget pause: a BudgetExceededError parks the job, resumable
- failure mapping: llm_* / error -> failed + error_code; v1 rows ->
  generated_ungrounded
- stale reset + terminal-status short-circuit
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock, patch

import httpx
import pytest

from src.clients.rag_client import BudgetExceededError
from src.tasks.bar_exam_answer_tasks import (
    CHUNK_SIZE,
    STALE_RUNNING_MINUTES,
    _item_outcome,
    run_answer_generation_job,
)

JOB_ID = "job-1"


def _job(
    status: str = "queued",
    total: int = 3,
    filters: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "id": JOB_ID,
        "status": status,
        "total": total,
        "only_missing": True,
        "filters_json": filters if filters is not None else {},
    }


def _items(n: int, offset: int = 0) -> list[dict[str, Any]]:
    return [
        {"id": f"item-{i + offset}", "question_id": f"q-{i + offset}", "attempts": 1}
        for i in range(n)
    ]


def _budget_error() -> BudgetExceededError:
    request = httpx.Request("POST", "http://rag/completions/generate")
    response = httpx.Response(
        503,
        request=request,
        json={
            "detail": "unavailable",
            "code": "budget_exceeded",
            "scope": "bar_exam_answer",
            "period": "daily",
        },
    )
    return BudgetExceededError(
        "LLM budget exceeded",
        request=request,
        response=response,
        scope="bar_exam_answer",
        period="daily",
    )


class TestItemOutcomeMapping:
    def test_grounded_success_carries_confidence(self) -> None:
        outcome = _item_outcome(
            {
                "question_id": "q-1",
                "status": "generated",
                "answer_id": "ans-1",
                "confidence": 0.82,
            },
        )
        assert outcome["status"] == "generated"
        assert outcome["answer_id"] == "ans-1"
        assert outcome["confidence"] == 0.82

    def test_priors_only_success_is_recorded_as_ungrounded(self) -> None:
        # confidence None == the v1 path: no retrieval, nothing scored. It is
        # a success, but not the same success.
        outcome = _item_outcome(
            {
                "question_id": "q-1",
                "status": "generated",
                "answer_id": "ans-1",
                "confidence": None,
            },
        )
        assert outcome["status"] == "generated_ungrounded"

    @pytest.mark.parametrize(
        "status",
        [
            "llm_invalid_json",
            "llm_malformed",
            "llm_abstained",
            "question_not_found",
            "error",
        ],
    )
    def test_failures_keep_their_code(self, status: str) -> None:
        outcome = _item_outcome({"question_id": "q-1", "status": status})
        assert outcome["status"] == "failed"
        assert outcome["error_code"] == status

    def test_error_message_is_truncated_to_500_chars(self) -> None:
        outcome = _item_outcome(
            {"question_id": "q-1", "status": "error", "error": "x" * 900},
        )
        assert len(outcome["error_message"]) == 500

    def test_skipped_existing_is_not_a_failure(self) -> None:
        assert _item_outcome({"status": "skipped_existing"})["status"] == (
            "skipped_existing"
        )

    def test_kept_existing_is_its_own_terminal_status_not_a_failure(self) -> None:
        """A regeneration ran and lost to the answer already on the row.

        Nothing needs retrying, so it is not `failed`; no new answer was
        written, so it is not `generated` either. The recorded answer_id and
        confidence are the KEPT row's, so the item keeps describing the answer
        that actually exists.
        """
        outcome = _item_outcome(
            {
                "question_id": "q-1",
                "status": "kept_existing",
                "reason": "new_confidence_lower",
                "answer_id": "ans-1",
                "confidence": 0.2,
                "existing_confidence": 0.8,
            },
        )
        assert outcome["status"] == "kept_existing"
        assert outcome["answer_id"] == "ans-1"
        assert outcome["confidence"] == 0.8
        assert "error_code" not in outcome

    def test_unknown_status_is_recorded_not_swallowed(self) -> None:
        outcome = _item_outcome({"status": "something_new"})
        assert outcome["status"] == "failed"
        assert outcome["error_code"] == "unknown_status"


class TestRunAnswerGenerationJob:
    @patch("src.tasks.bar_exam_answer_tasks._generate_one")
    @patch("src.tasks.bar_exam_answer_tasks.db")
    def test_missing_job_is_a_noop(
        self,
        mock_db: MagicMock,
        mock_generate: MagicMock,
    ) -> None:
        mock_db.get_bar_exam_generation_job.return_value = None

        result = run_answer_generation_job.run(JOB_ID)

        assert result["status"] == "job_not_found"
        mock_generate.assert_not_called()
        mock_db.claim_bar_exam_generation_items.assert_not_called()

    @patch("src.tasks.bar_exam_answer_tasks._generate_one")
    @patch("src.tasks.bar_exam_answer_tasks.db")
    def test_terminal_job_claims_nothing(
        self,
        mock_db: MagicMock,
        mock_generate: MagicMock,
    ) -> None:
        mock_db.BAR_EXAM_JOB_TERMINAL_STATUSES = frozenset(
            {"completed", "completed_with_failures", "cancelled"},
        )
        mock_db.get_bar_exam_generation_job.return_value = _job(status="cancelled")

        result = run_answer_generation_job.run(JOB_ID)

        assert result["status"] == "cancelled"
        assert result["processed"] == 0
        mock_db.claim_bar_exam_generation_items.assert_not_called()
        mock_generate.assert_not_called()

    @patch("src.tasks.bar_exam_answer_tasks.run_answer_generation_job.apply_async")
    @patch("src.tasks.bar_exam_answer_tasks._generate_one")
    @patch("src.tasks.bar_exam_answer_tasks.db")
    def test_chunk_chains_itself_while_queued_items_remain(
        self,
        mock_db: MagicMock,
        mock_generate: MagicMock,
        mock_apply_async: MagicMock,
    ) -> None:
        mock_db.BAR_EXAM_JOB_TERMINAL_STATUSES = frozenset({"completed"})
        mock_db.get_bar_exam_generation_job.return_value = _job(total=40)
        mock_db.get_bar_exam_generation_job_status.return_value = "running"
        mock_db.claim_bar_exam_generation_items.return_value = _items(CHUNK_SIZE)
        mock_db.count_bar_exam_generation_items_by_status.return_value = {
            "queued": 20,
            "generated": 20,
        }
        mock_generate.return_value = {
            "status": "generated",
            "answer_id": "ans",
            "confidence": 0.8,
        }

        result = run_answer_generation_job.run(JOB_ID)

        # Exactly one chunk of work, then a re-enqueue — never the whole job
        # in one task (Redis would redeliver it after visibility_timeout).
        assert mock_generate.call_count == CHUNK_SIZE
        assert result["processed"] == CHUNK_SIZE
        assert result["remaining"] == 20
        mock_apply_async.assert_called_once_with(kwargs={"job_id": JOB_ID})
        mock_db.set_bar_exam_generation_job_status.assert_not_called()
        mock_db.claim_bar_exam_generation_items.assert_called_once_with(
            JOB_ID,
            CHUNK_SIZE,
        )
        mock_db.reset_stale_bar_exam_generation_items.assert_called_once_with(
            JOB_ID,
            STALE_RUNNING_MINUTES,
        )

    @patch("src.tasks.bar_exam_answer_tasks.run_answer_generation_job.apply_async")
    @patch("src.tasks.bar_exam_answer_tasks._generate_one")
    @patch("src.tasks.bar_exam_answer_tasks.db")
    def test_last_chunk_finalizes_completed(
        self,
        mock_db: MagicMock,
        mock_generate: MagicMock,
        mock_apply_async: MagicMock,
    ) -> None:
        mock_db.BAR_EXAM_JOB_TERMINAL_STATUSES = frozenset({"completed"})
        mock_db.get_bar_exam_generation_job.return_value = _job(total=2)
        mock_db.get_bar_exam_generation_job_status.return_value = "running"
        mock_db.claim_bar_exam_generation_items.return_value = _items(2)
        mock_db.count_bar_exam_generation_items_by_status.return_value = {
            "generated": 2,
        }
        mock_generate.return_value = {
            "status": "generated",
            "answer_id": "ans",
            "confidence": 0.8,
        }

        result = run_answer_generation_job.run(JOB_ID)

        assert result["status"] == "completed"
        mock_apply_async.assert_not_called()
        mock_db.set_bar_exam_generation_job_status.assert_called_once_with(
            JOB_ID,
            "completed",
            finished=True,
        )

    @patch("src.tasks.bar_exam_answer_tasks.run_answer_generation_job.apply_async")
    @patch("src.tasks.bar_exam_answer_tasks._generate_one")
    @patch("src.tasks.bar_exam_answer_tasks.db")
    def test_failures_are_mapped_and_job_completes_with_failures(
        self,
        mock_db: MagicMock,
        mock_generate: MagicMock,
        mock_apply_async: MagicMock,
    ) -> None:
        mock_db.BAR_EXAM_JOB_TERMINAL_STATUSES = frozenset({"completed"})
        mock_db.get_bar_exam_generation_job.return_value = _job(total=3)
        mock_db.get_bar_exam_generation_job_status.return_value = "running"
        mock_db.claim_bar_exam_generation_items.return_value = _items(3)
        mock_db.count_bar_exam_generation_items_by_status.return_value = {
            "generated": 1,
            "generated_ungrounded": 1,
            "failed": 1,
        }
        mock_generate.side_effect = [
            {"status": "generated", "answer_id": "a1", "confidence": 0.9},
            {"status": "generated", "answer_id": "a2", "confidence": None},
            {"status": "llm_abstained", "reason": "insufficient sources"},
        ]

        result = run_answer_generation_job.run(JOB_ID)

        statuses = [
            call.kwargs["status"]
            for call in mock_db.finish_bar_exam_generation_item.call_args_list
        ]
        assert statuses == ["generated", "generated_ungrounded", "failed"]

        failed_call = mock_db.finish_bar_exam_generation_item.call_args_list[2]
        assert failed_call.kwargs["error_code"] == "llm_abstained"
        assert failed_call.kwargs["error_message"] == "insufficient sources"

        assert result["status"] == "completed_with_failures"
        mock_db.set_bar_exam_generation_job_status.assert_called_once_with(
            JOB_ID,
            "completed_with_failures",
            finished=True,
        )
        mock_apply_async.assert_not_called()

    @patch("src.tasks.bar_exam_answer_tasks.run_answer_generation_job.apply_async")
    @patch("src.tasks.bar_exam_answer_tasks._generate_one")
    @patch("src.tasks.bar_exam_answer_tasks.db")
    def test_cancel_mid_chunk_stops_and_releases_claims(
        self,
        mock_db: MagicMock,
        mock_generate: MagicMock,
        mock_apply_async: MagicMock,
    ) -> None:
        mock_db.BAR_EXAM_JOB_TERMINAL_STATUSES = frozenset({"completed"})
        mock_db.get_bar_exam_generation_job.return_value = _job(total=5)
        mock_db.claim_bar_exam_generation_items.return_value = _items(5)
        # Running for the first item, cancelled by the second.
        mock_db.get_bar_exam_generation_job_status.side_effect = [
            "running",
            "cancelled",
        ]
        mock_db.count_bar_exam_generation_items_by_status.return_value = {}
        mock_generate.return_value = {
            "status": "generated",
            "answer_id": "a1",
            "confidence": 0.9,
        }

        result = run_answer_generation_job.run(JOB_ID)

        assert result["status"] == "cancelled"
        assert result["processed"] == 1
        # Only one question reached the LLM after the cancel landed.
        assert mock_generate.call_count == 1
        # The four still-claimed items go back to queued, not to failed.
        released = mock_db.release_bar_exam_generation_items.call_args[0][0]
        assert released == ["item-1", "item-2", "item-3", "item-4"]
        mock_apply_async.assert_not_called()

    @patch("src.tasks.bar_exam_answer_tasks.run_answer_generation_job.apply_async")
    @patch("src.tasks.bar_exam_answer_tasks._generate_one")
    @patch("src.tasks.bar_exam_answer_tasks.db")
    def test_budget_exceeded_pauses_the_job_without_failing_items(
        self,
        mock_db: MagicMock,
        mock_generate: MagicMock,
        mock_apply_async: MagicMock,
    ) -> None:
        mock_db.BAR_EXAM_JOB_TERMINAL_STATUSES = frozenset({"completed"})
        mock_db.get_bar_exam_generation_job.return_value = _job(total=5)
        mock_db.get_bar_exam_generation_job_status.return_value = "running"
        mock_db.claim_bar_exam_generation_items.return_value = _items(5)
        mock_db.count_bar_exam_generation_items_by_status.return_value = {}
        mock_generate.side_effect = [
            {"status": "generated", "answer_id": "a1", "confidence": 0.9},
            _budget_error(),
        ]

        result = run_answer_generation_job.run(JOB_ID)

        assert result["status"] == "paused_budget"
        assert result["processed"] == 1
        mock_db.set_bar_exam_generation_job_status.assert_called_once_with(
            JOB_ID,
            "paused_budget",
        )
        # The un-run items are queued again — a resumed job picks them up. No
        # item is marked failed for a cost stop.
        released = mock_db.release_bar_exam_generation_items.call_args[0][0]
        assert released == ["item-1", "item-2", "item-3", "item-4"]
        finished_statuses = [
            call.kwargs["status"]
            for call in mock_db.finish_bar_exam_generation_item.call_args_list
        ]
        assert finished_statuses == ["generated"]
        # And the chain stops: nothing re-enqueues into an exhausted budget.
        mock_apply_async.assert_not_called()

    @patch("src.tasks.bar_exam_answer_tasks.run_answer_generation_job.apply_async")
    @patch("src.tasks.bar_exam_answer_tasks._generate_one")
    @patch("src.tasks.bar_exam_answer_tasks.db")
    def test_regenerate_pending_is_read_off_the_job_row(
        self,
        mock_db: MagicMock,
        mock_generate: MagicMock,
        mock_apply_async: MagicMock,
    ) -> None:
        """The flag lives in filters_json, not on every item.

        `_generate_one`'s delete is restricted to review_status='pending', so
        an approved or rejected answer survives force_regenerate whatever the
        job row says — but the worker still has to ASK for it, or a
        regenerate job silently skips every question that already has one.
        """
        mock_db.BAR_EXAM_JOB_TERMINAL_STATUSES = frozenset({"completed"})
        mock_db.get_bar_exam_generation_job.return_value = _job(
            total=1,
            filters={"regeneratePending": True, "maxConfidence": 0.7},
        )
        mock_db.get_bar_exam_generation_job_status.return_value = "running"
        mock_db.claim_bar_exam_generation_items.return_value = _items(1)
        mock_db.count_bar_exam_generation_items_by_status.return_value = {
            "generated": 1,
        }
        mock_generate.return_value = {
            "status": "generated",
            "answer_id": "a1",
            "confidence": 0.9,
        }

        run_answer_generation_job.run(JOB_ID)

        assert mock_generate.call_args.kwargs["force_regenerate"] is True

    @patch("src.tasks.bar_exam_answer_tasks.run_answer_generation_job.apply_async")
    @patch("src.tasks.bar_exam_answer_tasks._generate_one")
    @patch("src.tasks.bar_exam_answer_tasks.db")
    def test_an_ordinary_job_never_forces_regeneration(
        self,
        mock_db: MagicMock,
        mock_generate: MagicMock,
        mock_apply_async: MagicMock,
    ) -> None:
        mock_db.BAR_EXAM_JOB_TERMINAL_STATUSES = frozenset({"completed"})
        mock_db.get_bar_exam_generation_job.return_value = _job(total=1)
        mock_db.get_bar_exam_generation_job_status.return_value = "running"
        mock_db.claim_bar_exam_generation_items.return_value = _items(1)
        mock_db.count_bar_exam_generation_items_by_status.return_value = {
            "generated": 1,
        }
        mock_generate.return_value = {
            "status": "generated",
            "answer_id": "a1",
            "confidence": 0.9,
        }

        run_answer_generation_job.run(JOB_ID)

        assert mock_generate.call_args.kwargs["force_regenerate"] is False

    @patch("src.tasks.bar_exam_answer_tasks.run_answer_generation_job.apply_async")
    @patch("src.tasks.bar_exam_answer_tasks._generate_one")
    @patch("src.tasks.bar_exam_answer_tasks.db")
    def test_empty_claim_finalizes_the_job(
        self,
        mock_db: MagicMock,
        mock_generate: MagicMock,
        mock_apply_async: MagicMock,
    ) -> None:
        mock_db.BAR_EXAM_JOB_TERMINAL_STATUSES = frozenset({"completed"})
        mock_db.get_bar_exam_generation_job.return_value = _job(total=1)
        mock_db.claim_bar_exam_generation_items.return_value = []
        mock_db.count_bar_exam_generation_items_by_status.return_value = {
            "generated": 1,
        }

        result = run_answer_generation_job.run(JOB_ID)

        assert result["status"] == "completed"
        assert result["processed"] == 0
        mock_generate.assert_not_called()
        mock_apply_async.assert_not_called()
