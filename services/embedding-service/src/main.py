"""LIBERTASIAN Embedding Service — FastAPI application."""

import logging

from fastapi import FastAPI
from pydantic import BaseModel

from .config import settings
from .embed.router import router as embed_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

app = FastAPI(
    title=settings.app_name,
    description="Text embedding service for Philippine legal document search and retrieval",
    version=settings.app_version,
)

app.include_router(embed_router)


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str
    model_name: str
    embedding_dim: int


@app.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    """Health check endpoint for load balancer and orchestration."""
    return HealthResponse(
        status="ok",
        service="embedding-service",
        version=settings.app_version,
        model_name=settings.model_name,
        embedding_dim=settings.embedding_dim,
    )
