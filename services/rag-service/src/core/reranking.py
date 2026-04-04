"""Cross-encoder reranker with fallback to RRF scores.

When the reranker service is not deployed, passages retain their RRF fusion
scores. When available, the reranker replaces scores with cross-encoder
relevance estimates.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from ..config import settings
from .schemas import Passage

logger = logging.getLogger(__name__)


async def rerank_passages(
    query: str,
    passages: list[Passage],
    top_k: int = 8,
) -> list[Passage]:
    """Rerank passages using cross-encoder, falling back to RRF scores.

    Args:
        query: The original user query.
        passages: Passages from hybrid retrieval, already RRF-scored.
        top_k: Number of passages to return after reranking.

    Returns:
        Top-k passages sorted by reranker score (or RRF score on fallback).
    """
    if not passages:
        return []

    reranker_url = settings.reranker_url
    if not reranker_url:
        logger.info("No reranker configured, using RRF scores")
        return _fallback_rerank(passages, top_k)

    try:
        reranked = await _call_reranker(reranker_url, query, passages)
        reranked.sort(key=lambda p: p.rerank_score or 0.0, reverse=True)
        return reranked[:top_k]
    except Exception:
        logger.warning("Reranker call failed, falling back to RRF scores", exc_info=True)
        return _fallback_rerank(passages, top_k)


async def _call_reranker(
    reranker_url: str,
    query: str,
    passages: list[Passage],
) -> list[Passage]:
    """Call external cross-encoder reranker service.

    Expects the reranker to accept:
        POST /rerank
        {"query": "...", "passages": [{"id": "...", "text": "..."}, ...]}

    And return:
        {"results": [{"id": "...", "score": 0.95}, ...]}
    """
    payload: dict[str, Any] = {
        "query": query,
        "passages": [
            {"id": p.id, "text": p.text[:1000]}  # Limit passage length for reranker
            for p in passages
        ],
    }

    async with httpx.AsyncClient(timeout=settings.reranker_timeout) as client:
        response = await client.post(f"{reranker_url}/rerank", json=payload)
        response.raise_for_status()
        data: dict[str, Any] = response.json()

    # Map reranker scores back to passages
    score_map: dict[str, float] = {}
    for result in data.get("results", []):
        score_map[result["id"]] = result["score"]

    reranked: list[Passage] = []
    for p in passages:
        rerank_score = score_map.get(p.id)
        reranked.append(
            p.model_copy(update={"rerank_score": rerank_score})
        )

    return reranked


def _fallback_rerank(passages: list[Passage], top_k: int) -> list[Passage]:
    """Fallback: sort by existing RRF score."""
    sorted_passages = sorted(passages, key=lambda p: p.score, reverse=True)
    return sorted_passages[:top_k]
