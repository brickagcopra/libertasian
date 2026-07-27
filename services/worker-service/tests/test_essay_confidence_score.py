"""Tests for essay derivative confidence score computation.

Tests both the generic compute_derivative_confidence_score and the
essay-specific compute_essay_confidence_score helper.
"""

from __future__ import annotations

from typing import Any

import pytest

from src.scoring import (
    CITATION_MAPPING_COMPLETENESS_WEIGHT,
    CITATION_MODE_PRESENCE,
    CITATION_MODE_VALIDATED,
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
        """An unresolvable ID counts for neither term.

        Before the citation term validated, this case scored 1.0: the "Law"
        section's list was non-empty, so it counted as cited even though
        nothing in it existed. That is what let 59.2% of live essay citation
        refs be fabricated while the term read 99.0% across the corpus.
        """
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
        # coverage: 1 valid id / min(1 section, 2 items * 2) = 1.0
        # citation: 1 of 2 outline sections cites something real = 0.5
        # ocr: 1.0
        expected = round(1.0 * 0.5 + 0.5 * 0.3 + 1.0 * 0.2, 4)
        assert score == expected == 0.85

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


# ---------------------------------------------------------------------------
# Citation mapping: validated vs presence
# ---------------------------------------------------------------------------


class TestCitationMappingValidatesIds:
    """The essay term must measure grounding, not output format.

    Measured on prod 2026-07-27: 39,992 of 67,515 essay citation refs (59.2%)
    resolved to no row in ``legal_document_sections``, none resolved to a
    section of a different document, and ``citation_mapping_completeness``
    still read 99.0% for the type. It was counting
    ``bool(section["citedSectionIds"])``.
    """

    SECTIONS = [
        {"id": "sec-001", "plain_text": "text"},
        {"id": "sec-002", "plain_text": "text"},
        {"id": "sec-003", "plain_text": "text"},
    ]

    def _content(self, cited: list[list[str]]) -> dict[str, Any]:
        return {
            "modelAnswer": {
                "outlineSections": [
                    {"heading": f"H{i}", "paragraphs": ["p"], "citedSectionIds": ids}
                    for i, ids in enumerate(cited)
                ],
            },
        }

    def test_wholly_fabricated_citations_score_the_ocr_floor(self) -> None:
        """Every section cites; nothing resolves. Both terms are zero."""
        fabricated = [
            ["1e0a1c2e-0000-4000-8000-000000000001"],
            ["1e0a1c2e-0000-4000-8000-000000000002"],
        ]
        score = compute_essay_confidence_score(
            content=self._content(fabricated),
            source_sections=self.SECTIONS,
        )
        # Only the constant OCR term survives.
        assert score == OCR_QUALITY_WEIGHT == 0.2

    def test_presence_mode_still_reads_the_old_value(self) -> None:
        """The reproduction path must recompute what was stored, not the truth.

        Same input as above. Under presence both lists are non-empty, so
        citation is 1.0 and the score is 0.5 — the value that landed in the
        column for rows like this, and the value rescore_derivatives must be
        able to reproduce before it may write.
        """
        fabricated = [
            ["1e0a1c2e-0000-4000-8000-000000000001"],
            ["1e0a1c2e-0000-4000-8000-000000000002"],
        ]
        score = compute_essay_confidence_score(
            content=self._content(fabricated),
            source_sections=self.SECTIONS,
            citation_mode=CITATION_MODE_PRESENCE,
        )
        assert score == round(
            0.0 * SOURCE_PASSAGE_COVERAGE_WEIGHT
            + 1.0 * CITATION_MAPPING_COMPLETENESS_WEIGHT
            + 1.0 * OCR_QUALITY_WEIGHT,
            4,
        )
        assert score == 0.5

    def test_validated_is_the_default(self) -> None:
        """No caller has to opt in to the correct behaviour."""
        fabricated = [["1e0a1c2e-0000-4000-8000-000000000001"]]
        assert compute_essay_confidence_score(
            content=self._content(fabricated),
            source_sections=self.SECTIONS,
        ) == compute_essay_confidence_score(
            content=self._content(fabricated),
            source_sections=self.SECTIONS,
            citation_mode=CITATION_MODE_VALIDATED,
        )

    def test_a_partially_fabricated_section_still_counts(self) -> None:
        """One real ID grounds the section; the junk beside it is ignored."""
        mixed = [["sec-001", "1e0a1c2e-0000-4000-8000-000000000001"]]
        score = compute_essay_confidence_score(
            content=self._content(mixed),
            source_sections=self.SECTIONS,
        )
        # coverage: 1 valid / min(3, 1 item * 2) = 0.5, citation: 1/1 = 1.0
        assert score == round(0.5 * 0.5 + 1.0 * 0.3 + 1.0 * 0.2, 4)

    def test_empty_lists_and_fabricated_lists_score_alike(self) -> None:
        """An invented ID buys nothing an honest blank would not.

        This is the property that makes the prompt change safe: telling the
        model it may leave citedSectionIds empty cannot lower a score below
        what inventing an ID would have produced.
        """
        blank = compute_essay_confidence_score(
            content=self._content([[], []]),
            source_sections=self.SECTIONS,
        )
        invented = compute_essay_confidence_score(
            content=self._content(
                [
                    ["1e0a1c2e-0000-4000-8000-000000000001"],
                    ["1e0a1c2e-0000-4000-8000-000000000002"],
                ]
            ),
            source_sections=self.SECTIONS,
        )
        assert blank == invented

    def test_a_grounded_essay_is_unaffected(self) -> None:
        """The change must not move scores for essays that cite honestly."""
        grounded = [["sec-001"], ["sec-002"], ["sec-003"]]
        score = compute_essay_confidence_score(
            content=self._content(grounded),
            source_sections=self.SECTIONS,
        )
        assert score == 1.0
        assert score == compute_essay_confidence_score(
            content=self._content(grounded),
            source_sections=self.SECTIONS,
            citation_mode=CITATION_MODE_PRESENCE,
        )
