"""LIBERTASIAN RAG Service — FastAPI application."""

import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from prometheus_fastapi_instrumentator import Instrumentator
from pydantic import BaseModel

from .answer.router import router as answer_router
from .citations.router import router as citations_router
from .comparisons.router import router as comparisons_router
from .completions.router import router as completions_router
from .config import settings
from .contradictions.router import router as contradictions_router
from .digests.router import router as digests_router
from .doctrines.router import router as doctrines_router
from .flashcards.router import router as flashcards_router
from .hearing_prep.router import router as hearing_prep_router
from .memos.router import router as memos_router
from .passages.router import router as passages_router
from .pleadings.router import router as pleadings_router
from .research_workspaces.router import router as research_workspaces_router
from .shared.exceptions import BudgetExceededError
from .timelines.router import router as timelines_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

app = FastAPI(
    title=settings.app_name,
    description="Retrieval-Augmented Generation service for Philippine legal research",
    version=settings.app_version,
)

logger = logging.getLogger(__name__)


@app.exception_handler(BudgetExceededError)
async def budget_exceeded_handler(
    request: Request,  # noqa: ARG001
    exc: BudgetExceededError,
) -> JSONResponse:
    """Return 503 when the monthly LLM budget is exceeded."""
    logger.warning("LLM budget exceeded: %s", exc)
    return JSONResponse(
        status_code=503,
        content={
            "detail": "AI generation is temporarily unavailable. Please try again later.",
        },
    )


# Include routers
app.include_router(citations_router)
app.include_router(comparisons_router)
app.include_router(contradictions_router)
app.include_router(flashcards_router)
app.include_router(doctrines_router)
app.include_router(memos_router)
app.include_router(passages_router)
app.include_router(pleadings_router)
app.include_router(research_workspaces_router)
app.include_router(timelines_router)
app.include_router(hearing_prep_router)
app.include_router(answer_router)
app.include_router(digests_router)
app.include_router(completions_router)

Instrumentator().instrument(app).expose(app, endpoint="/metrics", include_in_schema=False)


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str


@app.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    """Health check endpoint for load balancer and orchestration."""
    return HealthResponse(
        status="ok",
        service="rag-service",
        version=settings.app_version,
    )
