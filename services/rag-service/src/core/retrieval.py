"""Hybrid BM25 + kNN retrieval with Reciprocal Rank Fusion (RRF).

Per CLAUDE.md:
- OpenSearch for both BM25 and kNN
- Retrieval ranking: official > semi-official > editorial > private (boost signal)
- Top-k after reranking: 8 for answers, 15 for digests/memos
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

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

# ---------------------------------------------------------------------------
# Index field contracts
#
# These mirror `apps/api/src/modules/search/index-mappings.ts`, which is the
# single source of truth for both mappings, and `test_index_field_contract.py`
# asserts they still agree with it. That cross-check exists because this module
# disagreeing with that mapping is not a hypothetical failure mode — three
# fields were wrong at once:
#
#   * `_knn_search` queried `knn: {"embedding": ...}`. The vector index has no
#     `embedding` field; its knn_vector field is `embedding_vector`. Confirmed
#     against the live prod cluster on 2026-08-14 by pulling a stored vector out
#     of the index and querying it both ways: `embedding` returns HTTP 400 "all
#     shards failed", `embedding_vector` returns correct neighbours.
#   * Both search functions requested `source_authority_level` in `_source`.
#     Neither index maps that name — it is `source_trust_level`. Every hit fell
#     back to the "editorial" default, so the authority boost that CLAUDE.md
#     requires (official > semi_official > editorial > private) multiplied every
#     passage by 1.0 and reordered nothing. This one affected BM25, i.e. the leg
#     that IS live.
#   * `_knn_search` requested `plain_text`, which only the KEYWORD index maps.
#     The vector index stores its body as `text_snippet`, so kNN passages would
#     have come back with empty text even once the query itself worked.
#
# Under `dynamic: 'strict'` a bad WRITE fails loudly; a bad READ does not. A
# `_source` naming a field that does not exist is simply absent from the
# response, and a `knn` clause naming one is a 400 the caller may swallow.
# Nothing else in the stack can catch that, so it is caught here.
# ---------------------------------------------------------------------------

# The knn_vector field on `legal_documents_vector` (384-dim, lucene/hnsw/cosinesimil).
_VECTOR_EMBEDDING_FIELD = "embedding_vector"

# Every field mapped by buildKeywordIndexMapping().
_KEYWORD_INDEX_FIELDS = frozenset(
    {
        "title", "short_title", "plain_text", "section_text",
        "citation_text", "gr_no", "gr_no_digits", "docket_no", "ponente",
        "document_id", "section_id", "document_type", "court", "court_key",
        "jurisdiction", "language", "status", "source_id", "source_trust_level",
        "section_type", "bar_subjects", "topics",
        "is_official", "is_published", "decision_date", "promulgation_date",
        "publication_date", "created_at",
    }
)

# Every field mapped by buildVectorIndexMapping(). Note what is ABSENT:
# no `plain_text`, no `section_text`, no `section_type`.
_VECTOR_INDEX_FIELDS = frozenset(
    {
        _VECTOR_EMBEDDING_FIELD,
        "document_id", "section_id", "document_type", "court", "court_key",
        "source_trust_level", "is_official", "is_published", "decision_date",
        "text_snippet", "title", "citation_text",
    }
)

# `_source` lists. The body field is the one real difference between the two
# indices — `plain_text` on keyword, `text_snippet` on vector — so they cannot
# share one list.
_KEYWORD_SOURCE_FIELDS = [
    "document_id",
    "section_id",
    "title",
    "citation_text",
    "plain_text",
    "court",
    "decision_date",
    "document_type",
    "source_trust_level",
]

_VECTOR_SOURCE_FIELDS = [
    "document_id",
    "section_id",
    "title",
    "citation_text",
    "text_snippet",
    "court",
    "decision_date",
    "document_type",
    "source_trust_level",
]

# Retrieval legs, named so a degraded result says WHICH half of the hybrid died.
_LEG_BM25 = "bm25"
_LEG_KNN = "knn"


def _opensearch_reason(exc: httpx.HTTPError) -> str:
    """Pull the human-readable reason out of an OpenSearch error response.

    ``httpx``'s own message for a rejected query is "Client error '400 Bad
    Request'", which is true of a wrong field name, a malformed filter and a
    missing knn plugin alike. OpenSearch puts the distinguishing detail in the
    body — ``error.root_cause[].reason``, e.g. "field 'embedding' not found" —
    and that is the line that turns a silent degradation into a diagnosis.

    Best-effort by construction: a transport error has no response at all and a
    proxy may return HTML. Never raises; the caller is already handling a
    failure and must not be handed a second one.
    """
    response = getattr(exc, "response", None)
    if response is None:
        return f"{type(exc).__name__}: {exc}"

    try:
        payload = response.json()
    except Exception:  # noqa: BLE001 - body may be HTML, empty, or truncated
        body = (response.text or "").strip()
        if not body:
            return f"HTTP {response.status_code}"
        return f"HTTP {response.status_code}: {body[:300]}"

    error = payload.get("error") if isinstance(payload, dict) else None
    if isinstance(error, dict):
        root = error.get("root_cause")
        if isinstance(root, list) and root:
            first = root[0]
            if isinstance(first, dict) and first.get("reason"):
                return f"HTTP {response.status_code}: {first['reason']}"
        if error.get("reason"):
            return f"HTTP {response.status_code}: {error['reason']}"
    return f"HTTP {response.status_code}: {str(payload)[:300]}"


def _filter_clauses(filter_terms: dict[str, Any] | None) -> list[dict[str, Any]]:
    """Expand a ``{field: value}`` map into OpenSearch term/terms clauses.

    A list value becomes a ``terms`` clause, a scalar becomes ``term``. Shared by
    ``retrieve_by_query`` (which places the result in ``must``) and the two
    ``hybrid_retrieve`` arms (which place it in ``filter``) so the two paths
    cannot drift in how they interpret a filter map.
    """
    if not filter_terms:
        return []

    clauses: list[dict[str, Any]] = []
    for field, value in filter_terms.items():
        if isinstance(value, list):
            clauses.append({"terms": {field: value}})
        else:
            clauses.append({"term": {field: value}})
    return clauses


async def hybrid_retrieve(
    query: str,
    intent: QueryIntent,
    top_k: int = 30,
    embedding: list[float] | None = None,
    filter_terms: dict[str, Any] | None = None,
) -> SearchResult:
    """Execute hybrid BM25 + kNN retrieval and fuse results with RRF.

    Args:
        query: The user's search query.
        intent: Classified query intent (drives field boosting).
        top_k: Number of passages to return after fusion.
        embedding: Pre-computed query embedding vector. If None, only BM25 is used.
        filter_terms: Optional ``{field: value}`` restriction applied to BOTH
            arms. Applying it to only one would not narrow the result set: RRF
            fuses the two arms, so an unfiltered kNN arm would reintroduce
            passages the BM25 filter had just excluded.

    Returns:
        SearchResult with fused and authority-boosted passages.
    """
    degraded_legs: list[str] = []

    # BM25 is the load-bearing arm: if it fails, the caller has NO results and
    # must be told so. ``opensearch_search`` raises, and that error is allowed
    # to propagate all the way to the router's 500 handler on purpose — an
    # answer built on zero passages because the cluster was unreachable is the
    # exact failure this branch exists to stop being silent. It is still
    # recorded as a failed leg on the way past, so the two legs report failure
    # through one mechanism and a log search for a dead leg finds both.
    try:
        bm25_hits = await _bm25_search(query, intent, top_k=top_k * 2, filter_terms=filter_terms)
    except httpx.HTTPError as exc:
        logger.error(
            "Retrieval leg %r failed on index %s: %s",
            _LEG_BM25,
            _KEYWORD_INDEX,
            _opensearch_reason(exc),
            exc_info=True,
        )
        raise

    knn_hits: list[dict[str, Any]] = []

    if embedding is None:
        # NOT a healthy state, and it is the current production state: nothing
        # in this service computes a query embedding, so this branch is taken on
        # every request and the "hybrid" pipeline is BM25-only. Recorded rather
        # than passed over in silence — a leg that never runs is exactly as
        # invisible as a leg that fails on every query, which is how the
        # `embedding` field-name bug survived.
        degraded_legs.append(f"{_LEG_KNN}:not_configured")
    else:
        # The kNN arm IS allowed to degrade, and this is the opt-in described
        # in shared/opensearch.opensearch_search. A vector-index or knn-plugin
        # failure leaves a complete BM25 result set standing; failing the whole
        # request there would be a strictly worse answer than the hybrid
        # pipeline's own documented BM25-only fallback.
        try:
            knn_hits = await _knn_search(embedding, top_k=top_k * 2, filter_terms=filter_terms)
        except httpx.HTTPError as exc:
            # The OpenSearch reason is logged explicitly. Without it the 400 for
            # a wrong field name reads identically to a cluster outage, and
            # `exc_info` alone shows only "Client error '400 Bad Request'".
            logger.error(
                "Retrieval leg %r failed on index %s: %s — degrading to BM25-only",
                _LEG_KNN,
                _VECTOR_INDEX,
                _opensearch_reason(exc),
                exc_info=True,
            )
            degraded_legs.append(f"{_LEG_KNN}:http_error")

    if degraded_legs:
        logger.error(
            "Hybrid retrieval DEGRADED — legs unavailable: %s (intent=%s)",
            ", ".join(degraded_legs),
            intent.value,
        )

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
        degraded=bool(degraded_legs),
        degraded_legs=degraded_legs,
    )


async def _bm25_search(
    query: str,
    intent: QueryIntent,
    top_k: int = 60,
    filter_terms: dict[str, Any] | None = None,
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
        "_source": _KEYWORD_SOURCE_FIELDS,
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

    # Scoping goes in `filter` context, not `must`. A filter is a hard yes/no
    # that contributes nothing to _score, so passage scores inside a scoped
    # query stay on the same scale as an unscoped one — which matters because
    # check_abstention compares the top score against a fixed threshold.
    # (retrieve_by_query puts its filter_terms in `must` instead; that path
    # feeds callers who do not run the abstention check.)
    clauses = _filter_clauses(filter_terms)
    if clauses:
        inner = body["query"]
        if "bool" in inner:
            inner["bool"]["filter"] = clauses
        else:
            body["query"] = {"bool": {"must": [inner], "filter": clauses}}

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
                "source_authority_level": source.get("source_trust_level", "editorial"),
                "bm25_score": hit.get("_score", 0.0),
                "bm25_rank": rank,
            }
        )

    return results


async def _knn_search(
    embedding: list[float],
    top_k: int = 60,
    filter_terms: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """Execute kNN vector search on OpenSearch."""
    knn_clause: dict[str, Any] = {
        "vector": embedding,
        "k": top_k,
    }

    # OpenSearch applies a kNN `filter` during graph traversal rather than after
    # it, so the k nearest neighbours are drawn from the matching subset instead
    # of being found first and then discarded.
    clauses = _filter_clauses(filter_terms)
    if clauses:
        knn_clause["filter"] = {"bool": {"filter": clauses}}

    body: dict[str, Any] = {
        "size": top_k,
        "query": {
            "knn": {
                _VECTOR_EMBEDDING_FIELD: knn_clause,
            },
        },
        "_source": _VECTOR_SOURCE_FIELDS,
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
                # `text_snippet`, not `plain_text` — the vector index does not
                # map the latter, so reading it yields an empty passage body.
                "text": (source.get("text_snippet", "") or "")[:2000],
                "court": source.get("court", ""),
                "decision_date": source.get("decision_date", ""),
                "document_type": source.get("document_type", ""),
                "source_authority_level": source.get("source_trust_level", "editorial"),
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

# Keyword-index fields. `source_trust_level` for the same reason as
# `_KEYWORD_SOURCE_FIELDS`: `source_authority_level` is the name of the field on
# our Passage model, never the name of a field in either index.
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
    "source_trust_level",
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

    must_clauses.extend(_filter_clauses(filter_terms))

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
        source_authority_level=source.get("source_trust_level", "editorial"),
        score=hit.get("_score", 0.0),
        bm25_score=hit.get("_score", 0.0),
        knn_score=0.0,
        rerank_score=None,
    )
