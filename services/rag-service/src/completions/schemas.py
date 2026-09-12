"""Completion generation request/response schemas."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict


class CompletionGenerationRequest(BaseModel):
    """Request payload for generic LLM completion."""

    model_config = ConfigDict(strict=True)

    system_prompt: str
    user_prompt: str
    temperature: float = 0.0
    response_format: Literal["text", "json"] = "text"
    max_tokens: int | None = None
    # Budget category this call is charged to. Defaulted because the model
    # is ConfigDict(strict=True) and older workers do not send the field;
    # omitting it falls back to the global ceiling, as before.
    scope: str | None = None


class CompletionGenerationResponse(BaseModel):
    """Response from generic completion endpoint."""

    content: str
    model_name: str
    tokens_in: int
    tokens_out: int
