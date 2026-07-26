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
    document_ids, section_to_document, sole_document_id = _passage_provenance(passages)

    flashcards: list[GeneratedFlashcard] = []
    for card in cards_raw:
        if not isinstance(card, dict):
            continue
        front = card.get("front", "").strip()
        back = card.get("back", "").strip()
        if not front or not back:
            continue
        resolved_document_id, resolved_section_id = _resolve_card_source(
            declared_document_id=card.get("source_document_id"),
            declared_section_id=card.get("source_section_id"),
            document_ids=document_ids,
            section_to_document=section_to_document,
            sole_document_id=sole_document_id,
        )
        flashcards.append(
            GeneratedFlashcard(
                front=front,
                back=back,
                source_document_id=resolved_document_id,
                source_section_id=resolved_section_id,
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


def _passage_provenance(
    passages: list[Passage],
) -> tuple[set[str], dict[str, str], str | None]:
    """Index the retrieved passages so card provenance can be resolved.

    Returns ``(document_ids, section_id -> document_id, sole_document_id)``.
    ``sole_document_id`` is set only when every retrieved passage came from the
    same document, which is the unambiguous case.
    """
    document_ids = {p.document_id for p in passages if p.document_id}
    section_to_document = {
        p.section_id: p.document_id
        for p in passages
        if p.section_id and p.document_id
    }
    sole_document_id = next(iter(document_ids)) if len(document_ids) == 1 else None
    return document_ids, section_to_document, sole_document_id


def _resolve_card_source(
    *,
    declared_document_id: Any,
    declared_section_id: Any,
    document_ids: set[str],
    section_to_document: dict[str, str],
    sole_document_id: str | None,
) -> tuple[str | None, str | None]:
    """Resolve one card's provenance against the passages it was built from.

    The prompt asks the model for ``source_document_id`` / ``source_section_id``
    and it almost never emits them. Reading provenance straight off the LLM
    object therefore left ``source_ref_factor`` at ~0 and capped the score at
    0.65 — below the 0.70 bar — even though the provenance was never missing:
    it is in the retrieved passages. Resolution order:

    1. A declared section ID that was actually retrieved wins, and brings its
       own document ID with it.
    2. A declared document ID that was actually retrieved wins.
    3. Otherwise, if every retrieved passage came from ONE document, that is
       the card's document. Unambiguous, and the same value persistence stores.
    4. A hallucinated ID against a multi-document retrieval resolves to
       nothing and earns no credit — deliberately, so a made-up citation
       cannot buy confidence, and so no invalid FK reaches the database.

    Note the consequence of rule 3: a single-document deck scores a full
    provenance term regardless of which passage each card drew on. That is
    honest for this path — the deck's provenance *is* that one document — and
    this score gates nothing (it is returned to the study client and never
    persisted). Per-card grounding is graded on the editorial path by
    worker-service/src/scoring.py, which resolves section IDs individually.
    """
    section_id = declared_section_id if isinstance(declared_section_id, str) else None
    document_id = (
        declared_document_id if isinstance(declared_document_id, str) else None
    )

    if section_id and section_id in section_to_document:
        return section_to_document[section_id], section_id
    if document_id and document_id in document_ids:
        return document_id, None
    if sole_document_id:
        return sole_document_id, None
    return None, None


def _compute_confidence(
    flashcards: list[GeneratedFlashcard],
    passages: list[Any],
) -> float:
    """Compute confidence score for generated flashcards.

    ``source_ref_factor`` counts cards whose ``source_document_id`` was
    resolved against the retrieved passages by :func:`_resolve_card_source` —
    not cards where the LLM happened to emit the field itself. Before that
    resolution existed the term was ~0 on every generation and the reachable
    ceiling here was 0.4 + 0.25 = 0.65.
    """
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
