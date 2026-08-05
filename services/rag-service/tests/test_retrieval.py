"""Tests for core/retrieval.py — Hybrid BM25 + kNN retrieval with RRF fusion.

Covers:
- _rrf_fuse: Reciprocal Rank Fusion deduplication and scoring
- _get_boosted_fields: Intent-specific field boosting
- _to_passage: Raw hit dict → Passage conversion
- _hit_to_passage: OpenSearch hit → Passage conversion
- hybrid_retrieve: Full pipeline (BM25 + kNN + RRF + authority boost)
- _bm25_search: BM25 keyword search with intent-based query building
- _knn_search: kNN vector search
- retrieve_by_document_id: Document-specific retrieval with fallback
- retrieve_by_query: Topic-based retrieval with optional filters
- _fallback_retrieve: Broader plain_text match fallback
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from src.core.retrieval import (
    _get_boosted_fields,
    _hit_to_passage,
    _rrf_fuse,
    _to_passage,
    RRF_K,
    _AUTHORITY_BOOST,
    hybrid_retrieve,
    retrieve_by_document_id,
    retrieve_by_query,
)
from src.core.schemas import Passage, SearchResult
from src.core.types import QueryIntent


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_bm25_hit(
    hit_id: str = "h1",
    rank: int = 0,
    score: float = 5.0,
    authority: str = "official",
    **kwargs: Any,
) -> dict[str, Any]:
    """Create a raw BM25 hit dict."""
    base: dict[str, Any] = {
        "id": hit_id,
        "document_id": kwargs.get("document_id", f"doc-{hit_id}"),
        "section_id": kwargs.get("section_id"),
        "title": kwargs.get("title", f"Title {hit_id}"),
        "citation_text": kwargs.get("citation_text", f"G.R. No. {hit_id}"),
        "text": kwargs.get("text", f"Passage text for {hit_id}"),
        "court": kwargs.get("court", "Supreme Court"),
        "decision_date": kwargs.get("decision_date", "2024-01-01"),
        "document_type": kwargs.get("document_type", "case"),
        "source_authority_level": authority,
        "bm25_score": score,
        "bm25_rank": rank,
    }
    return base


def _make_knn_hit(
    hit_id: str = "h1",
    rank: int = 0,
    score: float = 0.9,
    authority: str = "official",
    **kwargs: Any,
) -> dict[str, Any]:
    """Create a raw kNN hit dict."""
    base: dict[str, Any] = {
        "id": hit_id,
        "document_id": kwargs.get("document_id", f"doc-{hit_id}"),
        "section_id": kwargs.get("section_id"),
        "title": kwargs.get("title", f"Title {hit_id}"),
        "citation_text": kwargs.get("citation_text", f"G.R. No. {hit_id}"),
        "text": kwargs.get("text", f"Passage text for {hit_id}"),
        "court": kwargs.get("court", "Supreme Court"),
        "decision_date": kwargs.get("decision_date", "2024-01-01"),
        "document_type": kwargs.get("document_type", "case"),
        "source_authority_level": authority,
        "knn_score": score,
        "knn_rank": rank,
    }
    return base


def _make_os_hit(
    hit_id: str = "os-1",
    score: float = 5.0,
    source: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Create a raw OpenSearch hit response dict."""
    if source is None:
        source = {
            "document_id": f"doc-{hit_id}",
            "section_id": f"sec-{hit_id}",
            "title": f"Title {hit_id}",
            "citation_text": f"G.R. No. {hit_id}",
            "plain_text": f"Text for {hit_id}",
            "court": "Supreme Court",
            "decision_date": "2024-06-01",
            "document_type": "case",
            "source_authority_level": "official",
        }
    return {"_id": hit_id, "_score": score, "_source": source}


# ===========================================================================
# _rrf_fuse
# ===========================================================================


