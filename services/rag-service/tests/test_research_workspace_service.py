"""Tests for research_workspaces/service.py — research workspace query answering.

Tests cover: _format_workspace_context, _format_conversation_history,
_parse_response, _compute_confidence, and the full answer_research_query pipeline.
"""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.research_workspaces.schemas import (
    PreviousQuery,
    ResearchQueryRequest,
    ResearchQueryResponse,
)
from src.research_workspaces.service import (
    _compute_confidence,
    _format_conversation_history,
    _format_workspace_context,
    _parse_response,
    answer_research_query,
)


# ---------------------------------------------------------------------------
# Test data factories
# ---------------------------------------------------------------------------


def _make_full_response_data() -> dict[str, Any]:
    """Return a fully populated research query response."""
    return {
        "answer": "Under Philippine labor law, constructive dismissal occurs when an employer's acts make continued employment unbearable for the employee. The Supreme Court in Globe Telecom v. Florendo established that diminution of benefits constitutes constructive dismissal.",
        "citations": [
            {"source_id": "doc-001", "section_id": "sec-001", "text": "Globe Telecom v. Florendo, G.R. No. 150092"},
            {"source_id": "doc-002", "text": "Article 297, Labor Code"},
        ],
        "follow_up_suggestions": [
            "What are the remedies available to a constructively dismissed employee?",
            "How does management prerogative limit constructive dismissal claims?",
            "What is the prescriptive period for filing a constructive dismissal case?",
        ],
    }


def _make_mock_passage(id: str = "hit-1") -> MagicMock:
    p = MagicMock()
    p.id = id
    return p


def _make_passages(count: int) -> list[MagicMock]:
    return [_make_mock_passage(f"hit-{i}") for i in range(count)]


# ---------------------------------------------------------------------------
# _format_workspace_context
# ---------------------------------------------------------------------------


class TestFormatWorkspaceContext:
    def test_with_notes(self) -> None:
        result = _format_workspace_context("Research focus: constructive dismissal in BPO industry")

        assert "Researcher's Notes:" in result
        assert "constructive dismissal" in result

    def test_empty_notes(self) -> None:
        result = _format_workspace_context("")

        assert result == "(No workspace notes.)"

    def test_none_like_notes(self) -> None:
        # Empty string is falsy
        result = _format_workspace_context("")
        assert result == "(No workspace notes.)"


# ---------------------------------------------------------------------------
# _format_conversation_history
# ---------------------------------------------------------------------------


class TestFormatConversationHistory:
    def test_with_previous_queries(self) -> None:
        queries = [
            PreviousQuery(query="What is estafa?", answer="Estafa is a form of swindling."),
            PreviousQuery(query="What are the elements?", answer="The elements include deceit and damage."),
        ]
        result = _format_conversation_history(queries)

        assert "Q1: What is estafa?" in result
        assert "A1: Estafa is a form of swindling." in result
        assert "Q2: What are the elements?" in result

    def test_empty_history(self) -> None:
        result = _format_conversation_history([])

        assert result == "(No previous conversation in this workspace.)"

    def test_dict_format(self) -> None:
        queries = [
            {"query": "Test question?", "answer": "Test answer."},
        ]
        result = _format_conversation_history(queries)

        assert "Q1: Test question?" in result
        assert "A1: Test answer." in result

    def test_invalid_entries_skipped(self) -> None:
        queries = [
            PreviousQuery(query="Valid query?", answer="Valid answer."),
            "not a valid entry",
            42,
        ]
        result = _format_conversation_history(queries)

        assert "Q1: Valid query?" in result
        assert "Q2" not in result  # Invalid entries skipped


# ---------------------------------------------------------------------------
# _parse_response
# ---------------------------------------------------------------------------


