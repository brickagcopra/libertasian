"""Passage retrieval router — BM25 keyword retrieval for internal callers.

Thin wrapper around ``core.retrieval.retrieve_by_query`` exposing it over HTTP
so worker-service tasks (e.g. bar exam ALAC answer generation) can ground their
LLM prompts in corpus passages without taking on an OpenSearch client
themselves. No reranking, no kNN — keyword-only retrieval is enough for
topic-style grounding and keeps the failure surface small (one OpenSearch call,
nothing else to misconfigure).
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field

from ..core.retrieval import retrieve_by_query
from ..core.schemas import Passage
from ..shared.auth import verify_internal_key

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/passages",
    tags=["passages"],
    dependencies=[Depends(verify_internal_key)],
)


class PassagesRetrieveRequest(BaseModel):
    """Request body for ``POST /passages/retrieve``."""

    model_config = ConfigDict(strict=True)

    query: str = Field(min_length=1, max_length=2000)
    top_k: int = Field(default=8, ge=1, le=20)
    filter_terms: dict[str, Any] | None = Field(default=None)
    text_truncate: int = Field(default=2000, ge=200, le=8000)


class PassagesRetrieveResponse(BaseModel):
    """Response body for ``POST /passages/retrieve``."""

    model_config = ConfigDict(strict=True)

    passages: list[Passage] = Field(default_factory=list)


@router.post("/retrieve", response_model=PassagesRetrieveResponse)
async def retrieve_passages(
    request: PassagesRetrieveRequest,
) -> PassagesRetrieveResponse:
    """Retrieve up to ``top_k`` BM25 passages matching ``query``.

    Called internally by the worker service before LLM generation so the prompt
    can be grounded in the corpus. Errors propagate through FastAPI's default
    handlers — callers are expected to treat a failed retrieval as a soft
    failure and fall back to priors-only generation.
    """
    logger.info(
        "Passage retrieval requested: top_k=%d query_len=%d",
        request.top_k,
        len(request.query),
    )
    passages = await retrieve_by_query(
        query=request.query,
        top_k=request.top_k,
        text_truncate=request.text_truncate,
        filter_terms=request.filter_terms,
    )
    return PassagesRetrieveResponse(passages=passages)