class TestRrfFuse:
    """Test Reciprocal Rank Fusion logic."""

    def test_empty_inputs(self) -> None:
        result = _rrf_fuse([], [])
        assert result == []

    def test_bm25_only(self) -> None:
        bm25 = [_make_bm25_hit("a", rank=0), _make_bm25_hit("b", rank=1)]
        result = _rrf_fuse(bm25, [])
        assert len(result) == 2
        # RRF score = 1/(K+rank)
        a_score = 1.0 / (RRF_K + 0)
        b_score = 1.0 / (RRF_K + 1)
        assert result[0]["score"] == pytest.approx(a_score)
        assert result[1]["score"] == pytest.approx(b_score)

    def test_knn_only(self) -> None:
        knn = [_make_knn_hit("x", rank=0), _make_knn_hit("y", rank=1)]
        result = _rrf_fuse([], knn)
        assert len(result) == 2
        assert result[0]["score"] == pytest.approx(1.0 / (RRF_K + 0))

    def test_deduplication_adds_scores(self) -> None:
        """Same hit in both BM25 and kNN should have summed RRF scores."""
        bm25 = [_make_bm25_hit("shared", rank=0)]
        knn = [_make_knn_hit("shared", rank=2)]
        result = _rrf_fuse(bm25, knn)
        assert len(result) == 1
        expected = 1.0 / (RRF_K + 0) + 1.0 / (RRF_K + 2)
        assert result[0]["score"] == pytest.approx(expected)

    def test_mixed_unique_and_shared(self) -> None:
        bm25 = [_make_bm25_hit("a", rank=0), _make_bm25_hit("b", rank=1)]
        knn = [_make_knn_hit("b", rank=0), _make_knn_hit("c", rank=1)]
        result = _rrf_fuse(bm25, knn)
        # a (BM25 only), b (both), c (kNN only)
        assert len(result) == 3
        ids = {r["id"] for r in result}
        assert ids == {"a", "b", "c"}

    def test_bm25_score_preserved(self) -> None:
        bm25 = [_make_bm25_hit("a", rank=0, score=10.5)]
        result = _rrf_fuse(bm25, [])
        assert result[0]["bm25_score"] == 10.5

    def test_knn_score_preserved(self) -> None:
        knn = [_make_knn_hit("a", rank=0, score=0.95)]
        result = _rrf_fuse([], knn)
        assert result[0]["knn_score"] == 0.95

    def test_high_rank_low_rrf_score(self) -> None:
        bm25 = [_make_bm25_hit("far", rank=100)]
        result = _rrf_fuse(bm25, [])
        expected = 1.0 / (RRF_K + 100)
        assert result[0]["score"] == pytest.approx(expected)
        # Should be very low
        assert result[0]["score"] < 0.01


# ===========================================================================
# _get_boosted_fields
# ===========================================================================


class TestGetBoostedFields:
    """Test intent-specific field boosting."""

    def test_case_lookup_boosts_citation(self) -> None:
        fields = _get_boosted_fields(QueryIntent.CASE_LOOKUP)
        assert "citation_text^5" in fields
        assert "title^3" in fields

    def test_codal_reference_boosts_title_and_section(self) -> None:
        fields = _get_boosted_fields(QueryIntent.CODAL_REFERENCE)
        assert "title^3" in fields
        assert "section_text^2" in fields
        assert "citation_text^2" in fields

    def test_doctrine_search_boosts_plain_text(self) -> None:
        fields = _get_boosted_fields(QueryIntent.DOCTRINE_SEARCH)
        assert "plain_text^2" in fields
        assert "title^2" in fields

    def test_procedural_query(self) -> None:
        fields = _get_boosted_fields(QueryIntent.PROCEDURAL_QUERY)
        assert "plain_text^2" in fields
        assert "title^2" in fields

    def test_legal_question_fallback(self) -> None:
        fields = _get_boosted_fields(QueryIntent.LEGAL_QUESTION)
        assert "title^2" in fields
        assert "citation_text^3" in fields

    def test_general_fallback(self) -> None:
        fields = _get_boosted_fields(QueryIntent.GENERAL)
        assert "title^2" in fields
        assert "citation_text^3" in fields

    def test_all_intents_include_plain_text(self) -> None:
        """Every intent must include plain_text (with or without boost)."""
        for intent in QueryIntent:
            fields = _get_boosted_fields(intent)
            has_plain = any("plain_text" in f for f in fields)
            assert has_plain, f"{intent} missing plain_text field"


