"""Tests for hearing_prep/service.py — hearing preparation pack generation.

Tests cover: _parse_response, _compute_confidence,
and the full generate_hearing_prep pipeline with mocked LLM.
"""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.hearing_prep.schemas import HearingPrepRequest, HearingPrepResponse
from src.hearing_prep.service import (
    _compute_confidence,
    _parse_response,
    generate_hearing_prep,
)


# ---------------------------------------------------------------------------
# Test data factories
# ---------------------------------------------------------------------------


def _make_full_hearing_prep_data() -> dict[str, Any]:
    """Return a fully populated hearing prep response."""
    return {
        "cases": [
            {
                "document_id": "doc-001",
                "title": "Globe Telecom v. Florendo",
                "citation_text": "G.R. No. 150092",
                "relevance": "Directly addresses constructive dismissal by diminution of benefits.",
                "key_holdings": [
                    "Diminution of benefits constitutes constructive dismissal.",
                    "The employer has the burden of proving just cause.",
                ],
            },
            {
                "document_id": "doc-002",
                "title": "Philippine Airlines v. NLRC",
                "citation_text": "G.R. No. 132805",
                "relevance": "Establishes the standard for authorized cause termination.",
                "key_holdings": ["Retrenchment requires good faith and fair criteria."],
            },
        ],
        "provisions": [
            {
                "document_id": "doc-003",
                "section_id": "sec-art297",
                "title": "Labor Code",
                "section_label": "Article 297",
                "text": "An employer may terminate an employment for just cause.",
                "relevance": "Foundational provision for termination disputes.",
            },
        ],
        "arguments": [
            {
                "position": "The employee was constructively dismissed due to demotion.",
                "supporting_cases": ["Globe Telecom v. Florendo"],
                "supporting_provisions": ["Article 297, Labor Code"],
                "strength": "strong",
            },
        ],
        "counter_arguments": [
            {
                "position": "The transfer was a valid exercise of management prerogative.",
                "supporting_cases": ["Abbott Labs v. Alcaraz"],
                "supporting_provisions": ["Article 297, Labor Code"],
                "strength": "moderate",
            },
        ],
        "suggested_questions": [
            "Was the demotion accompanied by a diminution in pay or benefits?",
            "Did the employer follow the two-notice rule?",
            "Was the transfer a bona fide management decision?",
        ],
    }


def _make_passages_by_doc(doc_ids: list[str], count_per: int = 3) -> dict[str, list[MagicMock]]:
    return {doc_id: [MagicMock() for _ in range(count_per)] for doc_id in doc_ids}


# ---------------------------------------------------------------------------
# _parse_response
# ---------------------------------------------------------------------------


class TestParseResponse:
    def test_valid_json(self) -> None:
        data = _make_full_hearing_prep_data()
        result = _parse_response(json.dumps(data))

        assert len(result["cases"]) == 2
        assert len(result["provisions"]) == 1
        assert len(result["arguments"]) == 1
        assert len(result["counter_arguments"]) == 1
        assert len(result["suggested_questions"]) == 3

    def test_invalid_json_returns_empty_structure(self) -> None:
        result = _parse_response("not valid JSON")

        assert result["cases"] == []
        assert result["provisions"] == []
        assert result["arguments"] == []
        assert result["counter_arguments"] == []
        assert result["suggested_questions"] == []

    def test_empty_json_object(self) -> None:
        result = _parse_response("{}")
        assert result.get("cases") is None

    def test_empty_string(self) -> None:
        result = _parse_response("")
        assert result["cases"] == []


# ---------------------------------------------------------------------------
# _compute_confidence
# ---------------------------------------------------------------------------


class TestComputeHearingPrepConfidence:
    def test_full_pack_high_confidence(self) -> None:
        data = _make_full_hearing_prep_data()
        passages = _make_passages_by_doc(["doc-001", "doc-002", "topic_search"], 5)
        confidence = _compute_confidence(data, passages)

        # All 5 sections present (1.0), 10+ items (1.0), 15 passages (1.0)
        assert confidence >= 0.8

    def test_no_passages_low_confidence(self) -> None:
        data = _make_full_hearing_prep_data()
        passages: dict[str, list[Any]] = {}
        confidence = _compute_confidence(data, passages)

        # total_passages = 0
        assert confidence == 0.3

    def test_empty_pack_with_passages(self) -> None:
        data = {
            "cases": [],
            "provisions": [],
            "arguments": [],
            "counter_arguments": [],
            "suggested_questions": [],
        }
        passages = _make_passages_by_doc(["doc-001"], 5)
        confidence = _compute_confidence(data, passages)

        # section_completeness=0, content_richness=0
        assert confidence < 0.5

    def test_partial_sections(self) -> None:
        data = {
            "cases": [{"document_id": "d1", "title": "C1", "relevance": "R", "key_holdings": []}],
            "provisions": [],
            "arguments": [{"position": "P", "supporting_cases": [], "supporting_provisions": []}],
            "counter_arguments": [],
            "suggested_questions": ["Q1"],
        }
        passages = _make_passages_by_doc(["doc-001"], 5)
        confidence = _compute_confidence(data, passages)

        # 3/5 sections, 3 items, 5 passages
        assert 0.3 < confidence < 0.9

    def test_confidence_in_range(self) -> None:
        data = _make_full_hearing_prep_data()
        passages = _make_passages_by_doc(["doc-001"])
        confidence = _compute_confidence(data, passages)

        assert 0.0 <= confidence <= 1.0

    def test_confidence_is_rounded(self) -> None:
        data = _make_full_hearing_prep_data()
        passages = _make_passages_by_doc(["doc-001"], 2)
        confidence = _compute_confidence(data, passages)

        assert confidence == round(confidence, 2)


