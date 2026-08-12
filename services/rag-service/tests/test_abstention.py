"""Tests for src.core.abstention — abstention checks and response generation."""

from __future__ import annotations

import pytest

from src.core.abstention import check_abstention, generate_abstention_response
from src.core.types import AbstentionReason


class TestCheckAbstention:
    """check_abstention — determines if pipeline should refuse to answer."""

    def test_empty_passages_returns_no_results(self):
        result = check_abstention([])
        assert result == AbstentionReason.NO_RESULTS

    def test_fewer_than_min_passages_returns_insufficient(self, make_passage):
        # Default min is 3, so 2 passages should trigger INSUFFICIENT
        passages = [make_passage(score=0.9) for _ in range(2)]
        result = check_abstention(passages)
        assert result == AbstentionReason.INSUFFICIENT_PASSAGES

    def test_single_passage_returns_insufficient(self, make_passage):
        passages = [make_passage(score=0.9)]
        result = check_abstention(passages)
        assert result == AbstentionReason.INSUFFICIENT_PASSAGES

    def test_enough_passages_with_good_scores_returns_none(self, make_passage):
        passages = [make_passage(score=0.8) for _ in range(5)]
        result = check_abstention(passages)
        assert result is None

    def test_exactly_min_passages_with_good_scores_returns_none(self, make_passage):
        passages = [make_passage(score=0.5) for _ in range(3)]
        result = check_abstention(passages)
        assert result is None

    def test_low_top_score_returns_low_relevance(self, make_passage):
        # Score below threshold (0.01) → LOW_RELEVANCE
        passages = [make_passage(score=0.005) for _ in range(5)]
        result = check_abstention(passages)
        assert result == AbstentionReason.LOW_RELEVANCE

    def test_rerank_score_takes_precedence(self, make_passage):
        # score is low but rerank_score is high → should pass
        passages = [make_passage(score=0.001, rerank_score=0.9) for _ in range(3)]
        result = check_abstention(passages)
        assert result is None

    def test_low_rerank_score_returns_low_relevance(self, make_passage):
        # rerank_score set but below threshold
        passages = [make_passage(score=0.5, rerank_score=0.005) for _ in range(3)]
        result = check_abstention(passages)
        assert result == AbstentionReason.LOW_RELEVANCE

    def test_zero_score_returns_low_relevance(self, make_passage):
        passages = [make_passage(score=0.0) for _ in range(3)]
        result = check_abstention(passages)
        assert result == AbstentionReason.LOW_RELEVANCE


class TestGenerateAbstentionResponse:
    """generate_abstention_response — user-friendly abstention messages."""

    def test_no_results_message(self):
        msg = generate_abstention_response(AbstentionReason.NO_RESULTS, "test query")
        assert isinstance(msg, str)
        assert len(msg) > 20

    def test_insufficient_passages_message(self):
        msg = generate_abstention_response(AbstentionReason.INSUFFICIENT_PASSAGES, "test query")
        assert isinstance(msg, str)
        assert len(msg) > 20

    def test_low_relevance_message(self):
        msg = generate_abstention_response(AbstentionReason.LOW_RELEVANCE, "test query")
        assert isinstance(msg, str)
        assert len(msg) > 20

    def test_validation_failed_message(self):
        msg = generate_abstention_response(AbstentionReason.VALIDATION_FAILED, "test query")
        assert isinstance(msg, str)
        assert len(msg) > 20

    def test_each_reason_produces_different_message(self):
        messages = {
            reason: generate_abstention_response(reason, "test query")
            for reason in AbstentionReason
        }
        # At least some should be distinct
        unique_messages = set(messages.values())
        assert len(unique_messages) >= 3


# ---------------------------------------------------------------------------
# Scope-dependent passage floor + scoped wording
# ---------------------------------------------------------------------------


class TestMinPassagesOverride:
    """check_abstention takes a caller-supplied floor for scoped retrieval."""

    def test_default_floor_comes_from_settings(self, make_passage) -> None:
        passages = [make_passage(score=0.9)]
        assert check_abstention(passages) == AbstentionReason.INSUFFICIENT_PASSAGES

    def test_scoped_floor_of_one_admits_a_single_passage(self, make_passage) -> None:
        passages = [make_passage(score=0.9)]
        assert check_abstention(passages, min_passages=1) is None

    def test_override_does_not_bypass_the_empty_check(self) -> None:
        """A floor of 1 must still reject an empty pool, not divide by scope."""
        assert check_abstention([], min_passages=1) == AbstentionReason.NO_RESULTS

    def test_override_of_zero_is_honoured_and_still_rejects_empty(self) -> None:
        assert check_abstention([], min_passages=0) == AbstentionReason.NO_RESULTS

    def test_explicit_override_beats_the_settings_value(self, make_passage) -> None:
        passages = [make_passage(score=0.9), make_passage(score=0.8)]
        assert check_abstention(passages, min_passages=5) == (
            AbstentionReason.INSUFFICIENT_PASSAGES
        )


class TestScopedAbstentionWording:
    """Scoped copy must not send the reader back to the search box."""

    SEARCH_ADVICE = ("more specific query", "rephrasing", "search terms", "refining")

    def test_scoped_insufficient_passages_gives_no_search_advice(self) -> None:
        msg = generate_abstention_response(
            AbstentionReason.INSUFFICIENT_PASSAGES, "q", scoped=True
        )
        for phrase in self.SEARCH_ADVICE:
            assert phrase not in msg.lower()

    def test_scoped_no_results_gives_no_search_advice(self) -> None:
        msg = generate_abstention_response(AbstentionReason.NO_RESULTS, "q", scoped=True)
        for phrase in self.SEARCH_ADVICE:
            assert phrase not in msg.lower()

    def test_scoped_validation_failed_gives_no_search_advice(self) -> None:
        msg = generate_abstention_response(
            AbstentionReason.VALIDATION_FAILED, "q", scoped=True
        )
        for phrase in self.SEARCH_ADVICE:
            assert phrase not in msg.lower()

    def test_scoped_copy_names_the_document(self) -> None:
        msg = generate_abstention_response(
            AbstentionReason.INSUFFICIENT_PASSAGES, "q", scoped=True
        )
        assert "this document" in msg.lower()

    def test_scoped_copy_does_not_cite_the_three_passage_rule(self) -> None:
        """The corpus-wide copy promises 3 sources; that floor does not apply."""
        msg = generate_abstention_response(
            AbstentionReason.INSUFFICIENT_PASSAGES, "q", scoped=True
        )
        assert "3 relevant source passages" not in msg

    def test_unscoped_wording_is_unchanged(self) -> None:
        msg = generate_abstention_response(AbstentionReason.INSUFFICIENT_PASSAGES, "q")
        assert "more specific query" in msg

    def test_scoped_and_unscoped_differ_for_every_reason(self) -> None:
        for reason in AbstentionReason:
            assert generate_abstention_response(reason, "q", scoped=True) != (
                generate_abstention_response(reason, "q")
            )
