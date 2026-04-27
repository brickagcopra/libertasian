"""HTTP endpoints for the /answer route.

POST /answer — Non-streaming answer generation
POST /answer/stream — SSE streaming answer generation
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from ..shared.auth import verify_internal_key
from ..shared.exceptions import (
    BudgetExceededError,
    RagPipelineError,
    SchemaIntegrityError,
)
from .schemas import AnswerRequest, AnswerResponse
from .service import generate_answer, stream_answer

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/answer",
    tags=["answer"],
    dependencies=[Depends(verify_internal_key)],
)


@router.post("", response_model=AnswerResponse)
async def post_answer(request: AnswerRequest) -> AnswerResponse:
    """Generate a grounded legal answer using the full RAG pipeline.

    Pipeline: intent → retrieval → reranking → context packing → generation → validation.
    Returns an abstention response if insufficient evidence is found.
    """
    try:
        return await generate_answer(request)
    except BudgetExceededError:
        raise  # Let global exception handler return 503
    except SchemaIntegrityError as exc:
        # Hard schema bug (missing table/column from raw SQL). Surface
        # explicitly with a distinct log line + 500 so ops dashboards
        # can alert on the class. Distinct path means a schema drift
        # never gets buried under the generic "unexpected error" bucket.
        logger.exception("SchemaIntegrityError in /answer")
        raise HTTPException(
            status_code=500,
            detail=f"Schema integrity error: {exc}",
        ) from exc
    except RagPipelineError as exc:
        logger.warning("RAG pipeline error: %s", exc)
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Unexpected error in /answer")
        raise HTTPException(
            status_code=500,
            detail="An internal error occurred while generating the answer.",
        ) from exc


@router.post("/stream")
async def post_answer_stream(request: AnswerRequest) -> StreamingResponse:
    """Stream a grounded legal answer via Server-Sent Events (SSE).

    Returns a text/event-stream response with AnswerChunk payloads:
    - event: metadata (intent, sources)
    - event: text (incremental answer chunks)
    - event: done (confidence, validation results)
    - event: error (if something fails)
    """

    async def event_generator() -> AsyncIterator[str]:
        async for chunk in stream_answer(request):
            data = chunk.model_dump_json()
            yield f"data: {data}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
