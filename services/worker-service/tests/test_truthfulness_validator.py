"""Tests for the truthfulness validator — pure function tests.

The truthfulness validator is a pure function that takes document data
as parameters and returns a verdict (publish / human_review / quarantine).
No database or HTTP mocks needed.
"""

from __future__ import annotations

import pytest

from src.validators.truthfulness_validator import (
    CheckResult,
    ValidationResult,
    Verdict,
    validate_document,
)


# ─── Helper ──────────────────────────────────────────────────────────────


def _validate(**overrides: object) -> ValidationResult:
    """Call validate_document with defaults, overridden by kwargs."""
    defaults = {
        "title": "Republic v. Sandiganbayan",
        "document_type": "case",
        "court": "Supreme Court",
        "decision_date": "2024-01-15",
        "gr_no": "G.R. No. 123456",
        "status": "draft",
        "truthfulness_status": "needs_review",
        "is_published": False,
        "source_trust_level": "high",
        "section_count": 3,
        "is_from_scan": False,
        "ocr_confidence": None,
        "open_flags": [],
        "total_citations": 5,
        "resolved_citations": 5,
    }
    defaults.update(overrides)
    return validate_document(**defaults)  # type: ignore[arg-type]


# ─── Auto-Publish Tests ─────────────────────────────────────────────────


class TestAutoPublish:
    """When all checks pass, document should be auto-published."""

    def test_all_checks_pass_returns_publish(self) -> None:
        result = _validate()
        assert result.verdict == Verdict.PUBLISH
        assert result.confidence_score == 1.0
        assert all(c.passed for c in result.checks)

    def test_all_checks_pass_has_six_checks(self) -> None:
        result = _validate()
        assert len(result.checks) == 6

    def test_high_trust_official_source(self) -> None:
        result = _validate(source_trust_level="high")
        official_check = next(c for c in result.checks if c.name == "official_source")
        assert official_check.passed


# ─── Human Review Tests ──────────────────────────────────────────────────


class TestHumanReview:
    """When some checks fail but no quarantine conditions, go to review."""

    def test_non_official_source_triggers_review(self) -> None:
        result = _validate(source_trust_level="medium")
        assert result.verdict == Verdict.HUMAN_REVIEW
        assert any("official_source" in r for r in result.reasons)

    def test_low_trust_source_triggers_review(self) -> None:
        result = _validate(source_trust_level="low")
        assert result.verdict == Verdict.HUMAN_REVIEW

    def test_missing_decision_date_triggers_review(self) -> None:
        result = _validate(decision_date=None)
        assert result.verdict == Verdict.HUMAN_REVIEW

    def test_no_sections_only_triggers_review(self) -> None:
        """Missing sections alone = review (not quarantine, since title exists)."""
        result = _validate(section_count=0)
        assert result.verdict == Verdict.HUMAN_REVIEW

    def test_missing_title_only_triggers_review(self) -> None:
        """Missing title alone = review (not quarantine, since sections exist)."""
        result = _validate(title=None)
        assert result.verdict == Verdict.HUMAN_REVIEW

    def test_from_scan_triggers_review(self) -> None:
        result = _validate(is_from_scan=True)
        assert result.verdict == Verdict.HUMAN_REVIEW

    def test_low_ocr_above_quarantine_triggers_review(self) -> None:
        """OCR 0.5 is below publish threshold (0.8) but above quarantine (0.4)."""
        result = _validate(ocr_confidence=0.5)
        assert result.verdict == Verdict.HUMAN_REVIEW

    def test_partial_citation_resolution_triggers_review(self) -> None:
        """Less than 80% citations resolved → review."""
        result = _validate(total_citations=10, resolved_citations=5)
        assert result.verdict == Verdict.HUMAN_REVIEW

    def test_single_low_severity_flag_triggers_review(self) -> None:
        result = _validate(
            open_flags=[{"severity": "low", "status": "open"}],
        )
        assert result.verdict == Verdict.HUMAN_REVIEW

    def test_missing_court_drops_metadata_below_threshold(self) -> None:
        """2/3 key fields = 66% < 80% threshold."""
        result = _validate(court=None)
        assert result.verdict == Verdict.HUMAN_REVIEW


# ─── Quarantine Tests ────────────────────────────────────────────────────


class TestQuarantine:
    """Severe issues should quarantine the document."""

    def test_very_low_ocr_quarantines(self) -> None:
        """OCR confidence below 0.4 = critical, quarantine."""
        result = _validate(ocr_confidence=0.3)
        assert result.verdict == Verdict.QUARANTINE
        assert any("OCR confidence critically low" in r for r in result.reasons)

    def test_ocr_zero_quarantines(self) -> None:
        result = _validate(ocr_confidence=0.0)
        assert result.verdict == Verdict.QUARANTINE

    def test_high_severity_flag_quarantines(self) -> None:
        result = _validate(
            open_flags=[{"severity": "high", "status": "open"}],
        )
        assert result.verdict == Verdict.QUARANTINE
        assert any("high-severity" in r for r in result.reasons)

    def test_missing_title_and_sections_quarantines(self) -> None:
        """Missing both title AND sections = document may be empty/corrupt."""
        result = _validate(title=None, section_count=0)
        assert result.verdict == Verdict.QUARANTINE
        assert any("empty/corrupt" in r for r in result.reasons)

    def test_multiple_quarantine_reasons(self) -> None:
        """Multiple severe issues should all appear in reasons."""
        result = _validate(
            ocr_confidence=0.1,
            title=None,
            section_count=0,
            open_flags=[{"severity": "high", "status": "open"}],
        )
        assert result.verdict == Verdict.QUARANTINE
        assert len(result.reasons) >= 2


