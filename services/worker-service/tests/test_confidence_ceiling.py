"""Regression guard: a well-grounded artifact must be able to clear 0.70.

Every one of these types was structurally incapable of reaching the 0.70
auto-approval bar until 2026-07-26, because source_passage_coverage divided
by every section of the source document. An artifact smaller than its source
could not push that term up: measured on prod, the per-type maxima were
flashcard 0.692, essay_prompt 0.688, doctrine_extract 0.667 and
subject_outline 0.655 — each exactly 0.5 + coverage * 0.5, with citation
mapping and OCR already perfect. POST /admin/derivatives/bulk-approve-by-
confidence returned 0 candidates at any threshold >= 0.70.

The shapes below are deliberately prod-like rather than minimal: a 40-section
source document with a handful of well-cited items, which is the exact
geometry the old denominator punished. Each test states what the OLD formula
would have produced, so a re-introduced document-wide denominator fails here
instead of silently emptying the approval queue again.

The threshold itself is not under test and must not be changed to make these
pass — see CLAUDE.md "Digest Generation".
"""

from __future__ import annotations

from typing import Any

from src.scoring import (
    SECTIONS_PER_ITEM,
    compute_doctrine_confidence_score,
    compute_essay_confidence_score,
    compute_flashcard_confidence_score,
    compute_mcq_confidence_score,
    compute_outline_confidence_score,
    compute_source_passage_coverage,
)

# The auto-approval bar from CLAUDE.md, mirrored here as a read-only
# expectation. Do not lower this to make a test pass.
AUTO_APPROVAL_THRESHOLD = 0.7

# A 40-section source document — large enough that "cited / all sections"
# cannot clear the bar for any small artifact.
LARGE_SOURCE: list[dict[str, Any]] = [
    {"id": f"sec-{i:03d}", "plain_text": f"Section {i} text."} for i in range(40)
]


def _sid(i: int) -> str:
    return f"sec-{i:03d}"


class TestWellGroundedArtifactsClearTheBar:
    """One per persisted derivative type."""

    def test_flashcard(self) -> None:
        """5 cards, each grounded in its own section of a 40-section source."""
        content: dict[str, Any] = {
            "cards": [
                {"front": f"Q{i}", "back": f"A{i}", "supportingSectionIds": [_sid(i)]}
                for i in range(5)
            ],
        }
        score = compute_flashcard_confidence_score(
            content=content,
            source_sections=LARGE_SOURCE,
        )
        # citable = min(40, 5*2) = 10; cited = 5 -> coverage 0.5
        # 0.5*0.5 + 1.0*0.3 + 1.0*0.2 = 0.75
        # OLD: 5/40 = 0.125 -> 0.5625, permanently ineligible.
        assert score >= AUTO_APPROVAL_THRESHOLD
        assert score == 0.75

    def test_essay_prompt(self) -> None:
        """6 model-answer outline sections, each citing its own source section."""
        content: dict[str, Any] = {
            "modelAnswer": {
                "outlineSections": [
                    {"heading": f"H{i}", "citedSectionIds": [_sid(i)]}
                    for i in range(6)
                ],
            },
        }
        score = compute_essay_confidence_score(
            content=content,
            source_sections=LARGE_SOURCE,
        )
        # citable = min(40, 6*2) = 12; cited = 6 -> coverage 0.5 -> 0.75
        # OLD: 6/40 = 0.15 -> 0.575
        assert score >= AUTO_APPROVAL_THRESHOLD
        assert score == 0.75

    def test_mcq_question(self) -> None:
        """10 questions, each grounded in its own section."""
        content: dict[str, Any] = {
            "questions": [
                {"questionStem": f"Q{i}", "supportingSectionIds": [_sid(i)]}
                for i in range(10)
            ],
        }
        score = compute_mcq_confidence_score(
            content=content,
            source_sections=LARGE_SOURCE,
        )
        # citable = min(40, 10*2) = 20; cited = 10 -> coverage 0.5 -> 0.75
        # OLD: 10/40 = 0.25 -> 0.625. MCQ cleared the bar in prod only
        # because real sets are larger; the formula was still capping it.
        assert score >= AUTO_APPROVAL_THRESHOLD
        assert score == 0.75

    def test_doctrine_extract(self) -> None:
        """4 doctrines, each carrying its single source_section_id."""
        content: dict[str, Any] = {
            "doctrines": [
                {"text": f"doctrine {i}", "source_section_id": _sid(i)}
                for i in range(4)
            ],
        }
        score = compute_doctrine_confidence_score(
            content=content,
            source_sections=LARGE_SOURCE,
        )
        # One ID per doctrine, so citable = min(40, 4*1) = 4; cited = 4 ->
        # coverage 1.0 -> 1.0. OLD: 4/40 = 0.1 -> 0.55.
        assert score >= AUTO_APPROVAL_THRESHOLD
        assert score == 1.0

    def test_subject_outline(self) -> None:
        """3 top-level sections with 1 subsection each, all cited."""
        content: dict[str, Any] = {
            "sections": [
                {
                    "heading": f"Top {i}",
                    "citedSectionIds": [_sid(i * 2)],
                    "subSections": [
                        {"heading": f"Sub {i}.1", "citedSectionIds": [_sid(i * 2 + 1)]},
                    ],
                }
                for i in range(3)
            ],
        }
        score = compute_outline_confidence_score(
            content=content,
            source_sections=LARGE_SOURCE,
        )
        # 6 walked nodes -> citable = min(40, 6*2) = 12; cited = 6 ->
        # coverage 0.5 -> 0.75. OLD: 6/40 = 0.15 -> 0.575.
        assert score >= AUTO_APPROVAL_THRESHOLD
        assert score == 0.75


