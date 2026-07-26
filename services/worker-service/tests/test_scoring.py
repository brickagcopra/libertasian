"""Tests for per-type derivative confidence score extractors.

Covers compute_mcq_confidence_score, compute_doctrine_confidence_score,
and compute_outline_confidence_score. Mirrors the existing test cases
for compute_essay_confidence_score in test_essay_confidence_score.py.
"""

from __future__ import annotations

from typing import Any

from src.scoring import (
    compute_doctrine_confidence_score,
    compute_flashcard_confidence_score,
    compute_mcq_confidence_score,
    compute_outline_confidence_score,
    resolve_weights,
)

FAKE_SECTIONS: list[dict[str, Any]] = [
    {"id": "sec-001", "plain_text": "Section one text."},
    {"id": "sec-002", "plain_text": "Section two text."},
    {"id": "sec-003", "plain_text": "Section three text."},
]


# ---------------------------------------------------------------------------
# compute_mcq_confidence_score
# ---------------------------------------------------------------------------


class TestComputeMcqConfidenceScore:
    """Tests for MCQ-specific signal extraction + scoring."""

    def test_perfect_coverage_and_citations(self) -> None:
        """All source sections cited, every question has valid citations -> 1.0."""
        content: dict[str, Any] = {
            "questions": [
                {"questionStem": "Q1", "supportingSectionIds": ["sec-001"]},
                {"questionStem": "Q2", "supportingSectionIds": ["sec-002"]},
                {"questionStem": "Q3", "supportingSectionIds": ["sec-003"]},
            ],
        }
        score = compute_mcq_confidence_score(
            content=content,
            source_sections=FAKE_SECTIONS,
        )
        # coverage: 3/3=1.0, citation: 3/3=1.0, ocr: 1.0 -> 1.0
        assert score == 1.0

    def test_zero_citations_ocr_only(self) -> None:
        """Questions present but none with valid citations -> ocr weight only."""
        content: dict[str, Any] = {
            "questions": [
                {"questionStem": "Q1", "supportingSectionIds": []},
                {"questionStem": "Q2", "supportingSectionIds": ["INVALID"]},
            ],
        }
        score = compute_mcq_confidence_score(
            content=content,
            source_sections=FAKE_SECTIONS,
        )
        # coverage 0, citation 0, ocr 1.0 -> the 3-section OCR weight
        assert score == round(resolve_weights(3)[2], 4)

    def test_no_source_sections_ocr_only(self) -> None:
        """Empty source sections + empty content -> ocr weight only."""
        score = compute_mcq_confidence_score(
            content={},
            source_sections=[],
        )
        assert score == round(resolve_weights(0)[2], 4)

    def test_malformed_content_graceful(self) -> None:
        """Non-dict / non-list shapes are handled gracefully without crashing."""
        score = compute_mcq_confidence_score(
            content={"questions": "not-a-list"},  # type: ignore[dict-item]
            source_sections=FAKE_SECTIONS,
        )
        # coverage 0, citation 0, ocr 1.0 -> the 3-section OCR weight
        assert score == round(resolve_weights(3)[2], 4)

        score2 = compute_mcq_confidence_score(
            content={"questions": [None, "str", 42, {"supportingSectionIds": None}]},
            source_sections=FAKE_SECTIONS,
        )
        # non-dict questions are skipped; the 1 dict has no valid citations.
        assert score2 == round(resolve_weights(3)[2], 4)


# ---------------------------------------------------------------------------
# compute_doctrine_confidence_score
# ---------------------------------------------------------------------------


