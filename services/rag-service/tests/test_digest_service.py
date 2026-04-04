"""Tests for digests/service.py — DFIR+ digest generation.

Tests cover: _format_sections, _parse_digest_response, _extract_provenance,
_compute_confidence, and the full generate_digest pipeline with mocked LLM.
"""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.digests.schemas import (
    DigestGenerationRequest,
    DigestGenerationResponse,
    DocumentSectionInput,
    ProvenanceEntry,
)
from src.digests.service import (
    _compute_confidence,
    _extract_provenance,
    _format_sections,
    _parse_digest_response,
    generate_digest,
)


# ---------------------------------------------------------------------------
# Test helpers
# ---------------------------------------------------------------------------


def _make_section(**overrides: Any) -> DocumentSectionInput:
    defaults: dict[str, Any] = {
        "id": "sec-001",
        "section_type": "facts",
        "section_label": "Statement of Facts",
        "plain_text": "The petitioner filed a complaint for damages.",
        "page_start": 1,
        "page_end": 3,
    }
    defaults.update(overrides)
    return DocumentSectionInput(**defaults)


def _make_full_digest_data() -> dict[str, Any]:
    """Return a fully populated DFIR+ digest response."""
    return {
        "summary": "This case involves a petition for certiorari.",
        "facts": "The petitioner was dismissed from employment.",
        "petitioner_arguments": "The petitioner argues wrongful termination.",
        "respondent_arguments": "The respondent argues just cause.",
        "issues": "Whether the dismissal was legal.",
        "ruling": "The court ruled in favor of the petitioner.",
        "doctrine": "The doctrine of due process in labor cases.",
        "dispositive": "WHEREFORE, the petition is GRANTED.",
        "cited_authorities": [
            {
                "citation_text": "People v. Santos, G.R. No. 123456",
                "document_type": "case",
                "gr_no": "G.R. No. 123456",
            }
        ],
        "provenance": [
            {
                "field": "facts",
                "source_section_id": "sec-001",
                "source_document_id": "doc-0001",
            },
            {
                "field": "ruling",
                "source_section_id": "sec-002",
                "source_document_id": "doc-0001",
            },
        ],
    }


# ---------------------------------------------------------------------------
# _format_sections
# ---------------------------------------------------------------------------


class TestFormatSections:
    def test_single_section(self) -> None:
        section = _make_section()
        result = _format_sections([section])

        assert "[§sec-001]" in result
        assert "Statement of Facts" in result
        assert "pages 1-3" in result
        assert "petitioner filed" in result

    def test_multiple_sections(self) -> None:
        sections = [
            _make_section(id="sec-001", section_label="Facts", plain_text="Fact text."),
            _make_section(
                id="sec-002", section_label="Ruling", plain_text="Ruling text."
            ),
        ]
        result = _format_sections(sections)

        assert "[§sec-001] Facts" in result
        assert "[§sec-002] Ruling" in result
        assert "Fact text." in result
        assert "Ruling text." in result

    def test_empty_section_skipped(self) -> None:
        sections = [
            _make_section(id="sec-001", plain_text="Has content"),
            _make_section(id="sec-002", plain_text=""),
            _make_section(id="sec-003", plain_text="   "),
            _make_section(id="sec-004", plain_text=None),
        ]
        result = _format_sections(sections)

        assert "[§sec-001]" in result
        assert "[§sec-002]" not in result
        assert "[§sec-003]" not in result
        assert "[§sec-004]" not in result

    def test_label_fallback_to_section_type(self) -> None:
        section = _make_section(section_label=None, section_type="headnote")
        result = _format_sections([section])

        assert "[§sec-001] headnote" in result

    def test_no_page_numbers(self) -> None:
        section = _make_section(page_start=None, page_end=None)
        result = _format_sections([section])

        assert "pages" not in result

    def test_single_page(self) -> None:
        section = _make_section(page_start=5, page_end=None)
        result = _format_sections([section])

        assert "pages 5-5" in result

    def test_text_is_stripped(self) -> None:
        section = _make_section(plain_text="  trimmed content  \n\n")
        result = _format_sections([section])

        assert "trimmed content" in result
        assert not result.endswith("  \n\n")

    def test_empty_list_returns_empty_string(self) -> None:
        assert _format_sections([]) == ""


# ---------------------------------------------------------------------------
# _parse_digest_response
# ---------------------------------------------------------------------------


