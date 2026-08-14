"""Cross-encoder reranking — lazy model loading and relevance scoring.

The score this service returns is a **0-1 probability**, and that is a hard part
of the contract rather than a presentation detail. `rag-service`'s
`check_abstention` compares the top passage's `rerank_score` against
`abstention_score_threshold`. That gate has been inert for as long as no
reranker was deployed (with `rerank_score` None it falls back to a raw RRF
score), so the moment this service ships it starts running against real
cross-encoder output for the first time.

`BAAI/bge-reranker-base` is a 1-label regression head: its raw output is an
**unbounded logit**, routinely negative for a non-match and positive for a
match. Feeding those straight into a threshold comparison would abstain on
almost everything or on nothing, depending only on the sign convention. Sigmoid
maps them to (0, 1), which is what the documented contract promises and what a
threshold can be reasoned about in.
"""

from __future__ import annotations

import asyncio
import inspect
import logging
import math
from typing import Any

from ..config import settings

logger = logging.getLogger(__name__)

# Lazy-loaded model singleton
_model: Any = None


def _get_model() -> Any:
    """Load the cross-encoder on first use."""
    global _model  # noqa: PLW0603
    if _model is None:
        from sentence_transformers import CrossEncoder

        logger.info(
            "Loading reranker model: %s (device: %s)", settings.model_name, settings.device
        )
        _model = CrossEncoder(settings.model_name, device=settings.device)
        logger.info("Reranker model loaded successfully")
    return _model


def _identity_activation_kwarg(predict: Any) -> dict[str, Any]:
    """Build the kwarg that forces `predict` to return RAW logits.

    This is the subtle part, and getting it wrong is silent. sentence-
    transformers picks a default activation from the model's head: for a
    1-label model like bge-reranker-base that default is **Sigmoid**. So
    `predict()` may already return 0-1, and applying our own sigmoid on top
    would squash every score into roughly [0.5, 0.73] — still "0-1", still
    monotonic, still passing a naive range check, but with the useful spread
    destroyed and any threshold derived from it meaningless.

    Forcing identity and applying sigmoid exactly once removes the ambiguity.
    The kwarg was renamed `activation_fct` -> `activation_fn` in
    sentence-transformers v4, so it is resolved by introspection rather than
    pinned to one spelling. An unrecognised signature returns no kwarg at all,
    and `_sigmoid` is idempotent-safe in the sense that it is still monotonic —
    `test_service.py` asserts the spread survives.
    """
    import torch

    try:
        params = inspect.signature(predict).parameters
    except (TypeError, ValueError):  # pragma: no cover - exotic callables
        return {}

    for name in ("activation_fn", "activation_fct"):
        if name in params:
            return {name: torch.nn.Identity()}
    return {}


def _sigmoid(logit: float) -> float:
    """Map an unbounded cross-encoder logit to (0, 1).

    Written out rather than taken from torch so the numeric contract lives in
    this file and is testable without loading a model. Guards against overflow
    on the large-magnitude logits a confident non-match produces.
    """
    if logit >= 0:
        return 1.0 / (1.0 + math.exp(-logit))
    exp_l = math.exp(logit)
    return exp_l / (1.0 + exp_l)


def _score_pairs_sync(query: str, texts: list[str]) -> list[float]:
    """Synchronous cross-encoder scoring. Called via asyncio.to_thread()."""
    model = _get_model()

    truncated = [t[: settings.max_passage_length] for t in texts]
    pairs = [(query, t) for t in truncated]

    raw = model.predict(
        pairs,
        batch_size=settings.batch_size,
        show_progress_bar=False,
        **_identity_activation_kwarg(model.predict),
    )

    # `predict` returns a numpy array for a batch; `.tolist()` flattens it to
    # plain floats. A 1-label head gives one score per pair.
    logits = raw.tolist() if hasattr(raw, "tolist") else list(raw)
    return [_sigmoid(float(x)) for x in logits]


async def rerank(query: str, passages: list[tuple[str, str]]) -> list[tuple[str, float]]:
    """Score each (id, text) passage against the query.

    Args:
        query: The user's search query.
        passages: ``(id, text)`` pairs, in any order.

    Returns:
        ``(id, score)`` pairs sorted by score descending, score in (0, 1).
        Every input passage appears exactly once — the caller maps scores back
        by id and must not be silently handed a short list.
    """
    if not passages:
        return []

    ids = [p[0] for p in passages]
    texts = [p[1] for p in passages]

    scores = await asyncio.to_thread(_score_pairs_sync, query, texts)

    scored = list(zip(ids, scores, strict=True))
    scored.sort(key=lambda pair: pair[1], reverse=True)
    return scored