# ===========================================================================
# _to_passage
# ===========================================================================


class TestToPassage:
    """Test raw hit dict → Passage conversion."""

    def test_full_data(self) -> None:
        data: dict[str, Any] = {
            "id": "h1",
            "document_id": "doc-001",
            "section_id": "sec-001",
            "title": "Test Case",
            "citation_text": "G.R. No. 12345",
            "text": "Body text",
            "court": "Supreme Court",
            "decision_date": "2024-01-15",
            "document_type": "case",
            "source_authority_level": "official",
            "score": 0.5,
            "bm25_score": 0.3,
            "knn_score": 0.7,
            "rerank_score": 0.9,
        }
        passage = _to_passage(data)
        assert isinstance(passage, Passage)
        assert passage.id == "h1"
        assert passage.document_id == "doc-001"
        assert passage.section_id == "sec-001"
        assert passage.score == 0.5
        assert passage.rerank_score == 0.9

    def test_missing_fields_use_defaults(self) -> None:
        data: dict[str, Any] = {"id": "h2"}
        passage = _to_passage(data)
        assert passage.document_id == ""
        assert passage.section_id is None
        assert passage.title == ""
        assert passage.source_authority_level == "editorial"
        assert passage.score == 0.0
        assert passage.rerank_score is None

    def test_empty_dict(self) -> None:
        passage = _to_passage({})
        assert passage.id == ""
        assert passage.text == ""


# ===========================================================================
# _hit_to_passage
# ===========================================================================


class TestHitToPassage:
    """Test OpenSearch hit → Passage conversion."""

    def test_standard_hit(self) -> None:
        hit = _make_os_hit("os-1", score=7.5)
        passage = _hit_to_passage(hit)
        assert passage.id == "os-1"
        assert passage.document_id == "doc-os-1"
        assert passage.section_id == "sec-os-1"
        assert passage.bm25_score == 7.5
        assert passage.knn_score == 0.0
        assert passage.rerank_score is None

    def test_default_doc_id(self) -> None:
        hit = _make_os_hit("os-2", source={"plain_text": "Some text"})
        passage = _hit_to_passage(hit, default_doc_id="fallback-doc")
        assert passage.document_id == "fallback-doc"

    def test_text_truncation(self) -> None:
        long_text = "x" * 5000
        hit = _make_os_hit("os-3", source={"plain_text": long_text})
        passage = _hit_to_passage(hit, text_truncate=100)
        assert len(passage.text) == 100

    def test_none_plain_text(self) -> None:
        hit = _make_os_hit("os-4", source={"plain_text": None})
        passage = _hit_to_passage(hit)
        assert passage.text == ""

    def test_missing_source(self) -> None:
        hit: dict[str, Any] = {"_id": "os-5", "_score": 1.0}
        passage = _hit_to_passage(hit)
        assert passage.id == "os-5"
        assert passage.text == ""


# ===========================================================================
# hybrid_retrieve (mocked OpenSearch)
# ===========================================================================


