"""Centralized LLM client for text generation and SSE streaming.

Primary: OpenAI API (when RAG_OPENAI_API_KEY is set).
Fallback: vLLM (OpenAI-compatible endpoint, when no API key).

Per CLAUDE.md:
- Pin model versions: record model_name, model_version, prompt_template_version
- SSE streaming for AI answer generation
"""

from __future__ import annotations

import asyncio
import json
import logging
import random
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Any

import httpx

from ..config import settings
from ..shared.exceptions import BudgetExceededError, ProviderQuotaExhaustedError

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

        # max_retries=0: the SDK would otherwise retry every 429 twice before
        # our code sees it, including insufficient_quota, which no retry can
        # fix. _openai_create() re-implements the SDK's retry policy and
        # skips it for quota exhaustion only.
        _openai_client = AsyncOpenAI(
            api_key=settings.openai_api_key,
            timeout=float(settings.openai_request_timeout),
            max_retries=0,
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
# Provider quota circuit breaker
#
# On 2026-09-26 the OpenAI account ran out of credit for ~8 hours. Every call
# came back 429 insufficient_quota, the SDK retried each one twice, the answer
# route turned it into a 500, and the worker kept firing ~8,300 calls an hour.
# The first quota error now sets a Redis flag that short-circuits every later
# call for a few minutes, so an outage costs one failed OpenAI request per TTL
# window instead of three per call.
# ---------------------------------------------------------------------------
QUOTA_BREAKER_KEY = "llm:provider:quota_exhausted"
QUOTA_BREAKER_TTL_SECONDS = 300
_QUOTA_ERROR_MARKERS = frozenset({"insufficient_quota", "credit_balance_exhausted"})

# Mirrors the openai SDK's defaults (DEFAULT_MAX_RETRIES, INITIAL_RETRY_DELAY,
# MAX_RETRY_DELAY), which the client no longer applies itself (max_retries=0).
_OPENAI_MAX_RETRIES = 2
_OPENAI_INITIAL_RETRY_DELAY = 0.5
_OPENAI_MAX_RETRY_DELAY = 8.0
_OPENAI_MAX_RETRY_AFTER = 60.0


def _openai_error_fields(exc: BaseException) -> tuple[str | None, str | None]:
    """Return ``(type, code)`` from an openai APIError.

    openai 2.x copies ``type``/``code`` onto the exception as attributes when
    the body is a dict, and ``body`` is the inner ``error`` object. A body that
    still carries the full ``{"error": {...}}`` envelope is handled too, so the
    classification does not depend on which of the two the SDK hands us.
    """
    err_type = getattr(exc, "type", None)
    err_code = getattr(exc, "code", None)
    body = getattr(exc, "body", None)
    if isinstance(body, dict):
        inner = body.get("error")
        source: dict[str, Any] = inner if isinstance(inner, dict) else body
        if not isinstance(err_type, str):
            err_type = source.get("type")
        if not isinstance(err_code, str):
            err_code = source.get("code")
    return (
        err_type if isinstance(err_type, str) else None,
        err_code if isinstance(err_code, str) else None,
    )


def _is_quota_exhausted(exc: BaseException) -> bool:
    """True when a RateLimitError means "no credit", not "slow down"."""
    err_type, err_code = _openai_error_fields(exc)
    return err_type == "insufficient_quota" or err_code in _QUOTA_ERROR_MARKERS


async def _check_quota_breaker() -> None:
    """Raise ProviderQuotaExhaustedError while the quota breaker is set.

    Fails OPEN: if Redis is unreachable the call proceeds to OpenAI, since a
    Redis outage must not take generation down with it.
    """
    try:
        redis = await _get_redis()
        raw = await redis.get(QUOTA_BREAKER_KEY)
    except Exception as exc:  # noqa: BLE001 - fail open by design
        logger.warning(
            "Quota breaker check failed; proceeding without it: %s",
            type(exc).__name__,
        )
        return
    if isinstance(raw, (str, bytes)) and raw:
        raise ProviderQuotaExhaustedError(
            "LLM provider quota exhausted (circuit breaker open)"
        )


async def _trip_quota_breaker(exc: BaseException) -> None:
    """Set the breaker key with SET NX EX and log ONE error per trip.

    Only the request whose SET NX succeeds logs, so an outage produces one
    ERROR line per TTL window rather than one per request.
    """
    err_type, err_code = _openai_error_fields(exc)
    try:
        redis = await _get_redis()
        created = await redis.set(
            QUOTA_BREAKER_KEY,
            err_code or err_type or "insufficient_quota",
            ex=QUOTA_BREAKER_TTL_SECONDS,
            nx=True,
        )
    except Exception as redis_exc:  # noqa: BLE001 - fail open by design
        logger.warning(
            "Could not set quota breaker %s: %s",
            QUOTA_BREAKER_KEY,
            type(redis_exc).__name__,
        )
        return
    if created:
        logger.error(
            "LLM provider quota exhausted; breaker %s tripped for %ds "
            "(provider=openai, error_type=%s, error_code=%s)",
            QUOTA_BREAKER_KEY,
            QUOTA_BREAKER_TTL_SECONDS,
            err_type,
            err_code,
            extra={
                "event": "llm_provider_quota_exhausted",
                "provider": "openai",
                "breaker_key": QUOTA_BREAKER_KEY,
                "breaker_ttl_seconds": QUOTA_BREAKER_TTL_SECONDS,
                "error_type": err_type,
                "error_code": err_code,
            },
        )


def _should_retry_openai(exc: BaseException) -> bool:
    """The openai SDK's own retry policy (``_should_retry``)."""
    import openai

    if isinstance(exc, openai.APIConnectionError):  # includes APITimeoutError
        return True
    if not isinstance(exc, openai.APIStatusError):
        return False
    should_retry_header = exc.response.headers.get("x-should-retry")
    if should_retry_header == "true":
        return True
    if should_retry_header == "false":
        return False
    status = exc.status_code
    return status in (408, 409, 429) or status >= 500


def _retry_delay(exc: BaseException, attempt: int) -> float:
    """Honour Retry-After (up to 60s) like the SDK, else jittered backoff."""
    response = getattr(exc, "response", None)
    headers = getattr(response, "headers", None)
    if headers is not None:
        for name, scale in (("retry-after-ms", 0.001), ("retry-after", 1.0)):
            raw = headers.get(name)
            if raw is None:
                continue
            try:
                value = float(raw) * scale
            except (TypeError, ValueError):
                continue
            if 0 < value <= _OPENAI_MAX_RETRY_AFTER:
                return value
    delay = min(_OPENAI_INITIAL_RETRY_DELAY * (2.0**attempt), _OPENAI_MAX_RETRY_DELAY)
    return delay * (1 - 0.25 * random.random())  # noqa: S311 - jitter only


async def _openai_create(client: Any, **kwargs: Any) -> Any:
    """``client.chat.completions.create`` behind the breaker and our retries.

    - Breaker open: ProviderQuotaExhaustedError before any OpenAI call.
    - 429 insufficient_quota / credit_balance_exhausted: trip the breaker and
      raise ProviderQuotaExhaustedError immediately, never retried.
    - Everything the SDK retried before (plain 429 rate limits, 408/409, 5xx,
      connection errors and timeouts) is still retried up to 2 times.
    """
    import openai

    await _check_quota_breaker()

    attempt = 0
    while True:
        try:
            return await client.chat.completions.create(**kwargs)
        except openai.RateLimitError as exc:
            if _is_quota_exhausted(exc):
                await _trip_quota_breaker(exc)
                raise ProviderQuotaExhaustedError(
                    "LLM provider quota exhausted"
                ) from exc
            if attempt >= _OPENAI_MAX_RETRIES or not _should_retry_openai(exc):
                raise
            delay = _retry_delay(exc, attempt)
        except openai.APIError as exc:
            if attempt >= _OPENAI_MAX_RETRIES or not _should_retry_openai(exc):
                raise
            delay = _retry_delay(exc, attempt)
        attempt += 1
        await asyncio.sleep(delay)


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

    response = await _openai_create(client, **kwargs)

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

    stream = await _openai_create(
        client,
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
        ProviderQuotaExhaustedError: If OpenAI reports insufficient_quota
            (a BudgetExceededError subclass), or the quota breaker is open.
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

        resp = await _openai_create(client, **kwargs)
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
