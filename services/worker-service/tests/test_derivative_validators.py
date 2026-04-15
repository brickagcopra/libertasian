"""Tests for derivative validators — CaseDigestValidator, eligibility, and dispatch registry."""

from __future__ import annotations

import pytest

from src.validators.derivative_validators import (
    DerivativeValidationResult,
    DerivativeVerdict,
    LegalDocumentSectionSnapshot,
    LegalDocumentSnapshot,
    validate_derivative,
)
from src.validators.derivative_validators.case_digest_validator import (
    CaseDigestValidator,
)
from src.validators.derivative_validators.eligibility import (
    EligibilityResult,
    check_eligibility,
)


# --- Fixtures ---


def _make_document(**overrides: object) -> LegalDocumentSnapshot:
    defaults = {
        "id": "doc-001",
        "title": "Republic v. Sandiganbayan",
        "document_type": "case",
        "citation_text": "G.R. No. 123456",
        "court": "Supreme Court",
        "decision_date": "2024-01-15",
        "confidence_score": 0.9,
    }
    defaults.update(overrides)
    return LegalDocumentSnapshot(**defaults)  # type: ignore[arg-type]


def _make_sections(count: int = 3) -> list[LegalDocumentSectionSnapshot]:
    return [
        LegalDocumentSectionSnapshot(
            id=f"sec-{i:03d}",
            section_type="body",
            plain_text="x" * 200,
            page_start=i,
            page_end=i,
        )
        for i in range(count)
    ]


def _make_content(**overrides: object) -> dict:
    """Build a content dict that passes all CaseDigestValidator checks.

    Uses RAG DigestGenerationResponse snake_case format.
    """
    sections = _make_sections()
    defaults: dict = {
        "facts": " ".join(["word"] * 100),  # 100 words, within 80-1000
        "issues": ["Whether the court erred in ruling X"],
        "ruling": " ".join(["word"] * 150),  # 150 words, within 100-1500
        "doctrine": " ".join(["word"] * 50),  # 50 words, within 30-400
        "dispositive": " ".join(["word"] * 20),  # 20 words, within 10-300
        "cited_authorities": [
            {"citation_text": "G.R. No. 111", "document_type": "case"},
        ],
        "provenance": [
            {"field": "facts", "source_section_id": sections[0].id, "source_document_id": "doc-001"},
            {"field": "issues", "source_section_id": sections[0].id, "source_document_id": "doc-001"},
            {"field": "ruling", "source_section_id": sections[1].id, "source_document_id": "doc-001"},
            {"field": "doctrine", "source_section_id": sections[1].id, "source_document_id": "doc-001"},
        ],
        "confidence_score": 0.8,
    }
    defaults.update(overrides)
    return defaults


# ===========================================================================
# CaseDigestValidator tests (1-15)
# ===========================================================================


class TestCaseDigestValidatorPublish:
    """Tests that should result in PUBLISH verdict."""

    def test_happy_path_all_irac_fields_present(self) -> None:
        """1. Happy path — all IRAC fields present, good word counts, provenance complete -> PUBLISH."""
        validator = CaseDigestValidator()
        doc = _make_document()
        sections = _make_sections()
        content = _make_content()

        result = validator.validate(
            derivative_type="case_digest",
            content=content,
            source_document=doc,
            source_sections=sections,
        )

        assert result.verdict == DerivativeVerdict.PUBLISH
        assert len(result.reasons) == 0
        assert len(result.errors) == 0
        assert len(result.warnings) == 0


class TestCaseDigestValidatorQuarantine:
    """Tests that should result in QUARANTINE verdict (error-severity failures)."""

    def test_missing_facts_field(self) -> None:
        """2. Missing facts field -> QUARANTINE."""
        validator = CaseDigestValidator()
        content = _make_content(facts="")

        result = validator.validate(
            derivative_type="case_digest",
            content=content,
            source_document=_make_document(),
            source_sections=_make_sections(),
        )

        assert result.verdict == DerivativeVerdict.QUARANTINE
        error_names = [c.name for c in result.errors]
        assert "irac_field_facts" in error_names

    def test_missing_ruling_field(self) -> None:
        """3. Missing ruling field -> QUARANTINE."""
        validator = CaseDigestValidator()
        content = _make_content(ruling="")

        result = validator.validate(
            derivative_type="case_digest",
            content=content,
            source_document=_make_document(),
            source_sections=_make_sections(),
        )

        assert result.verdict == DerivativeVerdict.QUARANTINE
        error_names = [c.name for c in result.errors]
        assert "irac_field_ruling" in error_names

    def test_missing_all_irac_fields(self) -> None:
        """4. Missing all IRAC fields -> QUARANTINE."""
        validator = CaseDigestValidator()
        content = _make_content(
            facts="",
            issues=[],
            ruling="",
            doctrine="",
            dispositive="",
        )

        result = validator.validate(
            derivative_type="case_digest",
            content=content,
            source_document=_make_document(),
            source_sections=_make_sections(),
        )

        assert result.verdict == DerivativeVerdict.QUARANTINE
        assert len(result.errors) >= 5  # At least 5 IRAC fields missing

    def test_issues_count_zero(self) -> None:
        """8. Issues count = 0 -> QUARANTINE."""
        validator = CaseDigestValidator()
        content = _make_content(issues=[])

        result = validator.validate(
            derivative_type="case_digest",
            content=content,
            source_document=_make_document(),
            source_sections=_make_sections(),
        )

        assert result.verdict == DerivativeVerdict.QUARANTINE
        # issues=[] means irac_field_issues fails (empty list is falsy) AND issues_count=0
        error_names = [c.name for c in result.errors]
        assert "irac_field_issues" in error_names

    def test_abstain_flag_true(self) -> None:
        """13. Abstain flag = true -> QUARANTINE."""
        validator = CaseDigestValidator()
        content = _make_content(abstain=True, abstainReason="Insufficient source material")

        result = validator.validate(
            derivative_type="case_digest",
            content=content,
            source_document=_make_document(),
            source_sections=_make_sections(),
        )

        assert result.verdict == DerivativeVerdict.QUARANTINE
        error_names = [c.name for c in result.errors]
        assert "abstain_flag" in error_names
        assert any("Insufficient source material" in r for r in result.reasons)


