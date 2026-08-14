"""LIBERTASIAN Reranker Service — FastAPI application."""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from prometheus_fastapi_instrumentator import Instrumentator
from pydantic import BaseModel

from .config import settings
from .rerank.router import router as rerank_router
from .rerank.service import is_model_loaded, is_quantized, warm_up

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:  # noqa: ARG001
    """Load and warm the model before the service accepts traffic.

    The model used to load on first request, so the first call after every
    deploy paid model load plus first-forward-pass warm-up on top of its own
    scoring — against rag-service's 10s timeout, that call was guaranteed to
    time out and fall back to RRF.

    Non-fatal on failure, deliberately: a reranker that cannot load should be a
    degraded ranking (rag-service already falls back to RRF and says so via
    `reranker:failed`), not a container that crash-loops. `/health` reports
    `model_loaded: false` so the state is visible rather than inferred.
    """
    try:
        await warm_up()
    except Exception:
        logger.error(
            "Reranker warm-up FAILED — the service will start, but the first "
            "request will pay cold start and may exceed the caller's timeout.",
            exc_info=True,
        )

    yield


app = FastAPI(
    title=settings.app_name,
    description="Cross-encoder reranking for Philippine legal document retrieval",
    version=settings.app_version,
    lifespan=lifespan,
)

app.include_router(rerank_router)

Instrumentator().instrument(app).expose(app, endpoint="/metrics", include_in_schema=False)


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str
    model_name: str
    model_loaded: bool
    torch_threads: int
    max_length: int
    quantized: bool


@app.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    """Health check endpoint for load balancer and orchestration.

    Deliberately does NOT load the model — it reports whether the model is
    already resident. The container healthcheck runs this every 30s; loading a
    cross-encoder from it would be absurd, and blocking on one would make a
    warming service look dead.

    The latency knobs are reported because they are the difference between a
    reranker that answers inside the caller's timeout and one that silently
    falls back to RRF on every request. When a deploy is slow, the first
    question is which of these actually took effect in the container.
    """
    return HealthResponse(
        status="ok",
        service="reranker-service",
        version=settings.app_version,
        model_name=settings.model_name,
        model_loaded=is_model_loaded(),
        torch_threads=settings.torch_threads,
        max_length=settings.max_length,
        # What is actually running, not what was requested. torch silently
        # fails to quantize when the default backend does not match the
        # platform, and reporting the setting would hide exactly that.
        quantized=is_quantized(),
    )
