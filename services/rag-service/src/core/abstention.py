"""Abstention handling — decide when the pipeline should refuse to answer.

Per CLAUDE.md:
- If reranker's top passage score < threshold OR < 3 relevant passages found,
  return abstention response. Never hallucinate.
"""

from __future__ import annotations

import logging

from ..config import settings
from .schemas import Passage
from .types import AbstentionReason

logger = logging.getLogger(__name__)


def check_abstention(
    passages: list[Passage],
    min_passages: int | None = None,
) -> AbstentionReason | None:
    """Check whether the pipeline should abstain from answering.

    Args:
        passages: Reranked passages (post-reranking, pre-context-packing).
        min_passages: Override the passage-count floor. Callers retrieving from
            a single document pass the lower scoped floor, because the count
            there measures how long the document is rather than how well
            corroborated the answer is. Defaults to the corpus-wide setting.

    Returns:
        An AbstentionReason if the pipeline should abstain, or None if OK to proceed.
    """
    floor = min_passages if min_passages is not None else settings.abstention_min_passages

    if not passages:
        return AbstentionReason.NO_RESULTS

    # Check minimum passage count
    if len(passages) < floor:
        logger.info(
            "Abstaining: only %d passages (need %d)",
            len(passages),
            floor,
        )
        return AbstentionReason.INSUFFICIENT_PASSAGES

    # Check top passage score threshold
    top_score = passages[0].rerank_score if passages[0].rerank_score is not None else passages[0].score
    if top_score < settings.abstention_score_threshold:
        logger.info(
            "Abstaining: top score %.4f < threshold %.4f",
            top_score,
            settings.abstention_score_threshold,
        )
        return AbstentionReason.LOW_RELEVANCE

    return None


def generate_abstention_response(
    reason: AbstentionReason,
    query: str,
    scoped: bool = False,
) -> str:
    """Generate a user-friendly abstention message.

    Args:
        reason: Why the pipeline is abstaining.
        query: The original user query (for context in the message).
        scoped: True when retrieval was restricted to a single document. The
            corpus-wide copy tells the reader to try a more specific query or
            search different terms, which is unactionable advice when the search
            pool is the one document already open in front of them — the answer
            is not elsewhere in the corpus, it is simply not in this document.

    Returns:
        A polite, informative message explaining why no answer was generated.
    """
    if scoped:
        scoped_messages: dict[AbstentionReason, str] = {
            AbstentionReason.NO_RESULTS: (
                "This document does not appear to cover that. Nothing in its text "
                "matched your question closely enough to answer from."
            ),
            AbstentionReason.INSUFFICIENT_PASSAGES: (
                "This document does not appear to cover that. Nothing in its text "
                "matched your question closely enough to answer from."
            ),
            AbstentionReason.VALIDATION_FAILED: (
                "I could not ground an answer to that in this document. Rather than "
                "give you something this document does not actually support, I am "
                "not answering."
            ),
            AbstentionReason.LOW_RELEVANCE: (
                "The parts of this document that matched your question do not look "
                "relevant enough to answer from."
            ),
        }
        return scoped_messages.get(
            reason,
            "I am unable to answer that from this document.",
        )

    messages: dict[AbstentionReason, str] = {
        AbstentionReason.NO_RESULTS: (
            "I was unable to find any relevant legal documents matching your query. "
            "Please try rephrasing your question or using more specific legal terms, "
            "case citations, or statute references."
        ),
        AbstentionReason.INSUFFICIENT_PASSAGES: (
            "I found some potentially relevant documents but not enough to provide "
            "a well-supported answer. For reliable legal research, I need at least "
            "3 relevant source passages. Please try a more specific query or "
            "consult a legal professional for this topic."
        ),
        AbstentionReason.LOW_RELEVANCE: (
            "The documents I found do not appear to be sufficiently relevant to "
            "your query. Rather than risk providing unsupported information, "
            "I recommend refining your search terms or consulting a legal "
            "professional for guidance on this topic."
        ),
        AbstentionReason.VALIDATION_FAILED: (
            "I generated a response but could not verify its citations against "
            "authoritative sources. To maintain accuracy, I cannot provide an "
            "unverified answer. Please try a more specific query."
        ),
    }

    return messages.get(
        reason,
        "I am unable to provide a reliable answer for this query at this time.",
    )
