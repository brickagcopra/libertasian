"""LIBERTASIAN Worker Service — Truthfulness Validator.

Pure-function validator that determines whether an ingested legal document
can be auto-published, needs human review, or should be quarantined.

Implements PDD Section 8 / CLAUDE.md auto-publish rules:
- Auto-publish: official source + complete document + good text + good metadata
- Quarantine: severe issues (low OCR, high-severity flags, missing core fields)
- Human review: everything else (safe default)

All data is passed as parameters — no DB calls in this module.

## Blocking vs advisory checks

Not every check gates auto-publish. ``ADVISORY_CHECKS`` names the ones that
are reported but cannot, on their own, hold a document back. Everything else
is blocking: a single blocking failure routes to ``HUMAN_REVIEW``.

``citation_mapping`` is advisory because the gate it enforced was unreachable.
Measured on prod 2026-07-27: the resolved/total citation ratio across
``legal_documents`` has median 0.000 and mean 0.024 over ~16 citations per
document, so the 0.8 bar failed 13,025 of 13,093 drafts — and 3,909 of the
4,042 documents already published before the check existed. Auto-publish
stopped dead at ``created_at`` 2026-05-30 and 76% of the corpus became
unsearchable while every one of those documents was otherwise complete.

A threshold no document in the corpus can clear is not a quality control; it
is an outage with a rationale attached. The real defect is upstream — the
citation resolver resolves ~0% of what it extracts (tracked separately) — and
that is what has to be fixed for this signal to mean anything. Until then the
check still runs, still reports its ratio, and still contributes to the
confidence score and to ``HUMAN_REVIEW`` reasons; it just no longer blocks a
document that passes every check that actually measures the document.
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
    """Result of a single validation check.

    ``advisory`` marks a check whose failure is reported but never blocks
    auto-publish by itself. It is derived from :data:`ADVISORY_CHECKS` — do
    not set it by hand at a call site.
    """

    name: str
    passed: bool
    reason: str
    advisory: bool = False


# Checks that are reported but do not gate auto-publish. See the module
# docstring for why citation_mapping is here.
ADVISORY_CHECKS = frozenset({"citation_mapping"})


def _check(name: str, passed: bool, reason: str) -> CheckResult:
    """Build a CheckResult, deriving ``advisory`` from ADVISORY_CHECKS.

    Single construction point so the blocking/advisory split has exactly one
    source of truth.
    """
    return CheckResult(
        name=name,
        passed=passed,
        reason=reason,
        advisory=name in ADVISORY_CHECKS,
    )


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

    Blocking checks (any failure → ``HUMAN_REVIEW``): ``official_source``,
    ``document_complete``, ``text_integrity``, ``metadata_confidence``,
    ``no_conflict_flags``. Quarantine rules (critically low OCR, an open
    high-severity editorial flag, missing both title and sections) are
    evaluated first and outrank everything else.

    ``citation_mapping`` is advisory: it is computed, reported, and folded
    into ``confidence_score``, but a document that fails only that check is
    still eligible for auto-publish. See the module docstring — the
    resolver's real-world resolution ratio is ~0, so this bar was
    unreachable for every document in the corpus, published or not.
    """
    checks: list[CheckResult] = []

    # ── Check 1: Official Source ──────────────────────────────────────
    official_source = source_trust_level == "high"
    checks.append(_check(
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
    checks.append(_check(
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
    checks.append(_check(
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
    checks.append(_check(
        name="metadata_confidence",
        passed=metadata_confident,
        reason=(
            f"{populated}/{len(key_fields)} key metadata fields populated "
            f"({metadata_ratio:.0%})"
        ),
    ))

    # ── Check 5: Citation Mapping (ADVISORY — see module docstring) ───
    # No unresolved citations, or >= 80% resolved. Reported, never blocking.
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
    checks.append(_check(
        name="citation_mapping",
        passed=citation_ok,
        reason=citation_reason,
    ))

    # ── Check 6: No Conflict Flags ────────────────────────────────────
    open_flag_count = len(open_flags)
    no_conflict_flags = open_flag_count == 0
    checks.append(_check(
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
    # Over ALL checks, advisory included: the score is a report of how the
    # document looked, not the gate. An auto-published document that failed
    # only citation_mapping therefore records 5/6, which is the honest number
    # and keeps the shortfall visible in the audit entry.
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

    Quarantine rules are evaluated first and outrank the checks. After that,
    only BLOCKING checks decide publish vs review: a failing advisory check
    contributes a reason to whatever verdict the blocking checks produce, and
    nothing else. A document whose sole failure is advisory publishes, with
    the advisory reason recorded on the audit entry.

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

    # ── Advisory failures: reported alongside any verdict, never decisive ─
    advisory_reasons = [
        f"Advisory (non-blocking): {c.name} — {c.reason}"
        for c in checks
        if c.advisory and not c.passed
    ]

    # ── Auto-publish conditions (all BLOCKING checks must pass) ───────
    blocking_failures = [c for c in checks if not c.advisory and not c.passed]
    if not blocking_failures:
        return Verdict.PUBLISH, [
            "All blocking validation checks passed",
            *advisory_reasons,
        ]

    # ── Human review (default) ────────────────────────────────────────
    reasons = [f"Failed: {c.name} — {c.reason}" for c in blocking_failures]
    reasons.extend(advisory_reasons)
    return Verdict.HUMAN_REVIEW, reasons
