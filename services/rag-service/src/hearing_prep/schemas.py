"""Hearing preparation pack request/response schemas."""

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class HearingPrepRequest(BaseModel):
    """Request payload for hearing prep pack generation."""

    model_config = ConfigDict(strict=True)

    topic: str = Field(..., min_length=5, max_length=500)
    issue: str | None = None
    document_ids: list[str] = Field(default_factory=list)
    input_context: dict[str, Any] | None = None


class HearingPrepCaseOut(BaseModel):
    """A relevant case for the hearing preparation pack."""

    document_id: str
    title: str
    citation_text: str | None = None
    relevance: str
    key_holdings: list[str]


class HearingPrepProvisionOut(BaseModel):
    """A relevant statutory provision for the hearing preparation pack."""

    document_id: str
    section_id: str | None = None
    title: str
    section_label: str | None = None
    text: str
    relevance: str


class HearingPrepArgumentOut(BaseModel):
    """A legal argument or counter-argument for the hearing preparation pack."""

    position: str
    supporting_cases: list[str]
    supporting_provisions: list[str]
    strength: str = "moderate"


class HearingPrepResponse(BaseModel):
    """Response from hearing prep pack generation endpoint."""

    cases: list[HearingPrepCaseOut]
    provisions: list[HearingPrepProvisionOut]
    arguments: list[HearingPrepArgumentOut]
    counter_arguments: list[HearingPrepArgumentOut]
    suggested_questions: list[str]
    confidence_score: float = Field(ge=0.0, le=1.0)
    model_name: str
    prompt_template_version: str