class TestPoorlyGroundedArtifactsStillFail:
    """The bar still has to mean something."""

    def test_mostly_ungrounded_flashcards_stay_below(self) -> None:
        """5 cards, only 1 with a valid citation -> nowhere near the bar."""
        content: dict[str, Any] = {
            "cards": [
                {"front": "Q0", "back": "A0", "supportingSectionIds": [_sid(0)]},
                {"front": "Q1", "back": "A1", "supportingSectionIds": []},
                {"front": "Q2", "back": "A2", "supportingSectionIds": ["INVALID"]},
                {"front": "Q3", "back": "A3", "supportingSectionIds": []},
                {"front": "Q4", "back": "A4", "supportingSectionIds": None},
            ],
        }
        score = compute_flashcard_confidence_score(
            content=content,
            source_sections=LARGE_SOURCE,
        )
        # coverage 1/10 = 0.1, citation 1/5 = 0.2 -> 0.05 + 0.06 + 0.2 = 0.31
        assert score < AUTO_APPROVAL_THRESHOLD
        assert score == 0.31

    def test_hallucinated_citations_earn_nothing(self) -> None:
        """Section IDs that do not exist in the source contribute zero."""
        content: dict[str, Any] = {
            "questions": [
                {"questionStem": f"Q{i}", "supportingSectionIds": ["sec-999"]}
                for i in range(10)
            ],
        }
        score = compute_mcq_confidence_score(
            content=content,
            source_sections=LARGE_SOURCE,
        )
        # No valid citations: coverage 0, citation 0, ocr 1.0 -> 0.2
        assert score < AUTO_APPROVAL_THRESHOLD
        assert score == 0.2

    def test_poor_ocr_can_still_sink_a_grounded_artifact(self) -> None:
        """The OCR term is untouched by this change and still gates scans."""
        content: dict[str, Any] = {
            "cards": [
                {"front": f"Q{i}", "back": f"A{i}", "supportingSectionIds": [_sid(i)]}
                for i in range(5)
            ],
        }
        score = compute_flashcard_confidence_score(
            content=content,
            source_sections=LARGE_SOURCE,
            ocr_quality=0.3,
        )
        # 0.5*0.5 + 1.0*0.3 + 0.3*0.2 = 0.61
        assert score < AUTO_APPROVAL_THRESHOLD
        assert score == 0.61


class TestCoverageDenominator:
    """The helper's own semantics."""

    def test_document_size_bounds_the_denominator(self) -> None:
        """A large artifact over a small document is judged on the document."""
        # 30 items would allow 60 sections, but the document only has 3.
        coverage = compute_source_passage_coverage(
            cited_section_count=3,
            item_count=30,
            source_section_count=3,
        )
        assert coverage == 1.0

    def test_item_count_bounds_the_denominator(self) -> None:
        """A small artifact over a large document is judged on its items."""
        coverage = compute_source_passage_coverage(
            cited_section_count=4,
            item_count=2,
            source_section_count=400,
        )
        # citable = min(400, 2*2) = 4 -> fully covered
        assert coverage == 1.0

    def test_over_citing_clamps_to_one(self) -> None:
        """More distinct citations than the allowance never exceeds 1.0."""
        coverage = compute_source_passage_coverage(
            cited_section_count=25,
            item_count=2,
            source_section_count=400,
        )
        assert coverage == 1.0

    def test_empty_inputs_are_zero_not_a_crash(self) -> None:
        assert compute_source_passage_coverage(
            cited_section_count=0, item_count=5, source_section_count=40
        ) == 0.0
        assert compute_source_passage_coverage(
            cited_section_count=5, item_count=0, source_section_count=40
        ) == 0.0
        assert compute_source_passage_coverage(
            cited_section_count=5, item_count=5, source_section_count=0
        ) == 0.0

    def test_zero_sections_per_item_is_treated_as_one(self) -> None:
        """A misconfigured allowance must not divide by zero."""
        coverage = compute_source_passage_coverage(
            cited_section_count=2,
            item_count=4,
            source_section_count=40,
            sections_per_item=0,
        )
        # max(0, 1) = 1 -> citable = 4 -> 2/4
        assert coverage == 0.5

    def test_default_allowance_is_two(self) -> None:
        """Pinned so a change to the constant is a deliberate edit."""
        assert SECTIONS_PER_ITEM == 2
