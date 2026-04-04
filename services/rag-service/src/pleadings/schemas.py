"""Pleading generation request/response schemas."""

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class PleadingGenerationRequest(BaseModel):
    """Request payload for pleading generation."""

    model_config = ConfigDict(strict=True)

    template_name: str
    template_category: str
    template_json: Any  # PleadingTemplateJson structure
    input_data: dict[str, Any]
    context_query: str | None = None


class CitationRef(BaseModel):
    """Citation reference linking a claim to a source passage."""

    source_id: str
    section_id: str | None = None
    text: str


class PleadingSectionOutput(BaseModel):
    """A single section of the generated pleading."""

    key: str
    heading: str
    content: str
    citations: list[CitationRef] = []


class PleadingGenerationResponse(BaseModel):
    """Response from pleading generation endpoint."""

    title: str
    sections: list[PleadingSectionOutput]
    citations: list[CitationRef]
    confidence_score: float = Field(ge=0.0, le=1.0)
    model_name: str
    prompt_template_version: str
