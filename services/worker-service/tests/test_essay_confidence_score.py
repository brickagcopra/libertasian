"""Tests for essay derivative confidence score computation.

Tests both the generic compute_derivative_confidence_score and the
essay-specific compute_essay_confidence_score helper.
"""

from __future__ import annotations

from typing import Any

import pytest

from src.scoring import (
    CITATION_MAPPING_COMPLETENESS_WEIGHT,
    OCR_QUALITY_WEIGHT,
    SOURCE_PASSAGE_COVERAGE_WEIGHT,
    compute_derivative_confidence_score,
    compute_essay_confidence_score,
)

# ---------------------------------------------------------------------------
# compute_derivative_confidence_score (generic)
# ---------------------------------------------------------------------------


class TestComputeDerivativeConfidenceScore:
    """Tests for the generic weighted-average scoring function."""

    def test_all_zero_returns_zero(self) -> None:
        """All signals at 0 -> score is 0.0."""
        score = compute_derivative_confidence_score(
            source_passage_coverage=0.0,
            citation_mapping_completeness=0.0,
            ocr_quality=0.0,
        )
        assert score == 0.0

    def test_all_maxed_returns_one(self) -> None:
        """All signals at 1.0 -> score is 1.0."""
        score = compute_derivative_confidence_score(
            source_passage_coverage=1.0,
            citation_mapping_completeness=1.0,
            ocr_quality=1.0,
        )
        assert score == 1.0

    def test_weights_sum_to_one(self) -> None:
        """Weight constants sum to 1.0 — ensures all-maxed gives exactly 1.0."""
        total = (
            SOURCE_PASSAGE_COVERAGE_WEIGHT
            + CITATION_MAPPING_COMPLETENESS_WEIGHT
            + OCR_QUALITY_WEIGHT
        )
        assert total == pytest.approx(1.0)

    def test_good_case_in_expected_range(self) -> None:
        """Good signals -> score in 0.7-0.9 range."""
        score = compute_derivative_confidence_score(
            source_passage_coverage=0.8,
            citation_mapping_completeness=0.75,
            ocr_quality=0.95,
        )
        # 0.8*0.5 + 0.75*0.3 + 0.95*0.2 = 0.4 + 0.225 + 0.19 = 0.815
        assert score == 0.815
        assert 0.7 <= score <= 0.9

    def test_deterministic(self) -> None:
        """Same inputs always produce the same output."""
        kwargs: dict[str, float] = {
            "source_passage_coverage": 0.6,
            "citation_mapping_completeness": 0.8,
            "ocr_quality": 0.9,
        }
        scores = [compute_derivative_confidence_score(**kwargs) for _ in range(10)]
        assert all(s == scores[0] for s in scores)

    def test_inputs_clamped_above_one(self) -> None:
        """Inputs > 1.0 are clamped to 1.0."""
        score = compute_derivative_confidence_score(
            source_passage_coverage=1.5,
            citation_mapping_completeness=2.0,
            ocr_quality=3.0,
        )
        assert score == 1.0

    def test_negative_inputs_clamped_to_zero(self) -> None:
        """Negative inputs are clamped to 0.0."""
        score = compute_derivative_confidence_score(
            source_passage_coverage=-0.5,
            citation_mapping_completeness=-1.0,
            ocr_quality=-0.1,
        )
        assert score == 0.0

    def test_only_ocr_quality(self) -> None:
        """Zero coverage + zero citation + full OCR -> only OCR weight."""
        score = compute_derivative_confidence_score(
            source_passage_coverage=0.0,
            citation_mapping_completeness=0.0,
            ocr_quality=1.0,
        )
        assert score == OCR_QUALITY_WEIGHT  # 0.2

    def test_default_ocr_quality_is_one(self) -> None:
        """OCR quality defaults to 1.0 when not specified."""
        score = compute_derivative_confidence_score(
            source_passage_coverage=0.0,
            citation_mapping_completeness=0.0,
        )
        assert score == OCR_QUALITY_WEIGHT  # 0.2


# ---------------------------------------------------------------------------
# compute_essay_confidence_score (essay-specific)
# ---------------------------------------------------------------------------

FAKE_SECTIONS: list[dict[str, Any]] = [
    {"id": "sec-001", "plain_text": "Section one text."},
    {"id": "sec-002", "plain_text": "Section two text."},
    {"id": "sec-003", "plain_text": "Section three text."},
]