class TestParseDigestResponse:
    def test_valid_json(self) -> None:
        data = _make_full_digest_data()
        result = _parse_digest_response(json.dumps(data))

        assert result["summary"] == data["summary"]
        assert result["facts"] == data["facts"]
        assert len(result["cited_authorities"]) == 1
        assert len(result["provenance"]) == 2

    def test_invalid_json_returns_empty_structure(self) -> None:
        result = _parse_digest_response("this is not JSON")

        assert result["summary"] is None
        assert result["facts"] is None
        assert result["issues"] is None
        assert result["ruling"] is None
        assert result["doctrine"] is None
        assert result["dispositive"] is None
        assert result["cited_authorities"] == []
        assert result["provenance"] == []

    def test_partial_json_parses_correctly(self) -> None:
        """If LLM returns only some fields, the rest default to what JSON gives."""
        partial = json.dumps({"summary": "A brief summary", "facts": "Some facts"})
        result = _parse_digest_response(partial)

        assert result["summary"] == "A brief summary"
        assert result["facts"] == "Some facts"
        # Fields not present return None via dict.get
        assert result.get("ruling") is None

    def test_empty_json_object(self) -> None:
        result = _parse_digest_response("{}")
        assert result.get("summary") is None
        assert result.get("cited_authorities") is None


# ---------------------------------------------------------------------------
# _extract_provenance
# ---------------------------------------------------------------------------


class TestExtractProvenance:
    def test_valid_provenance_entries(self) -> None:
        data = _make_full_digest_data()
        entries = _extract_provenance(data, "doc-main")

        assert len(entries) == 2
        assert all(isinstance(e, ProvenanceEntry) for e in entries)
        assert entries[0].field == "facts"
        assert entries[0].source_section_id == "sec-001"

    def test_provenance_fills_in_document_id(self) -> None:
        data = {
            "provenance": [
                {"field": "ruling", "source_section_id": "sec-xyz"},
            ],
        }
        entries = _extract_provenance(data, "doc-main")

        assert len(entries) == 1
        assert entries[0].source_document_id == "doc-main"

    def test_provenance_preserves_explicit_document_id(self) -> None:
        data = {
            "provenance": [
                {
                    "field": "ruling",
                    "source_section_id": "sec-xyz",
                    "source_document_id": "doc-other",
                },
            ],
        }
        entries = _extract_provenance(data, "doc-main")

        assert entries[0].source_document_id == "doc-other"

    def test_invalid_provenance_entries_skipped(self) -> None:
        data = {
            "provenance": [
                {"field": "facts"},  # missing section_id
                {"source_section_id": "sec-001"},  # missing field
                "not a dict",
                None,
                {"field": "ruling", "source_section_id": "sec-002"},  # valid
            ],
        }
        entries = _extract_provenance(data, "doc-main")

        assert len(entries) == 1
        assert entries[0].field == "ruling"

    def test_no_provenance_key(self) -> None:
        entries = _extract_provenance({}, "doc-main")
        assert entries == []

    def test_empty_provenance_list(self) -> None:
        entries = _extract_provenance({"provenance": []}, "doc-main")
        assert entries == []


# ---------------------------------------------------------------------------
# _compute_confidence
# ---------------------------------------------------------------------------


