"""LIBERTASIAN Worker Service — Lawphil fetcher.

Fetches Philippine legal documents from lawphil.net.
Parses index pages to discover jurisprudence and legislation,
then downloads individual document HTML pages.
"""

from __future__ import annotations

import logging
import re
from datetime import UTC, datetime
from urllib.parse import urljoin

from bs4 import BeautifulSoup, Tag

from .base import BaseFetcher, CandidateDoc, FetchedContent

logger = logging.getLogger(__name__)


class LawphilFetcher(BaseFetcher):
    """Fetcher for lawphil.net legal documents."""

    def discover(
        self,
        endpoint_url: str,
        last_fetched_at: str | None = None,
    ) -> list[CandidateDoc]:
        """Parse index pages from lawphil.net.

        Lawphil organizes documents by year and court. Index pages contain
        links to individual decisions/statutes.
        """
        candidates: list[CandidateDoc] = []

        self._rate_limit()
        with self._get_client() as client:
            try:
                response = client.get(endpoint_url)
                response.raise_for_status()
            except Exception:
                logger.exception("Failed to fetch Lawphil listing: %s", endpoint_url)
                return candidates

        soup = BeautifulSoup(response.text, "lxml")
        seen_urls: set[str] = set()

        # Lawphil uses simple HTML with links in lists or tables
        for link in soup.find_all("a", href=True):
            try:
                candidate = self._parse_link(link, endpoint_url, seen_urls)
                if candidate:
                    candidates.append(candidate)
            except Exception:
                logger.warning("Failed to parse Lawphil link", exc_info=True)
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

        # Resolve relative URLs
        if not href.startswith("http"):
            href = urljoin(base_url, href)

        if href in seen_urls:
            return None

        # Filter for relevant document links
        if not self._is_legal_document_link(href, title):
            return None

        seen_urls.add(href)

        # Detect document type from URL path
        document_type = self._detect_document_type(href)

        # Extract GR No. if present
        gr_no = self._extract_gr_no(title)

        # Extract date if present in title
        decision_date = self._extract_date(title)

        return CandidateDoc(
            url=href,
            title=title,
            gr_no=gr_no,
            document_type=document_type,
            decision_date=decision_date,
        )

    @staticmethod
    def _is_legal_document_link(href: str, title: str) -> bool:
        """Filter for links that point to actual legal documents."""
        href_lower = href.lower()

        # Must be on lawphil.net
        if "lawphil.net" not in href_lower and not href_lower.startswith("/"):
            return False

        # Lawphil document URLs typically contain these path segments
        legal_paths = (
            "/judjuris/",
            "/statutes/",
            "/executive/",
            "/jurisprudence/",
            "/laws/",
        )
        if any(p in href_lower for p in legal_paths):
            return True

        # Also match by file extension patterns
        if href_lower.endswith(".html") or href_lower.endswith(".htm"):
            # Exclude navigation/index pages
            return not any(
                k in href_lower
                for k in ("index", "menu", "search", "about", "contact")
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
