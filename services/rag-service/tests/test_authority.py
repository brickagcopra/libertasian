"""Tests for the source-authority boost and the shared ranked-retrieval path.

Covers:
- core/authority.py: the trust-level mapping, legacy aliases, unknown values,
  stable boosted ordering, debug logging
- core/reranking.py: the boost runs AFTER reranking (final = rerank * boost),
  on the RRF score in the fallback path, and `top_score` stays RAW
- core/abstention.py: abstention judges the raw top score, never the boosted
  order's head
- core/ranked.py: retrieve_ranked wiring (embedding, filters, degraded legs)
"""

from __future__ import annotations

import logging
from unittest.mock import AsyncMock, patch

import pytest

from src.config import settings
from src.core.abstention import check_abstention
from src.core.authority import (
    AUTHORITY_BOOST,
    UNKNOWN_BOOST,
    apply_authority_boost,
    authority_boost,
)
from src.core.ranked import retrieve_ranked
from src.core.reranking import rerank_passages
from src.core.schemas import Passage, RerankOutcome, SearchResult
from src.core.types import AbstentionReason, QueryIntent


def _passage(
    pid: str,
    *,
    trust: str = "low",
    score: float = 0.5,
    rerank_score: float | None = None,
) -> Passage:
    return Passage(
        id=pid,
        document_id=f"doc-{pid}",
        text=f"text {pid}",
        source_authority_level=trust,
        score=score,
        rerank_score=rerank_score,
    )


def _reranker_returning(scores: dict[str, float]) -> AsyncMock:
    async def _call(url: str, query: str, passages: list[Passage]) -> list[Passage]:
        return [p.model_copy(update={"rerank_score": scores.get(p.id)}) for p in passages]

    return AsyncMock(side_effect=_call)


# ===========================================================================
# Mapping
# ===========================================================================


class TestAuthorityMapping:
    """`source_trust_level` holds Source.trustLevel: high / medium / low."""

    @pytest.mark.parametrize(
        ("level", "boost"),
        [("high", 1.30), ("medium", 1.15), ("low", 1.00), ("private", 0.90)],
    )
    def test_trust_levels(self, level: str, boost: float) -> None:
        assert authority_boost(level) == boost

    @pytest.mark.parametrize(
        ("alias", "level"),
        [("official", "high"), ("semi_official", "medium"), ("editorial", "low")],
    )
    def test_legacy_names_are_aliases(self, alias: str, level: str) -> None:
        assert authority_boost(alias) == authority_boost(level)

    @pytest.mark.parametrize("value", ["", None, "unverified", "trusted"])
    def test_unknown_gets_the_private_boost(self, value: str | None) -> None:
        assert authority_boost(value) == UNKNOWN_BOOST == 0.90

    def test_case_and_whitespace_insensitive(self) -> None:
        assert authority_boost(" HIGH ") == 1.30

    def test_ordering(self) -> None:
        assert (
            AUTHORITY_BOOST["high"]
            > AUTHORITY_BOOST["medium"]
            > AUTHORITY_BOOST["low"]
            > AUTHORITY_BOOST["private"]
        )

    def test_real_index_values_are_not_all_neutral(self) -> None:
        """The regression: every real value used to miss the table and get 1.0."""
        boosts = {authority_boost(v) for v in ("high", "medium", "low")}
        assert len(boosts) == 3


