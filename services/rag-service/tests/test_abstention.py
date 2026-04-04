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
