"""LIBERTASIAN Worker Service — Supreme Court E-Library fetcher.

Fetches decisions from the Philippine Supreme Court Electronic Library
(elibrary.judiciary.gov.ph). Parses monthly listing pages to discover
decisions and downloads individual decision HTML pages.

Site structure (as of 2025-2026):
  Category landing:  /thebookshelf/1  (SC Decisions)
  Monthly listing:   /thebookshelf/docmonth/{Mon}/{YYYY}/1
  Detail:            /thebookshelf/showdocs/1/{doc_id}

The monthly listing page renders decisions as bare ``<a>`` tags (with
``<strong>`` for the G.R. number and ``<small>`` for the title) directly
inside ``div#container_title`` — they are NOT wrapped in ``<li>`` elements.

The category landing page at ``/thebookshelf/1`` lists monthly links
(``docmonth/Mon/Year/1``) that the fetcher follows automatically.
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

# Maximum number of monthly pages to follow from a landing page.
_MAX_MONTHLY_PAGES = 3


class SupremeCourtFetcher(BaseFetcher):
    """Fetcher for the Supreme Court E-Library."""

    def discover(
        self,
        endpoint_url: str,
        last_fetched_at: str | None = None,
    ) -> list[CandidateDoc]:
        """Discover SC decisions from elibrary.judiciary.gov.ph.

        Handles two URL types:

        1. **Monthly listing page** (``/docmonth/Mon/Year/1``): contains
           ``showdocs`` links directly — parse them.
        2. **Category landing page** (``/thebookshelf/1``): contains
           ``docmonth`` links — follow the most recent ones and parse each.
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

            # Strategy 1: parse showdocs links from a monthly listing page.
            candidates = self._parse_showdocs_page(soup, endpoint_url)

            # Strategy 2: if no showdocs links found, this may be a category
            # landing page — discover monthly page URLs and follow them.
            if not candidates:
                monthly_urls = self._discover_monthly_urls(soup, endpoint_url)
                for monthly_url in monthly_urls[:_MAX_MONTHLY_PAGES]:
                    try:
                        resp = self._fetch_with_retry(client, monthly_url)
                        if resp.status_code >= 400:
                            continue
                        monthly_soup = BeautifulSoup(resp.text, "lxml")
                        monthly_candidates = self._parse_showdocs_page(
                            monthly_soup, monthly_url,
                        )
                        candidates.extend(monthly_candidates)
                    except Exception:
                        logger.warning(
                            "Failed to fetch SC monthly page: %s",
                            monthly_url,
                            exc_info=True,
                        )
                        continue

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

    def _parse_showdocs_page(
        self,
        soup: BeautifulSoup,
        base_url: str,
    ) -> list[CandidateDoc]:
        """Extract all ``showdocs`` links from a monthly listing page.

        The SC E-Library renders decisions as bare ``<a>`` tags directly
        inside ``div#container_title``::

            <div id="container_title">
              <H3>Jan 2025 | Decisions / Signed Resolutions</H3><HR>
              <a href='.../showdocs/1/69834'>
                <STRONG>G.R. No. 246027</STRONG><br>
                <small>CASE TITLE …</small>
                January 28, 2025
              </a>
              ...
            </div>
        """
        candidates: list[CandidateDoc] = []
        seen_urls: set[str] = set()

        # Prefer searching inside the container div, fall back to whole page.
        container = soup.find("div", id="container_title")
        search_area = container if container else soup

        for link in search_area.find_all("a", href=True):
            raw_href = str(link.get("href", ""))
            if "showdocs" not in raw_href:
                continue

            href = (
                raw_href
                if raw_href.startswith("http")
                else urljoin(base_url, raw_href)
            )
            if href in seen_urls:
                continue
            seen_urls.add(href)

            try:
                candidate = self._parse_showdocs_link(link, href)
                if candidate:
                    candidates.append(candidate)
            except Exception:
                logger.warning("Failed to parse SC listing link", exc_info=True)
                continue

        return candidates

    def _parse_showdocs_link(
        self,
        link: Tag,
        href: str,
    ) -> CandidateDoc | None:
        """Extract candidate info from a single showdocs ``<a>`` tag."""
        # G.R. number from <strong> or <b>
        strong = link.find("strong") or link.find("b")
        gr_no_raw = strong.get_text(strip=True) if strong else ""
        gr_no = self._normalize_gr_no(gr_no_raw)

        # Case title from <small>
        small = link.find("small")
        title = small.get_text(strip=True) if small else ""
        if not title:
            title = link.get_text(strip=True)
        if not title or len(title) < 5:
            return None

        # Fallback: extract GR No. from the title text if not found in <strong>
        if not gr_no:
            gr_no = self._extract_gr_no(title)

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

    @staticmethod
    def _discover_monthly_urls(
        soup: BeautifulSoup,
        base_url: str,
    ) -> list[str]:
        """Find ``docmonth`` links on a category landing page.

        Returns URLs sorted with the most recent month first.
        """
        urls: list[str] = []
        seen: set[str] = set()

        for link in soup.find_all("a", href=True):
            raw_href = str(link.get("href", ""))
            if not _DOCMONTH_PATTERN.search(raw_href):
                continue
            href = (
                raw_href
                if raw_href.startswith("http")
                else urljoin(base_url, raw_href)
            )
            if href not in seen:
                seen.add(href)
                urls.append(href)

        # The landing page lists months in reverse-chronological order already,
        # but sort by year/month descending to be safe.
        def _sort_key(url: str) -> tuple[int, int]:
            m = re.search(r"/docmonth/(\w+)/(\d{4})/", url)
            if not m:
                return (0, 0)
            month_names = {
                "jan": 1, "feb": 2, "mar": 3, "apr": 4,
                "may": 5, "jun": 6, "jul": 7, "aug": 8,
                "sep": 9, "oct": 10, "nov": 11, "dec": 12,
            }
            month_num = month_names.get(m.group(1).lower()[:3], 0)
            return (int(m.group(2)), month_num)

        urls.sort(key=_sort_key, reverse=True)
        return urls

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
