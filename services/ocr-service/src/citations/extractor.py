"""LIBERTASIAN OCR Service — Philippine legal citation extraction and normalization.

Extracts and normalizes Philippine legal citations from OCR text:
- G.R. No. (Supreme Court case numbers)
- R.A. No. (Republic Acts)
- P.D. No. (Presidential Decrees)
- E.O. No. (Executive Orders)
- A.M. No. (Administrative Matters)
- A.C. No. (Administrative Cases)
- B.P. Blg. (Batas Pambansa)
- C.A. No. (Commonwealth Acts)
- SCRA / Phil. Reports references

Per CLAUDE.md: normalize "G.R. No." variations (GR, G.R., GRN) to canonical format.
"""

import re
from dataclasses import dataclass

from ..schemas import CitationExtractionResult


@dataclass(frozen=True)
class _CitationPattern:
    """A citation regex pattern with its canonical prefix for normalization."""

    regex: re.Pattern[str]
    canonical_prefix: str


# ── Citation Patterns ─────────────────────────────────────────────────────
# Each pattern matches common OCR variations and normalizes to canonical form.

_PATTERNS: list[_CitationPattern] = [
    # G.R. No. — Supreme Court case numbers (most common)
    _CitationPattern(
        re.compile(
            r"(?:G\.?\s*R\.?|GR|GRN)\s*(?:No\.?\s*|#\s*)"
            r"([\dLl][\d\-LlSs]*(?:\s*[-&,]\s*[\d\-LlSs]+)*)",
            re.IGNORECASE,
        ),
        "G.R. No.",
    ),
    # A.M. No. — Administrative Matters
    _CitationPattern(
        re.compile(
            r"(?:A\.?\s*M\.?)\s*(?:No\.?\s*|#\s*)"
            r"([\d\-]+(?:\s*[-&,]\s*[\d\-]+)*)",
            re.IGNORECASE,
        ),
        "A.M. No.",
    ),
    # A.C. No. — Administrative Cases
    _CitationPattern(
        re.compile(
            r"(?:A\.?\s*C\.?)\s*(?:No\.?\s*|#\s*)"
            r"([\d\-]+(?:\s*[-&,]\s*[\d\-]+)*)",
            re.IGNORECASE,
        ),
        "A.C. No.",
    ),
    # R.A. No. / Republic Act No.
    _CitationPattern(
        re.compile(
            r"(?:R\.?\s*A\.?|Republic\s+Act)\s*(?:No\.?\s*|#\s*)"
            r"(\d+(?:\s*[-&,]\s*\d+)*)",
            re.IGNORECASE,
        ),
        "R.A. No.",
    ),
    # P.D. No. / Presidential Decree No.
    _CitationPattern(
        re.compile(
            r"(?:P\.?\s*D\.?|Presidential\s+Decree)\s*(?:No\.?\s*|#\s*)"
            r"(\d+(?:\s*[-&,]\s*\d+)*)",
            re.IGNORECASE,
        ),
        "P.D. No.",
    ),
    # E.O. No. / Executive Order No.
    _CitationPattern(
        re.compile(
            r"(?:E\.?\s*O\.?|Executive\s+Order)\s*(?:No\.?\s*|#\s*)"
            r"(\d+(?:\s*[-&,]\s*\d+)*)",
            re.IGNORECASE,
        ),
        "E.O. No.",
    ),
    # B.P. Blg. / Batas Pambansa Blg.
    _CitationPattern(
        re.compile(
            r"(?:B\.?\s*P\.?\s*(?:Blg\.?)?|Batas\s+Pambansa\s*(?:Blg\.?)?)\s*(?:No\.?\s*|#\s*)?"
            r"(\d+(?:\s*[-&,]\s*\d+)*)",
            re.IGNORECASE,
        ),
        "B.P. Blg.",
    ),
    # C.A. No. / Commonwealth Act No.
    _CitationPattern(
        re.compile(
            r"(?:C\.?\s*A\.?|Commonwealth\s+Act)\s*(?:No\.?\s*|#\s*)"
            r"(\d+(?:\s*[-&,]\s*\d+)*)",
            re.IGNORECASE,
        ),
        "C.A. No.",
    ),
    # A.O. No. / Administrative Order
    _CitationPattern(
        re.compile(
            r"(?:A\.?\s*O\.?|Administrative\s+Order)\s*(?:No\.?\s*|#\s*)"
            r"(\d+(?:\s*[-&,]\s*\d+)*)",
            re.IGNORECASE,
        ),
        "A.O. No.",
    ),
    # D.O. No. / Department Order
    _CitationPattern(
        re.compile(
            r"(?:D\.?\s*O\.?|Department\s+Order)\s*(?:No\.?\s*|#\s*)"
            r"(\d+(?:\s*[-&,]\s*\d+)*)",
            re.IGNORECASE,
        ),
        "D.O. No.",
    ),
    # M.C. No. / Memorandum Circular
    _CitationPattern(
        re.compile(
            r"(?:M\.?\s*C\.?|Memorandum\s+Circular)\s*(?:No\.?\s*|#\s*)"
            r"(\d+(?:\s*[-&,]\s*\d+)*)",
            re.IGNORECASE,
        ),
        "M.C. No.",
    ),
    # SCRA citations: e.g., "123 SCRA 456"
    _CitationPattern(
        re.compile(
            r"(\d+)\s+S\.?\s*C\.?\s*R\.?\s*A\.?\s+(\d+)",
            re.IGNORECASE,
        ),
        "SCRA",
    ),
    # Phil. Reports: e.g., "123 Phil. 456" or "123 Phil 456"
    _CitationPattern(
        re.compile(
            r"(\d+)\s+Phil\.?\s+(\d+)",
            re.IGNORECASE,
        ),
        "Phil.",
    ),
]


def _normalize_number(number_str: str) -> str:
    """Clean up extracted number string.

    Removes extra whitespace around separators, normalizes L/l suffixes.
    """
    # Collapse whitespace
    result = re.sub(r"\s+", " ", number_str.strip())
    # Replace lowercase 'l' with 'L' (OCR sometimes confuses 1 and l)
    result = result.replace("l", "L")
    return result


def extract_citations(text: str) -> CitationExtractionResult:
    """Extract and normalize Philippine legal citations from text.

    Scans the full text for citation patterns, extracts both the raw
    matched text and a normalized canonical form.

    Args:
        text: OCR-extracted document text.

    Returns:
        CitationExtractionResult with raw and normalized citation lists.
    """
    if not text or len(text.strip()) < 10:
        return CitationExtractionResult(
            citations=[],
            normalized_citations=[],
        )

    raw_citations: list[str] = []
    normalized_citations: list[str] = []
    seen_normalized: set[str] = set()

    for pattern in _PATTERNS:
        for match in pattern.regex.finditer(text):
            raw = match.group(0).strip()

            # Build normalized form
            if pattern.canonical_prefix in ("SCRA", "Phil."):
                # For reporter citations: "VOL REPORTER PAGE"
                groups = match.groups()
                if len(groups) >= 2:
                    normalized = f"{groups[0]} {pattern.canonical_prefix} {groups[1]}"
                else:
                    normalized = raw
            else:
                number = _normalize_number(match.group(1))
                normalized = f"{pattern.canonical_prefix} {number}"

            # Deduplicate by normalized form
            if normalized in seen_normalized:
                continue
            seen_normalized.add(normalized)

            raw_citations.append(raw)
            normalized_citations.append(normalized)

    return CitationExtractionResult(
        citations=raw_citations,
        normalized_citations=normalized_citations,
    )
