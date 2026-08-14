"""LIBERTASIAN Reranker Service — FastAPI application."""

import logging

from fastapi import FastAPI
from prometheus_fastapi_instrumentator import Instrumentator
from pydantic import BaseModel

from .config import settings
from .rerank.router import router as rerank_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

app = FastAPI(
    title=settings.app_name,
    description="Cross-encoder reranking for Philippine legal document retrieval",
    version=settings.app_version,
)

app.include_router(rerank_router)

Instrumentator().instrument(app).expose(app, endpoint="/metrics", include_in_schema=False)


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str
    model_name: str


@app.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    """Health check endpoint for load balancer and orchestration.

    Deliberately does NOT load the model: the container is healthy as soon as it
    can serve, and the model is baked into the image so the first /rerank call
    loads it from local disk rather than the network.
    """
    return HealthResponse(
        status="ok",
        service="reranker-service",
        version=settings.app_version,
        model_name=settings.model_name,
    )