class TestHybridRetrieve:
    """Test the full hybrid retrieval pipeline."""

    @pytest.mark.asyncio
    async def test_bm25_only_when_no_embedding(self) -> None:
        """Without embedding, only BM25 should run."""
        os_response = {
            "hits": {
                "hits": [
                    _make_os_hit("a", 5.0),
                    _make_os_hit("b", 3.0),
                ],
            },
        }

        with patch("src.core.retrieval.opensearch_search", new_callable=AsyncMock) as mock_search:
            mock_search.return_value = os_response
            result = await hybrid_retrieve("test query", QueryIntent.GENERAL, top_k=10)

        assert isinstance(result, SearchResult)
        assert result.total_bm25_hits == 2
        assert result.total_knn_hits == 0
        assert len(result.passages) == 2
        # BM25 called once, kNN not called
        assert mock_search.call_count == 1

    @pytest.mark.asyncio
    async def test_hybrid_with_embedding(self) -> None:
        """With embedding, both BM25 and kNN should run."""
        os_response = {
            "hits": {
                "hits": [_make_os_hit("a", 5.0)],
            },
        }

        with patch("src.core.retrieval.opensearch_search", new_callable=AsyncMock) as mock_search:
            mock_search.return_value = os_response
            result = await hybrid_retrieve(
                "test query",
                QueryIntent.GENERAL,
                top_k=10,
                embedding=[0.1] * 768,
            )

        assert result.total_bm25_hits == 1
        assert result.total_knn_hits == 1
        # BM25 + kNN = 2 calls
        assert mock_search.call_count == 2

    @pytest.mark.asyncio
    async def test_authority_boost_applied(self) -> None:
        """Official sources should get higher scores than private ones."""
        official_hit = _make_os_hit(
            "off",
            5.0,
            source={
                "document_id": "d1",
                "plain_text": "Official text",
                "source_authority_level": "official",
            },
        )
        private_hit = _make_os_hit(
            "priv",
            5.0,
            source={
                "document_id": "d2",
                "plain_text": "Private text",
                "source_authority_level": "private",
            },
        )

        os_response = {"hits": {"hits": [official_hit, private_hit]}}

        with patch("src.core.retrieval.opensearch_search", new_callable=AsyncMock) as mock_search:
            mock_search.return_value = os_response
            result = await hybrid_retrieve("test", QueryIntent.GENERAL, top_k=10)

        # Official (boost 1.4) should rank above private (boost 0.8)
        assert result.passages[0].source_authority_level == "official"
        assert result.passages[1].source_authority_level == "private"
        assert result.passages[0].score > result.passages[1].score

    @pytest.mark.asyncio
    async def test_top_k_limits_results(self) -> None:
        """Results should be capped at top_k."""
        hits = [_make_os_hit(f"h{i}", float(10 - i)) for i in range(10)]
        os_response = {"hits": {"hits": hits}}

        with patch("src.core.retrieval.opensearch_search", new_callable=AsyncMock) as mock_search:
            mock_search.return_value = os_response
            result = await hybrid_retrieve("test", QueryIntent.GENERAL, top_k=3)

        assert len(result.passages) == 3

    @pytest.mark.asyncio
    async def test_empty_results(self) -> None:
        os_response: dict[str, Any] = {"hits": {"hits": []}}

        with patch("src.core.retrieval.opensearch_search", new_callable=AsyncMock) as mock_search:
            mock_search.return_value = os_response
            result = await hybrid_retrieve("test", QueryIntent.GENERAL, top_k=10)

        assert result.passages == []
        assert result.total_bm25_hits == 0

    @pytest.mark.asyncio
    async def test_query_intent_recorded(self) -> None:
        os_response: dict[str, Any] = {"hits": {"hits": []}}

        with patch("src.core.retrieval.opensearch_search", new_callable=AsyncMock) as mock_search:
            mock_search.return_value = os_response
            result = await hybrid_retrieve("G.R. No. 12345", QueryIntent.CASE_LOOKUP, top_k=5)

        assert result.query_intent == "case_lookup"


