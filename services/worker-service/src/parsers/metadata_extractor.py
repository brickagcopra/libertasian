"""LIBERTASIAN Worker Service — Metadata extraction from legal document text.

Uses regex patterns to extract structured metadata (GR number, decision date,
ponente, court, citation text) from Philippine legal documents.
"""

from __future__ import annotations

import logging
import re
from typing import Any

logger = logging.getLogger(__name__)

# ─── Philippine Legal Citation Patterns ──────────────────────────────────

# G.R. No. patterns (Supreme Court decisions)
GR_NO_PATTERN = re.compile(
    r"(?i)G\.?\s*R\.?\s*(?:No\.?\s*)?(L-?\d+|\d[\d\-]+(?:\s*&\s*\d[\d\-]+)*)"
)

# A.M. No. patterns (Administrative matters)
AM_NO_PATTERN = re.compile(
    r"(?i)A\.?\s*M\.?\s*(?:No\.?\s*)?(\d[\d\-]+(?:-\w+)*)"
)

# A.C. No. patterns (Attorney/counsel matters)
AC_NO_PATTERN = re.compile(
    r"(?i)A\.?\s*C\.?\s*(?:No\.?\s*)?(\d[\d\-]+)"
)

# R.A. No. patterns (Republic Acts)
RA_NO_PATTERN = re.compile(
    r"(?i)R\.?\s*A\.?\s*(?:No\.?\s*)?(\d[\d\-]+)"
)

# P.D. No. patterns (Presidential Decrees)
PD_NO_PATTERN = re.compile(
    r"(?i)P\.?\s*D\.?\s*(?:No\.?\s*)?(\d[\d\-]+)"
)

# E.O. No. patterns (Executive Orders)
EO_NO_PATTERN = re.compile(
    r"(?i)E\.?\s*O\.?\s*(?:No\.?\s*)?(\d[\d\-]+)"
)

# ─── Date Patterns ───────────────────────────────────────────────────────

# "January 15, 2024" or "January 15 2024"
LONG_DATE_PATTERN = re.compile(
    r"(?:January|February|March|April|May|June|July|August|September|October"
    r"|November|December)\s+\d{1,2},?\s+\d{4}",
    re.IGNORECASE,
)

# "15 January 2024"
REVERSED_DATE_PATTERN = re.compile(
    r"\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September"
    r"|October|November|December)\s+\d{4}",
    re.IGNORECASE,
)

# ISO format: 2024-01-15
ISO_DATE_PATTERN = re.compile(r"\d{4}-\d{2}-\d{2}")

# ─── Ponente/Justice Patterns ────────────────────────────────────────────

PONENTE_PATTERN = re.compile(
    r"(?i)(?:^|\n)\s*(?:PONENTE|PER)\s*[:\s]+\s*(?:(?:Chief\s+)?Justice\s+)?"
    r"([A-Z][A-Za-z\s,.\-']+?)(?:\s*,\s*J\.?)?(?:\s*[:;\n])",
)

# Alternative: "CARPIO, J.:" at start of opinion.
# Loosened from [A-Z][A-Z\s,.\-'] to [A-Z][A-Za-z\s,.\-'] so mixed-case
# names like "Velasco, Jr." match.
JUSTICE_PATTERN = re.compile(
    r"(?:^|\n)\s*([A-Z][A-Za-z\s,.\-']+?)\s*,\s*J\.?\s*[:\s]*(?:\n|$)",
)

# Spaced-out "D E C I S I O N" / "R E S O L U T I O N" header followed by
# the justice's name on the same or following line. Decisions in the prod
# corpus routinely use this layout — and the previous extractor returned
# strings like "D E C I S I O N PERALTA" verbatim because no header
# pattern recognised it (~834 affected rows on prod, plus full-caption
# false positives that bled into the title).
DECISION_HEADER_PATTERN = re.compile(
    r"(?i)(?:D\s*E\s*C\s*I\s*S\s*I\s*O\s*N|R\s*E\s*S\s*O\s*L\s*U\s*T\s*I\s*O\s*N)\s*"
    r"[\n\s]+([A-Z][A-Z .'\-]+(?:,\s*J[Rr]\.?)?(?:,\s*S[Rr]\.?)?)\s*(?:,\s*J\.?)?\s*(?:[:;\n]|$)",
)

