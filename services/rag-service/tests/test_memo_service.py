"""Tests for memos/service.py — memo and outline generation.

Tests cover: _parse_memo_response, _parse_outline_response, _compute_confidence,
_compute_outline_confidence, and the full generate_memo / generate_outline pipelines.
"""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.memos.schemas import (
    MemoGenerationRequest,
    MemoGenerationResponse,
    MemoType,
    OutlineGenerationResponse,
    OutputType,
)
from src.memos.service import (
    _compute_confidence,
    _compute_outline_confidence,
    _parse_memo_response,
    _parse_outline_response,
    generate_memo,
    generate_outline,
)


# ---------------------------------------------------------------------------
# Test data factories
# ---------------------------------------------------------------------------


def _make_full_memo_data() -> dict[str, Any]:
    """Return a fully populated memo response."""
    return {
        "title": "Legal Memo: Constructive Dismissal",
        "summary": "This memo analyzes the doctrine of constructive dismissal under Philippine labor law.",
        "sections": [
            {
                "heading": "Legal Basis",
                "content": "Article 297 of the Labor Code enumerates grounds for termination.",
                "citations": [
                    {"source_id": "doc-0001", "section_id": "sec-001", "text": "Art. 297 LC"},
                ],
            },
            {
                "heading": "Case Law Analysis",
                "content": "In Globe Telecom v. Florendo, the Court held that diminution of benefits constitutes constructive dismissal.",
                "citations": [
                    {"source_id": "doc-0002", "text": "Globe Telecom v. Florendo"},
                ],
            },
        ],
        "conclusion": "Based on the foregoing, constructive dismissal is established.",
        "all_citations": [
            {"source_id": "doc-0001", "section_id": "sec-001", "text": "Art. 297 LC"},
            {"source_id": "doc-0002", "text": "Globe Telecom v. Florendo"},
        ],
    }


def _make_full_outline_data() -> dict[str, Any]:
    """Return a fully populated outline response."""
    return {
        "title": "Constructive Dismissal Overview",
        "sections": [
            {
                "heading": "Definition",
                "key_points": [
                    "Involuntary resignation due to employer's actions",
                    "Demotion, diminution of pay/benefits",
                ],
            },
            {
                "heading": "Legal Basis",
                "key_points": ["Article 297 of the Labor Code", "Due process requirements"],
            },
            {
                "heading": "Case Law",
                "key_points": [
                    "Globe Telecom v. Florendo",
                    "Philippine Airlines v. NLRC",
                ],
            },
        ],
    }


def _make_passages(count: int) -> list[MagicMock]:
    """Create a list of mock passage objects."""
    return [MagicMock() for _ in range(count)]


# ---------------------------------------------------------------------------
# _parse_memo_response
# ---------------------------------------------------------------------------


class TestParseMemoResponse:
    def test_valid_json(self) -> None:
        data = _make_full_memo_data()
        result = _parse_memo_response(json.dumps(data))

        assert result["title"] == data["title"]
        assert result["summary"] == data["summary"]
        assert len(result["sections"]) == 2

    def test_invalid_json_returns_error_structure(self) -> None:
        result = _parse_memo_response("not valid JSON at all")

        assert result["title"] == "Memo Generation Error"
        assert result["sections"] == []
        assert result["all_citations"] == []

    def test_empty_json_object(self) -> None:
        result = _parse_memo_response("{}")
        assert result.get("title") is None
        assert result.get("sections") is None

    def test_partial_json(self) -> None:
        partial = json.dumps({"title": "My Memo", "summary": "A brief summary"})
        result = _parse_memo_response(partial)

        assert result["title"] == "My Memo"
        assert result["summary"] == "A brief summary"
        assert result.get("sections") is None

    def test_empty_string(self) -> None:
        result = _parse_memo_response("")
        assert result["title"] == "Memo Generation Error"


# ---------------------------------------------------------------------------
# _parse_outline_response
# ---------------------------------------------------------------------------


