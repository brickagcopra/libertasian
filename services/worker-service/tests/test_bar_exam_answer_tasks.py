"""Tests for the bar exam ALAC answer generation task (Phase 3a).

Covers:
- happy path: generates + writes row + records model_run
- idempotency: skips when an ai_generated row already exists
- no cap: every requested question is generated (the old 50-cap is gone)
- not found: missing question returns question_not_found, no LLM call
- invalid JSON output: marked llm_invalid_json, no row written
- missing-fields output: marked llm_malformed, no row written
- abstain flag: marked llm_abstained, no row written
- batch resilience: one bad question doesn't stop the loop
- force_regenerate: replaces a pending row in place only when the new
  answer scores at least as well; every other outcome keeps the old row
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from src.tasks import bar_exam_answer_tasks
from src.tasks.bar_exam_answer_tasks import (
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
        mock_rag.retrieve_passages.return_value = []
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

    @patch("src.tasks.bar_exam_answer_tasks.nestjs_client")
    @patch("src.tasks.bar_exam_answer_tasks.rag_client")
    @patch("src.tasks.bar_exam_answer_tasks.db")
    def test_budget_scope_and_ledger_row(
        self,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        """Bar-exam answers wrote no ledger row at all.

        They persist straight to Postgres with no artifact write to attach
        the entry to, so the spend existed only in Redis.
        """
        mock_db.bar_exam_answer_exists.return_value = False
        mock_db.get_bar_exam_question_with_context.return_value = FAKE_QUESTION
        mock_db.create_model_run.return_value = "run-1"
        mock_db.create_bar_exam_answer.return_value = "ans-1"
        mock_rag.retrieve_passages.return_value = []
        mock_rag.generate_completion.return_value = _llm_response()

        generate_answers_for_questions.run(["q-1"])

        assert mock_rag.generate_completion.call_args.kwargs["scope"] == (
            "bar_exam_answer"
        )
        mock_nestjs.write_budget_ledger.assert_called_once()
        entry = mock_nestjs.write_budget_ledger.call_args.args[0]
        assert entry["scope"] == "bar_exam_answer"
        assert entry["tokensIn"] == 1200
        assert entry["tokensOut"] == 600
        assert entry["modelRunId"] == "run-1"
        assert entry["periodDay"].startswith(entry["periodYearMonth"])

    @patch("src.tasks.bar_exam_answer_tasks.nestjs_client")
    @patch("src.tasks.bar_exam_answer_tasks.rag_client")
    @patch("src.tasks.bar_exam_answer_tasks.db")
    def test_ledger_failure_does_not_lose_the_answer(
        self,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        mock_db.bar_exam_answer_exists.return_value = False
        mock_db.get_bar_exam_question_with_context.return_value = FAKE_QUESTION
        mock_db.create_model_run.return_value = "run-1"
        mock_db.create_bar_exam_answer.return_value = "ans-1"
        mock_rag.retrieve_passages.return_value = []
        mock_rag.generate_completion.return_value = _llm_response()
        mock_nestjs.write_budget_ledger.side_effect = RuntimeError("api down")

        result = generate_answers_for_questions.run(["q-1"])

        assert result["generated"] == 1
        assert result["failed"] == 0

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
    def test_generates_every_requested_question_without_a_cap(
        self,
        mock_db: MagicMock,
        mock_rag: MagicMock,
    ) -> None:
        # The old 50-cap silently dropped the tail of a request, which is how
        # re-dispatching a filter kept re-picking the same already-answered
        # first 50. 55 in, 55 generated.
        ids = [f"q-{i}" for i in range(55)]
        mock_db.bar_exam_answer_exists.return_value = False
        mock_db.get_bar_exam_question_with_context.return_value = FAKE_QUESTION
        mock_db.create_model_run.return_value = "run-1"
        mock_db.create_bar_exam_answer.return_value = "ans-1"
        mock_rag.retrieve_passages.return_value = []
        mock_rag.generate_completion.return_value = _llm_response()

        result = generate_answers_for_questions.run(ids)

        assert result["requested"] == 55
        assert result["generated"] == 55
        assert "capped" not in result
        assert mock_rag.generate_completion.call_count == 55

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
        mock_rag.retrieve_passages.return_value = []
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
        mock_rag.retrieve_passages.return_value = []
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
        mock_rag.retrieve_passages.return_value = []
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
        mock_rag.retrieve_passages.return_value = []
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
            "kept_existing": 0,
            "generated": 0,
            "failed": 0,
            "results": [],
        }


# Section ids are what v2 asks the model to cite and what the filter checks
# against, so the fixture carries the shape rag_client actually returns now:
# section_id and document_id preserved, not flattened away.
SEC_1 = "aaaaaaaa-0000-4000-8000-000000000001"
SEC_2 = "bbbbbbbb-0000-4000-8000-000000000001"
DOC_1 = "11111111-1111-4111-8111-111111111111"
DOC_2 = "22222222-2222-4222-8222-222222222222"
FABRICATED_SECTION = "00000000-dead-4000-8000-000000000bad"

SAMPLE_PASSAGES = [
    {
        "id": "p-1",
        "section_id": SEC_1,
        "document_id": DOC_1,
        "title": "Rule on Notarial Practice",
        "text": "Personal appearance is required for valid notarization.",
        "score": 412.0,
    },
    {
        "id": "p-2",
        "section_id": SEC_2,
        "document_id": DOC_2,
        "title": "Civil Code, Art. 1316",
        "text": "Sale requires consent of contracting parties.",
        "score": 288.5,
    },
]


class TestRagRetrieval:
    @patch("src.tasks.bar_exam_answer_tasks.rag_client")
    @patch("src.tasks.bar_exam_answer_tasks.db")
    def test_rag_disabled_never_calls_retrieve_and_stamps_v1(
        self,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        monkeypatch,
    ) -> None:
        monkeypatch.setattr(
            bar_exam_answer_tasks, "BAR_EXAM_RAG_ENABLED", False
        )
        mock_db.bar_exam_answer_exists.return_value = False
        mock_db.get_bar_exam_question_with_context.return_value = FAKE_QUESTION
        mock_db.create_model_run.return_value = "run-1"
        mock_db.create_bar_exam_answer.return_value = "ans-1"
        mock_rag.generate_completion.return_value = _llm_response()

        result = generate_answers_for_questions.run(["q-1"])

        assert result["generated"] == 1
        mock_rag.retrieve_passages.assert_not_called()
        run_kwargs = mock_db.create_model_run.call_args.kwargs
        assert run_kwargs["prompt_template_version"] == "bar_exam_alac.v1"

    @patch("src.tasks.bar_exam_answer_tasks.rag_client")
    @patch("src.tasks.bar_exam_answer_tasks.db")
    def test_rag_enabled_with_passages_uses_v2_and_includes_them(
        self,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        monkeypatch,
    ) -> None:
        monkeypatch.setattr(bar_exam_answer_tasks, "BAR_EXAM_RAG_ENABLED", True)
        mock_db.bar_exam_answer_exists.return_value = False
        mock_db.get_bar_exam_question_with_context.return_value = FAKE_QUESTION
        mock_db.create_model_run.return_value = "run-1"
        mock_db.create_bar_exam_answer.return_value = "ans-1"
        mock_rag.retrieve_passages.return_value = SAMPLE_PASSAGES
        mock_rag.generate_completion.return_value = _llm_response()

        result = generate_answers_for_questions.run(["q-1"])

        assert result["generated"] == 1
        mock_rag.retrieve_passages.assert_called_once()
        retr_kwargs = mock_rag.retrieve_passages.call_args.kwargs
        assert retr_kwargs["question_id"] == "q-1"
        assert retr_kwargs["query"] == FAKE_QUESTION["question_text"]

        # The prompt must label passages with the SECTION id, not the
        # OpenSearch hit id: the hit id is what v1 printed, and a model citing
        # it faithfully produced an id that resolves against nothing.
        comp_kwargs = mock_rag.generate_completion.call_args.kwargs
        user_prompt = comp_kwargs["user_prompt"]
        assert f"[{SEC_1}]" in user_prompt
        assert f"[{SEC_2}]" in user_prompt
        assert "SOURCE PASSAGES" in user_prompt
        assert "CITABLE SECTION IDS" in user_prompt

        run_kwargs = mock_db.create_model_run.call_args.kwargs
        assert run_kwargs["prompt_template_version"] == "bar_exam_alac.v2"

    @patch("src.tasks.bar_exam_answer_tasks.rag_client")
    @patch("src.tasks.bar_exam_answer_tasks.db")
    def test_rag_retrieve_raises_falls_through_to_v1(
        self,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        monkeypatch,
    ) -> None:
        monkeypatch.setattr(bar_exam_answer_tasks, "BAR_EXAM_RAG_ENABLED", True)
        mock_db.bar_exam_answer_exists.return_value = False
        mock_db.get_bar_exam_question_with_context.return_value = FAKE_QUESTION
        mock_db.create_model_run.return_value = "run-1"
        mock_db.create_bar_exam_answer.return_value = "ans-1"
        mock_rag.retrieve_passages.side_effect = RuntimeError("opensearch down")
        mock_rag.generate_completion.return_value = _llm_response()

        result = generate_answers_for_questions.run(["q-1"])

        # Retrieval failure does NOT fail the task; we fall through to priors.
        assert result["generated"] == 1
        assert result["failed"] == 0
        run_kwargs = mock_db.create_model_run.call_args.kwargs
        assert run_kwargs["prompt_template_version"] == "bar_exam_alac.v1"
        # User prompt must NOT include SOURCE PASSAGES when retrieval failed.
        comp_kwargs = mock_rag.generate_completion.call_args.kwargs
        assert "SOURCE PASSAGES" not in comp_kwargs["user_prompt"]


class TestCitationFilteringAndScoring:
    """The grounded path: filter before the write, then score what survived.

    ``db.resolve_section_ids`` is the corpus check — it returns
    ``{section_id: document_id}`` for ids that exist. Mocking it lets these
    tests state exactly which ids the corpus backs.
    """

    def _setup(self, mock_db: MagicMock, mock_rag: MagicMock, cited, resolved):
        mock_db.bar_exam_answer_exists.return_value = False
        mock_db.get_bar_exam_question_with_context.return_value = FAKE_QUESTION
        mock_db.create_model_run.return_value = "run-1"
        mock_db.create_bar_exam_answer.return_value = "ans-1"
        mock_db.resolve_section_ids.return_value = resolved
        mock_rag.retrieve_passages.return_value = SAMPLE_PASSAGES
        mock_rag.generate_completion.return_value = _llm_response(
            {**VALID_LLM_CONTENT, "citedSectionIds": cited}
        )

    @patch("src.tasks.bar_exam_answer_tasks.rag_client")
    @patch("src.tasks.bar_exam_answer_tasks.db")
    def test_fabricated_id_never_reaches_the_write(
        self, mock_db: MagicMock, mock_rag: MagicMock, monkeypatch
    ) -> None:
        monkeypatch.setattr(bar_exam_answer_tasks, "BAR_EXAM_RAG_ENABLED", True)
        self._setup(
            mock_db,
            mock_rag,
            cited=[SEC_1, FABRICATED_SECTION],
            resolved={SEC_1: DOC_1},
        )

        result = generate_answers_for_questions.run(["q-1"])

        assert result["generated"] == 1
        written = mock_db.create_bar_exam_answer.call_args.kwargs
        assert written["structured_answer"]["citedSectionIds"] == [SEC_1]
        assert result["results"][0]["dropped_section_ids"] == 1

    @patch("src.tasks.bar_exam_answer_tasks.rag_client")
    @patch("src.tasks.bar_exam_answer_tasks.db")
    def test_id_not_in_the_retrieved_set_is_never_even_resolved(
        self, mock_db: MagicMock, mock_rag: MagicMock, monkeypatch
    ) -> None:
        """Two checks, and the retrieved-set one runs first.

        An id the model was never shown is dropped without asking the
        database about it — it cannot be a legitimate citation regardless of
        whether some row somewhere happens to carry that UUID.
        """
        monkeypatch.setattr(bar_exam_answer_tasks, "BAR_EXAM_RAG_ENABLED", True)
        outsider = "99999999-9999-4999-8999-999999999999"
        self._setup(mock_db, mock_rag, cited=[outsider], resolved={})

        generate_answers_for_questions.run(["q-1"])

        asked = mock_db.resolve_section_ids.call_args.args[0]
        assert outsider not in asked
        written = mock_db.create_bar_exam_answer.call_args.kwargs
        assert written["structured_answer"]["citedSectionIds"] == []

    @patch("src.tasks.bar_exam_answer_tasks.rag_client")
    @patch("src.tasks.bar_exam_answer_tasks.db")
    def test_confidence_is_persisted_to_both_tables(
        self, mock_db: MagicMock, mock_rag: MagicMock, monkeypatch
    ) -> None:
        monkeypatch.setattr(bar_exam_answer_tasks, "BAR_EXAM_RAG_ENABLED", True)
        self._setup(
            mock_db,
            mock_rag,
            cited=[SEC_1, SEC_2],
            resolved={SEC_1: DOC_1, SEC_2: DOC_2},
        )

        generate_answers_for_questions.run(["q-1"])

        run_confidence = mock_db.create_model_run.call_args.kwargs["confidence"]
        answer_confidence = mock_db.create_bar_exam_answer.call_args.kwargs["confidence"]
        # 2 valid of 2 emitted across 2 of 2 available documents.
        assert run_confidence == 1.0
        assert answer_confidence == run_confidence

    @patch("src.tasks.bar_exam_answer_tasks.rag_client")
    @patch("src.tasks.bar_exam_answer_tasks.db")
    def test_grounding_counts_are_persisted_for_the_denominator_breakout(
        self, mock_db: MagicMock, mock_rag: MagicMock, monkeypatch
    ) -> None:
        """Without these counts the denominator is unrecoverable after the fact.

        Reconstructing it from surviving citations yields a LOWER bound, which
        would sort rows into the wrong bucket and hide the adaptive-bar effect
        the breakout exists to show.
        """
        monkeypatch.setattr(bar_exam_answer_tasks, "BAR_EXAM_RAG_ENABLED", True)
        self._setup(
            mock_db,
            mock_rag,
            cited=[SEC_1, FABRICATED_SECTION],
            resolved={SEC_1: DOC_1},
        )

        generate_answers_for_questions.run(["q-1"])

        written = mock_db.create_bar_exam_answer.call_args.kwargs
        grounding = written["structured_answer"]["grounding"]
        assert grounding["emittedIds"] == 2
        assert grounding["validIds"] == 1
        assert grounding["fabricatedIds"] == 1
        assert grounding["citedDocuments"] == 1
        # SAMPLE_PASSAGES spans two documents, so the denominator is 2 — the
        # answer is scored against what retrieval offered, not against 3.
        assert grounding["availableDocuments"] == 2
        assert grounding["breadthDenominator"] == 2

    @patch("src.tasks.bar_exam_answer_tasks.rag_client")
    @patch("src.tasks.bar_exam_answer_tasks.db")
    def test_grounding_block_carries_counts_only_never_retrieval_internals(
        self, mock_db: MagicMock, mock_rag: MagicMock, monkeypatch
    ) -> None:
        """It is served verbatim to the public endpoint — keep it to integers."""
        monkeypatch.setattr(bar_exam_answer_tasks, "BAR_EXAM_RAG_ENABLED", True)
        self._setup(mock_db, mock_rag, cited=[SEC_1], resolved={SEC_1: DOC_1})

        generate_answers_for_questions.run(["q-1"])

        grounding = mock_db.create_bar_exam_answer.call_args.kwargs[
            "structured_answer"
        ]["grounding"]
        assert all(isinstance(v, int) for v in grounding.values())
        serialized = str(grounding)
        assert DOC_1 not in serialized
        assert "412" not in serialized  # no BM25 scores

    @patch("src.tasks.bar_exam_answer_tasks.rag_client")
    @patch("src.tasks.bar_exam_answer_tasks.db")
    def test_priors_only_row_gets_no_grounding_block(
        self, mock_db: MagicMock, mock_rag: MagicMock, monkeypatch
    ) -> None:
        """No denominator existed, so none is claimed."""
        monkeypatch.setattr(bar_exam_answer_tasks, "BAR_EXAM_RAG_ENABLED", False)
        mock_db.bar_exam_answer_exists.return_value = False
        mock_db.get_bar_exam_question_with_context.return_value = FAKE_QUESTION
        mock_db.create_model_run.return_value = "run-1"
        mock_db.create_bar_exam_answer.return_value = "ans-1"
        mock_rag.generate_completion.return_value = _llm_response()

        generate_answers_for_questions.run(["q-1"])

        written = mock_db.create_bar_exam_answer.call_args.kwargs
        assert "grounding" not in written["structured_answer"]

    @patch("src.tasks.bar_exam_answer_tasks.rag_client")
    @patch("src.tasks.bar_exam_answer_tasks.db")
    def test_answer_citing_nothing_valid_scores_zero_and_still_writes(
        self, mock_db: MagicMock, mock_rag: MagicMock, monkeypatch
    ) -> None:
        """A worthless citation list is a low score, not a dropped answer."""
        monkeypatch.setattr(bar_exam_answer_tasks, "BAR_EXAM_RAG_ENABLED", True)
        self._setup(mock_db, mock_rag, cited=[FABRICATED_SECTION], resolved={})

        result = generate_answers_for_questions.run(["q-1"])

        assert result["generated"] == 1
        assert mock_db.create_bar_exam_answer.call_args.kwargs["confidence"] == 0.0

    @patch("src.tasks.bar_exam_answer_tasks.rag_client")
    @patch("src.tasks.bar_exam_answer_tasks.db")
    def test_priors_only_row_stores_null_confidence_not_zero(
        self, mock_db: MagicMock, mock_rag: MagicMock, monkeypatch
    ) -> None:
        """NULL means 'never scored'; 0.0 means 'scored and grounded nothing'.

        PR 3's auto-approve must be able to tell those apart, so the
        distinction lives in the column rather than in a convention.
        """
        monkeypatch.setattr(bar_exam_answer_tasks, "BAR_EXAM_RAG_ENABLED", False)
        mock_db.bar_exam_answer_exists.return_value = False
        mock_db.get_bar_exam_question_with_context.return_value = FAKE_QUESTION
        mock_db.create_model_run.return_value = "run-1"
        mock_db.create_bar_exam_answer.return_value = "ans-1"
        mock_rag.generate_completion.return_value = _llm_response()

        generate_answers_for_questions.run(["q-1"])

        assert mock_db.create_model_run.call_args.kwargs["confidence"] is None
        assert mock_db.create_bar_exam_answer.call_args.kwargs["confidence"] is None

    @patch("src.tasks.bar_exam_answer_tasks.rag_client")
    @patch("src.tasks.bar_exam_answer_tasks.db")
    def test_a_v2_answer_that_cites_nothing_is_not_a_v1_answer(
        self, mock_db: MagicMock, mock_rag: MagicMock, monkeypatch
    ) -> None:
        """Retrieval succeeded, so the row records v2 and a real 0.0 score.

        The pilot report reads 'retrieval succeeded' off the prompt version,
        so this row must not disguise itself as a retrieval miss.
        """
        monkeypatch.setattr(bar_exam_answer_tasks, "BAR_EXAM_RAG_ENABLED", True)
        self._setup(mock_db, mock_rag, cited=[], resolved={})

        generate_answers_for_questions.run(["q-1"])

        run_kwargs = mock_db.create_model_run.call_args.kwargs
        assert run_kwargs["prompt_template_version"] == "bar_exam_alac.v2"
        assert run_kwargs["confidence"] == 0.0


class TestForceRegenerate:
    """Regeneration must never be able to leave a question worse off.

    The old flow deleted the pending row before generating. A prod pilot over
    42 low-scoring answers (22 better under v3, 18 equal, 1 lower, 1 outright
    failure) says ~5% of a ~500-answer regeneration run would have been lost
    or downgraded that way. So nothing is deleted: the new answer has to earn
    the row by scoring at least as well as the one already there.
    """

    def _setup_generation(
        self,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        cited: list[str] | None = None,
        resolved: dict[str, str] | None = None,
    ) -> None:
        mock_db.get_bar_exam_question_with_context.return_value = FAKE_QUESTION
        mock_db.create_model_run.return_value = "run-2"
        mock_db.create_bar_exam_answer.return_value = "ans-2"
        mock_db.replace_pending_bar_exam_answer.return_value = "ans-1"
        mock_db.resolve_section_ids.return_value = resolved or {}
        mock_rag.retrieve_passages.return_value = SAMPLE_PASSAGES
        mock_rag.generate_completion.return_value = _llm_response(
            {**VALID_LLM_CONTENT, "citedSectionIds": cited or []}
        )

    # 1. No existing row: an ordinary first generation.

    @patch("src.tasks.bar_exam_answer_tasks.rag_client")
    @patch("src.tasks.bar_exam_answer_tasks.db")
    def test_no_existing_row_inserts_exactly_as_a_normal_generation(
        self,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        monkeypatch,
    ) -> None:
        monkeypatch.setattr(bar_exam_answer_tasks, "BAR_EXAM_RAG_ENABLED", False)
        mock_db.get_bar_exam_answer_state.return_value = None
        self._setup_generation(mock_db, mock_rag)

        result = generate_answers_for_questions.run(
            ["q-1"], force_regenerate=True
        )

        assert result["generated"] == 1
        mock_db.create_bar_exam_answer.assert_called_once()
        mock_db.replace_pending_bar_exam_answer.assert_not_called()
        assert result["results"][0]["answer_id"] == "ans-2"

    # 2. A reviewed row: skipped without an LLM call.

    @pytest.mark.parametrize("review_status", ["approved", "rejected"])
    @patch("src.tasks.bar_exam_answer_tasks.rag_client")
    @patch("src.tasks.bar_exam_answer_tasks.db")
    def test_reviewed_row_is_skipped_without_spending_a_token(
        self,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        review_status: str,
        monkeypatch,
    ) -> None:
        """An editor already ruled on this answer, so regeneration is not ours
        to do — and it must not cost anything to find that out."""
        monkeypatch.setattr(bar_exam_answer_tasks, "BAR_EXAM_RAG_ENABLED", False)
        mock_db.get_bar_exam_answer_state.return_value = {
            "id": "ans-1",
            "review_status": review_status,
            "confidence": 0.3,
        }

        result = generate_answers_for_questions.run(
            ["q-approved"], force_regenerate=True
        )

        assert result["skipped_existing"] == 1
        assert result["generated"] == 0
        mock_rag.generate_completion.assert_not_called()
        mock_db.create_model_run.assert_not_called()
        mock_db.replace_pending_bar_exam_answer.assert_not_called()
        mock_db.create_bar_exam_answer.assert_not_called()

    # 3a. Generation failed or abstained: the old row is untouched.

    @patch("src.tasks.bar_exam_answer_tasks.rag_client")
    @patch("src.tasks.bar_exam_answer_tasks.db")
    def test_a_failed_regeneration_leaves_the_pending_row_alone(
        self,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        monkeypatch,
    ) -> None:
        """This is the case the old flow lost outright: the draft was already
        deleted by the time the model returned garbage."""
        monkeypatch.setattr(bar_exam_answer_tasks, "BAR_EXAM_RAG_ENABLED", False)
        mock_db.get_bar_exam_answer_state.return_value = {
            "id": "ans-1",
            "review_status": "pending",
            "confidence": 0.5,
        }
        mock_db.get_bar_exam_question_with_context.return_value = FAKE_QUESTION
        mock_rag.generate_completion.return_value = _llm_response("not json")

        result = generate_answers_for_questions.run(
            ["q-1"], force_regenerate=True
        )

        assert result["failed"] == 1
        assert result["results"][0]["status"] == "llm_invalid_json"
        mock_db.replace_pending_bar_exam_answer.assert_not_called()
        mock_db.create_bar_exam_answer.assert_not_called()

    @patch("src.tasks.bar_exam_answer_tasks.rag_client")
    @patch("src.tasks.bar_exam_answer_tasks.db")
    def test_an_abstention_leaves_the_pending_row_alone(
        self,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        monkeypatch,
    ) -> None:
        monkeypatch.setattr(bar_exam_answer_tasks, "BAR_EXAM_RAG_ENABLED", False)
        mock_db.get_bar_exam_answer_state.return_value = {
            "id": "ans-1",
            "review_status": "pending",
            "confidence": 0.5,
        }
        mock_db.get_bar_exam_question_with_context.return_value = FAKE_QUESTION
        mock_rag.generate_completion.return_value = _llm_response(
            {"abstain": True, "abstainReason": "insufficient sources"}
        )

        result = generate_answers_for_questions.run(
            ["q-1"], force_regenerate=True
        )

        assert result["results"][0]["status"] == "llm_abstained"
        mock_db.replace_pending_bar_exam_answer.assert_not_called()
        mock_db.create_bar_exam_answer.assert_not_called()

    # 3b. The new answer is ungrounded and the old one was scored.

    @patch("src.tasks.bar_exam_answer_tasks.nestjs_client")
    @patch("src.tasks.bar_exam_answer_tasks.rag_client")
    @patch("src.tasks.bar_exam_answer_tasks.db")
    def test_an_ungrounded_regeneration_never_replaces_a_scored_answer(
        self,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        mock_nestjs: MagicMock,
        monkeypatch,
    ) -> None:
        """Retrieval returned nothing, so the new answer is priors-only and
        carries NULL confidence. NULL is 'never scored', not 'scored zero' —
        it cannot compare favourably against 0.25."""
        monkeypatch.setattr(bar_exam_answer_tasks, "BAR_EXAM_RAG_ENABLED", False)
        mock_db.get_bar_exam_answer_state.return_value = {
            "id": "ans-1",
            "review_status": "pending",
            "confidence": 0.25,
        }
        self._setup_generation(mock_db, mock_rag)

        result = generate_answers_for_questions.run(
            ["q-1"], force_regenerate=True
        )

        item = result["results"][0]
        assert result["kept_existing"] == 1
        assert result["failed"] == 0
        assert item["status"] == "kept_existing"
        assert item["reason"] == "new_answer_ungrounded"
        assert item["confidence"] is None
        assert item["existing_confidence"] == 0.25
        assert item["answer_id"] == "ans-1"
        mock_db.replace_pending_bar_exam_answer.assert_not_called()
        mock_db.create_bar_exam_answer.assert_not_called()
        # The tokens were spent, so both records of the spend are still made.
        mock_db.create_model_run.assert_called_once()
        mock_nestjs.write_budget_ledger.assert_called_once()

    # 3c. The new answer scores lower.

    @patch("src.tasks.bar_exam_answer_tasks.rag_client")
    @patch("src.tasks.bar_exam_answer_tasks.db")
    def test_a_lower_scoring_regeneration_is_discarded(
        self,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        monkeypatch,
    ) -> None:
        monkeypatch.setattr(bar_exam_answer_tasks, "BAR_EXAM_RAG_ENABLED", True)
        mock_db.get_bar_exam_answer_state.return_value = {
            "id": "ans-1",
            "review_status": "pending",
            "confidence": 0.9,
        }
        # One valid citation out of one document: a real but modest score.
        self._setup_generation(
            mock_db, mock_rag, cited=[SEC_1], resolved={SEC_1: DOC_1}
        )

        result = generate_answers_for_questions.run(
            ["q-1"], force_regenerate=True
        )

        item = result["results"][0]
        assert item["status"] == "kept_existing"
        assert item["reason"] == "new_confidence_lower"
        assert item["confidence"] is not None
        assert item["confidence"] < 0.9
        assert item["existing_confidence"] == 0.9
        mock_db.replace_pending_bar_exam_answer.assert_not_called()

    # 3d. The new answer is at least as good, or the old one was unscored.

    @patch("src.tasks.bar_exam_answer_tasks.rag_client")
    @patch("src.tasks.bar_exam_answer_tasks.db")
    def test_a_better_regeneration_updates_the_row_in_place(
        self,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        monkeypatch,
    ) -> None:
        """UPDATE, not delete+insert: the unique index on (question,
        answer_type) forbids two rows, and the stable answer id is what item
        rows and audit entries already point at."""
        monkeypatch.setattr(bar_exam_answer_tasks, "BAR_EXAM_RAG_ENABLED", True)
        mock_db.get_bar_exam_answer_state.return_value = {
            "id": "ans-1",
            "review_status": "pending",
            "confidence": 0.1,
        }
        self._setup_generation(
            mock_db, mock_rag, cited=[SEC_1], resolved={SEC_1: DOC_1}
        )

        result = generate_answers_for_questions.run(
            ["q-1"], force_regenerate=True
        )

        assert result["generated"] == 1
        assert result["kept_existing"] == 0
        mock_db.create_bar_exam_answer.assert_not_called()
        mock_db.replace_pending_bar_exam_answer.assert_called_once()
        call = mock_db.replace_pending_bar_exam_answer.call_args
        assert call.args[0] == "q-1"
        assert call.kwargs["answer_type"] == "ai_generated"
        assert call.kwargs["model_run_id"] == "run-2"
        assert call.kwargs["confidence"] is not None
        assert result["results"][0]["answer_id"] == "ans-1"

    @patch("src.tasks.bar_exam_answer_tasks.rag_client")
    @patch("src.tasks.bar_exam_answer_tasks.db")
    def test_an_equal_score_still_replaces(
        self,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        monkeypatch,
    ) -> None:
        """18 of the 42 pilot questions came back exactly equal. Equal means
        'regenerated under the newer prompt at no loss', which is what the run
        is for — so it replaces."""
        monkeypatch.setattr(bar_exam_answer_tasks, "BAR_EXAM_RAG_ENABLED", True)
        # Generate once with no existing row to learn the score this fixture
        # produces, then re-run with that exact score already on the row.
        self._setup_generation(
            mock_db, mock_rag, cited=[SEC_1], resolved={SEC_1: DOC_1}
        )
        mock_db.get_bar_exam_answer_state.return_value = None
        first = generate_answers_for_questions.run(
            ["q-1"], force_regenerate=True
        )
        score = first["results"][0]["confidence"]
        assert score is not None

        mock_db.reset_mock()
        self._setup_generation(
            mock_db, mock_rag, cited=[SEC_1], resolved={SEC_1: DOC_1}
        )
        mock_db.get_bar_exam_answer_state.return_value = {
            "id": "ans-1",
            "review_status": "pending",
            "confidence": score,
        }

        result = generate_answers_for_questions.run(
            ["q-1"], force_regenerate=True
        )

        assert result["generated"] == 1
        mock_db.replace_pending_bar_exam_answer.assert_called_once()

    @patch("src.tasks.bar_exam_answer_tasks.rag_client")
    @patch("src.tasks.bar_exam_answer_tasks.db")
    def test_an_unscored_old_answer_is_always_replaceable(
        self,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        monkeypatch,
    ) -> None:
        """The old row is a v1 priors-only draft (confidence NULL). There is
        nothing to compare it against, and a scored answer is the improvement
        the run exists for — so it replaces, even at 0.0."""
        monkeypatch.setattr(bar_exam_answer_tasks, "BAR_EXAM_RAG_ENABLED", True)
        mock_db.get_bar_exam_answer_state.return_value = {
            "id": "ans-1",
            "review_status": "pending",
            "confidence": None,
        }
        self._setup_generation(mock_db, mock_rag, cited=[], resolved={})

        result = generate_answers_for_questions.run(
            ["q-1"], force_regenerate=True
        )

        assert result["generated"] == 1
        kwargs = mock_db.replace_pending_bar_exam_answer.call_args.kwargs
        assert kwargs["confidence"] == 0.0

    # 4. The zero-rows race.

    @patch("src.tasks.bar_exam_answer_tasks.nestjs_client")
    @patch("src.tasks.bar_exam_answer_tasks.rag_client")
    @patch("src.tasks.bar_exam_answer_tasks.db")
    def test_a_review_landing_mid_generation_wins(
        self,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        mock_nestjs: MagicMock,
        monkeypatch,
    ) -> None:
        """The UPDATE is restricted to review_status='pending'. An editor who
        approved or rejected the draft while the model was running makes it
        match 0 rows — their decision stands, and the run reports that rather
        than a write it did not make."""
        monkeypatch.setattr(bar_exam_answer_tasks, "BAR_EXAM_RAG_ENABLED", True)
        mock_db.get_bar_exam_answer_state.return_value = {
            "id": "ans-1",
            "review_status": "pending",
            "confidence": 0.1,
        }
        self._setup_generation(
            mock_db, mock_rag, cited=[SEC_1], resolved={SEC_1: DOC_1}
        )
        mock_db.replace_pending_bar_exam_answer.return_value = None

        result = generate_answers_for_questions.run(
            ["q-1"], force_regenerate=True
        )

        item = result["results"][0]
        assert result["kept_existing"] == 1
        assert result["generated"] == 0
        assert item["status"] == "kept_existing"
        assert item["reason"] == "reviewed_during_regeneration"
        assert item["answer_id"] == "ans-1"
        assert item["existing_confidence"] == 0.1
        mock_db.create_bar_exam_answer.assert_not_called()
        # The LLM ran, so the ledger is written on this path too.
        mock_nestjs.write_budget_ledger.assert_called_once()

    # force_regenerate=False is untouched.

    @patch("src.tasks.bar_exam_answer_tasks.rag_client")
    @patch("src.tasks.bar_exam_answer_tasks.db")
    def test_without_the_flag_an_existing_row_is_skipped_and_never_read(
        self,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        monkeypatch,
    ) -> None:
        monkeypatch.setattr(bar_exam_answer_tasks, "BAR_EXAM_RAG_ENABLED", False)
        mock_db.bar_exam_answer_exists.return_value = True

        result = generate_answers_for_questions.run(["q-1"])

        assert result["skipped_existing"] == 1
        mock_db.get_bar_exam_answer_state.assert_not_called()
        mock_db.replace_pending_bar_exam_answer.assert_not_called()
        mock_rag.generate_completion.assert_not_called()

    @patch("src.tasks.bar_exam_answer_tasks.rag_client")
    @patch("src.tasks.bar_exam_answer_tasks.db")
    def test_without_the_flag_a_missing_row_still_inserts(
        self,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        monkeypatch,
    ) -> None:
        monkeypatch.setattr(bar_exam_answer_tasks, "BAR_EXAM_RAG_ENABLED", False)
        mock_db.bar_exam_answer_exists.return_value = False
        self._setup_generation(mock_db, mock_rag)

        result = generate_answers_for_questions.run(["q-1"])

        assert result["generated"] == 1
        mock_db.create_bar_exam_answer.assert_called_once()
        mock_db.get_bar_exam_answer_state.assert_not_called()
        mock_db.replace_pending_bar_exam_answer.assert_not_called()
