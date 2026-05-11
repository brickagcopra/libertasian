"""Tests for the bar exam ALAC answer generation task (Phase 3a).

Covers:
- happy path: generates + writes row + records model_run
- idempotency: skips when an ai_generated row already exists
- 50-cap: requests over MAX_QUESTIONS_PER_DISPATCH are truncated
- not found: missing question returns question_not_found, no LLM call
- invalid JSON output: marked llm_invalid_json, no row written
- missing-fields output: marked llm_malformed, no row written
- abstain flag: marked llm_abstained, no row written
- batch resilience: one bad question doesn't stop the loop
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock, patch

from src.tasks.bar_exam_answer_tasks import (
    MAX_QUESTIONS_PER_DISPATCH,
    generate_answers_for_questions,
)

FAKE_QUESTION: dict[str, Any] = {
    "id": "q-1",
    "question_text": (
        "Atty. Cruz, a notary public, notarized a deed of sale on a Sunday "
        "without the personal appearance of one of the parties. Discuss the "
        "administrative and civil consequences."
    ),
    "sitting_id": "s-1",
    "sitting_year": 2018,
    "subject_study_code": "legal_ethics",
    "subject_bar_admin_code": "legal_ethics",
}

VALID_LLM_CONTENT = {
    "answer": (
        "Atty. Cruz may be administratively liable for notarial misconduct "
        "and civilly liable for damages to any party prejudiced by the "
        "improperly notarized instrument."
    ),
    "law": (
        "The 2004 Rules on Notarial Practice require the personal appearance "
        "of every signatory before the notary public; failure violates Rule "
        "IV, Sec. 1 and Rule II, Sec. 12."
    ),
    "analysis": (
        "Because one party was not personally present, the jurat is fatally "
        "defective. Disciplinary action and revocation of the notarial "
        "commission may follow under Rule XI, Sec. 1."
    ),
    "conclusion": (
        "Atty. Cruz is administratively liable and may be ordered to "
        "indemnify any party who relied on the defective deed."
    ),
}


def _llm_response(content: Any = VALID_LLM_CONTENT) -> dict[str, Any]:
    return {
        "content": content,
        "model_name": "gpt-4o-mini",
        "tokens_in": 1200,
        "tokens_out": 600,
    }


class TestGenerateAnswersForQuestions:
    @patch("src.tasks.bar_exam_answer_tasks.rag_client")
    @patch("src.tasks.bar_exam_answer_tasks.db")
    def test_happy_path_writes_pending_row(
        self,
        mock_db: MagicMock,
        mock_rag: MagicMock,
    ) -> None:
        mock_db.bar_exam_answer_exists.return_value = False
        mock_db.get_bar_exam_question_with_context.return_value = FAKE_QUESTION
        mock_db.create_model_run.return_value = "run-1"
        mock_db.create_bar_exam_answer.return_value = "ans-1"
        mock_rag.generate_completion.return_value = _llm_response()

        result = generate_answers_for_questions.run(["q-1"])

        assert result["generated"] == 1
        assert result["skipped_existing"] == 0
        assert result["failed"] == 0
        mock_db.create_model_run.assert_called_once()
        run_kwargs = mock_db.create_model_run.call_args.kwargs
        assert run_kwargs["run_type"] == "bar_exam_answer_generation"
        assert run_kwargs["prompt_template_version"] == "bar_exam_alac.v1"
        assert run_kwargs["model_name"] == "gpt-4o-mini"

        mock_db.create_bar_exam_answer.assert_called_once()
        write_kwargs = mock_db.create_bar_exam_answer.call_args.kwargs
        assert write_kwargs["bar_exam_question_id"] == "q-1"
        assert write_kwargs["answer_type"] == "ai_generated"
        assert write_kwargs["review_status"] == "pending"
        assert write_kwargs["visibility"] == "private"
        assert write_kwargs["model_run_id"] == "run-1"
        # answer_text must be a markdown rendering containing all 4 sections
        assert "**Answer.**" in write_kwargs["answer_text"]
        assert "**Law.**" in write_kwargs["answer_text"]
        assert "**Analysis.**" in write_kwargs["answer_text"]
        assert "**Conclusion.**" in write_kwargs["answer_text"]
        # structured_answer must be the dict-shaped form
        assert set(write_kwargs["structured_answer"].keys()) == {
            "answer",
            "law",
            "analysis",
            "conclusion",
        }

    @patch("src.tasks.bar_exam_answer_tasks.rag_client")
    @patch("src.tasks.bar_exam_answer_tasks.db")
    def test_skips_when_answer_already_exists(
        self,
        mock_db: MagicMock,
        mock_rag: MagicMock,
    ) -> None:
        mock_db.bar_exam_answer_exists.return_value = True

        result = generate_answers_for_questions.run(["q-1"])

        assert result["skipped_existing"] == 1
        assert result["generated"] == 0
        mock_rag.generate_completion.assert_not_called()
        mock_db.create_model_run.assert_not_called()
        mock_db.create_bar_exam_answer.assert_not_called()

    @patch("src.tasks.bar_exam_answer_tasks.rag_client")
    @patch("src.tasks.bar_exam_answer_tasks.db")
    def test_caps_at_max_questions_per_dispatch(
        self,
        mock_db: MagicMock,
        mock_rag: MagicMock,
    ) -> None:
        # 50 + 5 overflow — the 5 must be dropped before any LLM call.
        ids = [f"q-{i}" for i in range(MAX_QUESTIONS_PER_DISPATCH + 5)]
        mock_db.bar_exam_answer_exists.return_value = False
        mock_db.get_bar_exam_question_with_context.return_value = FAKE_QUESTION
        mock_db.create_model_run.return_value = "run-1"
        mock_db.create_bar_exam_answer.return_value = "ans-1"
        mock_rag.generate_completion.return_value = _llm_response()

        result = generate_answers_for_questions.run(ids)

        assert result["requested"] == MAX_QUESTIONS_PER_DISPATCH + 5
        assert result["capped"] == MAX_QUESTIONS_PER_DISPATCH
        assert result["generated"] == MAX_QUESTIONS_PER_DISPATCH
        # Only the first 50 questions hit the LLM.
        assert mock_rag.generate_completion.call_count == MAX_QUESTIONS_PER_DISPATCH

    @patch("src.tasks.bar_exam_answer_tasks.rag_client")
    @patch("src.tasks.bar_exam_answer_tasks.db")
    def test_question_not_found(
        self,
        mock_db: MagicMock,
        mock_rag: MagicMock,
    ) -> None:
        mock_db.bar_exam_answer_exists.return_value = False
        mock_db.get_bar_exam_question_with_context.return_value = None

        result = generate_answers_for_questions.run(["q-missing"])

        assert result["failed"] == 1
        assert result["generated"] == 0
        assert result["results"][0]["status"] == "question_not_found"
        mock_rag.generate_completion.assert_not_called()
        mock_db.create_bar_exam_answer.assert_not_called()

    @patch("src.tasks.bar_exam_answer_tasks.rag_client")
    @patch("src.tasks.bar_exam_answer_tasks.db")
    def test_invalid_json_output(
        self,
        mock_db: MagicMock,
        mock_rag: MagicMock,
    ) -> None:
        mock_db.bar_exam_answer_exists.return_value = False
        mock_db.get_bar_exam_question_with_context.return_value = FAKE_QUESTION
        mock_rag.generate_completion.return_value = _llm_response(
            content="not actually json {broken"
        )

        result = generate_answers_for_questions.run(["q-1"])

        assert result["failed"] == 1
        assert result["results"][0]["status"] == "llm_invalid_json"
        mock_db.create_bar_exam_answer.assert_not_called()
        mock_db.create_model_run.assert_not_called()

    @patch("src.tasks.bar_exam_answer_tasks.rag_client")
    @patch("src.tasks.bar_exam_answer_tasks.db")
    def test_missing_fields_marked_malformed(
        self,
        mock_db: MagicMock,
        mock_rag: MagicMock,
    ) -> None:
        # JSON parses but is missing required ALAC fields.
        mock_db.bar_exam_answer_exists.return_value = False
        mock_db.get_bar_exam_question_with_context.return_value = FAKE_QUESTION
        mock_rag.generate_completion.return_value = _llm_response(
            content={"answer": "Yes", "law": ""}  # blank law, no analysis/conclusion
        )

        result = generate_answers_for_questions.run(["q-1"])

        assert result["failed"] == 1
        assert result["results"][0]["status"] == "llm_malformed"
        mock_db.create_bar_exam_answer.assert_not_called()

    @patch("src.tasks.bar_exam_answer_tasks.rag_client")
    @patch("src.tasks.bar_exam_answer_tasks.db")
    def test_abstain_no_row(
        self,
        mock_db: MagicMock,
        mock_rag: MagicMock,
    ) -> None:
        mock_db.bar_exam_answer_exists.return_value = False
        mock_db.get_bar_exam_question_with_context.return_value = FAKE_QUESTION
        mock_rag.generate_completion.return_value = _llm_response(
            content={"abstain": True, "abstainReason": "needs appended Code"}
        )

        result = generate_answers_for_questions.run(["q-1"])

        assert result["failed"] == 1
        assert result["results"][0]["status"] == "llm_abstained"
        assert result["results"][0]["reason"] == "needs appended Code"
        mock_db.create_bar_exam_answer.assert_not_called()
        mock_db.create_model_run.assert_not_called()

    @patch("src.tasks.bar_exam_answer_tasks.rag_client")
    @patch("src.tasks.bar_exam_answer_tasks.db")
    def test_one_bad_question_does_not_kill_batch(
        self,
        mock_db: MagicMock,
        mock_rag: MagicMock,
    ) -> None:
        # First question raises mid-flight, second succeeds. The batch must
        # record both outcomes rather than aborting.
        mock_db.bar_exam_answer_exists.return_value = False
        mock_db.get_bar_exam_question_with_context.side_effect = [
            RuntimeError("db blip"),
            FAKE_QUESTION,
        ]
        mock_db.create_model_run.return_value = "run-1"
        mock_db.create_bar_exam_answer.return_value = "ans-1"
        mock_rag.generate_completion.return_value = _llm_response()

        result = generate_answers_for_questions.run(["q-1", "q-2"])

        assert result["requested"] == 2
        assert result["generated"] == 1
        assert result["failed"] == 1
        statuses = [r["status"] for r in result["results"]]
        assert statuses == ["error", "generated"]

    def test_empty_list_short_circuits(self) -> None:
        result = generate_answers_for_questions.run([])
        assert result == {
            "requested": 0,
            "skipped_existing": 0,
            "generated": 0,
            "failed": 0,
            "results": [],
        }
