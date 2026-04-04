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
