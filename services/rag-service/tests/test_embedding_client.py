"""Tests for core/clients/embedding_client.py — the kNN leg's input.

The contract under test is narrow and load-bearing: `embed_query` returns a
vector or ``None``, and **never raises**. It sits on the answer request path, so
an embedding service that is down, slow, or misconfigured must degrade retrieval
to BM25-only — never turn a working keyword search into a failed answer.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, patch

import httpx
import pytest

import src.core.clients.embedding_client as embedding_module
from src.core.clients.embedding_client import embed_query

_DIM = 384
_VECTOR = [0.01] * _DIM


@pytest.fixture(autouse=True)
def _configured(monkeypatch: pytest.MonkeyPatch) -> Any:
    """Point the client at a service and reset its cached connection.

    `_client` is a module-level singleton that captures `base_url` when it is
    created, so a client built under one test's settings would leak into the
    next.
    """
    from src.config import settings

    monkeypatch.setattr(settings, "embedding_service_url", "http://embedding-service:8001")
    monkeypatch.setattr(settings, "embedding_request_timeout", 5)
    monkeypatch.setattr(settings, "embedding_dim", _DIM)
    monkeypatch.setattr(settings, "internal_api_key", "test-key")
    embedding_module._client = None
    yield
    embedding_module._client = None


def _response(payload: Any, status: int = 200) -> httpx.Response:
    request = httpx.Request("POST", "http://embedding-service:8001/embed")
    return httpx.Response(status, request=request, json=payload)


def _patch_post(**kwargs: Any) -> Any:
    """Patch the shared client's POST. `side_effect`/`return_value` pass through."""
    stub = AsyncMock(post=AsyncMock(**kwargs))
    return patch.object(embedding_module, "_get_client", return_value=stub)


class TestSuccessfulEmbedding:
    @pytest.mark.asyncio
    async def test_returns_the_vector(self) -> None:
        payload = {"embedding": _VECTOR, "model_name": "BAAI/bge-small-en-v1.5", "dimension": _DIM}

        with _patch_post(return_value=_response(payload)):
            result = await embed_query("What is estafa?")

        assert result is not None
        assert len(result) == _DIM
        assert all(isinstance(v, float) for v in result)

    @pytest.mark.asyncio
    async def test_posts_the_query_text(self) -> None:
        payload = {"embedding": _VECTOR, "model_name": "m", "dimension": _DIM}
        mock_post = AsyncMock(return_value=_response(payload))

        with patch.object(embedding_module, "_get_client", return_value=AsyncMock(post=mock_post)):
            await embed_query("  What is estafa?  ")

        assert mock_post.call_args.args[0] == "/embed"
        assert mock_post.call_args.kwargs["json"] == {"text": "What is estafa?"}

    @pytest.mark.asyncio
    async def test_sends_the_internal_api_key(self) -> None:
        """Service-to-service auth. Without it every call is a 401."""
        client = embedding_module._get_client()
        assert client.headers["X-Internal-Api-Key"] == "test-key"


class TestFailureReturnsNone:
    """Every failure mode returns None and logs ERROR. None of them raise."""

    @pytest.mark.asyncio
    async def test_timeout(self, caplog: Any) -> None:
        with _patch_post(side_effect=httpx.ReadTimeout("timed out")), caplog.at_level("ERROR"):
            result = await embed_query("estafa")

        assert result is None
        assert any(r.levelname == "ERROR" for r in caplog.records)
        assert "timed out" in "\n".join(r.getMessage() for r in caplog.records).lower()

    @pytest.mark.asyncio
    async def test_non_200(self, caplog: Any) -> None:
        request = httpx.Request("POST", "http://embedding-service:8001/embed")
        response = httpx.Response(500, request=request, json={"detail": "boom"})
        error = httpx.HTTPStatusError("500", request=request, response=response)

        with _patch_post(side_effect=error), caplog.at_level("ERROR"):
            result = await embed_query("estafa")

        assert result is None
        assert "500" in "\n".join(r.getMessage() for r in caplog.records)

    @pytest.mark.asyncio
    async def test_422_from_validation(self, caplog: Any) -> None:
        request = httpx.Request("POST", "http://embedding-service:8001/embed")
        response = httpx.Response(422, request=request, json={"detail": "too long"})
        error = httpx.HTTPStatusError("422", request=request, response=response)

        with _patch_post(side_effect=error), caplog.at_level("ERROR"):
            assert await embed_query("estafa") is None

    @pytest.mark.asyncio
    async def test_connect_error(self, caplog: Any) -> None:
        with _patch_post(side_effect=httpx.ConnectError("refused")), caplog.at_level("ERROR"):
            result = await embed_query("estafa")

        assert result is None
        assert any(r.levelname == "ERROR" for r in caplog.records)

    @pytest.mark.asyncio
    async def test_body_is_not_json(self, caplog: Any) -> None:
        request = httpx.Request("POST", "http://embedding-service:8001/embed")
        response = httpx.Response(200, request=request, text="<html>nope</html>")

        with _patch_post(return_value=response), caplog.at_level("ERROR"):
            result = await embed_query("estafa")

        assert result is None
        assert any(r.levelname == "ERROR" for r in caplog.records)

    @pytest.mark.asyncio
    async def test_unexpected_exception(self) -> None:
        """Anything at all. The caller must never see it."""
        with _patch_post(side_effect=RuntimeError("something else entirely")):
            assert await embed_query("estafa") is None