# ─── Confidence Score Tests ──────────────────────────────────────────────


class TestConfidenceScore:
    """Confidence score = passed checks / total checks."""

    def test_all_pass_gives_1_0(self) -> None:
        result = _validate()
        assert result.confidence_score == 1.0

    def test_one_failure_gives_5_6(self) -> None:
        result = _validate(source_trust_level="medium")
        assert result.confidence_score == pytest.approx(5 / 6, abs=0.01)

    def test_two_failures_gives_4_6(self) -> None:
        result = _validate(source_trust_level="medium", decision_date=None)
        assert result.confidence_score == pytest.approx(4 / 6, abs=0.01)


# ─── Check Result Tests ─────────────────────────────────────────────────


class TestCheckResults:
    """Verify individual check names and behavior."""

    def test_check_names(self) -> None:
        result = _validate()
        check_names = {c.name for c in result.checks}
        expected = {
            "official_source",
            "document_complete",
            "text_integrity",
            "metadata_confidence",
            "citation_mapping",
            "no_conflict_flags",
        }
        assert check_names == expected

    def test_no_citations_passes_mapping_check(self) -> None:
        result = _validate(total_citations=0, resolved_citations=0)
        citation_check = next(c for c in result.checks if c.name == "citation_mapping")
        assert citation_check.passed
        assert "No citations to resolve" in citation_check.reason

    def test_ocr_at_threshold_passes(self) -> None:
        """OCR confidence == 0.8 meets the threshold."""
        result = _validate(ocr_confidence=0.8)
        text_check = next(c for c in result.checks if c.name == "text_integrity")
        assert text_check.passed

    def test_ocr_below_threshold_fails(self) -> None:
        """OCR confidence 0.79 is below the 0.8 threshold."""
        result = _validate(ocr_confidence=0.79)
        text_check = next(c for c in result.checks if c.name == "text_integrity")
        assert not text_check.passed


# ─── Edge Cases ──────────────────────────────────────────────────────────


class TestEdgeCases:
    """Edge cases and boundary conditions."""

    def test_empty_title_is_falsy(self) -> None:
        result = _validate(title="")
        complete_check = next(
            c for c in result.checks if c.name == "document_complete"
        )
        assert not complete_check.passed

    def test_whitespace_only_title_is_falsy(self) -> None:
        result = _validate(title="   ")
        complete_check = next(
            c for c in result.checks if c.name == "document_complete"
        )
        assert not complete_check.passed

    def test_none_source_trust_level(self) -> None:
        result = _validate(source_trust_level=None)
        official_check = next(
            c for c in result.checks if c.name == "official_source"
        )
        assert not official_check.passed

    def test_dismissed_high_severity_flag_does_not_quarantine(self) -> None:
        """Only 'open' status flags with high severity trigger quarantine."""
        result = _validate(
            open_flags=[{"severity": "high", "status": "dismissed"}],
        )
        # Should not quarantine because the flag is dismissed
        assert result.verdict != Verdict.QUARANTINE

    def test_citation_80_percent_threshold(self) -> None:
        """Exactly 80% resolved = passes."""
        result = _validate(total_citations=10, resolved_citations=8)
        citation_check = next(c for c in result.checks if c.name == "citation_mapping")
        assert citation_check.passed

    def test_citation_79_percent_fails(self) -> None:
        """79% resolved = fails."""
        result = _validate(total_citations=100, resolved_citations=79)
        citation_check = next(c for c in result.checks if c.name == "citation_mapping")
        assert not citation_check.passed


# ─── Parameterized trust_level → verdict mapping ────────────────────────
#
# Regression suite for Issue 3 (Lawphil vs SC divergence). The only reason
# Lawphil docs landed as draft/needs_review while SC docs auto-published was
# `source.trust_level`: the validator treats only `'high'` as official_source.
# These tests pin the contract so future contributors can't silently weaken
# or extend the mapping without touching the test suite.


@pytest.mark.parametrize(
    "trust_level,expected_verdict,official_passes",
    [
        ("high", Verdict.PUBLISH, True),
        ("medium", Verdict.HUMAN_REVIEW, False),
        ("low", Verdict.HUMAN_REVIEW, False),
        (None, Verdict.HUMAN_REVIEW, False),
        # Unknown / garbage values must never unlock auto-publish.
        ("bogus", Verdict.HUMAN_REVIEW, False),
        ("HIGH", Verdict.HUMAN_REVIEW, False),  # case-sensitive on purpose
    ],
)
def test_trust_level_drives_verdict(
    trust_level: str | None,
    expected_verdict: Verdict,
    official_passes: bool,
) -> None:
    """All other checks pass → only trust_level decides publish vs review.

    Lawphil bumping to `trust_level='high'` in seed + migration is the
    explicit fix for Issue 3. This test enforces that 'high' is the only
    value that satisfies the `official_source` check.
    """
    result = _validate(source_trust_level=trust_level)

    official_check = next(c for c in result.checks if c.name == "official_source")
    assert official_check.passed is official_passes, (
        f"trust_level={trust_level!r} expected official_passes={official_passes}"
    )
    assert result.verdict == expected_verdict, (
        f"trust_level={trust_level!r} expected verdict={expected_verdict}, "
        f"got {result.verdict} (reasons={result.reasons})"
    )
