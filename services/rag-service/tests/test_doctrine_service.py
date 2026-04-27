"""Tests for doctrines/service.py — doctrine extraction from legal documents.

Tests cover: _determine_strategy, _build_sections_prompt, _parse_extraction_response,
and the full extract_doctrines pipeline with mocked LLM.
"""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.doctrines.schemas import (
    DoctrineExtractionRequest,
    DoctrineExtractionResponse,
    DoctrineType,
    ExtractionStrategy,
    ExtractedDoctrine,
)
from src.doctrines.service import (
    _build_sections_prompt,
    _determine_strategy,
    _parse_extraction_response,
    extract_doctrines,
)


# ---------------------------------------------------------------------------
# Test data factories
# ---------------------------------------------------------------------------


def _make_full_doctrine_data() -> dict[str, Any]:
    """Return a fully populated doctrine extraction response."""
    return {
        "doctrines": [
            {
                "text": "The doctrine of last clear chance provides that the person who had the last opportunity to avoid the accident is the negligent party.",
                "doctrine_type": "ratio_decidendi",
                "confidence": 0.95,
                "source_section": "sec-ruling",
            },
            {
                "text": "In cases of quasi-delict, the burden of proof rests on the plaintiff.",
                "doctrine_type": "evidentiary_rule",
                "confidence": 0.8,
                "source_section": "sec-ruling",
            },
            {
                "text": "The Court observed that comparative negligence may be applied in torts cases.",
                "doctrine_type": "obiter_dictum",
                "confidence": 0.6,
                "source_section": "sec-body",
            },
        ]
    }


def _make_sections() -> list[dict[str, Any]]:
    return [
        {"id": "sec-facts", "section_type": "facts", "plain_text": "The plaintiff was injured in a vehicular accident."},
        {"id": "sec-ruling", "section_type": "ruling", "plain_text": "The Court held that the doctrine of last clear chance applies."},
        {"id": "sec-body", "section_type": "body", "plain_text": "The Court further discussed comparative negligence."},
    ]


def _make_request(**overrides: Any) -> DoctrineExtractionRequest:
    defaults: dict[str, Any] = {
        "document_id": "doc-0001",
        "strategy": ExtractionStrategy.AUTO,
        "sections": _make_sections(),
    }
    defaults.update(overrides)
    return DoctrineExtractionRequest(**defaults)


# ---------------------------------------------------------------------------
# _determine_strategy
# ---------------------------------------------------------------------------


class TestDetermineStrategy:
    def test_explicit_full_text(self) -> None:
        request = _make_request(strategy=ExtractionStrategy.FULL_TEXT)
        assert _determine_strategy(request) == ExtractionStrategy.FULL_TEXT

    def test_explicit_sections_only(self) -> None:
        request = _make_request(strategy=ExtractionStrategy.SECTIONS_ONLY)
        assert _determine_strategy(request) == ExtractionStrategy.SECTIONS_ONLY

    def test_auto_with_sections_selects_sections_only(self) -> None:
        request = _make_request(strategy=ExtractionStrategy.AUTO, sections=_make_sections())
        assert _determine_strategy(request) == ExtractionStrategy.SECTIONS_ONLY

    def test_auto_without_sections_selects_full_text(self) -> None:
        request = _make_request(strategy=ExtractionStrategy.AUTO, sections=None)
        assert _determine_strategy(request) == ExtractionStrategy.FULL_TEXT

    def test_auto_with_empty_sections_selects_full_text(self) -> None:
        request = _make_request(strategy=ExtractionStrategy.AUTO, sections=[])
        assert _determine_strategy(request) == ExtractionStrategy.FULL_TEXT


# ---------------------------------------------------------------------------
# _build_sections_prompt
# ---------------------------------------------------------------------------


