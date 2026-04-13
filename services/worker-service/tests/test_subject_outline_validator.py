"""Tests for SubjectOutlineValidator (PR 5.3).

10 tests covering:
1. Happy path — 5 sections, each with paragraphs -> PUBLISH
2. Abstain -> QUARANTINE
3. < 3 sections -> QUARANTINE
4. > 30 sections -> warning (HUMAN_REVIEW)
5. Empty heading -> error (QUARANTINE)
6. Section with no paragraphs -> error (QUARANTINE)
7. Cross-doc coverage met (>= 2 sources) -> passes
8. Cross-doc coverage failed (1 source only) -> warning (HUMAN_REVIEW)
9. Sub-section with empty heading -> warning (HUMAN_REVIEW)
10. Topic code format valid -> passes
"""

from __future__ import annotations

import pytest

from src.validators.derivative_validators import (
    DerivativeVerdict,
    LegalDocumentSectionSnapshot,
    LegalDocumentSnapshot,
)
from src.validators.derivative_validators.subject_outline_validator import (
    SubjectOutlineValidator,
)

# ---------------------------------------------------------------------------
# Fixtures & Helpers
# ---------------------------------------------------------------------------

FAKE_SOURCE_DOC = LegalDocumentSnapshot(
    id="doc-001",
    title="Republic v. Sandiganbayan",
    document_type="case",
    citation_text="G.R. No. 123456",
    court="Supreme Court",
    decision_date="2025-01-01",
    confidence_score=0.9,
)

FAKE_SECTIONS = [
    LegalDocumentSectionSnapshot(
        id="sec-001",
        section_type="body",
        plain_text="Doctrine of command responsibility applies to civilian officials.",
        page_start=1,
        page_end=5,
    ),
    LegalDocumentSectionSnapshot(
        id="sec-002",
        section_type="body",
        plain_text="WHEREFORE, the petition is GRANTED.",
        page_start=5,
        page_end=6,
    ),
    LegalDocumentSectionSnapshot(
        id="sec-003",
        section_type="body",
        plain_text="The elements of estafa under Article 315.",
        page_start=6,
        page_end=8,
    ),
]


def _make_section(index: int, heading: str | None = None) -> dict:
    """Create a valid outline section dict.

    Alternates between citing internal sections (sec-001..sec-003) and
    external sections (ext-sec-001) to simulate multi-document outlines.
    """
    # Alternate: even indices cite internal sections, odd cite external
    if index % 2 == 0:
        cited = [f"sec-00{(index % 3) + 1}"]
    else:
        cited = ["ext-sec-001"]

    return {
        "heading": heading or f"Section {index + 1}: Legal Principles",
        "subjectTopicCode": "civil_law.obligations_contracts" if index == 0 else None,
        "paragraphs": [
            f"The law states that officials have duties under section {index + 1}.",
            f"This principle is derived from the source material in section {index + 1}.",
        ],
        "citedSectionIds": cited,
        "subSections": [
            {
                "heading": f"Sub-section {index + 1}.1",
                "paragraphs": [f"Additional detail for section {index + 1}."],
                "citedSectionIds": cited,
            },
        ],
    }


def _make_content(overrides: dict | None = None) -> dict:
    base = {
        "sections": [_make_section(i) for i in range(5)],
        "abstain": False,
        "abstainReason": None,
    }
    if overrides:
        base.update(overrides)
    return base