class TestParseOutlineResponse:
    def test_valid_json(self) -> None:
        data = _make_full_outline_data()
        result = _parse_outline_response(json.dumps(data))

        assert result["title"] == data["title"]
        assert len(result["sections"]) == 3

    def test_invalid_json_returns_error_structure(self) -> None:
        result = _parse_outline_response("not valid JSON")

        assert result["title"] == "Outline Generation Error"
        assert len(result["sections"]) == 1
        assert result["sections"][0]["heading"] == "Error"

    def test_missing_title_gets_default(self) -> None:
        data = {"sections": [{"heading": "Test", "key_points": ["Point 1"]}]}
        result = _parse_outline_response(json.dumps(data))

        assert result["title"] == "Untitled Outline"

    def test_missing_sections_gets_empty_list(self) -> None:
        data = {"title": "My Outline"}
        result = _parse_outline_response(json.dumps(data))

        assert result["sections"] == []

    def test_invalid_sections_type_gets_empty_list(self) -> None:
        data = {"title": "My Outline", "sections": "not a list"}
        result = _parse_outline_response(json.dumps(data))

        assert result["sections"] == []

    def test_empty_string(self) -> None:
        result = _parse_outline_response("")
        assert result["title"] == "Outline Generation Error"


# ---------------------------------------------------------------------------
# _compute_confidence (memo)
# ---------------------------------------------------------------------------


class TestComputeMemoConfidence:
    def test_full_sections_with_citations(self) -> None:
        data = _make_full_memo_data()
        passages = _make_passages(5)
        confidence = _compute_confidence(data, passages)

        # 2/2 content (1.0), 2/2 citations (1.0), 5/5 passages (1.0)
        assert confidence == 1.0

    def test_no_sections_returns_low(self) -> None:
        data = {"sections": []}
        passages = _make_passages(5)
        confidence = _compute_confidence(data, passages)

        assert confidence == 0.3

    def test_missing_sections_key_returns_low(self) -> None:
        data = {}
        passages = _make_passages(5)
        confidence = _compute_confidence(data, passages)

        assert confidence == 0.3

    def test_sections_without_citations(self) -> None:
        data = {
            "sections": [
                {"heading": "A", "content": "Some content"},
                {"heading": "B", "content": "More content"},
            ]
        }
        passages = _make_passages(5)
        confidence = _compute_confidence(data, passages)

        # source_coverage=1.0, citation_mapping=0.0, passage=1.0
        # 1.0*0.3 + 0.0*0.4 + 1.0*0.3 = 0.6
        assert confidence == 0.6

    def test_few_passages(self) -> None:
        data = _make_full_memo_data()
        passages = _make_passages(2)
        confidence = _compute_confidence(data, passages)

        # passage_factor = 2/5 = 0.4
        assert confidence < 1.0

    def test_zero_passages(self) -> None:
        data = _make_full_memo_data()
        passages = []
        confidence = _compute_confidence(data, passages)

        # passage_factor = 0 → 0.3 + 0.4 + 0 = 0.7
        assert confidence == 0.7

    def test_confidence_in_range(self) -> None:
        data = _make_full_memo_data()
        passages = _make_passages(10)
        confidence = _compute_confidence(data, passages)

        assert 0.0 <= confidence <= 1.0

    def test_invalid_section_entries_ignored(self) -> None:
        data = {
            "sections": [
                {"heading": "A", "content": "Content", "citations": [{"source_id": "doc-1", "text": "T"}]},
                "not a dict",
                None,
            ]
        }
        passages = _make_passages(5)
        confidence = _compute_confidence(data, passages)

        # Only 1 valid section out of 3 (3 total from list length, 1 with content)
        assert 0.0 <= confidence <= 1.0

    def test_confidence_is_rounded(self) -> None:
        data = _make_full_memo_data()
        passages = _make_passages(3)
        confidence = _compute_confidence(data, passages)

        assert confidence == round(confidence, 2)


# ---------------------------------------------------------------------------
# _compute_outline_confidence
# ---------------------------------------------------------------------------


