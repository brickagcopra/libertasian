"""Contradiction detection request/response schemas."""

from pydantic import BaseModel, ConfigDict, Field


class ContradictionRequest(BaseModel):
    """Request payload for contradiction detection."""

    model_config = ConfigDict(strict=True)

    document_ids: list[str] = Field(..., min_length=2, max_length=10)
    scope: str = Field(default="selected")
    topic: str | None = None


class ContradictionItemOut(BaseModel):
    """A single contradiction found between two legal authorities."""

    document_a_id: str
    document_a_title: str
    document_a_passage: str
    document_b_id: str
    document_b_title: str
    document_b_passage: str
    description: str
    severity: str = "medium"
    doctrine_area: str | None = None


class ContradictionResponse(BaseModel):
    """Response from contradiction detection endpoint."""

    contradictions: list[ContradictionItemOut]
    summary: str
    documents_analyzed: int
    confidence_score: float = Field(ge=0.0, le=1.0)
    model_name: str
    prompt_template_version: str
