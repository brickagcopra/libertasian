"""Tests for comparisons/service.py — case comparison generation.

Tests cover: _parse_comparison_response, _compute_confidence,
and the full generate_comparison pipeline with mocked LLM.
"""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.comparisons.schemas import (
    ComparisonRequest,
    ComparisonResponse,
    ComparisonType,
)
from src.comparisons.service import (
    _compute_confidence,
    _parse_comparison_response,
    generate_comparison,
)


# ---------------------------------------------------------------------------
# Test data factories
# ---------------------------------------------------------------------------


def _make_full_comparison_data() -> dict[str, Any]:
    """Return a fully populated comparison response."""
    return {
        "documents": [
            {
                "document_id": "doc-001",
                "title": "People v. Santos",
                "citation_text": "G.R. No. 123456",
                "court": "Supreme Court",
                "decision_date": "2024-01-15",
            },
            {
                "document_id": "doc-002",
                "title": "People v. Reyes",
                "citation_text": "G.R. No. 654321",
                "court": "Supreme Court",
                "decision_date": "2023-06-20",
            },
        ],
        "dimensions": [
            {
                "dimension": "Facts",
                "entries": [
                    {
                        "document_id": "doc-001",
                        "content": "The accused was charged with theft.",
                        "citations": [{"source_id": "doc-001", "text": "Para 1"}],
                    },
                    {
                        "document_id": "doc-002",
                        "content": "The accused was charged with robbery.",
                        "citations": [{"source_id": "doc-002", "text": "Para 2"}],
                    },
                ],
                "analysis": "Both cases involve crimes against property but differ in element of force.",
            },
            {
                "dimension": "Ruling",
                "entries": [
                    {"document_id": "doc-001", "content": "Guilty of theft."},
                    {"document_id": "doc-002", "content": "Acquitted of robbery."},
                ],
                "analysis": "Different outcomes due to prosecution's burden of proof for robbery element.",
            },
        ],
        "overall_analysis": "While both cases involve property crimes, the distinction lies in the presence of force or intimidation.",
    }


def _make_passages_by_doc(doc_ids: list[str], count_per: int = 3) -> dict[str, list[MagicMock]]:
    return {doc_id: [MagicMock() for _ in range(count_per)] for doc_id in doc_ids}


# ---------------------------------------------------------------------------
# _parse_comparison_response
# ---------------------------------------------------------------------------


class TestParseComparisonResponse:
    def test_valid_json(self) -> None:
        data = _make_full_comparison_data()
        result = _parse_comparison_response(json.dumps(data))

        assert len(result["documents"]) == 2
        assert len(result["dimensions"]) == 2
        assert result["overall_analysis"] != ""

    def test_invalid_json_returns_error_structure(self) -> None:
        result = _parse_comparison_response("not valid JSON")

        assert result["documents"] == []
        assert result["dimensions"] == []
        assert "unable" in result["overall_analysis"].lower()

    def test_empty_json_object(self) -> None:
        result = _parse_comparison_response("{}")
        assert result.get("documents") is None

    def test_empty_string(self) -> None:
        result = _parse_comparison_response("")
        assert result["documents"] == []


# ---------------------------------------------------------------------------
# _compute_confidence
# ---------------------------------------------------------------------------


class TestComputeComparisonConfidence:
    def test_full_comparison_high_confidence(self) -> None:
        data = _make_full_comparison_data()
        passages = _make_passages_by_doc(["doc-001", "doc-002"], 5)
        confidence = _compute_confidence(data, passages)

        # 2/2 dims with analysis (1.0), 4/4 entries (1.0), 2/2 docs with passages (1.0)
        assert confidence >= 0.9

    def test_no_dimensions_low_confidence(self) -> None:
        data = {"dimensions": [], "documents": []}
        passages = _make_passages_by_doc(["doc-001", "doc-002"])
        confidence = _compute_confidence(data, passages)

        assert confidence == 0.3

    def test_empty_passages_low_confidence(self) -> None:
        data = _make_full_comparison_data()
        confidence = _compute_confidence(data, {})

        assert confidence == 0.3

    def test_partial_entries(self) -> None:
        data = {
            "dimensions": [
                {
                    "dimension": "Facts",
                    "entries": [{"document_id": "doc-001", "content": "Content"}],
                    "analysis": "Partial analysis",
                },
            ],
        }
        passages = _make_passages_by_doc(["doc-001", "doc-002"], 3)
        confidence = _compute_confidence(data, passages)

        # 1 dim with analysis (1.0), 1/2 entries (0.5), 2/2 passages (1.0)
        assert 0.3 < confidence < 1.0

    def test_dimensions_without_analysis(self) -> None:
        data = {
            "dimensions": [
                {"dimension": "Facts", "entries": [{"document_id": "d1", "content": "C"}]},
                {"dimension": "Ruling", "entries": [{"document_id": "d2", "content": "C"}], "analysis": ""},
            ],
        }
        passages = _make_passages_by_doc(["d1", "d2"])
        confidence = _compute_confidence(data, passages)

        # 0/2 dims with analysis
        assert confidence < 0.9

    def test_confidence_in_range(self) -> None:
        data = _make_full_comparison_data()
        passages = _make_passages_by_doc(["doc-001", "doc-002"])
        confidence = _compute_confidence(data, passages)

        assert 0.0 <= confidence <= 1.0

    def test_confidence_is_rounded(self) -> None:
        data = _make_full_comparison_data()
        passages = _make_passages_by_doc(["doc-001", "doc-002"], 2)
        confidence = _compute_confidence(data, passages)

        assert confidence == round(confidence, 2)

    def test_docs_without_passages_lower_confidence(self) -> None:
        data = _make_full_comparison_data()
        passages = {"doc-001": [MagicMock()], "doc-002": []}
        confidence = _compute_confidence(data, passages)

        # 1/2 docs with passages
        assert confidence < 1.0