def _validate(content: dict, source_sections: list | None = None) -> object:
    validator = SubjectOutlineValidator()
    return validator.validate(
        derivative_type="subject_outline",
        content=content,
        source_document=FAKE_SOURCE_DOC,
        source_sections=source_sections or FAKE_SECTIONS,
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestSubjectOutlineValidator:
    """Tests for the SubjectOutlineValidator."""

    def test_1_happy_path_publish(self) -> None:
        """5 sections, each with paragraphs -> PUBLISH."""
        content = _make_content()
        result = _validate(content)

        assert result.verdict == DerivativeVerdict.PUBLISH
        assert len(result.reasons) == 0

    def test_2_abstain_quarantine(self) -> None:
        """Abstain -> QUARANTINE."""
        content = _make_content({
            "abstain": True,
            "abstainReason": "Insufficient source material",
        })
        result = _validate(content)

        assert result.verdict == DerivativeVerdict.QUARANTINE
        assert any("abstained" in r.lower() for r in result.reasons)

    def test_3_too_few_sections_quarantine(self) -> None:
        """< 3 sections -> QUARANTINE."""
        content = _make_content({"sections": [_make_section(0), _make_section(1)]})
        result = _validate(content)

        assert result.verdict == DerivativeVerdict.QUARANTINE
        assert any("2 sections" in r and "min 3" in r for r in result.reasons)

    def test_4_too_many_sections_warning(self) -> None:
        """> 30 sections -> warning (HUMAN_REVIEW)."""
        content = _make_content({"sections": [_make_section(i) for i in range(31)]})
        result = _validate(content)

        assert result.verdict == DerivativeVerdict.HUMAN_REVIEW
        assert any("31 sections" in r and "max 30" in r for r in result.reasons)

    def test_5_empty_heading_quarantine(self) -> None:
        """Empty heading -> error (QUARANTINE)."""
        sections = [_make_section(i) for i in range(5)]
        sections[2]["heading"] = ""
        content = _make_content({"sections": sections})
        result = _validate(content)

        assert result.verdict == DerivativeVerdict.QUARANTINE
        assert any("empty heading" in r for r in result.reasons)

    def test_6_no_paragraphs_quarantine(self) -> None:
        """Section with no paragraphs -> error (QUARANTINE)."""
        sections = [_make_section(i) for i in range(5)]
        sections[1]["paragraphs"] = []
        content = _make_content({"sections": sections})
        result = _validate(content)

        assert result.verdict == DerivativeVerdict.QUARANTINE
        assert any("no paragraphs" in r for r in result.reasons)

    def test_7_cross_doc_coverage_met(self) -> None:
        """Cross-doc coverage met (>= 2 sources) -> passes."""
        # Create sections that cite both known IDs and unknown IDs
        # (unknown IDs imply other documents)
        sections = [_make_section(i) for i in range(5)]
        sections[0]["citedSectionIds"] = ["sec-001"]
        sections[1]["citedSectionIds"] = ["external-sec-001"]  # Not in source_sections
        content = _make_content({"sections": sections})
        result = _validate(content)

        assert result.verdict == DerivativeVerdict.PUBLISH

    def test_8_cross_doc_coverage_failed_warning(self) -> None:
        """Cross-doc coverage failed (1 source only) -> warning (HUMAN_REVIEW)."""
        # All cited section IDs are from the same source
        sections = [_make_section(i) for i in range(5)]
        for s in sections:
            s["citedSectionIds"] = ["sec-001"]
            s["subSections"] = []
        content = _make_content({"sections": sections})
        result = _validate(content)

        assert result.verdict == DerivativeVerdict.HUMAN_REVIEW
        assert any("1 source document" in r for r in result.reasons)

    def test_9_subsection_empty_heading_warning(self) -> None:
        """Sub-section with empty heading -> warning (HUMAN_REVIEW)."""
        sections = [_make_section(i) for i in range(5)]
        sections[0]["subSections"] = [
            {
                "heading": "",
                "paragraphs": ["Some text"],
                "citedSectionIds": ["sec-001"],
            },
        ]
        content = _make_content({"sections": sections})
        result = _validate(content)

        assert result.verdict == DerivativeVerdict.HUMAN_REVIEW
        assert any("empty heading" in r for r in result.reasons)

    def test_10_topic_code_format_valid(self) -> None:
        """Topic code format valid -> passes (PUBLISH)."""
        sections = [_make_section(i) for i in range(5)]
        sections[0]["subjectTopicCode"] = "criminal_law.revised_penal_code"
        sections[1]["subjectTopicCode"] = "civil_law.obligations_contracts"
        content = _make_content({"sections": sections})
        result = _validate(content)

        assert result.verdict == DerivativeVerdict.PUBLISH
