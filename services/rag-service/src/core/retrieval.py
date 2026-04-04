"""Hybrid BM25 + kNN retrieval with Reciprocal Rank Fusion (RRF).

Per CLAUDE.md:
- OpenSearch for both BM25 and kNN
- Retrieval ranking: official > semi-official > editorial > private (boost signal)
- Top-k after reranking: 8 for answers, 15 for digests/memos
"""

from __future__ import annotations

import logging
from typing import Any

from ..shared.opensearch import opensearch_search
from .schemas import Passage, SearchResult
from .types import QueryIntent

logger = logging.getLogger(__name__)

# RRF constant (standard value from the original paper)
RRF_K = 60

# Authority level boost multipliers
_AUTHORITY_BOOST: dict[str, float] = {
    "official": 1.4,
    "semi_official": 1.2,
    "editorial": 1.0,
    "private": 0.8,
}

# Index names
_KEYWORD_INDEX = "legal_documents_keyword"
_VECTOR_INDEX = "legal_documents_vector"


async def hybrid_retrieve(
    query: str,
    intent: QueryIntent,
    top_k: int = 30,
    embedding: list[float] | None = None,
) -> SearchResult:
    """Execute hybrid BM25 + kNN retrieval and fuse results with RRF.

    Args:
        query: The user's search query.
        intent: Classified query intent (drives field boosting).
        top_k: Number of passages to return after fusion.
        embedding: Pre-computed query embedding vector. If None, only BM25 is used.

    Returns:
        SearchResult with fused and authority-boosted passages.
    """
    # Run BM25 and kNN in parallel if embedding is available
    bm25_hits = await _bm25_search(query, intent, top_k=top_k * 2)
    knn_hits: list[dict[str, Any]] = []

    if embedding is not None:
        knn_hits = await _knn_search(embedding, top_k=top_k * 2)

    # Fuse with RRF
    fused = _rrf_fuse(bm25_hits, knn_hits)

    # Apply authority boost
    for passage_data in fused:
        authority = passage_data.get("source_authority_level", "editorial")
        boost = _AUTHORITY_BOOST.get(authority, 1.0)
        passage_data["score"] = passage_data.get("score", 0.0) * boost

    # Sort by boosted score and take top_k
    fused.sort(key=lambda x: x.get("score", 0.0), reverse=True)
    fused = fused[:top_k]

    passages = [_to_passage(p) for p in fused]

    return SearchResult(
        passages=passages,
        total_bm25_hits=len(bm25_hits),
        total_knn_hits=len(knn_hits),
        query_intent=intent.value,
    )


async def _bm25_search(
    query: str,
    intent: QueryIntent,
    top_k: int = 60,
) -> list[dict[str, Any]]:
    """Execute BM25 keyword search on OpenSearch."""
    # Adjust field boosts based on intent
    fields = _get_boosted_fields(intent)

    body: dict[str, Any] = {
        "size": top_k,
        "query": {
            "multi_match": {
                "query": query,
                "fields": fields,
                "type": "best_fields",
            },
        },
        "_source": [
            "document_id",
            "section_id",
            "title",
            "citation_text",
            "plain_text",
            "court",
            "decision_date",
            "document_type",
            "source_authority_level",
        ],
    }

    # Add document type filter for codal queries
    if intent == QueryIntent.CODAL_REFERENCE:
        body["query"] = {
            "bool": {
                "must": [body["query"]],
                "should": [
                    {"term": {"document_type": {"value": "statute", "boost": 2.0}}},
                    {"term": {"document_type": {"value": "code", "boost": 2.0}}},
                    {"term": {"document_type": {"value": "rule", "boost": 1.5}}},
                ],
            },
        }

    data = await opensearch_search(_KEYWORD_INDEX, body)
    hits = data.get("hits", {}).get("hits", [])

    results: list[dict[str, Any]] = []
    for rank, hit in enumerate(hits):
        source = hit.get("_source", {})
        results.append(
            {
                "id": hit.get("_id", ""),
                "document_id": source.get("document_id", ""),
                "section_id": source.get("section_id"),
                "title": source.get("title", ""),
                "citation_text": source.get("citation_text", ""),
                "text": (source.get("plain_text", "") or "")[:2000],
                "court": source.get("court", ""),
                "decision_date": source.get("decision_date", ""),
                "document_type": source.get("document_type", ""),
                "source_authority_level": source.get("source_authority_level", "editorial"),
                "bm25_score": hit.get("_score", 0.0),
                "bm25_rank": rank,
            }
        )

    return results


