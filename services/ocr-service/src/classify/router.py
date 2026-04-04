"""LIBERTASIAN OCR Service — Document classification router."""

from fastapi import APIRouter, Body

from ..schemas import ClassificationResult
from .classifier import classify_document

router = APIRouter(prefix="/classify", tags=["classify"])


@router.post("", response_model=ClassificationResult)
async def classify_text(
    text: str = Body(..., embed=True),
) -> ClassificationResult:
    """Classify a Philippine legal document type from its OCR-extracted text.

    Uses rule-based pattern matching to identify document types:
    - case: Court decisions (G.R. No., SCRA, etc.)
    - statute: Laws (Republic Act, Presidential Decree, etc.)
    - rule: Rules of Court, Administrative Matters
    - issuance: Executive Orders, Administrative Orders, Circulars
    - memorandum: Legal memoranda
    - order: Court orders

    Returns 'unknown' with confidence 0.0 if no patterns match.
    """
    return classify_document(text)
