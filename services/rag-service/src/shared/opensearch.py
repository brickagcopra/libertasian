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

    Auth and TLS verification come from settings: basic auth is attached only
    when BOTH username and password are set (so local unsecured clusters still
    work), and verification follows ``opensearch_verify_ssl`` — off by default
    because the prod cluster serves a self-signed cert on the internal network.
    """
    global _client  # noqa: PLW0603
    if _client is None or _client.is_closed:
        auth: tuple[str, str] | None = None
        if settings.opensearch_username and settings.opensearch_password:
            auth = (settings.opensearch_username, settings.opensearch_password)
        _client = httpx.AsyncClient(
            base_url=settings.opensearch_url,
            timeout=httpx.Timeout(connect=5.0, read=10.0, write=5.0, pool=5.0),
            auth=auth,
            verify=settings.opensearch_verify_ssl,
        )
    return _client


async def close_opensearch() -> None:
    """Close the shared OpenSearch client."""
    global _client  # noqa: PLW0603
    if _client is not None and not _client.is_closed:
        await _client.aclose()
        _client = None


async def ping_opensearch() -> dict[str, Any]:
    """Ping the cluster root and return the parsed response.

    Raises ``httpx.HTTPError`` if the cluster is unreachable, refuses the
    credentials, or presents a certificate the client will not accept.
    """
    client = get_opensearch()
    response = await client.get("/")
    response.raise_for_status()
    data: dict[str, Any] = response.json()
    return data


async def opensearch_search(
    index: str,
    body: dict[str, Any],
) -> dict[str, Any]:
    """Execute an OpenSearch search request and return the parsed response.

    Raises ``httpx.HTTPError`` on any transport, TLS, or HTTP-status failure.

    This function deliberately does NOT return an empty hit set on failure.
    Doing so made a total connectivity outage (self-signed cert rejected by
    every request) indistinguishable from a genuine zero-result query, and the
    whole RAG surface — answers, memos, flashcards, bar answers — served
    confident "no sources found" responses for as long as it lasted. A caller
    that genuinely wants to degrade softly must catch the error itself and say
    so at the call site.
    """
    client = get_opensearch()
    try:
        response = await client.post(f"/{index}/_search", json=body)
        response.raise_for_status()
        data: dict[str, Any] = response.json()
        return data
    except httpx.HTTPError:
        logger.error("OpenSearch search failed on index %s", index, exc_info=True)
        raise