async def _knn_search(
    embedding: list[float],
    top_k: int = 60,
) -> list[dict[str, Any]]:
    """Execute kNN vector search on OpenSearch."""
    body: dict[str, Any] = {
        "size": top_k,
        "query": {
            "knn": {
                "embedding": {
                    "vector": embedding,
                    "k": top_k,
                },
            },
        },
        "_source": [
            "document_id",
            "section_id",
            "title",
            "citation_text",
            "plain_text",
            "court",
            "decision_date",
            "document_type",
            "source_authority_level",
        ],
    }

    data = await opensearch_search(_VECTOR_INDEX, body)
    hits = data.get("hits", {}).get("hits", [])

    results: list[dict[str, Any]] = []
    for rank, hit in enumerate(hits):
        source = hit.get("_source", {})
        results.append(
            {
                "id": hit.get("_id", ""),
                "document_id": source.get("document_id", ""),
                "section_id": source.get("section_id"),
                "title": source.get("title", ""),
                "citation_text": source.get("citation_text", ""),
                "text": (source.get("plain_text", "") or "")[:2000],
                "court": source.get("court", ""),
                "decision_date": source.get("decision_date", ""),
                "document_type": source.get("document_type", ""),
                "source_authority_level": source.get("source_authority_level", "editorial"),
                "knn_score": hit.get("_score", 0.0),
                "knn_rank": rank,
            }
        )

    return results


