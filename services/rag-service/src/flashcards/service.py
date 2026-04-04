"""Flashcard generation service — uses core pipeline for retrieval and generation."""

import json
import logging
from typing import Any

from ..config import settings
from ..core.generation import generate_completion, get_model_info
from ..core.retrieval import retrieve_by_document_id, retrieve_by_query
from ..core.schemas import Passage
from ..shared.formatting import format_passages
from .prompts import (
    CARD_TYPE_INSTRUCTIONS,
    PROMPT_VERSION,
    SYSTEM_PROMPT,
    USER_PROMPT_TEMPLATE,
)
from .schemas import (
    FlashcardGenerationRequest,
    FlashcardGenerationResponse,
    GeneratedFlashcard,
)

logger = logging.getLogger(__name__)


async def generate_flashcards(
    request: FlashcardGenerationRequest,
) -> FlashcardGenerationResponse:
    """Generate AI flashcards using RAG pipeline.

    Steps:
    1. Retrieve relevant source passages via core pipeline
    2. Build context with citation anchors
    3. Call vLLM via core generation
    4. Parse and validate output
    """
    model_info = get_model_info()

    # Step 1: Retrieve relevant passages via core pipeline
    passages: list[Passage] = []

    if request.context_document_ids:
        # Retrieve specific documents
        for doc_id in request.context_document_ids:
            doc_passages = await retrieve_by_document_id(
                doc_id, top_k=15, text_truncate=2000,
            )
            passages.extend(doc_passages)
    else:
        # Topic-based search
        filter_terms: dict[str, Any] | None = None
        if request.bar_subject:
            filter_terms = {"bar_subject": request.bar_subject}

        passages = await retrieve_by_query(
            request.topic,
            top_k=15,
            text_truncate=2000,
            filter_terms=filter_terms,
        )

    # Step 2: Build prompt with context
    card_instruction = CARD_TYPE_INSTRUCTIONS.get(
        request.card_type.value,
        CARD_TYPE_INSTRUCTIONS["mixed"],
    )

    context_text = format_passages(passages)

    user_prompt = USER_PROMPT_TEMPLATE.format(
        context=context_text,
        topic=request.topic,
        bar_subject=request.bar_subject or "Not specified",
        count=request.count,
        card_type_instruction=card_instruction,
    )

    # Step 3: Call vLLM via core generation
    raw_response = await generate_completion(
        system_prompt=SYSTEM_PROMPT,
        user_prompt=user_prompt,
        max_tokens=settings.flashcard_generation_max_tokens,
        temperature=0.3,
        response_format="json_object",
    )

    # Step 4: Parse and validate
    flashcard_data = _parse_flashcard_response(raw_response)

    # Limit to requested count
    cards_raw = flashcard_data.get("flashcards", [])
    cards_raw = cards_raw[: request.count]

    # Build response objects
    flashcards: list[GeneratedFlashcard] = []
    for card in cards_raw:
        if not isinstance(card, dict):
            continue
        front = card.get("front", "").strip()
        back = card.get("back", "").strip()
        if not front or not back:
            continue
        flashcards.append(
            GeneratedFlashcard(
                front=front,
                back=back,
                source_document_id=card.get("source_document_id"),
                source_section_id=card.get("source_section_id"),
                difficulty=card.get("difficulty", "medium"),
            )
        )

    # Compute confidence
    confidence = _compute_confidence(flashcards, passages)

    return FlashcardGenerationResponse(
        flashcards=flashcards,
        total_generated=len(flashcards),
        topic=request.topic,
        card_type=request.card_type.value,
        confidence_score=confidence,
        model_name=model_info["model_name"],
        prompt_template_version=PROMPT_VERSION,
    )


def _parse_flashcard_response(raw: str) -> dict[str, Any]:
    """Parse the LLM JSON output into flashcard structure."""
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("Failed to parse LLM flashcard response as JSON")
        return {"flashcards": []}

    return data


def _compute_confidence(
    flashcards: list[GeneratedFlashcard],
    passages: list[Any],
) -> float:
    """Compute confidence score for generated flashcards."""
    if not flashcards:
        return 0.2

    passage_factor = min(len(passages) / 5, 1.0)

    cards_with_sources = sum(
        1 for c in flashcards if c.source_document_id
    )
    source_ref_factor = cards_with_sources / max(len(flashcards), 1)

    completeness_factor = min(len(flashcards) / 5, 1.0)

    confidence = (
        passage_factor * 0.4 + source_ref_factor * 0.35 + completeness_factor * 0.25
    )
    return round(max(0.0, min(1.0, confidence)), 2)
