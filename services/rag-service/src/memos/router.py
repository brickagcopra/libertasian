"""Memo generation router — FastAPI endpoints for legal memo and outline drafting."""

import logging
from typing import Union

from fastapi import APIRouter

from .schemas import (
    MemoGenerationRequest,
    MemoGenerationResponse,
    OutlineGenerationResponse,
)
from .service import generate_memo, generate_outline

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/memos", tags=["memos"])


@router.post(
    "/generate",
    response_model=Union[MemoGenerationResponse, OutlineGenerationResponse],
)
async def generate_memo_endpoint(
    request: MemoGenerationRequest,
) -> MemoGenerationResponse | OutlineGenerationResponse:
    """Generate a structured legal memo or outline using RAG pipeline.

    Called internally by NestJS memos/uploads processors.
    When output_type is 'outline', generates a structured outline from raw_text.
    """
    if request.output_type and request.output_type.value == "outline":
        logger.info(
            "Outline generation requested: outline_type=%s, text_length=%d",
            request.outline_type or "topic_outline",
            len(request.raw_text or ""),
        )
        return await generate_outline(request)

    logger.info(
        "Memo generation requested: type=%s, query_length=%d",
        request.memo_type.value,
        len(request.query),
    )
    return await generate_memo(request)
