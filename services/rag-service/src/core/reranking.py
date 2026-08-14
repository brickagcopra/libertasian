"""Cross-encoder reranker with fallback to RRF scores.

When the reranker service is not deployed, passages retain their RRF fusion
scores. When available, the reranker replaces scores with cross-encoder
relevance estimates.

Why RRF alone is not enough: it fuses BM25 and kNN by **rank position**, not by
relevance. Measured on prod 2026-08-14, adding the kNN leg put the right
documents into the candidate set but not at the top of it — and it actively
regressed "constitution", where BM25 alone had returned all 8 passages from the
1987 Constitution and the fused set displaced them with Cagas v. COMELEC,
Magallona v. Ermita and Kida v. Senate. Scoring the fused set with a
cross-encoder is the fix; reweighting RRF is not.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from ..config import settings
from .schemas import Passage, RerankOutcome

logger = logging.getLogger(__name__)

# Degradation markers. Same vocabulary as the retrieval legs in
# `core/retrieval.py`: `<component>:<reason>`.
_MARKER_NOT_CONFIGURED = "reranker:not_configured"
_MARKER_UNREACHABLE = "reranker:unreachable"
_MARKER_FAILED = "reranker:failed"

# One-shot latch for the "no reranker deployed" notice, for the same reason as
# `retrieval._warn_knn_unconfigured`: an unset URL is a standing configuration
# choice that holds for 100% of requests, so alerting on it per request would
# emit one Sentry event per query forever and bury real failures.
_reranker_unconfigured_warned = False


def _warn_reranker_unconfigured() -> None:
    """Note once per process that reranking is not deployed."""
    global _reranker_unconfigured_warned  # noqa: PLW0603
    if _reranker_unconfigured_warned:
        return
    _reranker_unconfigured_warned = True
    logger.warning(
        "Reranker is NOT configured — RAG_RERANKER_URL is unset, so passages keep "
        "their RRF fusion order, which encodes rank position rather than "
        "relevance. Every rerank will carry degraded_legs=['%s']. Logged once "
        "per process.",
        _MARKER_NOT_CONFIGURED,
    )


def _internal_headers() -> dict[str, str]:
    """Auth headers for internal service-to-service calls.

    Mirrors ``worker-service/src/clients/embedding_client._internal_headers``.

    This function is why the reranker works at all. reranker-service enforces
    ``X-Internal-Api-Key`` exactly as embedding-service does, and this client
    previously sent **no headers whatsoever** — so the very first call in
    production would have been a 403, the broad ``except`` below would have
    swallowed it, and the pipeline would have quietly served RRF-ordered
    passages that look identical to "no reranker deployed". `test_reranking.py`
    asserts the header is sent.
    """
    return {"X-Internal-Api-Key": settings.internal_api_key}


async def rerank_passages(
    query: str,
    passages: list[Passage],
    top_k: int = 8,
) -> RerankOutcome:
    """Rerank passages using the cross-encoder, falling back to RRF scores.

    Args:
        query: The original user query.
        passages: Passages from hybrid retrieval, already RRF-scored.
        top_k: Number of passages to return after reranking.

    Returns:
        A `RerankOutcome` carrying the top-k passages and, when the
        cross-encoder did not run, why not. Never raises: a reranker failure
        must degrade ordering, never fail the answer.
    """
    if not passages:
        return RerankOutcome(passages=[])

    reranker_url = settings.reranker_url
    if not reranker_url:
        _warn_reranker_unconfigured()
        return RerankOutcome(
            passages=_fallback_rerank(passages, top_k),
            degraded=True,
            degraded_legs=[_MARKER_NOT_CONFIGURED],
        )

    try:
        reranked = await _call_reranker(reranker_url, query, passages)
    except httpx.TimeoutException:
        logger.error(
            "Reranker at %s timed out after %ss — falling back to RRF order",
            reranker_url,
            settings.reranker_timeout,
            exc_info=True,
        )
        return RerankOutcome(
            passages=_fallback_rerank(passages, top_k),
            degraded=True,
            degraded_legs=[_MARKER_UNREACHABLE],
        )
    except httpx.TransportError:
        logger.error(
            "Reranker at %s is unreachable — falling back to RRF order",
            reranker_url,
            exc_info=True,
        )
        return RerankOutcome(
            passages=_fallback_rerank(passages, top_k),
            degraded=True,
            degraded_legs=[_MARKER_UNREACHABLE],
        )
    except Exception:
        # An HTTP status error (a 403 from a missing or wrong internal key is
        # the one to watch for), a body that does not parse, a result missing
        # the keys we index. All are real runtime failures, so ERROR per
        # request — this is the opposite call from `not_configured` above, and
        # for the opposite reason: none of these is true of every request
        # forever.
        logger.error(
            "Reranker call to %s failed — falling back to RRF order",
            reranker_url,
            exc_info=True,
        )
        return RerankOutcome(
            passages=_fallback_rerank(passages, top_k),
            degraded=True,
            degraded_legs=[_MARKER_FAILED],
        )

    reranked.sort(key=lambda p: p.rerank_score or 0.0, reverse=True)
    return RerankOutcome(passages=reranked[:top_k])


async def _call_reranker(
    reranker_url: str,
    query: str,
    passages: list[Passage],
) -> list[Passage]:
    """Call the external cross-encoder reranker service.

    Expects the reranker to accept:
        POST /rerank
        {"query": "...", "passages": [{"id": "...", "text": "..."}, ...]}

    And return:
        {"results": [{"id": "...", "score": 0.95}, ...]}

    ``score`` is a 0-1 probability; reranker-service applies a sigmoid to the
    cross-encoder's raw logit so this holds. That matters beyond presentation:
    `check_abstention` compares the top passage's ``rerank_score`` against
    `abstention_score_threshold`.
    """
    payload: dict[str, Any] = {
        "query": query,
        "passages": [
            {"id": p.id, "text": p.text[:1000]}  # Limit passage length for reranker
            for p in passages
        ],
    }

    async with httpx.AsyncClient(timeout=settings.reranker_timeout) as client:
        response = await client.post(
            f"{reranker_url}/rerank",
            json=payload,
            headers=_internal_headers(),
        )
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