class TestBuildSectionsPrompt:
    def test_multiple_sections(self) -> None:
        sections = _make_sections()
        result = _build_sections_prompt(sections)

        assert "[sec-facts]" in result
        assert "(facts)" in result
        assert "[sec-ruling]" in result
        assert "doctrine of last clear chance" in result

    def test_empty_sections_handled(self) -> None:
        sections = [
            {"id": "sec-1", "section_type": "facts", "plain_text": "Content"},
            {"id": "sec-2", "section_type": "ruling", "plain_text": ""},  # Empty text
        ]
        result = _build_sections_prompt(sections)

        assert "[sec-1]" in result
        # sec-2 has empty text, so no SECTION block for it
        assert "[sec-2]" not in result

    def test_missing_fields_default(self) -> None:
        sections = [{"plain_text": "Some doctrine content"}]
        result = _build_sections_prompt(sections)

        assert "[unknown]" in result
        assert "Some doctrine content" in result

    def test_empty_list(self) -> None:
        result = _build_sections_prompt([])
        # Should still return a formatted string (empty sections_text)
        assert isinstance(result, str)


# ---------------------------------------------------------------------------
# _parse_extraction_response
# ---------------------------------------------------------------------------


class TestParseExtractionResponse:
    def test_valid_json_with_sections(self) -> None:
        data = _make_full_doctrine_data()
        request = _make_request()
        result = _parse_extraction_response(json.dumps(data), request)

        assert len(result) == 3
        assert all(isinstance(d, ExtractedDoctrine) for d in result)

    def test_doctrine_types_parsed(self) -> None:
        data = _make_full_doctrine_data()
        request = _make_request()
        result = _parse_extraction_response(json.dumps(data), request)

        assert result[0].doctrine_type == DoctrineType.RATIO_DECIDENDI
        assert result[1].doctrine_type == DoctrineType.EVIDENTIARY_RULE
        assert result[2].doctrine_type == DoctrineType.OBITER_DICTUM

    def test_invalid_doctrine_type_defaults_to_other(self) -> None:
        data = {"doctrines": [{"text": "Some doctrine", "doctrine_type": "INVALID_TYPE", "confidence": 0.5}]}
        request = _make_request()
        result = _parse_extraction_response(json.dumps(data), request)

        assert len(result) == 1
        assert result[0].doctrine_type == DoctrineType.OTHER

    def test_invalid_json_returns_empty(self) -> None:
        request = _make_request()
        result = _parse_extraction_response("not json", request)

        assert result == []

    def test_empty_text_entries_filtered(self) -> None:
        data = {
            "doctrines": [
                {"text": "Valid doctrine", "confidence": 0.8},
                {"text": "", "confidence": 0.5},  # Empty text
                {"text": None, "confidence": 0.5},  # None text
                {"confidence": 0.5},  # Missing text
            ]
        }
        request = _make_request()
        result = _parse_extraction_response(json.dumps(data), request)

        assert len(result) == 1

    def test_non_dict_entries_filtered(self) -> None:
        data = {
            "doctrines": [
                {"text": "Valid", "confidence": 0.8},
                "not a dict",
                42,
                None,
            ]
        }
        request = _make_request()
        result = _parse_extraction_response(json.dumps(data), request)

        assert len(result) == 1

    def test_confidence_clamped_to_range(self) -> None:
        data = {
            "doctrines": [
                {"text": "Doctrine with high confidence", "confidence": 1.5},
                {"text": "Doctrine with negative confidence", "confidence": -0.2},
            ]
        }
        request = _make_request()
        result = _parse_extraction_response(json.dumps(data), request)

        assert result[0].confidence == 1.0
        assert result[1].confidence == 0.0

    def test_invalid_confidence_defaults_to_half(self) -> None:
        data = {
            "doctrines": [
                {"text": "Doctrine", "confidence": "invalid"},
            ]
        }
        request = _make_request()
        result = _parse_extraction_response(json.dumps(data), request)

        assert result[0].confidence == 0.5

    def test_section_id_resolved_from_map(self) -> None:
        data = {
            "doctrines": [
                {"text": "A doctrine", "confidence": 0.8, "source_section": "sec-ruling"},
            ]
        }
        request = _make_request(sections=_make_sections())
        result = _parse_extraction_response(json.dumps(data), request)

        assert result[0].source_section_id == "sec-ruling"

    def test_section_id_resolved_by_type(self) -> None:
        data = {
            "doctrines": [
                {"text": "A doctrine", "confidence": 0.8, "source_section": "ruling"},
            ]
        }
        request = _make_request(sections=_make_sections())
        result = _parse_extraction_response(json.dumps(data), request)

        # "ruling" maps to "sec-ruling" via section_map
        assert result[0].source_section_id == "sec-ruling"

    def test_unresolved_section_id(self) -> None:
        data = {
            "doctrines": [
                {"text": "A doctrine", "confidence": 0.8, "source_section": "unknown-section"},
            ]
        }
        request = _make_request(sections=_make_sections())
        result = _parse_extraction_response(json.dumps(data), request)

        assert result[0].source_section_id is None

    def test_normalized_text_truncated(self) -> None:
        long_text = "A" * 600
        data = {"doctrines": [{"text": long_text, "confidence": 0.8}]}
        request = _make_request()
        result = _parse_extraction_response(json.dumps(data), request)

        assert len(result[0].normalized_text) == 500


