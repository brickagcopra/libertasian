"""Request/response schemas for the /answer endpoint."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from ..core.schemas import CitationRef
from ..core.types import AbstentionReason, ConfidenceLevel, QueryIntent

# Bounds on `AnswerRequest.history`. The transcript is replayed into the
# generation prompt, so an unbounded one is a token-budget and cost hole as much
# as a correctness one — it would crowd out the SOURCE PASSAGES the answer is
# supposed to be grounded in.
MAX_HISTORY_TURNS = 20
MAX_HISTORY_CONTENT_CHARS = 4000


class ConversationTurn(BaseModel):
    """One prior turn in a multi-turn conversation."""

    model_config = ConfigDict(strict=True)

    role: Literal["user", "assistant"] = Field(
        description="Who produced this turn.",
    )
    content: str = Field(
        min_length=1,
        max_length=MAX_HISTORY_CONTENT_CHARS,
        description="Turn text. Untrusted input, echoed into the prompt only.",
    )


class AnswerRequest(BaseModel):
    """Request body for the /answer endpoint."""

    model_config = ConfigDict(strict=True)

    query: str = Field(
        min_length=3,
        max_length=2000,
        description="The user's legal question or search query.",
    )
    organization_id: str | None = Field(
        default=None,
        description="Organization ID for tenant scoping (set by NestJS gateway).",
    )
    user_id: str | None = Field(
        default=None,
        description="User ID for audit logging (set by NestJS gateway).",
    )
    max_passages: int = Field(
        default=8,
        ge=1,
        le=20,
        description="Max passages for context (8 for answers per CLAUDE.md).",
    )
    include_sources: bool = Field(
        default=True,
        description="Whether to include source passage details in response.",
    )
    document_id: str | None = Field(
        default=None,
        description=(
            "Restrict retrieval to a single legal document. The caller's right to "
            "read it is verified by the NestJS gateway, not here."
        ),
    )
    history: list[ConversationTurn] | None = Field(
        default=None,
        max_length=MAX_HISTORY_TURNS,
        description=(
            "Prior conversation turns, oldest first. Used ONLY to give the "
            "generation prompt continuity — never as a retrieval signal and "
            "never as a citable source."
        ),
    )


class AnswerSource(BaseModel):
    """A source document referenced in the answer."""

    model_config = ConfigDict(strict=True)

    document_id: str
    section_id: str | None = None
    title: str = ""
    citation_text: str = ""
    court: str = ""
    decision_date: str = ""
    document_type: str = ""
    relevance_score: float = 0.0
    rerank_score: float | None = Field(
        default=None,
        description=(
            "Cross-encoder score for this passage, or None when the reranker "
            "did not run (see ``AnswerResponse.degraded_legs``). This is the "
            "value `abstention_score_threshold` is compared against — "
            "`relevance_score` is the RRF fused score and lives on a different "
            "scale entirely (~0.016 vs. 0.98–0.0007), so the threshold cannot "
            "be re-fit from live traffic without this field."
        ),
    )


class AnswerResponse(BaseModel):
    """Response body for the /answer endpoint."""

    model_config = ConfigDict(strict=True)

    answer: str = Field(description="The generated answer text with source citations.")
    query: str = Field(description="Echo of the original query.")
    intent: QueryIntent = Field(description="Classified intent of the query.")
    confidence: float = Field(ge=0.0, le=1.0, description="Confidence score 0-1.")
    confidence_level: ConfidenceLevel = Field(description="Discrete confidence level.")
    citations: list[CitationRef] = Field(
        default_factory=list,
        description="Validated citation references.",
    )
    sources: list[AnswerSource] = Field(
        default_factory=list,
        description="Source passages used in context.",
    )
    abstained: bool = Field(
        default=False,
        description="Whether the pipeline abstained from answering.",
    )
    abstention_reason: AbstentionReason | None = Field(
        default=None,
        description="Reason for abstention, if applicable.",
    )
    model_name: str = Field(default="")
    prompt_template_version: str = Field(default="")
    passages_used: int = Field(default=0, description="Number of passages packed into context.")
    passages_available: int = Field(
        default=0, description="Total passages retrieved before packing."
    )
    degraded: bool = Field(
        default=False,
        description=(
            "True when any retrieval or reranking leg did not contribute to "
            "this answer. Empty iff ``degraded_legs`` is empty."
        ),
    )
    degraded_legs: list[str] = Field(
        default_factory=list,
        description=(
            "Which legs did not contribute, and why — e.g. 'knn:http_error', "
            "'reranker:unreachable'. A degraded answer is still an answer, but "
            "its scores are not comparable to a healthy one's."
        ),
    )


class AnswerChunk(BaseModel):
    """A single chunk in a streaming answer response."""

    model_config = ConfigDict(strict=True)

    type: str = Field(description="Chunk type: 'text', 'metadata', 'done', 'error'.")
    content: str = Field(default="", description="Text content for 'text' chunks.")
    metadata: dict[str, object] | None = Field(
        default=None,
        description="Metadata payload for 'metadata' chunks.",
    )
