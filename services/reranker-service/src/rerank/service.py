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
import time
from typing import Any

from ..config import settings

logger = logging.getLogger(__name__)

# Lazy-loaded model singleton
_model: Any = None


def _configure_torch_threads() -> None:
    """Pin torch's thread pools to the container's actual CPU quota.

    Torch sizes its intra-op pool from the host core count read out of /proc; it
    has no idea a cgroup quota exists. On a 12-core host inside a `cpus: "2"`
    container that is 12 threads contending for 2 cores of quota, which costs
    more in context switching than it buys in parallelism.

    ``set_num_interop_threads`` may only be called before any parallel work has
    started and raises RuntimeError afterwards — which happens when the model is
    reloaded in-process, as the tests do. Losing the inter-op setting is
    harmless (it defaults small and this workload is intra-op bound), so it is
    caught and logged rather than allowed to fail startup.
    """
    import torch

    torch.set_num_threads(settings.torch_threads)
    try:
        torch.set_num_interop_threads(1)
    except RuntimeError:
        logger.debug("Inter-op thread count already fixed; leaving it as-is")


# Quantization backends, in the order they are tried.
#
# torch does NOT pick a working engine for you. On aarch64 it defaults to
# `x86`, which dispatches to fbgemm and dies with `RuntimeError: unknown
# architecure` (sic) — so quantization silently failed and the service ran fp32
# while `/health` cheerfully reported `quantized: true`. fbgemm is x86-only,
# qnnpack is the ARM backend, onednn works on both. Trying them in order makes
# the outcome depend on what the platform actually supports rather than on a
# default that is wrong half the time.
_QUANT_ENGINES = ("fbgemm", "onednn", "qnnpack")

# Whether quantization actually took effect, as opposed to having been asked
# for. `/health` reports THIS, not the setting — see `_quantize_dynamic`.
_quantized = False


def is_quantized() -> bool:
    """Whether int8 quantization is actually applied to the loaded model."""
    return _quantized


def _quantize_dynamic(model: Any) -> None:
    """Apply dynamic int8 quantization to the cross-encoder's Linear layers.

    `CrossEncoder` holds the HuggingFace module on `.model` and keeps its own
    references (tokenizer, config, device) around it, so the quantized module is
    assigned back onto the wrapper rather than replacing the wrapper itself.

    Failure is non-fatal on purpose: quantization is a latency optimisation, and
    a platform that cannot do it should get a slower service rather than a dead
    one. But it must not be a SILENT failure — the outcome is recorded in
    `_quantized` and surfaced on `/health`, because "we asked for int8" and "we
    are running int8" are different facts and only one of them is useful when
    latency is the thing being debugged.
    """
    global _quantized  # noqa: PLW0603
    import torch

    inner = getattr(model, "model", None)
    if inner is None:
        logger.warning("CrossEncoder exposes no .model attribute; skipping quantization")
        return

    supported = set(torch.backends.quantized.supported_engines)
    for engine in _QUANT_ENGINES:
        if engine not in supported:
            continue
        try:
            torch.backends.quantized.engine = engine
            # torch.ao.quantization is untyped, hence the ignore. Narrow and
            # deliberate: everything either side of this call is checked.
            # `inplace` defaults to False, so a failed attempt leaves `inner`
            # untouched and the next engine gets a clean module.
            model.model = torch.ao.quantization.quantize_dynamic(  # type: ignore[no-untyped-call]
                inner, {torch.nn.Linear}, dtype=torch.qint8
            )
            # CONSTRUCTING a quantized module is not proof it can run one.
            # Measured on aarch64 with torch 2.13: `onednn` converts happily and
            # then every forward pass dies with `KeyError: 'ne'`, which without
            # this check meant a service that started, reported itself healthy
            # and quantized, and returned 500 for every rerank. Prove it with an
            # actual inference before keeping it.
            model.predict(
                [("warm up query", "A short passage used to validate the backend.")],
                show_progress_bar=False,
            )
        except Exception as exc:  # noqa: BLE001 - next engine, or fp32
            logger.info("Quantization backend %r unusable (%s)", engine, exc)
            model.model = inner
            continue
        _quantized = True
        logger.info("Applied dynamic int8 quantization using backend %r", engine)
        return

    model.model = inner
    logger.warning(
        "Dynamic quantization unavailable on this platform (engines tried: %s) — "
        "continuing in fp32. Latency setting only; ranking is unaffected.",
        ", ".join(e for e in _QUANT_ENGINES if e in supported) or "none",
    )


