"""Completions service — thin wrapper around core generation with usage tracking."""

from __future__ import annotations

from typing import Any

from ..core.generation import generate_completion_with_usage
from .schemas import CompletionGenerationRequest, CompletionGenerationResponse

# Worker sends response_format="json"; core generation expects "json_object".
_FORMAT_MAP: dict[str, str] = {
    "json": "json_object",
    "text": "text",
}


async def generate(request: CompletionGenerationRequest) -> CompletionGenerationResponse:
    """Run a generic LLM completion and return content with usage metadata."""
    core_format: str | None = _FORMAT_MAP.get(request.response_format)
    if core_format == "text":
        core_format = None  # core treats None as plain text mode

    result: dict[str, Any] = await generate_completion_with_usage(
        system_prompt=request.system_prompt,
        user_prompt=request.user_prompt,
        max_tokens=request.max_tokens,
        temperature=request.temperature,
        response_format=core_format,
    )

    return CompletionGenerationResponse(
        content=result["content"],
        model_name=result["model_name"],
        tokens_in=result["tokens_in"],
        tokens_out=result["tokens_out"],
    )