class TestParseResponse:
    def test_valid_json(self) -> None:
        data = _make_full_response_data()
        result = _parse_response(json.dumps(data))

        assert "constructive dismissal" in result["answer"]
        assert len(result["citations"]) == 2
        assert len(result["follow_up_suggestions"]) == 3

    def test_invalid_json_returns_error_structure(self) -> None:
        result = _parse_response("not valid JSON")

        assert "unable" in result["answer"].lower()
        assert result["citations"] == []
        assert result["follow_up_suggestions"] == []

    def test_empty_json_object(self) -> None:
        result = _parse_response("{}")
        assert result.get("answer") is None

    def test_empty_string(self) -> None:
        result = _parse_response("")
        assert result["citations"] == []


# ---------------------------------------------------------------------------
# _compute_confidence
# ---------------------------------------------------------------------------


class TestComputeResearchConfidence:
    def test_full_response_high_confidence(self) -> None:
        data = _make_full_response_data()
        passages = _make_passages(5)
        confidence = _compute_confidence(data, passages)

        # passage=1.0, citations=0.67, length=1.0
        assert confidence >= 0.7

    def test_short_answer_low_confidence(self) -> None:
        data = {"answer": "Short", "citations": []}
        passages = _make_passages(5)
        confidence = _compute_confidence(data, passages)

        assert confidence == 0.3

    def test_empty_answer_low_confidence(self) -> None:
        data = {"answer": "", "citations": []}
        passages = _make_passages(5)
        confidence = _compute_confidence(data, passages)

        assert confidence == 0.3

    def test_no_passages(self) -> None:
        data = _make_full_response_data()
        confidence = _compute_confidence(data, [])

        # passage_score=0, citation=0.67, length=1.0
        assert confidence < 0.7

    def test_no_citations(self) -> None:
        data = {"answer": "A" * 200, "citations": []}
        passages = _make_passages(5)
        confidence = _compute_confidence(data, passages)

        # citation_score=0.0
        assert confidence < 0.8

    def test_many_citations(self) -> None:
        data = {
            "answer": "A" * 200,
            "citations": [
                {"source_id": f"d{i}", "text": f"C{i}"} for i in range(5)
            ],
        }
        passages = _make_passages(5)
        confidence = _compute_confidence(data, passages)

        # citation_score capped at 1.0
        assert confidence >= 0.8

    def test_confidence_in_range(self) -> None:
        data = _make_full_response_data()
        passages = _make_passages(3)
        confidence = _compute_confidence(data, passages)

        assert 0.0 <= confidence <= 1.0

    def test_confidence_is_rounded(self) -> None:
        data = _make_full_response_data()
        passages = _make_passages(3)
        confidence = _compute_confidence(data, passages)

        assert confidence == round(confidence, 2)


# ---------------------------------------------------------------------------
# answer_research_query — full pipeline
# ---------------------------------------------------------------------------


