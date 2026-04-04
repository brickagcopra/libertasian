"""Memo and outline generation request/response schemas."""

from enum import Enum

from pydantic import BaseModel, ConfigDict, Field


class MemoType(str, Enum):
    """Types of legal memos that can be generated."""

    LEGAL_OPINION = "legal_opinion"
    CASE_ANALYSIS = "case_analysis"
    STATUTORY_ANALYSIS = "statutory_analysis"
    COMPARATIVE = "comparative"
    RESEARCH_SUMMARY = "research_summary"


class OutputType(str, Enum):
    """Output format for the generation endpoint."""

    MEMO = "memo"
    OUTLINE = "outline"


class MemoGenerationRequest(BaseModel):
    """Request payload for memo generation."""

    model_config = ConfigDict(strict=True)

    query: str = Field(..., min_length=10, max_length=2000)
    memo_type: MemoType
    output_type: OutputType = OutputType.MEMO
    raw_text: str | None = Field(
        default=None,
        max_length=100_000,
        description="Raw text (e.g. OCR output) to use as context instead of RAG retrieval",
    )
    outline_type: str | None = Field(
        default=None,
        description="Outline variant: topic_outline, case_brief, statute_breakdown, study_guide",
    )


class CitationRef(BaseModel):
    """Citation reference linking a claim to a source passage."""

    source_id: str
    section_id: str | None = None
    text: str


class MemoSectionOutput(BaseModel):
    """A single section of the generated memo."""

    heading: str
    content: str
    citations: list[CitationRef] = []


class MemoGenerationResponse(BaseModel):
    """Response from memo generation endpoint."""

    title: str
    summary: str
    sections: list[MemoSectionOutput]
    conclusion: str
    citations: list[CitationRef]
    confidence_score: float = Field(ge=0.0, le=1.0)
    model_name: str
    prompt_template_version: str


# ---- Outline-specific response models ----


class OutlineSubsection(BaseModel):
    """A subsection within an outline section."""

    heading: str
    key_points: list[str]


class OutlineSectionOutput(BaseModel):
    """A single section in a generated outline."""

    heading: str
    key_points: list[str]
    subsections: list[OutlineSubsection] = []


class OutlineGenerationResponse(BaseModel):
    """Response from outline generation endpoint."""

    outline: dict  # {title, sections[{heading, key_points, subsections}]}
    confidence_score: float = Field(ge=0.0, le=1.0)
    model_name: str
    prompt_template_version: str
