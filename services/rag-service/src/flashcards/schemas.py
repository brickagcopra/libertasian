"""Flashcard generation request/response schemas."""

from enum import Enum

from pydantic import BaseModel, ConfigDict, Field


class FlashcardType(str, Enum):
    """Types of flashcards that can be generated."""

    DEFINITION = "definition"
    APPLICATION = "application"
    CASE_HOLDING = "case_holding"
    PROVISION = "provision"
    DOCTRINE = "doctrine"
    PROCEDURE = "procedure"
    MIXED = "mixed"


class FlashcardGenerationRequest(BaseModel):
    """Request payload for AI flashcard generation."""

    model_config = ConfigDict(strict=True)

    topic: str = Field(..., min_length=5, max_length=1000)
    card_type: FlashcardType = FlashcardType.MIXED
    count: int = Field(default=10, ge=1, le=30)
    bar_subject: str | None = Field(default=None, max_length=50)
    context_document_ids: list[str] = Field(default_factory=list, max_length=10)


class GeneratedFlashcard(BaseModel):
    """A single AI-generated flashcard."""

    front: str = Field(..., min_length=5)
    back: str = Field(..., min_length=5)
    source_document_id: str | None = None
    source_section_id: str | None = None
    difficulty: str = Field(default="medium")  # easy, medium, hard


class FlashcardGenerationResponse(BaseModel):
    """Response from flashcard generation endpoint."""

    flashcards: list[GeneratedFlashcard]
    total_generated: int
    topic: str
    card_type: str
    confidence_score: float = Field(ge=0.0, le=1.0)
    model_name: str
    prompt_template_version: str