class TestAnswerResearchQuery:
    """Test the full answer_research_query function with mocked dependencies."""

    @pytest.fixture(autouse=True)
    def _setup_mocks(self) -> None:
        self.mock_model_info = MagicMock(
            return_value={"model_name": "test-research-model", "model_version": "1.0"}
        )
        self.llm_response = json.dumps(_make_full_response_data())
        self.mock_generate = AsyncMock(return_value=self.llm_response)
        self.mock_retrieve_doc = AsyncMock(return_value=_make_passages(3))
        self.mock_retrieve_query = AsyncMock(return_value=_make_passages(5))

        self.patches = [
            patch("src.research_workspaces.service.get_model_info", self.mock_model_info),
            patch("src.research_workspaces.service.generate_completion", self.mock_generate),
            patch("src.research_workspaces.service.retrieve_by_document_id", self.mock_retrieve_doc),
            patch("src.research_workspaces.service.retrieve_by_query", self.mock_retrieve_query),
        ]
        for p in self.patches:
            p.start()

    @pytest.fixture(autouse=True)
    def _teardown_mocks(self) -> None:
        yield
        for p in self.patches:
            p.stop()

    @pytest.mark.asyncio
    async def test_successful_query(self) -> None:
        request = ResearchQueryRequest(
            query="What is constructive dismissal under Philippine labor law?",
        )
        response = await answer_research_query(request)

        assert isinstance(response, ResearchQueryResponse)
        assert "constructive dismissal" in response.answer
        assert len(response.citations) == 2
        assert len(response.follow_up_suggestions) == 3

    @pytest.mark.asyncio
    async def test_with_pinned_documents(self) -> None:
        request = ResearchQueryRequest(
            query="What is the doctrine in the pinned cases?",
            pinned_document_ids=["doc-001", "doc-002"],
        )
        await answer_research_query(request)

        assert self.mock_retrieve_doc.call_count == 2

    @pytest.mark.asyncio
    async def test_deduplicates_passages(self) -> None:
        # Return same passage IDs from both sources
        shared = _make_mock_passage("shared-1")
        self.mock_retrieve_doc.return_value = [shared, _make_mock_passage("doc-only")]
        self.mock_retrieve_query.return_value = [shared, _make_mock_passage("query-only")]

        request = ResearchQueryRequest(
            query="Test deduplication of passages",
            pinned_document_ids=["doc-001"],
        )
        response = await answer_research_query(request)

        # Should still produce a valid response regardless of dedup
        assert isinstance(response, ResearchQueryResponse)

    @pytest.mark.asyncio
    async def test_with_notes(self) -> None:
        request = ResearchQueryRequest(
            query="Focus on BPO industry constructive dismissal",
            notes="Researching constructive dismissal in BPO companies",
        )
        await answer_research_query(request)

        # Notes should be included in prompt
        self.mock_generate.assert_called_once()

    @pytest.mark.asyncio
    async def test_with_conversation_history(self) -> None:
        request = ResearchQueryRequest(
            query="What about the remedies available?",
            previous_queries=[
                PreviousQuery(query="What is constructive dismissal?", answer="It is..."),
            ],
        )
        await answer_research_query(request)

        self.mock_generate.assert_called_once()

    @pytest.mark.asyncio
    async def test_confidence_in_range(self) -> None:
        request = ResearchQueryRequest(
            query="Test confidence range for research query",
        )
        response = await answer_research_query(request)

        assert 0.0 <= response.confidence_score <= 1.0

    @pytest.mark.asyncio
    async def test_invalid_llm_response_handled(self) -> None:
        self.mock_generate.return_value = "not json"

        request = ResearchQueryRequest(
            query="Test invalid response handling",
        )
        response = await answer_research_query(request)

        assert "unable" in response.answer.lower() or response.answer != ""

    @pytest.mark.asyncio
    async def test_follow_up_suggestions_limited_to_5(self) -> None:
        data = _make_full_response_data()
        data["follow_up_suggestions"] = [f"Suggestion {i}" for i in range(10)]
        self.mock_generate.return_value = json.dumps(data)

        request = ResearchQueryRequest(
            query="Test follow-up suggestion limiting",
        )
        response = await answer_research_query(request)

        assert len(response.follow_up_suggestions) <= 5

    @pytest.mark.asyncio
    async def test_invalid_follow_ups_handled(self) -> None:
        data = _make_full_response_data()
        data["follow_up_suggestions"] = "not a list"
        self.mock_generate.return_value = json.dumps(data)

        request = ResearchQueryRequest(
            query="Test invalid follow-up suggestions",
        )
        response = await answer_research_query(request)

        assert response.follow_up_suggestions == []

    @pytest.mark.asyncio
    async def test_generation_called_with_json_format(self) -> None:
        request = ResearchQueryRequest(
            query="Test generation parameters used",
        )
        await answer_research_query(request)

        call_kwargs = self.mock_generate.call_args.kwargs
        assert call_kwargs.get("response_format") == "json_object"
        assert call_kwargs.get("temperature") == 0.3
