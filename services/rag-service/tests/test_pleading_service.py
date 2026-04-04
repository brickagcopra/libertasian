"""Tests for pleadings/service.py — legal pleading generation.

Tests cover: _build_search_query, _format_input_data, _parse_pleading_response,
_compute_confidence, and the full generate_pleading pipeline with mocked LLM.
"""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.pleadings.schemas import (
    PleadingGenerationRequest,
    PleadingGenerationResponse,
)
from src.pleadings.service import (
    _build_search_query,
    _compute_confidence,
    _format_input_data,
    _parse_pleading_response,
    generate_pleading,
)


# ---------------------------------------------------------------------------
# Test data factories
# ---------------------------------------------------------------------------


def _make_full_pleading_data() -> dict[str, Any]:
    """Return a fully populated pleading response."""
    return {
        "title": "Complaint for Damages",
        "sections": [
            {
                "key": "caption",
                "heading": "Caption",
                "content": "REPUBLIC OF THE PHILIPPINES\nRegional Trial Court\nBranch 1, Manila",
                "citations": [],
            },
            {
                "key": "cause_of_action",
                "heading": "Cause of Action",
                "content": "The plaintiff suffered damages due to defendant's negligent acts.",
                "citations": [
                    {"source_id": "doc-0001", "section_id": "sec-001", "text": "Art. 2176 NCC"},
                ],
            },
            {
                "key": "prayer",
                "heading": "Prayer",
                "content": "WHEREFORE, plaintiff prays that judgment be rendered in their favor.",
                "citations": [],
            },
        ],
        "all_citations": [
            {"source_id": "doc-0001", "section_id": "sec-001", "text": "Art. 2176 NCC"},
        ],
    }


def _make_passages(count: int) -> list[MagicMock]:
    return [MagicMock() for _ in range(count)]


def _make_request(**overrides: Any) -> PleadingGenerationRequest:
    defaults: dict[str, Any] = {
        "template_name": "Complaint for Damages",
        "template_category": "civil",
        "template_json": {
            "sections": [
                {"key": "caption", "label": "Caption"},
                {"key": "cause_of_action", "label": "Cause of Action"},
                {"key": "prayer", "label": "Prayer"},
            ]
        },
        "input_data": {
            "cause_of_action": "Negligence under Art. 2176",
            "legal_basis": "New Civil Code",
        },
    }
    defaults.update(overrides)
    return PleadingGenerationRequest(**defaults)


# ---------------------------------------------------------------------------
# _build_search_query
# ---------------------------------------------------------------------------


class TestBuildSearchQuery:
    def test_with_context_query(self) -> None:
        request = _make_request(context_query="Quasi-delict damages")
        result = _build_search_query(request)

        assert "Quasi-delict damages" in result

    def test_extracts_cause_of_action(self) -> None:
        request = _make_request(context_query=None)
        result = _build_search_query(request)

        assert "Negligence under Art. 2176" in result

    def test_extracts_legal_basis(self) -> None:
        request = _make_request(context_query=None)
        result = _build_search_query(request)

        assert "New Civil Code" in result

    def test_fallback_to_template_info(self) -> None:
        request = _make_request(
            context_query=None,
            input_data={},
        )
        result = _build_search_query(request)

        assert "civil" in result
        assert "Complaint for Damages" in result

    def test_truncated_to_500_chars(self) -> None:
        request = _make_request(
            context_query="A" * 600,
            input_data={"cause_of_action": "B" * 200},
        )
        result = _build_search_query(request)

        assert len(result) <= 500

    def test_extracts_multiple_keys(self) -> None:
        request = _make_request(
            context_query=None,
            input_data={
                "cause_of_action": "Negligence",
                "grounds": "Breach of duty",
                "issues": "Proximate cause",
                "unrelated_key": "Should not appear in search",
            },
        )
        result = _build_search_query(request)

        assert "Negligence" in result
        assert "Breach of duty" in result
        assert "Proximate cause" in result
        # unrelated_key not in the extraction list
        assert "Should not appear" not in result


# ---------------------------------------------------------------------------
# _format_input_data
# ---------------------------------------------------------------------------


class TestFormatInputData:
    def test_basic_key_value(self) -> None:
        result = _format_input_data(
            {"plaintiff": "John Doe", "defendant": "Jane Smith"},
            None,
        )

        assert "Plaintiff: John Doe" in result
        assert "Defendant: Jane Smith" in result

    def test_uses_template_labels(self) -> None:
        template_json = {
            "sections": [
                {"key": "cause_of_action", "label": "Cause of Action"},
            ]
        }
        result = _format_input_data(
            {"cause_of_action": "Negligence"},
            template_json,
        )

        assert "Cause of Action: Negligence" in result

    def test_list_values(self) -> None:
        result = _format_input_data(
            {"witnesses": ["Alice", "Bob", "Charlie"]},
            None,
        )

        assert "Alice" in result
        assert "Bob" in result
        assert "Charlie" in result

    def test_dict_values(self) -> None:
        result = _format_input_data(
            {"details": {"amount": 100000, "currency": "PHP"}},
            None,
        )

        assert "100000" in result
        assert "PHP" in result

    def test_empty_input(self) -> None:
        result = _format_input_data({}, None)
        assert result == "(No input data provided)"

    def test_fallback_label_formatting(self) -> None:
        result = _format_input_data(
            {"subject_matter": "Contract dispute"},
            None,  # No template
        )

        assert "Subject Matter: Contract dispute" in result