class TestHybridRetrieveFailureModes:
    """Which arm is allowed to fail quietly, and which is not.

    Regression cover for the 2026-05 → 2026-08 OpenSearch outage: a cluster the
    client could not reach at all produced zero passages that were indistinguishable
    from a query with no matches.
    """

    @pytest.mark.asyncio
    async def test_bm25_failure_propagates(self) -> None:
        """No BM25 means no results — the caller must get an error, not silence."""
        with patch("src.core.retrieval.opensearch_search", new_callable=AsyncMock) as mock_search:
            mock_search.side_effect = httpx.ConnectError("certificate verify failed")

            with pytest.raises(httpx.ConnectError):
                await hybrid_retrieve("test", QueryIntent.GENERAL, top_k=10)

    @pytest.mark.asyncio
    async def test_knn_failure_degrades_to_bm25_only(self) -> None:
        """A failed vector arm keeps a complete BM25 result set rather than 500-ing."""
        os_response = {"hits": {"hits": [_make_os_hit("a", 5.0), _make_os_hit("b", 3.0)]}}

        async def _bm25_ok_knn_fails(index: str, body: dict[str, Any]) -> dict[str, Any]:
            if index == "legal_documents_vector":
                raise httpx.ConnectError("knn plugin unavailable")
            return os_response

        with patch("src.core.retrieval.opensearch_search", side_effect=_bm25_ok_knn_fails):
            result = await hybrid_retrieve(
                "test",
                QueryIntent.GENERAL,
                top_k=10,
                embedding=[0.1] * 768,
            )

        assert result.total_bm25_hits == 2
        assert result.total_knn_hits == 0
        assert len(result.passages) == 2

    @pytest.mark.asyncio
    async def test_knn_failure_is_logged_at_error_level(self, caplog: Any) -> None:
        os_response = {"hits": {"hits": [_make_os_hit("a", 5.0)]}}

        async def _bm25_ok_knn_fails(index: str, body: dict[str, Any]) -> dict[str, Any]:
            if index == "legal_documents_vector":
                raise httpx.ConnectError("knn plugin unavailable")
            return os_response

        with (
            patch("src.core.retrieval.opensearch_search", side_effect=_bm25_ok_knn_fails),
            caplog.at_level("ERROR"),
        ):
            await hybrid_retrieve(
                "test",
                QueryIntent.GENERAL,
                top_k=10,
                embedding=[0.1] * 768,
            )

        assert any(r.levelname == "ERROR" for r in caplog.records)

    @pytest.mark.asyncio
    async def test_retrieve_by_query_failure_propagates(self) -> None:
        """The memo/flashcard/pleading path fails loudly too."""
        with patch("src.core.retrieval.opensearch_search", new_callable=AsyncMock) as mock_search:
            mock_search.side_effect = httpx.ConnectError("certificate verify failed")

            with pytest.raises(httpx.ConnectError):
                await retrieve_by_query("negligence", top_k=5)

    @pytest.mark.asyncio
    async def test_retrieve_by_document_id_failure_propagates(self) -> None:
        with patch("src.core.retrieval.opensearch_search", new_callable=AsyncMock) as mock_search:
            mock_search.side_effect = httpx.ConnectError("certificate verify failed")

            with pytest.raises(httpx.ConnectError):
                await retrieve_by_document_id("doc-1", top_k=5)


# ===========================================================================
# _bm25_search (via opensearch_search mock)
# ===========================================================================