class TestComputeOutlineConfidence:
    def test_full_outline_high_confidence(self) -> None:
        data = _make_full_outline_data()
        raw_text = "A" * 2000  # Long text
        confidence = _compute_outline_confidence(data, raw_text)

        # 3 sections (3/3=1.0), 2 pts/sec avg (2/3≈0.67), 2000 chars (1.0)
        assert confidence > 0.6

    def test_no_sections_returns_low(self) -> None:
        data = {"title": "Empty", "sections": []}
        confidence = _compute_outline_confidence(data, "some text")

        assert confidence == 0.1

    def test_single_section_few_points(self) -> None:
        data = {
            "sections": [{"heading": "Only Section", "key_points": ["One point"]}]
        }
        confidence = _compute_outline_confidence(data, "short text")

        # section_factor=1/3, points_factor=1/3, text_factor=10/1000
        assert confidence < 0.5

    def test_short_raw_text(self) -> None:
        data = _make_full_outline_data()
        confidence = _compute_outline_confidence(data, "short")

        assert confidence < 1.0

    def test_confidence_in_range(self) -> None:
        data = _make_full_outline_data()
        confidence = _compute_outline_confidence(data, "x" * 5000)

        assert 0.0 <= confidence <= 1.0

    def test_confidence_is_rounded(self) -> None:
        data = _make_full_outline_data()
        confidence = _compute_outline_confidence(data, "x" * 500)

        assert confidence == round(confidence, 2)

    def test_many_key_points(self) -> None:
        data = {
            "sections": [
                {"heading": "S1", "key_points": ["p1", "p2", "p3", "p4", "p5"]},
                {"heading": "S2", "key_points": ["p1", "p2", "p3"]},
                {"heading": "S3", "key_points": ["p1", "p2", "p3", "p4"]},
            ]
        }
        raw_text = "A" * 5000
        confidence = _compute_outline_confidence(data, raw_text)

        # High section count, high points density, long text
        assert confidence >= 0.8


# ---------------------------------------------------------------------------
# generate_memo — full pipeline
# ---------------------------------------------------------------------------


class TestGenerateMemo:
    """Test the full generate_memo function with mocked dependencies."""

    @pytest.fixture(autouse=True)
    def _setup_mocks(self) -> None:
        self.mock_model_info = MagicMock(
            return_value={"model_name": "test-memo-model", "model_version": "1.0"}
        )
        self.llm_response = json.dumps(_make_full_memo_data())
        self.mock_generate = AsyncMock(return_value=self.llm_response)
        self.mock_retrieve = AsyncMock(return_value=_make_passages(5))

        self.patches = [
            patch("src.memos.service.get_model_info", self.mock_model_info),
            patch("src.memos.service.generate_completion", self.mock_generate),
            patch("src.memos.service.retrieve_by_query", self.mock_retrieve),
        ]
        for p in self.patches:
            p.start()

    @pytest.fixture(autouse=True)
    def _teardown_mocks(self) -> None:
        yield
        for p in self.patches:
            p.stop()

    @pytest.mark.asyncio
    async def test_successful_memo_generation(self) -> None:
        request = MemoGenerationRequest(
            query="What is constructive dismissal under Philippine labor law?",
            memo_type=MemoType.LEGAL_OPINION,
        )
        response = await generate_memo(request)

        assert isinstance(response, MemoGenerationResponse)
        assert response.title == "Legal Memo: Constructive Dismissal"
        assert len(response.sections) == 2
        assert response.model_name == "test-memo-model"

    @pytest.mark.asyncio
    async def test_confidence_score_in_range(self) -> None:
        request = MemoGenerationRequest(
            query="What is constructive dismissal?",
            memo_type=MemoType.RESEARCH_SUMMARY,
        )
        response = await generate_memo(request)

        assert 0.0 <= response.confidence_score <= 1.0

    @pytest.mark.asyncio
    async def test_citations_parsed(self) -> None:
        request = MemoGenerationRequest(
            query="Analyze constructive dismissal",
            memo_type=MemoType.CASE_ANALYSIS,
        )
        response = await generate_memo(request)

        assert len(response.citations) == 2
        assert response.citations[0].source_id == "doc-0001"

    @pytest.mark.asyncio
    async def test_invalid_llm_response_handled(self) -> None:
        self.mock_generate.return_value = "not json"

        request = MemoGenerationRequest(
            query="What is constructive dismissal?",
            memo_type=MemoType.LEGAL_OPINION,
        )
        response = await generate_memo(request)

        assert response.title == "Memo Generation Error"
        assert response.sections == []

    @pytest.mark.asyncio
    async def test_section_citations_filter_invalid(self) -> None:
        data = _make_full_memo_data()
        data["sections"][0]["citations"] = [
            {"source_id": "doc-0001", "text": "Valid"},
            {"text": "No source_id"},  # missing source_id
            "not a dict",
        ]
        self.mock_generate.return_value = json.dumps(data)

        request = MemoGenerationRequest(
            query="What is constructive dismissal?",
            memo_type=MemoType.LEGAL_OPINION,
        )
        response = await generate_memo(request)

        assert len(response.sections[0].citations) == 1

    @pytest.mark.asyncio
    async def test_generation_called_with_json_format(self) -> None:
        request = MemoGenerationRequest(
            query="What is constructive dismissal?",
            memo_type=MemoType.LEGAL_OPINION,
        )
        await generate_memo(request)

        self.mock_generate.assert_called_once()
        call_kwargs = self.mock_generate.call_args.kwargs
        assert call_kwargs.get("response_format") == "json_object"
        assert call_kwargs.get("temperature") == 0.2