class TestCaseDigestValidatorHumanReview:
    """Tests that should result in HUMAN_REVIEW verdict (warning-severity failures)."""

    def test_facts_below_min_words(self) -> None:
        """5. Facts below min words (< 80) -> HUMAN_REVIEW."""
        validator = CaseDigestValidator()
        content = _make_content(facts=" ".join(["word"] * 50))  # 50 words, below 80 minimum

        result = validator.validate(
            derivative_type="case_digest",
            content=content,
            source_document=_make_document(),
            source_sections=_make_sections(),
        )

        assert result.verdict == DerivativeVerdict.HUMAN_REVIEW
        warning_names = [c.name for c in result.warnings]
        assert "facts_word_count" in warning_names

    def test_facts_above_max_words(self) -> None:
        """6. Facts above max words (> 1000) -> HUMAN_REVIEW."""
        validator = CaseDigestValidator()
        content = _make_content(facts=" ".join(["word"] * 1100))  # 1100 words, above 1000 max

        result = validator.validate(
            derivative_type="case_digest",
            content=content,
            source_document=_make_document(),
            source_sections=_make_sections(),
        )

        assert result.verdict == DerivativeVerdict.HUMAN_REVIEW
        warning_names = [c.name for c in result.warnings]
        assert "facts_word_count" in warning_names

    def test_ruling_below_min_words(self) -> None:
        """7. Ruling below min words -> HUMAN_REVIEW."""
        validator = CaseDigestValidator()
        content = _make_content(ruling=" ".join(["word"] * 50))  # 50 words, below 100 minimum

        result = validator.validate(
            derivative_type="case_digest",
            content=content,
            source_document=_make_document(),
            source_sections=_make_sections(),
        )

        assert result.verdict == DerivativeVerdict.HUMAN_REVIEW
        warning_names = [c.name for c in result.warnings]
        assert "ruling_word_count" in warning_names

    def test_issues_count_above_max(self) -> None:
        """9. Issues count = 9 (> 8) -> HUMAN_REVIEW."""
        validator = CaseDigestValidator()
        content = _make_content(issues=[f"Issue {i}" for i in range(9)])

        result = validator.validate(
            derivative_type="case_digest",
            content=content,
            source_document=_make_document(),
            source_sections=_make_sections(),
        )

        assert result.verdict == DerivativeVerdict.HUMAN_REVIEW
        warning_names = [c.name for c in result.warnings]
        assert "issues_count" in warning_names

    def test_missing_provenance_for_facts(self) -> None:
        """10. Missing provenance for facts -> HUMAN_REVIEW."""
        validator = CaseDigestValidator()
        sections = _make_sections()
        content = _make_content(
            provenance=[
                {"field": "issues", "source_section_id": sections[0].id, "source_document_id": "doc-001"},
                {"field": "ruling", "source_section_id": sections[0].id, "source_document_id": "doc-001"},
                {"field": "doctrine", "source_section_id": sections[0].id, "source_document_id": "doc-001"},
            ],
        )

        result = validator.validate(
            derivative_type="case_digest",
            content=content,
            source_document=_make_document(),
            source_sections=sections,
        )

        assert result.verdict == DerivativeVerdict.HUMAN_REVIEW
        warning_names = [c.name for c in result.warnings]
        assert "provenance_facts" in warning_names

    def test_missing_provenance_for_doctrine(self) -> None:
        """11. Missing provenance for doctrine -> HUMAN_REVIEW."""
        validator = CaseDigestValidator()
        sections = _make_sections()
        content = _make_content(
            provenance=[
                {"field": "facts", "source_section_id": sections[0].id, "source_document_id": "doc-001"},
                {"field": "issues", "source_section_id": sections[0].id, "source_document_id": "doc-001"},
                {"field": "ruling", "source_section_id": sections[0].id, "source_document_id": "doc-001"},
            ],
        )

        result = validator.validate(
            derivative_type="case_digest",
            content=content,
            source_document=_make_document(),
            source_sections=sections,
        )

        assert result.verdict == DerivativeVerdict.HUMAN_REVIEW
        warning_names = [c.name for c in result.warnings]
        assert "provenance_doctrine" in warning_names

    def test_confidence_below_threshold(self) -> None:
        """12. Confidence below 0.5 -> HUMAN_REVIEW."""
        validator = CaseDigestValidator()
        content = _make_content(confidence_score=0.3)

        result = validator.validate(
            derivative_type="case_digest",
            content=content,
            source_document=_make_document(),
            source_sections=_make_sections(),
        )

        assert result.verdict == DerivativeVerdict.HUMAN_REVIEW
        warning_names = [c.name for c in result.warnings]
        assert "confidence_threshold" in warning_names

    def test_section_id_not_in_source_sections(self) -> None:
        """14. Section ID in provenance not in source_sections -> HUMAN_REVIEW."""
        validator = CaseDigestValidator()
        sections = _make_sections()
        content = _make_content(
            provenance=[
                {"field": "facts", "source_section_id": "non-existent-section-id", "source_document_id": "doc-001"},
                {"field": "issues", "source_section_id": "non-existent-section-id", "source_document_id": "doc-001"},
                {"field": "ruling", "source_section_id": "non-existent-section-id", "source_document_id": "doc-001"},
                {"field": "doctrine", "source_section_id": "non-existent-section-id", "source_document_id": "doc-001"},
            ],
        )

        result = validator.validate(
            derivative_type="case_digest",
            content=content,
            source_document=_make_document(),
            source_sections=sections,
        )

        assert result.verdict == DerivativeVerdict.HUMAN_REVIEW
        warning_names = [c.name for c in result.warnings]
        assert any(name.startswith("section_exists_") for name in warning_names)

    def test_citation_without_text(self) -> None:
        """15. Citation without citation_text -> HUMAN_REVIEW."""
        validator = CaseDigestValidator()
        content = _make_content(
            cited_authorities=[
                {"citation_text": "", "document_type": "case"},
            ],
        )

        result = validator.validate(
            derivative_type="case_digest",
            content=content,
            source_document=_make_document(),
            source_sections=_make_sections(),
        )

        assert result.verdict == DerivativeVerdict.HUMAN_REVIEW
        warning_names = [c.name for c in result.warnings]
        assert "citation_0_complete" in warning_names


