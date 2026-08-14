"""Tests for rerank/service.py — scoring, sigmoid, and ordering."""

from __future__ import annotations

import math
from typing import Any
from unittest.mock import patch

import pytest

from src.rerank.service import _identity_activation_kwarg, _sigmoid, rerank


class TestSigmoid:
    """The numeric contract: an unbounded logit becomes a 0-1 probability."""

    def test_zero_is_half(self) -> None:
        assert _sigmoid(0.0) == pytest.approx(0.5)

    def test_positive_logit(self) -> None:
        assert _sigmoid(2.0) == pytest.approx(0.8807970779778823)

    def test_negative_logit(self) -> None:
        """bge-reranker-base emits negatives routinely, including for matches."""
        assert _sigmoid(-1.4274) == pytest.approx(0.19349, abs=1e-4)

    def test_is_monotonic(self) -> None:
        values = [_sigmoid(x) for x in (-20.0, -5.0, -1.0, 0.0, 1.0, 5.0, 20.0)]
        assert values == sorted(values)

    def test_bounded_between_zero_and_one(self) -> None:
        for x in (-1000.0, -50.0, 0.0, 50.0, 1000.0):
            assert 0.0 <= _sigmoid(x) <= 1.0

    def test_large_negative_does_not_overflow(self) -> None:
        """math.exp(-x) on a large negative x would raise OverflowError."""
        assert _sigmoid(-1000.0) == pytest.approx(0.0, abs=1e-12)

    def test_large_positive_does_not_overflow(self) -> None:
        assert _sigmoid(1000.0) == pytest.approx(1.0, abs=1e-12)

    def test_matches_reference_formula(self) -> None:
        for x in (-3.5, -0.25, 0.75, 4.0):
            assert _sigmoid(x) == pytest.approx(1.0 / (1.0 + math.exp(-x)))


class TestIdentityActivation:
    """Forcing raw logits out of `predict`, whichever spelling the lib uses."""

    def test_prefers_the_v4_name(self) -> None:
        def predict(inputs: Any, activation_fn: Any = None) -> None: ...

        kwargs = _identity_activation_kwarg(predict)
        assert "activation_fn" in kwargs

    def test_falls_back_to_the_v3_name(self) -> None:
        def predict(inputs: Any, activation_fct: Any = None) -> None: ...

        kwargs = _identity_activation_kwarg(predict)
        assert "activation_fct" in kwargs

    def test_unknown_signature_sends_nothing(self) -> None:
        def predict(inputs: Any) -> None: ...

        assert _identity_activation_kwarg(predict) == {}

    def test_activation_is_identity_not_sigmoid(self) -> None:
        """The whole point: sentence-transformers defaults a 1-label head to
        Sigmoid, so without this the service would sigmoid twice and squash
        every score into roughly [0.5, 0.73]."""
        import torch

        def predict(inputs: Any, activation_fn: Any = None) -> None: ...

        kwargs = _identity_activation_kwarg(predict)
        assert isinstance(kwargs["activation_fn"], torch.nn.Identity)


class TestRerank:
    @pytest.mark.asyncio
    async def test_empty_returns_empty(self, mock_model: Any) -> None:
        with patch("src.rerank.service._get_model", return_value=mock_model):
            assert await rerank("q", []) == []

    @pytest.mark.asyncio
    async def test_scores_are_in_unit_range(self, mock_model: Any) -> None:
        passages = [("a", "short"), ("b", "a considerably longer passage body")]

        with patch("src.rerank.service._get_model", return_value=mock_model):
            results = await rerank("q", passages)

        assert all(0.0 <= score <= 1.0 for _pid, score in results)

    @pytest.mark.asyncio
    async def test_sorted_by_score_descending(self, mock_model: Any) -> None:
        passages = [("a", "short"), ("b", "a considerably longer passage body"), ("c", "mid")]

        with patch("src.rerank.service._get_model", return_value=mock_model):
            results = await rerank("q", passages)

        scores = [s for _pid, s in results]
        assert scores == sorted(scores, reverse=True)

    @pytest.mark.asyncio
    async def test_every_passage_is_returned(self, mock_model: Any) -> None:
        """The caller maps scores back by id; a short list would silently drop
        passages from the ranking."""
        passages = [(f"p{i}", f"body {i}" * (i + 1)) for i in range(10)]

        with patch("src.rerank.service._get_model", return_value=mock_model):
            results = await rerank("q", passages)

        assert {pid for pid, _ in results} == {pid for pid, _ in passages}
        assert len(results) == 10

    @pytest.mark.asyncio
    async def test_ids_are_preserved_exactly(self, mock_model: Any) -> None:
        passages = [("uuid-with-dashes-1", "text one"), ("uuid-with-dashes-2", "text two")]

        with patch("src.rerank.service._get_model", return_value=mock_model):
            results = await rerank("q", passages)

        assert {pid for pid, _ in results} == {"uuid-with-dashes-1", "uuid-with-dashes-2"}

    @pytest.mark.asyncio
    async def test_passage_text_is_truncated(self, mock_model: Any) -> None:
        from src.config import settings

        with patch("src.rerank.service._get_model", return_value=mock_model):
            await rerank("q", [("a", "x" * 50_000)])

        pairs = mock_model.predict.call_args.args[0]
        assert len(pairs[0][1]) == settings.max_passage_length

    @pytest.mark.asyncio
    async def test_query_is_paired_with_each_text(self, mock_model: Any) -> None:
        with patch("src.rerank.service._get_model", return_value=mock_model):
            await rerank("what is estafa", [("a", "one"), ("b", "two")])

        pairs = mock_model.predict.call_args.args[0]
        assert [p[0] for p in pairs] == ["what is estafa", "what is estafa"]

    @pytest.mark.asyncio
    async def test_identity_activation_is_requested(self, mock_model: Any) -> None:
        """Regression guard for the double-sigmoid bug."""
        import torch

        with patch("src.rerank.service._get_model", return_value=mock_model):
            await rerank("q", [("a", "text")])

        kwargs = mock_model.predict.call_args.kwargs
        activation = kwargs.get("activation_fn") or kwargs.get("activation_fct")
        assert isinstance(activation, torch.nn.Identity)

    @pytest.mark.asyncio
    async def test_raw_logits_become_probabilities(self, mock_model: Any) -> None:
        """A negative logit must land below 0.5, not be clipped to 0."""
        mock_model.predict.side_effect = lambda pairs, **kw: [-2.0, 0.0, 3.0]

        with patch("src.rerank.service._get_model", return_value=mock_model):
            results = await rerank("q", [("a", "1"), ("b", "2"), ("c", "3")])

        by_id = dict(results)
        assert by_id["a"] == pytest.approx(_sigmoid(-2.0))
        assert by_id["b"] == pytest.approx(0.5)
        assert by_id["c"] == pytest.approx(_sigmoid(3.0))
