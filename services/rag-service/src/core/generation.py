"""Centralized LLM client for text generation and SSE streaming.

Primary: OpenAI API (when RAG_OPENAI_API_KEY is set).
Fallback: vLLM (OpenAI-compatible endpoint, when no API key).

Per CLAUDE.md:
- Pin model versions: record model_name, model_version, prompt_template_version
- SSE streaming for AI answer generation
"""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Any

import httpx

from ..config import settings
from ..shared.exceptions import BudgetExceededError

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Model pricing per 1M tokens: (input_price, output_price)
# ---------------------------------------------------------------------------
MODEL_PRICING: dict[str, tuple[float, float]] = {
    "gpt-4o-mini": (0.15, 0.60),
    "gpt-4o": (2.50, 10.00),
    "gpt-4.1-mini": (0.40, 1.60),
    "gpt-4.1-nano": (0.10, 0.40),
}

# ---------------------------------------------------------------------------
# Lazy-initialized clients
# ---------------------------------------------------------------------------
_openai_client: Any | None = None
_redis_client: Any | None = None


def _get_openai_client() -> Any:
    """Return a module-level singleton AsyncOpenAI client."""
    global _openai_client  # noqa: PLW0603
    if _openai_client is None:
        from openai import AsyncOpenAI

        _openai_client = AsyncOpenAI(
            api_key=settings.openai_api_key,
            timeout=float(settings.openai_request_timeout),
        )
    return _openai_client


async def _get_redis() -> Any:
    """Return a lazy-initialized async Redis client."""
    global _redis_client  # noqa: PLW0603
    if _redis_client is None:
        from redis.asyncio import Redis

        _redis_client = Redis.from_url(settings.redis_url, decode_responses=True)
    return _redis_client


def _use_openai() -> bool:
    """Check whether we should use the OpenAI backend."""
    return bool(settings.openai_api_key)


def _current_month_key(scope: str | None = None) -> str:
    """Redis hash key for this month's usage, global or per-scope."""
    month = datetime.now(UTC).strftime("%Y-%m")
    return f"llm:usage:{month}:{scope}" if scope else f"llm:usage:{month}"


def _current_day_key(scope: str | None = None) -> str:
    """Redis hash key for today's usage (UTC day boundary), global or per-scope."""
    day = datetime.now(UTC).strftime("%Y-%m-%d")
    return f"llm:usage:daily:{day}:{scope}" if scope else f"llm:usage:daily:{day}"


def _parse_budget(raw: Any) -> float | None:
    """Parse a Redis budget value. Returns None if missing, malformed, or <= 0."""
    if raw is None:
        return None
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return None
    return value if value > 0 else None


# ---------------------------------------------------------------------------
# Budget enforcement
# ---------------------------------------------------------------------------
async def _check_one_budget(
    redis: Any,
    *,
    scope: str | None,
    monthly_key: str,
    daily_key: str,
) -> None:
    """Enforce one monthly + daily ceiling pair, global or per-scope.

    A missing or non-positive ceiling means "unlimited" for that pair, so a
    deployment that configures nothing keeps working exactly as before.
    """
    monthly_budget = _parse_budget(await redis.get(monthly_key))
    daily_budget = _parse_budget(await redis.get(daily_key))

    if monthly_budget is None and daily_budget is None:
        return

    label = f"{scope} " if scope else ""

    if daily_budget is not None:
        daily_cost_raw = await redis.hget(
            _current_day_key(scope), "estimated_cost_usd"
        )
        daily_cost = float(daily_cost_raw) if daily_cost_raw else 0.0
        if daily_cost >= daily_budget:
            raise BudgetExceededError(
                f"Daily {label}LLM budget of ${daily_budget:.2f} exceeded "
                f"(today's spend: ${daily_cost:.2f})",
                scope=scope,
                period="daily",
            )

    if monthly_budget is not None:
        monthly_cost_raw = await redis.hget(
            _current_month_key(scope), "estimated_cost_usd"
        )
        monthly_cost = float(monthly_cost_raw) if monthly_cost_raw else 0.0
        if monthly_cost >= monthly_budget:
            raise BudgetExceededError(
                f"Monthly {label}LLM budget of ${monthly_budget:.2f} exceeded "
                f"(current spend: ${monthly_cost:.2f})",
                scope=scope,
                period="monthly",
            )


