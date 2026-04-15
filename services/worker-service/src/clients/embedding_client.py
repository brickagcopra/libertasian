"""LIBERTASIAN Worker Service — Embedding service HTTP client.

Uses httpx (synchronous) since Celery tasks are sync.
Calls the embedding-service FastAPI at /embed and /embed/batch
to generate vector embeddings for document text.
"""

import logging
from typing import Any

import httpx

from ..config import settings

logger = logging.getLogger(__name__)


def _internal_headers() -> dict[str, str]:
    """Return auth headers for internal service-to-service calls."""
    return {"X-Internal-Api-Key": settings.internal_api_key}


def generate_embedding(text: str) -> dict[str, Any]:
    """Generate an embedding for a single text.

    Args:
        text: Text to embed (1-32768 chars).

    Returns:
        Dict with 'embedding' (list[float]), 'model_name', 'dimension'.
    """
    url = f"{settings.embedding_service_url}/embed"
    payload = {"text": text}

    with httpx.Client(timeout=settings.embedding_request_timeout) as client:
        response = client.post(url, json=payload, headers=_internal_headers())
        response.raise_for_status()
        return response.json()


def generate_embeddings_batch(texts: list[str]) -> dict[str, Any]:
    """Generate embeddings for a batch of texts.

    Automatically chunks into batches of embedding_batch_size (default 64)
    to respect the embedding service's max batch size.

    Args:
        texts: List of texts to embed (1-256 per request).

    Returns:
        Dict with 'embeddings' (list[list[float]]), 'model_name',
        'dimension', 'count'.
    """
    if not texts:
        return {"embeddings": [], "model_name": "unknown", "dimension": 0, "count": 0}

    batch_size = settings.embedding_batch_size
    all_embeddings: list[list[float]] = []
    model_name = "unknown"
    dimension = 0

    for i in range(0, len(texts), batch_size):
        chunk = texts[i : i + batch_size]
        url = f"{settings.embedding_service_url}/embed/batch"
        payload = {"texts": chunk}

        with httpx.Client(timeout=settings.embedding_request_timeout) as client:
            response = client.post(url, json=payload, headers=_internal_headers())
            response.raise_for_status()
            result = response.json()

        all_embeddings.extend(result["embeddings"])
        model_name = result.get("model_name", model_name)
        dimension = result.get("dimension", dimension)

    return {
        "embeddings": all_embeddings,
        "model_name": model_name,
        "dimension": dimension,
        "count": len(all_embeddings),
    }


def is_available() -> bool:
    """Check if the embedding service is reachable."""
    try:
        url = f"{settings.embedding_service_url}/health"
        with httpx.Client(timeout=5) as client:
            response = client.get(url)
            return response.status_code == 200
    except Exception:
        return False
