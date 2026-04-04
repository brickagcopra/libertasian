"""LIBERTASIAN OCR Service — OCR extraction router."""

import asyncio

from fastapi import APIRouter, File, Form, UploadFile

from ..schemas import OcrResponse
from .extractor import extract_text

router = APIRouter(prefix="/ocr", tags=["ocr"])


@router.post("/extract", response_model=OcrResponse)
async def extract_ocr(
    file: UploadFile = File(...),
    language: str = Form(default="eng"),
) -> OcrResponse:
    """Extract text from an uploaded image using Tesseract OCR.

    Applies preprocessing (deskew, denoise, contrast enhancement, binarization)
    before running OCR for optimal accuracy on camera-scanned documents.

    Args:
        file: Image file (JPEG, PNG, WebP, TIFF).
        language: Tesseract language code. Default 'eng'. Use 'eng+fil' for
                  mixed English/Filipino documents.

    Returns:
        OcrResponse with extracted text, confidence score, word count,
        and detected language.
    """
    image_bytes = await file.read()
    # Run OCR in a thread to avoid blocking the event loop
    result = await asyncio.to_thread(extract_text, image_bytes, language)
    return result