def _get_model() -> Any:
    """Load the cross-encoder on first use.

    Still lazy, but `main.lifespan` calls this at startup so no request pays for
    it. A request that arrives before the model is resident used to pay model
    load plus graph warm-up on top of its own scoring, which guaranteed a
    timeout on the first call after every deploy.
    """
    global _model, _quantized  # noqa: PLW0603
    if _model is None:
        _quantized = False
        _configure_torch_threads()

        from sentence_transformers import CrossEncoder

        logger.info(
            "Loading reranker model: %s (device=%s, max_length=%d, torch_threads=%d)",
            settings.model_name,
            settings.device,
            settings.max_length,
            settings.torch_threads,
        )
        _model = CrossEncoder(
            settings.model_name,
            device=settings.device,
            max_length=settings.max_length,
        )
        if settings.quantize:
            _quantize_dynamic(_model)
        logger.info("Reranker model loaded successfully")
    return _model


def is_model_loaded() -> bool:
    """Whether the model is resident. Read by /health; never triggers a load."""
    return _model is not None


async def warm_up() -> None:
    """Load the model and run one inference so the first real request is fast.

    The load itself is only half of it: the first forward pass through a fresh
    torch graph allocates workspaces and resolves kernels, and on CPU that is
    measurable. Scoring one throwaway pair moves all of it off the request path.
    """
    logger.info("Warming up reranker...")
    scores = await asyncio.to_thread(
        _score_pairs_sync,
        "warm up query",
        ["A short passage used only to force the first forward pass."],
    )
    logger.info("Reranker warm-up complete (produced %d score)", len(scores))


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


# How long a request may wait for the model before the wait itself is worth
# reporting. The caller's timeout is 10s and a single scoring pass already costs
# ~5s, so a second of queueing is most of the remaining budget.
_QUEUE_WARN_SECONDS = 1.0

# Guards the model. Created lazily because a Semaphore binds to the running
# event loop on first use, and the module is imported long before uvicorn starts
# one — building it at import time works on 3.10+ but ties the object to
# whichever loop happens to be current, which breaks the tests that drive
# `rerank` under `asyncio.run`.
_model_semaphore: asyncio.Semaphore | None = None


def _get_semaphore() -> asyncio.Semaphore:
    """Return the concurrency gate, creating it on first use."""
    global _model_semaphore  # noqa: PLW0603
    if _model_semaphore is None:
        _model_semaphore = asyncio.Semaphore(settings.max_concurrent_requests)
    return _model_semaphore


async def rerank(query: str, passages: list[tuple[str, str]]) -> list[tuple[str, float]]:
    """Score each (id, text) passage against the query.

    Concurrency is bounded by `settings.max_concurrent_requests` (default 1).
    `asyncio.to_thread` hands work to the default executor, which sizes itself
    from ``os.cpu_count()`` — the HOST's core count, not the cgroup quota — so
    without this gate N concurrent requests become N scoring threads, each
    asking torch for `torch_threads` threads of its own. That is the same
    oversubscription thrash this service was fixed for, re-entered through
    concurrency.

    Queueing beats thrashing: torch already spreads one batch across every core
    in the quota, so a second concurrent request has no spare CPU to use and can
    only steal cycles from the first. Thrash makes BOTH requests miss the
    caller's 10s timeout; queueing lets the first finish on time.

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

    waited_from = time.perf_counter()
    async with _get_semaphore():
        waited = time.perf_counter() - waited_from
        if waited > _QUEUE_WARN_SECONDS:
            # Not an error — the gate is doing its job. It is the signal that
            # one replica is no longer enough for the arrival rate, and it is
            # the only place that shows up before requests start timing out.
            logger.warning(
                "Rerank waited %.2fs for the model (concurrency limit %d) — "
                "sustained queueing at this level means adding replicas.",
                waited,
                settings.max_concurrent_requests,
            )

        scores = await asyncio.to_thread(_score_pairs_sync, query, texts)

    scored = list(zip(ids, scores, strict=True))
    scored.sort(key=lambda pair: pair[1], reverse=True)
    return scored
