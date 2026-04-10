"""LIBERTASIAN Worker Service — Abstract base fetcher for legal document sources.

All source-specific fetchers inherit from BaseFetcher and implement
discover() and fetch_content() methods.
"""

from __future__ import annotations

import logging
import time
from abc import ABC, abstractmethod
from typing import Any
from urllib.parse import urlparse

import httpx
from pydantic import BaseModel

from ..config import settings

logger = logging.getLogger(__name__)

ALLOWED_DOMAINS: frozenset[str] = frozenset({
    "elibrary.judiciary.gov.ph",
    "lawphil.net",
    "www.lawphil.net",
    "officialgazette.gov.ph",
    "www.officialgazette.gov.ph",
    "congress.gov.ph",
    "www.congress.gov.ph",
    "legacy.senate.gov.ph",
    "docs.congress.hrep.online",
})

# Standard browser-like headers to avoid 403 blocks from government sites.
DEFAULT_HEADERS: dict[str, str] = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; LIBERTASIAN-Bot/1.0; "
        "+https://libertasian.com/bot)"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-PH,en;q=0.9,fil;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
}

# HTTP status codes that warrant a retry with backoff.
RETRYABLE_STATUS_CODES: frozenset[int] = frozenset({429, 500, 502, 503, 504})


class CandidateDoc(BaseModel):
    """A candidate document discovered during crawling."""

    url: str
    title: str | None = None
    gr_no: str | None = None
    document_type: str | None = None
    decision_date: str | None = None
    ponente: str | None = None
    court: str | None = None
    metadata: dict[str, Any] = {}


class FetchedContent(BaseModel):
    """Raw content fetched from a source URL."""

    url: str
    html: str
    content_type: str = "text/html"
    status_code: int = 200
    fetched_at: str = ""


class BaseFetcher(ABC):
    """Abstract base class for source fetchers.

    Subclasses implement discover() to find candidate documents from listing
    pages, and fetch_content() to download individual document pages.
    """

    # Max retries for transient HTTP errors (429, 5xx).
    MAX_RETRIES: int = 3
    BACKOFF_BASE: float = 2.0

    def __init__(self) -> None:
        self._last_request_time: float = 0.0

    def _validate_url(self, url: str) -> None:
        """Raise ValueError if URL hostname is not in the allowlist."""
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            raise ValueError(f"Invalid URL scheme: {parsed.scheme}")
        if parsed.hostname not in ALLOWED_DOMAINS:
            raise ValueError(f"URL hostname not allowed: {parsed.hostname}")

    def _rate_limit(self) -> None:
        """Enforce per-domain request delay per CLAUDE.md ingestion settings."""
        elapsed = time.monotonic() - self._last_request_time
        delay = settings.ingestion_request_delay
        if elapsed < delay:
            time.sleep(delay - elapsed)
        self._last_request_time = time.monotonic()

    def _get_client(self) -> httpx.Client:
        """Create an httpx client with browser-like headers."""
        return httpx.Client(
            timeout=settings.ingestion_fetch_timeout,
            headers=DEFAULT_HEADERS,
            follow_redirects=True,
        )

    def _fetch_with_retry(
        self,
        client: httpx.Client,
        url: str,
    ) -> httpx.Response:
        """GET *url* with exponential backoff on retryable status codes.

        Non-retryable errors (403, 404, etc.) are returned immediately so
        callers can handle them gracefully.
        """
        last_exc: Exception | None = None
        for attempt in range(self.MAX_RETRIES):
            try:
                self._rate_limit()
                response = client.get(url)
                if response.status_code not in RETRYABLE_STATUS_CODES:
                    return response
                logger.warning(
                    "Retryable HTTP %d from %s (attempt %d/%d)",
                    response.status_code,
                    url,
                    attempt + 1,
                    self.MAX_RETRIES,
                )
            except httpx.TransportError as exc:
                logger.warning(
                    "Transport error fetching %s (attempt %d/%d): %s",
                    url,
                    attempt + 1,
                    self.MAX_RETRIES,
                    exc,
                )
                last_exc = exc

            if attempt < self.MAX_RETRIES - 1:
                backoff = self.BACKOFF_BASE ** (attempt + 1)
                time.sleep(backoff)

        # If last attempt got a response, return it even if retryable.
        if last_exc is None:
            return response  # type: ignore[possibly-undefined]
        raise last_exc

    @abstractmethod
    def discover(
        self,
        endpoint_url: str,
        last_fetched_at: str | None = None,
    ) -> list[CandidateDoc]:
        """Discover candidate documents from a source endpoint.

        Args:
            endpoint_url: The listing/index URL to crawl.
            last_fetched_at: ISO timestamp of last successful fetch (for incremental).

        Returns:
            List of candidate documents found.
        """
        ...

    @abstractmethod
    def fetch_content(self, url: str) -> FetchedContent:
        """Fetch the full content of a single document page.

        Args:
            url: The document URL to download.

        Returns:
            FetchedContent with raw HTML and metadata.
        """
        ...
