"""Centralized vLLM client for text generation and SSE streaming.

Per CLAUDE.md:
- Pin model versions: record model_name, model_version, prompt_template_version
- SSE streaming for AI answer generation
"""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
from typing import Any

import httpx

from ..config import settings

logger = logging.getLogger(__name__)


async def generate_completion(
    system_prompt: str,
    user_prompt: str,
    max_tokens: int | None = None,
    temperature: float = 0.2,
    response_format: str | None = None,
) -> str:
    """Call vLLM for a non-streaming chat completion.

    Args:
        system_prompt: System message with instructions.
        user_prompt: User message (contains context + query).
        max_tokens: Max tokens for the response. Defaults to config value.
        temperature: Sampling temperature.
        response_format: If "json_object", requests JSON mode.

    Returns:
        The generated text content.

    Raises:
        httpx.HTTPStatusError: If vLLM returns an error status.
    """
    url = f"{settings.vllm_base_url}/chat/completions"
    payload: dict[str, Any] = {
        "model": settings.vllm_model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": temperature,
        "max_tokens": max_tokens or settings.answer_max_tokens,
    }

    if response_format == "json_object":
        payload["response_format"] = {"type": "json_object"}

    async with httpx.AsyncClient(timeout=settings.vllm_request_timeout) as client:
        response = await client.post(url, json=payload)
        response.raise_for_status()
        data: dict[str, Any] = response.json()

    content: str = data["choices"][0]["message"]["content"]
    return content


async def stream_completion(
    system_prompt: str,
    user_prompt: str,
    max_tokens: int | None = None,
    temperature: float = 0.2,
) -> AsyncIterator[str]:
    """Stream a chat completion from vLLM via SSE.

    Yields text chunks as they arrive. The caller is responsible for
    wrapping these into SSE MessageEvent objects.

    Args:
        system_prompt: System message with instructions.
        user_prompt: User message.
        max_tokens: Max tokens for the response.
        temperature: Sampling temperature.

    Yields:
        Text content chunks from the streaming response.
    """
    url = f"{settings.vllm_base_url}/chat/completions"
    payload: dict[str, Any] = {
        "model": settings.vllm_model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": temperature,
        "max_tokens": max_tokens or settings.answer_max_tokens,
        "stream": True,
    }

    async with httpx.AsyncClient(timeout=settings.vllm_request_timeout) as client:
        async with client.stream("POST", url, json=payload) as response:
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


def get_model_info() -> dict[str, str]:
    """Return model metadata for audit logging (model_runs table)."""
    return {
        "model_name": settings.vllm_model,
        "vllm_base_url": settings.vllm_base_url,
    }
