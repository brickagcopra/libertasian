"""LIBERTASIAN Worker Service — HTML content parser for legal documents.

Strips browser chrome from fetched HTML, extracts the main legal content,
and splits it into sections matching the legal_document_sections schema.
"""

from __future__ import annotations

import logging
import re
from typing import Any

from bs4 import BeautifulSoup, Tag

logger = logging.getLogger(__name__)

# Section type identifiers matching legal_document_sections.section_type
SECTION_TYPES = [
    "headnote",
    "syllabus",
    "facts",
    "issues",
    "ruling",
    "dispositive",
    "concurring",
    "dissenting",
    "body",
]

# Regex patterns for detecting section boundaries in Philippine legal documents
SECTION_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("headnote", re.compile(r"(?i)^\s*(HEADNOTE|HEAD\s*NOTE)\s*$", re.MULTILINE)),
    ("syllabus", re.compile(r"(?i)^\s*(SYLLABUS|SYLLABI)\s*$", re.MULTILINE)),
    (
        "facts",
        re.compile(
            r"(?i)^\s*(THE\s+FACTS|ANTECEDENT\s+FACTS|FACTUAL\s+BACKGROUND"
            r"|STATEMENT\s+OF\s+(?:THE\s+)?FACTS?)\s*$",
            re.MULTILINE,
        ),
    ),
    (
        "issues",
        re.compile(
            r"(?i)^\s*((?:THE\s+)?ISSUES?|ISSUES?\s+(?:RAISED|PRESENTED|FOR\s+RESOLUTION)"
            r"|STATEMENT\s+OF\s+(?:THE\s+)?ISSUES?)\s*$",
            re.MULTILINE,
        ),
    ),
    (
        "ruling",
        re.compile(
            r"(?i)^\s*((?:THE\s+COURT[''S]*\s+)?RULING|(?:OUR|THE)\s+RULING"
            r"|DISCUSSION|RATIO\s+DECIDENDI|THE\s+COURT\s+RULED)\s*$",
            re.MULTILINE,
        ),
    ),
    (
        "dispositive",
        re.compile(
            r"(?i)^\s*(WHEREFORE|DISPOSITIVE\s+PORTION|FALLO"
            r"|IN\s+VIEW\s+(?:OF\s+THE\s+)?FOREGOING"
            r"|PREMISES\s+CONSIDERED)\b",
            re.MULTILINE,
        ),
    ),
    (
        "concurring",
        re.compile(r"(?i)^\s*(CONCURRING\s+OPINION)\s*$", re.MULTILINE),
    ),
    (
        "dissenting",
        re.compile(r"(?i)^\s*(DISSENTING\s+OPINION)\s*$", re.MULTILINE),
    ),
]


def parse_legal_document(html: str, document_type: str = "decision") -> str:
    """Strip browser chrome from HTML and extract main legal content.

    Args:
        html: Raw HTML string from fetcher.
        document_type: Type of document (decision, statute, etc.).

    Returns:
        Cleaned plain text of the legal document.
    """
    soup = BeautifulSoup(html, "lxml")

    # Remove non-content elements
    for tag_name in ("script", "style", "nav", "header", "footer", "aside", "iframe"):
        for tag in soup.find_all(tag_name):
            tag.decompose()

    # Try to find the main content container
    main_content = _find_main_content(soup)

    if main_content:
        text = main_content.get_text("\n", strip=True)
    else:
        # Fallback: use body or entire document
        body = soup.find("body")
        text = body.get_text("\n", strip=True) if body else soup.get_text("\n", strip=True)

    # Clean up the extracted text
    text = _clean_text(text)

    return text


def extract_sections(
    text: str,
    document_type: str = "decision",
) -> list[dict[str, Any]]:
    """Split legal document text into sections.

    Uses Philippine legal formatting patterns to identify section boundaries.
    Returns a list of section dicts matching the legal_document_sections schema.

    Args:
        text: Cleaned plain text of the legal document.
        document_type: Type of document (affects section detection strategy).

    Returns:
        List of section dicts with keys: section_type, section_label,
        plain_text, ordering, token_count.
    """
    if document_type in ("statute", "executive_order", "republic_act"):
        return _extract_statute_sections(text)

    return _extract_decision_sections(text)


def _find_main_content(soup: BeautifulSoup) -> Tag | None:
    """Heuristic search for the main content container."""
    # Try common content container selectors
    selectors = [
        "article",
        "[role='main']",
        "main",
        ".decision-text",
        ".case-body",
        ".document-content",
        "#content",
        "#main-content",
        ".content",
        "#case-text",
    ]

    for selector in selectors:
        element = soup.select_one(selector)
        if element and len(element.get_text(strip=True)) > 200:
            return element

    # Fallback: find the largest text-containing div
    best: Tag | None = None
    best_len = 0
    for div in soup.find_all("div"):
        text_len = len(div.get_text(strip=True))
        if text_len > best_len:
            best_len = text_len
            best = div

    if best and best_len > 500:
        return best

    return None


