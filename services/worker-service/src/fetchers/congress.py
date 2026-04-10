"""LIBERTASIAN Worker Service — Congress fetcher.

Fetches Philippine Republic Acts and legislation from congress.gov.ph.

IMPORTANT: congress.gov.ph is behind Cloudflare Turnstile (managed challenge).
Simple HTTP requests return 403 with a JavaScript challenge page.  The fetcher
handles this gracefully — if the listing page is blocked, it logs a warning
and returns an empty candidate list rather than crashing.

PDF documents are available without Cloudflare from the CDN:
  https://docs.congress.hrep.online/legisdocs/ra_{congress}/RA{number}.pdf

The HTML listing page (when accessible) uses Bootstrap 3 panels:
  congress.gov.ph/legisdocs/?v=ra  — Republic Acts by Congress session
"""

from __future__ import annotations

import logging
import re
from datetime import UTC, datetime
from urllib.parse import urljoin

from bs4 import BeautifulSoup, Tag

from .base import (
    BaseFetcher,
    CandidateDoc,
    CloudflareBlockedError,
    FetchedContent,
    is_cloudflare_challenge,
)

logger = logging.getLogger(__name__)

# CDN base for direct PDF access (no Cloudflare).
#
# TODO: the panel-layout parser currently skips candidates when the listing
# page doesn't provide an inline PDF link (see `_parse_panel_layout` fallback
# branch that does `continue` without a Congress number). The CDN layout is
# documented as ``{CDN}/ra_{congress}/RA{number}.pdf`` but we don't yet know
# the Congress session number at discovery time. This is orthogonal to the
# Cloudflare blocker — even if Cloudflare lifts, we'd still need to wire the
# Congress-number lookup before we get full coverage from this source.
CONGRESS_PDF_CDN = "https://docs.congress.hrep.online/legisdocs"


