"""Digest generation request/response schemas — DFIR+ gold standard format."""

from pydantic import BaseModel, ConfigDict, Field


class DocumentSectionInput(BaseModel):
    """A section of a legal document provided as input for digest generation."""

    id: str
    section_type: str
    section_label: str | None = None
    plain_text: str | None = None
    page_start: int | None = None
    page_end: int | None = None


class DigestGenerationRequest(BaseModel):
    """Request payload for digest generation from document sections."""

    model_config = ConfigDict(strict=True)

    document_id: str
    sections: list[DocumentSectionInput]
    document_type: str = "case"


class CitedAuthority(BaseModel):
    """A cited authority extracted from the decision."""

    citation_text: str
    document_type: str = "case"
    gr_no: str | None = None


class ProvenanceEntry(BaseModel):
    """Links a digest field to its source section for traceability."""

    field: str
    source_section_id: str
    source_document_id: str


class DigestGenerationResponse(BaseModel):
    """Response from digest generation endpoint — DFIR+ format."""

    summary: str | None = None
    facts: str | None = None
    petitioner_arguments: str | None = None
    respondent_arguments: str | None = None
    issues: str | None = None
    ruling: str | None = None
    doctrine: str | None = None
    dispositive: str | None = None
    cited_authorities: list[CitedAuthority] = []
    provenance: list[ProvenanceEntry] = []
    confidence_score: float = Field(ge=0.0, le=1.0)
    model_name: str
    prompt_template_version: str