async def _check_budget(scope: str | None = None) -> None:
    """Raise BudgetExceededError if spend has reached an admin limit.

    Two layers, each with an optional monthly and daily ceiling:

    - Per-scope (``llm:config:{monthly,daily}_budget_usd:{scope}``),
      tracked in ``llm:usage:{YYYY-MM}:{scope}`` and
      ``llm:usage:daily:{YYYY-MM-DD}:{scope}``. Checked FIRST, so an
      exhausted category reports itself by name instead of hiding behind
      the global cap — and, more importantly, so one runaway category
      cannot stop every other kind of generation.
    - Global (``llm:config:{monthly,daily}_budget_usd``), tracked in
      ``llm:usage:{YYYY-MM}`` / ``llm:usage:daily:{YYYY-MM-DD}``. Remains
      the overall ceiling across all categories.

    An unset ceiling means unlimited at that layer. Enforced via Redis
    reads only — no DB call on the hot path.
    """
    redis = await _get_redis()

    if scope:
        await _check_one_budget(
            redis,
            scope=scope,
            monthly_key=f"llm:config:monthly_budget_usd:{scope}",
            daily_key=f"llm:config:daily_budget_usd:{scope}",
        )

    await _check_one_budget(
        redis,
        scope=None,
        monthly_key="llm:config:monthly_budget_usd",
        daily_key="llm:config:daily_budget_usd",
    )


# ---------------------------------------------------------------------------
# Token usage tracking → Redis
# ---------------------------------------------------------------------------
async def _track_usage(
    tokens_in: int,
    tokens_out: int,
    model: str,
    scope: str | None = None,
) -> None:
    """Increment monthly and daily aggregate token usage in Redis.

    Always writes the global ``llm:usage:{YYYY-MM}`` and
    ``llm:usage:daily:{YYYY-MM-DD}`` counters. When ``scope`` is given it
    also writes ``llm:usage:{YYYY-MM}:{scope}`` and
    ``llm:usage:daily:{YYYY-MM-DD}:{scope}`` in the same pipeline, which
    is what the per-category caps in :func:`_check_budget` read back.
    """
    try:
        redis = await _get_redis()

        input_price, output_price = MODEL_PRICING.get(model, (0.0, 0.0))
        cost = (tokens_in * input_price + tokens_out * output_price) / 1_000_000

        targets: list[tuple[str, int]] = [
            (_current_month_key(), 90 * 86400),
            (_current_day_key(), 35 * 86400),
        ]
        if scope:
            targets.append((_current_month_key(scope), 90 * 86400))
            targets.append((_current_day_key(scope), 35 * 86400))

        pipe = redis.pipeline()
        for key, ttl_seconds in targets:
            pipe.hincrby(key, "tokens_in", tokens_in)
            pipe.hincrby(key, "tokens_out", tokens_out)
            pipe.hincrby(key, "request_count", 1)
            pipe.hincrbyfloat(key, "estimated_cost_usd", cost)
            pipe.expire(key, ttl_seconds)
        await pipe.execute()
    except Exception:
        # Token tracking must never block generation
        logger.exception("Failed to track LLM token usage in Redis")


# ---------------------------------------------------------------------------
# OpenAI backend
# ---------------------------------------------------------------------------
async def _openai_generate(
    system_prompt: str,
    user_prompt: str,
    max_tokens: int,
    temperature: float,
    response_format: str | None,
    scope: str | None = None,
) -> str:
    """Generate via OpenAI API (non-streaming)."""
    client = _get_openai_client()
    model = settings.openai_model

    kwargs: dict[str, Any] = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if response_format == "json_object":
        kwargs["response_format"] = {"type": "json_object"}

    response = await client.chat.completions.create(**kwargs)

    content: str = response.choices[0].message.content or ""

    # Track tokens
    if response.usage:
        await _track_usage(
            tokens_in=response.usage.prompt_tokens,
            tokens_out=response.usage.completion_tokens,
            model=model,
            scope=scope,
        )

    return content


