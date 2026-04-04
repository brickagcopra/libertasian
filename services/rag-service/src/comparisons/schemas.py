"""Case comparison request/response schemas."""

from enum import Enum

from pydantic import BaseModel, ConfigDict, Field


class ComparisonType(str, Enum):
    """Types of case comparison analysis."""

    FULL = "full"
    DOCTRINE_ONLY = "doctrine_only"
    FACTS_ONLY = "facts_only"
    RULING_ONLY = "ruling_only"


class ComparisonRequest(BaseModel):
    """Request payload for case comparison generation."""

    model_config = ConfigDict(strict=True)

    document_ids: list[str] = Field(..., min_length=2, max_length=5)
    comparison_type: ComparisonType


class CitationRef(BaseModel):
    """Citation reference linking a claim to a source passage."""

    source_id: str
    section_id: str | None = None
    text: str


class ComparisonDocumentSummary(BaseModel):
    """Summary of a document being compared."""

    document_id: str
    title: str
    citation_text: str
    court: str
    decision_date: str


class ComparisonDimensionEntry(BaseModel):
    """A single document's contribution to a comparison dimension."""

    document_id: str
    content: str
    citations: list[CitationRef] = []


class ComparisonDimension(BaseModel):
    """A single dimension of comparison (e.g., facts, doctrine, ruling)."""

    dimension: str
    entries: list[ComparisonDimensionEntry]
    analysis: str


class ComparisonResponse(BaseModel):
    """Response from case comparison generation endpoint."""

    documents: list[ComparisonDocumentSummary]
    dimensions: list[ComparisonDimension]
    overall_analysis: str
    confidence_score: float = Field(ge=0.0, le=1.0)
    model_name: str
    prompt_template_version: str
