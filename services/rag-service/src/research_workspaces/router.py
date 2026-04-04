"""Research workspace query router — FastAPI endpoints for workspace-scoped queries."""

import logging

from fastapi import APIRouter

from .schemas import ResearchQueryRequest, ResearchQueryResponse
from .service import answer_research_query

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/research_workspaces", tags=["research_workspaces"])


@router.post("/query", response_model=ResearchQueryResponse)
async def research_workspace_query_endpoint(
    request: ResearchQueryRequest,
) -> ResearchQueryResponse:
    """Answer a query within a research workspace context using RAG pipeline.

    Called internally by NestJS research workspaces processor.
    """
    logger.info(
        "Research workspace query: pinned_docs=%d, previous_queries=%d",
        len(request.pinned_document_ids),
        len(request.previous_queries),
    )
    return await answer_research_query(request)