# ===========================================================================
# Eligibility tests (16-19)
# ===========================================================================


class TestEligibility:
    """Pre-generation eligibility check tests."""

    def test_confidence_below_threshold(self) -> None:
        """16. confidence < 0.5 -> not eligible."""
        result = check_eligibility(confidence_score=0.3, total_plain_text_length=1000)

        assert result.eligible is False
        assert result.skip_reason is not None
        assert "0.5" in result.skip_reason

    def test_text_length_below_minimum(self) -> None:
        """17. text length < 500 -> not eligible."""
        result = check_eligibility(confidence_score=0.8, total_plain_text_length=200)

        assert result.eligible is False
        assert result.skip_reason is not None
        assert "500" in result.skip_reason

    def test_both_ok(self) -> None:
        """18. Both OK -> eligible."""
        result = check_eligibility(confidence_score=0.8, total_plain_text_length=1000)

        assert result.eligible is True
        assert result.skip_reason is None

    def test_confidence_none(self) -> None:
        """19. confidence = None (not set) -> eligible (don't skip)."""
        result = check_eligibility(confidence_score=None, total_plain_text_length=1000)

        assert result.eligible is True
        assert result.skip_reason is None


# ===========================================================================
# Dispatch registry tests (20-21)
# ===========================================================================


class TestDispatchRegistry:
    """Validator dispatch registry tests."""

    def test_registered_type_runs_validator(self) -> None:
        """20. validate_derivative with registered type -> runs validator."""
        doc = _make_document()
        sections = _make_sections()
        content = _make_content()

        result = validate_derivative(
            derivative_type="case_digest",
            content=content,
            source_document=doc,
            source_sections=sections,
        )

        # case_digest is registered via the module-level register_validator call
        assert isinstance(result, DerivativeValidationResult)
        assert result.verdict == DerivativeVerdict.PUBLISH

    def test_unknown_type_returns_human_review(self) -> None:
        """21. validate_derivative with unknown type -> returns HUMAN_REVIEW default."""
        doc = _make_document()
        sections = _make_sections()

        result = validate_derivative(
            derivative_type="unknown_type_xyz",
            content={},
            source_document=doc,
            source_sections=sections,
        )

        assert result.verdict == DerivativeVerdict.HUMAN_REVIEW
        assert any("No validator registered" in r for r in result.reasons)
