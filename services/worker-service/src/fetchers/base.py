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

# Browser-like headers to avoid 403 blocks from government sites.
# Use a real browser User-Agent — bot identifiers get blocked by Cloudflare
# and similar WAFs on officialgazette.gov.ph and congress.gov.ph.
DEFAULT_HEADERS: dict[str, str] = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/131.0.0.0 Safari/537.36"
    ),
    "Accept": (
        "text/html,application/xhtml+xml,application/xml;q=0.9,"
        "image/avif,image/webp,image/apng,*/*;q=0.8"
    ),
    "Accept-Language": "en-PH,en-US;q=0.9,en;q=0.8,fil;q=0.7",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
}

# HTTP status codes that warrant a retry with backoff.
RETRYABLE_STATUS_CODES: frozenset[int] = frozenset({429, 500, 502, 503, 504})


class CloudflareBlockedError(Exception):
    """Raised when a source is gated behind a Cloudflare managed challenge.

    This is a *recoverable* condition from the pipeline's point of view: the
    fetcher did its job, the remote site is simply refusing to serve us without
    a JavaScript challenge solver (Turnstile). Callers should catch this, mark
    the endpoint run as "blocked" in ``errors_json`` (keeping job status
    ``completed``), and continue with the next endpoint.

    This is intentionally distinct from generic HTTP 403 errors so operators
    can filter telemetry on "site is blocking us behind Cloudflare" vs. other
    bot mitigations.
    """

    def __init__(
        self,
        endpoint_url: str,
        status_code: int = 403,
        cf_type: str = "managed_challenge",
    ) -> None:
        self.endpoint_url = endpoint_url
        self.status_code = status_code
        self.cf_type = cf_type
        super().__init__(
            f"Cloudflare {cf_type} blocked {endpoint_url} (HTTP {status_code})",
        )


def is_cloudflare_challenge(html: str) -> bool:
    """Detect Cloudflare Turnstile / managed challenge pages.

    Shared helper so every fetcher uses the same detection rules.
    """
    if not html:
        return False
    return "Just a moment" in html or "challenge-platform" in html


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

    def fetch_since(
        self,
        endpoint_url: str,
        cursor: str | None,
    ) -> tuple[list[CandidateDoc], str | None]:
        """Fetch only decisions newer than ``cursor``.

        The cursor is the URL of the most-recent candidate captured on the
        previous successful crawl. The fetcher re-discovers the current
        listing and returns everything that appears *above* the cursor URL —
        i.e. every decision the site has published since last run.

        Behavioral rules:

        1. ``cursor is None`` → first-ever run. Return the full listing and
           set the new cursor to the newest candidate's URL.
        2. ``cursor`` found in the current listing → return only the
           candidates that come before it, and set new cursor to the newest.
        3. ``cursor`` NOT found (got pushed off the listing by a large batch,
           or the decision was removed) → conservative fallback: return the
           full listing so nothing is missed, and advance the cursor to the
           newest entry.
        4. Listing is empty → return ``([], cursor)``. Cursor must not
           advance; callers treat this as a no-op that does NOT move
           ``crawl_state`` forward, so a transient source outage can't skip
           future decisions.

        Args:
            endpoint_url: Source listing URL to crawl.
            cursor: URL of the newest decision captured last run, or None.

        Returns:
            (new_candidates, new_cursor). ``new_cursor`` is ``None`` only if
            ``discover`` returned zero candidates AND the input cursor was
            also ``None``.
        """
        candidates = self.discover(endpoint_url)
        if not candidates:
            return [], cursor

        # Listings are assumed to be reverse-chronological (newest first).
        newest_url = candidates[0].url

        if cursor is None:
            return list(candidates), newest_url

        new_candidates: list[CandidateDoc] = []
        cursor_found = False
        for c in candidates:
            if c.url == cursor:
                cursor_found = True
                break
            new_candidates.append(c)

        if not cursor_found:
            # Cursor fell off the listing — play it safe and return all.
            return list(candidates), newest_url

        return new_candidates, newest_url if new_candidates else cursor