# ---------------------------------------------------------------------------
# _parse_pleading_response
# ---------------------------------------------------------------------------


class TestParsePleadingResponse:
    def test_valid_json(self) -> None:
        data = _make_full_pleading_data()
        result = _parse_pleading_response(json.dumps(data))

        assert result["title"] == "Complaint for Damages"
        assert len(result["sections"]) == 3

    def test_invalid_json_returns_error_structure(self) -> None:
        result = _parse_pleading_response("not valid JSON")

        assert result["title"] == "Pleading Generation Error"
        assert result["sections"] == []
        assert result["all_citations"] == []

    def test_empty_string(self) -> None:
        result = _parse_pleading_response("")
        assert result["title"] == "Pleading Generation Error"


# ---------------------------------------------------------------------------
# _compute_confidence
# ---------------------------------------------------------------------------


class TestComputePleadingConfidence:
    def test_full_pleading_high_confidence(self) -> None:
        data = _make_full_pleading_data()
        passages = _make_passages(5)
        confidence = _compute_confidence(data, passages)

        # 3/3 content (1.0), 1/3 citations (0.33), 5/5 passages (1.0)
        # = 1.0*0.4 + 0.33*0.3 + 1.0*0.3 = 0.4 + 0.1 + 0.3 = 0.8
        assert confidence >= 0.7

    def test_no_sections_returns_low(self) -> None:
        data = {"sections": []}
        passages = _make_passages(5)
        confidence = _compute_confidence(data, passages)

        assert confidence == 0.3

    def test_sections_without_citations(self) -> None:
        data = {
            "sections": [
                {"heading": "A", "content": "Content"},
                {"heading": "B", "content": "More content"},
            ]
        }
        passages = _make_passages(5)
        confidence = _compute_confidence(data, passages)

        # section_coverage=1.0, citation_density=0.0, passage_factor=1.0
        assert 0.6 <= confidence <= 0.8

    def test_confidence_in_range(self) -> None:
        data = _make_full_pleading_data()
        passages = _make_passages(10)
        confidence = _compute_confidence(data, passages)

        assert 0.0 <= confidence <= 1.0

    def test_confidence_is_rounded(self) -> None:
        data = _make_full_pleading_data()
        passages = _make_passages(3)
        confidence = _compute_confidence(data, passages)

        assert confidence == round(confidence, 2)


# ---------------------------------------------------------------------------
# generate_pleading — full pipeline
# ---------------------------------------------------------------------------


class TestGeneratePleading:
    """Test the full generate_pleading function with mocked dependencies."""

    @pytest.fixture(autouse=True)
    def _setup_mocks(self) -> None:
        self.mock_model_info = MagicMock(
            return_value={"model_name": "test-pleading-model", "model_version": "1.0"}
        )
        self.llm_response = json.dumps(_make_full_pleading_data())
        self.mock_generate = AsyncMock(return_value=self.llm_response)
        self.mock_retrieve = AsyncMock(return_value=_make_passages(5))

        self.patches = [
            patch("src.pleadings.service.get_model_info", self.mock_model_info),
            patch("src.pleadings.service.generate_completion", self.mock_generate),
            patch("src.pleadings.service.retrieve_by_query", self.mock_retrieve),
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
        request = _make_request()
        response = await generate_pleading(request)

        assert isinstance(response, PleadingGenerationResponse)
        assert response.title == "Complaint for Damages"
        assert len(response.sections) == 3
        assert response.model_name == "test-pleading-model"

    @pytest.mark.asyncio
    async def test_confidence_in_range(self) -> None:
        request = _make_request()
        response = await generate_pleading(request)

        assert 0.0 <= response.confidence_score <= 1.0

    @pytest.mark.asyncio
    async def test_citations_parsed(self) -> None:
        request = _make_request()
        response = await generate_pleading(request)

        assert len(response.citations) == 1
        assert response.citations[0].source_id == "doc-0001"

    @pytest.mark.asyncio
    async def test_invalid_llm_response_handled(self) -> None:
        self.mock_generate.return_value = "not json"

        request = _make_request()
        response = await generate_pleading(request)

        assert response.title == "Pleading Generation Error"  # From _parse_pleading_response fallback
        assert response.sections == []

    @pytest.mark.asyncio
    async def test_section_citations_filter_invalid(self) -> None:
        data = _make_full_pleading_data()
        data["sections"][1]["citations"] = [
            {"source_id": "doc-0001", "text": "Valid"},
            {"text": "No source_id"},
            "not a dict",
        ]
        self.mock_generate.return_value = json.dumps(data)

        request = _make_request()
        response = await generate_pleading(request)

        assert len(response.sections[1].citations) == 1

    @pytest.mark.asyncio
    async def test_generation_called_with_json_format(self) -> None:
        request = _make_request()
        await generate_pleading(request)

        call_kwargs = self.mock_generate.call_args.kwargs
        assert call_kwargs.get("response_format") == "json_object"
        assert call_kwargs.get("temperature") == 0.2

    @pytest.mark.asyncio
    async def test_context_query_used_in_prompt(self) -> None:
        request = _make_request(context_query="quasi-delict liability")
        await generate_pleading(request)

        # Check that retrieve was called with a query containing context_query
        call_args = self.mock_retrieve.call_args
        assert "quasi-delict" in call_args[0][0]