# ─── Court Patterns ──────────────────────────────────────────────────────

COURT_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    (
        "Supreme Court",
        re.compile(r"(?i)SUPREME\s+COURT", re.IGNORECASE),
    ),
    (
        "Court of Appeals",
        re.compile(r"(?i)COURT\s+OF\s+APPEALS", re.IGNORECASE),
    ),
    (
        "Sandiganbayan",
        re.compile(r"(?i)SANDIGANBAYAN", re.IGNORECASE),
    ),
    (
        "Court of Tax Appeals",
        re.compile(r"(?i)COURT\s+OF\s+TAX\s+APPEALS", re.IGNORECASE),
    ),
    (
        "Regional Trial Court",
        re.compile(r"(?i)REGIONAL\s+TRIAL\s+COURT|RTC", re.IGNORECASE),
    ),
]


def extract_metadata(
    text: str,
    source_type: str = "decision",
) -> dict[str, Any]:
    """Extract structured metadata from legal document text.

    Args:
        text: Plain text of the legal document.
        source_type: Type of document (decision, statute, etc.).

    Returns:
        Dict with keys: title, gr_no, decision_date, ponente, court,
        document_type, citation_text, docket_no.
    """
    # Use first 3000 chars for metadata extraction (header area)
    header_text = text[:3000]

    result: dict[str, Any] = {
        "title": _extract_title(header_text),
        "gr_no": None,
        "docket_no": None,
        "decision_date": None,
        "ponente": None,
        "court": None,
        "document_type": source_type,
        "citation_text": None,
    }

    # Extract case numbers
    gr_match = GR_NO_PATTERN.search(header_text)
    if gr_match:
        result["gr_no"] = f"G.R. No. {gr_match.group(1)}"

    am_match = AM_NO_PATTERN.search(header_text)
    if am_match and not result["gr_no"]:
        result["gr_no"] = f"A.M. No. {am_match.group(1)}"

    ac_match = AC_NO_PATTERN.search(header_text)
    if ac_match and not result["gr_no"]:
        result["gr_no"] = f"A.C. No. {ac_match.group(1)}"

    # For statutes, use RA/PD/EO numbers as docket
    if source_type in ("statute", "republic_act"):
        ra_match = RA_NO_PATTERN.search(header_text)
        if ra_match:
            result["docket_no"] = f"R.A. No. {ra_match.group(1)}"
    elif source_type == "executive_order":
        eo_match = EO_NO_PATTERN.search(header_text)
        if eo_match:
            result["docket_no"] = f"E.O. No. {eo_match.group(1)}"

    # Extract date
    result["decision_date"] = _extract_date(header_text)

    # Extract ponente
    result["ponente"] = _extract_ponente(header_text)

    # Extract court
    result["court"] = _extract_court(header_text)

    # Build citation text
    result["citation_text"] = _build_citation(result)

    return result


def _extract_title(text: str) -> str | None:
    """Extract the case title (e.g., 'People v. Dela Cruz')."""
    # Look for "X vs. Y" or "X v. Y" patterns
    vs_pattern = re.compile(
        r"(?:^|\n)\s*([A-Z][A-Za-z\s,.'\-]+?)\s+"
        r"(?:vs?\.?|versus)\s+"
        r"([A-Z][A-Za-z\s,.'\-]+?)(?:\s*\n|,\s*G\.?\s*R)",
        re.IGNORECASE,
    )
    match = vs_pattern.search(text)
    if match:
        title = f"{match.group(1).strip()} vs. {match.group(2).strip()}"
        # Clean up excessive whitespace
        title = re.sub(r"\s+", " ", title)
        return title[:500]  # Respect DB VarChar(500)

    # Fallback: first substantive non-empty line
    for line in text.split("\n"):
        line = line.strip()
        if len(line) > 20 and not line.startswith(("http", "www", "<")):
            return line[:500]

    return None


def _extract_date(text: str) -> str | None:
    """Extract decision/promulgation date from document header."""
    # Try long date format first (most common in PH legal docs)
    match = LONG_DATE_PATTERN.search(text)
    if match:
        return match.group(0)

    match = REVERSED_DATE_PATTERN.search(text)
    if match:
        return match.group(0)

    match = ISO_DATE_PATTERN.search(text)
    if match:
        return match.group(0)

    return None