# ---------------------------------------------------------------------------
# generate_hearing_prep — full pipeline
# ---------------------------------------------------------------------------


class TestGenerateHearingPrep:
    """Test the full generate_hearing_prep function with mocked dependencies."""

    @pytest.fixture(autouse=True)
    def _setup_mocks(self) -> None:
        self.mock_model_info = MagicMock(
            return_value={"model_name": "test-hearing-model", "model_version": "1.0"}
        )
        self.llm_response = json.dumps(_make_full_hearing_prep_data())
        self.mock_generate = AsyncMock(return_value=self.llm_response)
        self.mock_retrieve_doc = AsyncMock(return_value=[MagicMock() for _ in range(5)])
        self.mock_retrieve_query = AsyncMock(return_value=[MagicMock() for _ in range(5)])

        self.patches = [
            patch("src.hearing_prep.service.get_model_info", self.mock_model_info),
            patch("src.hearing_prep.service.generate_completion", self.mock_generate),
            patch("src.hearing_prep.service.retrieve_by_document_id", self.mock_retrieve_doc),
            patch("src.hearing_prep.service.retrieve_by_query", self.mock_retrieve_query),
        ]
        for p in self.patches:
            p.start()

    @pytest.fixture(autouse=True)
    def _teardown_mocks(self) -> None:
        yield
        for p in self.patches:
            p.stop()

    @pytest.mark.asyncio
    async def test_successful_generation(self) -> None:
        request = HearingPrepRequest(
            topic="Constructive dismissal hearing",
            document_ids=["doc-001"],
        )
        response = await generate_hearing_prep(request)

        assert isinstance(response, HearingPrepResponse)
        assert len(response.cases) == 2
        assert len(response.provisions) == 1
        assert len(response.arguments) == 1
        assert len(response.counter_arguments) == 1
        assert len(response.suggested_questions) == 3

    @pytest.mark.asyncio
    async def test_with_issue_enriches_query(self) -> None:
        request = HearingPrepRequest(
            topic="Constructive dismissal",
            issue="Whether diminution of benefits constitutes constructive dismissal",
            document_ids=[],
        )
        await generate_hearing_prep(request)

        # Topic search should include the issue text
        call_args = self.mock_retrieve_query.call_args
        query_text = call_args[0][0]
        assert "diminution" in query_text

    @pytest.mark.asyncio
    async def test_retrieves_for_each_document(self) -> None:
        request = HearingPrepRequest(
            topic="Test hearing prep",
            document_ids=["doc-001", "doc-002"],
        )
        await generate_hearing_prep(request)

        assert self.mock_retrieve_doc.call_count == 2

    @pytest.mark.asyncio
    async def test_confidence_in_range(self) -> None:
        request = HearingPrepRequest(
            topic="Hearing prep confidence test",
        )
        response = await generate_hearing_prep(request)

        assert 0.0 <= response.confidence_score <= 1.0

    @pytest.mark.asyncio
    async def test_invalid_llm_response_handled(self) -> None:
        self.mock_generate.return_value = "not json"

        request = HearingPrepRequest(topic="Test invalid response")
        response = await generate_hearing_prep(request)

        assert response.cases == []
        assert response.provisions == []

    @pytest.mark.asyncio
    async def test_non_string_questions_filtered(self) -> None:
        data = _make_full_hearing_prep_data()
        data["suggested_questions"] = ["Valid question?", 42, None, "Another valid?"]
        self.mock_generate.return_value = json.dumps(data)

        request = HearingPrepRequest(topic="Test question filtering")
        response = await generate_hearing_prep(request)

        assert len(response.suggested_questions) == 2

    @pytest.mark.asyncio
    async def test_invalid_entries_filtered(self) -> None:
        data = _make_full_hearing_prep_data()
        data["cases"].append("not a dict")
        data["arguments"].append(None)
        self.mock_generate.return_value = json.dumps(data)

        request = HearingPrepRequest(topic="Test filtering")
        response = await generate_hearing_prep(request)

        # Only valid entries
        assert len(response.cases) == 2
        assert len(response.arguments) == 1

    @pytest.mark.asyncio
    async def test_generation_called_with_json_format(self) -> None:
        request = HearingPrepRequest(topic="Test generation params")
        await generate_hearing_prep(request)

        call_kwargs = self.mock_generate.call_args.kwargs
        assert call_kwargs.get("response_format") == "json_object"
        assert call_kwargs.get("temperature") == 0.2
