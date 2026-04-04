"""Tests for src.core.validation — citation extraction and validation."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from src.core.validation import (
    _detect_unsupported_claims,
    _extract_citations,
    validate_citations,
)

# UUIDs for test data — the SOURCE regex only matches [0-9a-f-]+
_UUID_A = "aaa11111-1111-1111-1111-111111111111"
_UUID_B = "bbb22222-2222-2222-2222-222222222222"
_UUID_C = "ccc33333-3333-3333-3333-333333333333"
_UUID_SEC = "ddd44444-4444-4444-4444-444444444444"
_UUID_EXT = "eee55555-5555-5555-5555-555555555555"


class TestExtractCitations:
    """_extract_citations — regex-based SOURCE reference extraction."""

    def test_no_citations(self):
        result = _extract_citations("This is a plain text response.")
        assert len(result) == 0

    def test_single_source_ref(self):
        text = f"The court held [SOURCE {_UUID_A}] that..."
        result = _extract_citations(text)
        assert len(result) == 1
        assert result[0].source_id == _UUID_A

    def test_source_with_section(self):
        text = f"[SOURCE {_UUID_A}§{_UUID_SEC}] ruling"
        result = _extract_citations(text)
        assert len(result) == 1
        assert result[0].section_id is not None

    def test_multiple_citations(self):
        text = (
            f"As held in [SOURCE {_UUID_A}] and confirmed in [SOURCE {_UUID_B}], "
            "the principle applies."
        )
        result = _extract_citations(text)
        assert len(result) == 2

    def test_deduplication(self):
        text = (
            f"See [SOURCE {_UUID_A}] and again [SOURCE {_UUID_A}] for emphasis."
        )
        result = _extract_citations(text)
        assert len(result) == 1

    def test_parenthetical_source(self):
        text = f"The ruling (SOURCE {_UUID_A}) supports this."
        result = _extract_citations(text)
        assert len(result) == 1


class TestDetectUnsupportedClaims:
    """_detect_unsupported_claims — heuristic legal assertion detection."""

    def test_no_assertions(self):
        text = "This is a general statement about legal matters."
        result = _detect_unsupported_claims(text)
        assert len(result) == 0

    def test_assertion_without_citation(self):
        text = "The court held that the accused is guilty."
        result = _detect_unsupported_claims(text)
        assert len(result) >= 1

    def test_assertion_with_citation(self):
        text = f"The court held [SOURCE {_UUID_A}] that the accused is guilty."
        result = _detect_unsupported_claims(text)
        assert len(result) == 0

    def test_settled_law_without_citation(self):
        text = "It is well-settled that contracts require consideration."
        result = _detect_unsupported_claims(text)
        assert len(result) >= 1

    def test_multiple_unsupported_assertions(self):
        text = (
            "The court held that negligence was proven. "
            "It is settled that due process was violated. "
            "The law provides that damages are recoverable."
        )
        result = _detect_unsupported_claims(text)
        assert len(result) >= 2


@pytest.mark.asyncio
class TestValidateCitations:
    """validate_citations — end-to-end async citation validation."""

    async def test_plain_text_no_citations(self, make_passage):
        passages = [make_passage()]
        result = await validate_citations("No citations here.", passages)
        assert result.total_count == 0

    async def test_all_citations_in_passages(self, make_passage):
        p = make_passage(document_id=_UUID_A)
        text = f"The court held [SOURCE {_UUID_A}] that negligence was proven."
        result = await validate_citations(text, [p])
        assert result.valid_count >= 1
        assert len(result.invalid_citations) == 0

    @patch("src.core.validation.fetch_documents_by_ids")
    async def test_db_lookup_success(self, mock_fetch, make_passage):
        mock_fetch.return_value = [{"id": _UUID_EXT}]
        passages = [make_passage(document_id=_UUID_A)]
        text = f"See [SOURCE {_UUID_EXT}] for reference."
        result = await validate_citations(text, passages)
        assert result.valid_count >= 1
        mock_fetch.assert_called_once()

    @patch("src.core.validation.fetch_documents_by_ids")
    async def test_db_lookup_not_found(self, mock_fetch, make_passage):
        mock_fetch.return_value = []
        passages = [make_passage(document_id=_UUID_A)]
        text = f"See [SOURCE {_UUID_B}] for reference."
        result = await validate_citations(text, passages)
        assert len(result.invalid_citations) >= 1

    @patch("src.core.validation.fetch_documents_by_ids")
    async def test_db_exception_marks_invalid(self, mock_fetch, make_passage):
        """DB errors should fail safe — mark unverified citations as invalid."""
        mock_fetch.side_effect = Exception("Connection refused")
        passages = [make_passage(document_id=_UUID_A)]
        text = f"See [SOURCE {_UUID_C}] for reference."
        result = await validate_citations(text, passages)
        assert len(result.invalid_citations) >= 1

    async def test_mixed_valid_and_unsupported(self, make_passage):
        p = make_passage(document_id=_UUID_A)
        text = (
            f"The court held [SOURCE {_UUID_A}] that jurisdiction exists. "
            "It is settled that the penalty is correct."
        )
        result = await validate_citations(text, [p])
        assert result.valid_count >= 1
        # The second sentence has an assertion without citation
        assert len(result.unsupported_claims) >= 1
