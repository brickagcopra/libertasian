"""LIBERTASIAN Worker Service — Truthfulness Validator.

Pure-function validator that determines whether an ingested legal document
can be auto-published, needs human review, or should be quarantined.

Implements PDD Section 8 / CLAUDE.md auto-publish rules:
- Auto-publish: official source + complete document + good text + good metadata
- Quarantine: severe issues (low OCR, high-severity flags, missing core fields)
- Human review: everything else (safe default)

All data is passed as parameters — no DB calls in this module.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

logger = logging.getLogger(__name__)


class Verdict(str, Enum):
    """Possible validation verdicts."""

    PUBLISH = "publish"
    HUMAN_REVIEW = "human_review"
    QUARANTINE = "quarantine"


@dataclass(frozen=True)
class CheckResult:
    """Result of a single validation check."""

    name: str
    passed: bool
    reason: str


@dataclass(frozen=True)
class ValidationResult:
    """Aggregate result from all validation checks."""

    verdict: Verdict
    reasons: list[str]
    confidence_score: float
    checks: list[CheckResult]


def validate_document(
    *,
    # Document fields
    title: str | None,
    document_type: str | None,
    court: str | None,
    decision_date: str | None,
    gr_no: str | None,
    status: str,
    truthfulness_status: str,
    is_published: bool,
    # Source fields
    source_trust_level: str | None,
    # Section info
    section_count: int,
    # OCR info (None if not from OCR)
    is_from_scan: bool,
    ocr_confidence: float | None,
    # Editorial flags
    open_flags: list[dict[str, Any]],
    # Citation counts
    total_citations: int,
    resolved_citations: int,
) -> ValidationResult:
    """Validate a document and return a verdict with supporting checks.

    This is a pure function: all data is passed in, no side effects.
    """
    checks: list[CheckResult] = []

    # ── Check 1: Official Source ──────────────────────────────────────
    official_source = source_trust_level == "high"
    checks.append(CheckResult(
        name="official_source",
        passed=official_source,
        reason=(
            "Source trust level is 'high'"
            if official_source
            else f"Source trust level is '{source_trust_level}' (not 'high')"
        ),
    ))

    # ── Check 2: Document Completeness ────────────────────────────────
    has_title = bool(title and title.strip())
    has_date = bool(decision_date)
    has_sections = section_count >= 1
    document_complete = has_title and has_date and has_sections
    missing: list[str] = []
    if not has_title:
        missing.append("title")
    if not has_date:
        missing.append("decision_date")
    if not has_sections:
        missing.append("sections")
    checks.append(CheckResult(
        name="document_complete",
        passed=document_complete,
        reason=(
            "Document has title, date, and at least 1 section"
            if document_complete
            else f"Missing: {', '.join(missing)}"
        ),
    ))

    # ── Check 3: Text Integrity ───────────────────────────────────────
    # Not from camera scan AND (no OCR or OCR confidence >= 0.8)
    if is_from_scan:
        text_integrity = False
        text_reason = "Document is from a camera scan"
    elif ocr_confidence is not None and ocr_confidence < 0.8:
        text_integrity = False
        text_reason = f"OCR confidence {ocr_confidence:.2f} is below 0.8 threshold"
    else:
        text_integrity = True
        text_reason = (
            "Not from scan, no OCR concerns"
            if ocr_confidence is None
            else f"OCR confidence {ocr_confidence:.2f} meets threshold"
        )
    checks.append(CheckResult(
        name="text_integrity",
        passed=text_integrity,
        reason=text_reason,
    ))

    # ── Check 4: Metadata Confidence ─────────────────────────────────
    # >= 80% of key fields (title, document_type, court) populated
    key_fields = [title, document_type, court]
    populated = sum(1 for f in key_fields if f and str(f).strip())
    metadata_ratio = populated / len(key_fields) if key_fields else 0.0
    metadata_confident = metadata_ratio >= 0.8
    checks.append(CheckResult(
        name="metadata_confidence",
        passed=metadata_confident,
        reason=(
            f"{populated}/{len(key_fields)} key metadata fields populated "
            f"({metadata_ratio:.0%})"
        ),
    ))

    # ── Check 5: Citation Mapping ─────────────────────────────────────
    # No unresolved citations, or >= 80% resolved
    if total_citations == 0:
        citation_ok = True
        citation_reason = "No citations to resolve"
    else:
        resolution_ratio = resolved_citations / total_citations
        citation_ok = resolution_ratio >= 0.8
        citation_reason = (
            f"{resolved_citations}/{total_citations} citations resolved "
            f"({resolution_ratio:.0%})"
        )
    checks.append(CheckResult(
        name="citation_mapping",
        passed=citation_ok,
        reason=citation_reason,
    ))

    # ── Check 6: No Conflict Flags ────────────────────────────────────
    open_flag_count = len(open_flags)
    no_conflict_flags = open_flag_count == 0
    checks.append(CheckResult(
        name="no_conflict_flags",
        passed=no_conflict_flags,
        reason=(
            "No open editorial flags"
            if no_conflict_flags
            else f"{open_flag_count} open editorial flag(s)"
        ),
    ))

    # ── Determine Verdict ─────────────────────────────────────────────
    verdict, reasons = _determine_verdict(
        checks=checks,
        is_from_scan=is_from_scan,
        ocr_confidence=ocr_confidence,
        open_flags=open_flags,
        has_title=has_title,
        has_sections=has_sections,
    )

    # ── Compute Confidence Score ──────────────────────────────────────
    passed_count = sum(1 for c in checks if c.passed)
    confidence_score = round(passed_count / len(checks), 2) if checks else 0.0

    result = ValidationResult(
        verdict=verdict,
        reasons=reasons,
        confidence_score=confidence_score,
        checks=checks,
    )

    logger.info(
        "Validation result: verdict=%s confidence=%.2f checks_passed=%d/%d",
        verdict.value,
        confidence_score,
        passed_count,
        len(checks),
    )

    return result


def _determine_verdict(
    *,
    checks: list[CheckResult],
    is_from_scan: bool,
    ocr_confidence: float | None,
    open_flags: list[dict[str, Any]],
    has_title: bool,
    has_sections: bool,
) -> tuple[Verdict, list[str]]:
    """Determine verdict based on check results and severity rules.

    Returns (verdict, list_of_reasons).
    """
    reasons: list[str] = []

    # ── Quarantine conditions (severe issues) ─────────────────────────
    # Low OCR quality (< 0.4)
    if ocr_confidence is not None and ocr_confidence < 0.4:
        reasons.append(f"OCR confidence critically low ({ocr_confidence:.2f} < 0.4)")

    # High-severity open editorial flags
    high_severity_flags = [
        f for f in open_flags
        if f.get("severity") == "high" and f.get("status") == "open"
    ]
    if high_severity_flags:
        reasons.append(
            f"{len(high_severity_flags)} high-severity editorial flag(s) open"
        )

    # Missing both title AND sections
    if not has_title and not has_sections:
        reasons.append("Missing both title and sections — document may be empty/corrupt")

    if reasons:
        return Verdict.QUARANTINE, reasons

    # ── Auto-publish conditions (ALL checks must pass) ────────────────
    all_passed = all(c.passed for c in checks)
    if all_passed:
        return Verdict.PUBLISH, ["All validation checks passed"]

    # ── Human review (default) ────────────────────────────────────────
    failed_checks = [c for c in checks if not c.passed]
    reasons = [f"Failed: {c.name} — {c.reason}" for c in failed_checks]
    return Verdict.HUMAN_REVIEW, reasons
