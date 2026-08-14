"""Reranker service FastAPI router."""

import logging

from fastapi import APIRouter, Depends, HTTPException

from ..config import settings
from ..shared.auth import verify_internal_key
from .schemas import RerankRequest, RerankResponse, RerankResult
from .service import rerank

logger = logging.getLogger(__name__)

router = APIRouter(
    tags=["rerank"],
    dependencies=[Depends(verify_internal_key)],
)


@router.post("/rerank", response_model=RerankResponse)
async def rerank_passages(request: RerankRequest) -> RerankResponse:
    """Score the candidate passages against the query, best first.

    The path is ``/rerank`` with no router prefix, because that is the URL
    `rag-service`'s `_call_reranker` already builds (`{reranker_url}/rerank`).
    """
    logger.info(
        "Rerank request: %d passages, query %d chars",
        len(request.passages),
        len(request.query),
    )

    if len(request.passages) > settings.max_passages:
        raise HTTPException(
            status_code=413,
            detail=f"Too many passages: {len(request.passages)} > {settings.max_passages}",
        )

    try:
        scored = await rerank(
            request.query,
            [(p.id, p.text) for p in request.passages],
        )
    except Exception as e:
        logger.error("Reranking failed: %s", str(e))
        raise HTTPException(status_code=500, detail="Reranking failed") from e

    return RerankResponse(
        results=[RerankResult(id=pid, score=score) for pid, score in scored],
        model_name=settings.model_name,
        count=len(scored),
    )
