"""Shared pipeline schemas for passages, search results, context bundles, and citations."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class Passage(BaseModel):
    """A retrieved document passage with metadata."""

    model_config = ConfigDict(strict=True)

    id: str = Field(description="OpenSearch hit ID")
    document_id: str = Field(description="PostgreSQL legal_documents.id")
    section_id: str | None = Field(default=None, description="Section ID if applicable")
    title: str = Field(default="")
    citation_text: str = Field(default="")
    text: str = Field(description="Passage content, truncated to max passage length")
    court: str = Field(default="")
    decision_date: str = Field(default="")
    document_type: str = Field(default="")
    source_authority_level: str = Field(
        default="editorial",
        description="official | semi_official | editorial | private",
    )
    score: float = Field(default=0.0, description="Combined retrieval score")
    bm25_score: float = Field(default=0.0)
    knn_score: float = Field(default=0.0)
    rerank_score: float | None = Field(default=None)


class SearchResult(BaseModel):
    """Result of a hybrid retrieval operation."""

    model_config = ConfigDict(strict=True)

    passages: list[Passage] = Field(default_factory=list)
    total_bm25_hits: int = Field(default=0)
    total_knn_hits: int = Field(default=0)
    query_intent: str = Field(default="general")
    degraded: bool = Field(
        default=False,
        description=(
            "True when hybrid retrieval ran on fewer than both legs. A kNN "
            "field-name bug returned HTTP 400 on 100% of queries for months "
            "and the pipeline looked healthy throughout, because a hit count "
            "of zero is indistinguishable from a leg that never worked."
        ),
    )
    degraded_legs: list[str] = Field(
        default_factory=list,
        description=(
            "Names of the retrieval legs that did not contribute, each with why "
            "— e.g. 'knn:http_error', 'knn:not_configured'. Empty iff "
            "``degraded`` is False."
        ),
    )


class RerankOutcome(BaseModel):
    """Result of a reranking pass, with whether it actually happened.

    Reranking used to return a bare passage list, so a reranker that was down
    was indistinguishable from one that was not deployed — both silently
    returned RRF-ordered passages. That is the same silent-degradation shape as
    the kNN leg's, and it is reported the same way.
    """

    model_config = ConfigDict(strict=True)

    passages: list[Passage] = Field(default_factory=list)
    degraded: bool = Field(
        default=False,
        description="True when the returned order is RRF fallback, not cross-encoder.",
    )
    degraded_legs: list[str] = Field(
        default_factory=list,
        description=(
            "Why reranking did not run — 'reranker:not_configured', "
            "'reranker:unreachable', 'reranker:failed'. Empty iff ``degraded`` "
            "is False."
        ),
    )


class CitationRef(BaseModel):
    """A citation reference extracted from LLM output."""

    model_config = ConfigDict(strict=True)

    source_id: str = Field(description="Document ID referenced in the answer")
    section_id: str | None = Field(default=None)
    text: str = Field(default="", description="Cited passage text or summary")
    valid: bool = Field(default=False, description="Whether this citation was validated")


class ContextBundle(BaseModel):
    """Packed context ready for LLM generation."""

    model_config = ConfigDict(strict=True)

    formatted_context: str = Field(description="Formatted passage text within token budget")
    passages_included: int = Field(description="Number of passages that fit in the budget")
    passages_total: int = Field(description="Total passages available before packing")
    estimated_tokens: int = Field(description="Estimated token count of formatted context")
    token_budget: int = Field(description="Token budget that was enforced")


class ValidationResult(BaseModel):
    """Result of citation validation on a generated response."""

    model_config = ConfigDict(strict=True)

    is_valid: bool = Field(description="Whether all citations check out")
    valid_citations: list[CitationRef] = Field(default_factory=list)
    invalid_citations: list[CitationRef] = Field(default_factory=list)
    unsupported_claims: list[str] = Field(
        default_factory=list,
        description="Claims in the answer that lack citation support",
    )
    valid_count: int = Field(default=0)
    total_count: int = Field(default=0)
