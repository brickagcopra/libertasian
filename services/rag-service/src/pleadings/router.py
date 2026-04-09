"""Pleading generation router — FastAPI endpoints for pleading drafting."""

import logging

from fastapi import APIRouter, Depends

from ..shared.auth import verify_internal_key
from .schemas import PleadingGenerationRequest, PleadingGenerationResponse
from .service import generate_pleading

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/pleadings",
    tags=["pleadings"],
    dependencies=[Depends(verify_internal_key)],
)


@router.post("/generate", response_model=PleadingGenerationResponse)
async def generate_pleading_endpoint(
    request: PleadingGenerationRequest,
) -> PleadingGenerationResponse:
    """Generate a structured legal pleading using RAG pipeline.

    Called internally by NestJS pleadings processor.
    """
    logger.info(
        "Pleading generation requested: template=%s, category=%s",
        request.template_name,
        request.template_category,
    )
    return await generate_pleading(request)
