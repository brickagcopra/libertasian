"""Tests for contradictions/service.py — contradiction detection across documents.

Tests cover: _parse_contradiction_response, _compute_confidence,
and the full generate_contradiction_report pipeline with mocked LLM.
"""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.contradictions.schemas import ContradictionRequest, ContradictionResponse
from src.contradictions.service import (
    _compute_confidence,
    _parse_contradiction_response,
    generate_contradiction_report,
)


# ---------------------------------------------------------------------------
# Test data factories
# ---------------------------------------------------------------------------


def _make_full_contradiction_data() -> dict[str, Any]:
    """Return a fully populated contradiction report."""
    return {
        "contradictions": [
            {
                "document_a_id": "doc-001",
                "document_a_title": "People v. Santos",
                "document_a_passage": "The court ruled that the penalty for estafa is imprisonment.",
                "document_b_id": "doc-002",
                "document_b_title": "People v. Reyes",
                "document_b_passage": "The court ruled that estafa may be settled by restitution without imprisonment.",
                "description": "These cases differ on whether imprisonment is mandatory for estafa when restitution is made.",
                "severity": "high",
                "doctrine_area": "criminal_law",
            },
            {
                "document_a_id": "doc-001",
                "document_a_title": "People v. Santos",
                "document_a_passage": "Good faith is not a defense in estafa.",
                "document_b_id": "doc-003",
                "document_b_title": "Estrada v. People",
                "document_b_passage": "Good faith may mitigate the penalty for estafa.",
                "description": "Conflicting views on the role of good faith in estafa cases.",
                "severity": "medium",
                "doctrine_area": "criminal_law",
            },
        ],
        "summary": "Two contradictions found: one on mandatory imprisonment and one on the good faith defense in estafa.",
    }


def _make_passages_by_doc(doc_ids: list[str], count_per: int = 3) -> dict[str, list[MagicMock]]:
    return {doc_id: [MagicMock() for _ in range(count_per)] for doc_id in doc_ids}


# ---------------------------------------------------------------------------
# _parse_contradiction_response
# ---------------------------------------------------------------------------


class TestParseContradictionResponse:
    def test_valid_json(self) -> None:
        data = _make_full_contradiction_data()
        result = _parse_contradiction_response(json.dumps(data))

        assert len(result["contradictions"]) == 2
        assert result["summary"] != ""

    def test_invalid_json_returns_error_structure(self) -> None:
        result = _parse_contradiction_response("not valid JSON")

        assert result["contradictions"] == []
        assert "unable" in result["summary"].lower()

    def test_empty_json_object(self) -> None:
        result = _parse_contradiction_response("{}")
        assert result.get("contradictions") is None

    def test_empty_string(self) -> None:
        result = _parse_contradiction_response("")
        assert result["contradictions"] == []


# ---------------------------------------------------------------------------
# _compute_confidence
# ---------------------------------------------------------------------------


class TestComputeContradictionConfidence:
    def test_no_docs_low_confidence(self) -> None:
        data = _make_full_contradiction_data()
        confidence = _compute_confidence(data, {})

        assert confidence == 0.3

    def test_all_docs_with_passages_and_valid_refs(self) -> None:
        data = _make_full_contradiction_data()
        passages = _make_passages_by_doc(["doc-001", "doc-002", "doc-003"], 5)
        confidence = _compute_confidence(data, passages)

        # All docs have passages (1.0), all refs valid (1.0), all have desc >20 chars (1.0)
        assert confidence >= 0.9

    def test_no_contradictions_found(self) -> None:
        data = {"contradictions": [], "summary": "No contradictions detected."}
        passages = _make_passages_by_doc(["doc-001", "doc-002"], 5)
        confidence = _compute_confidence(data, passages)

        # passage_availability=1.0, ref_accuracy=1.0 (default), desc_quality=1.0 (default)
        assert confidence >= 0.9

    def test_contradictions_with_invalid_refs(self) -> None:
        data = {
            "contradictions": [
                {
                    "document_a_id": "doc-999",  # Not in passages
                    "document_b_id": "doc-998",  # Not in passages
                    "description": "A long enough description for quality check.",
                },
            ],
        }
        passages = _make_passages_by_doc(["doc-001", "doc-002"])
        confidence = _compute_confidence(data, passages)

        # ref_accuracy = 0/1 = 0.0
        assert confidence < 0.8

    def test_contradictions_with_short_descriptions(self) -> None:
        data = {
            "contradictions": [
                {
                    "document_a_id": "doc-001",
                    "document_b_id": "doc-002",
                    "description": "Short",  # < 20 chars
                },
                {
                    "document_a_id": "doc-001",
                    "document_b_id": "doc-002",
                    "description": "",  # empty
                },
            ],
        }
        passages = _make_passages_by_doc(["doc-001", "doc-002"])
        confidence = _compute_confidence(data, passages)

        # desc_quality = 0/2 = 0.0
        assert confidence < 0.8

    def test_docs_without_passages(self) -> None:
        data = _make_full_contradiction_data()
        passages = {"doc-001": [MagicMock()], "doc-002": [], "doc-003": []}
        confidence = _compute_confidence(data, passages)

        # passage_availability=1/3=0.333, ref_accuracy=1.0, desc_quality=1.0
        # confidence = 0.333*0.4 + 1.0*0.35 + 1.0*0.25 = 0.73
        assert confidence < 0.8

    def test_confidence_in_range(self) -> None:
        data = _make_full_contradiction_data()
        passages = _make_passages_by_doc(["doc-001", "doc-002"])
        confidence = _compute_confidence(data, passages)

        assert 0.0 <= confidence <= 1.0

    def test_confidence_is_rounded(self) -> None:
        data = _make_full_contradiction_data()
        passages = _make_passages_by_doc(["doc-001"], 2)
        confidence = _compute_confidence(data, passages)

        assert confidence == round(confidence, 2)


