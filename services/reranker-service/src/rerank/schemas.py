"""Reranker service Pydantic schemas — request/response models.

These are one half of a cross-service contract. The other half is
``services/rag-service/src/core/reranking.py``, which builds the request and
parses the response, and which was written BEFORE this service existed. The
shapes here are therefore not a design choice — they are what that client
already sends and already parses:

    POST /rerank
    {"query": "...", "passages": [{"id": "...", "text": "..."}, ...]}
    -> {"results": [{"id": "...", "score": 0.95}, ...]}

`services/reranker-service/tests/test_rerank_contract.py` asserts both halves
against each other, so a change to either side that the other does not follow
fails CI rather than degrading silently to RRF in production.
"""

from pydantic import BaseModel, ConfigDict, Field


class RerankPassage(BaseModel):
    """One candidate passage to score against the query."""

    model_config = ConfigDict(strict=True)

    id: str = Field(min_length=1, max_length=512)
    text: str = Field(default="", max_length=32768)


class RerankRequest(BaseModel):
    """Request body for reranking a candidate set."""

    model_config = ConfigDict(strict=True)

    query: str = Field(min_length=1, max_length=8192)
    passages: list[RerankPassage] = Field(min_length=1, max_length=512)


class RerankResult(BaseModel):
    """One scored passage. ``score`` is 0-1 — see `rerank/service.py`."""

    id: str
    score: float


class RerankResponse(BaseModel):
    """Response body: every requested passage, scored, highest first."""

    results: list[RerankResult]
    model_name: str
    count: int
