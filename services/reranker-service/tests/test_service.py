"""Tests for rerank/service.py — scoring, sigmoid, and ordering."""

from __future__ import annotations

import asyncio
import math
import time
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from src.rerank.service import (
    _configure_torch_threads,
    _identity_activation_kwarg,
    _sigmoid,
    rerank,
)


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


class TestTorchThreadPinning:
    """Torch sizes its pool from the HOST core count, ignoring the cgroup quota.

    On a 12-core host inside a `cpus: "2"` container that is 12 threads
    contending for 2 cores of quota. Measured cost: 11.2-11.5s to score 30
    passages, against rag-service's 10s timeout — every call fell back to RRF.
    """

    @pytest.fixture(autouse=True)
    def _restore_threads(self) -> Any:
        import torch

        original = torch.get_num_threads()
        yield
        torch.set_num_threads(original)

    def test_threads_match_config(self, monkeypatch: pytest.MonkeyPatch) -> None:
        import torch

        from src.config import settings

        monkeypatch.setattr(settings, "torch_threads", 2)
        _configure_torch_threads()

        assert torch.get_num_threads() == 2

    def test_a_different_value_is_honoured(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Guard against a hardcoded number that happens to match the default."""
        import torch

        from src.config import settings

        monkeypatch.setattr(settings, "torch_threads", 3)
        _configure_torch_threads()

        assert torch.get_num_threads() == 3

    def test_interop_error_is_survivable(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """`set_num_interop_threads` raises once parallel work has begun. Losing
        it is harmless; failing startup over it is not."""
        import torch

        from src.config import settings

        monkeypatch.setattr(settings, "torch_threads", 2)
        monkeypatch.setattr(
            torch,
            "set_num_interop_threads",
            lambda _n: (_ for _ in ()).throw(RuntimeError("already started")),
        )

        _configure_torch_threads()

        assert torch.get_num_threads() == 2

    def test_load_applies_pinning(
        self, monkeypatch: pytest.MonkeyPatch, mock_model: Any
    ) -> None:
        """The pin must happen on the load path, not only when called directly."""
        import sentence_transformers
        import torch

        import src.rerank.service as svc
        from src.config import settings

        monkeypatch.setattr(settings, "torch_threads", 2)
        monkeypatch.setattr(settings, "quantize", False)
        monkeypatch.setattr(svc, "_model", None)
        monkeypatch.setattr(sentence_transformers, "CrossEncoder", lambda *a, **k: mock_model)
        torch.set_num_threads(8)

        svc._get_model()

        assert torch.get_num_threads() == 2


class TestMaxLengthIsPassed:
    """A 512-token window on ~250 tokens of text is ~4x the attention cost."""

    def test_crossencoder_gets_max_length(
        self, monkeypatch: pytest.MonkeyPatch, mock_model: Any
    ) -> None:
        import sentence_transformers

        import src.rerank.service as svc
        from src.config import settings

        monkeypatch.setattr(settings, "max_length", 256)
        monkeypatch.setattr(settings, "quantize", False)
        monkeypatch.setattr(svc, "_model", None)

        captured: dict[str, Any] = {}

        def _factory(name: str, **kwargs: Any) -> Any:
            captured["name"] = name
            captured.update(kwargs)
            return mock_model

        monkeypatch.setattr(sentence_transformers, "CrossEncoder", _factory)
        svc._get_model()

        assert captured["max_length"] == 256

    def test_quantize_flag_is_respected(
        self, monkeypatch: pytest.MonkeyPatch, mock_model: Any
    ) -> None:
        import sentence_transformers

        import src.rerank.service as svc
        from src.config import settings

        monkeypatch.setattr(settings, "quantize", False)
        monkeypatch.setattr(svc, "_model", None)
        monkeypatch.setattr(sentence_transformers, "CrossEncoder", lambda *a, **k: mock_model)

        with patch.object(svc, "_quantize_dynamic") as quantizer:
            svc._get_model()

        quantizer.assert_not_called()


class TestModelLoadedFlag:
    def test_false_before_load(self) -> None:
        from src.rerank.service import is_model_loaded

        assert is_model_loaded() is False

    def test_true_after_load(self, monkeypatch: pytest.MonkeyPatch, mock_model: Any) -> None:
        import sentence_transformers

        import src.rerank.service as svc
        from src.config import settings
        from src.rerank.service import is_model_loaded

        monkeypatch.setattr(settings, "quantize", False)
        monkeypatch.setattr(svc, "_model", None)
        monkeypatch.setattr(sentence_transformers, "CrossEncoder", lambda *a, **k: mock_model)
        svc._get_model()

        assert is_model_loaded() is True


class TestQuantizationSafety:
    """Constructing a quantized module is not proof it can run one.

    Measured on aarch64 with torch 2.13: `onednn` converts happily and then
    every forward pass dies with `KeyError: 'ne'`. Without a validating
    inference that shipped as a service which started, reported itself healthy
    AND quantized, and returned 500 for every rerank.
    """

    @pytest.fixture(autouse=True)
    def _reset_flag(self) -> Any:
        import src.rerank.service as svc

        svc._quantized = False
        yield
        svc._quantized = False

    def test_broken_backend_reverts_to_fp32(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Converts fine, then fails inference -> keep the original module."""
        import torch

        import src.rerank.service as svc

        original = MagicMock(name="fp32-module")
        model = MagicMock()
        model.model = original
        model.predict.side_effect = KeyError("ne")

        monkeypatch.setattr(
            torch.ao.quantization, "quantize_dynamic", lambda *a, **k: MagicMock(name="int8")
        )

        svc._quantize_dynamic(model)

        assert model.model is original
        assert svc.is_quantized() is False

    def test_working_backend_is_kept(self, monkeypatch: pytest.MonkeyPatch) -> None:
        import torch

        import src.rerank.service as svc

        quantized = MagicMock(name="int8-module")
        model = MagicMock()
        model.model = MagicMock(name="fp32-module")
        model.predict.return_value = [0.5]

        monkeypatch.setattr(
            torch.ao.quantization, "quantize_dynamic", lambda *a, **k: quantized
        )

        svc._quantize_dynamic(model)

        assert model.model is quantized
        assert svc.is_quantized() is True

    def test_construction_failure_is_survivable(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """fbgemm on aarch64 raises 'unknown architecure' before converting."""
        import torch

        import src.rerank.service as svc

        original = MagicMock(name="fp32-module")
        model = MagicMock()
        model.model = original

        def _boom(*_a: Any, **_k: Any) -> Any:
            raise RuntimeError("unknown architecure")

        monkeypatch.setattr(torch.ao.quantization, "quantize_dynamic", _boom)

        svc._quantize_dynamic(model)

        assert model.model is original
        assert svc.is_quantized() is False

    # Name length is load-bearing: TruffleHog's Lob detector matches `test_`
    # plus exactly 35 characters and flags it as a verified secret.
    def test_health_reports_actual_state(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """`quantized: true` on /health must mean int8 is RUNNING."""
        import src.rerank.service as svc
        from src.config import settings

        monkeypatch.setattr(settings, "quantize", True)

        assert svc.is_quantized() is False


class TestConcurrencyIsBounded:
    """Two rerank calls must not hold the model at the same time.

    `asyncio.to_thread` uses the default executor, which sizes itself from
    `os.cpu_count()` — the HOST's cores, not the cgroup quota. Without a gate,
    N concurrent requests become N scoring threads each asking torch for
    `torch_threads` threads of its own: the same oversubscription this service
    was fixed for, re-entered through concurrency.
    """

    @pytest.fixture(autouse=True)
    def _reset_semaphore(self) -> Any:
        import src.rerank.service as svc

        svc._model_semaphore = None
        yield
        svc._model_semaphore = None

    @staticmethod
    def _recording_scorer(intervals: list[tuple[float, float]]) -> Any:
        """A scorer that records when it entered and left."""

        def _scorer(query: str, texts: list[str]) -> list[float]:
            entered = time.perf_counter()
            time.sleep(0.15)
            intervals.append((entered, time.perf_counter()))
            return [0.5] * len(texts)

        return _scorer

    @staticmethod
    def _overlaps(a: tuple[float, float], b: tuple[float, float]) -> bool:
        return a[0] < b[1] and b[0] < a[1]

    @pytest.mark.asyncio
    async def test_two_calls_do_not_overlap(self, monkeypatch: pytest.MonkeyPatch) -> None:
        import src.rerank.service as svc
        from src.config import settings

        monkeypatch.setattr(settings, "max_concurrent_requests", 1)
        intervals: list[tuple[float, float]] = []
        monkeypatch.setattr(svc, "_score_pairs_sync", self._recording_scorer(intervals))

        await asyncio.gather(
            svc.rerank("q1", [("a", "text a")]),
            svc.rerank("q2", [("b", "text b")]),
        )

        assert len(intervals) == 2
        assert not self._overlaps(intervals[0], intervals[1]), (
            f"scoring overlapped: {intervals}"
        )

    @pytest.mark.asyncio
    async def test_five_calls_serialise(self, monkeypatch: pytest.MonkeyPatch) -> None:
        import src.rerank.service as svc
        from src.config import settings

        monkeypatch.setattr(settings, "max_concurrent_requests", 1)
        intervals: list[tuple[float, float]] = []
        monkeypatch.setattr(svc, "_score_pairs_sync", self._recording_scorer(intervals))

        await asyncio.gather(*(svc.rerank(f"q{i}", [("a", "t")]) for i in range(5)))

        ordered = sorted(intervals)
        for earlier, later in zip(ordered, ordered[1:], strict=False):
            assert not self._overlaps(earlier, later), f"overlap: {earlier} {later}"

    @pytest.mark.asyncio
    async def test_all_results_still_returned(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Serialising must not drop or corrupt anyone's answer."""
        import src.rerank.service as svc
        from src.config import settings

        monkeypatch.setattr(settings, "max_concurrent_requests", 1)
        intervals: list[tuple[float, float]] = []
        monkeypatch.setattr(svc, "_score_pairs_sync", self._recording_scorer(intervals))

        results = await asyncio.gather(
            svc.rerank("q1", [("a", "t"), ("b", "t")]),
            svc.rerank("q2", [("c", "t")]),
        )

        assert {pid for pid, _ in results[0]} == {"a", "b"}
        assert {pid for pid, _ in results[1]} == {"c"}

    @pytest.mark.asyncio
    async def test_limit_above_one_allows_overlap(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Guard the test itself: with the gate widened the calls DO overlap, so
        a passing serialisation test cannot be an artifact of the harness."""
        import src.rerank.service as svc
        from src.config import settings

        monkeypatch.setattr(settings, "max_concurrent_requests", 2)
        intervals: list[tuple[float, float]] = []
        monkeypatch.setattr(svc, "_score_pairs_sync", self._recording_scorer(intervals))

        await asyncio.gather(
            svc.rerank("q1", [("a", "t")]),
            svc.rerank("q2", [("b", "t")]),
        )

        assert self._overlaps(intervals[0], intervals[1])

    @pytest.mark.asyncio
    async def test_queue_wait_is_warned(
        self, monkeypatch: pytest.MonkeyPatch, caplog: Any
    ) -> None:
        """Sustained queueing is the signal to add replicas — it must be visible."""
        import src.rerank.service as svc
        from src.config import settings

        monkeypatch.setattr(settings, "max_concurrent_requests", 1)
        monkeypatch.setattr(svc, "_QUEUE_WARN_SECONDS", 0.05)
        intervals: list[tuple[float, float]] = []
        monkeypatch.setattr(svc, "_score_pairs_sync", self._recording_scorer(intervals))

        with caplog.at_level("WARNING"):
            await asyncio.gather(
                svc.rerank("q1", [("a", "t")]),
                svc.rerank("q2", [("b", "t")]),
            )

        warnings = [r.getMessage() for r in caplog.records if r.levelname == "WARNING"]
        assert any("waited" in m for m in warnings), warnings

    @pytest.mark.asyncio
    async def test_no_warning_when_uncontended(
        self, monkeypatch: pytest.MonkeyPatch, caplog: Any
    ) -> None:
        import src.rerank.service as svc
        from src.config import settings

        monkeypatch.setattr(settings, "max_concurrent_requests", 1)
        intervals: list[tuple[float, float]] = []
        monkeypatch.setattr(svc, "_score_pairs_sync", self._recording_scorer(intervals))

        with caplog.at_level("WARNING"):
            await svc.rerank("q1", [("a", "t")])

        assert [r for r in caplog.records if r.levelname == "WARNING"] == []

    @pytest.mark.asyncio
    async def test_semaphore_released_on_error(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A failed scoring pass must not wedge the service forever."""
        import src.rerank.service as svc
        from src.config import settings

        monkeypatch.setattr(settings, "max_concurrent_requests", 1)

        def _boom(query: str, texts: list[str]) -> list[float]:
            raise RuntimeError("scoring blew up")

        monkeypatch.setattr(svc, "_score_pairs_sync", _boom)
        with pytest.raises(RuntimeError):
            await svc.rerank("q", [("a", "t")])

        monkeypatch.setattr(svc, "_score_pairs_sync", lambda q, t: [0.5] * len(t))
        assert await svc.rerank("q", [("a", "t")]) == [("a", 0.5)]