class TestMalformedBody:
    """A 200 is not proof the body is usable."""

    @pytest.mark.asyncio
    async def test_missing_embedding_key(self, caplog: Any) -> None:
        with _patch_post(return_value=_response({"model_name": "m"})), caplog.at_level("ERROR"):
            result = await embed_query("estafa")

        assert result is None
        assert any(r.levelname == "ERROR" for r in caplog.records)

    @pytest.mark.asyncio
    async def test_embedding_is_not_a_list(self) -> None:
        with _patch_post(return_value=_response({"embedding": "nope"})):
            assert await embed_query("estafa") is None

    @pytest.mark.asyncio
    async def test_embedding_is_empty(self) -> None:
        with _patch_post(return_value=_response({"embedding": []})):
            assert await embed_query("estafa") is None

    @pytest.mark.asyncio
    async def test_non_numeric_elements(self) -> None:
        with _patch_post(return_value=_response({"embedding": ["a"] * _DIM})):
            assert await embed_query("estafa") is None

    @pytest.mark.asyncio
    async def test_body_is_a_list(self) -> None:
        with _patch_post(return_value=_response([1, 2, 3])):
            assert await embed_query("estafa") is None

    @pytest.mark.asyncio
    async def test_wrong_dimension_is_refused(self, caplog: Any) -> None:
        """768 floats would be an opaque OpenSearch 400 — caught here instead.

        This is the same class of failure as #382's wrong field name: a vector
        the index cannot accept produces "all shards failed" and nothing that
        names the real cause.
        """
        wrong = _response({"embedding": [0.1] * 768})
        with _patch_post(return_value=wrong), caplog.at_level("ERROR"):
            result = await embed_query("estafa")

        assert result is None
        message = "\n".join(r.getMessage() for r in caplog.records)
        assert "768" in message
        assert "384" in message

    @pytest.mark.asyncio
    async def test_ints_are_accepted_as_floats(self) -> None:
        """A JSON encoder may emit a bare 0 rather than 0.0."""
        with _patch_post(return_value=_response({"embedding": [0] * _DIM})):
            result = await embed_query("estafa")

        assert result is not None
        assert all(isinstance(v, float) for v in result)


class TestUnconfiguredService:
    """The BM25-only mode kept working on purpose."""

    @pytest.mark.asyncio
    async def test_returns_none_when_url_is_empty(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from src.config import settings

        monkeypatch.setattr(settings, "embedding_service_url", "")
        assert await embed_query("estafa") is None

    @pytest.mark.asyncio
    async def test_unconfigured_logs_no_error(
        self, monkeypatch: pytest.MonkeyPatch, caplog: Any
    ) -> None:
        """Not a runtime failure. Alarming per request is what #382 caught."""
        from src.config import settings

        monkeypatch.setattr(settings, "embedding_service_url", "")
        with caplog.at_level("DEBUG"):
            await embed_query("estafa")

        assert [r for r in caplog.records if r.levelname == "ERROR"] == []

    @pytest.mark.asyncio
    async def test_unconfigured_makes_no_request(self) -> None:
        from src.config import settings

        mock_post = AsyncMock()
        with (
            patch.object(settings, "embedding_service_url", ""),
            patch.object(embedding_module, "_get_client", return_value=AsyncMock(post=mock_post)),
        ):
            await embed_query("estafa")

        mock_post.assert_not_called()


class TestQueryPreparation:
    @pytest.mark.asyncio
    async def test_empty_query_makes_no_request(self) -> None:
        mock_post = AsyncMock()
        with patch.object(embedding_module, "_get_client", return_value=AsyncMock(post=mock_post)):
            assert await embed_query("   ") is None

        mock_post.assert_not_called()

    @pytest.mark.asyncio
    async def test_overlong_query_is_truncated(self) -> None:
        """The service caps `text` at 32768; a longer body is a wasted 422."""
        payload = {"embedding": _VECTOR, "model_name": "m", "dimension": _DIM}
        mock_post = AsyncMock(return_value=_response(payload))

        with patch.object(embedding_module, "_get_client", return_value=AsyncMock(post=mock_post)):
            await embed_query("x" * 40_000)

        assert len(mock_post.call_args.kwargs["json"]["text"]) == 32_768


class TestClientLifecycle:
    @pytest.mark.asyncio
    async def test_client_is_reused(self) -> None:
        """Connection pooling: this is on the request path."""
        assert embedding_module._get_client() is embedding_module._get_client()

    @pytest.mark.asyncio
    async def test_close_releases_the_client(self) -> None:
        from src.core.clients import close_embedding_client

        first = embedding_module._get_client()
        await close_embedding_client()

        assert embedding_module._client is None
        assert embedding_module._get_client() is not first
