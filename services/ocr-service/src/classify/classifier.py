"""LIBERTASIAN OCR Service — Rule-based Philippine legal document classifier.

Classifies OCR-extracted text into legal document types (case, statute, rule,
issuance, memorandum, order, etc.) using keyword patterns, structural markers,
and heuristic rules specific to Philippine legal documents.
"""

import re
from dataclasses import dataclass

from ..schemas import ClassificationResult


@dataclass(frozen=True)
class _Pattern:
    """A classification pattern with associated document type and weight."""

    regex: re.Pattern[str]
    doc_type: str
    weight: float


# ── Pattern Groups ────────────────────────────────────────────────────────
# Patterns are applied in order. Each matched pattern contributes its weight
# to the corresponding document type. The type with the highest total wins.

_CASE_PATTERNS: list[_Pattern] = [
    _Pattern(
        re.compile(r"G\.?\s*R\.?\s*(No\.?\s*)?\d+", re.IGNORECASE),
        "case",
        3.0,
    ),
    _Pattern(
        re.compile(r"(SUPREME\s+COURT|COURT\s+OF\s+APPEALS|SANDIGANBAYAN)", re.IGNORECASE),
        "case",
        2.0,
    ),
    _Pattern(
        re.compile(r"\bPETITIONER[S]?\b.*\bRESPONDENT[S]?\b", re.IGNORECASE | re.DOTALL),
        "case",
        2.5,
    ),
    _Pattern(
        re.compile(r"\b(DECISION|RESOLUTION|EN\s+BANC|DIVISION)\b", re.IGNORECASE),
        "case",
        1.5,
    ),
    _Pattern(
        re.compile(r"\b(PONENTE|CONCURRING|DISSENTING)\b", re.IGNORECASE),
        "case",
        2.0,
    ),
    _Pattern(
        re.compile(r"\bWHEREFORE\b.*\b(GRANT|DENY|DISMISS|AFFIRM|REVERSE)\b", re.IGNORECASE | re.DOTALL),
        "case",
        2.5,
    ),
    _Pattern(
        re.compile(r"\bvs?\.?\s", re.IGNORECASE),
        "case",
        0.5,
    ),
    _Pattern(
        re.compile(r"\b(S\.?\s*C\.?\s*R\.?\s*A\.?|Phil\.?\s*Reports?|Phil\.?\s*\d+)\b", re.IGNORECASE),
        "case",
        1.5,
    ),
]

_STATUTE_PATTERNS: list[_Pattern] = [
    _Pattern(
        re.compile(r"(REPUBLIC\s+ACT|R\.?\s*A\.?)\s*(No\.?\s*)?\d+", re.IGNORECASE),
        "statute",
        3.0,
    ),
    _Pattern(
        re.compile(r"(PRESIDENTIAL\s+DECREE|P\.?\s*D\.?)\s*(No\.?\s*)?\d+", re.IGNORECASE),
        "statute",
        3.0,
    ),
    _Pattern(
        re.compile(r"(BATAS\s+PAMBANSA|B\.?\s*P\.?)\s*(No\.?\s*)?\d+", re.IGNORECASE),
        "statute",
        3.0,
    ),
    _Pattern(
        re.compile(r"(COMMONWEALTH\s+ACT|C\.?\s*A\.?)\s*(No\.?\s*)?\d+", re.IGNORECASE),
        "statute",
        3.0,
    ),
    _Pattern(
        re.compile(r"\bAN\s+ACT\b", re.IGNORECASE),
        "statute",
        2.0,
    ),
    _Pattern(
        re.compile(r"\b(SEC(?:TION)?\.?\s+\d+\.?)\b", re.IGNORECASE),
        "statute",
        0.5,
    ),
    _Pattern(
        re.compile(r"\b(ARTICLE\s+\d+)\b", re.IGNORECASE),
        "statute",
        0.5,
    ),
]

_RULE_PATTERNS: list[_Pattern] = [
    _Pattern(
        re.compile(r"(RULES?\s+OF\s+COURT|RULES?\s+OF\s+PROCEDURE)", re.IGNORECASE),
        "rule",
        3.0,
    ),
    _Pattern(
        re.compile(r"(A\.?\s*M\.?\s*(No\.?\s*)?[\d\-]+)", re.IGNORECASE),
        "rule",
        2.5,
    ),
    _Pattern(
        re.compile(r"\bRULE\s+\d+\b", re.IGNORECASE),
        "rule",
        2.0,
    ),
    _Pattern(
        re.compile(r"\bSUPREME\s+COURT.*\bADMINISTRATIVE\b", re.IGNORECASE),
        "rule",
        2.0,
    ),
]

