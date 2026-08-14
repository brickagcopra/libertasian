"""Query-embedding client — the kNN leg's missing input.

`hybrid_retrieve` runs its kNN arm only ``if embedding is not None``, and until
now nothing in this service produced one: `embedding_service_url` was declared
in `config.py` and read nowhere. Retrieval has therefore always been BM25-only,
which is why question-shaped queries matched on stopwords — "What **IS** estafa"
retrieved "Jesus **IS** Lord Christian School Foundation".

Mirrors `services/worker-service/src/clients/embedding_client.py`, which has
been calling the same service successfully for the indexing path, with one
difference that matters: the worker's client is synchronous and raises. This one
is async (FastAPI request path) and **never raises** — every failure returns
``None``, which the caller passes straight to `hybrid_retrieve` and which
degrades cleanly to BM25-only. An embedding service that is down must slow
nobody down and must never turn a working keyword search into a 500.

Contract, verified live on prod 2026-08-14:

    POST http://embedding-service:8001/embed
    header X-Internal-Api-Key: <internal api key>
    body   {"text": "..."}
    -> 200 {"embedding": [384 floats], "model_name": "BAAI/bge-small-en-v1.5",
            "dimension": 384}
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from ...config import settings

logger = logging.getLogger(__name__)

# `EmbedRequest.text` is `Field(min_length=1, max_length=32768)`. A longer body
# is a 422, so it is truncated here rather than spent on a round trip that
# cannot succeed. No real query approaches this.
_MAX_EMBED_CHARS = 32_768

_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    """Return the shared async client, creating it on first use.

    Shared rather than per-call: this sits on the answer request path, and
    `httpx.AsyncClient` is where connection pooling lives. Same lazy-singleton
    shape as `shared/opensearch.get_opensearch`.
    """
    global _client  # noqa: PLW0603
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            base_url=settings.embedding_service_url,
            timeout=httpx.Timeout(settings.embedding_request_timeout),
            headers={"X-Internal-Api-Key": settings.internal_api_key},
        )
    return _client


async def close_embedding_client() -> None:
    """Close the shared client. Called from the app lifespan on shutdown."""
    global _client  # noqa: PLW0603
    if _client is not None and not _client.is_closed:
        await _client.aclose()
        _client = None


def _validate_embedding(payload: Any) -> list[float] | None:
    """Return the vector from a response body, or None if it is not usable.

    The dimension check is not paranoia. `legal_documents_vector` declares a
    fixed `dimension` on its knn_vector field, so a vector of the wrong length
    is rejected by OpenSearch with the same opaque HTTP 400 "all shards failed"
    that a wrong field name produced — the exact failure #382 was about. Caught
    here, it is one ERROR naming both numbers instead of a degraded leg with an
    unreadable cause.
    """
    if not isinstance(payload, dict):
        logger.error("Embedding service returned a non-object body: %r", type(payload).__name__)
        return None

    vector = payload.get("embedding")
    if not isinstance(vector, list) or not vector:
        logger.error("Embedding service returned no usable 'embedding' field: %r", payload)
        return None

    if not all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in vector):
        logger.error("Embedding service returned a vector with non-numeric elements")
        return None

    expected = settings.embedding_dim
    if len(vector) != expected:
        logger.error(
            "Embedding dimension mismatch: service returned %d, the "
            "legal_documents_vector mapping expects %d. Refusing to query with it "
            "— OpenSearch would reject it as an opaque 400. Check EMBEDDING_MODEL_NAME "
            "and RAG_EMBEDDING_DIM.",
            len(vector),
            expected,
        )
        return None

    return [float(v) for v in vector]


async def embed_query(text: str) -> list[float] | None:
    """Embed a search query for the kNN retrieval leg.

    Returns:
        A 384-float vector, or ``None`` when no embedding could be produced —
        because the service is unconfigured, unreachable, slow, or returned
        something unusable. ``None`` is a supported value: the caller passes it
        to `hybrid_retrieve`, which runs BM25-only and records
        ``knn:not_configured`` on the result.

    Never raises.
    """
    if not settings.embedding_service_url:
        # The unconfigured case. Deliberately NOT an ERROR: it is true of every
        # request until the service is wired up, and `hybrid_retrieve` already
        # warns about it once per process. Alarming here per request is the
        # noise that #382's review caught.
        return None

    query = text.strip()
    if not query:
        return None
    if len(query) > _MAX_EMBED_CHARS:
        logger.warning("Query truncated to %d chars for embedding", _MAX_EMBED_CHARS)
        query = query[:_MAX_EMBED_CHARS]

    # Broad except on purpose, and it is the point of this function. A timeout,
    # a DNS failure, a 500, a torn connection, a body that is not JSON — every
    # one of them must produce BM25-only retrieval rather than a failed answer.
    # This IS a real runtime failure, so unlike `knn:not_configured` it earns an
    # ERROR per request.
    try:
        response = await _get_client().post("/embed", json={"text": query})
        response.raise_for_status()
        return _validate_embedding(response.json())
    except httpx.HTTPStatusError as exc:
        logger.error(
            "Embedding service returned HTTP %d for /embed — degrading to BM25-only",
            exc.response.status_code,
            exc_info=True,
        )
        return None
    except httpx.TimeoutException:
        logger.error(
            "Embedding service timed out after %ss — degrading to BM25-only",
            settings.embedding_request_timeout,
            exc_info=True,
        )
        return None
    except Exception:
        logger.error(
            "Embedding request failed against %s — degrading to BM25-only",
            settings.embedding_service_url,
            exc_info=True,
        )
        return None
