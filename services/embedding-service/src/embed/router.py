"""Embedding service FastAPI router."""

import logging

from fastapi import APIRouter, HTTPException

from ..config import settings
from .schemas import BatchEmbedRequest, BatchEmbedResponse, EmbedRequest, EmbedResponse
from .service import embed_batch, embed_text

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/embed", tags=["embed"])


@router.post("", response_model=EmbedResponse)
async def embed_single(request: EmbedRequest) -> EmbedResponse:
    """Generate embedding for a single text input."""
    logger.info("Embedding request: %d chars", len(request.text))

    try:
        embedding = await embed_text(request.text)
    except Exception as e:
        logger.error("Embedding generation failed: %s", str(e))
        raise HTTPException(status_code=500, detail="Embedding generation failed") from e

    return EmbedResponse(
        embedding=embedding,
        model_name=settings.model_name,
        dimension=settings.embedding_dim,
    )


@router.post("/batch", response_model=BatchEmbedResponse)
async def embed_multiple(request: BatchEmbedRequest) -> BatchEmbedResponse:
    """Generate embeddings for a batch of text inputs."""
    logger.info("Batch embedding request: %d texts", len(request.texts))

    try:
        embeddings = await embed_batch(request.texts)
    except Exception as e:
        logger.error("Batch embedding generation failed: %s", str(e))
        raise HTTPException(status_code=500, detail="Batch embedding generation failed") from e

    return BatchEmbedResponse(
        embeddings=embeddings,
        model_name=settings.model_name,
        dimension=settings.embedding_dim,
        count=len(embeddings),
    )
