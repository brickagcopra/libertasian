"""HTTP endpoint for Deep Research.

POST /research/deep — SSE stream of ``stage``, ``plan``, ``sources``,
``result``, ``done`` and ``error`` events (see `service.run_deep_research`).
Internal only: the NestJS gateway is the sole caller.
"""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from ..shared.auth import verify_internal_key
from .schemas import DeepResearchRequest
from .service import ModelNotAllowedError, resolve_writer_model, run_deep_research

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/research",
    tags=["deep-research"],
    dependencies=[Depends(verify_internal_key)],
)


def format_sse(event: str, data: dict[str, object]) -> str:
    """One SSE frame. ``json.dumps`` escapes newlines, so data is one line."""
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/deep")
async def post_deep_research(request: DeepResearchRequest) -> StreamingResponse:
    """Stream a multi-query, verified research answer."""
    # Rejected before the stream opens, so a bad override is a plain 422 the
    # gateway can map, not an error frame after a 200.
    try:
        resolve_writer_model(request.model_override)
    except ModelNotAllowedError as exc:
        raise HTTPException(
            status_code=422, detail="model_override is not an allowed model"
        ) from exc

    async def event_stream() -> AsyncIterator[str]:
        async for event, data in run_deep_research(request):
            yield format_sse(event, data)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
