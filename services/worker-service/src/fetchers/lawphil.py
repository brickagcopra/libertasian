"""LIBERTASIAN Worker Service — Lawphil fetcher.

Fetches Philippine legal documents from lawphil.net.
Parses monthly listing pages to discover jurisprudence,
then downloads individual document HTML pages.

Site structure (as of 2025-2026):
  Main index:    /judjuris/judjuris.html  (years 1901-present)
  Year index:    /judjuris/juri{YYYY}/juri{YYYY}.html
  Month listing: /judjuris/juri{YYYY}/{mon}{YYYY}/{mon}{YYYY}.html
  Decision page: /judjuris/juri{YYYY}/{mon}{YYYY}/{case_id}_{YYYY}.html

The fetcher handles three entry points:
  1. Monthly page (has ``table#s-menu`` with ``tr.xy`` rows) — parse directly.
  2. Year index page (has links to monthly pages) — follow them and parse.
  3. Main index page (has links to year pages) — follow the latest year.

Note: Site encoding is windows-1252, not UTF-8.  SSL certificate for
www.lawphil.net is expired — use lawphil.net (without www).
"""

from __future__ import annotations

import logging
import re
from datetime import UTC, datetime
from urllib.parse import urljoin

from bs4 import BeautifulSoup, Tag

from .base import BaseFetcher, CandidateDoc, FetchedContent

logger = logging.getLogger(__name__)

# Maximum number of monthly pages to follow from a year index.
_MAX_MONTHLY_PAGES = 3

# Pattern matching monthly page URLs:  .../jan2025/jan2025.html
_MONTHLY_PAGE_PATTERN = re.compile(
    r"[a-z]{3}\d{4}/[a-z]{3}\d{4}\.html$",
    re.IGNORECASE,
)

# Pattern matching year index URLs:  .../juri2025/juri2025.html
_YEAR_INDEX_PATTERN = re.compile(
    r"juri(\d{4})/juri\d{4}\.html$",
    re.IGNORECASE,
)