class TestBm25Search:
    """Test BM25 search OpenSearch query construction."""

    @pytest.mark.asyncio
    async def test_codal_intent_adds_document_type_filter(self) -> None:
        """CODAL_REFERENCE intent should inject document_type boost."""
        from src.core.retrieval import _bm25_search

        captured_body: dict[str, Any] = {}

        async def _capture_search(index: str, body: dict[str, Any]) -> dict[str, Any]:
            captured_body.update(body)
            return {"hits": {"hits": []}}

        with patch("src.core.retrieval.opensearch_search", side_effect=_capture_search):
            await _bm25_search("Article 1191 Civil Code", QueryIntent.CODAL_REFERENCE)

        # Should have a bool query with should clauses for statute/code/rule
        query = captured_body.get("query", {})
        assert "bool" in query
        should_clauses = query["bool"].get("should", [])
        doc_types = [c["term"]["document_type"]["value"] for c in should_clauses if "term" in c]
        assert "statute" in doc_types
        assert "code" in doc_types
        assert "rule" in doc_types

    @pytest.mark.asyncio
    async def test_non_codal_uses_multi_match(self) -> None:
        """Non-codal intents should use a simple multi_match query."""
        from src.core.retrieval import _bm25_search

        captured_body: dict[str, Any] = {}

        async def _capture_search(index: str, body: dict[str, Any]) -> dict[str, Any]:
            captured_body.update(body)
            return {"hits": {"hits": []}}

        with patch("src.core.retrieval.opensearch_search", side_effect=_capture_search):
            await _bm25_search("constructive dismissal", QueryIntent.LEGAL_QUESTION)

        query = captured_body.get("query", {})
        assert "multi_match" in query

    @pytest.mark.asyncio
    async def test_text_truncated_to_2000(self) -> None:
        """BM25 results should truncate plain_text to 2000 chars."""
        from src.core.retrieval import _bm25_search

        long_text = "x" * 5000
        os_hit = {
            "_id": "h1",
            "_score": 5.0,
            "_source": {"plain_text": long_text, "document_id": "d1"},
        }

        with patch("src.core.retrieval.opensearch_search", new_callable=AsyncMock) as mock_search:
            mock_search.return_value = {"hits": {"hits": [os_hit]}}
            results = await _bm25_search("test", QueryIntent.GENERAL)

        assert len(results[0]["text"]) == 2000

    @pytest.mark.asyncio
    async def test_rank_assigned_by_position(self) -> None:
        from src.core.retrieval import _bm25_search

        hits = [
            {"_id": "a", "_score": 10.0, "_source": {"document_id": "d1"}},
            {"_id": "b", "_score": 8.0, "_source": {"document_id": "d2"}},
            {"_id": "c", "_score": 5.0, "_source": {"document_id": "d3"}},
        ]

        with patch("src.core.retrieval.opensearch_search", new_callable=AsyncMock) as mock_search:
            mock_search.return_value = {"hits": {"hits": hits}}
            results = await _bm25_search("test", QueryIntent.GENERAL)

        assert results[0]["bm25_rank"] == 0
        assert results[1]["bm25_rank"] == 1
        assert results[2]["bm25_rank"] == 2

    @pytest.mark.asyncio
    async def test_searches_keyword_index(self) -> None:
        from src.core.retrieval import _bm25_search

        with patch("src.core.retrieval.opensearch_search", new_callable=AsyncMock) as mock_search:
            mock_search.return_value = {"hits": {"hits": []}}
            await _bm25_search("test", QueryIntent.GENERAL)

        mock_search.assert_called_once()
        assert mock_search.call_args[0][0] == "legal_documents_keyword"


# ===========================================================================
# _knn_search
# ===========================================================================


