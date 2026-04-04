"""Async OpenSearch client singleton."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from ..config import settings

logger = logging.getLogger(__name__)

_client: httpx.AsyncClient | None = None


def get_opensearch() -> httpx.AsyncClient:
    """Return a shared async HTTP client for OpenSearch requests.

    Uses httpx rather than opensearch-py to keep dependencies light.
    The client is created lazily on first call.
    """
    global _client  # noqa: PLW0603
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            base_url=settings.opensearch_url,
            timeout=httpx.Timeout(connect=5.0, read=10.0, write=5.0, pool=5.0),
        )
    return _client


async def close_opensearch() -> None:
    """Close the shared OpenSearch client."""
    global _client  # noqa: PLW0603
    if _client is not None and not _client.is_closed:
        await _client.aclose()
        _client = None


async def opensearch_search(
    index: str,
    body: dict[str, Any],
) -> dict[str, Any]:
    """Execute an OpenSearch search request and return the parsed response."""
    client = get_opensearch()
    try:
        response = await client.post(f"/{index}/_search", json=body)
        response.raise_for_status()
        data: dict[str, Any] = response.json()
        return data
    except httpx.HTTPError:
        logger.warning("OpenSearch search failed on index %s", index, exc_info=True)
        return {"hits": {"total": {"value": 0}, "hits": []}}
