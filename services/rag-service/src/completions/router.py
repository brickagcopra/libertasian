"""Completions router — generic LLM completion endpoint for internal services."""

from fastapi import APIRouter, Depends

from ..shared.auth import verify_internal_key
from . import service
from .schemas import CompletionGenerationRequest, CompletionGenerationResponse

router = APIRouter(
    prefix="/completions",
    tags=["completions"],
    dependencies=[Depends(verify_internal_key)],
)


@router.post("/generate", response_model=CompletionGenerationResponse)
async def generate_completion(
    request: CompletionGenerationRequest,
) -> CompletionGenerationResponse:
    """Generate a completion using the configured LLM backend.

    Internal endpoint called by the worker service for structured
    derivative generation tasks (case digests, doctrine extraction, etc.).
    """
    return await service.generate(request)