async def _openai_stream(
    system_prompt: str,
    user_prompt: str,
    max_tokens: int,
    temperature: float,
    scope: str | None = None,
) -> AsyncIterator[str]:
    """Stream via OpenAI API, yielding content chunks."""
    client = _get_openai_client()
    model = settings.openai_model

    stream = await client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=temperature,
        max_tokens=max_tokens,
        stream=True,
        stream_options={"include_usage": True},
    )

    tokens_in = 0
    tokens_out = 0

    async for chunk in stream:
        # Usage comes in the final chunk
        if chunk.usage is not None:
            tokens_in = chunk.usage.prompt_tokens
            tokens_out = chunk.usage.completion_tokens

        if chunk.choices:
            delta = chunk.choices[0].delta
            if delta and delta.content:
                yield delta.content

    # Track tokens after stream completes
    if tokens_in or tokens_out:
        await _track_usage(
            tokens_in=tokens_in, tokens_out=tokens_out, model=model, scope=scope
        )


# ---------------------------------------------------------------------------
# vLLM fallback backend
# ---------------------------------------------------------------------------
async def _vllm_generate(
    system_prompt: str,
    user_prompt: str,
    max_tokens: int,
    temperature: float,
    response_format: str | None,
) -> str:
    """Generate via vLLM (non-streaming)."""
    url = f"{settings.vllm_base_url}/chat/completions"
    payload: dict[str, Any] = {
        "model": settings.vllm_model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": temperature,
        "max_tokens": max_tokens,
    }

    if response_format == "json_object":
        payload["response_format"] = {"type": "json_object"}

    async with httpx.AsyncClient(timeout=settings.vllm_request_timeout) as client:
        response = await client.post(url, json=payload)
        response.raise_for_status()
        data: dict[str, Any] = response.json()

    content: str = data["choices"][0]["message"]["content"]
    return content


async def _vllm_stream(
    system_prompt: str,
    user_prompt: str,
    max_tokens: int,
    temperature: float,
) -> AsyncIterator[str]:
    """Stream via vLLM (SSE)."""
    url = f"{settings.vllm_base_url}/chat/completions"
    payload: dict[str, Any] = {
        "model": settings.vllm_model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": True,
    }

    async with (
        httpx.AsyncClient(timeout=settings.vllm_request_timeout) as client,
        client.stream("POST", url, json=payload) as response,
    ):
        response.raise_for_status()
        async for line in response.aiter_lines():
            if not line.startswith("data: "):
                continue

            data_str = line[6:].strip()
            if data_str == "[DONE]":
                return

            try:
                chunk: dict[str, Any] = json.loads(data_str)
                delta = chunk.get("choices", [{}])[0].get("delta", {})
                content = delta.get("content", "")
                if content:
                    yield content
            except (json.JSONDecodeError, IndexError, KeyError):
                logger.debug("Skipping malformed SSE chunk: %s", data_str[:100])
                continue


# ---------------------------------------------------------------------------
# Public API — same signatures as before
# ---------------------------------------------------------------------------
async def generate_completion(
    system_prompt: str,
    user_prompt: str,
    max_tokens: int | None = None,
    temperature: float = 0.2,
    response_format: str | None = None,
    scope: str | None = None,
) -> str:
    """Call the active LLM backend for a non-streaming chat completion.

    Args:
        system_prompt: System message with instructions.
        user_prompt: User message (contains context + query).
        max_tokens: Max tokens for the response. Defaults to config value.
        temperature: Sampling temperature.
        response_format: If "json_object", requests JSON mode.
        scope: Budget category this call is charged to. Selects the
            per-category ceiling and usage counters; ``None`` falls back
            to the global ceiling only.

    Returns:
        The generated text content.

    Raises:
        BudgetExceededError: If a monthly or daily ceiling is exhausted.
        httpx.HTTPStatusError: If the vLLM backend returns an error.
        openai.APIError: If the OpenAI backend returns an error.
    """
    effective_max_tokens = max_tokens or settings.answer_max_tokens

    # Budgets are checked on BOTH backends. The vLLM branch used to skip
    # this entirely, so a deployment on vLLM had no spending limit at all.
    await _check_budget(scope)

    if _use_openai():
        return await _openai_generate(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            max_tokens=effective_max_tokens,
            temperature=temperature,
            response_format=response_format,
            scope=scope,
        )

    return await _vllm_generate(
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        max_tokens=effective_max_tokens,
        temperature=temperature,
        response_format=response_format,
    )