# ---------------------------------------------------------------------------
# generate_comparison — full pipeline
# ---------------------------------------------------------------------------


class TestGenerateComparison:
    """Test the full generate_comparison function with mocked dependencies."""

    @pytest.fixture(autouse=True)
    def _setup_mocks(self) -> None:
        self.mock_model_info = MagicMock(
            return_value={"model_name": "test-comparison-model", "model_version": "1.0"}
        )
        self.llm_response = json.dumps(_make_full_comparison_data())
        self.mock_generate = AsyncMock(return_value=self.llm_response)
        self.mock_retrieve_doc = AsyncMock(return_value=[MagicMock() for _ in range(3)])

        self.patches = [
            patch("src.comparisons.service.get_model_info", self.mock_model_info),
            patch("src.comparisons.service.generate_completion", self.mock_generate),
            patch("src.comparisons.service.retrieve_by_document_id", self.mock_retrieve_doc),
        ]
        for p in self.patches:
            p.start()

    @pytest.fixture(autouse=True)
    def _teardown_mocks(self) -> None:
        yield
        for p in self.patches:
            p.stop()

    @pytest.mark.asyncio
    async def test_successful_comparison(self) -> None:
        request = ComparisonRequest(
            document_ids=["doc-001", "doc-002"],
            comparison_type=ComparisonType.FULL,
        )
        response = await generate_comparison(request)

        assert isinstance(response, ComparisonResponse)
        assert len(response.documents) == 2
        assert len(response.dimensions) == 2
        assert response.model_name == "test-comparison-model"

    @pytest.mark.asyncio
    async def test_retrieves_for_each_document(self) -> None:
        request = ComparisonRequest(
            document_ids=["doc-001", "doc-002", "doc-003"],
            comparison_type=ComparisonType.DOCTRINE_ONLY,
        )
        await generate_comparison(request)

        assert self.mock_retrieve_doc.call_count == 3

    @pytest.mark.asyncio
    async def test_confidence_in_range(self) -> None:
        request = ComparisonRequest(
            document_ids=["doc-001", "doc-002"],
            comparison_type=ComparisonType.FULL,
        )
        response = await generate_comparison(request)

        assert 0.0 <= response.confidence_score <= 1.0

    @pytest.mark.asyncio
    async def test_invalid_llm_response_handled(self) -> None:
        self.mock_generate.return_value = "not json"

        request = ComparisonRequest(
            document_ids=["doc-001", "doc-002"],
            comparison_type=ComparisonType.FULL,
        )
        response = await generate_comparison(request)

        assert response.documents == []
        assert response.dimensions == []

    @pytest.mark.asyncio
    async def test_invalid_dimension_entries_filtered(self) -> None:
        data = _make_full_comparison_data()
        data["dimensions"].append("not a dict")
        data["dimensions"].append(None)
        self.mock_generate.return_value = json.dumps(data)

        request = ComparisonRequest(
            document_ids=["doc-001", "doc-002"],
            comparison_type=ComparisonType.FULL,
        )
        response = await generate_comparison(request)

        # Only the 2 valid dimensions
        assert len(response.dimensions) == 2

    @pytest.mark.asyncio
    async def test_generation_called_with_json_format(self) -> None:
        request = ComparisonRequest(
            document_ids=["doc-001", "doc-002"],
            comparison_type=ComparisonType.FULL,
        )
        await generate_comparison(request)

        call_kwargs = self.mock_generate.call_args.kwargs
        assert call_kwargs.get("response_format") == "json_object"
        assert call_kwargs.get("temperature") == 0.2
