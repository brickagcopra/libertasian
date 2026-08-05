"""Tests for the bar exam answer confidence formula.

The formula's whole justification is that its terms VARY. These tests pin the
arithmetic, but the load-bearing ones are the anti-regression tests at the
bottom: they assert the two failures CLAUDE.md documents (a constant term, an
unreachable bar) cannot come back through this module.
"""

from __future__ import annotations

import pytest

from src.scoring_bar_exam import (
    AUTHORITY_BREADTH_WEIGHT,
    BREADTH_TARGET,
    CITATION_RESOLUTION_WEIGHT,
    compute_bar_exam_answer_confidence,
    score_from_passages,
)

DOC_A = "11111111-1111-4111-8111-111111111111"
DOC_B = "22222222-2222-4222-8222-222222222222"
DOC_C = "33333333-3333-4333-8333-333333333333"
SEC_A1 = "aaaaaaaa-0000-4000-8000-000000000001"
SEC_A2 = "aaaaaaaa-0000-4000-8000-000000000002"
SEC_B1 = "bbbbbbbb-0000-4000-8000-000000000001"
SEC_C1 = "cccccccc-0000-4000-8000-000000000001"
FABRICATED = "00000000-dead-4000-8000-000000000bad"


def _passage(section_id: str | None, document_id: str, score: float = 100.0):
    return {
        "id": f"hit-{section_id or 'none'}",
        "section_id": section_id,
        "document_id": document_id,
        "title": "T",
        "text": "body",
        "score": score,
    }


class TestPriorsOnlyScoresTheFloor:
    """The requirement stated in the brief: priors-only MUST score low."""

    def test_no_citations_and_no_retrieval_scores_zero(self):
        result = compute_bar_exam_answer_confidence(
            emitted_id_count=0,
            valid_id_count=0,
            cited_document_count=0,
            available_document_count=0,
        )
        assert result.score == 0.0

    def test_retrieval_happened_but_nothing_was_cited_scores_zero(self):
        """Eight passages retrieved and none used is still ungrounded."""
        result = compute_bar_exam_answer_confidence(
            emitted_id_count=0,
            valid_id_count=0,
            cited_document_count=0,
            available_document_count=5,
        )
        assert result.score == 0.0

    def test_every_citation_fabricated_scores_zero(self):
        result = compute_bar_exam_answer_confidence(
            emitted_id_count=4,
            valid_id_count=0,
            cited_document_count=0,
            available_document_count=5,
        )
        assert result.score == 0.0
        assert result.fabricated_id_count == 4


class TestWhatSevenTenthsMeans:
    """The bar's operational meaning, pinned so it cannot drift silently."""

    def test_two_clean_authorities_clears_the_bar(self):
        result = compute_bar_exam_answer_confidence(
            emitted_id_count=2,
            valid_id_count=2,
            cited_document_count=2,
            available_document_count=6,
        )
        assert result.score == pytest.approx(0.8333, abs=1e-4)
        assert result.score >= 0.70

    def test_one_clean_authority_does_not(self):
        result = compute_bar_exam_answer_confidence(
            emitted_id_count=1,
            valid_id_count=1,
            cited_document_count=1,
            available_document_count=6,
        )
        assert result.score == pytest.approx(0.6667, abs=1e-4)
        assert result.score < 0.70

    def test_three_clean_authorities_is_full_credit(self):
        result = compute_bar_exam_answer_confidence(
            emitted_id_count=3,
            valid_id_count=3,
            cited_document_count=3,
            available_document_count=6,
        )
        assert result.score == 1.0

    def test_half_the_citations_fabricated_fails_even_when_broad(self):
        result = compute_bar_exam_answer_confidence(
            emitted_id_count=4,
            valid_id_count=2,
            cited_document_count=2,
            available_document_count=6,
        )
        assert result.score == pytest.approx(0.5833, abs=1e-4)
        assert result.score < 0.70


class TestReachability:
    """CLAUDE.md: a threshold no document can clear is an outage."""

    def test_bar_is_reachable_when_only_one_document_was_retrieved(self):
        """Citing everything available is full credit for breadth."""
        result = compute_bar_exam_answer_confidence(
            emitted_id_count=1,
            valid_id_count=1,
            cited_document_count=1,
            available_document_count=1,
        )
        assert result.authority_breadth == 1.0
        assert result.score == 1.0

    def test_bar_is_reachable_when_two_documents_were_retrieved(self):
        result = compute_bar_exam_answer_confidence(
            emitted_id_count=2,
            valid_id_count=2,
            cited_document_count=2,
            available_document_count=2,
        )
        assert result.score == 1.0

    @pytest.mark.parametrize("available", [1, 2, 3, 5, 8])
    def test_a_perfect_answer_always_reaches_one(self, available: int):
        """Whatever retrieval returned, citing it all cleanly scores 1.0."""
        cited = min(available, BREADTH_TARGET)
        result = compute_bar_exam_answer_confidence(
            emitted_id_count=cited,
            valid_id_count=cited,
            cited_document_count=cited,
            available_document_count=available,
        )
        assert result.score == 1.0