class TestComputeDoctrineConfidenceScore:
    """Tests for doctrine-specific signal extraction + scoring."""

    def test_perfect_coverage_and_citations(self) -> None:
        """All source sections cited, every doctrine has a valid section_id -> 1.0."""
        content: dict[str, Any] = {
            "doctrines": [
                {"text": "doctrine 1", "source_section_id": "sec-001"},
                {"text": "doctrine 2", "source_section_id": "sec-002"},
                {"text": "doctrine 3", "source_section_id": "sec-003"},
            ],
        }
        score = compute_doctrine_confidence_score(
            content=content,
            source_sections=FAKE_SECTIONS,
        )
        # coverage: 3/3=1.0, citation: 3/3=1.0, ocr: 1.0 -> 1.0
        assert score == 1.0

    def test_zero_citations_ocr_only(self) -> None:
        """Doctrines present but none with valid section_id -> ocr weight only."""
        content: dict[str, Any] = {
            "doctrines": [
                {"text": "doctrine 1", "source_section_id": "INVALID"},
                {"text": "doctrine 2"},
                {"text": "doctrine 3", "source_section_id": None},
            ],
        }
        score = compute_doctrine_confidence_score(
            content=content,
            source_sections=FAKE_SECTIONS,
        )
        # coverage 0, citation 0, ocr 1.0 -> the 3-section OCR weight
        assert score == round(resolve_weights(3)[2], 4)

    def test_no_source_sections_ocr_only(self) -> None:
        """Empty source sections + empty content -> ocr weight only."""
        score = compute_doctrine_confidence_score(
            content={},
            source_sections=[],
        )
        assert score == round(resolve_weights(0)[2], 4)

    def test_malformed_content_graceful(self) -> None:
        """Non-dict / non-list shapes are handled gracefully without crashing."""
        score = compute_doctrine_confidence_score(
            content={"doctrines": "not-a-list"},  # type: ignore[dict-item]
            source_sections=FAKE_SECTIONS,
        )
        assert score == round(resolve_weights(3)[2], 4)

        score2 = compute_doctrine_confidence_score(
            content={"doctrines": [None, "str", 42, {}]},
            source_sections=FAKE_SECTIONS,
        )
        # non-dict doctrines skipped; the 1 dict has no section_id.
        assert score2 == round(resolve_weights(3)[2], 4)


# ---------------------------------------------------------------------------
# compute_outline_confidence_score
# ---------------------------------------------------------------------------


class TestComputeOutlineConfidenceScore:
    """Tests for outline-specific signal extraction + scoring."""

    def test_perfect_coverage_and_citations(self) -> None:
        """All sections (incl. subSections) cite valid IDs covering all sources -> 1.0."""
        content: dict[str, Any] = {
            "sections": [
                {
                    "heading": "Top 1",
                    "citedSectionIds": ["sec-001"],
                    "subSections": [
                        {"heading": "Sub 1.1", "citedSectionIds": ["sec-002"]},
                    ],
                },
                {
                    "heading": "Top 2",
                    "citedSectionIds": ["sec-003"],
                    "subSections": [],
                },
            ],
        }
        score = compute_outline_confidence_score(
            content=content,
            source_sections=FAKE_SECTIONS,
        )
        # coverage: 3/3=1.0, citation: 3/3 nodes cited=1.0, ocr: 1.0 -> 1.0
        assert score == 1.0

    def test_zero_citations_ocr_only(self) -> None:
        """Outline sections present but none with valid citations -> ocr weight only."""
        content: dict[str, Any] = {
            "sections": [
                {
                    "heading": "Top 1",
                    "citedSectionIds": [],
                    "subSections": [
                        {"heading": "Sub 1.1", "citedSectionIds": ["INVALID"]},
                    ],
                },
            ],
        }
        score = compute_outline_confidence_score(
            content=content,
            source_sections=FAKE_SECTIONS,
        )
        # coverage 0, citation 0, ocr 1.0 -> the 3-section OCR weight
        assert score == round(resolve_weights(3)[2], 4)

    def test_no_source_sections_ocr_only(self) -> None:
        """Empty source sections + empty content -> ocr weight only."""
        score = compute_outline_confidence_score(
            content={},
            source_sections=[],
        )
        assert score == round(resolve_weights(0)[2], 4)

    def test_malformed_content_graceful(self) -> None:
        """Non-dict / non-list shapes are handled gracefully without crashing."""
        score = compute_outline_confidence_score(
            content={"sections": "not-a-list"},  # type: ignore[dict-item]
            source_sections=FAKE_SECTIONS,
        )
        assert score == round(resolve_weights(3)[2], 4)

        score2 = compute_outline_confidence_score(
            content={
                "sections": [
                    None,
                    "str",
                    42,
                    {"subSections": [None, {"citedSectionIds": None}]},
                ],
            },
            source_sections=FAKE_SECTIONS,
        )
        # non-dict top-level entries skipped; the 1 dict + its 1 dict sub-section
        # contribute 0 valid citations each.
        assert score2 == round(resolve_weights(3)[2], 4)

    def test_partial_coverage_walks_subsections(self) -> None:
        """Mix of valid + invalid citations at both levels computes correctly."""
        content: dict[str, Any] = {
            "sections": [
                {
                    "heading": "Top 1",
                    "citedSectionIds": ["sec-001", "INVALID"],
                    "subSections": [
                        {"heading": "Sub 1.1", "citedSectionIds": ["sec-002"]},
                        {"heading": "Sub 1.2", "citedSectionIds": []},
                    ],
                },
                {
                    "heading": "Top 2",
                    "citedSectionIds": [],
                    "subSections": [],
                },
            ],
        }
        score = compute_outline_confidence_score(
            content=content,
            source_sections=FAKE_SECTIONS,
            ocr_quality=0.95,
        )
        # Total nodes: 4 (Top 1, Top 2, Sub 1.1, Sub 1.2)
        # Cited nodes (>=1 valid): Top 1 (sec-001) + Sub 1.1 (sec-002) = 2
        # Unique valid cited ids across tree: {sec-001, sec-002} -> 2 / 3
        coverage = 2 / 3
        citation = 2 / 4
        cov_w, cite_w, ocr_w = resolve_weights(3)
        expected = round(coverage * cov_w + citation * cite_w + 0.95 * ocr_w, 4)
        assert score == expected


