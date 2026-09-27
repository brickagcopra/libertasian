"""The one retrieval path: embed → hybrid (BM25 + kNN) → rerank + authority boost.

This used to live inline in `answer/service.py`, and only /answer ran it. Memos
and research workspaces called `retrieve_by_query`, which is BM25 only — no kNN
leg, no cross-encoder, no authority boost — so the two features that produce
the longest, most citation-heavy output were grounded on the weakest retrieval
in the service. Every caller that ranks passages for a query goes through
`retrieve_ranked` so they cannot drift apart again.

Abstention and citation validation stay with the caller: what to do with a weak
result set (refuse, as /answer does, or generate and warn) is a product decision
per feature, not a retrieval one. `top_rerank_score` is returned so a caller
that abstains judges the RAW relevance score, not the authority-boosted order.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from .clients import embed_query
from .intent import classify_intent
from .reranking import rerank_passages
from .retrieval import hybrid_retrieve
from .schemas import Passage
from .types import QueryIntent

# Candidate pool handed to the reranker. /answer has always retrieved 30.
DEFAULT_CANDIDATE_K = 30


class RankedPassages(BaseModel):
    """The ranked result of `retrieve_ranked`."""

    model_config = ConfigDict(strict=True)

    passages: list[Passage] = Field(
        default_factory=list,
        description="Top-k passages in final (reranked, authority-boosted) order.",
    )
    degraded_legs: list[str] = Field(
        default_factory=list,
        description="Retrieval legs, then reranking, that did not contribute, with why.",
    )
    top_rerank_score: float | None = Field(
        default=None,
        description=(
            "Raw (pre-boost) top score — cross-encoder, or RRF on the fallback "
            "path. What abstention must compare against its threshold."
        ),
    )
    candidates: int = Field(
        default=0,
        description="How many passages hybrid retrieval handed to the reranker.",
    )
    intent: QueryIntent = Field(default=QueryIntent.GENERAL)


def _filter_terms(
    filters: dict[str, Any] | None, document_id: str | None
) -> dict[str, Any] | None:
    """Merge the optional document scope into the filter terms.

    Returns None rather than ``{}`` when nothing restricts retrieval, which is
    what `hybrid_retrieve` has always been given for an unscoped query.
    """
    terms: dict[str, Any] = dict(filters or {})
    if document_id is not None:
        terms["document_id"] = document_id
    return terms or None


async def retrieve_ranked(
    query: str,
    *,
    top_k: int,
    filters: dict[str, Any] | None = None,
    document_id: str | None = None,
    intent: QueryIntent | None = None,
    candidate_k: int = DEFAULT_CANDIDATE_K,
) -> RankedPassages:
    """Retrieve and rank passages for ``query`` through the full pipeline.

    Args:
        query: The (already trimmed) query text. It is embedded as-is.
        top_k: Passages to return after reranking and the authority boost.
        filters: Optional ``{field: value}`` restriction applied to both legs.
        document_id: Narrow retrieval to one document.
        intent: The classified intent, when the caller already has it (it is
            also returned). Classified from ``query`` when omitted.
        candidate_k: Size of the fused candidate pool handed to the reranker.
    """
    resolved_intent = intent if intent is not None else classify_intent(query)

    # The embedding is computed once per request and handed to both retrieval
    # legs; `None` is a supported value that runs BM25-only.
    embedding = await embed_query(query)
    search_result = await hybrid_retrieve(
        query,
        resolved_intent,
        top_k=candidate_k,
        embedding=embedding,
        filter_terms=_filter_terms(filters, document_id),
    )

    # `degraded_legs` says whether the cross-encoder actually ran; RRF order is
    # a fallback, not an equivalent. The authority boost is applied inside
    # `rerank_passages`, after the scores that decide the final order exist.
    rerank_outcome = await rerank_passages(
        query,
        search_result.passages,
        top_k=top_k,
    )

    return RankedPassages(
        passages=rerank_outcome.passages,
        # Both stages report their own degradation; this is the first place a
        # caller can see them together, which is the only place the distinction
        # between "no good passages exist" and "half the pipeline was down" is
        # actually actionable.
        degraded_legs=[*search_result.degraded_legs, *rerank_outcome.degraded_legs],
        top_rerank_score=rerank_outcome.top_score,
        candidates=len(search_result.passages),
        intent=resolved_intent,
    )
