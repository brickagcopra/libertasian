"""LIBERTASIAN Worker Service — Congress fetcher.

Fetches Philippine legal documents from congress.gov.ph.
Detects Republic Acts and bills from listing/index pages.
"""

from __future__ import annotations

import logging
import re
from datetime import UTC, datetime
from urllib.parse import urljoin

from bs4 import BeautifulSoup, Tag

from .base import BaseFetcher, CandidateDoc, FetchedContent

logger = logging.getLogger(__name__)


class CongressFetcher(BaseFetcher):
    """Fetcher for congress.gov.ph legal documents."""

    def discover(
        self,
        endpoint_url: str,
        last_fetched_at: str | None = None,
    ) -> list[CandidateDoc]:
        """Parse listing pages from the Philippine Congress website."""
        candidates: list[CandidateDoc] = []

        self._rate_limit()
        with self._get_client() as client:
            try:
                response = client.get(endpoint_url)
                response.raise_for_status()
            except Exception:
                logger.exception(
                    "Failed to fetch Congress listing: %s", endpoint_url,
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
                    "Failed to parse Congress link", exc_info=True,
                )
                continue

        logger.info(
            "Discovered %d candidates from Congress: %s",
            len(candidates),
            endpoint_url,
        )
        return candidates

    def fetch_content(self, url: str) -> FetchedContent:
        """Download an individual Congress document page."""
        self._rate_limit()
        with self._get_client() as client:
            response = client.get(url)
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
        raw_href = link.get("href", "")
        href = str(raw_href) if raw_href else ""
        title = link.get_text(strip=True)

        if not href or not title or len(title) < 5:
            return None

        if not href.startswith("http"):
            href = urljoin(base_url, href)

        if href in seen_urls:
            return None

        if not self._is_legal_document_link(href, title):
            return None

        seen_urls.add(href)

        document_type = self._detect_document_type(href, title)
        ra_no = self._extract_ra_no(title)
        decision_date = self._extract_date(title)

        return CandidateDoc(
            url=href,
            title=title,
            gr_no=ra_no,
            document_type=document_type,
            decision_date=decision_date,
        )

    @staticmethod
    def _is_legal_document_link(href: str, title: str) -> bool:
        """Filter for links that point to actual legal documents."""
        href_lower = href.lower()

        if "congress.gov.ph" not in href_lower and not href_lower.startswith("/"):
            return False

        legal_paths = (
            "/republic-act",
            "/ra-",
            "/legisdocs",
            "/bills",
            "/enrolled",
            "/legislation",
        )
        if any(p in href_lower for p in legal_paths):
            return True

        title_lower = title.lower()
        if any(
            k in title_lower
            for k in ("republic act", "r.a. no", "ra no", "house bill", "senate bill")
        ):
            return True

        return False

    @staticmethod
    def _detect_document_type(href: str, title: str) -> str:
        """Detect document type from URL path or title."""
        href_lower = href.lower()
        title_lower = title.lower()

        if "republic-act" in href_lower or "republic act" in title_lower:
            return "republic_act"
        if "house-bill" in href_lower or "house bill" in title_lower:
            return "bill"
        if "senate-bill" in href_lower or "senate bill" in title_lower:
            return "bill"
        if "/resolution" in href_lower or "resolution" in title_lower:
            return "resolution"

        return "republic_act"

    @staticmethod
    def _extract_ra_no(text: str) -> str | None:
        """Extract Republic Act number from text."""
        match = re.search(
            r"(?i)(?:Republic Act|R\.?A\.?)\s*(?:No\.?\s*)?(\d+)",
            text,
        )
        if match:
            return f"R.A. No. {match.group(1)}"
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
