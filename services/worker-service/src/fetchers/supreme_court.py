"""LIBERTASIAN Worker Service — Supreme Court E-Library fetcher.

Fetches decisions from the Philippine Supreme Court Electronic Library
(elibrary.judiciary.gov.ph). Parses monthly listing pages to discover
decisions and downloads individual decision HTML pages.

Site structure (as of 2025):
  Listing: /thebookshelf/docmonth/{Mon}/{YYYY}/{category}
  Detail:  /thebookshelf/showdocs/{category}/{doc_id}
  Category 1 = SC Decisions / Signed Resolutions
"""

from __future__ import annotations

import logging
import re
from datetime import UTC, datetime
from urllib.parse import urljoin

from bs4 import BeautifulSoup, Tag

from .base import BaseFetcher, CandidateDoc, FetchedContent

logger = logging.getLogger(__name__)

# SC E-Library monthly listing URL pattern.
# Example: https://elibrary.judiciary.gov.ph/thebookshelf/docmonth/Jan/2025/1
_DOCMONTH_PATTERN = re.compile(
    r"/thebookshelf/docmonth/\w+/\d{4}/\d+",
    re.IGNORECASE,
)


class SupremeCourtFetcher(BaseFetcher):
    """Fetcher for the Supreme Court E-Library."""

    def discover(
        self,
        endpoint_url: str,
        last_fetched_at: str | None = None,
    ) -> list[CandidateDoc]:
        """Parse monthly listing pages from elibrary.judiciary.gov.ph.

        The SC E-Library presents decisions on monthly pages. Each ``<li>``
        contains:
        - ``<strong>`` with the G.R. number
        - ``<small>`` with the full case title (parties)
        - trailing text with the decision date (e.g. "January 28, 2025")
        """
        candidates: list[CandidateDoc] = []

        with self._get_client() as client:
            try:
                response = self._fetch_with_retry(client, endpoint_url)
                if response.status_code >= 400:
                    logger.warning(
                        "SC listing returned HTTP %d: %s",
                        response.status_code,
                        endpoint_url,
                    )
                    return candidates
            except Exception:
                logger.exception("Failed to fetch SC listing: %s", endpoint_url)
                return candidates

        soup = BeautifulSoup(response.text, "lxml")

        # Primary strategy: parse <li> items inside div#container_title ul
        container = soup.find("div", id="container_title")
        if container:
            items = container.find_all("li")
        else:
            # Fallback: any <li> with a showdocs link
            items = soup.find_all("li")

        for item in items:
            try:
                candidate = self._parse_listing_item(item, endpoint_url)
                if candidate:
                    candidates.append(candidate)
            except Exception:
                logger.warning("Failed to parse SC listing item", exc_info=True)
                continue

        # Fallback: link-based discovery if no <li> items found
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

    # ------------------------------------------------------------------
    # Parsing helpers
    # ------------------------------------------------------------------

    def _parse_listing_item(
        self,
        item: Tag,
        base_url: str,
    ) -> CandidateDoc | None:
        """Extract candidate info from a <li> on a monthly listing page.

        Expected structure::

            <li>
              <a href="…/showdocs/1/69834">
                <STRONG>G.R. No. 246027</STRONG><br>
                <small>TITLE OF CASE …</small>
                January 28, 2025
              </a>
              <hr><br>
            </li>
        """
        link = item.find("a", href=True)
        if not link:
            return None

        raw_href = str(link.get("href", ""))
        if not raw_href or "showdocs" not in raw_href:
            return None

        href = raw_href if raw_href.startswith("http") else urljoin(base_url, raw_href)

        # G.R. number from <strong>
        strong = link.find("strong") or link.find("b")
        gr_no_raw = strong.get_text(strip=True) if strong else ""
        gr_no = self._normalize_gr_no(gr_no_raw)

        # Case title from <small>
        small = link.find("small")
        title = small.get_text(strip=True) if small else ""
        if not title:
            title = link.get_text(strip=True)
        if not title:
            return None

        # Decision date from trailing text node inside <a>
        decision_date = self._extract_date_from_link(link)

        return CandidateDoc(
            url=href,
            title=title,
            gr_no=gr_no,
            document_type="decision",
            decision_date=decision_date,
            court="Supreme Court",
            metadata={"source_doc_id": self._extract_doc_id(href)},
        )

    def _discover_from_links(
        self,
        soup: BeautifulSoup,
        base_url: str,
    ) -> list[CandidateDoc]:
        """Fallback discovery: find all showdocs links."""
        candidates: list[CandidateDoc] = []
        seen_urls: set[str] = set()

        for link in soup.find_all("a", href=True):
            raw_href = str(link.get("href", ""))
            if "showdocs" not in raw_href:
                continue

            href = raw_href if raw_href.startswith("http") else urljoin(base_url, raw_href)
            if href in seen_urls:
                continue
            seen_urls.add(href)

            title = link.get_text(strip=True)
            if not title or len(title) < 10:
                continue

            gr_no = self._extract_gr_no(title)

            candidates.append(
                CandidateDoc(
                    url=href,
                    title=title,
                    gr_no=gr_no,
                    document_type="decision",
                    court="Supreme Court",
                    metadata={"source_doc_id": self._extract_doc_id(href)},
                )
            )

        return candidates

    # ------------------------------------------------------------------
    # Static extraction helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _normalize_gr_no(text: str) -> str | None:
        """Normalize G.R. No. string to canonical format."""
        if not text:
            return None
        match = re.search(
            r"(?i)G\.?\s*R\.?\s*(?:No\.?\s*)?(?:Nos\.?\s*)?([\w\d][\d\-\s,andNos.]+)",
            text,
        )
        if match:
            return text.strip()
        return text.strip() if text.strip() else None

    @staticmethod
    def _extract_gr_no(text: str) -> str | None:
        """Extract G.R. No. from arbitrary text."""
        match = re.search(
            r"(?i)G\.?\s*R\.?\s*(?:No\.?\s*)?([A-Z]?\-?\d[\d\-]+)",
            text,
        )
        if match:
            return f"G.R. No. {match.group(1)}"
        return None

    @staticmethod
    def _extract_date_from_link(link: Tag) -> str | None:
        """Extract decision date from the trailing text inside <a>.

        After the ``<small>`` and ``<br>`` tags, the date sits as plain text.
        """
        # Get all navigable strings (text nodes) within the link
        texts = list(link.stripped_strings)
        # The date is typically the last text node
        patterns = [
            r"(\w+ \d{1,2},?\s*\d{4})",  # January 15, 2024
            r"(\d{4}-\d{2}-\d{2})",  # 2024-01-15
        ]
        for text in reversed(texts):
            for pattern in patterns:
                match = re.search(pattern, text)
                if match:
                    return match.group(1)
        return None

    @staticmethod
    def _extract_doc_id(href: str) -> str | None:
        """Extract numeric document ID from showdocs URL."""
        match = re.search(r"/showdocs/\d+/(\d+)", href)
        return match.group(1) if match else None

    @staticmethod
    def _looks_like_name(text: str) -> bool:
        """Heuristic: does this text look like a Justice name?"""
        if not text or len(text) > 50 or len(text) < 3:
            return False
        parts = text.replace(",", "").split()
        if len(parts) < 2 or len(parts) > 5:
            return False
        return all(p[0].isupper() or p in ("de", "del", "la", "J.") for p in parts)