# ---------------------------------------------------------------------------
# compute_flashcard_confidence_score
# ---------------------------------------------------------------------------


class TestComputeFlashcardConfidenceScore:
    """Tests for flashcard-specific signal extraction + scoring (mirrors MCQ)."""

    def test_perfect_coverage_and_citations(self) -> None:
        """All source sections cited, every card has valid citations -> 1.0."""
        content: dict[str, Any] = {
            "cards": [
                {"front": "Q1", "back": "A1", "supportingSectionIds": ["sec-001"]},
                {"front": "Q2", "back": "A2", "supportingSectionIds": ["sec-002"]},
                {"front": "Q3", "back": "A3", "supportingSectionIds": ["sec-003"]},
            ],
        }
        score = compute_flashcard_confidence_score(
            content=content,
            source_sections=FAKE_SECTIONS,
        )
        # coverage: 3/3=1.0, citation: 3/3=1.0, ocr: 1.0 -> 1.0
        assert score == 1.0

    def test_zero_citations_ocr_only(self) -> None:
        """Cards present but none with valid citations -> ocr weight only."""
        content: dict[str, Any] = {
            "cards": [
                {"front": "Q1", "back": "A1", "supportingSectionIds": []},
                {"front": "Q2", "back": "A2", "supportingSectionIds": ["INVALID"]},
            ],
        }
        score = compute_flashcard_confidence_score(
            content=content,
            source_sections=FAKE_SECTIONS,
        )
        # coverage 0, citation 0, ocr 1.0 -> the 3-section OCR weight
        assert score == round(resolve_weights(3)[2], 4)

    def test_no_source_sections_ocr_only(self) -> None:
        """Empty source sections + empty content -> ocr weight only."""
        score = compute_flashcard_confidence_score(
            content={},
            source_sections=[],
        )
        assert score == round(resolve_weights(0)[2], 4)

    def test_malformed_content_graceful(self) -> None:
        """Non-dict / non-list shapes are handled gracefully without crashing."""
        score = compute_flashcard_confidence_score(
            content={"cards": "not-a-list"},  # type: ignore[dict-item]
            source_sections=FAKE_SECTIONS,
        )
        assert score == round(resolve_weights(3)[2], 4)

        score2 = compute_flashcard_confidence_score(
            content={"cards": [None, "str", 42, {"supportingSectionIds": None}]},
            source_sections=FAKE_SECTIONS,
        )
        # non-dict cards are skipped; the 1 dict has no valid citations.
        assert score2 == round(resolve_weights(3)[2], 4)