class TestNoConstantTerms:
    """The ocr_quality lesson: a term that never varies discriminates nothing."""

    def test_citation_resolution_spans_zero_to_one(self):
        low = compute_bar_exam_answer_confidence(
            emitted_id_count=4,
            valid_id_count=0,
            cited_document_count=0,
            available_document_count=4,
        )
        high = compute_bar_exam_answer_confidence(
            emitted_id_count=4,
            valid_id_count=4,
            cited_document_count=3,
            available_document_count=4,
        )
        assert low.citation_resolution == 0.0
        assert high.citation_resolution == 1.0

    def test_authority_breadth_spans_zero_to_one(self):
        low = compute_bar_exam_answer_confidence(
            emitted_id_count=1,
            valid_id_count=0,
            cited_document_count=0,
            available_document_count=8,
        )
        high = compute_bar_exam_answer_confidence(
            emitted_id_count=3,
            valid_id_count=3,
            cited_document_count=3,
            available_document_count=8,
        )
        assert low.authority_breadth == 0.0
        assert high.authority_breadth == 1.0

    def test_no_term_is_added_unconditionally(self):
        """Nothing is contributed by merely existing — the floor is a true 0."""
        floor = compute_bar_exam_answer_confidence(
            emitted_id_count=0,
            valid_id_count=0,
            cited_document_count=0,
            available_document_count=8,
        )
        assert floor.score == 0.0

    def test_weights_sum_to_one(self):
        assert CITATION_RESOLUTION_WEIGHT + AUTHORITY_BREADTH_WEIGHT == 1.0


class TestNoRetrievalCountTerm:
    """The two terms the measurement ruled out must not sneak back in.

    Measured on prod 2026-08-05: 48/48 questions returned the full 8 passages.
    A term keyed on how many passages came back would be a constant, and a
    term keyed on the share of those 8 that were cited would quantize to
    eighths with an unreachable bar.
    """

    def test_score_is_independent_of_how_many_passages_were_retrieved(self):
        eight = score_from_passages(
            emitted_section_ids=[SEC_A1, SEC_B1],
            valid_section_ids=[SEC_A1, SEC_B1],
            passages=[
                _passage(SEC_A1, DOC_A),
                _passage(SEC_A2, DOC_A),
                _passage(SEC_B1, DOC_B),
                _passage(None, DOC_B),
                _passage(SEC_C1, DOC_C),
            ],
        )
        # Same citations, same documents available, fewer passages carrying them.
        three = score_from_passages(
            emitted_section_ids=[SEC_A1, SEC_B1],
            valid_section_ids=[SEC_A1, SEC_B1],
            passages=[
                _passage(SEC_A1, DOC_A),
                _passage(SEC_B1, DOC_B),
                _passage(SEC_C1, DOC_C),
            ],
        )
        assert eight.score == three.score

    def test_citing_two_of_eight_passages_is_not_capped_at_a_quarter(self):
        result = score_from_passages(
            emitted_section_ids=[SEC_A1, SEC_B1],
            valid_section_ids=[SEC_A1, SEC_B1],
            passages=[_passage(f"sec-{i}", f"doc-{i}") for i in range(8)]
            + [_passage(SEC_A1, DOC_A), _passage(SEC_B1, DOC_B)],
        )
        assert result.score > 0.25


class TestScoreFromPassages:
    def test_breadth_counts_documents_not_sections(self):
        """Three sections of one statute is narrower than three authorities."""
        one_document = score_from_passages(
            emitted_section_ids=[SEC_A1, SEC_A2],
            valid_section_ids=[SEC_A1, SEC_A2],
            passages=[
                _passage(SEC_A1, DOC_A),
                _passage(SEC_A2, DOC_A),
                _passage(SEC_B1, DOC_B),
                _passage(SEC_C1, DOC_C),
            ],
        )
        two_documents = score_from_passages(
            emitted_section_ids=[SEC_A1, SEC_B1],
            valid_section_ids=[SEC_A1, SEC_B1],
            passages=[
                _passage(SEC_A1, DOC_A),
                _passage(SEC_A2, DOC_A),
                _passage(SEC_B1, DOC_B),
                _passage(SEC_C1, DOC_C),
            ],
        )
        assert two_documents.score > one_document.score

    def test_passages_without_a_section_id_still_count_as_available_documents(self):
        result = score_from_passages(
            emitted_section_ids=[SEC_A1],
            valid_section_ids=[SEC_A1],
            passages=[_passage(SEC_A1, DOC_A), _passage(None, DOC_B)],
        )
        assert result.available_document_count == 2

    def test_fabricated_id_lowers_resolution_without_touching_breadth(self):
        result = score_from_passages(
            emitted_section_ids=[SEC_A1, FABRICATED],
            valid_section_ids=[SEC_A1],
            passages=[_passage(SEC_A1, DOC_A), _passage(SEC_B1, DOC_B)],
        )
        assert result.citation_resolution == 0.5
        assert result.fabricated_id_count == 1

    def test_empty_passage_set_scores_zero(self):
        result = score_from_passages(
            emitted_section_ids=[],
            valid_section_ids=[],
            passages=[],
        )
        assert result.score == 0.0


class TestInputsAreClampedNotTrusted:
    def test_valid_cannot_exceed_emitted(self):
        result = compute_bar_exam_answer_confidence(
            emitted_id_count=2,
            valid_id_count=9,
            cited_document_count=1,
            available_document_count=3,
        )
        assert result.valid_id_count == 2
        assert result.citation_resolution == 1.0

    def test_negative_counts_do_not_produce_a_negative_score(self):
        result = compute_bar_exam_answer_confidence(
            emitted_id_count=-5,
            valid_id_count=-5,
            cited_document_count=-5,
            available_document_count=-5,
        )
        assert result.score == 0.0

    def test_score_never_exceeds_one(self):
        result = compute_bar_exam_answer_confidence(
            emitted_id_count=50,
            valid_id_count=50,
            cited_document_count=50,
            available_document_count=50,
        )
        assert result.score == 1.0
