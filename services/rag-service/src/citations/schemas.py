"""Citation resolution Pydantic schemas."""

from pydantic import BaseModel, Field, ConfigDict


class CitationToResolve(BaseModel):
    """A single unresolved citation."""
    model_config = ConfigDict(strict=True)

    id: str
    citation_text: str
    normalized_citation: str | None = None
    citation_type: str | None = None
    from_document_id: str


class CitationResolutionRequest(BaseModel):
    """Request to resolve citations for a document."""
    model_config = ConfigDict(strict=True)

    document_id: str
    citations: list[CitationToResolve]


class ResolvedCitation(BaseModel):
    """A resolved citation with target document."""
    citation_id: str
    to_document_id: str | None = None
    confidence: float = Field(ge=0.0, le=1.0, default=0.0)
    resolver_method: str = "auto"
    resolved: bool = False


class CitationResolutionResponse(BaseModel):
    """Response from citation resolution."""
    document_id: str
    total_citations: int
    resolved_count: int
    unresolved_count: int
    results: list[ResolvedCitation]


# ---- Case-Codal Auto-Suggestion Schemas ----


class CaseCodalSuggestionRequest(BaseModel):
    """Request to suggest codal provisions referenced by a case."""
    model_config = ConfigDict(strict=True)

    document_id: str
    max_suggestions: int = Field(default=10, ge=1, le=30)


class SuggestedCaseCodalLink(BaseModel):
    """A suggested link between a case and a codal provision."""
    codal_document_id: str
    codal_title: str
    codal_citation: str | None = None
    link_type: str  # interprets, applies, invalidates, modifies, upholds, cites
    relevant_excerpt: str
    confidence: float = Field(ge=0.0, le=1.0)
    reasoning: str


class CaseCodalSuggestionResponse(BaseModel):
    """Response from case-codal auto-suggestion."""
    document_id: str
    document_title: str
    suggestions: list[SuggestedCaseCodalLink]
    model_name: str
    prompt_template_version: str