class CongressFetcher(BaseFetcher):
    """Fetcher for congress.gov.ph legal documents."""

    def discover(
        self,
        endpoint_url: str,
        last_fetched_at: str | None = None,
    ) -> list[CandidateDoc]:
        """Parse listing pages from the Philippine Congress website.

        Falls back gracefully when Cloudflare blocks the request.
        """
        candidates: list[CandidateDoc] = []

        with self._get_client() as client:
            try:
                response = self._fetch_with_retry(client, endpoint_url)
                if response.status_code == 403:
                    # Check if this is a Cloudflare challenge page
                    if is_cloudflare_challenge(response.text):
                        logger.warning(
                            "Congress.gov.ph returned Cloudflare challenge (403). "
                            "Headless browser required for this source: %s",
                            endpoint_url,
                        )
                        raise CloudflareBlockedError(
                            endpoint_url=endpoint_url,
                            status_code=403,
                            cf_type="managed_challenge",
                        )
                    logger.warning(
                        "Congress returned 403: %s", endpoint_url,
                    )
                    return candidates
                if response.status_code >= 400:
                    logger.warning(
                        "Congress listing returned HTTP %d: %s",
                        response.status_code,
                        endpoint_url,
                    )
                    return candidates
            except CloudflareBlockedError:
                # Let this propagate — caller records it in errors_json.
                raise
            except Exception:
                logger.exception(
                    "Failed to fetch Congress listing: %s", endpoint_url,
                )
                return candidates

        soup = BeautifulSoup(response.text, "lxml")
        seen_urls: set[str] = set()

        # Strategy 1: Bootstrap panel layout (congress.gov.ph/legisdocs/?v=ra)
        panels = soup.find_all("div", class_="panel-heading")
        if panels:
            candidates = self._parse_panel_layout(soup, endpoint_url, seen_urls)
        else:
            # Strategy 2: generic link-based discovery
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

    def _parse_panel_layout(
        self,
        soup: BeautifulSoup,
        base_url: str,
        seen_urls: set[str],
    ) -> list[CandidateDoc]:
        """Parse Bootstrap 3 panel layout used by legisdocs/?v=ra.

        Structure::

            <div class="panel-heading">
              <span class="text-muted text-muted-size">RA11934</span>
              <span class="pull-right">
                <a href="…/ra_19/RA11934.pdf">[PDF, 7382k]</a>
              </span>
            </div>
            <div class="panel-body">
              <p>AN ACT REQUIRING THE REGISTRATION OF …</p>
              <p>…Approved by the President on: October 10, 2022</p>
              <p>…Origin: Senate (SB01310/HB00014)</p>
            </div>
        """
        candidates: list[CandidateDoc] = []

        # Iterate over each panel-heading / panel-body pair
        headings = soup.find_all("div", class_="panel-heading")
        for heading in headings:
            try:
                ra_span = heading.find(
                    "span", class_=lambda c: c and "text-muted" in c,
                )
                if not ra_span:
                    continue

                ra_code = ra_span.get_text(strip=True)
                if not ra_code or not re.match(r"RA\d+", ra_code):
                    continue

                # PDF link
                pdf_link = heading.find("a", href=True)
                href = ""
                if pdf_link:
                    raw_href = str(pdf_link.get("href", ""))
                    href = raw_href if raw_href.startswith("http") else urljoin(base_url, raw_href)

                if not href:
                    # Construct from CDN pattern
                    # Extract RA number
                    ra_match = re.match(r"RA(\d+)", ra_code)
                    if ra_match:
                        # We don't know the Congress number here, skip
                        continue

                if href in seen_urls:
                    continue
                seen_urls.add(href)

                # Parse the panel-body sibling
                body = heading.find_next_sibling("div", class_="panel-body")
                title = ""
                decision_date = None
                if body:
                    paragraphs = body.find_all("p")
                    if paragraphs:
                        title = paragraphs[0].get_text(strip=True)
                    for p in paragraphs:
                        text = p.get_text(strip=True)
                        if "approved" in text.lower():
                            date_match = re.search(
                                r"(?:on:?\s*)(\w+ \d{1,2},?\s*\d{4})",
                                text,
                            )
                            if date_match:
                                decision_date = date_match.group(1)

                ra_no = self._extract_ra_no(ra_code) or ra_code

                candidates.append(
                    CandidateDoc(
                        url=href,
                        title=title or ra_code,
                        gr_no=ra_no,
                        document_type="republic_act",
                        decision_date=decision_date,
                        metadata={"ra_code": ra_code},
                    )
                )

            except Exception:
                logger.warning("Failed to parse Congress panel", exc_info=True)
                continue

        return candidates

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
        ra_no = self._extract_ra_no(title)
        decision_date = self._extract_date(title)

        return CandidateDoc(
            url=raw_href,
            title=title,
            gr_no=ra_no,
            document_type=document_type,
            decision_date=decision_date,
        )

    # ------------------------------------------------------------------
    # Static helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _is_legal_document_link(href: str, title: str) -> bool:
        """Filter for links that point to actual legal documents."""
        href_lower = href.lower()

        # Accept links from both the main site and the PDF CDN
        if not any(
            d in href_lower
            for d in ("congress.gov.ph", "docs.congress.hrep.online", "hrep-website.s3")
        ) and not href_lower.startswith("/"):
            return False

        legal_paths = (
            "/republic-act",
            "/ra-",
            "/ra_",
            "/legisdocs",
            "/bills",
            "/enrolled",
            "/legislation",
            "/legislative-documents",
        )
        if any(p in href_lower for p in legal_paths):
            return True

        # PDF links with RA pattern
        if href_lower.endswith(".pdf") and "ra" in href_lower:
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

        if "republic-act" in href_lower or "republic act" in title_lower or "/ra_" in href_lower:
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
        # Match "RA11934" format
        match = re.search(r"(?i)RA\s*(\d+)", text)
        if match:
            return f"R.A. No. {match.group(1)}"
        # Match "Republic Act No. 11934" format
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
