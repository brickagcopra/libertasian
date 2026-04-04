"""Digest generation router — FastAPI endpoint for DFIR+ digest generation."""

import logging

from fastapi import APIRouter

from .schemas import DigestGenerationRequest, DigestGenerationResponse
from .service import generate_digest

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/digests", tags=["digests"])


@router.post("/generate", response_model=DigestGenerationResponse)
async def generate_digest_endpoint(
    request: DigestGenerationRequest,
) -> DigestGenerationResponse:
    """Generate a structured DFIR+ case digest from document sections.

    Called internally by NestJS digests processor or by the worker service
    during the auto-digest ingestion pipeline.
    """
    logger.info(
        "Digest generation requested: document_id=%s, sections=%d, type=%s",
        request.document_id,
        len(request.sections),
        request.document_type,
    )
    return await generate_digest(request)
