"""Timeline generation request/response schemas."""

from pydantic import BaseModel, ConfigDict, Field


class TimelineRequest(BaseModel):
    """Request payload for timeline generation."""

    model_config = ConfigDict(strict=True)

    document_ids: list[str] = Field(..., min_length=1, max_length=10)
    title: str = Field(..., min_length=1, max_length=500)


class TimelineEventOut(BaseModel):
    """A single chronological event extracted from legal documents."""

    date: str
    label: str
    description: str
    source_document_id: str | None = None
    source_section_id: str | None = None
    event_type: str = "other"


class TimelineResponse(BaseModel):
    """Response from timeline generation endpoint."""

    events: list[TimelineEventOut]
    summary: str
    confidence_score: float = Field(ge=0.0, le=1.0)
    model_name: str
    prompt_template_version: str