class TestComputeConfidence:
    def _make_sections(self, count: int) -> list[DocumentSectionInput]:
        return [
            _make_section(id=f"sec-{i}", plain_text=f"Text {i}")
            for i in range(count)
        ]

    def test_all_fields_filled_with_provenance(self) -> None:
        data = _make_full_digest_data()
        sections = self._make_sections(5)
        confidence = _compute_confidence(data, sections)

        # All 8 fields filled (8/6 = capped at 1.0), provenance exists, 5 sections
        assert confidence > 0.7

    def test_empty_digest_low_confidence(self) -> None:
        data = {
            "summary": None,
            "facts": None,
            "issues": None,
            "ruling": None,
            "doctrine": None,
            "dispositive": None,
        }
        sections = self._make_sections(1)
        confidence = _compute_confidence(data, sections)

        assert confidence < 0.4

    def test_partial_fields_medium_confidence(self) -> None:
        data = {
            "summary": "A summary",
            "facts": "Some facts",
            "issues": "An issue",
            "ruling": None,
            "doctrine": None,
            "dispositive": None,
        }
        sections = self._make_sections(3)
        confidence = _compute_confidence(data, sections)

        # 3/6 coverage (0.5), no provenance (0.0), 3 sections (1.0)
        # = 0.5*0.4 + 0.0*0.3 + 1.0*0.3 = 0.5
        assert 0.3 <= confidence <= 0.6

    def test_optional_fields_not_penalized(self) -> None:
        """petitioner_arguments and respondent_arguments are optional."""
        data_with = _make_full_digest_data()
        data_without = {**data_with}
        data_without["petitioner_arguments"] = None
        data_without["respondent_arguments"] = None

        sections = self._make_sections(5)
        conf_with = _compute_confidence(data_with, sections)
        conf_without = _compute_confidence(data_without, sections)

        # Both should be close to 1.0 since required fields denominator is 6
        # The 'without' should have slightly less coverage since 6/6 vs 8/6
        # but source_coverage is capped at 1.0 anyway
        assert conf_with >= 0.7
        assert conf_without >= 0.5

    def test_provenance_boosts_confidence(self) -> None:
        data_no_prov = {
            "summary": "A summary",
            "facts": "Some facts",
            "issues": "An issue",
            "ruling": "The ruling",
            "doctrine": "The doctrine",
            "dispositive": "GRANTED",
        }
        data_with_prov = {
            **data_no_prov,
            "provenance": [
                {"field": f, "source_section_id": f"sec-{i}"}
                for i, f in enumerate(
                    ["summary", "facts", "issues", "ruling", "doctrine", "dispositive"]
                )
            ],
        }
        sections = self._make_sections(5)

        conf_no = _compute_confidence(data_no_prov, sections)
        conf_with = _compute_confidence(data_with_prov, sections)

        assert conf_with > conf_no

    def test_more_sections_higher_factor(self) -> None:
        data = _make_full_digest_data()
        sections_1 = self._make_sections(1)
        sections_5 = self._make_sections(5)

        conf_1 = _compute_confidence(data, sections_1)
        conf_5 = _compute_confidence(data, sections_5)

        assert conf_5 > conf_1

    def test_section_factor_caps_at_three(self) -> None:
        data = _make_full_digest_data()
        sections_3 = self._make_sections(3)
        sections_10 = self._make_sections(10)

        conf_3 = _compute_confidence(data, sections_3)
        conf_10 = _compute_confidence(data, sections_10)

        # section_factor is min(count/3, 1.0), so 3 and 10 both give 1.0
        assert conf_3 == conf_10

    def test_empty_text_sections_not_counted(self) -> None:
        data = _make_full_digest_data()
        sections = [
            _make_section(id="sec-1", plain_text="Has content"),
            _make_section(id="sec-2", plain_text=""),
            _make_section(id="sec-3", plain_text=None),
        ]

        confidence = _compute_confidence(data, sections)
        # Only 1 section counts → section_factor = 1/3 ≈ 0.33
        assert confidence > 0.0

    def test_confidence_range_0_to_1(self) -> None:
        """Confidence should always be between 0 and 1."""
        data = _make_full_digest_data()
        sections = self._make_sections(10)
        confidence = _compute_confidence(data, sections)

        assert 0.0 <= confidence <= 1.0

    def test_confidence_is_rounded(self) -> None:
        data = _make_full_digest_data()
        sections = self._make_sections(3)
        confidence = _compute_confidence(data, sections)

        # Should be rounded to 2 decimal places
        assert confidence == round(confidence, 2)


# ---------------------------------------------------------------------------
# generate_digest — full pipeline
# ---------------------------------------------------------------------------


