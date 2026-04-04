"""Token budget enforcement for context packing.

Per CLAUDE.md:
- 4096 tokens max for answer context
- 8192 tokens max for digest/memo context

Uses character-based estimation (4 chars ~ 1 token) for MVP.
Upgrade to tiktoken when model-specific tokenization is needed.
"""

from __future__ import annotations

from ..shared.formatting import format_passages
from .schemas import ContextBundle, Passage

# Character-to-token ratio for estimation
_CHARS_PER_TOKEN = 4


def estimate_tokens(text: str) -> int:
    """Estimate token count from text length. 4 chars ~ 1 token."""
    return len(text) // _CHARS_PER_TOKEN


def pack_context(
    passages: list[Passage],
    token_budget: int = 4096,
) -> ContextBundle:
    """Pack passages into a context string that fits within the token budget.

    Greedily includes passages in score order until the budget is exhausted.
    Each passage is formatted with source anchors before measuring.

    Args:
        passages: Reranked passages in priority order.
        token_budget: Maximum tokens for the formatted context.

    Returns:
        ContextBundle with the formatted text and metadata.
    """
    if not passages:
        return ContextBundle(
            formatted_context="(No source passages available.)",
            passages_included=0,
            passages_total=0,
            estimated_tokens=0,
            token_budget=token_budget,
        )

    included: list[Passage] = []
    current_tokens = 0

    for passage in passages:
        # Format this single passage to measure its size
        passage_text = _format_single_passage(passage)
        passage_tokens = estimate_tokens(passage_text)

        # Account for separator between passages (~10 tokens)
        separator_tokens = 10 if included else 0

        if current_tokens + passage_tokens + separator_tokens > token_budget:
            break

        included.append(passage)
        current_tokens += passage_tokens + separator_tokens

    formatted = format_passages(included)

    return ContextBundle(
        formatted_context=formatted,
        passages_included=len(included),
        passages_total=len(passages),
        estimated_tokens=estimate_tokens(formatted),
        token_budget=token_budget,
    )


def _format_single_passage(passage: Passage) -> str:
    """Format a single passage for token estimation."""
    header = f"[SOURCE {passage.document_id}"
    if passage.section_id:
        header += f"§{passage.section_id}"
    header += f"] {passage.title}"
    if passage.citation_text:
        header += f" | {passage.citation_text}"
    if passage.court:
        header += f" | {passage.court}"
    if passage.decision_date:
        header += f" | {passage.decision_date}"
    return f"{header}\n{passage.text}"
