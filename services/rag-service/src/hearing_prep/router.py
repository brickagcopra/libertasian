"""Hearing preparation router — FastAPI endpoints for hearing prep pack generation."""

import logging

from fastapi import APIRouter

from .schemas import HearingPrepRequest, HearingPrepResponse
from .service import generate_hearing_prep

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/hearing-prep", tags=["hearing-prep"])


@router.post("/generate", response_model=HearingPrepResponse)
async def generate_hearing_prep_endpoint(
    request: HearingPrepRequest,
) -> HearingPrepResponse:
    """Generate a hearing preparation pack using RAG pipeline.

    Called internally by NestJS hearing-prep processor.
    """
    logger.info(
        "Hearing prep requested: topic='%s', documents=%d",
        request.topic,
        len(request.document_ids),
    )
    return await generate_hearing_prep(request)