class TestKnnSearch:
    """Test kNN vector search."""

    @pytest.mark.asyncio
    async def test_builds_knn_query(self) -> None:
        from src.core.retrieval import _knn_search

        captured_body: dict[str, Any] = {}

        async def _capture(index: str, body: dict[str, Any]) -> dict[str, Any]:
            captured_body.update(body)
            return {"hits": {"hits": []}}

        with patch("src.core.retrieval.opensearch_search", side_effect=_capture):
            await _knn_search([0.1, 0.2, 0.3], top_k=10)

        query = captured_body.get("query", {})
        assert "knn" in query
        assert query["knn"]["embedding"]["vector"] == [0.1, 0.2, 0.3]
        assert query["knn"]["embedding"]["k"] == 10

    @pytest.mark.asyncio
    async def test_searches_vector_index(self) -> None:
        from src.core.retrieval import _knn_search

        with patch("src.core.retrieval.opensearch_search", new_callable=AsyncMock) as mock_search:
            mock_search.return_value = {"hits": {"hits": []}}
            await _knn_search([0.5] * 768)

        assert mock_search.call_args[0][0] == "legal_documents_vector"

    @pytest.mark.asyncio
    async def test_knn_rank_assigned(self) -> None:
        from src.core.retrieval import _knn_search

        hits = [
            {"_id": "v1", "_score": 0.95, "_source": {"document_id": "d1"}},
            {"_id": "v2", "_score": 0.85, "_source": {"document_id": "d2"}},
        ]

        with patch("src.core.retrieval.opensearch_search", new_callable=AsyncMock) as mock_search:
            mock_search.return_value = {"hits": {"hits": hits}}
            results = await _knn_search([0.5] * 768)

        assert results[0]["knn_rank"] == 0
        assert results[1]["knn_rank"] == 1
        assert results[0]["knn_score"] == 0.95


# ===========================================================================
# retrieve_by_document_id
# ===========================================================================


class TestRetrieveByDocumentId:
    """Test document-specific retrieval."""

    @pytest.mark.asyncio
    async def test_returns_passages_for_document(self) -> None:
        os_response = {"hits": {"hits": [_make_os_hit("s1", 5.0)]}}

        with patch("src.core.retrieval.opensearch_search", new_callable=AsyncMock) as mock_search:
            mock_search.return_value = os_response
            result = await retrieve_by_document_id("doc-123")

        assert len(result) == 1
        assert isinstance(result[0], Passage)

    @pytest.mark.asyncio
    async def test_fallback_on_no_hits(self) -> None:
        """When term query returns empty, should fall back to broader match."""
        call_count = 0

        async def _mock_search(index: str, body: dict[str, Any]) -> dict[str, Any]:
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return {"hits": {"hits": []}}  # First call: no results
            return {"hits": {"hits": [_make_os_hit("fb1", 2.0)]}}  # Fallback

        with patch("src.core.retrieval.opensearch_search", side_effect=_mock_search):
            result = await retrieve_by_document_id("doc-missing")

        assert call_count == 2  # Initial + fallback
        assert len(result) == 1

    @pytest.mark.asyncio
    async def test_text_truncation(self) -> None:
        long_text = "x" * 5000
        hit = _make_os_hit("s1", 5.0, source={"plain_text": long_text, "document_id": "d1"})
        os_response = {"hits": {"hits": [hit]}}

        with patch("src.core.retrieval.opensearch_search", new_callable=AsyncMock) as mock_search:
            mock_search.return_value = os_response
            result = await retrieve_by_document_id("d1", text_truncate=200)

        assert len(result[0].text) == 200

    @pytest.mark.asyncio
    async def test_uses_term_query(self) -> None:
        captured_body: dict[str, Any] = {}

        async def _capture(index: str, body: dict[str, Any]) -> dict[str, Any]:
            captured_body.update(body)
            return {"hits": {"hits": [_make_os_hit("s1")]}}

        with patch("src.core.retrieval.opensearch_search", side_effect=_capture):
            await retrieve_by_document_id("doc-xyz")

        must = captured_body["query"]["bool"]["must"]
        assert must[0]["term"]["document_id"] == "doc-xyz"


# ===========================================================================
# retrieve_by_query
# ===========================================================================


