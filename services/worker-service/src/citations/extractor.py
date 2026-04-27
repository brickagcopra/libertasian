# Vendored from services/ocr-service/src/citations/extractor.py (authoritative source).
"""LIBERTASIAN Worker Service — Philippine legal citation extraction and normalization.

Extracts and normalizes Philippine legal citations from corpus document text:
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

from pydantic import BaseModel, Field


class CitationExtractionResult(BaseModel):
    """Extracted citations from document text."""

    citations: list[str] = Field(description="List of extracted citation strings")
    normalized_citations: list[str] = Field(description="Normalized citation forms")


@dataclass(frozen=True)
class _CitationPattern:
    """A citation regex pattern with its canonical prefix for normalization."""

    regex: re.Pattern[str]
    canonical_prefix: str


_PATTERNS: list[_CitationPattern] = [
    _CitationPattern(
        re.compile(
            r"(?:G\.?\s*R\.?|GR|GRN)\s*(?:No\.?\s*|#\s*)"
            r"([\dLl][\d\-LlSs]*(?:\s*[-&,]\s*[\d\-LlSs]+)*)",
            re.IGNORECASE,
        ),
        "G.R. No.",
    ),
    _CitationPattern(
        re.compile(
            r"(?:A\.?\s*M\.?)\s*(?:No\.?\s*|#\s*)"
            r"([\d\-]+(?:\s*[-&,]\s*[\d\-]+)*)",
            re.IGNORECASE,
        ),
        "A.M. No.",
    ),
    _CitationPattern(
        re.compile(
            r"(?:A\.?\s*C\.?)\s*(?:No\.?\s*|#\s*)"
            r"([\d\-]+(?:\s*[-&,]\s*[\d\-]+)*)",
            re.IGNORECASE,
        ),
        "A.C. No.",
    ),
    _CitationPattern(
        re.compile(
            r"(?:R\.?\s*A\.?|Republic\s+Act)\s*(?:No\.?\s*|#\s*)"
            r"(\d+(?:\s*[-&,]\s*\d+)*)",
            re.IGNORECASE,
        ),
        "R.A. No.",
    ),
    _CitationPattern(
        re.compile(
            r"(?:P\.?\s*D\.?|Presidential\s+Decree)\s*(?:No\.?\s*|#\s*)"
            r"(\d+(?:\s*[-&,]\s*\d+)*)",
            re.IGNORECASE,
        ),
        "P.D. No.",
    ),
    _CitationPattern(
        re.compile(
            r"(?:E\.?\s*O\.?|Executive\s+Order)\s*(?:No\.?\s*|#\s*)"
            r"(\d+(?:\s*[-&,]\s*\d+)*)",
            re.IGNORECASE,
        ),
        "E.O. No.",
    ),
    _CitationPattern(
        re.compile(
            r"(?:B\.?\s*P\.?\s*(?:Blg\.?)?|Batas\s+Pambansa\s*(?:Blg\.?)?)\s*(?:No\.?\s*|#\s*)?"
            r"(\d+(?:\s*[-&,]\s*\d+)*)",
            re.IGNORECASE,
        ),
        "B.P. Blg.",
    ),
    _CitationPattern(
        re.compile(
            r"(?:C\.?\s*A\.?|Commonwealth\s+Act)\s*(?:No\.?\s*|#\s*)"
            r"(\d+(?:\s*[-&,]\s*\d+)*)",
            re.IGNORECASE,
        ),
        "C.A. No.",
    ),
    _CitationPattern(
        re.compile(
            r"(?:A\.?\s*O\.?|Administrative\s+Order)\s*(?:No\.?\s*|#\s*)"
            r"(\d+(?:\s*[-&,]\s*\d+)*)",
            re.IGNORECASE,
        ),
        "A.O. No.",
    ),
    _CitationPattern(
        re.compile(
            r"(?:D\.?\s*O\.?|Department\s+Order)\s*(?:No\.?\s*|#\s*)"
            r"(\d+(?:\s*[-&,]\s*\d+)*)",
            re.IGNORECASE,
        ),
        "D.O. No.",
    ),
    _CitationPattern(
        re.compile(
            r"(?:M\.?\s*C\.?|Memorandum\s+Circular)\s*(?:No\.?\s*|#\s*)"
            r"(\d+(?:\s*[-&,]\s*\d+)*)",
            re.IGNORECASE,
        ),
        "M.C. No.",
    ),
    _CitationPattern(
        re.compile(
            r"(\d+)\s+S\.?\s*C\.?\s*R\.?\s*A\.?\s+(\d+)",
            re.IGNORECASE,
        ),
        "SCRA",
    ),
    _CitationPattern(
        re.compile(
            r"(\d+)\s+Phil\.?\s+(\d+)",
            re.IGNORECASE,
        ),
        "Phil.",
    ),
]


_PREFIX_TO_TYPE: dict[str, str] = {
    "G.R. No.": "case",
    "A.M. No.": "case",
    "A.C. No.": "case",
    "R.A. No.": "statute",
    "P.D. No.": "statute",
    "E.O. No.": "regulation",
    "B.P. Blg.": "statute",
    "C.A. No.": "statute",
    "A.O. No.": "regulation",
    "D.O. No.": "regulation",
    "M.C. No.": "regulation",
    "SCRA": "reporter",
    "Phil.": "reporter",
}


def citation_type_for(normalized: str) -> str:
    """Map a normalized citation to its citation_type (case|statute|regulation|reporter)."""
    # Reporter forms are number-prefixed ("123 SCRA 456"), not start-of-string.
    if " SCRA " in normalized or " Phil. " in normalized:
        return "reporter"
    for prefix, ctype in _PREFIX_TO_TYPE.items():
        if normalized.startswith(prefix):
            return ctype
    return "other"


def _normalize_number(number_str: str) -> str:
    """Clean up extracted number string.

    Removes extra whitespace around separators, normalizes L/l suffixes.
    """
    result = re.sub(r"\s+", " ", number_str.strip())
    # OCR sometimes confuses 1 and l in case-number suffixes (e.g. 12345-L).
    result = result.replace("l", "L")
    return result


@dataclass(frozen=True)
class CitationMatch:
    """A single citation match, surfaced for callers that need raw + offset."""

    raw: str
    normalized: str
    citation_type: str
    start: int
    end: int


def extract_citation_matches(text: str) -> list[CitationMatch]:
    """Find every citation occurrence with offsets, deduped by normalized form.

    The offset-bearing variant used by corpus extraction so we can map
    matches back to the section they came from.
    """
    if not text or len(text.strip()) < 10:
        return []

    seen: set[str] = set()
    matches: list[CitationMatch] = []
    for pattern in _PATTERNS:
        for m in pattern.regex.finditer(text):
            raw = m.group(0).strip()

            if pattern.canonical_prefix in ("SCRA", "Phil."):
                groups = m.groups()
                if len(groups) >= 2:
                    normalized = (
                        f"{groups[0]} {pattern.canonical_prefix} {groups[1]}"
                    )
                else:
                    normalized = raw
            else:
                normalized = (
                    f"{pattern.canonical_prefix} {_normalize_number(m.group(1))}"
                )

            if normalized in seen:
                continue
            seen.add(normalized)

            matches.append(
                CitationMatch(
                    raw=raw,
                    normalized=normalized,
                    citation_type=citation_type_for(normalized),
                    start=m.start(),
                    end=m.end(),
                )
            )
    return matches


def extract_citations(text: str) -> CitationExtractionResult:
    """Extract and normalize Philippine legal citations from text.

    Mirrors the ocr-service signature so vendored fixture parity tests
    can run identical input → expected normalized output assertions.
    """
    matches = extract_citation_matches(text)
    return CitationExtractionResult(
        citations=[m.raw for m in matches],
        normalized_citations=[m.normalized for m in matches],
    )