class TestComputeEssayConfidenceScore:
    """Tests for essay-specific signal extraction + scoring."""

    def test_empty_content_and_sections(self) -> None:
        """Empty content + empty sections -> only OCR quality contributes.

        With default ocr_quality=1.0, score = 0*0.5 + 0*0.3 + 1.0*0.2 = 0.2.
        """
        score = compute_essay_confidence_score(
            content={},
            source_sections=[],
        )
        assert score == OCR_QUALITY_WEIGHT  # 0.2

    def test_empty_content_and_sections_zero_ocr(self) -> None:
        """Empty content + empty sections + zero OCR -> 0.0."""
        score = compute_essay_confidence_score(
            content={},
            source_sections=[],
            ocr_quality=0.0,
        )
        assert score == 0.0

    def test_full_coverage_all_cited(self) -> None:
        """All source sections cited, all outline sections have citations -> 1.0."""
        content: dict[str, Any] = {
            "modelAnswer": {
                "outlineSections": [
                    {"heading": "Answer", "citedSectionIds": ["sec-001"]},
                    {"heading": "Law", "citedSectionIds": ["sec-001", "sec-002"]},
                    {"heading": "Application", "citedSectionIds": ["sec-002", "sec-003"]},
                    {"heading": "Conclusion", "citedSectionIds": ["sec-003"]},
                ],
            },
        }
        sections = [
            {"id": "sec-001", "plain_text": "text"},
            {"id": "sec-002", "plain_text": "text"},
            {"id": "sec-003", "plain_text": "text"},
        ]
        score = compute_essay_confidence_score(
            content=content,
            source_sections=sections,
        )
        # coverage: 3/3=1.0, citation: 4/4=1.0, ocr: 1.0 -> 1.0
        assert score == 1.0

    def test_partial_coverage(self) -> None:
        """Some sections cited, one outline section with empty citations."""
        content: dict[str, Any] = {
            "modelAnswer": {
                "outlineSections": [
                    {"heading": "Answer", "citedSectionIds": ["sec-001"]},
                    {"heading": "Law", "citedSectionIds": ["sec-001"]},
                    {"heading": "Application", "citedSectionIds": []},
                    {"heading": "Conclusion", "citedSectionIds": ["sec-001"]},
                ],
            },
        }
        score = compute_essay_confidence_score(
            content=content,
            source_sections=FAKE_SECTIONS,
            ocr_quality=0.95,
        )
        # coverage: 1/3 = 0.3333, citation: 3/4 = 0.75, ocr: 0.95
        expected = round(
            (1 / 3) * 0.5 + 0.75 * 0.3 + 0.95 * 0.2, 4,
        )
        assert score == expected

    def test_invalid_section_ids_excluded(self) -> None:
        """Cited section IDs not in source are excluded from coverage."""
        content: dict[str, Any] = {
            "modelAnswer": {
                "outlineSections": [
                    {"heading": "Answer", "citedSectionIds": ["sec-001", "INVALID"]},
                    {"heading": "Law", "citedSectionIds": ["INVALID"]},
                ],
            },
        }
        sections = [{"id": "sec-001", "plain_text": "text"}]
        score = compute_essay_confidence_score(
            content=content,
            source_sections=sections,
        )
        # coverage: 1/1 = 1.0, citation: 2/2 = 1.0 (both have *some* citedSectionIds)
        # ocr: 1.0 -> 1.0
        assert score == 1.0

    def test_no_model_answer(self) -> None:
        """Content with no modelAnswer -> zero coverage + zero citation."""
        score = compute_essay_confidence_score(
            content={"promptText": "some prompt"},
            source_sections=FAKE_SECTIONS,
        )
        # coverage: 0/3 = 0, citation: 0/0 = 0, ocr: 1.0
        assert score == OCR_QUALITY_WEIGHT  # 0.2

    def test_deterministic(self) -> None:
        """Same inputs produce identical output every time."""
        content: dict[str, Any] = {
            "modelAnswer": {
                "outlineSections": [
                    {"heading": "Answer", "citedSectionIds": ["sec-001"]},
                    {"heading": "Law", "citedSectionIds": ["sec-002"]},
                ],
            },
        }
        sections = [
            {"id": "sec-001", "plain_text": "text"},
            {"id": "sec-002", "plain_text": "text"},
        ]
        scores = [
            compute_essay_confidence_score(
                content=content, source_sections=sections,
            )
            for _ in range(10)
        ]
        assert all(s == scores[0] for s in scores)

    def test_good_case_above_threshold(self) -> None:
        """Realistic good case -> score >= 0.7 (passes auto-approval threshold)."""
        content: dict[str, Any] = {
            "modelAnswer": {
                "outlineSections": [
                    {"heading": "Answer", "citedSectionIds": ["sec-001"]},
                    {"heading": "Law", "citedSectionIds": ["sec-001", "sec-002"]},
                    {"heading": "Application", "citedSectionIds": ["sec-002"]},
                    {"heading": "Conclusion", "citedSectionIds": ["sec-001"]},
                ],
            },
        }
        sections = [
            {"id": "sec-001", "plain_text": "text"},
            {"id": "sec-002", "plain_text": "text"},
        ]
        score = compute_essay_confidence_score(
            content=content,
            source_sections=sections,
            ocr_quality=0.95,
        )
        # coverage: 2/2=1.0, citation: 4/4=1.0, ocr: 0.95
        # 1.0*0.5 + 1.0*0.3 + 0.95*0.2 = 0.5 + 0.3 + 0.19 = 0.99
        assert score >= 0.7
        assert score == 0.99
