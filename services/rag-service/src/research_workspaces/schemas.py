"""Research workspace query request/response schemas."""

from pydantic import BaseModel, ConfigDict, Field


class PreviousQuery(BaseModel):
    """A previous query-answer pair for conversation context."""

    query: str
    answer: str


class ResearchQueryRequest(BaseModel):
    """Request payload for a research workspace query."""

    model_config = ConfigDict(strict=True)

    query: str = Field(..., min_length=10, max_length=2000)
    pinned_document_ids: list[str] = Field(default_factory=list)
    pinned_section_ids: list[str] = Field(default_factory=list)
    notes: str = ""
    previous_queries: list[PreviousQuery] = Field(default_factory=list)


class CitationRefOut(BaseModel):
    """A citation reference in a research query response."""

    source_id: str
    section_id: str | None = None
    text: str


class ResearchQueryResponse(BaseModel):
    """Response from research workspace query endpoint."""

    answer: str
    citations: list[CitationRefOut]
    follow_up_suggestions: list[str]
    confidence_score: float = Field(ge=0.0, le=1.0)
    model_name: str
    prompt_template_version: str
