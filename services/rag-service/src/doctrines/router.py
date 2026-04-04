"""Doctrine extraction FastAPI router."""

import logging

from fastapi import APIRouter

from .schemas import DoctrineExtractionRequest, DoctrineExtractionResponse
from .service import extract_doctrines

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/doctrines", tags=["doctrines"])


@router.post("/extract", response_model=DoctrineExtractionResponse)
async def extract_doctrines_endpoint(
    request: DoctrineExtractionRequest,
) -> DoctrineExtractionResponse:
    """Extract doctrines from a legal document.

    Called internally by NestJS admin controller.
    """
    logger.info("Doctrine extraction requested for document %s", request.document_id)
    return await extract_doctrines(request)