class LawphilFetcher(BaseFetcher):
    """Fetcher for lawphil.net legal documents."""

    def discover(
        self,
        endpoint_url: str,
        last_fetched_at: str | None = None,
    ) -> list[CandidateDoc]:
        """Discover SC decisions from lawphil.net.

        Handles three URL types:

        1. **Monthly page** (``table#s-menu`` present): parse case rows.
        2. **Year index** (links to monthly pages): follow the most recent
           monthly pages and parse each.
        3. **Main index** (``judjuris.html``): follow the latest year link,
           then proceed as (2).
        """
        candidates: list[CandidateDoc] = []

        with self._get_client() as client:
            try:
                response = self._fetch_with_retry(client, endpoint_url)
                if response.status_code >= 400:
                    logger.warning(
                        "Lawphil listing returned HTTP %d: %s",
                        response.status_code,
                        endpoint_url,
                    )
                    return candidates
            except Exception:
                logger.exception("Failed to fetch Lawphil listing: %s", endpoint_url)
                return candidates

            # Lawphil uses windows-1252 encoding
            html_text = response.content.decode("windows-1252", errors="replace")
            soup = BeautifulSoup(html_text, "lxml")

            # Check if this is a monthly page with case table.
            table = soup.find("table", id="s-menu")
            if table:
                candidates = self._parse_monthly_table(
                    table, endpoint_url,
                )
            else:
                # This is a year index or main index — discover monthly URLs.
                monthly_urls = self._discover_monthly_urls(soup, endpoint_url)

                # If this looks like the main index (judjuris.html) and no
                # monthly URLs found, try following the latest year link.
                if not monthly_urls:
                    year_url = self._discover_latest_year_url(soup, endpoint_url)
                    if year_url:
                        try:
                            yr_resp = self._fetch_with_retry(client, year_url)
                            if yr_resp.status_code < 400:
                                yr_html = yr_resp.content.decode(
                                    "windows-1252", errors="replace",
                                )
                                yr_soup = BeautifulSoup(yr_html, "lxml")
                                monthly_urls = self._discover_monthly_urls(
                                    yr_soup, year_url,
                                )
                        except Exception:
                            logger.warning(
                                "Failed to fetch Lawphil year page: %s",
                                year_url,
                                exc_info=True,
                            )

                # Follow the most recent monthly pages.
                for monthly_url in monthly_urls[:_MAX_MONTHLY_PAGES]:
                    try:
                        m_resp = self._fetch_with_retry(client, monthly_url)
                        if m_resp.status_code >= 400:
                            continue
                        m_html = m_resp.content.decode(
                            "windows-1252", errors="replace",
                        )
                        m_soup = BeautifulSoup(m_html, "lxml")
                        m_table = m_soup.find("table", id="s-menu")
                        if m_table:
                            monthly_cands = self._parse_monthly_table(
                                m_table, monthly_url,
                            )
                            candidates.extend(monthly_cands)
                    except Exception:
                        logger.warning(
                            "Failed to fetch Lawphil monthly page: %s",
                            monthly_url,
                            exc_info=True,
                        )
                        continue

        logger.info(
            "Discovered %d candidates from Lawphil: %s",
            len(candidates),
            endpoint_url,
        )
        return candidates

    def fetch_content(self, url: str) -> FetchedContent:
        """Download an individual Lawphil document page."""
        self._validate_url(url)
        with self._get_client() as client:
            response = self._fetch_with_retry(client, url)
            response.raise_for_status()

        # Decode from windows-1252
        html_text = response.content.decode("windows-1252", errors="replace")

        return FetchedContent(
            url=url,
            html=html_text,
            content_type=response.headers.get("content-type", "text/html"),
            status_code=response.status_code,
            fetched_at=datetime.now(UTC).isoformat(),
        )

    # ------------------------------------------------------------------
    # Page-level parsers
    # ------------------------------------------------------------------

    def _parse_monthly_table(
        self,
        table: Tag,
        base_url: str,
    ) -> list[CandidateDoc]:
        """Parse all ``tr.xy`` rows from a monthly ``table#s-menu``."""
        candidates: list[CandidateDoc] = []
        seen_urls: set[str] = set()

        rows = table.find_all("tr", class_="xy")
        for row in rows:
            try:
                candidate = self._parse_table_row(row, base_url, seen_urls)
                if candidate:
                    candidates.append(candidate)
            except Exception:
                logger.warning("Failed to parse Lawphil table row", exc_info=True)
                continue

        return candidates

    @staticmethod
    def _discover_monthly_urls(
        soup: BeautifulSoup,
        base_url: str,
    ) -> list[str]:
        """Find monthly page links on a year index page.

        Year index pages have links like ``jan2025/jan2025.html``.
        Returns URLs sorted with the most recent month first.
        """
        month_order = {
            "jan": 1, "feb": 2, "mar": 3, "apr": 4,
            "may": 5, "jun": 6, "jul": 7, "aug": 8,
            "sep": 9, "oct": 10, "nov": 11, "dec": 12,
        }
        urls: list[tuple[int, str]] = []
        seen: set[str] = set()

        for link in soup.find_all("a", href=True):
            raw_href = str(link.get("href", ""))
            if not _MONTHLY_PAGE_PATTERN.search(raw_href):
                continue
            href = (
                raw_href
                if raw_href.startswith("http")
                else urljoin(base_url, raw_href)
            )
            if href in seen:
                continue
            seen.add(href)

            # Extract month for sorting (e.g., "jan" from "jan2025.html")
            m = re.search(r"([a-z]{3})\d{4}\.html$", href, re.IGNORECASE)
            month_num = month_order.get(m.group(1).lower(), 0) if m else 0
            urls.append((month_num, href))

        # Sort descending by month number (most recent first).
        urls.sort(key=lambda x: x[0], reverse=True)
        return [url for _, url in urls]

    @staticmethod
    def _discover_latest_year_url(
        soup: BeautifulSoup,
        base_url: str,
    ) -> str | None:
        """Find the most recent year index link on the main judjuris page.

        The main index (``judjuris.html``) has links like
        ``juri2025/juri2025.html``.
        """
        best_year = 0
        best_url: str | None = None

        for link in soup.find_all("a", href=True):
            raw_href = str(link.get("href", ""))
            m = _YEAR_INDEX_PATTERN.search(raw_href)
            if not m:
                continue
            year = int(m.group(1))
            if year > best_year:
                best_year = year
                href = (
                    raw_href
                    if raw_href.startswith("http")
                    else urljoin(base_url, raw_href)
                )
                best_url = href

        return best_url

    # ------------------------------------------------------------------
    # Row-level parsers
    # ------------------------------------------------------------------

    def _parse_table_row(
        self,
        row: Tag,
        base_url: str,
        seen_urls: set[str],
    ) -> CandidateDoc | None:
        """Extract candidate info from a ``tr.xy`` row.

        Expected structure::

            <tr class="xy">
              <td>
                <a href="gr_259337_2025.html">G.R.No. 259337</a>
                <br />November 25, 2025
              </td>
              <td>
                Plaintiff <vs>vs.</vs> Defendant
              </td>
              <td>  <!-- optional PDF link -->
                <a href="pdf/gr_259337_2025.pdf"><img ...></a>
              </td>
            </tr>
        """
        cells = row.find_all("td")
        if len(cells) < 2:
            return None

        # First cell: case number link + date
        first_cell = cells[0]
        link = first_cell.find("a", href=True)
        if not link:
            return None

        raw_href = str(link.get("href", ""))
        if not raw_href:
            return None

        # Skip links using xref= attribute (not yet published)
        if link.get("xref") and not link.get("href"):
            return None
        # Some links use class="nya" with xref instead of href
        if "nya" in (link.get("class") or []) and link.get("xref"):
            return None

        href = raw_href if raw_href.startswith("http") else urljoin(base_url, raw_href)

        if href in seen_urls:
            return None
        seen_urls.add(href)

        # Case number from link text
        case_number = link.get_text(strip=True)
        gr_no = self._normalize_case_number(case_number)

        # Date from text after <br> in first cell
        decision_date = self._extract_date(first_cell.get_text(" ", strip=True))

        # Case title from second cell
        title = cells[1].get_text(" ", strip=True) if len(cells) > 1 else ""

        if not title and not case_number:
            return None

        # Detect document type from case number
        document_type = self._detect_document_type_from_case(case_number)

        return CandidateDoc(
            url=href,
            title=title or case_number,
            gr_no=gr_no,
            document_type=document_type,
            decision_date=decision_date,
        )

    def _parse_link(
        self,
        link: Tag,
        base_url: str,
        seen_urls: set[str],
    ) -> CandidateDoc | None:
        """Fallback: extract candidate info from a link element."""
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

        document_type = self._detect_document_type(raw_href)
        gr_no = self._extract_gr_no(title)
        decision_date = self._extract_date(title)

        return CandidateDoc(
            url=raw_href,
            title=title,
            gr_no=gr_no,
            document_type=document_type,
            decision_date=decision_date,
        )

    # ------------------------------------------------------------------
    # Static extraction helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _normalize_case_number(text: str) -> str | None:
        """Normalize case number to canonical format."""
        if not text:
            return None
        # G.R. No. patterns
        match = re.search(r"(?i)G\.?\s*R\.?\s*(?:No\.?\s*)?(\S+)", text)
        if match:
            return f"G.R. No. {match.group(1)}"
        # A.M. No. patterns
        match = re.search(r"(?i)A\.?\s*M\.?\s*(?:No\.?\s*)?(\S+)", text)
        if match:
            return f"A.M. No. {match.group(1)}"
        # A.C. No. patterns
        match = re.search(r"(?i)A\.?\s*C\.?\s*(?:No\.?\s*)?(\S+)", text)
        if match:
            return f"A.C. No. {match.group(1)}"
        return text.strip() if text.strip() else None

    @staticmethod
    def _detect_document_type_from_case(case_number: str) -> str:
        """Detect document type from case number prefix."""
        upper = case_number.upper()
        if upper.startswith("G.R") or upper.startswith("GR"):
            return "decision"
        if upper.startswith("A.M") or upper.startswith("AM"):
            return "administrative_matter"
        if upper.startswith("A.C") or upper.startswith("AC"):
            return "administrative_case"
        return "decision"

    @staticmethod
    def _is_legal_document_link(href: str, title: str) -> bool:
        """Filter for links that point to actual legal documents."""
        href_lower = href.lower()

        if "lawphil.net" not in href_lower and not href_lower.startswith("/"):
            return False

        legal_paths = (
            "/judjuris/",
            "/statutes/",
            "/executive/",
            "/jurisprudence/",
            "/laws/",
        )
        if any(p in href_lower for p in legal_paths):
            return True

        if href_lower.endswith(".html") or href_lower.endswith(".htm"):
            return not any(
                k in href_lower
                for k in ("index", "menu", "search", "about", "contact", "judjuris.html")
            )

        return False

    @staticmethod
    def _detect_document_type(href: str) -> str:
        """Detect document type from Lawphil URL path."""
        href_lower = href.lower()
        if "/judjuris/" in href_lower or "/jurisprudence/" in href_lower:
            return "decision"
        if "/statutes/" in href_lower:
            return "statute"
        if "/executive/" in href_lower:
            return "executive_order"
        return "decision"

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
