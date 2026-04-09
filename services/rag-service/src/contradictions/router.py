"""Contradiction detection router — FastAPI endpoints for contradiction analysis."""

import logging

from fastapi import APIRouter, Depends

from ..shared.auth import verify_internal_key
from .schemas import ContradictionRequest, ContradictionResponse
from .service import generate_contradiction_report

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/contradictions",
    tags=["contradictions"],
    dependencies=[Depends(verify_internal_key)],
)


@router.post("/generate", response_model=ContradictionResponse)
async def generate_contradictions_endpoint(
    request: ContradictionRequest,
) -> ContradictionResponse:
    """Detect contradictions across legal documents using RAG pipeline.

    Called internally by NestJS contradictions processor.
    """
    logger.info(
        "Contradiction detection requested: scope='%s', documents=%d",
        request.scope,
        len(request.document_ids),
    )
    return await generate_contradiction_report(request)
