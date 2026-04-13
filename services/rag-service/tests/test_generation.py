"""Tests for core/generation.py — vLLM client for text generation and SSE streaming.

Covers:
- generate_completion: Non-streaming call, JSON mode, max_tokens default, HTTP error
- stream_completion: SSE line parsing, [DONE] signal, malformed chunks, empty content
- get_model_info: Model metadata return
"""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from src.core.generation import (
    _check_budget,
    generate_completion,
    get_model_info,
    stream_completion,
)
from src.shared.exceptions import BudgetExceededError


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _chat_completion_response(content: str = "Generated text") -> dict[str, Any]:
    """Build a standard OpenAI-compatible chat completion response."""
    return {
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": content},
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": 100, "completion_tokens": 50, "total_tokens": 150},
    }


# ===========================================================================
# generate_completion
# ===========================================================================


class TestGenerateCompletion:
    """Test non-streaming chat completion."""

    @pytest.mark.asyncio
    async def test_success_returns_content(self) -> None:
        mock_response = MagicMock()
        mock_response.json.return_value = _chat_completion_response("Hello world")
        mock_response.raise_for_status = MagicMock()

        with patch("src.core.generation.httpx.AsyncClient") as MockClient:
            client = AsyncMock()
            client.post.return_value = mock_response
            client.__aenter__ = AsyncMock(return_value=client)
            client.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = client

            result = await generate_completion("System msg", "User msg")

        assert result == "Hello world"

    @pytest.mark.asyncio
    async def test_json_mode_sets_response_format(self) -> None:
        captured_payload: dict[str, Any] = {}

        mock_response = MagicMock()
        mock_response.json.return_value = _chat_completion_response('{"key": "value"}')
        mock_response.raise_for_status = MagicMock()

        async def _capture_post(url: str, json: dict[str, Any]) -> AsyncMock:
            captured_payload.update(json)
            return mock_response

        with patch("src.core.generation.httpx.AsyncClient") as MockClient:
            client = AsyncMock()
            client.post = _capture_post
            client.__aenter__ = AsyncMock(return_value=client)
            client.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = client

            await generate_completion("sys", "user", response_format="json_object")

        assert captured_payload["response_format"] == {"type": "json_object"}

    @pytest.mark.asyncio
    async def test_no_json_mode_omits_response_format(self) -> None:
        captured_payload: dict[str, Any] = {}

        mock_response = MagicMock()
        mock_response.json.return_value = _chat_completion_response("text")
        mock_response.raise_for_status = MagicMock()

        async def _capture_post(url: str, json: dict[str, Any]) -> AsyncMock:
            captured_payload.update(json)
            return mock_response

        with patch("src.core.generation.httpx.AsyncClient") as MockClient:
            client = AsyncMock()
            client.post = _capture_post
            client.__aenter__ = AsyncMock(return_value=client)
            client.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = client

            await generate_completion("sys", "user")

        assert "response_format" not in captured_payload

    @pytest.mark.asyncio
    async def test_custom_max_tokens(self) -> None:
        captured_payload: dict[str, Any] = {}

        mock_response = MagicMock()
        mock_response.json.return_value = _chat_completion_response("text")
        mock_response.raise_for_status = MagicMock()

        async def _capture_post(url: str, json: dict[str, Any]) -> AsyncMock:
            captured_payload.update(json)
            return mock_response

        with patch("src.core.generation.httpx.AsyncClient") as MockClient:
            client = AsyncMock()
            client.post = _capture_post
            client.__aenter__ = AsyncMock(return_value=client)
            client.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = client

            await generate_completion("sys", "user", max_tokens=2048)

        assert captured_payload["max_tokens"] == 2048

    @pytest.mark.asyncio
    async def test_default_max_tokens_from_settings(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from src.config import settings
        monkeypatch.setattr(settings, "answer_max_tokens", 5000)

        captured_payload: dict[str, Any] = {}

        mock_response = MagicMock()
        mock_response.json.return_value = _chat_completion_response("text")
        mock_response.raise_for_status = MagicMock()

        async def _capture_post(url: str, json: dict[str, Any]) -> AsyncMock:
            captured_payload.update(json)
            return mock_response

        with patch("src.core.generation.httpx.AsyncClient") as MockClient:
            client = AsyncMock()
            client.post = _capture_post
            client.__aenter__ = AsyncMock(return_value=client)
            client.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = client

            await generate_completion("sys", "user")  # No max_tokens

        assert captured_payload["max_tokens"] == 5000

    @pytest.mark.asyncio
    async def test_custom_temperature(self) -> None:
        captured_payload: dict[str, Any] = {}

        mock_response = MagicMock()
        mock_response.json.return_value = _chat_completion_response("text")
        mock_response.raise_for_status = MagicMock()

        async def _capture_post(url: str, json: dict[str, Any]) -> AsyncMock:
            captured_payload.update(json)
            return mock_response

        with patch("src.core.generation.httpx.AsyncClient") as MockClient:
            client = AsyncMock()
            client.post = _capture_post
            client.__aenter__ = AsyncMock(return_value=client)
            client.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = client

            await generate_completion("sys", "user", temperature=0.7)

        assert captured_payload["temperature"] == 0.7

    @pytest.mark.asyncio
    async def test_default_temperature(self) -> None:
        captured_payload: dict[str, Any] = {}

        mock_response = MagicMock()
        mock_response.json.return_value = _chat_completion_response("text")
        mock_response.raise_for_status = MagicMock()

        async def _capture_post(url: str, json: dict[str, Any]) -> AsyncMock:
            captured_payload.update(json)
            return mock_response

        with patch("src.core.generation.httpx.AsyncClient") as MockClient:
            client = AsyncMock()
            client.post = _capture_post
            client.__aenter__ = AsyncMock(return_value=client)
            client.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = client

            await generate_completion("sys", "user")

        assert captured_payload["temperature"] == 0.2

    @pytest.mark.asyncio
    async def test_messages_structure(self) -> None:
        captured_payload: dict[str, Any] = {}

        mock_response = MagicMock()
        mock_response.json.return_value = _chat_completion_response("text")
        mock_response.raise_for_status = MagicMock()

        async def _capture_post(url: str, json: dict[str, Any]) -> AsyncMock:
            captured_payload.update(json)
            return mock_response

        with patch("src.core.generation.httpx.AsyncClient") as MockClient:
            client = AsyncMock()
            client.post = _capture_post
            client.__aenter__ = AsyncMock(return_value=client)
            client.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = client

            await generate_completion("System prompt here", "User query here")

        messages = captured_payload["messages"]
        assert len(messages) == 2
        assert messages[0] == {"role": "system", "content": "System prompt here"}
        assert messages[1] == {"role": "user", "content": "User query here"}

    @pytest.mark.asyncio
    async def test_posts_to_correct_url(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from src.config import settings
        monkeypatch.setattr(settings, "vllm_base_url", "http://vllm:9000/v1")

        captured_url: list[str] = []

        mock_response = MagicMock()
        mock_response.json.return_value = _chat_completion_response("text")
        mock_response.raise_for_status = MagicMock()

        async def _capture_post(url: str, json: dict[str, Any]) -> AsyncMock:
            captured_url.append(url)
            return mock_response

        with patch("src.core.generation.httpx.AsyncClient") as MockClient:
            client = AsyncMock()
            client.post = _capture_post
            client.__aenter__ = AsyncMock(return_value=client)
            client.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = client

            await generate_completion("sys", "user")

        assert captured_url[0] == "http://vllm:9000/v1/chat/completions"

    @pytest.mark.asyncio
    async def test_http_error_propagates(self) -> None:
        with patch("src.core.generation.httpx.AsyncClient") as MockClient:
            client = AsyncMock()
            error_response = httpx.Response(
                503,
                request=httpx.Request("POST", "http://vllm:8000/v1/chat/completions"),
            )
            client.post.return_value = MagicMock()
            client.post.return_value.raise_for_status.side_effect = httpx.HTTPStatusError(
                "Service Unavailable", request=error_response.request, response=error_response
            )
            client.__aenter__ = AsyncMock(return_value=client)
            client.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = client

            with pytest.raises(httpx.HTTPStatusError):
                await generate_completion("sys", "user")

    @pytest.mark.asyncio
    async def test_model_from_settings(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from src.config import settings
        monkeypatch.setattr(settings, "vllm_model", "qwen2.5-72b-instruct")

        captured_payload: dict[str, Any] = {}

        mock_response = MagicMock()
        mock_response.json.return_value = _chat_completion_response("text")
        mock_response.raise_for_status = MagicMock()

        async def _capture_post(url: str, json: dict[str, Any]) -> AsyncMock:
            captured_payload.update(json)
            return mock_response

        with patch("src.core.generation.httpx.AsyncClient") as MockClient:
            client = AsyncMock()
            client.post = _capture_post
            client.__aenter__ = AsyncMock(return_value=client)
            client.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = client

            await generate_completion("sys", "user")

        assert captured_payload["model"] == "qwen2.5-72b-instruct"


# ===========================================================================
# stream_completion
# ===========================================================================


class TestStreamCompletion:
    """Test SSE streaming from vLLM."""

    @pytest.mark.asyncio
    async def test_yields_content_chunks(self) -> None:
        """Should yield content from SSE data lines."""
        sse_lines = [
            'data: {"choices":[{"delta":{"content":"Hello"}}]}',
            'data: {"choices":[{"delta":{"content":" world"}}]}',
            "data: [DONE]",
        ]

        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()

        async def _aiter_lines():
            for line in sse_lines:
                yield line

        mock_response.aiter_lines = _aiter_lines

        with patch("src.core.generation.httpx.AsyncClient") as MockClient:
            stream_ctx = MagicMock()
            stream_ctx.__aenter__ = AsyncMock(return_value=mock_response)
            stream_ctx.__aexit__ = AsyncMock(return_value=False)
            client = MagicMock()
            client.stream.return_value = stream_ctx
            client.__aenter__ = AsyncMock(return_value=client)
            client.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = client

            chunks: list[str] = []
            async for chunk in stream_completion("sys", "user"):
                chunks.append(chunk)

        assert chunks == ["Hello", " world"]

    @pytest.mark.asyncio
    async def test_done_signal_stops_iteration(self) -> None:
        """[DONE] should stop the stream."""
        sse_lines = [
            'data: {"choices":[{"delta":{"content":"Before"}}]}',
            "data: [DONE]",
            'data: {"choices":[{"delta":{"content":"After"}}]}',  # Should not appear
        ]

        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()

        async def _aiter_lines():
            for line in sse_lines:
                yield line

        mock_response.aiter_lines = _aiter_lines

        with patch("src.core.generation.httpx.AsyncClient") as MockClient:
            stream_ctx = MagicMock()
            stream_ctx.__aenter__ = AsyncMock(return_value=mock_response)
            stream_ctx.__aexit__ = AsyncMock(return_value=False)
            client = MagicMock()
            client.stream.return_value = stream_ctx
            client.__aenter__ = AsyncMock(return_value=client)
            client.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = client

            chunks: list[str] = []
            async for chunk in stream_completion("sys", "user"):
                chunks.append(chunk)

        assert chunks == ["Before"]

    @pytest.mark.asyncio
    async def test_skips_non_data_lines(self) -> None:
        """Lines not starting with 'data: ' should be ignored."""
        sse_lines = [
            ": comment line",
            "",
            "event: ping",
            'data: {"choices":[{"delta":{"content":"OK"}}]}',
            "data: [DONE]",
        ]

        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()

        async def _aiter_lines():
            for line in sse_lines:
                yield line

        mock_response.aiter_lines = _aiter_lines

        with patch("src.core.generation.httpx.AsyncClient") as MockClient:
            stream_ctx = MagicMock()
            stream_ctx.__aenter__ = AsyncMock(return_value=mock_response)
            stream_ctx.__aexit__ = AsyncMock(return_value=False)
            client = MagicMock()
            client.stream.return_value = stream_ctx
            client.__aenter__ = AsyncMock(return_value=client)
            client.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = client

            chunks: list[str] = []
            async for chunk in stream_completion("sys", "user"):
                chunks.append(chunk)

        assert chunks == ["OK"]

    @pytest.mark.asyncio
    async def test_skips_malformed_json(self) -> None:
        """Malformed JSON chunks should be silently skipped."""
        sse_lines = [
            "data: {not valid json}",
            'data: {"choices":[{"delta":{"content":"Good"}}]}',
            "data: [DONE]",
        ]

        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()

        async def _aiter_lines():
            for line in sse_lines:
                yield line

        mock_response.aiter_lines = _aiter_lines

        with patch("src.core.generation.httpx.AsyncClient") as MockClient:
            stream_ctx = MagicMock()
            stream_ctx.__aenter__ = AsyncMock(return_value=mock_response)
            stream_ctx.__aexit__ = AsyncMock(return_value=False)
            client = MagicMock()
            client.stream.return_value = stream_ctx
            client.__aenter__ = AsyncMock(return_value=client)
            client.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = client

            chunks: list[str] = []
            async for chunk in stream_completion("sys", "user"):
                chunks.append(chunk)

        assert chunks == ["Good"]

    @pytest.mark.asyncio
    async def test_skips_empty_content(self) -> None:
        """Chunks with empty or missing content should be skipped."""
        sse_lines = [
            'data: {"choices":[{"delta":{"content":""}}]}',
            'data: {"choices":[{"delta":{}}]}',
            'data: {"choices":[{"delta":{"content":"Real"}}]}',
            "data: [DONE]",
        ]

        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()

        async def _aiter_lines():
            for line in sse_lines:
                yield line

        mock_response.aiter_lines = _aiter_lines

        with patch("src.core.generation.httpx.AsyncClient") as MockClient:
            stream_ctx = MagicMock()
            stream_ctx.__aenter__ = AsyncMock(return_value=mock_response)
            stream_ctx.__aexit__ = AsyncMock(return_value=False)
            client = MagicMock()
            client.stream.return_value = stream_ctx
            client.__aenter__ = AsyncMock(return_value=client)
            client.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = client

            chunks: list[str] = []
            async for chunk in stream_completion("sys", "user"):
                chunks.append(chunk)

        assert chunks == ["Real"]

    @pytest.mark.asyncio
    async def test_stream_flag_set(self) -> None:
        """Streaming request should set stream=True in payload."""
        captured_payload: dict[str, Any] = {}

        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()

        async def _aiter_lines():
            yield "data: [DONE]"

        mock_response.aiter_lines = _aiter_lines

        with patch("src.core.generation.httpx.AsyncClient") as MockClient:
            client = AsyncMock()

            def _capture_stream(method: str, url: str, json: dict[str, Any]) -> AsyncMock:
                captured_payload.update(json)
                ctx = AsyncMock()
                ctx.__aenter__ = AsyncMock(return_value=mock_response)
                ctx.__aexit__ = AsyncMock(return_value=False)
                return ctx

            client.stream = _capture_stream
            client.__aenter__ = AsyncMock(return_value=client)
            client.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = client

            async for _ in stream_completion("sys", "user"):
                pass

        assert captured_payload["stream"] is True

    @pytest.mark.asyncio
    async def test_empty_stream(self) -> None:
        """Stream with no data lines should yield nothing."""
        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()

        async def _aiter_lines():
            yield "data: [DONE]"

        mock_response.aiter_lines = _aiter_lines

        with patch("src.core.generation.httpx.AsyncClient") as MockClient:
            stream_ctx = MagicMock()
            stream_ctx.__aenter__ = AsyncMock(return_value=mock_response)
            stream_ctx.__aexit__ = AsyncMock(return_value=False)
            client = MagicMock()
            client.stream.return_value = stream_ctx
            client.__aenter__ = AsyncMock(return_value=client)
            client.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = client

            chunks: list[str] = []
            async for chunk in stream_completion("sys", "user"):
                chunks.append(chunk)

        assert chunks == []

    @pytest.mark.asyncio
    async def test_skips_empty_choices(self) -> None:
        """Chunks with empty choices array should be skipped."""
        sse_lines = [
            'data: {"choices":[]}',
            'data: {"choices":[{"delta":{"content":"OK"}}]}',
            "data: [DONE]",
        ]

        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()

        async def _aiter_lines():
            for line in sse_lines:
                yield line

        mock_response.aiter_lines = _aiter_lines

        with patch("src.core.generation.httpx.AsyncClient") as MockClient:
            stream_ctx = MagicMock()
            stream_ctx.__aenter__ = AsyncMock(return_value=mock_response)
            stream_ctx.__aexit__ = AsyncMock(return_value=False)
            client = MagicMock()
            client.stream.return_value = stream_ctx
            client.__aenter__ = AsyncMock(return_value=client)
            client.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = client

            chunks: list[str] = []
            async for chunk in stream_completion("sys", "user"):
                chunks.append(chunk)

        assert chunks == ["OK"]


# ===========================================================================
# get_model_info
# ===========================================================================


class TestGetModelInfo:
    """Test model metadata return."""

    def test_returns_model_name(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from src.config import settings
        monkeypatch.setattr(settings, "vllm_model", "llama-3.1-70b")
        monkeypatch.setattr(settings, "vllm_base_url", "http://gpu:8000/v1")

        info = get_model_info()
        assert info["model_name"] == "llama-3.1-70b"
        assert info["vllm_base_url"] == "http://gpu:8000/v1"

    def test_returns_dict(self) -> None:
        info = get_model_info()
        assert isinstance(info, dict)
        assert "model_name" in info
        assert "vllm_base_url" in info


# ===========================================================================
# _check_budget — monthly and optional daily cap enforcement (§7.2)
# ===========================================================================


def _make_mock_redis(
    *,
    monthly_budget: str | None = None,
    daily_budget: str | None = None,
    monthly_spend: str | None = None,
    daily_spend: str | None = None,
) -> AsyncMock:
    """Build an AsyncMock redis client returning canned budget values."""
    redis = AsyncMock()

    async def _get(key: str) -> str | None:
        if key == "llm:config:monthly_budget_usd":
            return monthly_budget
        if key == "llm:config:daily_budget_usd":
            return daily_budget
        return None

    async def _hget(key: str, field: str) -> str | None:
        if field != "estimated_cost_usd":
            return None
        if key.startswith("llm:usage:daily:"):
            return daily_spend
        if key.startswith("llm:usage:"):
            return monthly_spend
        return None

    redis.get = _get
    redis.hget = _hget
    return redis


class TestCheckBudget:
    """Test the dual monthly/daily budget killswitch in _check_budget."""

    @pytest.mark.asyncio
    async def test_no_budget_configured_is_noop(self) -> None:
        redis = _make_mock_redis()
        with patch("src.core.generation._get_redis", AsyncMock(return_value=redis)):
            await _check_budget()  # should not raise

    @pytest.mark.asyncio
    async def test_monthly_only_under_budget(self) -> None:
        redis = _make_mock_redis(monthly_budget="200", monthly_spend="50.00")
        with patch("src.core.generation._get_redis", AsyncMock(return_value=redis)):
            await _check_budget()

    @pytest.mark.asyncio
    async def test_monthly_only_over_budget_raises(self) -> None:
        redis = _make_mock_redis(monthly_budget="200", monthly_spend="200.01")
        with patch("src.core.generation._get_redis", AsyncMock(return_value=redis)):
            with pytest.raises(BudgetExceededError) as exc_info:
                await _check_budget()
        assert "Monthly" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_daily_cap_trips_before_monthly(self) -> None:
        """Daily spend at cap must raise even though monthly spend is well under budget."""
        redis = _make_mock_redis(
            monthly_budget="200",
            daily_budget="15",
            monthly_spend="50.00",
            daily_spend="15.00",
        )
        with patch("src.core.generation._get_redis", AsyncMock(return_value=redis)):
            with pytest.raises(BudgetExceededError) as exc_info:
                await _check_budget()
        assert "Daily" in str(exc_info.value)
        assert "Monthly" not in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_monthly_trips_when_daily_under(self) -> None:
        """When daily is under but monthly is exhausted, monthly wins."""
        redis = _make_mock_redis(
            monthly_budget="200",
            daily_budget="15",
            monthly_spend="200.00",
            daily_spend="5.00",
        )
        with patch("src.core.generation._get_redis", AsyncMock(return_value=redis)):
            with pytest.raises(BudgetExceededError) as exc_info:
                await _check_budget()
        assert "Monthly" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_daily_unset_means_no_daily_enforcement(self) -> None:
        """With daily budget unset, the daily spend never triggers BudgetExceededError."""
        redis = _make_mock_redis(
            monthly_budget="200",
            daily_budget=None,
            monthly_spend="50.00",
            daily_spend="999.99",
        )
        with patch("src.core.generation._get_redis", AsyncMock(return_value=redis)):
            await _check_budget()  # should not raise

    @pytest.mark.asyncio
    async def test_daily_only_unset_monthly_enforced(self) -> None:
        redis = _make_mock_redis(monthly_budget="100", monthly_spend="100.50")
        with patch("src.core.generation._get_redis", AsyncMock(return_value=redis)):
            with pytest.raises(BudgetExceededError):
                await _check_budget()

    @pytest.mark.asyncio
    async def test_malformed_daily_budget_is_ignored(self) -> None:
        redis = _make_mock_redis(
            monthly_budget="100",
            daily_budget="not-a-number",
            monthly_spend="10.00",
            daily_spend="50.00",
        )
        with patch("src.core.generation._get_redis", AsyncMock(return_value=redis)):
            await _check_budget()  # malformed daily is treated as unset
