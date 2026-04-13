"""Tests for DoctrineExtractValidator (PR 4.3A).

10 tests covering:
1. All checks pass -> PUBLISH
2. No doctrines, no abstain -> QUARANTINE
3. Missing verbatim text -> QUARANTINE
4. Invalid doctrine type -> QUARANTINE
5. Text below min words -> HUMAN_REVIEW (warning)
6. Text above max words -> HUMAN_REVIEW
7. > 5 doctrines -> HUMAN_REVIEW
8. > 3 related links -> HUMAN_REVIEW
9. Section ID not in source -> HUMAN_REVIEW
10. Abstain flag -> QUARANTINE
"""

from __future__ import annotations

import pytest

from src.validators.derivative_validators import (
    DerivativeVerdict,
    LegalDocumentSectionSnapshot,
    LegalDocumentSnapshot,
)
from src.validators.derivative_validators.doctrine_extract_validator import (
    DoctrineExtractValidator,
)

# ---------------------------------------------------------------------------
# Fixtures & Helpers
# ---------------------------------------------------------------------------

FAKE_SOURCE_DOC = LegalDocumentSnapshot(
    id="doc-001",
    title="Republic v. Sandiganbayan",
    document_type="case",
    citation_text="G.R. No. 123456, January 1, 2025",
    court="Supreme Court",
    decision_date="2025-01-01",
    confidence_score=0.9,
)

SECTION_TEXT = (
    "The doctrine of command responsibility applies to civilian officials "
    "who hold positions of authority in the government. This principle requires "
    "that officials exercising effective control over subordinates may be held "
    "liable for the acts of those subordinates when they fail to prevent or punish "
    "such acts. The standard applies regardless of whether the superior directly "
    "ordered the illegal act."
)

FAKE_SECTIONS = [
    LegalDocumentSectionSnapshot(
        id="sec-001",
        section_type="body",
        plain_text=SECTION_TEXT,
        page_start=1,
        page_end=5,
    ),
    LegalDocumentSectionSnapshot(
        id="sec-002",
        section_type="body",
        plain_text="WHEREFORE, the petition is GRANTED. The decision is affirmed in toto.",
        page_start=5,
        page_end=6,
    ),
]

# 30 words — valid length
VALID_DOCTRINE_TEXT = (
    "The doctrine of command responsibility applies to civilian officials "
    "who hold positions of authority in the government requiring that officials "
    "exercising effective control over subordinates may be held liable for the acts."
)

VALID_VERBATIM = (
    "The doctrine of command responsibility applies to civilian officials "
    "who hold positions of authority in the government"
)


def _make_doctrine(overrides: dict | None = None) -> dict:
    base = {
        "text": VALID_DOCTRINE_TEXT,
        "verbatimSourceText": VALID_VERBATIM,
        "sectionId": "sec-001",
        "doctrineType": "rule",
        "relatedDoctrines": [],
    }
    if overrides:
        base.update(overrides)
    return base


def _make_content(doctrines: list[dict] | None = None, **kwargs) -> dict:
    base = {
        "doctrines": doctrines if doctrines is not None else [_make_doctrine()],
        "abstain": False,
        "abstainReason": None,
    }
    base.update(kwargs)
    return base


def _validate(content: dict) -> object:
    validator = DoctrineExtractValidator()
    return validator.validate(
        derivative_type="doctrine_extract",
        content=content,
        source_document=FAKE_SOURCE_DOC,
        source_sections=FAKE_SECTIONS,
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestDoctrineExtractValidator:
    """Tests for the DoctrineExtractValidator."""

    def test_1_all_checks_pass_publish(self) -> None:
        """All checks pass -> PUBLISH."""
        content = _make_content()
        result = _validate(content)

        assert result.verdict == DerivativeVerdict.PUBLISH
        assert len(result.reasons) == 0

    def test_2_no_doctrines_quarantine(self) -> None:
        """No doctrines, no abstain -> QUARANTINE."""
        content = _make_content(doctrines=[])
        result = _validate(content)

        assert result.verdict == DerivativeVerdict.QUARANTINE
        assert any("No doctrines extracted" in r for r in result.reasons)

    def test_3_missing_verbatim_quarantine(self) -> None:
        """Missing verbatimSourceText -> QUARANTINE."""
        content = _make_content(doctrines=[
            _make_doctrine({"verbatimSourceText": ""}),
        ])
        result = _validate(content)

        assert result.verdict == DerivativeVerdict.QUARANTINE
        assert any("Missing verbatimSourceText" in r for r in result.reasons)

    def test_4_invalid_doctrine_type_quarantine(self) -> None:
        """Invalid doctrine type -> QUARANTINE."""
        content = _make_content(doctrines=[
            _make_doctrine({"doctrineType": "invalid_type"}),
        ])
        result = _validate(content)

        assert result.verdict == DerivativeVerdict.QUARANTINE
        assert any("not in allow-list" in r for r in result.reasons)

    def test_5_text_below_min_words_human_review(self) -> None:
        """Text below min words -> HUMAN_REVIEW (warning)."""
        content = _make_content(doctrines=[
            _make_doctrine({"text": "Too short text."}),
        ])
        result = _validate(content)

        assert result.verdict == DerivativeVerdict.HUMAN_REVIEW
        assert any("words" in r for r in result.reasons)

    def test_6_text_above_max_words_human_review(self) -> None:
        """Text above max words -> HUMAN_REVIEW."""
        long_text = "word " * 501
        content = _make_content(doctrines=[
            _make_doctrine({"text": long_text}),
        ])
        result = _validate(content)

        assert result.verdict == DerivativeVerdict.HUMAN_REVIEW
        assert any("words" in r for r in result.reasons)

    def test_7_more_than_5_doctrines_human_review(self) -> None:
        """> 5 doctrines -> HUMAN_REVIEW (fanout cap warning)."""
        doctrines = [_make_doctrine() for _ in range(6)]
        content = _make_content(doctrines=doctrines)
        result = _validate(content)

        assert result.verdict == DerivativeVerdict.HUMAN_REVIEW
        assert any("fanout" in r.lower() or "max 5" in r for r in result.reasons)

    def test_8_more_than_3_related_links_human_review(self) -> None:
        """> 3 related links -> HUMAN_REVIEW."""
        related = [
            {"existingDoctrineId": None, "linkType": "supports"},
            {"existingDoctrineId": None, "linkType": "refines"},
            {"existingDoctrineId": None, "linkType": "contradicts"},
            {"existingDoctrineId": None, "linkType": "supports"},
        ]
        content = _make_content(doctrines=[
            _make_doctrine({"relatedDoctrines": related}),
        ])
        result = _validate(content)

        assert result.verdict == DerivativeVerdict.HUMAN_REVIEW
        assert any("Related links" in r for r in result.reasons)

    def test_9_section_id_not_in_source_human_review(self) -> None:
        """Section ID not in source -> HUMAN_REVIEW."""
        content = _make_content(doctrines=[
            _make_doctrine({"sectionId": "nonexistent-section-id"}),
        ])
        result = _validate(content)

        assert result.verdict == DerivativeVerdict.HUMAN_REVIEW
        assert any("not found" in r for r in result.reasons)

    def test_10_abstain_flag_quarantine(self) -> None:
        """Abstain flag -> QUARANTINE."""
        content = _make_content(
            doctrines=[],
            abstain=True,
            abstainReason="No doctrinal holdings found",
        )
        result = _validate(content)

        assert result.verdict == DerivativeVerdict.QUARANTINE
        assert any("abstained" in r.lower() for r in result.reasons)
