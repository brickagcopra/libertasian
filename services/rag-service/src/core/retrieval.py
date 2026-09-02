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

from ..config import settings
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

# document_type boosts applied to CODAL_REFERENCE queries in `_bm25_search`.
#
# These are the values that actually EXIST in `legal_documents_keyword`. The
# block used to boost "statute", "code" and "rule"; a terms aggregation over
# the live index on 2026-09-02 returned ZERO documents for all three, so it
# had been a no-op since it was written — a codal query got no codal boost at
# all, and the Constitution (by far the largest codal body in the corpus)
# could never be lifted above case law. Measured document_type counts on the
# same run: decision (case law, not boosted here), constitution, codal,
# republic_act, rules_of_court, presidential_decree, executive_order.
#
# Before changing this list, re-run the aggregation. A boost naming a value
# the corpus does not have is silently dead weight, not a tuning knob.
_CODAL_TYPE_BOOSTS: dict[str, float] = {
    "constitution": 3.0,
    "codal": 2.0,
    "republic_act": 2.0,
    "rules_of_court": 1.5,
    "presidential_decree": 1.5,
    "executive_order": 1.5,
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
# indices — `plain_text` or `section_text` on keyword, `text_snippet` on vector —
# so they cannot share one list.
#
# The keyword index stores TWO row shapes (see
# `apps/api/src/modules/search/index-rebuild.service.ts`): one document-level row
# per document carrying `plain_text` (every section joined), plus one row per
# section carrying `section_text` and NO `plain_text`. Section rows are the bulk
# of the index — 68,842 of 85,977 on prod 2026-08-14 — so both fields must be
# requested and the body read from whichever is present.
_KEYWORD_SOURCE_FIELDS = [
    "document_id",
    "section_id",
    "title",
    "citation_text",
    "plain_text",
    "section_text",
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


# One-shot latch for the "kNN was never wired up" warning. Deliberately lazy
# rather than emitted at import: it fires only if retrieval actually runs
# without an embedding, so a process that never serves a query stays quiet.
_knn_unconfigured_warned = False


def _warn_knn_unconfigured() -> None:
    """Warn once per process that hybrid retrieval is running on one leg.

    WARNING, once — not ERROR per request. An unset embedding URL is a standing
    configuration choice, so the condition holds for every request indefinitely.
    Alerting on it per request (SENTRY_DSN is set in production) would emit a
    continuous stream of identical events and drown the runtime failures this
    module's ERROR logging is actually for. The ``degraded_legs`` field on every
    ``SearchResult`` remains the per-request signal for anything measuring it.
    """
    global _knn_unconfigured_warned  # noqa: PLW0603
    if _knn_unconfigured_warned:
        return
    _knn_unconfigured_warned = True
    logger.warning(
        "kNN retrieval leg is NOT configured — RAG_EMBEDDING_SERVICE_URL is unset, "
        "so no query embedding is computed and retrieval is BM25-only. Every "
        "SearchResult will carry degraded_legs=['%s:not_configured']. Logged once "
        "per process.",
        _LEG_KNN,
    )


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


def _keyword_body(source: dict[str, Any]) -> str:
    """Read a passage body out of a keyword-index ``_source``.

    `plain_text` first, then `section_text` — the keyword index holds both row
    shapes and a section row has no `plain_text` at all. Reading only
    `plain_text` returned an empty body for 68,842 of the 85,977 rows on prod
    (2026-08-14); on a live "theft" query 27 of 30 retrieved candidates came
    back with `text == ""`, and empty passages score a constant in the
    cross-encoder (0.755) that beat real content into all 8 kept slots, so the
    answer generator abstained with the corpus sitting right there.

    A document-level row carries only `plain_text` and a section row only
    `section_text`, so the order matters only for a hypothetical row with both;
    `plain_text` wins there because it is the whole document.
    """
    return str(source.get("plain_text") or source.get("section_text") or "")


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
    # Legs that FAILED at runtime, as opposed to legs that were never wired up.
    # Only these are worth an ERROR per request; see `_warn_knn_unconfigured`.
    failed_legs: list[str] = []

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
        # No embedding, so no kNN leg. WHY there is no embedding decides both the
        # label and the log level, and conflating them would send someone hunting
        # for an env var that is already set:
        #
        #  * URL unset — a standing configuration choice. True of 100% of
        #    requests for as long as it holds, so it warns ONCE per process and
        #    never at ERROR. An alert per request would bury real failures
        #    (SENTRY_DSN is set in prod).
        #  * URL set but `embed_query` returned None — the service is down,
        #    slow, or returned something unusable. A genuine runtime failure,
        #    already logged at ERROR with the reason by the client itself.
        #
        # Either way `degraded_legs` carries it on the response, which is the
        # per-request signal.
        if settings.embedding_service_url:
            degraded_legs.append(f"{_LEG_KNN}:embedding_failed")
            failed_legs.append(f"{_LEG_KNN}:embedding_failed")
        else:
            degraded_legs.append(f"{_LEG_KNN}:not_configured")
            _warn_knn_unconfigured()
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
            failed_legs.append(f"{_LEG_KNN}:http_error")

    # ERROR only for legs that genuinely broke — an exception or a non-200 from
    # OpenSearch. A leg that was never configured is reported on the result and
    # warned about once, not alarmed on per request.
    if failed_legs:
        logger.error(
            "Hybrid retrieval DEGRADED — legs failed at runtime: %s (intent=%s)",
            ", ".join(failed_legs),
            intent.value,
        )

    # Fuse with RRF
    fused = _rrf_fuse(bm25_hits, knn_hits)

    # Defence in depth against a bodyless hit, dropped BEFORE the top_k slice so
    # it cannot consume a candidate slot and, downstream, a context-budget slot.
    # A passage with no text cannot support an answer, but it is not inert: the
    # cross-encoder scores empty text as a constant (0.755 for "theft") which
    # outranks genuinely weaker-but-real passages, so an empty row is actively
    # worse than an absent one. The `plain_text`/`section_text` fallback above
    # is what fixes the 80%-of-the-index case; this catches whatever is left —
    # a section indexed from an empty body, a future third row shape.
    non_empty = [p for p in fused if (p.get("text") or "").strip()]
    dropped = len(fused) - len(non_empty)
    if dropped:
        logger.debug(
            "Dropped %d/%d retrieved passage(s) with a blank body before top-k (intent=%s)",
            dropped,
            len(fused),
            intent.value,
        )
    fused = non_empty

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
                    {"term": {"document_type": {"value": value, "boost": boost}}}
                    for value, boost in _CODAL_TYPE_BOOSTS.items()
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
                # `plain_text` OR `section_text`: the keyword index stores a
                # document-level row with the former and one row per section
                # with the latter, and section rows are ~80% of it.
                "text": _keyword_body(source)[:2000],
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
    "section_text",
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
        # `plain_text` OR `section_text` — a per-section row has no
        # `plain_text`, and this path retrieves sections by design.
        text=_keyword_body(source)[:text_truncate],
        court=source.get("court", ""),
        decision_date=source.get("decision_date", ""),
        document_type=source.get("document_type", ""),
        source_authority_level=source.get("source_trust_level", "editorial"),
        score=hit.get("_score", 0.0),
        bm25_score=hit.get("_score", 0.0),
        knn_score=0.0,
        rerank_score=None,
    )
