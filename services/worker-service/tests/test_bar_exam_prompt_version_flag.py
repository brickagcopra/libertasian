"""Tests for BAR_EXAM_PROMPT_VERSION — which grounded template actually runs.

The flag exists so that deploying v3 changes nothing. A generation job was
running on prod when v3 landed, and a prompt swap arriving with a deploy would
have split that job's output across two templates mid-run with no record of
where the boundary was.

So the two facts these tests pin are: the default is v2, and whatever template
ran is the one written to ``model_runs.prompt_template_version`` — a stored
version that does not match the prompt that produced the row would make every
later v2-vs-v3 comparison meaningless.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock, patch

from src.tasks import bar_exam_answer_tasks
from src.tasks.bar_exam_answer_tasks import (
    _resolve_prompt_version,
    generate_answers_for_questions,
)

FAKE_QUESTION: dict[str, Any] = {
    "id": "q-1",
    "question_text": "Discuss the elements of estafa under Art. 315.",
    "sitting_id": "s-1",
    "sitting_year": 2018,
    "subject_study_code": "criminal_law",
    "subject_bar_admin_code": "criminal_law",
}

SEC_1 = "aaaaaaaa-0000-4000-8000-000000000001"
DOC_1 = "11111111-1111-4111-8111-111111111111"

PASSAGES = [
    {
        "id": "p-1",
        "section_id": SEC_1,
        "document_id": DOC_1,
        "title": "Revised Penal Code, Art. 315",
        "text": "estafa defined",
        "score": 400.0,
    },
]

LLM_CONTENT = {
    "answer": "Yes.",
    "law": "RPC Art. 315.",
    "analysis": "The elements are present.",
    "conclusion": "Estafa lies.",
    "citedSectionIds": [SEC_1],
}


def _llm_response() -> dict[str, Any]:
    return {
        "content": LLM_CONTENT,
        "model_name": "gpt-4o-mini",
        "tokens_in": 900,
        "tokens_out": 400,
    }


def _arrange(mock_db: MagicMock, mock_rag: MagicMock) -> None:
    mock_db.bar_exam_answer_exists.return_value = False
    mock_db.get_bar_exam_question_with_context.return_value = FAKE_QUESTION
    mock_db.create_model_run.return_value = "run-1"
    mock_db.create_bar_exam_answer.return_value = "ans-1"
    mock_db.resolve_section_ids.return_value = {SEC_1: DOC_1}
    mock_rag.retrieve_passages.return_value = PASSAGES
    mock_rag.generate_completion.return_value = _llm_response()


class TestResolvePromptVersion:
    def test_default_is_v2(self, monkeypatch):
        """Deploying v3 must be a no-op until someone flips the flag."""
        monkeypatch.delenv("BAR_EXAM_PROMPT_VERSION", raising=False)
        assert _resolve_prompt_version() == "v2"

    def test_v3_is_selectable(self, monkeypatch):
        monkeypatch.setenv("BAR_EXAM_PROMPT_VERSION", "v3")
        assert _resolve_prompt_version() == "v3"

    def test_case_and_whitespace_are_tolerated(self, monkeypatch):
        monkeypatch.setenv("BAR_EXAM_PROMPT_VERSION", "  V3 ")
        assert _resolve_prompt_version() == "v3"

    def test_invalid_value_warns_and_falls_back_to_v2(self, monkeypatch, caplog):
        monkeypatch.setenv("BAR_EXAM_PROMPT_VERSION", "v4")
        with caplog.at_level("WARNING"):
            assert _resolve_prompt_version() == "v2"
        assert "BAR_EXAM_PROMPT_VERSION" in caplog.text

    def test_empty_value_falls_back_to_v2(self, monkeypatch):
        monkeypatch.setenv("BAR_EXAM_PROMPT_VERSION", "")
        assert _resolve_prompt_version() == "v2"

    def test_module_default_is_v2(self):
        """The value the worker actually imported, not just the resolver."""
        assert bar_exam_answer_tasks.BAR_EXAM_PROMPT_VERSION == "v2"


class TestTemplateSelection:
    @patch("src.tasks.bar_exam_answer_tasks.rag_client")
    @patch("src.tasks.bar_exam_answer_tasks.db")
    def test_default_runs_v2_and_records_v2(
        self,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        monkeypatch,
    ) -> None:
        monkeypatch.setattr(bar_exam_answer_tasks, "BAR_EXAM_RAG_ENABLED", True)
        monkeypatch.setattr(bar_exam_answer_tasks, "BAR_EXAM_PROMPT_VERSION", "v2")
        _arrange(mock_db, mock_rag)

        generate_answers_for_questions.run(["q-1"])

        user_prompt = mock_rag.generate_completion.call_args.kwargs["user_prompt"]
        assert "AUTHORITY 1" not in user_prompt
        assert mock_db.create_model_run.call_args.kwargs[
            "prompt_template_version"
        ] == "bar_exam_alac.v2"

    @patch("src.tasks.bar_exam_answer_tasks.rag_client")
    @patch("src.tasks.bar_exam_answer_tasks.db")
    def test_v3_runs_the_grouped_prompt_and_records_v3(
        self,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        monkeypatch,
    ) -> None:
        monkeypatch.setattr(bar_exam_answer_tasks, "BAR_EXAM_RAG_ENABLED", True)
        monkeypatch.setattr(bar_exam_answer_tasks, "BAR_EXAM_PROMPT_VERSION", "v3")
        _arrange(mock_db, mock_rag)

        generate_answers_for_questions.run(["q-1"])

        completion = mock_rag.generate_completion.call_args.kwargs
        assert "AUTHORITY 1 — Revised Penal Code, Art. 315" in (
            completion["user_prompt"]
        )
        assert "grouped under an AUTHORITY heading" in completion["system_prompt"]
        assert mock_db.create_model_run.call_args.kwargs[
            "prompt_template_version"
        ] == "bar_exam_alac.v3"

    @patch("src.tasks.bar_exam_answer_tasks.rag_client")
    @patch("src.tasks.bar_exam_answer_tasks.db")
    def test_v3_still_scores_and_filters_exactly_as_v2(
        self,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        monkeypatch,
    ) -> None:
        """v3 changes the prompt, not the contract, so the write is identical."""
        monkeypatch.setattr(bar_exam_answer_tasks, "BAR_EXAM_RAG_ENABLED", True)
        monkeypatch.setattr(bar_exam_answer_tasks, "BAR_EXAM_PROMPT_VERSION", "v3")
        _arrange(mock_db, mock_rag)

        generate_answers_for_questions.run(["q-1"])

        written = mock_db.create_bar_exam_answer.call_args.kwargs
        assert written["structured_answer"]["citedSectionIds"] == [SEC_1]
        grounding = written["structured_answer"]["grounding"]
        assert grounding["emittedIds"] == 1
        assert grounding["validIds"] == 1
        assert grounding["fabricatedIds"] == 0
        assert grounding["citedDocuments"] == 1
        assert grounding["availableDocuments"] == 1
        # One document available, so the breadth denominator is 1 and citing
        # it is full credit — the adaptive bar, unchanged by v3.
        assert grounding["breadthDenominator"] == 1
        assert written["confidence"] == 1.0

    @patch("src.tasks.bar_exam_answer_tasks.rag_client")
    @patch("src.tasks.bar_exam_answer_tasks.db")
    def test_priors_only_stays_v1_even_when_v3_is_selected(
        self,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        monkeypatch,
    ) -> None:
        """With no passages the closed list is empty and the contract vacuous.

        The flag selects between grounded templates; it cannot make an
        ungrounded answer claim to be one.
        """
        monkeypatch.setattr(bar_exam_answer_tasks, "BAR_EXAM_RAG_ENABLED", True)
        monkeypatch.setattr(bar_exam_answer_tasks, "BAR_EXAM_PROMPT_VERSION", "v3")
        _arrange(mock_db, mock_rag)
        mock_rag.retrieve_passages.return_value = []

        generate_answers_for_questions.run(["q-1"])

        completion = mock_rag.generate_completion.call_args.kwargs
        assert "AUTHORITY" not in completion["user_prompt"]
        assert mock_db.create_model_run.call_args.kwargs[
            "prompt_template_version"
        ] == "bar_exam_alac.v1"
        assert mock_db.create_bar_exam_answer.call_args.kwargs["confidence"] is None