def _clean_text(text: str) -> str:
    """Clean extracted text: normalize whitespace, remove artifacts."""
    # Normalize line endings
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    # Collapse multiple spaces (not newlines) to single space
    text = re.sub(r"[^\S\n]+", " ", text)
    # Strip trailing spaces per line
    text = re.sub(r" +\n", "\n", text)
    # Collapse 3+ consecutive newlines to 2
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _extract_decision_sections(text: str) -> list[dict[str, Any]]:
    """Extract sections from a court decision using heading patterns."""
    sections: list[dict[str, Any]] = []

    # Find all section boundaries
    boundaries: list[tuple[int, str, str]] = []  # (position, section_type, label)

    for section_type, pattern in SECTION_PATTERNS:
        for match in pattern.finditer(text):
            boundaries.append((match.start(), section_type, match.group(0).strip()))

    # Sort by position
    boundaries.sort(key=lambda b: b[0])

    if not boundaries:
        # No sections detected — treat entire document as single body section
        word_count = len(text.split())
        return [
            {
                "section_type": "body",
                "section_label": None,
                "plain_text": text,
                "ordering": 0,
                "token_count": _estimate_tokens(word_count),
            }
        ]

    # If first boundary isn't at the start, create a preamble section
    if boundaries[0][0] > 100:
        preamble_text = text[: boundaries[0][0]].strip()
        if preamble_text:
            word_count = len(preamble_text.split())
            sections.append(
                {
                    "section_type": "headnote",
                    "section_label": "Preamble",
                    "plain_text": preamble_text,
                    "ordering": 0,
                    "token_count": _estimate_tokens(word_count),
                }
            )

    # Extract sections between boundaries
    for i, (pos, section_type, label) in enumerate(boundaries):
        # End position is start of next boundary or end of text
        end_pos = boundaries[i + 1][0] if i + 1 < len(boundaries) else len(text)
        section_text = text[pos:end_pos].strip()

        # Remove the heading line itself from the body text
        lines = section_text.split("\n", 1)
        body_text = lines[1].strip() if len(lines) > 1 else ""

        if not body_text:
            continue

        word_count = len(body_text.split())
        sections.append(
            {
                "section_type": section_type,
                "section_label": label,
                "plain_text": body_text,
                "ordering": len(sections),
                "token_count": _estimate_tokens(word_count),
            }
        )

    return sections


def _extract_statute_sections(text: str) -> list[dict[str, Any]]:
    """Extract sections from statutes/legislation using article/section patterns."""
    sections: list[dict[str, Any]] = []

    # Match SECTION N. or SEC. N. or ARTICLE N. patterns
    pattern = re.compile(
        r"(?i)^\s*((?:SECTION|SEC\.?|ARTICLE|ART\.?)\s+\d+[A-Z]?\.?)\s*[.\-–—]?\s*(.*?)$",
        re.MULTILINE,
    )

    boundaries: list[tuple[int, str]] = []
    for match in pattern.finditer(text):
        boundaries.append((match.start(), match.group(1).strip()))

    if not boundaries:
        word_count = len(text.split())
        return [
            {
                "section_type": "body",
                "section_label": None,
                "plain_text": text,
                "ordering": 0,
                "token_count": _estimate_tokens(word_count),
            }
        ]

    # Preamble before first section
    if boundaries[0][0] > 50:
        preamble = text[: boundaries[0][0]].strip()
        if preamble:
            word_count = len(preamble.split())
            sections.append(
                {
                    "section_type": "headnote",
                    "section_label": "Title/Preamble",
                    "plain_text": preamble,
                    "ordering": 0,
                    "token_count": _estimate_tokens(word_count),
                }
            )

    for i, (pos, label) in enumerate(boundaries):
        end_pos = boundaries[i + 1][0] if i + 1 < len(boundaries) else len(text)
        section_text = text[pos:end_pos].strip()
        word_count = len(section_text.split())

        sections.append(
            {
                "section_type": "body",
                "section_label": label,
                "plain_text": section_text,
                "ordering": len(sections),
                "token_count": _estimate_tokens(word_count),
            }
        )

    return sections


def _estimate_tokens(word_count: int) -> int:
    """Rough token estimate: ~1.3 tokens per word for English legal text."""
    return int(word_count * 1.3)