_ISSUANCE_PATTERNS: list[_Pattern] = [
    _Pattern(
        re.compile(r"(EXECUTIVE\s+ORDER|E\.?\s*O\.?)\s*(No\.?\s*)?\d+", re.IGNORECASE),
        "issuance",
        3.0,
    ),
    _Pattern(
        re.compile(r"(ADMINISTRATIVE\s+ORDER|A\.?\s*O\.?)\s*(No\.?\s*)?\d+", re.IGNORECASE),
        "issuance",
        3.0,
    ),
    _Pattern(
        re.compile(r"(DEPARTMENT\s+ORDER|D\.?\s*O\.?)\s*(No\.?\s*)?\d+", re.IGNORECASE),
        "issuance",
        3.0,
    ),
    _Pattern(
        re.compile(r"(MEMORANDUM\s+CIRCULAR|M\.?\s*C\.?)\s*(No\.?\s*)?\d+", re.IGNORECASE),
        "issuance",
        3.0,
    ),
    _Pattern(
        re.compile(r"\bPROCLAMATION\s*(No\.?\s*)?\d+\b", re.IGNORECASE),
        "issuance",
        3.0,
    ),
]

_MEMORANDUM_PATTERNS: list[_Pattern] = [
    _Pattern(
        re.compile(r"\bMEMORANDUM\b", re.IGNORECASE),
        "memorandum",
        1.5,
    ),
    _Pattern(
        re.compile(r"\b(LEGAL\s+MEMORANDUM|MEMORANDUM\s+OF\s+LAW)\b", re.IGNORECASE),
        "memorandum",
        2.5,
    ),
    _Pattern(
        re.compile(r"\b(STATEMENT\s+OF\s+FACTS|ISSUES?\s+PRESENTED|DISCUSSION|CONCLUSION)\b", re.IGNORECASE),
        "memorandum",
        1.0,
    ),
]

_ORDER_PATTERNS: list[_Pattern] = [
    _Pattern(
        re.compile(r"\bORDER\b.*\b(COURT|JUDGE|BRANCH)\b", re.IGNORECASE),
        "order",
        2.5,
    ),
    _Pattern(
        re.compile(r"\b(SO\s+ORDERED)\b", re.IGNORECASE),
        "order",
        2.0,
    ),
]

# Aggregate all patterns in priority order
_ALL_PATTERNS: list[_Pattern] = (
    _CASE_PATTERNS
    + _STATUTE_PATTERNS
    + _RULE_PATTERNS
    + _ISSUANCE_PATTERNS
    + _MEMORANDUM_PATTERNS
    + _ORDER_PATTERNS
)

# Valid document types matching PDD legal_documents.document_type enum
_VALID_TYPES = {"case", "statute", "rule", "issuance", "memorandum", "order"}


def classify_document(text: str) -> ClassificationResult:
    """Classify legal document type from extracted text.

    Uses weighted pattern matching across multiple document type categories.
    The type with the highest cumulative weight wins. Confidence is derived
    from the ratio of the winning score to total detected score.

    Args:
        text: OCR-extracted document text.

    Returns:
        ClassificationResult with document_type and confidence (0.0–1.0).
    """
    if not text or len(text.strip()) < 20:
        return ClassificationResult(
            document_type="unknown",
            confidence=0.0,
        )

    # Score each document type
    scores: dict[str, float] = {}

    for pattern in _ALL_PATTERNS:
        matches = pattern.regex.findall(text)
        if matches:
            match_count = min(len(matches), 5)  # Cap at 5 to avoid runaway scores
            score = pattern.weight * match_count
            scores[pattern.doc_type] = scores.get(pattern.doc_type, 0.0) + score

    if not scores:
        return ClassificationResult(
            document_type="unknown",
            confidence=0.0,
        )

    # Find the winning type
    best_type = max(scores, key=lambda k: scores[k])
    best_score = scores[best_type]
    total_score = sum(scores.values())

    # Confidence: ratio of best score to total, with a floor
    raw_confidence = best_score / total_score if total_score > 0 else 0.0

    # Boost confidence if best score is significantly higher than runner-up
    sorted_scores = sorted(scores.values(), reverse=True)
    if len(sorted_scores) >= 2 and sorted_scores[1] > 0:
        dominance = sorted_scores[0] / sorted_scores[1]
        if dominance > 3.0:
            raw_confidence = min(raw_confidence + 0.15, 1.0)
    elif len(sorted_scores) == 1:
        raw_confidence = min(raw_confidence + 0.1, 1.0)

    # Scale confidence based on absolute best score
    # A very low absolute score means low overall confidence
    if best_score < 3.0:
        raw_confidence *= 0.5
    elif best_score < 6.0:
        raw_confidence *= 0.75

    confidence = round(min(max(raw_confidence, 0.0), 1.0), 4)

    return ClassificationResult(
        document_type=best_type,
        confidence=confidence,
    )