# ---------------------------------------------------------------------------
# generate_outline — full pipeline
# ---------------------------------------------------------------------------


class TestGenerateOutline:
    """Test the full generate_outline function with mocked dependencies."""

    @pytest.fixture(autouse=True)
    def _setup_mocks(self) -> None:
        self.mock_model_info = MagicMock(
            return_value={"model_name": "test-outline-model", "model_version": "1.0"}
        )
        self.llm_response = json.dumps(_make_full_outline_data())
        self.mock_generate = AsyncMock(return_value=self.llm_response)

        self.patches = [
            patch("src.memos.service.get_model_info", self.mock_model_info),
            patch("src.memos.service.generate_completion", self.mock_generate),
        ]
        for p in self.patches:
            p.start()

    @pytest.fixture(autouse=True)
    def _teardown_mocks(self) -> None:
        yield
        for p in self.patches:
            p.stop()

    @pytest.mark.asyncio
    async def test_successful_outline_generation(self) -> None:
        request = MemoGenerationRequest(
            query="Outline constructive dismissal",
            memo_type=MemoType.RESEARCH_SUMMARY,
            output_type=OutputType.OUTLINE,
            raw_text="This is a long text about constructive dismissal " * 20,
        )
        response = await generate_outline(request)

        assert isinstance(response, OutlineGenerationResponse)
        assert response.outline["title"] == "Constructive Dismissal Overview"
        assert len(response.outline["sections"]) == 3

    @pytest.mark.asyncio
    async def test_short_text_returns_insufficient(self) -> None:
        request = MemoGenerationRequest(
            query="Outline this",
            memo_type=MemoType.RESEARCH_SUMMARY,
            output_type=OutputType.OUTLINE,
            raw_text="Short",
        )
        response = await generate_outline(request)

        assert response.confidence_score == 0.0
        assert response.outline["title"] == "Insufficient Text"
        # Should NOT call LLM
        self.mock_generate.assert_not_called()

    @pytest.mark.asyncio
    async def test_empty_raw_text_returns_insufficient(self) -> None:
        request = MemoGenerationRequest(
            query="Outline this",
            memo_type=MemoType.RESEARCH_SUMMARY,
            output_type=OutputType.OUTLINE,
            raw_text="",
        )
        response = await generate_outline(request)

        assert response.confidence_score == 0.0

    @pytest.mark.asyncio
    async def test_none_raw_text_returns_insufficient(self) -> None:
        request = MemoGenerationRequest(
            query="Outline this",
            memo_type=MemoType.RESEARCH_SUMMARY,
            output_type=OutputType.OUTLINE,
            raw_text=None,
        )
        response = await generate_outline(request)

        assert response.confidence_score == 0.0

    @pytest.mark.asyncio
    async def test_confidence_in_range(self) -> None:
        request = MemoGenerationRequest(
            query="Outline constructive dismissal",
            memo_type=MemoType.RESEARCH_SUMMARY,
            output_type=OutputType.OUTLINE,
            raw_text="Content for outline generation " * 50,
        )
        response = await generate_outline(request)

        assert 0.0 <= response.confidence_score <= 1.0

    @pytest.mark.asyncio
    async def test_invalid_llm_response_handled(self) -> None:
        self.mock_generate.return_value = "not json"

        request = MemoGenerationRequest(
            query="Outline constructive dismissal",
            memo_type=MemoType.RESEARCH_SUMMARY,
            output_type=OutputType.OUTLINE,
            raw_text="Content for outline generation " * 50,
        )
        response = await generate_outline(request)

        assert response.outline["title"] == "Outline Generation Error"
