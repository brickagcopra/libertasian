"""Timeline generation router — FastAPI endpoints for timeline generation."""

import logging

from fastapi import APIRouter, Depends

from ..shared.auth import verify_internal_key
from .schemas import TimelineRequest, TimelineResponse
from .service import generate_timeline

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/timelines",
    tags=["timelines"],
    dependencies=[Depends(verify_internal_key)],
)


@router.post("/generate", response_model=TimelineResponse)
async def generate_timeline_endpoint(
    request: TimelineRequest,
) -> TimelineResponse:
    """Generate a chronological timeline from legal documents using RAG pipeline.

    Called internally by NestJS timelines processor.
    """
    logger.info(
        "Timeline generation requested: title='%s', documents=%d",
        request.title,
        len(request.document_ids),
    )
    return await generate_timeline(request)
