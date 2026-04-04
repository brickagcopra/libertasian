"""LIBERTASIAN OCR Service — PDF text extraction router."""

import asyncio

from fastapi import APIRouter, File, HTTPException, UploadFile

from ..schemas import PdfExtractionResponse
from .extractor import extract_pdf_text

router = APIRouter(prefix="/pdf", tags=["pdf"])

# PDF magic bytes: %PDF
PDF_MAGIC = b"%PDF"


@router.post("/extract", response_model=PdfExtractionResponse)
async def extract_pdf(
    file: UploadFile = File(...),
) -> PdfExtractionResponse:
    """Extract text from an uploaded PDF file.

    Uses PyMuPDF for native text extraction on digital PDFs.
    Falls back to Tesseract OCR for image-only pages.

    Args:
        file: PDF file (application/pdf).

    Returns:
        PdfExtractionResponse with per-page results, total text,
        word count, confidence, and language detection.
    """
    pdf_bytes = await file.read()

    # Validate magic bytes
    if not pdf_bytes[:4].startswith(PDF_MAGIC):
        raise HTTPException(
            status_code=400,
            detail="Invalid file: not a PDF (magic bytes mismatch).",
        )

    result = await asyncio.to_thread(extract_pdf_text, pdf_bytes)
    return result
