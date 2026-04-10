"""LIBERTASIAN Worker Service — Official Gazette fetcher.

Fetches Philippine legal documents from officialgazette.gov.ph.
Detects Executive Orders, Proclamations, Administrative Orders,
Republic Acts, and other issuances from listing/index pages.

The Official Gazette is a WordPress site. Listing pages are paginated
with ``/page/N/`` suffixes. Individual documents live at dated URLs:
``/{YYYY}/{MM}/{DD}/{slug}/``.
"""

from __future__ import annotations

import logging
import re
from datetime import UTC, datetime
from urllib.parse import urljoin

from bs4 import BeautifulSoup, Tag

from .base import BaseFetcher, CandidateDoc, FetchedContent

logger = logging.getLogger(__name__)


class OfficialGazetteFetcher(BaseFetcher):
    """Fetcher for officialgazette.gov.ph legal documents."""

    def discover(
        self,
        endpoint_url: str,
        last_fetched_at: str | None = None,
    ) -> list[CandidateDoc]:
        """Parse listing pages from the Official Gazette."""
        candidates: list[CandidateDoc] = []

        with self._get_client() as client:
            try:
                response = self._fetch_with_retry(client, endpoint_url)
                if response.status_code == 403:
                    logger.warning(
                        "Official Gazette returned 403 (bot-blocked): %s",
                        endpoint_url,
                    )
                    return candidates
                if response.status_code >= 400:
                    logger.warning(
                        "Official Gazette returned HTTP %d: %s",
                        response.status_code,
                        endpoint_url,
                    )
                    return candidates
            except Exception:
                logger.exception(
                    "Failed to fetch Official Gazette listing: %s", endpoint_url,
                )
                return candidates

        soup = BeautifulSoup(response.text, "lxml")
        seen_urls: set[str] = set()

        for link in soup.find_all("a", href=True):
            try:
                candidate = self._parse_link(link, endpoint_url, seen_urls)
                if candidate:
                    candidates.append(candidate)
            except Exception:
                logger.warning(
                    "Failed to parse Official Gazette link", exc_info=True,
                )
                continue

        logger.info(
            "Discovered %d candidates from Official Gazette: %s",
            len(candidates),
            endpoint_url,
        )
        return candidates

    def fetch_content(self, url: str) -> FetchedContent:
        """Download an individual Official Gazette document page."""
        self._validate_url(url)
        with self._get_client() as client:
            response = self._fetch_with_retry(client, url)
            response.raise_for_status()

        return FetchedContent(
            url=url,
            html=response.text,
            content_type=response.headers.get("content-type", "text/html"),
            status_code=response.status_code,
            fetched_at=datetime.now(UTC).isoformat(),
        )

    def _parse_link(
        self,
        link: Tag,
        base_url: str,
        seen_urls: set[str],
    ) -> CandidateDoc | None:
        """Extract candidate info from a link element."""
        raw_href = str(link.get("href", ""))
        title = link.get_text(strip=True)

        if not raw_href or not title or len(title) < 5:
            return None

        if not raw_href.startswith("http"):
            raw_href = urljoin(base_url, raw_href)

        if raw_href in seen_urls:
            return None

        if not self._is_legal_document_link(raw_href, title):
            return None

        seen_urls.add(raw_href)

        document_type = self._detect_document_type(raw_href, title)
        decision_date = self._extract_date_from_url(raw_href) or self._extract_date(title)

        return CandidateDoc(
            url=raw_href,
            title=title,
            document_type=document_type,
            decision_date=decision_date,
        )

    @staticmethod
    def _is_legal_document_link(href: str, title: str) -> bool:
        """Filter for links that point to actual legal documents."""
        href_lower = href.lower()

        if "officialgazette.gov.ph" not in href_lower:
            return False

        # Exclude pagination, feed, and navigation links
        if any(
            k in href_lower
            for k in ("/feed/", "/page/", "/tag/", "/category/", "/author/", "#")
        ):
            return False

        # Legal document URL patterns
        legal_paths = (
            "/executive-order",
            "/proclamation",
            "/administrative-order",
            "/republic-act",
            "/memorandum-order",
            "/memorandum-circular",
            "/letter-of-instruction",
        )
        if any(p in href_lower for p in legal_paths):
            return True

        # Dated document URLs (e.g., /2024/01/15/document-title/)
        if re.search(r"/\d{4}/\d{2}/\d{2}/", href_lower):
            return True

        return False

    @staticmethod
    def _detect_document_type(href: str, title: str) -> str:
        """Detect document type from URL path or title."""
        href_lower = href.lower()
        title_lower = title.lower()

        if "/executive-order" in href_lower or "executive order" in title_lower:
            return "executive_order"
        if "/proclamation" in href_lower or "proclamation" in title_lower:
            return "proclamation"
        if "/administrative-order" in href_lower or "administrative order" in title_lower:
            return "administrative_order"
        if "/republic-act" in href_lower or "republic act" in title_lower:
            return "republic_act"
        if "/memorandum" in href_lower:
            return "memorandum"
        if "/letter-of-instruction" in href_lower:
            return "letter_of_instruction"

        return "executive_order"

    @staticmethod
    def _extract_date_from_url(href: str) -> str | None:
        """Extract date from a dated WordPress URL (e.g. /2024/01/15/...)."""
        match = re.search(r"/(\d{4})/(\d{2})/(\d{2})/", href)
        if match:
            return f"{match.group(1)}-{match.group(2)}-{match.group(3)}"
        return None

    @staticmethod
    def _extract_date(text: str) -> str | None:
        """Try to extract a date string from text."""
        patterns = [
            r"(\w+ \d{1,2},?\s*\d{4})",
            r"(\d{4}-\d{2}-\d{2})",
        ]
        for pattern in patterns:
            match = re.search(pattern, text)
            if match:
                return match.group(1)
        return None