# ---------------------------------------------------------------------------
# generate_contradiction_report — full pipeline
# ---------------------------------------------------------------------------


class TestGenerateContradictionReport:
    """Test the full generate_contradiction_report function with mocked dependencies."""

    @pytest.fixture(autouse=True)
    def _setup_mocks(self) -> None:
        self.mock_model_info = MagicMock(
            return_value={"model_name": "test-contradiction-model", "model_version": "1.0"}
        )
        self.llm_response = json.dumps(_make_full_contradiction_data())
        self.mock_generate = AsyncMock(return_value=self.llm_response)
        self.mock_retrieve_doc = AsyncMock(return_value=[MagicMock() for _ in range(5)])

        self.patches = [
            patch("src.contradictions.service.get_model_info", self.mock_model_info),
            patch("src.contradictions.service.generate_completion", self.mock_generate),
            patch("src.contradictions.service.retrieve_by_document_id", self.mock_retrieve_doc),
        ]
        for p in self.patches:
            p.start()

    @pytest.fixture(autouse=True)
    def _teardown_mocks(self) -> None:
        yield
        for p in self.patches:
            p.stop()

    @pytest.mark.asyncio
    async def test_successful_report(self) -> None:
        request = ContradictionRequest(
            document_ids=["doc-001", "doc-002", "doc-003"],
        )
        response = await generate_contradiction_report(request)

        assert isinstance(response, ContradictionResponse)
        assert len(response.contradictions) == 2
        assert response.documents_analyzed == 3
        assert response.model_name == "test-contradiction-model"

    @pytest.mark.asyncio
    async def test_contradiction_fields(self) -> None:
        request = ContradictionRequest(
            document_ids=["doc-001", "doc-002"],
        )
        response = await generate_contradiction_report(request)

        c = response.contradictions[0]
        assert c.document_a_id == "doc-001"
        assert c.document_b_id == "doc-002"
        assert c.severity == "high"
        assert c.doctrine_area == "criminal_law"

    @pytest.mark.asyncio
    async def test_retrieves_for_each_document(self) -> None:
        request = ContradictionRequest(
            document_ids=["doc-001", "doc-002", "doc-003"],
        )
        await generate_contradiction_report(request)

        assert self.mock_retrieve_doc.call_count == 3

    @pytest.mark.asyncio
    async def test_with_topic_filter(self) -> None:
        request = ContradictionRequest(
            document_ids=["doc-001", "doc-002"],
            topic="estafa penalty",
        )
        await generate_contradiction_report(request)

        # Verify generate was called (topic is passed through prompt)
        self.mock_generate.assert_called_once()

    @pytest.mark.asyncio
    async def test_confidence_in_range(self) -> None:
        request = ContradictionRequest(
            document_ids=["doc-001", "doc-002"],
        )
        response = await generate_contradiction_report(request)

        assert 0.0 <= response.confidence_score <= 1.0

    @pytest.mark.asyncio
    async def test_invalid_llm_response_handled(self) -> None:
        self.mock_generate.return_value = "not json"

        request = ContradictionRequest(
            document_ids=["doc-001", "doc-002"],
        )
        response = await generate_contradiction_report(request)

        assert response.contradictions == []

    @pytest.mark.asyncio
    async def test_invalid_contradiction_items_filtered(self) -> None:
        data = _make_full_contradiction_data()
        data["contradictions"].append("not a dict")
        data["contradictions"].append(None)
        self.mock_generate.return_value = json.dumps(data)

        request = ContradictionRequest(
            document_ids=["doc-001", "doc-002"],
        )
        response = await generate_contradiction_report(request)

        assert len(response.contradictions) == 2

    @pytest.mark.asyncio
    async def test_generation_called_with_json_format(self) -> None:
        request = ContradictionRequest(
            document_ids=["doc-001", "doc-002"],
        )
        await generate_contradiction_report(request)

        call_kwargs = self.mock_generate.call_args.kwargs
        assert call_kwargs.get("response_format") == "json_object"
        assert call_kwargs.get("temperature") == 0.2
