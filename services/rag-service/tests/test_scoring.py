"""Tests for src.shared.scoring — confidence score computation."""

from __future__ import annotations

import pytest

from src.shared.scoring import compute_confidence


class TestComputeConfidence:
    """compute_confidence — weighted combination of coverage, validity, passage count."""

    def test_zero_everything(self, make_citation_ref, make_passage):
        result = compute_confidence([], [], 0)
        assert result == 0.0

    def test_full_coverage_all_valid(self, make_citation_ref, make_passage):
        """All citations valid, all documents cited, ≥5 passages → high confidence."""
        passages = [make_passage(document_id=f"doc-{i}") for i in range(5)]
        citations = [make_citation_ref(source_id=f"doc-{i}") for i in range(5)]
        result = compute_confidence(citations, passages, valid_citation_count=5)
        assert result >= 0.9
        assert result <= 1.0

    def test_partial_citation_validity(self, make_citation_ref, make_passage):
        """Only half the citations are valid → reduced confidence."""
        passages = [make_passage(document_id=f"doc-{i}") for i in range(5)]
        citations = [make_citation_ref(source_id=f"doc-{i}") for i in range(4)]
        result = compute_confidence(citations, passages, valid_citation_count=2)
        # 2/4 = 0.5 citation validity, so overall should be moderate
        assert 0.3 <= result <= 0.8

    def test_no_doc_id_overlap(self, make_citation_ref, make_passage):
        """Citations reference documents not in passages → source_coverage = 0."""
        passages = [make_passage(document_id=f"doc-{i}") for i in range(5)]
        citations = [make_citation_ref(source_id=f"other-{i}") for i in range(3)]
        result = compute_confidence(citations, passages, valid_citation_count=3)
        # source_coverage = 0 (0.3 weight), validity = 1.0 (0.4 weight), passages = 1.0 (0.3 weight)
        # ≈ 0 + 0.4 + 0.3 = 0.7
        assert 0.5 <= result <= 0.8

    def test_few_passages_reduced_factor(self, make_citation_ref, make_passage):
        """Fewer than 5 passages → reduced passage factor."""
        passages = [make_passage(document_id="doc-1")]
        citations = [make_citation_ref(source_id="doc-1")]
        result = compute_confidence(citations, passages, valid_citation_count=1)
        # passage_factor = 1/5 = 0.2
        assert result < 0.8

    def test_result_clamped_zero_to_one(self, make_citation_ref, make_passage):
        result = compute_confidence([], [], 0)
        assert 0.0 <= result <= 1.0

    def test_result_rounded_two_decimals(self, make_citation_ref, make_passage):
        passages = [make_passage(document_id=f"doc-{i}") for i in range(3)]
        citations = [make_citation_ref(source_id=f"doc-{i}") for i in range(2)]
        result = compute_confidence(citations, passages, valid_citation_count=1)
        # Check it's rounded to 2 decimal places
        assert result == round(result, 2)

    def test_no_citations_but_passages(self, make_citation_ref, make_passage):
        """No citations made but passages available → low confidence."""
        passages = [make_passage() for _ in range(5)]
        result = compute_confidence([], passages, valid_citation_count=0)
        # citation_validity = 0, source_coverage = 0
        assert result <= 0.4

    def test_many_valid_citations(self, make_citation_ref, make_passage):
        """10 citations, all valid, all matching passages → high confidence."""
        passages = [make_passage(document_id=f"doc-{i}") for i in range(10)]
        citations = [make_citation_ref(source_id=f"doc-{i}") for i in range(10)]
        result = compute_confidence(citations, passages, valid_citation_count=10)
        assert result >= 0.9

    def test_single_passage_single_valid_citation(self, make_citation_ref, make_passage):
        passages = [make_passage(document_id="doc-0")]
        citations = [make_citation_ref(source_id="doc-0")]
        result = compute_confidence(citations, passages, valid_citation_count=1)
        # source_coverage = 1.0, validity = 1.0, passage_factor = 1/5 = 0.2
        # = 0.3*1.0 + 0.4*1.0 + 0.3*0.2 = 0.3 + 0.4 + 0.06 = 0.76
        assert 0.7 <= result <= 0.85


