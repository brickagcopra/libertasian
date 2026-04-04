"""Enums and type definitions for the RAG pipeline."""

from enum import Enum


class QueryIntent(str, Enum):
    """Classified intent of the user's legal query."""

    CASE_LOOKUP = "case_lookup"
    """Direct lookup by G.R. number, SCRA citation, or case title."""

    CODAL_REFERENCE = "codal_reference"
    """Reference to a specific statute, code, or provision."""

    LEGAL_QUESTION = "legal_question"
    """Open-ended legal question requiring analysis."""

    DOCTRINE_SEARCH = "doctrine_search"
    """Search for a specific legal doctrine or principle."""

    PROCEDURAL_QUERY = "procedural_query"
    """Question about court procedure, filing requirements, or timelines."""

    GENERAL = "general"
    """Fallback for queries that don't match a specific pattern."""


class AbstentionReason(str, Enum):
    """Reason why the pipeline chose to abstain from answering."""

    LOW_RELEVANCE = "low_relevance"
    """Top reranker scores are below threshold — no sufficiently relevant passages found."""

    INSUFFICIENT_PASSAGES = "insufficient_passages"
    """Fewer than 3 relevant passages found — cannot provide well-supported answer."""

    NO_RESULTS = "no_results"
    """Retrieval returned zero results."""

    VALIDATION_FAILED = "validation_failed"
    """Generated answer failed citation validation checks."""


class ConfidenceLevel(str, Enum):
    """Discrete confidence level for pipeline outputs."""

    HIGH = "high"
    """confidence >= 0.7 — well-supported by authoritative sources."""

    MEDIUM = "medium"
    """0.4 <= confidence < 0.7 — partially supported, may need review."""

    LOW = "low"
    """confidence < 0.4 — weakly supported, flagged for human review."""
