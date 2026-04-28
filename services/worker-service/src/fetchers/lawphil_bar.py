"""LIBERTASIAN Worker Service — LawPhil past bar examinations fetcher.

Fetches individual past bar examination question pages from LawPhil
(``/courts/bm/barQ/<year>/<subject_slug>.html``). Reuses the polite
delay (``BaseFetcher._rate_limit``) and Cloudflare detection from the
shared base class. ``discover()`` is unused for bar exams — pages are
addressed directly by (year, slug); the ``fetch_content()`` method is
the only entry point.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from .base import (
    BaseFetcher,
    CandidateDoc,
    CloudflareBlockedError,
    FetchedContent,
    is_cloudflare_challenge,
)

logger = logging.getLogger(__name__)


class LawphilBarFetcher(BaseFetcher):
    """Fetcher for LawPhil past bar examination question pages.

    LawPhil hosts each (year, subject) sitting at a stable URL of the form
    ``https://lawphil.net/courts/bm/barQ/<year>/<subject_slug>.html``.
    Pages are decoded as windows-1252 (LawPhil's native encoding).
    """

    def discover(
        self,
        endpoint_url: str,  # noqa: ARG002 — discover is unused for bar exams
        last_fetched_at: str | None = None,  # noqa: ARG002
    ) -> list[CandidateDoc]:
        """Bar-exam pages are enumerated by registry; nothing to discover."""
        return []

    def fetch_content(self, url: str) -> FetchedContent:
        """Download a single LawPhil bar examination page."""
        self._validate_url(url)
        with self._get_client() as client:
            response = self._fetch_with_retry(client, url)
            html_text = response.content.decode("windows-1252", errors="replace")

            if is_cloudflare_challenge(html_text):
                logger.warning(
                    "LawPhil bar exam returned Cloudflare challenge "
                    "(HTTP %d): %s",
                    response.status_code,
                    url,
                )
                raise CloudflareBlockedError(
                    endpoint_url=url,
                    status_code=response.status_code,
                    cf_type="managed_challenge",
                )

            response.raise_for_status()

        return FetchedContent(
            url=url,
            html=html_text,
            content_type=response.headers.get("content-type", "text/html"),
            status_code=response.status_code,
            fetched_at=datetime.now(UTC).isoformat(),
        )