class TestRetrieveByQuery:
    """Test topic-based query retrieval."""

    @pytest.mark.asyncio
    async def test_basic_query(self) -> None:
        os_response = {"hits": {"hits": [_make_os_hit("q1", 8.0)]}}

        with patch("src.core.retrieval.opensearch_search", new_callable=AsyncMock) as mock_search:
            mock_search.return_value = os_response
            result = await retrieve_by_query("constructive dismissal")

        assert len(result) == 1
        assert isinstance(result[0], Passage)

    @pytest.mark.asyncio
    async def test_with_scalar_filter(self) -> None:
        captured_body: dict[str, Any] = {}

        async def _capture(index: str, body: dict[str, Any]) -> dict[str, Any]:
            captured_body.update(body)
            return {"hits": {"hits": []}}

        with patch("src.core.retrieval.opensearch_search", side_effect=_capture):
            await retrieve_by_query(
                "test", filter_terms={"document_type": "case"}
            )

        must = captured_body["query"]["bool"]["must"]
        term_clauses = [c for c in must if "term" in c]
        assert len(term_clauses) == 1
        assert term_clauses[0]["term"]["document_type"] == "case"

    @pytest.mark.asyncio
    async def test_with_list_filter(self) -> None:
        captured_body: dict[str, Any] = {}

        async def _capture(index: str, body: dict[str, Any]) -> dict[str, Any]:
            captured_body.update(body)
            return {"hits": {"hits": []}}

        with patch("src.core.retrieval.opensearch_search", side_effect=_capture):
            await retrieve_by_query(
                "test",
                filter_terms={"court": ["Supreme Court", "Court of Appeals"]},
            )

        must = captured_body["query"]["bool"]["must"]
        terms_clauses = [c for c in must if "terms" in c]
        assert len(terms_clauses) == 1
        assert terms_clauses[0]["terms"]["court"] == ["Supreme Court", "Court of Appeals"]

    @pytest.mark.asyncio
    async def test_no_filter(self) -> None:
        captured_body: dict[str, Any] = {}

        async def _capture(index: str, body: dict[str, Any]) -> dict[str, Any]:
            captured_body.update(body)
            return {"hits": {"hits": []}}

        with patch("src.core.retrieval.opensearch_search", side_effect=_capture):
            await retrieve_by_query("test", filter_terms=None)

        must = captured_body["query"]["bool"]["must"]
        # Only multi_match, no term/terms filters
        assert len(must) == 1
        assert "multi_match" in must[0]

    @pytest.mark.asyncio
    async def test_text_truncation_default(self) -> None:
        long_text = "x" * 5000
        hit = _make_os_hit("q1", 5.0, source={"plain_text": long_text, "document_id": "d1"})

        with patch("src.core.retrieval.opensearch_search", new_callable=AsyncMock) as mock_search:
            mock_search.return_value = {"hits": {"hits": [hit]}}
            result = await retrieve_by_query("test")

        # Default text_truncate for retrieve_by_query is 2000
        assert len(result[0].text) == 2000

    @pytest.mark.asyncio
    async def test_custom_top_k(self) -> None:
        captured_body: dict[str, Any] = {}

        async def _capture(index: str, body: dict[str, Any]) -> dict[str, Any]:
            captured_body.update(body)
            return {"hits": {"hits": []}}

        with patch("src.core.retrieval.opensearch_search", side_effect=_capture):
            await retrieve_by_query("test", top_k=5)

        assert captured_body["size"] == 5


# ===========================================================================
# Authority boost constants
# ===========================================================================


class TestAuthorityBoost:
    """Verify authority boost values per CLAUDE.md priority."""

    def test_official_highest(self) -> None:
        assert _AUTHORITY_BOOST["official"] == 1.4

    def test_semi_official(self) -> None:
        assert _AUTHORITY_BOOST["semi_official"] == 1.2

    def test_editorial_neutral(self) -> None:
        assert _AUTHORITY_BOOST["editorial"] == 1.0

    def test_private_lowest(self) -> None:
        assert _AUTHORITY_BOOST["private"] == 0.8

    def test_ordering(self) -> None:
        """official > semi_official > editorial > private per CLAUDE.md."""
        assert (
            _AUTHORITY_BOOST["official"]
            > _AUTHORITY_BOOST["semi_official"]
            > _AUTHORITY_BOOST["editorial"]
            > _AUTHORITY_BOOST["private"]
        )