class TestGenerateDigest:
    """Test the full generate_digest function with mocked LLM."""

    @pytest.fixture(autouse=True)
    def _setup_mocks(self) -> None:
        self.mock_model_info = MagicMock(
            return_value={"model_name": "test-digest-model", "model_version": "1.0"}
        )
        self.llm_response = json.dumps(_make_full_digest_data())
        self.mock_generate = AsyncMock(return_value=self.llm_response)

        self.patches = [
            patch("src.digests.service.get_model_info", self.mock_model_info),
            patch("src.digests.service.generate_completion", self.mock_generate),
        ]
        for p in self.patches:
            p.start()

    @pytest.fixture(autouse=True)
    def _teardown_mocks(self) -> None:
        yield
        for p in self.patches:
            p.stop()

    @pytest.mark.asyncio
    async def test_successful_digest_generation(self) -> None:
        request = DigestGenerationRequest(
            document_id="doc-0001",
            sections=[
                _make_section(id="sec-001", section_label="Facts"),
                _make_section(id="sec-002", section_label="Ruling"),
                _make_section(id="sec-003", section_label="Dispositive"),
            ],
        )
        response = await generate_digest(request)

        assert isinstance(response, DigestGenerationResponse)
        assert response.summary is not None
        assert response.facts is not None
        assert response.ruling is not None
        assert response.model_name == "test-digest-model"
        assert response.prompt_template_version == "digest_dfir_plus_v1"

    @pytest.mark.asyncio
    async def test_confidence_score_in_range(self) -> None:
        request = DigestGenerationRequest(
            document_id="doc-0001",
            sections=[_make_section(id="sec-001")],
        )
        response = await generate_digest(request)

        assert 0.0 <= response.confidence_score <= 1.0

    @pytest.mark.asyncio
    async def test_cited_authorities_parsed(self) -> None:
        request = DigestGenerationRequest(
            document_id="doc-0001",
            sections=[_make_section()],
        )
        response = await generate_digest(request)

        assert len(response.cited_authorities) == 1
        assert response.cited_authorities[0].citation_text == "People v. Santos, G.R. No. 123456"
        assert response.cited_authorities[0].gr_no == "G.R. No. 123456"

    @pytest.mark.asyncio
    async def test_provenance_entries_populated(self) -> None:
        request = DigestGenerationRequest(
            document_id="doc-0001",
            sections=[_make_section()],
        )
        response = await generate_digest(request)

        assert len(response.provenance) == 2
        assert response.provenance[0].field == "facts"

    @pytest.mark.asyncio
    async def test_invalid_json_returns_null_fields(self) -> None:
        """When LLM returns invalid JSON, all digest fields should be None."""
        self.mock_generate.return_value = "This is not valid JSON output"

        request = DigestGenerationRequest(
            document_id="doc-0001",
            sections=[_make_section()],
        )
        response = await generate_digest(request)

        assert response.summary is None
        assert response.facts is None
        assert response.ruling is None
        assert response.cited_authorities == []
        assert response.provenance == []

    @pytest.mark.asyncio
    async def test_empty_sections_handled(self) -> None:
        """Generating a digest with no usable sections should still work."""
        request = DigestGenerationRequest(
            document_id="doc-0001",
            sections=[_make_section(plain_text="")],
        )
        response = await generate_digest(request)

        # Should still return a valid response (from LLM mock)
        assert isinstance(response, DigestGenerationResponse)

    @pytest.mark.asyncio
    async def test_cited_authorities_filters_invalid(self) -> None:
        """Cited authorities without citation_text should be filtered out."""
        data = _make_full_digest_data()
        data["cited_authorities"] = [
            {"citation_text": "Valid Case", "document_type": "case"},
            {"document_type": "case"},  # missing citation_text
            {"citation_text": "", "document_type": "case"},  # empty citation_text
            "not a dict",
        ]
        self.mock_generate.return_value = json.dumps(data)

        request = DigestGenerationRequest(
            document_id="doc-0001",
            sections=[_make_section()],
        )
        response = await generate_digest(request)

        assert len(response.cited_authorities) == 1
        assert response.cited_authorities[0].citation_text == "Valid Case"

    @pytest.mark.asyncio
    async def test_generation_called_with_json_format(self) -> None:
        request = DigestGenerationRequest(
            document_id="doc-0001",
            sections=[_make_section()],
        )
        await generate_digest(request)

        self.mock_generate.assert_called_once()
        call_kwargs = self.mock_generate.call_args.kwargs
        assert call_kwargs.get("response_format") == "json_object"
        assert call_kwargs.get("temperature") == 0.2

    @pytest.mark.asyncio
    async def test_null_empty_string_fields_become_none(self) -> None:
        """Fields that are empty strings or null should become None in response."""
        data = _make_full_digest_data()
        data["petitioner_arguments"] = ""
        data["respondent_arguments"] = None
        self.mock_generate.return_value = json.dumps(data)

        request = DigestGenerationRequest(
            document_id="doc-0001",
            sections=[_make_section()],
        )
        response = await generate_digest(request)

        # Empty string is falsy, so `or None` makes it None
        assert response.petitioner_arguments is None
        assert response.respondent_arguments is None