def _extract_ponente(text: str) -> str | None:
    """Extract the ponente (writing Justice) from document header."""
    match = PONENTE_PATTERN.search(text)
    if match:
        cleaned = _clean_justice_name(match.group(1).strip())
        if cleaned:
            return cleaned

    # The "D E C I S I O N <NAME>" header is common in lawphil dumps and
    # is checked before the bare-name JUSTICE_PATTERN because the latter
    # tends to match the full case caption when the spaced-out decision
    # header is in the way.
    match = DECISION_HEADER_PATTERN.search(text)
    if match:
        cleaned = _clean_justice_name(match.group(1).strip())
        if cleaned:
            return cleaned

    match = JUSTICE_PATTERN.search(text)
    if match:
        cleaned = _clean_justice_name(match.group(1).strip())
        if cleaned:
            return cleaned

    return None


# Tokens that indicate the captured "name" is actually a case caption
# (petitioner-vs-respondent) and not a justice name. When any of these
# appear, _clean_justice_name returns None so the bad string is dropped
# instead of persisted to the legal_documents.ponente column.
_CAPTION_REJECT_TOKENS = (
    " VS ",
    " VS. ",
    " V. ",
    " V ",
    " VERSUS ",
    "PETITIONER",
    "RESPONDENT",
    "PEOPLE OF THE PHILIPPINES",
    "REPUBLIC OF THE PHILIPPINES",
)

# A "D E C I S I O N" / "R E S O L U T I O N" header that slipped through
# the upstream extractor — never a valid ponente name.
_HEADER_NOISE_PATTERN = re.compile(
    r"(?i)D\s*E\s*C\s*I\s*S\s*I\s*O\s*N|R\s*E\s*S\s*O\s*L\s*U\s*T\s*I\s*O\s*N"
)


def _clean_justice_name(name: str) -> str | None:
    """Clean up a justice name extracted from text.

    Returns ``None`` when the input is clearly NOT a ponente name (case
    captions, decision/resolution headers, overlong strings). This guard
    prevents the ~834 prod rows where ponente was persisted as
    "D E C I S I O N PERALTA" / "PEOPLE OF THE PHILIPPINES, ... DECISION".
    """
    # Remove common prefixes
    name = re.sub(r"(?i)^(?:Chief\s+)?Justice\s+", "", name)

    # Strip a trailing justice suffix that the regex left in: ", J.",
    # ", J", ", JR.", ", JR", ", SR.", ", SR".
    name = re.sub(r"(?i),\s*J\.?$", "", name)
    suffix = ""
    suffix_match = re.search(r"(?i),\s*(J[Rr]|S[Rr])\.?$", name)
    if suffix_match:
        # Preserve "JR." / "SR." in the canonical form but normalise.
        suffix = ", " + suffix_match.group(1).upper() + "."
        name = name[: suffix_match.start()]

    # Remove trailing punctuation
    name = name.rstrip(".,;:")
    # Collapse whitespace
    name = re.sub(r"\s+", " ", name).strip()

    if not name:
        return None

    upper = name.upper()
    # Reject case captions and decision/resolution header noise.
    if any(token in upper for token in _CAPTION_REJECT_TOKENS):
        return None
    if _HEADER_NOISE_PATTERN.search(upper):
        return None
    # A real ponente surname (or "FIRSTNAME LASTNAME, JR.") is short.
    # Anything over 60 chars is almost certainly a caption fragment.
    if len(name) + len(suffix) > 60:
        return None

    cleaned = (name + suffix).strip()
    return cleaned[:255] if cleaned else None  # Respect DB VarChar(255)


def _extract_court(text: str) -> str | None:
    """Extract the court name from document header."""
    for court_name, pattern in COURT_PATTERNS:
        if pattern.search(text):
            return court_name
    return None


def _build_citation(metadata: dict[str, Any]) -> str | None:
    """Build a citation string from extracted metadata."""
    parts: list[str] = []

    if metadata.get("gr_no"):
        parts.append(metadata["gr_no"])
    if metadata.get("docket_no") and metadata["docket_no"] != metadata.get("gr_no"):
        parts.append(metadata["docket_no"])
    if metadata.get("decision_date"):
        parts.append(metadata["decision_date"])

    if not parts:
        return None

    citation = ", ".join(parts)
    return citation[:500]  # Respect DB VarChar(500)