# ---------------------------------------------------------------------------
# extract_doctrines — full pipeline
# ---------------------------------------------------------------------------


class TestExtractDoctrines:
    """Test the full extract_doctrines function with mocked LLM."""

    @pytest.fixture(autouse=True)
    def _setup_mocks(self) -> None:
        self.mock_model_info = MagicMock(
            return_value={"model_name": "test-doctrine-model", "model_version": "1.0"}
        )
        # PR #82 switched ``doctrines.service`` from ``generate_completion``
        # to ``generate_completion_with_usage`` so token usage flows back
        # for per-batch cost telemetry. Mirror the new return shape:
        # ``{content, model_name, tokens_in, tokens_out}``.
        self.llm_response = {
            "content": json.dumps(_make_full_doctrine_data()),
            "model_name": "test-doctrine-model",
            "tokens_in": 0,
            "tokens_out": 0,
        }
        self.mock_generate = AsyncMock(return_value=self.llm_response)

        self.patches = [
            patch("src.doctrines.service.get_model_info", self.mock_model_info),
            patch(
                "src.doctrines.service.generate_completion_with_usage",
                self.mock_generate,
            ),
        ]
        for p in self.patches:
            p.start()

    @pytest.fixture(autouse=True)
    def _teardown_mocks(self) -> None:
        yield
        for p in self.patches:
            p.stop()

    @pytest.mark.asyncio
    async def test_successful_extraction_with_sections(self) -> None:
        request = _make_request()
        response = await extract_doctrines(request)

        assert isinstance(response, DoctrineExtractionResponse)
        assert response.document_id == "doc-0001"
        assert len(response.doctrines) == 3
        assert response.strategy_used == "sections_only"
        assert response.model_name == "test-doctrine-model"

    @pytest.mark.asyncio
    async def test_full_text_strategy_with_document_text(self) -> None:
        request = _make_request(
            strategy=ExtractionStrategy.FULL_TEXT,
            document_text="This is the full text of the legal document. " * 20,
            sections=None,
        )
        response = await extract_doctrines(request)

        assert response.strategy_used == "full_text"
        assert len(response.doctrines) == 3

    @pytest.mark.asyncio
    @patch("src.doctrines.service._fetch_document_text", new_callable=AsyncMock)
    async def test_full_text_strategy_fetches_from_db(self, mock_fetch: AsyncMock) -> None:
        mock_fetch.return_value = "Fetched document text content. " * 20

        request = _make_request(
            strategy=ExtractionStrategy.FULL_TEXT,
            document_text=None,
            sections=None,
        )
        response = await extract_doctrines(request)

        mock_fetch.assert_called_once_with("doc-0001")
        assert response.strategy_used == "full_text"

    @pytest.mark.asyncio
    async def test_invalid_llm_response_returns_empty(self) -> None:
        self.mock_generate.return_value = {
            "content": "not json",
            "model_name": "test-doctrine-model",
            "tokens_in": 0,
            "tokens_out": 0,
        }

        request = _make_request()
        response = await extract_doctrines(request)

        assert response.doctrines == []

    @pytest.mark.asyncio
    async def test_generation_called_with_json_format(self) -> None:
        request = _make_request()
        await extract_doctrines(request)

        call_kwargs = self.mock_generate.call_args.kwargs
        assert call_kwargs.get("response_format") == "json_object"
        assert call_kwargs.get("temperature") == 0.1

    @pytest.mark.asyncio
    async def test_auto_strategy_resolves_correctly(self) -> None:
        # With sections → sections_only
        request = _make_request(strategy=ExtractionStrategy.AUTO)
        response = await extract_doctrines(request)
        assert response.strategy_used == "sections_only"
