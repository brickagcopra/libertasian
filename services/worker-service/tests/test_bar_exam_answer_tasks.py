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

from src.tasks import bar_exam_answer_tasks
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
        mock_rag.retrieve_passages.return_value = []
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
    @patch("src.tasks.bar_exam_answer_tasks.rag_client")
    @patch("src.tasks.bar_exam_answer_tasks.db")
    def test_force_regenerate_deletes_pending_then_writes_new_row(
        self,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        monkeypatch,
    ) -> None:
        # Toggle retrieval off so this test focuses on the regenerate path.
        monkeypatch.setattr(
            bar_exam_answer_tasks, "BAR_EXAM_RAG_ENABLED", False
        )
        # The pending row is deleted before the exists-check runs, so the
        # second branch sees an empty table.
        mock_db.delete_pending_bar_exam_answer.return_value = 1
        mock_db.bar_exam_answer_exists.return_value = False
        mock_db.get_bar_exam_question_with_context.return_value = FAKE_QUESTION
        mock_db.create_model_run.return_value = "run-2"
        mock_db.create_bar_exam_answer.return_value = "ans-2"
        mock_rag.generate_completion.return_value = _llm_response()

        result = generate_answers_for_questions.run(
            ["q-1"], force_regenerate=True
        )

        assert result["generated"] == 1
        mock_db.delete_pending_bar_exam_answer.assert_called_once()
        del_args = mock_db.delete_pending_bar_exam_answer.call_args
        assert del_args.args[0] == "q-1"
        assert del_args.kwargs.get("answer_type") == "ai_generated"
        mock_db.create_bar_exam_answer.assert_called_once()

    @patch("src.tasks.bar_exam_answer_tasks.rag_client")
    @patch("src.tasks.bar_exam_answer_tasks.db")
    def test_force_regenerate_skips_when_approved_row_blocks_delete(
        self,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        monkeypatch,
    ) -> None:
        # The DB helper restricts to review_status='pending', so for an
        # approved row it returns 0 — the existing row stays in place and
        # the exists-check skips generation. The task code itself never
        # short-circuits the delete call; the SQL clause is what protects
        # approved rows.
        monkeypatch.setattr(
            bar_exam_answer_tasks, "BAR_EXAM_RAG_ENABLED", False
        )
        mock_db.delete_pending_bar_exam_answer.return_value = 0
        mock_db.bar_exam_answer_exists.return_value = True

        result = generate_answers_for_questions.run(
            ["q-approved"], force_regenerate=True
        )

        assert result["skipped_existing"] == 1
        assert result["generated"] == 0
        # The delete was attempted, but the SQL WHERE clause meant 0 rows
        # were removed — approved rows are physically untouchable.
        mock_db.delete_pending_bar_exam_answer.assert_called_once()
        mock_rag.generate_completion.assert_not_called()
        mock_db.create_bar_exam_answer.assert_not_called()
        mock_db.create_model_run.assert_not_called()
