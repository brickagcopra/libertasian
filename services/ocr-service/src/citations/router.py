"""LIBERTASIAN OCR Service — Citation extraction router."""

from fastapi import APIRouter, Body, Depends

from ..shared.auth import verify_internal_key
from ..schemas import CitationExtractionResult
from .extractor import extract_citations

router = APIRouter(
    prefix="/citations",
    tags=["citations"],
    dependencies=[Depends(verify_internal_key)],
)


@router.post("/extract", response_model=CitationExtractionResult)
async def extract_citations_endpoint(
    text: str = Body(..., embed=True),
) -> CitationExtractionResult:
    """Extract and normalize Philippine legal citations from OCR text.

    Supports citation types:
    - G.R. No. (Supreme Court cases)
    - R.A. No. (Republic Acts)
    - P.D. No. (Presidential Decrees)
    - E.O. No. (Executive Orders)
    - A.M. No. (Administrative Matters)
    - A.C. No. (Administrative Cases)
    - B.P. Blg. (Batas Pambansa)
    - C.A. No. (Commonwealth Acts)
    - A.O. No. (Administrative Orders)
    - D.O. No. (Department Orders)
    - M.C. No. (Memorandum Circulars)
    - SCRA / Phil. reporter references

    Returns both raw matched text and normalized canonical forms.
    """
    return extract_citations(text)
