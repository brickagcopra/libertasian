"""The coverage-weight taper for short sources.

Measured on prod 2026-07-26: source documents average **3.4 sections** (mcq
3.4, essay 3.4, flashcard 3.4, doctrine 4.4). At that size coverage can only
take a handful of values, so `coverage*0.5 + citation*0.3 + ocr*0.2` on a
3-section source can only produce 0.5 / 0.667 / 0.833 / 1.0 and the 0.70 bar
reduces to "cite 2 of the 3 sections" — a section count, not a grounding
measure.

These tests pin the taper's shape and its invariants. The fixtures here are
deliberately SHORT, unlike the 40-section fixture that let #313 look correct
while moving 7 rows on the real corpus.
"""

from __future__ import annotations

from typing import Any

import pytest

from src.scoring import (
    CITATION_MAPPING_COMPLETENESS_WEIGHT,
    COVERAGE_MODE_DOCUMENT,
    COVERAGE_WEIGHT_FLOOR_AT_SECTIONS,
    COVERAGE_WEIGHT_FULL_AT_SECTIONS,
    MIN_SOURCE_PASSAGE_COVERAGE_WEIGHT,
    OCR_QUALITY_WEIGHT,
    SOURCE_PASSAGE_COVERAGE_WEIGHT,
    compute_derivative_confidence_score,
    compute_flashcard_confidence_score,
    resolve_weights,
)

AUTO_APPROVAL_THRESHOLD = 0.7

# The corpus shape: three large sections.
SHORT_SOURCE: list[dict[str, Any]] = [
    {"id": f"sec-{i:03d}", "plain_text": f"Section {i} body."} for i in range(3)
]


def _deck(cited_sections: list[int], cards: int = 5) -> dict[str, Any]:
    """A deck of `cards` cards; card i cites cited_sections[i] when present."""
    return {
        "cards": [
            {
                "front": f"Q{i}",
                "back": f"A{i}",
                "supportingSectionIds": (
                    [f"sec-{cited_sections[i]:03d}"] if i < len(cited_sections) else []
                ),
            }
            for i in range(cards)
        ],
    }


class TestWeightsAlwaysSumToOne:
    @pytest.mark.parametrize("sections", [0, 1, 2, 3, 4, 5, 7, 9, 10, 11, 40, 500])
    def test_sum_is_one(self, sections: int) -> None:
        assert sum(resolve_weights(sections)) == pytest.approx(1.0)

    def test_static_weights_sum_to_one(self) -> None:
        assert sum(resolve_weights(None)) == pytest.approx(1.0)


class TestTaperShape:
    def test_long_sources_are_unaffected(self) -> None:
        """The documented weights still apply where coverage means something."""
        for sections in (COVERAGE_WEIGHT_FULL_AT_SECTIONS, 20, 40, 500):
            assert resolve_weights(sections) == (
                SOURCE_PASSAGE_COVERAGE_WEIGHT,
                CITATION_MAPPING_COMPLETENESS_WEIGHT,
                OCR_QUALITY_WEIGHT,
            )

    def test_floor_applies_at_and_below_the_floor_section_count(self) -> None:
        for sections in range(0, COVERAGE_WEIGHT_FLOOR_AT_SECTIONS + 1):
            coverage_w, _cite, _ocr = resolve_weights(sections)
            assert coverage_w == MIN_SOURCE_PASSAGE_COVERAGE_WEIGHT

    def test_the_band_interpolates_rather_than_stepping(self) -> None:
        """A cliff mid-corpus would score neighbouring documents differently."""
        weights = [
            resolve_weights(s)[0]
            for s in range(
                COVERAGE_WEIGHT_FLOOR_AT_SECTIONS, COVERAGE_WEIGHT_FULL_AT_SECTIONS + 1
            )
        ]
        # strictly increasing, and no single step carries most of the range
        assert all(b > a for a, b in zip(weights, weights[1:], strict=False))
        largest_step = max(b - a for a, b in zip(weights, weights[1:], strict=False))
        assert largest_step < (
            SOURCE_PASSAGE_COVERAGE_WEIGHT - MIN_SOURCE_PASSAGE_COVERAGE_WEIGHT
        ) / 2

    def test_coverage_never_gains_weight(self) -> None:
        for sections in range(0, 40):
            assert resolve_weights(sections)[0] <= SOURCE_PASSAGE_COVERAGE_WEIGHT

    def test_freed_weight_keeps_the_citation_to_ocr_ratio(self) -> None:
        _cov, cite, ocr = resolve_weights(3)
        assert cite / ocr == pytest.approx(
            CITATION_MAPPING_COMPLETENESS_WEIGHT / OCR_QUALITY_WEIGHT
        )


