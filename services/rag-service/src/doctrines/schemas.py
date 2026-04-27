"""Doctrine extraction Pydantic schemas — request/response models."""

from enum import Enum

from pydantic import BaseModel, ConfigDict, Field


class DoctrineType(str, Enum):
    """Classification of legal doctrine types in Philippine jurisprudence."""

    RATIO_DECIDENDI = "ratio_decidendi"
    OBITER_DICTUM = "obiter_dictum"
    STARE_DECISIS = "stare_decisis"
    STATUTORY_CONSTRUCTION = "statutory_construction"
    CONSTITUTIONAL_INTERPRETATION = "constitutional_interpretation"
    PROCEDURAL_RULE = "procedural_rule"
    EVIDENTIARY_RULE = "evidentiary_rule"
    OTHER = "other"


class ExtractionStrategy(str, Enum):
    """Strategy for extracting doctrines from a document."""

    AUTO = "auto"
    FULL_TEXT = "full_text"
    SECTIONS_ONLY = "sections_only"


class DoctrineExtractionRequest(BaseModel):
    """Request body for doctrine extraction endpoint."""

    model_config = ConfigDict()

    document_id: str
    strategy: ExtractionStrategy = ExtractionStrategy.AUTO
    document_text: str | None = None  # optional pre-fetched text
    sections: list[dict] | None = None  # optional pre-fetched sections [{id, section_type, plain_text}]


class ExtractedDoctrine(BaseModel):
    """A single doctrine extracted from a legal document."""

    text: str
    normalized_text: str | None = None
    doctrine_type: DoctrineType = DoctrineType.OTHER
    source_section_id: str | None = None
    confidence: float = Field(ge=0.0, le=1.0)


class DoctrineExtractionResponse(BaseModel):
    """Response body from doctrine extraction endpoint."""

    document_id: str
    doctrines: list[ExtractedDoctrine]
    strategy_used: str
    model_name: str
    prompt_template_version: str
    # Token usage surfaced so the worker can charge the per-batch
    # ``budget_consumed_usd`` counter. ``0`` for backends that don't expose
    # usage metadata (vLLM with usage-disabled, mock backends in tests).
    tokens_in: int = 0
    tokens_out: int = 0
