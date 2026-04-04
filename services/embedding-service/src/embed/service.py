"""Embedding service — lazy model loading and embedding generation."""

import asyncio
import logging
from typing import Any

import numpy as np

from ..config import settings

logger = logging.getLogger(__name__)

# Lazy-loaded model singleton
_model: Any = None


def _get_model() -> Any:
    """Load the sentence-transformers model on first use."""
    global _model
    if _model is None:
        from sentence_transformers import SentenceTransformer

        logger.info("Loading embedding model: %s (device: %s)", settings.model_name, settings.device)
        _model = SentenceTransformer(settings.model_name, device=settings.device)
        logger.info("Embedding model loaded successfully (dim=%d)", settings.embedding_dim)
    return _model


def _embed_texts_sync(texts: list[str]) -> list[list[float]]:
    """Synchronous embedding generation. Called via asyncio.to_thread()."""
    model = _get_model()

    # Truncate inputs exceeding max length
    truncated = [t[: settings.max_input_length] for t in texts]

    embeddings: np.ndarray[Any, np.dtype[np.floating[Any]]] = model.encode(
        truncated,
        batch_size=settings.max_batch_size,
        show_progress_bar=False,
        normalize_embeddings=True,
    )

    return embeddings.tolist()  # type: ignore[no-any-return]


async def embed_text(text: str) -> list[float]:
    """Generate embedding for a single text. Uses asyncio.to_thread() for CPU-bound work."""
    results = await asyncio.to_thread(_embed_texts_sync, [text])
    return results[0]


async def embed_batch(texts: list[str]) -> list[list[float]]:
    """Generate embeddings for a batch of texts. Uses asyncio.to_thread() for CPU-bound work."""
    if len(texts) == 0:
        return []

    # Process in chunks of max_batch_size
    all_embeddings: list[list[float]] = []
    for i in range(0, len(texts), settings.max_batch_size):
        chunk = texts[i : i + settings.max_batch_size]
        chunk_embeddings = await asyncio.to_thread(_embed_texts_sync, chunk)
        all_embeddings.extend(chunk_embeddings)

    return all_embeddings
