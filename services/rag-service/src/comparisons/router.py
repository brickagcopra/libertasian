"""Case comparison router — FastAPI endpoints for case comparison generation."""

import logging

from fastapi import APIRouter

from .schemas import ComparisonRequest, ComparisonResponse
from .service import generate_comparison

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/comparisons", tags=["comparisons"])


@router.post("/generate", response_model=ComparisonResponse)
async def generate_comparison_endpoint(
    request: ComparisonRequest,
) -> ComparisonResponse:
    """Generate a structured case comparison using RAG pipeline.

    Called internally by NestJS case-comparisons processor.
    """
    logger.info(
        "Case comparison requested: type=%s, documents=%d",
        request.comparison_type.value,
        len(request.document_ids),
    )
    return await generate_comparison(request)
