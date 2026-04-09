"""LIBERTASIAN OCR Service — Quality scoring router."""

from fastapi import APIRouter, Depends, File, UploadFile

from ..shared.auth import verify_internal_key
from ..schemas import QualityScoreResponse
from .scorer import score_image_quality

router = APIRouter(
    prefix="/quality",
    tags=["quality"],
    dependencies=[Depends(verify_internal_key)],
)


@router.post("/score", response_model=QualityScoreResponse)
async def score_quality(file: UploadFile = File(...)) -> QualityScoreResponse:
    """Score the quality of an uploaded image for OCR suitability.

    Analyzes blur, resolution, contrast, and brightness to determine
    if the image is suitable for reliable OCR extraction.

    Returns a 0.0–1.0 overall score with per-metric breakdown.
    Score < 0.2: rejected (too low quality).
    Score < 0.4: warning (marginal quality).
    Score >= 0.4: acceptable.
    """
    image_bytes = await file.read()
    return score_image_quality(image_bytes)