class TestWhatTheBarNowMeasures:
    """The point of the change: grounding, not section count."""

    def test_a_deck_grounded_in_one_of_three_sections_can_pass(self) -> None:
        """The case brick described: 5 cards about one holding."""
        score = compute_flashcard_confidence_score(
            content=_deck([0, 0, 0, 0, 0]),
            source_sections=SHORT_SOURCE,
        )
        assert score >= AUTO_APPROVAL_THRESHOLD

    def test_the_same_deck_failed_under_the_old_weights(self) -> None:
        """Regression direction check, using the pre-taper weights directly."""
        old = compute_derivative_confidence_score(
            source_passage_coverage=1 / 3,
            citation_mapping_completeness=1.0,
            ocr_quality=1.0,
        )
        assert old < AUTO_APPROVAL_THRESHOLD

    def test_a_mostly_ungrounded_deck_still_fails(self) -> None:
        """Only 1 of 5 cards cites anything real."""
        score = compute_flashcard_confidence_score(
            content=_deck([0]),
            source_sections=SHORT_SOURCE,
        )
        assert score < AUTO_APPROVAL_THRESHOLD

    def test_a_completely_ungrounded_deck_floors_below_the_bar(self) -> None:
        score = compute_flashcard_confidence_score(
            content=_deck([]),
            source_sections=SHORT_SOURCE,
        )
        # OCR weight alone on a 3-section source.
        assert score == round(resolve_weights(3)[2], 4)
        assert score < AUTO_APPROVAL_THRESHOLD

    def test_grounding_more_items_raises_the_score(self) -> None:
        """Citation mapping is now the term that moves, which is the intent."""
        scores = [
            compute_flashcard_confidence_score(
                content=_deck([0] * grounded),
                source_sections=SHORT_SOURCE,
            )
            for grounded in range(6)
        ]
        assert all(b >= a for a, b in zip(scores, scores[1:], strict=False))
        assert scores[-1] > scores[0]

    def test_poor_ocr_still_gates_a_partially_grounded_deck(self) -> None:
        """OCR keeps its teeth where the artifact is not already perfect."""
        content = _deck([0, 1, 2, 0])  # 4 of 5 cards grounded
        clean = compute_flashcard_confidence_score(
            content=content, source_sections=SHORT_SOURCE, ocr_quality=1.0
        )
        scanned_badly = compute_flashcard_confidence_score(
            content=content, source_sections=SHORT_SOURCE, ocr_quality=0.2
        )
        assert clean >= AUTO_APPROVAL_THRESHOLD
        assert scanned_badly < AUTO_APPROVAL_THRESHOLD

    def test_a_fully_grounded_deck_survives_poor_ocr(self) -> None:
        """Deliberate, and true before this change too — do not "fix" it.

        Every card citing a real section, covering every section, scores 0.728
        even at ocr_quality 0.2. Under the old weights the same artifact scored
        0.84, so poor OCR never sank a fully grounded artifact either. Grounding
        dominates by design; OCR is a tiebreaker, not a veto.
        """
        score = compute_flashcard_confidence_score(
            content=_deck([0, 1, 2, 0, 1]),
            source_sections=SHORT_SOURCE,
            ocr_quality=0.2,
        )
        assert score >= AUTO_APPROVAL_THRESHOLD


class TestReproductionPathIsNotTapered:
    """The re-score script's gate depends on this.

    Stored scores were written under the static weights. If DOCUMENT mode
    tapered, every reproduction check would fail and #315's gate would block
    on a difference this change introduced rather than a real one.
    """

    def test_document_mode_uses_static_weights(self) -> None:
        content = _deck([0, 1, 2, 0, 1])
        legacy = compute_flashcard_confidence_score(
            content=content,
            source_sections=SHORT_SOURCE,
            coverage_mode=COVERAGE_MODE_DOCUMENT,
        )
        # coverage 3/3 = 1.0, citation 5/5 = 1.0, ocr 1.0 under 0.5/0.3/0.2
        assert legacy == 1.0

    def test_document_mode_partial_matches_the_old_arithmetic(self) -> None:
        content = _deck([0])
        legacy = compute_flashcard_confidence_score(
            content=content,
            source_sections=SHORT_SOURCE,
            coverage_mode=COVERAGE_MODE_DOCUMENT,
        )
        expected = round(
            (1 / 3) * SOURCE_PASSAGE_COVERAGE_WEIGHT
            + (1 / 5) * CITATION_MAPPING_COMPLETENESS_WEIGHT
            + 1.0 * OCR_QUALITY_WEIGHT,
            4,
        )
        assert legacy == expected

    def test_explicit_none_section_count_keeps_static_weights(self) -> None:
        assert resolve_weights(None) == (
            SOURCE_PASSAGE_COVERAGE_WEIGHT,
            CITATION_MAPPING_COMPLETENESS_WEIGHT,
            OCR_QUALITY_WEIGHT,
        )