class TestCoverageIsOverPassagesNotDocuments:
    """The coverage term counts passages, as its docstring always claimed.

    It compared sets of document ids, so retrieval returning several passages
    from one document — the ordinary shape on this corpus, 8 passages from 1
    document on a prod corpus-wide query — collapsed the denominator to 1 and
    scored one citation as total coverage.
    """

    def test_one_section_cited_out_of_eight_passages_in_one_document(
        self, make_citation_ref, make_passage
    ):
        """The prod shape. Under document-set coverage this scored 1.0."""
        passages = [
            make_passage(document_id="doc-0", section_id=f"sec-{i}") for i in range(8)
        ]
        citations = [make_citation_ref(source_id="doc-0", section_id="sec-0")]
        result = compute_confidence(citations, passages, valid_citation_count=1)

        # coverage = 1/8 = 0.125 → 0.3*0.125 + 0.4*1.0 + 0.3*1.0 = 0.7375
        assert result == 0.74

    def test_coverage_rises_with_each_additional_section_cited(
        self, make_citation_ref, make_passage
    ):
        """Coverage must discriminate within a document, not saturate at one cite."""
        passages = [
            make_passage(document_id="doc-0", section_id=f"sec-{i}") for i in range(8)
        ]
        one = compute_confidence(
            [make_citation_ref(source_id="doc-0", section_id="sec-0")],
            passages,
            valid_citation_count=1,
        )
        four = compute_confidence(
            [
                make_citation_ref(source_id="doc-0", section_id=f"sec-{i}")
                for i in range(4)
            ],
            passages,
            valid_citation_count=4,
        )
        assert four > one

    # See test_prompts.py: a `test_` name with exactly 35 trailing characters
    # trips TruffleHog's Lob detector and fails the Secret Detection job.
    def test_citing_every_section_is_full_coverage(self, make_citation_ref, make_passage):
        passages = [
            make_passage(document_id="doc-0", section_id=f"sec-{i}") for i in range(8)
        ]
        citations = [
            make_citation_ref(source_id="doc-0", section_id=f"sec-{i}") for i in range(8)
        ]
        result = compute_confidence(citations, passages, valid_citation_count=8)
        assert result == 1.0

    def test_wrong_section_of_the_right_document_is_not_covered(
        self, make_citation_ref, make_passage
    ):
        passages = [make_passage(document_id="doc-0", section_id="sec-0")]
        citations = [make_citation_ref(source_id="doc-0", section_id="sec-99")]
        # Falls through both the pair match and the doc-level fallback (the ref
        # names a section), so nothing is covered.
        # 0.3*0.0 + 0.4*1.0 + 0.3*0.2 = 0.46
        assert compute_confidence(citations, passages, valid_citation_count=1) == 0.46

    def test_unsectioned_passages_match_on_document_id(
        self, make_citation_ref, make_passage
    ):
        """Data without section ids must not score 0 coverage."""
        passages = [make_passage(document_id="doc-0", section_id=None) for _ in range(3)]
        citations = [make_citation_ref(source_id="doc-0", section_id=None)]
        # 0.3*1.0 + 0.4*1.0 + 0.3*(3/5) = 0.88
        assert compute_confidence(citations, passages, valid_citation_count=1) == 0.88

    def test_document_level_citation_covers_that_documents_passages(
        self, make_citation_ref, make_passage
    ):
        """`[SOURCE doc]` without a section is a form the prompt allows.

        Deliberate: a document-level citation is not evidence that the model
        used one particular section, so it credits every passage from that
        document. What it must NOT do is credit passages from other documents.
        """
        passages = [
            make_passage(document_id="doc-0", section_id="sec-0"),
            make_passage(document_id="doc-0", section_id="sec-1"),
            make_passage(document_id="doc-1", section_id="sec-2"),
            make_passage(document_id="doc-1", section_id="sec-3"),
        ]
        citations = [make_citation_ref(source_id="doc-0", section_id=None)]
        # coverage = 2/4 = 0.5 → 0.3*0.5 + 0.4*1.0 + 0.3*(4/5) = 0.79
        assert compute_confidence(citations, passages, valid_citation_count=1) == 0.79

    def test_citation_to_an_absent_document_covers_nothing(
        self, make_citation_ref, make_passage
    ):
        passages = [
            make_passage(document_id="doc-0", section_id=f"sec-{i}") for i in range(4)
        ]
        citations = [make_citation_ref(source_id="doc-other", section_id="sec-0")]
        # 0.3*0.0 + 0.4*1.0 + 0.3*(4/5) = 0.64
        assert compute_confidence(citations, passages, valid_citation_count=1) == 0.64

    def test_no_passages_is_zero_coverage_not_a_crash(
        self, make_citation_ref, make_passage
    ):
        citations = [make_citation_ref(source_id="doc-0", section_id="sec-0")]
        result = compute_confidence(citations, [], valid_citation_count=1)
        # coverage and passage_factor both 0 → 0.4 from validity alone
        assert result == 0.4
