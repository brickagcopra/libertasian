"""LIBERTASIAN OCR Service — OCR extraction router."""

import asyncio

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from ..shared.auth import verify_internal_key
from ..schemas import OcrResponse
from .extractor import extract_text

router = APIRouter(
    prefix="/ocr",
    tags=["ocr"],
    dependencies=[Depends(verify_internal_key)],
)

_IMAGE_MAGIC = {
    b"\xff\xd8\xff": "image/jpeg",
    b"\x89PNG": "image/png",
    b"RIFF": "image/webp",
}


def _validate_image_bytes(data: bytes) -> None:
    """Reject files that don't match known image magic bytes."""
    if len(data) < 4:
        raise HTTPException(status_code=400, detail="File too small to be a valid image")
    if not any(data[: len(magic)].startswith(magic) for magic in _IMAGE_MAGIC):
        raise HTTPException(
            status_code=400,
            detail="Invalid image format. Accepted: JPEG, PNG, WebP",
        )


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
    _validate_image_bytes(image_bytes)
    # Run OCR in a thread to avoid blocking the event loop
    result = await asyncio.to_thread(extract_text, image_bytes, language)
    return result
