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
})


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
        """Create an httpx client with ingestion settings."""
        return httpx.Client(
            timeout=settings.ingestion_fetch_timeout,
            headers={"User-Agent": settings.ingestion_user_agent},
            follow_redirects=True,
        )

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
