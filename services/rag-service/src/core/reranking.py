"""Cross-encoder reranker with fallback to RRF scores.

When the reranker service is not deployed, passages retain their RRF fusion
scores. When available, the reranker replaces scores with cross-encoder
relevance estimates.

Either way the source-authority boost (`core/authority.py`) is applied HERE,
after the scores that decide the final order exist and before the top-k cut:
``final = rerank_score * boost``, or ``rrf_score * boost`` on the fallback
path. The raw, unboosted top score is returned separately on
`RerankOutcome.top_score` for abstention.

Why RRF alone is not enough: it fuses BM25 and kNN by **rank position**, not by
relevance. Measured on prod 2026-08-14, adding the kNN leg put the right
documents into the candidate set but not at the top of it — and it actively
regressed "constitution", where BM25 alone had returned all 8 passages from the
1987 Constitution and the fused set displaced them with Cagas v. COMELEC,
Magallona v. Ermita and Kida v. Senate. Scoring the fused set with a
cross-encoder is the fix; reweighting RRF is not.
"""

from __future__ import annotations

import asyncio
import contextvars
import logging
import time
from typing import Any

import httpx

from ..config import settings
from .authority import apply_authority_boost
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

# Header carrying the caller's deadline to reranker-service, as epoch
# milliseconds. reranker-service answers 503 without running the model when a
# request only reaches the model after this instant — the caller has already
# fallen back to RRF by then, so scoring it would only delay everyone queued
# behind it.
DEADLINE_HEADER = "X-Rerank-Deadline"

# The process-wide gate on reranker HTTP calls, per event loop. An
# asyncio.Semaphore binds to the loop it first waits on; keying by loop keeps
# one gate per running service (uvicorn has one loop) while letting tests that
# each run their own loop get a fresh one instead of a RuntimeError.
_inflight: tuple[asyncio.AbstractEventLoop, asyncio.Semaphore] | None = None

# Seconds of the timeout budget left for the HTTP call once a gate slot is
# held. Set by `rerank_passages` around `_call_reranker`; a ContextVar rather
# than a parameter so `_call_reranker` keeps its (url, query, passages)
# contract. Unset means a direct call, which gets the whole budget.
_remaining_budget: contextvars.ContextVar[float | None] = contextvars.ContextVar(
    "rerank_remaining_budget", default=None
)


def _inflight_gate() -> asyncio.Semaphore:
    """The semaphore bounding concurrent reranker calls from this process."""
    global _inflight  # noqa: PLW0603
    loop = asyncio.get_running_loop()
    if _inflight is None or _inflight[0] is not loop:
        _inflight = (loop, asyncio.Semaphore(max(1, settings.reranker_max_inflight)))
    return _inflight[1]


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
    *,
    timeout: float | None = None,
) -> RerankOutcome:
    """Rerank passages using the cross-encoder, falling back to RRF scores.

    Args:
        query: The original user query.
        passages: Passages from hybrid retrieval, already RRF-scored.
        top_k: Number of passages to return after reranking.
        timeout: Seconds for the gate wait plus the HTTP call. None means
            `reranker_timeout` (/answer's budget). Deep Research passes its own
            `deep_research_rerank_timeout` for its single, larger call.

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
        return _fallback_outcome(passages, top_k, _MARKER_NOT_CONFIGURED)

    # One budget covers the wait for a gate slot AND the HTTP call. Without the
    # gate, a burst of concurrent reranks (Deep Research sent three at once)
    # all reached reranker-service, which scores one at a time: the late ones
    # timed out here, were scored there anyway, and queued every /answer behind
    # work nobody was waiting for any more.
    budget = float(settings.reranker_timeout if timeout is None else timeout)
    started = time.monotonic()
    gate = _inflight_gate()
    try:
        await asyncio.wait_for(gate.acquire(), timeout=budget)
    except TimeoutError:
        logger.error(
            "Reranker gate (max %d in flight) not free within the %ss budget — "
            "falling back to RRF without sending the request",
            settings.reranker_max_inflight,
            budget,
        )
        return _fallback_outcome(passages, top_k, _MARKER_UNREACHABLE)

    token: contextvars.Token[float | None] | None = None
    try:
        remaining = budget - (time.monotonic() - started)
        if remaining <= 0:
            return _fallback_outcome(passages, top_k, _MARKER_UNREACHABLE)
        token = _remaining_budget.set(remaining)
        reranked = await _call_reranker(reranker_url, query, passages)
    except httpx.TimeoutException:
        logger.error(
            "Reranker at %s timed out after %ss — falling back to RRF order",
            reranker_url,
            budget,
            exc_info=True,
        )
        return _fallback_outcome(passages, top_k, _MARKER_UNREACHABLE)
    except httpx.TransportError:
        logger.error(
            "Reranker at %s is unreachable — falling back to RRF order",
            reranker_url,
            exc_info=True,
        )
        return _fallback_outcome(passages, top_k, _MARKER_UNREACHABLE)
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
        return _fallback_outcome(passages, top_k, _MARKER_FAILED)
    finally:
        if token is not None:
            _remaining_budget.reset(token)
        gate.release()

    # Raw cross-encoder order first: its head is the abstention signal, which
    # must stay the unboosted relevance score.
    reranked.sort(key=_rerank_key, reverse=True)
    top_score = _raw_top_score(reranked)
    boosted = apply_authority_boost(reranked, _rerank_key)
    return RerankOutcome(passages=boosted[:top_k], top_score=top_score)


def _rerank_key(passage: Passage) -> float:
    return passage.rerank_score or 0.0


def _rrf_key(passage: Passage) -> float:
    return passage.score


def _raw_top_score(raw_ordered: list[Passage]) -> float | None:
    """The score `check_abstention` would read off the head of the raw order.

    Same expression as `check_abstention` uses on ``passages[0]``, evaluated on
    the order BEFORE the authority boost, so moving the boost after reranking
    cannot move the abstention decision.
    """
    if not raw_ordered:
        return None
    head = raw_ordered[0]
    return head.rerank_score if head.rerank_score is not None else head.score


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

    The request carries ``X-Rerank-Deadline`` (epoch ms) = now + the budget
    left, and the HTTP timeout is that same remainder, so both ends agree on
    when the answer stops being wanted.
    """
    remaining = _remaining_budget.get()
    timeout = float(settings.reranker_timeout) if remaining is None else remaining
    headers = {
        **_internal_headers(),
        DEADLINE_HEADER: str(int((time.time() + timeout) * 1000)),
    }
    payload: dict[str, Any] = {
        "query": query,
        "passages": [
            {"id": p.id, "text": p.text[:1000]}  # Limit passage length for reranker
            for p in passages
        ],
    }

    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(
            f"{reranker_url}/rerank",
            json=payload,
            headers=headers,
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


def _fallback_outcome(
    passages: list[Passage], top_k: int, marker: str
) -> RerankOutcome:
    """The degraded outcome: RRF order with the boost, raw RRF top score."""
    return RerankOutcome(
        passages=_fallback_rerank(passages, top_k),
        degraded=True,
        degraded_legs=[marker],
        top_score=_raw_top_score(sorted(passages, key=_rrf_key, reverse=True)),
    )


def _fallback_rerank(passages: list[Passage], top_k: int) -> list[Passage]:
    """Fallback: order by RRF score times the authority boost."""
    raw_ordered = sorted(passages, key=_rrf_key, reverse=True)
    return apply_authority_boost(raw_ordered, _rrf_key)[:top_k]
