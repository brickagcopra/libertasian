"""Research workspace query service — uses core pipeline with conversation history."""

import json
import logging
from typing import Any

from ..config import settings
from ..core.generation import generate_completion, get_model_info
from ..core.retrieval import retrieve_by_document_id, retrieve_by_query
from ..core.schemas import Passage
from ..shared.formatting import format_passages
from .prompts import PROMPT_VERSION, SYSTEM_PROMPT, USER_PROMPT_TEMPLATE
from .schemas import (
    CitationRefOut,
    ResearchQueryRequest,
    ResearchQueryResponse,
)

logger = logging.getLogger(__name__)


async def answer_research_query(
    request: ResearchQueryRequest,
) -> ResearchQueryResponse:
    """Answer a research query with workspace context using RAG pipeline.

    Steps:
    1. Retrieve passages from pinned documents and via query search (core pipeline)
    2. Build context with workspace notes and conversation history
    3. Call vLLM via core generation
    4. Parse and validate output
    """
    model_info = get_model_info()

    # Step 1: Retrieve passages via core pipeline
    all_passages: list[Passage] = []

    # Retrieve from pinned documents
    for doc_id in request.pinned_document_ids:
        doc_passages = await retrieve_by_document_id(
            doc_id, top_k=10, text_truncate=2000,
        )
        all_passages.extend(doc_passages)

    # Also do a query-based search for additional relevant passages
    query_passages = await retrieve_by_query(
        request.query, top_k=8, text_truncate=2000,
    )
    all_passages.extend(query_passages)

    # Deduplicate by passage ID
    seen_ids: set[str] = set()
    unique_passages: list[Passage] = []
    for p in all_passages:
        if p.id and p.id not in seen_ids:
            seen_ids.add(p.id)
            unique_passages.append(p)

    # Step 2: Build prompt
    context_text = format_passages(unique_passages)
    workspace_context = _format_workspace_context(request.notes)
    conversation_history = _format_conversation_history(request.previous_queries)

    user_prompt = USER_PROMPT_TEMPLATE.format(
        context=context_text,
        workspace_context=workspace_context,
        conversation_history=conversation_history,
        query=request.query,
    )

    # Step 3: Call vLLM via core generation
    raw_response = await generate_completion(
        system_prompt=SYSTEM_PROMPT,
        user_prompt=user_prompt,
        max_tokens=settings.research_query_max_tokens,
        temperature=0.3,
        response_format="json_object",
    )

    # Step 4: Parse and validate
    response_data = _parse_response(raw_response)

    # Compute confidence score
    confidence = _compute_confidence(response_data, unique_passages)

    citations: list[CitationRefOut] = []
    for cit in response_data.get("citations", []):
        if not isinstance(cit, dict):
            continue
        citations.append(
            CitationRefOut(
                source_id=cit.get("source_id", ""),
                section_id=cit.get("section_id"),
                text=cit.get("text", ""),
            )
        )

    follow_ups = response_data.get("follow_up_suggestions", [])
    if not isinstance(follow_ups, list):
        follow_ups = []

    return ResearchQueryResponse(
        answer=response_data.get("answer", "Unable to generate answer."),
        citations=citations,
        follow_up_suggestions=[str(s) for s in follow_ups[:5]],
        confidence_score=confidence,
        model_name=model_info["model_name"],
        prompt_template_version=PROMPT_VERSION,
    )


def _format_workspace_context(notes: str) -> str:
    """Format workspace notes into context."""
    if not notes:
        return "(No workspace notes.)"
    return f"Researcher's Notes:\n{notes}"


def _format_conversation_history(
    previous_queries: list[Any],
) -> str:
    """Format previous Q&A pairs into conversation history."""
    if not previous_queries:
        return "(No previous conversation in this workspace.)"

    parts: list[str] = []
    for i, qa in enumerate(previous_queries, 1):
        if hasattr(qa, "query"):
            q = qa.query
            a = qa.answer
        elif isinstance(qa, dict):
            q = qa.get("query", "")
            a = qa.get("answer", "")
        else:
            continue
        parts.append(f"Q{i}: {q}\nA{i}: {a}")

    return "\n\n".join(parts)


def _parse_response(raw: str) -> dict[str, Any]:
    """Parse the LLM JSON output."""
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("Failed to parse LLM research response as JSON")
        return {
            "answer": "The AI was unable to generate a properly formatted response.",
            "citations": [],
            "follow_up_suggestions": [],
        }

    return data


def _compute_confidence(
    response_data: dict[str, Any],
    passages: list[Any],
) -> float:
    """Compute confidence based on citations and passage availability."""
    answer = response_data.get("answer", "")
    citations = response_data.get("citations", [])

    if not answer or len(answer) < 20:
        return 0.3

    passage_score = min(len(passages) / 5.0, 1.0)
    citation_score = min(len(citations) / 3.0, 1.0) if citations else 0.0
    length_score = min(len(answer) / 200.0, 1.0)

    confidence = (
        passage_score * 0.4 + citation_score * 0.4 + length_score * 0.2
    )
    return round(max(0.0, min(1.0, confidence)), 2)