class TestApplyAuthorityBoost:
    def test_does_not_modify_scores(self) -> None:
        passages = [_passage("a", trust="high", score=0.5, rerank_score=0.4)]
        result = apply_authority_boost(passages, lambda p: p.score)
        assert result[0].score == 0.5
        assert result[0].rerank_score == 0.4

    def test_uniform_trust_keeps_input_order(self) -> None:
        passages = [_passage(p, score=0.5) for p in ("a", "b", "c")]
        result = apply_authority_boost(passages, lambda p: p.score)
        assert [p.id for p in result] == ["a", "b", "c"]

    def test_empty(self) -> None:
        assert apply_authority_boost([], lambda p: p.score) == []

    def test_logs_counts_per_trust_level_at_debug(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        passages = [
            _passage("a", trust="high"),
            _passage("b", trust="high"),
            _passage("c", trust="low"),
        ]
        with caplog.at_level(logging.DEBUG, logger="src.core.authority"):
            apply_authority_boost(passages, lambda p: p.score)

        record = next(r for r in caplog.records if r.name == "src.core.authority")
        assert record.levelno == logging.DEBUG
        assert "high=2" in record.getMessage()
        assert "low=1" in record.getMessage()


# ===========================================================================
# Boost after reranking
# ===========================================================================


class TestBoostAfterReranking:
    @pytest.fixture(autouse=True)
    def _reranker_on(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(settings, "reranker_url", "http://reranker:8001")

    @pytest.mark.asyncio
    async def test_high_trust_outranks_low_trust_on_equal_rerank_score(self) -> None:
        # Low-trust passage arrives first AND has the better RRF score, so only
        # the post-rerank boost can put the high-trust one on top.
        passages = [
            _passage("low", trust="low", score=0.9),
            _passage("high", trust="high", score=0.1),
        ]
        call = _reranker_returning({"low": 0.6, "high": 0.6})

        with patch("src.core.reranking._call_reranker", call):
            outcome = await rerank_passages("q", passages, top_k=2)

        assert [p.id for p in outcome.passages] == ["high", "low"]

    @pytest.mark.asyncio
    async def test_final_score_is_rerank_times_boost(self) -> None:
        # 0.60 * 1.30 = 0.78 beats 0.70 * 1.00; 0.60 * 1.00 would not.
        passages = [
            _passage("low", trust="low"),
            _passage("high", trust="high"),
        ]
        call = _reranker_returning({"low": 0.70, "high": 0.60})

        with patch("src.core.reranking._call_reranker", call):
            outcome = await rerank_passages("q", passages, top_k=2)

        assert [p.id for p in outcome.passages] == ["high", "low"]

    @pytest.mark.asyncio
    async def test_boost_does_not_overturn_a_large_relevance_gap(self) -> None:
        passages = [_passage("low", trust="low"), _passage("high", trust="high")]
        call = _reranker_returning({"low": 0.90, "high": 0.30})

        with patch("src.core.reranking._call_reranker", call):
            outcome = await rerank_passages("q", passages, top_k=2)

        assert [p.id for p in outcome.passages] == ["low", "high"]

    @pytest.mark.asyncio
    async def test_boost_is_applied_before_the_top_k_cut(self) -> None:
        passages = [
            _passage("low1", trust="low"),
            _passage("low2", trust="low"),
            _passage("high", trust="high"),
        ]
        call = _reranker_returning({"low1": 0.80, "low2": 0.70, "high": 0.65})

        with patch("src.core.reranking._call_reranker", call):
            outcome = await rerank_passages("q", passages, top_k=2)

        # 0.65 * 1.30 = 0.845: third by raw score, first once boosted.
        assert [p.id for p in outcome.passages] == ["high", "low1"]

    @pytest.mark.asyncio
    async def test_rerank_scores_stay_raw(self) -> None:
        passages = [_passage("high", trust="high")]
        call = _reranker_returning({"high": 0.5})

        with patch("src.core.reranking._call_reranker", call):
            outcome = await rerank_passages("q", passages, top_k=1)

        assert outcome.passages[0].rerank_score == 0.5

    @pytest.mark.asyncio
    async def test_top_score_is_the_raw_top_rerank_score(self) -> None:
        passages = [_passage("low", trust="low"), _passage("high", trust="high")]
        call = _reranker_returning({"low": 0.70, "high": 0.60})

        with patch("src.core.reranking._call_reranker", call):
            outcome = await rerank_passages("q", passages, top_k=2)

        # Head of the boosted order is "high" (0.60), but the raw top is 0.70.
        assert outcome.passages[0].id == "high"
        assert outcome.top_score == 0.70


class TestFallbackBoost:
    @pytest.fixture(autouse=True)
    def _reranker_off(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(settings, "reranker_url", "")

    @pytest.mark.asyncio
    async def test_fallback_still_boosts_the_rrf_score(self) -> None:
        passages = [
            _passage("low", trust="low", score=0.030),
            _passage("high", trust="high", score=0.025),
        ]

        outcome = await rerank_passages("q", passages, top_k=2)

        # 0.025 * 1.30 = 0.0325 > 0.030 * 1.00
        assert outcome.degraded_legs == ["reranker:not_configured"]
        assert [p.id for p in outcome.passages] == ["high", "low"]
        assert outcome.passages[0].score == 0.025  # unmodified

    @pytest.mark.asyncio
    async def test_fallback_top_score_is_the_raw_rrf_top(self) -> None:
        passages = [
            _passage("low", trust="low", score=0.030),
            _passage("high", trust="high", score=0.025),
        ]

        outcome = await rerank_passages("q", passages, top_k=2)

        assert outcome.top_score == 0.030

    @pytest.mark.asyncio
    async def test_fallback_on_reranker_failure_also_boosts(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "reranker_url", "http://reranker:8001")
        passages = [
            _passage("low", trust="low", score=0.030),
            _passage("high", trust="high", score=0.025),
        ]

        with patch(
            "src.core.reranking._call_reranker", AsyncMock(side_effect=ValueError("bad"))
        ):
            outcome = await rerank_passages("q", passages, top_k=2)

        assert outcome.degraded_legs == ["reranker:failed"]
        assert [p.id for p in outcome.passages] == ["high", "low"]
        assert outcome.top_score == 0.030


# ===========================================================================
# Abstention is unchanged by the boost
# ===========================================================================


class TestAbstentionUsesRawScore:
    @pytest.fixture(autouse=True)
    def _settings(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(settings, "reranker_url", "http://reranker:8001")
        monkeypatch.setattr(settings, "abstention_score_threshold", 0.5)
        monkeypatch.setattr(settings, "abstention_min_passages", 1)

    @pytest.mark.asyncio
    async def test_boost_cannot_lift_a_query_over_the_threshold(self) -> None:
        # 0.45 * 1.30 = 0.585 would clear 0.5; the raw 0.45 must not.
        passages = [_passage("high", trust="high")]
        call = _reranker_returning({"high": 0.45})

        with patch("src.core.reranking._call_reranker", call):
            outcome = await rerank_passages("q", passages, top_k=1)

        reason = check_abstention(outcome.passages, top_score=outcome.top_score)
        assert reason == AbstentionReason.LOW_RELEVANCE

    @pytest.mark.asyncio
    async def test_boosted_head_with_low_raw_score_does_not_cause_abstention(self) -> None:
        # Boosted head "high" has raw 0.45 < 0.5; raw top is "low" at 0.55.
        # Before the move, the head WAS the raw top, so this query answered.
        passages = [_passage("low", trust="low"), _passage("high", trust="high")]
        call = _reranker_returning({"low": 0.55, "high": 0.45})

        with patch("src.core.reranking._call_reranker", call):
            outcome = await rerank_passages("q", passages, top_k=2)

        assert outcome.passages[0].id == "high"
        assert check_abstention(outcome.passages, top_score=outcome.top_score) is None

    @pytest.mark.parametrize(
        ("raw_scores", "expected"),
        [
            ({"a": 0.9, "b": 0.8}, None),
            ({"a": 0.49, "b": 0.3}, AbstentionReason.LOW_RELEVANCE),
            ({"a": 0.5, "b": 0.1}, None),
        ],
    )
    @pytest.mark.asyncio
    async def test_decision_matches_the_unboosted_pipeline(
        self,
        raw_scores: dict[str, float],
        expected: AbstentionReason | None,
    ) -> None:
        """Same decision as checking the head of the raw rerank order."""
        passages = [_passage("a", trust="low"), _passage("b", trust="high")]
        call = _reranker_returning(raw_scores)

        with patch("src.core.reranking._call_reranker", call):
            outcome = await rerank_passages("q", passages, top_k=2)

        raw_order = sorted(
            (p.model_copy(update={"rerank_score": raw_scores[p.id]}) for p in passages),
            key=lambda p: p.rerank_score or 0.0,
            reverse=True,
        )
        assert check_abstention(raw_order) == expected
        assert check_abstention(outcome.passages, top_score=outcome.top_score) == expected

    def test_without_top_score_the_head_is_used_as_before(self) -> None:
        passages = [_passage("a", rerank_score=0.4), _passage("b", rerank_score=0.9)]
        assert check_abstention(passages) == AbstentionReason.LOW_RELEVANCE


# ===========================================================================
# retrieve_ranked
# ===========================================================================


class TestRetrieveRanked:
    @pytest.fixture(autouse=True)
    def _mocks(self) -> None:
        passages = [_passage("a", rerank_score=0.8), _passage("b", rerank_score=0.7)]
        self.mock_embed = AsyncMock(return_value=[0.1] * 384)
        self.mock_retrieve = AsyncMock(
            return_value=SearchResult(
                passages=passages, degraded=True, degraded_legs=["knn:http_error"]
            )
        )
        self.mock_rerank = AsyncMock(
            return_value=RerankOutcome(
                passages=passages,
                degraded=True,
                degraded_legs=["reranker:unreachable"],
                top_score=0.8,
            )
        )
        self.patches = [
            patch("src.core.ranked.embed_query", self.mock_embed),
            patch("src.core.ranked.hybrid_retrieve", self.mock_retrieve),
            patch("src.core.ranked.rerank_passages", self.mock_rerank),
        ]
        for p in self.patches:
            p.start()
        yield
        for p in self.patches:
            p.stop()

    @pytest.mark.asyncio
    async def test_runs_embed_hybrid_and_rerank(self) -> None:
        ranked = await retrieve_ranked("what is estafa", top_k=15)

        self.mock_embed.assert_awaited_once_with("what is estafa")
        kwargs = self.mock_retrieve.call_args.kwargs
        assert kwargs["embedding"] == [0.1] * 384
        assert kwargs["top_k"] == 30
        assert kwargs["filter_terms"] is None
        assert self.mock_rerank.call_args.kwargs["top_k"] == 15
        assert [p.id for p in ranked.passages] == ["a", "b"]
        assert ranked.top_rerank_score == 0.8
        assert ranked.candidates == 2

    @pytest.mark.asyncio
    async def test_merges_degraded_legs_retrieval_first(self) -> None:
        ranked = await retrieve_ranked("q", top_k=8)
        assert ranked.degraded_legs == ["knn:http_error", "reranker:unreachable"]

    @pytest.mark.asyncio
    async def test_document_id_becomes_a_filter(self) -> None:
        await retrieve_ranked("q", top_k=8, document_id="doc-1")
        assert self.mock_retrieve.call_args.kwargs["filter_terms"] == {"document_id": "doc-1"}

    @pytest.mark.asyncio
    async def test_filters_and_document_id_merge(self) -> None:
        await retrieve_ranked("q", top_k=8, filters={"court": "SC"}, document_id="doc-1")
        assert self.mock_retrieve.call_args.kwargs["filter_terms"] == {
            "court": "SC",
            "document_id": "doc-1",
        }

    @pytest.mark.asyncio
    async def test_classifies_intent_when_not_given(self) -> None:
        ranked = await retrieve_ranked("G.R. No. 123456", top_k=8)
        assert self.mock_retrieve.call_args.args[1] == ranked.intent

    @pytest.mark.asyncio
    async def test_uses_the_given_intent(self) -> None:
        ranked = await retrieve_ranked("q", top_k=8, intent=QueryIntent.CASE_LOOKUP)
        assert self.mock_retrieve.call_args.args[1] == QueryIntent.CASE_LOOKUP
        assert ranked.intent == QueryIntent.CASE_LOOKUP