def _rrf_fuse(
    bm25_hits: list[dict[str, Any]],
    knn_hits: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Fuse BM25 and kNN results using Reciprocal Rank Fusion.

    RRF score = sum(1 / (k + rank)) for each ranking list.
    """
    # Index by document hit ID for deduplication
    merged: dict[str, dict[str, Any]] = {}

    for hit in bm25_hits:
        hit_id = hit["id"]
        if hit_id not in merged:
            merged[hit_id] = {**hit, "score": 0.0}
        rank = hit.get("bm25_rank", 0)
        merged[hit_id]["score"] += 1.0 / (RRF_K + rank)
        merged[hit_id]["bm25_score"] = hit.get("bm25_score", 0.0)

    for hit in knn_hits:
        hit_id = hit["id"]
        if hit_id not in merged:
            merged[hit_id] = {**hit, "score": 0.0}
        rank = hit.get("knn_rank", 0)
        merged[hit_id]["score"] += 1.0 / (RRF_K + rank)
        merged[hit_id]["knn_score"] = hit.get("knn_score", 0.0)

    return list(merged.values())


def _get_boosted_fields(intent: QueryIntent) -> list[str]:
    """Return OpenSearch field list with intent-specific boosts."""
    if intent == QueryIntent.CASE_LOOKUP:
        return ["citation_text^5", "title^3", "plain_text"]
    if intent == QueryIntent.CODAL_REFERENCE:
        return ["title^3", "section_text^2", "plain_text", "citation_text^2"]
    if intent == QueryIntent.DOCTRINE_SEARCH:
        return ["plain_text^2", "title^2", "section_text^2", "citation_text"]
    if intent == QueryIntent.PROCEDURAL_QUERY:
        return ["plain_text^2", "title^2", "section_text", "citation_text"]
    # LEGAL_QUESTION and GENERAL
    return ["title^2", "citation_text^3", "plain_text", "section_text"]


def _to_passage(data: dict[str, Any]) -> Passage:
    """Convert a raw hit dict to a Passage model."""
    return Passage(
        id=data.get("id", ""),
        document_id=data.get("document_id", ""),
        section_id=data.get("section_id"),
        title=data.get("title", ""),
        citation_text=data.get("citation_text", ""),
        text=data.get("text", ""),
        court=data.get("court", ""),
        decision_date=data.get("decision_date", ""),
        document_type=data.get("document_type", ""),
        source_authority_level=data.get("source_authority_level", "editorial"),
        score=data.get("score", 0.0),
        bm25_score=data.get("bm25_score", 0.0),
        knn_score=data.get("knn_score", 0.0),
        rerank_score=data.get("rerank_score"),
    )


# ---------------------------------------------------------------------------
# Document-ID-based retrieval (used by comparisons, contradictions, timelines,
# hearing_prep, research_workspaces)
# ---------------------------------------------------------------------------

_DOC_SOURCE_FIELDS = [
    "document_id",
    "section_id",
    "title",
    "citation_text",
    "plain_text",
    "court",
    "decision_date",
    "document_type",
    "section_type",
    "source_authority_level",
]


async def retrieve_by_document_id(
    document_id: str,
    top_k: int = 15,
    text_truncate: int = 3000,
) -> list[Passage]:
    """Retrieve passages for a specific legal document by document_id.

    Falls back to a broader plain_text match if the exact term query fails.
    """
    body: dict[str, Any] = {
        "size": top_k,
        "query": {
            "bool": {
                "must": [{"term": {"document_id": document_id}}],
            },
        },
        "_source": _DOC_SOURCE_FIELDS,
    }

    data = await opensearch_search(_KEYWORD_INDEX, body)
    hits = data.get("hits", {}).get("hits", [])

    if not hits:
        # Fallback: broader match
        hits = await _fallback_retrieve(document_id, text_truncate)
        return hits

    return [
        _hit_to_passage(hit, default_doc_id=document_id, text_truncate=text_truncate)
        for hit in hits
    ]


async def retrieve_by_query(
    query: str,
    top_k: int = 15,
    text_truncate: int = 2000,
    filter_terms: dict[str, Any] | None = None,
) -> list[Passage]:
    """Retrieve passages using BM25 keyword search on a query string.

    Suitable for topic-based retrieval used by memos, flashcards, pleadings,
    hearing_prep topic search, and research_workspaces query search.
    """
    must_clauses: list[dict[str, Any]] = [
        {
            "multi_match": {
                "query": query,
                "fields": ["title^2", "citation_text^3", "plain_text", "section_text"],
                "type": "best_fields",
            },
        },
    ]

    if filter_terms:
        for field, value in filter_terms.items():
            if isinstance(value, list):
                must_clauses.append({"terms": {field: value}})
            else:
                must_clauses.append({"term": {field: value}})

    body: dict[str, Any] = {
        "size": top_k,
        "query": {"bool": {"must": must_clauses}},
        "_source": _DOC_SOURCE_FIELDS,
    }

    data = await opensearch_search(_KEYWORD_INDEX, body)
    hits = data.get("hits", {}).get("hits", [])

    return [
        _hit_to_passage(hit, text_truncate=text_truncate)
        for hit in hits
    ]


async def _fallback_retrieve(
    document_id: str,
    text_truncate: int = 3000,
) -> list[Passage]:
    """Fallback retrieval using a broader plain_text match."""
    body: dict[str, Any] = {
        "size": 5,
        "query": {"match": {"plain_text": document_id}},
        "_source": _DOC_SOURCE_FIELDS,
    }

    data = await opensearch_search(_KEYWORD_INDEX, body)
    hits = data.get("hits", {}).get("hits", [])

    return [
        _hit_to_passage(hit, default_doc_id=document_id, text_truncate=text_truncate)
        for hit in hits
    ]


def _hit_to_passage(
    hit: dict[str, Any],
    default_doc_id: str = "",
    text_truncate: int = 3000,
) -> Passage:
    """Convert a raw OpenSearch hit to a Passage model."""
    source = hit.get("_source", {})
    return Passage(
        id=hit.get("_id", ""),
        document_id=source.get("document_id", default_doc_id),
        section_id=source.get("section_id"),
        title=source.get("title", ""),
        citation_text=source.get("citation_text", ""),
        text=(source.get("plain_text", "") or "")[:text_truncate],
        court=source.get("court", ""),
        decision_date=source.get("decision_date", ""),
        document_type=source.get("document_type", ""),
        source_authority_level=source.get("source_authority_level", "editorial"),
        score=hit.get("_score", 0.0),
        bm25_score=hit.get("_score", 0.0),
        knn_score=0.0,
        rerank_score=None,
    )
