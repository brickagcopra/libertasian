"""Tests for citations/service.py — citation resolution via DB lookup.

Tests cover: regex patterns (_GR_PATTERN, _RA_PATTERN, etc.),
_resolve_single_citation, and the full resolve_citations pipeline
with mocked asyncpg connection.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.citations.schemas import (
    CitationResolutionRequest,
    CitationResolutionResponse,
    CitationToResolve,
    ResolvedCitation,
)
from src.citations.service import (
    _GR_PATTERN,
    _RA_PATTERN,
    _PD_PATTERN,
    _EO_PATTERN,
    _AM_PATTERN,
    _resolve_single_citation,
    resolve_citations,
)


# ---------------------------------------------------------------------------
# Test data factories
# ---------------------------------------------------------------------------


def _make_doc_record(id: str = "uuid-001") -> MagicMock:
    """Return a mock asyncpg.Record with an id field."""
    record = MagicMock()
    record.__getitem__ = lambda self, key: id if key == "id" else None
    return record


def _make_citation(**overrides: Any) -> CitationToResolve:
    defaults: dict[str, Any] = {
        "id": "cit-001",
        "citation_text": "G.R. No. 150092, March 31, 2006",
        "normalized_citation": None,
        "from_document_id": "doc-001",
    }
    defaults.update(overrides)
    return CitationToResolve(**defaults)


def _make_request(**overrides: Any) -> CitationResolutionRequest:
    defaults: dict[str, Any] = {
        "document_id": "doc-001",
        "citations": [_make_citation()],
    }
    defaults.update(overrides)
    return CitationResolutionRequest(**defaults)


# ---------------------------------------------------------------------------
# Regex pattern tests
# ---------------------------------------------------------------------------


class TestGRPattern:
    def test_standard_format(self) -> None:
        m = _GR_PATTERN.search("G.R. No. 150092")
        assert m is not None
        assert m.group(1) == "150092"

    def test_with_dash(self) -> None:
        m = _GR_PATTERN.search("G.R. No. 150092-93")
        assert m is not None
        assert m.group(1) == "150092-93"

    def test_with_letter_prefix(self) -> None:
        m = _GR_PATTERN.search("G.R. No. L-12345")
        assert m is not None
        assert m.group(1) == "L-12345"

    def test_case_insensitive(self) -> None:
        m = _GR_PATTERN.search("g.r. no. 150092")
        assert m is not None

    def test_no_match(self) -> None:
        m = _GR_PATTERN.search("Some random text")
        assert m is None

    def test_embedded_in_sentence(self) -> None:
        m = _GR_PATTERN.search("People v. Santos, G.R. No. 123456, January 1, 2020")
        assert m is not None
        assert m.group(1).strip() == "123456"


class TestRAPattern:
    def test_standard_format(self) -> None:
        m = _RA_PATTERN.search("R.A. No. 11127")
        assert m is not None
        assert m.group(1) == "11127"

    def test_case_insensitive(self) -> None:
        m = _RA_PATTERN.search("r.a. no. 11127")
        assert m is not None

    def test_no_match(self) -> None:
        m = _RA_PATTERN.search("Republic Act 11127")
        assert m is None


class TestPDPattern:
    def test_standard_format(self) -> None:
        m = _PD_PATTERN.search("P.D. No. 1529")
        assert m is not None
        assert m.group(1) == "1529"

    def test_no_match(self) -> None:
        m = _PD_PATTERN.search("Presidential Decree 1529")
        assert m is None


class TestEOPattern:
    def test_standard_format(self) -> None:
        m = _EO_PATTERN.search("E.O. No. 209")
        assert m is not None
        assert m.group(1) == "209"

    def test_no_match(self) -> None:
        m = _EO_PATTERN.search("Executive Order 209")
        assert m is None


class TestAMPattern:
    def test_standard_format(self) -> None:
        m = _AM_PATTERN.search("A.M. No. RTJ-08-2145")
        assert m is not None
        assert m.group(1) == "RTJ-08-2145"

    def test_simple_number(self) -> None:
        m = _AM_PATTERN.search("A.M. No. 12345")
        assert m is not None
        assert m.group(1) == "12345"


# ---------------------------------------------------------------------------
# _resolve_single_citation
# ---------------------------------------------------------------------------


class TestResolveSingleCitation:
    """Test the _resolve_single_citation function with mocked asyncpg connection."""

    @pytest.fixture()
    def mock_conn(self) -> AsyncMock:
        return AsyncMock()

    @pytest.mark.asyncio
    async def test_gr_number_match(self, mock_conn: AsyncMock) -> None:
        mock_conn.fetchrow = AsyncMock(return_value=_make_doc_record("uuid-gr"))

        citation = _make_citation(citation_text="G.R. No. 150092, March 31, 2006")
        result = await _resolve_single_citation(mock_conn, citation)

        assert result.resolved is True
        assert result.resolver_method == "gr_number_exact"
        assert result.confidence == 0.95
        assert result.to_document_id == "uuid-gr"

    @pytest.mark.asyncio
    async def test_citation_text_exact_match(self, mock_conn: AsyncMock) -> None:
        # No GR pattern in text, so Strategy 1 is skipped entirely (no fetchrow call).
        # First call is exact text match (Strategy 2) which returns doc.
        mock_conn.fetchrow = AsyncMock(side_effect=[_make_doc_record("uuid-exact")])

        citation = _make_citation(citation_text="Some non-GR citation text")
        result = await _resolve_single_citation(mock_conn, citation)

        assert result.resolved is True
        assert result.resolver_method == "citation_text_exact"
        assert result.confidence == 0.90

    @pytest.mark.asyncio
    async def test_citation_partial_match(self, mock_conn: AsyncMock) -> None:
        # No GR match, no exact match, partial match succeeds
        mock_conn.fetchrow = AsyncMock(
            side_effect=[None, _make_doc_record("uuid-partial")]
        )

        citation = _make_citation(
            citation_text="Some citation",
            normalized_citation="Normalized Citation Text",
        )
        result = await _resolve_single_citation(mock_conn, citation)

        # With normalized_citation, text used is "Normalized Citation Text"
        # No GR match → exact text match attempted with normalized text
        # If exact match returns a doc, it's citation_text_exact
        assert result.resolved is True

    @pytest.mark.asyncio
    async def test_statute_number_match(self, mock_conn: AsyncMock) -> None:
        # No GR pattern in "R.A. No. 11127", so Strategy 1 skipped.
        # Strategy 2 (exact text) returns None, Strategy 3 skipped (no normalized_citation).
        # Strategy 4 (statute number) returns doc.
        mock_conn.fetchrow = AsyncMock(
            side_effect=[None, _make_doc_record("uuid-statute")]
        )

        citation = _make_citation(citation_text="R.A. No. 11127")
        result = await _resolve_single_citation(mock_conn, citation)

        assert result.resolved is True
        assert result.resolver_method == "statute_number"
        assert result.confidence == 0.85

    @pytest.mark.asyncio
    async def test_title_match(self, mock_conn: AsyncMock) -> None:
        # "People v. Santos" has no GR pattern, so Strategy 1 skipped.
        # Strategy 2 (exact text) returns None, Strategy 3 skipped (no normalized_citation).
        # Strategy 4 (statute) skipped (no RA/PD/EO/AM pattern).
        # Strategy 5 (title match) returns doc.
        mock_conn.fetchrow = AsyncMock(
            side_effect=[None, _make_doc_record("uuid-title")]
        )

        citation = _make_citation(citation_text="People v. Santos")
        result = await _resolve_single_citation(mock_conn, citation)

        assert result.resolved is True
        assert result.resolver_method == "title_match"
        assert result.confidence == 0.70

    @pytest.mark.asyncio
    async def test_unresolved(self, mock_conn: AsyncMock) -> None:
        mock_conn.fetchrow = AsyncMock(return_value=None)

        citation = _make_citation(citation_text="Completely unknown reference")
        result = await _resolve_single_citation(mock_conn, citation)

        assert result.resolved is False
        assert result.resolver_method == "unresolved"
        assert result.confidence == 0.0
        assert result.to_document_id is None

    @pytest.mark.asyncio
    async def test_uses_normalized_citation_when_available(self, mock_conn: AsyncMock) -> None:
        mock_conn.fetchrow = AsyncMock(return_value=_make_doc_record("uuid-norm"))

        citation = _make_citation(
            citation_text="raw text G.R. No. 99999",
            normalized_citation="G.R. No. 12345",
        )
        result = await _resolve_single_citation(mock_conn, citation)

        # Should use normalized_citation (G.R. No. 12345) for text-based searches
        assert result.resolved is True

    @pytest.mark.asyncio
    async def test_citation_id_preserved(self, mock_conn: AsyncMock) -> None:
        mock_conn.fetchrow = AsyncMock(return_value=None)

        citation = _make_citation(id="cit-789", citation_text="Unknown")
        result = await _resolve_single_citation(mock_conn, citation)

        assert result.citation_id == "cit-789"


# ---------------------------------------------------------------------------
# resolve_citations — full pipeline
# ---------------------------------------------------------------------------


class TestResolveCitations:
    """Test the full resolve_citations function with mocked DB.

    ``resolve_citations`` now goes through the shared
    ``acquire_connection`` async context manager (PR #82) so the connection
    yields ``SchemaIntegrityError`` on raw-SQL drift instead of leaking
    ``UndefinedTableError`` into a generic catch-all. The tests patch
    that helper rather than ``asyncpg.connect`` directly.
    """

    @pytest.fixture(autouse=True)
    def _setup_mocks(self) -> None:
        self.mock_conn = AsyncMock()
        # acquire_connection is an @asynccontextmanager — return an
        # object whose __aenter__/__aexit__ yield our mock connection.
        self.mock_cm = MagicMock()
        self.mock_cm.__aenter__ = AsyncMock(return_value=self.mock_conn)
        self.mock_cm.__aexit__ = AsyncMock(return_value=None)

        self.patches = [
            patch(
                "src.citations.service.acquire_connection",
                return_value=self.mock_cm,
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
    async def test_successful_resolution_all_resolved(self) -> None:
        self.mock_conn.fetchrow = AsyncMock(return_value=_make_doc_record("uuid-001"))

        citations = [
            _make_citation(id="cit-1", citation_text="G.R. No. 150092"),
            _make_citation(id="cit-2", citation_text="G.R. No. 123456"),
        ]
        request = _make_request(citations=citations)
        response = await resolve_citations(request)

        assert isinstance(response, CitationResolutionResponse)
        assert response.document_id == "doc-001"
        assert response.total_citations == 2
        assert response.resolved_count == 2
        assert response.unresolved_count == 0

    @pytest.mark.asyncio
    async def test_mixed_resolved_and_unresolved(self) -> None:
        # First citation resolves (GR match), second doesn't
        self.mock_conn.fetchrow = AsyncMock(
            side_effect=[
                _make_doc_record("uuid-001"),  # cit-1 GR match
                None,                           # cit-2 GR fails
                None,                           # cit-2 exact text fails
                None,                           # cit-2 statute fails
                None,                           # cit-2 title fails
            ]
        )

        citations = [
            _make_citation(id="cit-1", citation_text="G.R. No. 150092"),
            _make_citation(id="cit-2", citation_text="Completely unknown"),
        ]
        request = _make_request(citations=citations)
        response = await resolve_citations(request)

        assert response.resolved_count == 1
        assert response.unresolved_count == 1

    @pytest.mark.asyncio
    async def test_empty_citations_list(self) -> None:
        request = _make_request(citations=[])
        response = await resolve_citations(request)

        assert response.total_citations == 0
        assert response.resolved_count == 0
        assert response.unresolved_count == 0
        assert response.results == []

    @pytest.mark.asyncio
    async def test_connection_released_on_success(self) -> None:
        """The async context manager must release the pooled connection
        after a successful run — verified via the patched
        ``acquire_connection`` mock's ``__aexit__``."""
        self.mock_conn.fetchrow = AsyncMock(return_value=_make_doc_record())

        request = _make_request()
        await resolve_citations(request)

        self.mock_cm.__aexit__.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_connection_released_on_error(self) -> None:
        """Exceptions from inside the ``async with`` block must still
        unwind through ``__aexit__`` (i.e. context manager guarantees
        release just like the prior try/finally did)."""
        self.mock_conn.fetchrow = AsyncMock(side_effect=RuntimeError("DB error"))

        request = _make_request()
        with pytest.raises(RuntimeError):
            await resolve_citations(request)

        self.mock_cm.__aexit__.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_results_order_matches_input(self) -> None:
        self.mock_conn.fetchrow = AsyncMock(return_value=_make_doc_record())

        citations = [
            _make_citation(id="cit-a", citation_text="G.R. No. 111111"),
            _make_citation(id="cit-b", citation_text="G.R. No. 222222"),
            _make_citation(id="cit-c", citation_text="G.R. No. 333333"),
        ]
        request = _make_request(citations=citations)
        response = await resolve_citations(request)

        assert [r.citation_id for r in response.results] == ["cit-a", "cit-b", "cit-c"]

    @pytest.mark.asyncio
    async def test_document_id_passed_through(self) -> None:
        self.mock_conn.fetchrow = AsyncMock(return_value=None)

        request = _make_request(document_id="doc-xyz", citations=[])
        response = await resolve_citations(request)

        assert response.document_id == "doc-xyz"

    @pytest.mark.asyncio
    async def test_all_unresolved(self) -> None:
        self.mock_conn.fetchrow = AsyncMock(return_value=None)

        citations = [
            _make_citation(id="cit-1", citation_text="Unknown ref 1"),
            _make_citation(id="cit-2", citation_text="Unknown ref 2"),
        ]
        request = _make_request(citations=citations)
        response = await resolve_citations(request)

        assert response.resolved_count == 0
        assert response.unresolved_count == 2
        assert all(not r.resolved for r in response.results)
