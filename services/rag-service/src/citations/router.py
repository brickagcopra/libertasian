"""Citation resolution and case-codal suggestion FastAPI router."""

import logging

from fastapi import APIRouter, Depends

from ..shared.auth import verify_internal_key
from .case_codal_suggestions import suggest_case_codal_links
from .schemas import (
    CaseCodalSuggestionRequest,
    CaseCodalSuggestionResponse,
    CitationResolutionRequest,
    CitationResolutionResponse,
)
from .service import resolve_citations

logger = logging.getLogger(__name__)
router = APIRouter(
    prefix="/citations",
    tags=["citations"],
    dependencies=[Depends(verify_internal_key)],
)


@router.post("/resolve", response_model=CitationResolutionResponse)
async def resolve_citations_endpoint(
    request: CitationResolutionRequest,
) -> CitationResolutionResponse:
    """Resolve unresolved citations to target documents.

    Called internally by NestJS knowledge-graph controller.
    Matches citation text against the legal documents corpus using
    multiple strategies: G.R. number, citation text, statute number,
    and title matching.
    """
    logger.info(
        "Citation resolution requested for document %s (%d citations)",
        request.document_id,
        len(request.citations),
    )
    return await resolve_citations(request)


@router.post("/suggest-case-codal", response_model=CaseCodalSuggestionResponse)
async def suggest_case_codal_endpoint(
    request: CaseCodalSuggestionRequest,
) -> CaseCodalSuggestionResponse:
    """Suggest codal provisions referenced by a case document.

    Called internally by NestJS knowledge-graph controller.
    Analyzes case text and identifies which codal provisions
    are referenced, applied, or interpreted.
    """
    logger.info(
        "Case-codal suggestion requested for document %s",
        request.document_id,
    )
    return await suggest_case_codal_links(request)
