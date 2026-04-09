"""LIBERTASIAN Worker Service — Supreme Court E-Library fetcher.

Fetches decisions from the Philippine Supreme Court Electronic Library
(elibrary.judiciary.gov.ph). Parses listing pages to discover decisions
and downloads individual decision HTML pages.
"""

from __future__ import annotations

import logging
import re
from datetime import UTC, datetime

from bs4 import BeautifulSoup, Tag

from .base import BaseFetcher, CandidateDoc, FetchedContent

logger = logging.getLogger(__name__)


class SupremeCourtFetcher(BaseFetcher):
    """Fetcher for the Supreme Court E-Library."""

    def discover(
        self,
        endpoint_url: str,
        last_fetched_at: str | None = None,
    ) -> list[CandidateDoc]:
        """Parse listing pages from elibrary.judiciary.gov.ph.

        The SC E-Library presents decisions in paginated listing pages.
        Each row contains: GR No., title, date, ponente.
        """
        candidates: list[CandidateDoc] = []

        self._rate_limit()
        with self._get_client() as client:
            try:
                response = client.get(endpoint_url)
                response.raise_for_status()
            except Exception:
                logger.exception("Failed to fetch SC listing: %s", endpoint_url)
                return candidates

        soup = BeautifulSoup(response.text, "lxml")

        # SC E-Library typically lists decisions in table rows or div containers
        # Try table-based layout first
        rows = soup.select("table tr") or soup.select(".decision-item, .case-item")

        for row in rows:
            try:
                candidate = self._parse_listing_row(row, endpoint_url)
                if candidate:
                    candidates.append(candidate)
            except Exception:
                logger.warning("Failed to parse SC listing row", exc_info=True)
                continue

        # Also try link-based discovery as fallback
        if not candidates:
            candidates = self._discover_from_links(soup, endpoint_url)

        logger.info(
            "Discovered %d candidates from SC E-Library: %s",
            len(candidates),
            endpoint_url,
        )
        return candidates

    def fetch_content(self, url: str) -> FetchedContent:
        """Download an individual SC decision page."""
        self._validate_url(url)
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

    def _parse_listing_row(
        self,
        row: Tag,
        base_url: str,
    ) -> CandidateDoc | None:
        """Extract candidate info from a listing table row."""
        cells = row.find_all("td")
        if len(cells) < 2:
            return None

        # Look for a link to the decision
        link = row.find("a", href=True)
        if not link:
            return None

        raw_href = link.get("href", "")
        href = str(raw_href) if raw_href else ""
        if not href:
            return None

        # Resolve relative URLs
        if href.startswith("/") or not href.startswith("http"):
            from urllib.parse import urljoin

            href = urljoin(base_url, href)

        title = link.get_text(strip=True)
        if not title:
            return None

        # Extract GR No. from title or cell content
        row_text = row.get_text(" ", strip=True)
        gr_no = self._extract_gr_no(row_text)

        # Extract date from cells (usually the last or second-to-last cell)
        decision_date = None
        ponente = None
        for cell in cells:
            cell_text = cell.get_text(strip=True)
            if not decision_date:
                decision_date = self._extract_date(cell_text)
            if not ponente and self._looks_like_name(cell_text):
                ponente = cell_text

        return CandidateDoc(
            url=href,
            title=title,
            gr_no=gr_no,
            document_type="decision",
            decision_date=decision_date,
            ponente=ponente,
            court="Supreme Court",
        )

    def _discover_from_links(
        self,
        soup: BeautifulSoup,
        base_url: str,
    ) -> list[CandidateDoc]:
        """Fallback discovery: find all links that look like case decisions."""
        candidates: list[CandidateDoc] = []
        seen_urls: set[str] = set()

        for link in soup.find_all("a", href=True):
            raw_href = link.get("href", "")
            href = str(raw_href) if raw_href else ""
            title = link.get_text(strip=True)

            if not href or not title or len(title) < 10:
                continue

            # Resolve relative URLs
            if not href.startswith("http"):
                from urllib.parse import urljoin

                href = urljoin(base_url, href)

            if href in seen_urls:
                continue

            # Filter for likely decision links
            if not self._is_decision_link(href, title):
                continue

            seen_urls.add(href)
            gr_no = self._extract_gr_no(title)

            candidates.append(
                CandidateDoc(
                    url=href,
                    title=title,
                    gr_no=gr_no,
                    document_type="decision",
                    court="Supreme Court",
                )
            )

        return candidates

    @staticmethod
    def _extract_gr_no(text: str) -> str | None:
        """Extract G.R. No. from text."""
        match = re.search(
            r"(?i)G\.?\s*R\.?\s*(?:No\.?\s*)?(\d[\d\-]+)",
            text,
        )
        if match:
            return f"G.R. No. {match.group(1)}"
        return None

    @staticmethod
    def _extract_date(text: str) -> str | None:
        """Try to extract a date string from cell text."""
        # Common Philippine legal date formats
        patterns = [
            r"(\w+ \d{1,2},?\s*\d{4})",  # January 15, 2024
            r"(\d{4}-\d{2}-\d{2})",  # 2024-01-15
            r"(\d{1,2}/\d{1,2}/\d{4})",  # 01/15/2024
        ]
        for pattern in patterns:
            match = re.search(pattern, text)
            if match:
                return match.group(1)
        return None

    @staticmethod
    def _looks_like_name(text: str) -> bool:
        """Heuristic: does this text look like a Justice name?"""
        if not text or len(text) > 50 or len(text) < 3:
            return False
        # Names are typically 2-4 capitalized words, possibly with "J." suffix
        parts = text.replace(",", "").split()
        if len(parts) < 2 or len(parts) > 5:
            return False
        return all(p[0].isupper() or p in ("de", "del", "la", "J.") for p in parts)

    @staticmethod
    def _is_decision_link(href: str, title: str) -> bool:
        """Heuristic: does this link point to a court decision?"""
        href_lower = href.lower()
        title_lower = title.lower()

        # Positive signals
        if any(k in href_lower for k in ("decision", "ruling", "case", "gr_no", "grno")):
            return True
        if re.search(r"(?i)g\.?\s*r\.?\s*no", title):
            return True
        return any(
            k in title_lower for k in ("vs.", "v.", "versus", "people of the philippines")
        )
