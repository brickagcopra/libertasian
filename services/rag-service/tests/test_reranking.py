"""Tests for core/reranking.py — Cross-encoder reranker with RRF fallback.

Covers:
- rerank_passages: Empty list, no reranker URL, success, fallback on error
- _call_reranker: HTTP call, score mapping, passage text truncation
- _fallback_rerank: RRF score sorting, top_k truncation
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from src.core.reranking import (
    _call_reranker,
    _fallback_rerank,
    rerank_passages,
)
from src.core.schemas import Passage


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _passage(
    pid: str = "p1",
    score: float = 0.5,
    text: str = "passage text",
    rerank_score: float | None = None,
) -> Passage:
    return Passage(
        id=pid,
        document_id=f"doc-{pid}",
        text=text,
        score=score,
        bm25_score=score,
        knn_score=0.0,
        rerank_score=rerank_score,
    )


# ===========================================================================
# _fallback_rerank
# ===========================================================================


class TestFallbackRerank:
    """Test fallback RRF-score-based reranking."""

    def test_sorts_by_score_descending(self) -> None:
        passages = [_passage("a", 0.3), _passage("b", 0.9), _passage("c", 0.6)]
        result = _fallback_rerank(passages, top_k=10)
        scores = [p.score for p in result]
        assert scores == [0.9, 0.6, 0.3]

    def test_top_k_truncation(self) -> None:
        passages = [_passage(f"p{i}", float(i)) for i in range(10)]
        result = _fallback_rerank(passages, top_k=3)
        assert len(result) == 3
        # Highest 3 scores
        assert result[0].score == 9.0
        assert result[2].score == 7.0

    def test_empty_list(self) -> None:
        result = _fallback_rerank([], top_k=5)
        assert result == []

    def test_top_k_larger_than_input(self) -> None:
        passages = [_passage("a", 0.5), _passage("b", 0.3)]
        result = _fallback_rerank(passages, top_k=100)
        assert len(result) == 2

    def test_equal_scores_preserved(self) -> None:
        passages = [_passage("a", 0.5), _passage("b", 0.5), _passage("c", 0.5)]
        result = _fallback_rerank(passages, top_k=3)
        assert len(result) == 3
        assert all(p.score == 0.5 for p in result)


# ===========================================================================
# _call_reranker
# ===========================================================================


class TestCallReranker:
    """Test external reranker HTTP call."""

    @pytest.mark.asyncio
    async def test_success_maps_scores(self) -> None:
        passages = [_passage("p1", 0.5), _passage("p2", 0.3)]

        reranker_response = {
            "results": [
                {"id": "p1", "score": 0.95},
                {"id": "p2", "score": 0.72},
            ],
        }

        mock_response = MagicMock()
        mock_response.json.return_value = reranker_response
        mock_response.raise_for_status = lambda: None

        with patch("src.core.reranking.httpx.AsyncClient") as MockClient:
            client_instance = AsyncMock()
            client_instance.post.return_value = mock_response
            client_instance.__aenter__ = AsyncMock(return_value=client_instance)
            client_instance.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = client_instance

            result = await _call_reranker("http://reranker:8001", "test query", passages)

        assert len(result) == 2
        p1 = next(p for p in result if p.id == "p1")
        p2 = next(p for p in result if p.id == "p2")
        assert p1.rerank_score == 0.95
        assert p2.rerank_score == 0.72

    @pytest.mark.asyncio
    async def test_missing_score_returns_none(self) -> None:
        """Passage not in reranker response gets rerank_score=None."""
        passages = [_passage("p1"), _passage("p2")]

        reranker_response = {
            "results": [{"id": "p1", "score": 0.8}],  # p2 missing
        }

        mock_response = MagicMock()
        mock_response.json.return_value = reranker_response
        mock_response.raise_for_status = lambda: None

        with patch("src.core.reranking.httpx.AsyncClient") as MockClient:
            client_instance = AsyncMock()
            client_instance.post.return_value = mock_response
            client_instance.__aenter__ = AsyncMock(return_value=client_instance)
            client_instance.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = client_instance

            result = await _call_reranker("http://reranker:8001", "query", passages)

        p2 = next(p for p in result if p.id == "p2")
        assert p2.rerank_score is None

    @pytest.mark.asyncio
    async def test_text_truncated_to_1000(self) -> None:
        """Passage text sent to reranker should be truncated to 1000 chars."""
        long_text = "x" * 2000
        passages = [_passage("p1", text=long_text)]

        captured_payload: dict[str, Any] = {}

        mock_response = MagicMock()
        mock_response.json.return_value = {"results": [{"id": "p1", "score": 0.9}]}
        mock_response.raise_for_status = lambda: None

        async def _capture_post(
            url: str, json: dict[str, Any], headers: dict[str, str] | None = None
        ) -> AsyncMock:
            captured_payload.update(json)
            return mock_response

        with patch("src.core.reranking.httpx.AsyncClient") as MockClient:
            client_instance = AsyncMock()
            client_instance.post = _capture_post
            client_instance.__aenter__ = AsyncMock(return_value=client_instance)
            client_instance.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = client_instance

            await _call_reranker("http://reranker:8001", "query", passages)

        sent_text = captured_payload["passages"][0]["text"]
        assert len(sent_text) == 1000

    @pytest.mark.asyncio
    async def test_posts_to_correct_endpoint(self) -> None:
        passages = [_passage("p1")]

        mock_response = MagicMock()
        mock_response.json.return_value = {"results": [{"id": "p1", "score": 0.9}]}
        mock_response.raise_for_status = lambda: None

        with patch("src.core.reranking.httpx.AsyncClient") as MockClient:
            client_instance = AsyncMock()
            client_instance.post.return_value = mock_response
            client_instance.__aenter__ = AsyncMock(return_value=client_instance)
            client_instance.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = client_instance

            await _call_reranker("http://reranker:8001", "query", passages)

        client_instance.post.assert_called_once()
        call_args = client_instance.post.call_args
        assert call_args[0][0] == "http://reranker:8001/rerank"

    @pytest.mark.asyncio
    async def test_http_error_propagates(self) -> None:
        """HTTP errors from reranker should propagate (caller handles)."""
        passages = [_passage("p1")]

        with patch("src.core.reranking.httpx.AsyncClient") as MockClient:
            client_instance = AsyncMock()
            error_response = httpx.Response(500, request=httpx.Request("POST", "http://reranker:8001/rerank"))
            client_instance.post.side_effect = httpx.HTTPStatusError(
                "Server error", request=error_response.request, response=error_response
            )
            client_instance.__aenter__ = AsyncMock(return_value=client_instance)
            client_instance.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = client_instance

            with pytest.raises(httpx.HTTPStatusError):
                await _call_reranker("http://reranker:8001", "query", passages)


# ===========================================================================
# rerank_passages
# ===========================================================================


class TestRerankPassages:
    """Test the main rerank orchestrator."""

    @pytest.mark.asyncio
    async def test_empty_passages_returns_empty(self) -> None:
        outcome = await rerank_passages("query", [], top_k=8)
        assert outcome.passages == []

    @pytest.mark.asyncio
    async def test_no_reranker_url_uses_fallback(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """When reranker_url is empty, should use RRF fallback."""
        from src.config import settings
        monkeypatch.setattr(settings, "reranker_url", "")

        passages = [_passage("a", 0.3), _passage("b", 0.9), _passage("c", 0.6)]
        outcome = await rerank_passages("query", passages, top_k=2)

        assert len(outcome.passages) == 2
        assert outcome.passages[0].id == "b"  # Highest RRF score
        assert outcome.passages[1].id == "c"

    @pytest.mark.asyncio
    async def test_reranker_success_sorts_by_rerank_score(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from src.config import settings
        monkeypatch.setattr(settings, "reranker_url", "http://reranker:8001")

        passages = [_passage("a", 0.9), _passage("b", 0.3)]

        async def _mock_call(url: str, query: str, passages: list[Passage]) -> list[Passage]:
            return [
                passages[0].model_copy(update={"rerank_score": 0.4}),
                passages[1].model_copy(update={"rerank_score": 0.95}),
            ]

        with patch("src.core.reranking._call_reranker", side_effect=_mock_call):
            outcome = await rerank_passages("query", passages, top_k=2)

        # b has higher rerank_score (0.95) despite lower RRF score
        assert outcome.passages[0].id == "b"
        assert outcome.passages[0].rerank_score == 0.95

    @pytest.mark.asyncio
    async def test_reranker_error_falls_back_to_rrf(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Reranker HTTP failure should gracefully fall back to RRF scores."""
        from src.config import settings
        monkeypatch.setattr(settings, "reranker_url", "http://reranker:8001")

        passages = [_passage("a", 0.3), _passage("b", 0.9)]

        with patch("src.core.reranking._call_reranker", side_effect=Exception("Connection refused")):
            outcome = await rerank_passages("query", passages, top_k=2)

        # Should fall back to RRF scores
        assert outcome.passages[0].id == "b"
        assert outcome.passages[0].score == 0.9

    @pytest.mark.asyncio
    async def test_top_k_applied_after_reranking(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from src.config import settings
        monkeypatch.setattr(settings, "reranker_url", "http://reranker:8001")

        passages = [_passage(f"p{i}", float(i) / 10) for i in range(10)]

        async def _mock_call(url: str, query: str, passages: list[Passage]) -> list[Passage]:
            return [p.model_copy(update={"rerank_score": p.score}) for p in passages]

        with patch("src.core.reranking._call_reranker", side_effect=_mock_call):
            outcome = await rerank_passages("query", passages, top_k=3)

        assert len(outcome.passages) == 3

    @pytest.mark.asyncio
    async def test_single_passage(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Single passage should work fine."""
        from src.config import settings
        monkeypatch.setattr(settings, "reranker_url", "")

        passages = [_passage("solo", 0.75)]
        outcome = await rerank_passages("query", passages, top_k=8)

        assert len(outcome.passages) == 1
        assert outcome.passages[0].id == "solo"


class TestInternalAuthHeader:
    """The trap: enforce auth server-side, forget it client-side, get RRF.

    reranker-service enforces X-Internal-Api-Key exactly as embedding-service
    does. This client sent no headers at all, so the first production call would
    have been a 403 that `rerank_passages` swallows into an RRF fallback —
    indistinguishable from "no reranker deployed".
    """

    @pytest.mark.asyncio
    async def test_header_is_sent(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from src.config import settings

        monkeypatch.setattr(settings, "internal_api_key", "secret-key")
        captured: dict[str, Any] = {}

        response = MagicMock()
        response.json.return_value = {"results": []}
        response.raise_for_status = lambda: None

        async def _post(
        url: str, json: dict[str, Any], headers: dict[str, str] | None = None
    ) -> Any:
            captured["headers"] = headers
            return response

        with patch("src.core.reranking.httpx.AsyncClient") as mock_client:
            instance = MagicMock()
            instance.post = _post
            instance.__aenter__ = _aret(instance)
            instance.__aexit__ = _aret(False)
            mock_client.return_value = instance
            await _call_reranker("http://reranker:8002", "q", [_passage("p1")])

        assert captured["headers"] == {"X-Internal-Api-Key": "secret-key"}

    def test_header_name_matches_worker(self) -> None:
        """One spelling across the fleet — worker-service set the precedent."""
        from src.core.reranking import _internal_headers

        assert list(_internal_headers()) == ["X-Internal-Api-Key"]


class TestDegradedMarkers:
    """A reranker that did not run must say so, and say WHY."""

    @pytest.fixture(autouse=True)
    def _reset_latch(self) -> Any:
        import src.core.reranking as module

        module._reranker_unconfigured_warned = False
        yield
        module._reranker_unconfigured_warned = False

    @pytest.mark.asyncio
    async def test_success_is_not_degraded(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from src.config import settings

        monkeypatch.setattr(settings, "reranker_url", "http://reranker:8002")
        passages = [_passage("a", 0.3)]

        async def _ok(url: str, query: str, ps: list[Passage]) -> list[Passage]:
            return [p.model_copy(update={"rerank_score": 0.9}) for p in ps]

        with patch("src.core.reranking._call_reranker", side_effect=_ok):
            outcome = await rerank_passages("q", passages, top_k=1)

        assert outcome.degraded is False
        assert outcome.degraded_legs == []

    @pytest.mark.asyncio
    async def test_unconfigured_marker(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from src.config import settings

        monkeypatch.setattr(settings, "reranker_url", "")
        outcome = await rerank_passages("q", [_passage("a", 0.3)], top_k=1)

        assert outcome.degraded is True
        assert outcome.degraded_legs == ["reranker:not_configured"]

    @pytest.mark.asyncio
    async def test_unconfigured_warns_once(
        self, monkeypatch: pytest.MonkeyPatch, caplog: Any
    ) -> None:
        """Standing config choice: never ERROR, never per request."""
        from src.config import settings

        monkeypatch.setattr(settings, "reranker_url", "")
        with caplog.at_level("DEBUG"):
            for _ in range(4):
                await rerank_passages("q", [_passage("a", 0.3)], top_k=1)

        assert [r for r in caplog.records if r.levelname == "ERROR"] == []
        assert len([r for r in caplog.records if r.levelname == "WARNING"]) == 1

    @pytest.mark.asyncio
    async def test_timeout_marker(self, monkeypatch: pytest.MonkeyPatch, caplog: Any) -> None:
        from src.config import settings

        monkeypatch.setattr(settings, "reranker_url", "http://reranker:8002")

        with (
            patch("src.core.reranking._call_reranker", side_effect=httpx.ReadTimeout("slow")),
            caplog.at_level("ERROR"),
        ):
            outcome = await rerank_passages("q", [_passage("a", 0.3)], top_k=1)

        assert outcome.degraded_legs == ["reranker:unreachable"]
        assert any(r.levelname == "ERROR" for r in caplog.records)

    @pytest.mark.asyncio
    async def test_unreachable_marker(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from src.config import settings

        monkeypatch.setattr(settings, "reranker_url", "http://reranker:8002")

        with patch("src.core.reranking._call_reranker", side_effect=httpx.ConnectError("no")):
            outcome = await rerank_passages("q", [_passage("a", 0.3)], top_k=1)

        assert outcome.degraded_legs == ["reranker:unreachable"]

    @pytest.mark.asyncio
    async def test_forbidden_marks_failed(
        self, monkeypatch: pytest.MonkeyPatch, caplog: Any
    ) -> None:
        """The 403 case specifically: a missing internal key must be LOUD."""
        from src.config import settings

        monkeypatch.setattr(settings, "reranker_url", "http://reranker:8002")
        request = httpx.Request("POST", "http://reranker:8002/rerank")
        forbidden = httpx.HTTPStatusError(
            "403", request=request, response=httpx.Response(403, request=request)
        )

        with (
            patch("src.core.reranking._call_reranker", side_effect=forbidden),
            caplog.at_level("ERROR"),
        ):
            outcome = await rerank_passages("q", [_passage("a", 0.3)], top_k=1)

        assert outcome.degraded_legs == ["reranker:failed"]
        assert any(r.levelname == "ERROR" for r in caplog.records)

    @pytest.mark.asyncio
    async def test_malformed_body_marks_failed(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from src.config import settings

        monkeypatch.setattr(settings, "reranker_url", "http://reranker:8002")

        with patch("src.core.reranking._call_reranker", side_effect=KeyError("score")):
            outcome = await rerank_passages("q", [_passage("a", 0.3)], top_k=1)

        assert outcome.degraded_legs == ["reranker:failed"]

    @pytest.mark.asyncio
    async def test_failure_still_returns_passages(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Ordering degrades; the answer does not disappear."""
        from src.config import settings

        monkeypatch.setattr(settings, "reranker_url", "http://reranker:8002")
        passages = [_passage("a", 0.3), _passage("b", 0.9)]

        with patch("src.core.reranking._call_reranker", side_effect=httpx.ConnectError("no")):
            outcome = await rerank_passages("q", passages, top_k=2)

        assert [p.id for p in outcome.passages] == ["b", "a"]

    @pytest.mark.asyncio
    async def test_failure_does_not_raise(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from src.config import settings

        monkeypatch.setattr(settings, "reranker_url", "http://reranker:8002")

        with patch("src.core.reranking._call_reranker", side_effect=RuntimeError("boom")):
            await rerank_passages("q", [_passage("a", 0.3)], top_k=1)


def _aret(value: Any) -> Any:
    async def _inner(*_a: Any, **_k: Any) -> Any:
        return value

    return _inner