async def generate_completion_with_usage(
    system_prompt: str,
    user_prompt: str,
    max_tokens: int | None = None,
    temperature: float = 0.2,
    response_format: str | None = None,
    scope: str | None = None,
) -> dict[str, Any]:
    """Like generate_completion but also returns token usage and model name.

    Args:
        scope: Budget category this call is charged to.

    Returns:
        Dict with keys: content (str), model_name (str),
        tokens_in (int), tokens_out (int).
    """
    effective_max_tokens = max_tokens or settings.answer_max_tokens

    # Checked before branching: the vLLM path below bypassed budgets.
    await _check_budget(scope)

    if _use_openai():
        client = _get_openai_client()
        model = settings.openai_model

        kwargs: dict[str, Any] = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": temperature,
            "max_tokens": effective_max_tokens,
        }
        if response_format == "json_object":
            kwargs["response_format"] = {"type": "json_object"}

        resp = await client.chat.completions.create(**kwargs)
        content: str = resp.choices[0].message.content or ""
        tokens_in = resp.usage.prompt_tokens if resp.usage else 0
        tokens_out = resp.usage.completion_tokens if resp.usage else 0

        if resp.usage:
            await _track_usage(
                tokens_in=tokens_in,
                tokens_out=tokens_out,
                model=model,
                scope=scope,
            )

        return {
            "content": content,
            "model_name": model,
            "tokens_in": tokens_in,
            "tokens_out": tokens_out,
        }

    # vLLM fallback
    url = f"{settings.vllm_base_url}/chat/completions"
    model = settings.vllm_model
    payload: dict[str, Any] = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": temperature,
        "max_tokens": effective_max_tokens,
    }
    if response_format == "json_object":
        payload["response_format"] = {"type": "json_object"}

    async with httpx.AsyncClient(timeout=settings.vllm_request_timeout) as client:
        resp = await client.post(url, json=payload)
        resp.raise_for_status()
        data: dict[str, Any] = resp.json()

    content = data["choices"][0]["message"]["content"]
    usage = data.get("usage", {})
    tokens_in = usage.get("prompt_tokens", 0)
    tokens_out = usage.get("completion_tokens", 0)

    # vLLM spend was never recorded, so its budgets could never trip.
    if tokens_in or tokens_out:
        await _track_usage(
            tokens_in=tokens_in, tokens_out=tokens_out, model=model, scope=scope
        )

    return {
        "content": content,
        "model_name": model,
        "tokens_in": tokens_in,
        "tokens_out": tokens_out,
    }


async def stream_completion(
    system_prompt: str,
    user_prompt: str,
    max_tokens: int | None = None,
    temperature: float = 0.2,
    scope: str | None = None,
) -> AsyncIterator[str]:
    """Stream a chat completion from the active LLM backend.

    Yields text chunks as they arrive. The caller is responsible for
    wrapping these into SSE MessageEvent objects.

    Args:
        system_prompt: System message with instructions.
        user_prompt: User message.
        max_tokens: Max tokens for the response.
        temperature: Sampling temperature.
        scope: Budget category this call is charged to.

    Yields:
        Text content chunks from the streaming response.

    Raises:
        BudgetExceededError: If a monthly or daily ceiling is exhausted.
    """
    effective_max_tokens = max_tokens or settings.answer_max_tokens

    # Checked before branching: the vLLM stream bypassed budgets.
    await _check_budget(scope)

    if _use_openai():
        async for chunk in _openai_stream(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            max_tokens=effective_max_tokens,
            temperature=temperature,
            scope=scope,
        ):
            yield chunk
        return

    async for chunk in _vllm_stream(
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        max_tokens=effective_max_tokens,
        temperature=temperature,
    ):
        yield chunk


def get_model_info() -> dict[str, str]:
    """Return model metadata for audit logging (model_runs table)."""
    if _use_openai():
        return {
            "model_name": settings.openai_model,
            "provider": "openai",
        }
    return {
        "model_name": settings.vllm_model,
        "vllm_base_url": settings.vllm_base_url,
        "provider": "vllm",
    }
