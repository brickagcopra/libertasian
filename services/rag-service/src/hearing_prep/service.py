"""Hearing prep service — uses core pipeline for retrieval and generation."""

import json
import logging
from typing import Any

from ..config import settings
from ..core.generation import generate_completion, get_model_info
from ..core.retrieval import retrieve_by_document_id, retrieve_by_query
from ..core.schemas import Passage
from ..shared.formatting import format_multi_doc_passages
from .prompts import PROMPT_VERSION, SYSTEM_PROMPT, USER_PROMPT_TEMPLATE
from .schemas import (
    HearingPrepArgumentOut,
    HearingPrepCaseOut,
    HearingPrepProvisionOut,
    HearingPrepRequest,
    HearingPrepResponse,
)

logger = logging.getLogger(__name__)


async def generate_hearing_prep(
    request: HearingPrepRequest,
) -> HearingPrepResponse:
    """Generate a hearing preparation pack using RAG pipeline.

    Steps:
    1. Retrieve passages from specified documents and/or topic-based search via core pipeline
    2. Build context with citation anchors
    3. Call vLLM via core generation
    4. Parse and validate output
    """
    model_info = get_model_info()
    passages_by_doc: dict[str, list[Passage]] = {}

    # Step 1a: Retrieve passages from specified documents via core pipeline
    for doc_id in request.document_ids:
        passages_by_doc[doc_id] = await retrieve_by_document_id(
            doc_id, top_k=10, text_truncate=3000,
        )

    # Step 1b: If topic provided, also do a topic-based search
    query_text = request.topic
    if request.issue:
        query_text += f" {request.issue}"

    topic_passages = await retrieve_by_query(
        query_text, top_k=15, text_truncate=3000,
    )
    if topic_passages:
        passages_by_doc["topic_search"] = topic_passages

    # Step 2: Build prompt context
    context_text = format_multi_doc_passages(
        passages_by_doc,
        empty_message="(No source passages available for hearing preparation.)",
    )

    issue_section = ""
    if request.issue:
        issue_section = f"Legal Issue: {request.issue}"

    additional_context = ""
    if request.input_context:
        additional_context = f"Additional Context: {json.dumps(request.input_context)}"

    user_prompt = USER_PROMPT_TEMPLATE.format(
        context=context_text,
        topic=request.topic,
        issue_section=issue_section,
        additional_context=additional_context,
    )

    # Step 3: Call vLLM via core generation
    raw_response = await generate_completion(
        system_prompt=SYSTEM_PROMPT,
        user_prompt=user_prompt,
        max_tokens=settings.hearing_prep_max_tokens,
        temperature=0.2,
        response_format="json_object",
    )

    # Step 4: Parse and validate
    pack_data = _parse_response(raw_response)

    # Compute confidence
    confidence = _compute_confidence(pack_data, passages_by_doc)

    return HearingPrepResponse(
        cases=[
            HearingPrepCaseOut(
                document_id=c.get("document_id", ""),
                title=c.get("title", ""),
                citation_text=c.get("citation_text"),
                relevance=c.get("relevance", ""),
                key_holdings=c.get("key_holdings", []),
            )
            for c in pack_data.get("cases", [])
            if isinstance(c, dict)
        ],
        provisions=[
            HearingPrepProvisionOut(
                document_id=p.get("document_id", ""),
                section_id=p.get("section_id"),
                title=p.get("title", ""),
                section_label=p.get("section_label"),
                text=p.get("text", ""),
                relevance=p.get("relevance", ""),
            )
            for p in pack_data.get("provisions", [])
            if isinstance(p, dict)
        ],
        arguments=[
            HearingPrepArgumentOut(
                position=a.get("position", ""),
                supporting_cases=a.get("supporting_cases", []),
                supporting_provisions=a.get("supporting_provisions", []),
                strength=a.get("strength", "moderate"),
            )
            for a in pack_data.get("arguments", [])
            if isinstance(a, dict)
        ],
        counter_arguments=[
            HearingPrepArgumentOut(
                position=a.get("position", ""),
                supporting_cases=a.get("supporting_cases", []),
                supporting_provisions=a.get("supporting_provisions", []),
                strength=a.get("strength", "moderate"),
            )
            for a in pack_data.get("counter_arguments", [])
            if isinstance(a, dict)
        ],
        suggested_questions=[
            q for q in pack_data.get("suggested_questions", []) if isinstance(q, str)
        ],
        confidence_score=confidence,
        model_name=model_info["model_name"],
        prompt_template_version=PROMPT_VERSION,
    )


def _parse_response(raw: str) -> dict[str, Any]:
    """Parse the LLM JSON output into a hearing prep structure."""
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("Failed to parse LLM hearing prep response as JSON")
        return {
            "cases": [],
            "provisions": [],
            "arguments": [],
            "counter_arguments": [],
            "suggested_questions": [],
        }

    return data


def _compute_confidence(
    pack_data: dict[str, Any],
    passages_by_doc: dict[str, list[Any]],
) -> float:
    """Compute confidence based on section completeness and passage support."""
    cases = pack_data.get("cases", [])
    provisions = pack_data.get("provisions", [])
    arguments = pack_data.get("arguments", [])
    counter_args = pack_data.get("counter_arguments", [])
    questions = pack_data.get("suggested_questions", [])

    total_passages = sum(len(p) for p in passages_by_doc.values())

    if total_passages == 0:
        return 0.3

    section_count = 0
    if cases:
        section_count += 1
    if provisions:
        section_count += 1
    if arguments:
        section_count += 1
    if counter_args:
        section_count += 1
    if questions:
        section_count += 1

    section_completeness = section_count / 5.0

    total_items = len(cases) + len(provisions) + len(arguments) + len(counter_args) + len(questions)
    content_richness = min(total_items / 10.0, 1.0)

    passage_availability = min(total_passages / 10.0, 1.0)

    confidence = (
        section_completeness * 0.4
        + content_richness * 0.35
        + passage_availability * 0.25
    )
    return round(max(0.0, min(1.0, confidence)), 2)
