"""Flashcard generation router — FastAPI endpoints for AI flashcard creation."""

import logging

from fastapi import APIRouter, Depends

from ..shared.auth import verify_internal_key
from .schemas import FlashcardGenerationRequest, FlashcardGenerationResponse
from .service import generate_flashcards

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/flashcards",
    tags=["flashcards"],
    dependencies=[Depends(verify_internal_key)],
)


@router.post("/generate", response_model=FlashcardGenerationResponse)
async def generate_flashcards_endpoint(
    request: FlashcardGenerationRequest,
) -> FlashcardGenerationResponse:
    """Generate AI-powered study flashcards using RAG pipeline.

    Called internally by NestJS study module processor.
    """
    logger.info(
        "Flashcard generation requested: type=%s, topic_length=%d, count=%d",
        request.card_type.value,
        len(request.topic),
        request.count,
    )
    return await generate_flashcards(request)
