"""Timeline generation service — uses core pipeline for retrieval and generation."""

import json
import logging
from typing import Any

from ..config import settings
from ..core.generation import generate_completion, get_model_info
from ..core.retrieval import retrieve_by_document_id
from ..shared.formatting import format_multi_doc_passages
from .prompts import PROMPT_VERSION, SYSTEM_PROMPT, USER_PROMPT_TEMPLATE
from .schemas import TimelineEventOut, TimelineRequest, TimelineResponse

logger = logging.getLogger(__name__)


async def generate_timeline(request: TimelineRequest) -> TimelineResponse:
    """Generate a chronological timeline from legal documents using RAG pipeline.

    Steps:
    1. Retrieve full text passages for each document via core pipeline
    2. Build multi-document context with citation anchors
    3. Call vLLM via core generation
    4. Parse and validate output
    """
    model_info = get_model_info()

    # Step 1: Retrieve passages for each document via core pipeline
    passages_by_doc = {}
    for doc_id in request.document_ids:
        passages_by_doc[doc_id] = await retrieve_by_document_id(
            doc_id, top_k=15, text_truncate=3000,
        )

    # Step 2: Build prompt with multi-doc context
    context_text = format_multi_doc_passages(
        passages_by_doc,
        empty_message="(No documents available for timeline generation.)",
    )

    user_prompt = USER_PROMPT_TEMPLATE.format(
        context=context_text,
        title=request.title,
    )

    # Step 3: Call vLLM via core generation
    raw_response = await generate_completion(
        system_prompt=SYSTEM_PROMPT,
        user_prompt=user_prompt,
        max_tokens=settings.timeline_max_tokens,
        temperature=0.2,
        response_format="json_object",
    )

    # Step 4: Parse and validate
    timeline_data = _parse_timeline_response(raw_response)

    # Compute confidence score
    confidence = _compute_confidence(timeline_data, passages_by_doc)

    events = []
    for ev in timeline_data.get("events", []):
        if not isinstance(ev, dict):
            continue
        events.append(
            TimelineEventOut(
                date=ev.get("date", ""),
                label=ev.get("label", ""),
                description=ev.get("description", ""),
                source_document_id=ev.get("source_document_id"),
                source_section_id=ev.get("source_section_id"),
                event_type=ev.get("event_type", "other"),
            )
        )

    return TimelineResponse(
        events=events,
        summary=timeline_data.get("summary", ""),
        confidence_score=confidence,
        model_name=model_info["model_name"],
        prompt_template_version=PROMPT_VERSION,
    )


def _parse_timeline_response(raw: str) -> dict[str, Any]:
    """Parse the LLM JSON output into a timeline structure."""
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("Failed to parse LLM timeline response as JSON")
        return {
            "events": [],
            "summary": "The AI was unable to generate a properly formatted timeline.",
        }

    return data


def _compute_confidence(
    timeline_data: dict[str, Any],
    passages_by_doc: dict[str, list[Any]],
) -> float:
    """Compute confidence based on event count, date coverage, and passage support."""
    events = timeline_data.get("events", [])
    doc_count = len(passages_by_doc)

    if not events or doc_count == 0:
        return 0.3

    events_with_dates = sum(
        1 for e in events if isinstance(e, dict) and e.get("date")
    )
    date_coverage = events_with_dates / max(len(events), 1)

    events_with_source = sum(
        1 for e in events if isinstance(e, dict) and e.get("source_document_id")
    )
    source_coverage = events_with_source / max(len(events), 1)

    docs_with_passages = sum(1 for p in passages_by_doc.values() if len(p) > 0)
    passage_availability = docs_with_passages / max(doc_count, 1)

    event_density = min(len(events) / max(doc_count * 3, 1), 1.0)

    confidence = (
        date_coverage * 0.3
        + source_coverage * 0.25
        + passage_availability * 0.25
        + event_density * 0.2
    )
    return round(max(0.0, min(1.0, confidence)), 2)
