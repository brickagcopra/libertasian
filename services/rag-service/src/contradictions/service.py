"""Contradiction detection service — uses core pipeline for retrieval and generation."""

import json
import logging
from typing import Any

from ..config import settings
from ..core.generation import generate_completion, get_model_info
from ..core.retrieval import retrieve_by_document_id
from ..shared.formatting import format_multi_doc_passages
from .prompts import (
    NO_TOPIC_INSTRUCTION,
    PROMPT_VERSION,
    SYSTEM_PROMPT,
    TOPIC_INSTRUCTION_TEMPLATE,
    USER_PROMPT_TEMPLATE,
)
from .schemas import ContradictionItemOut, ContradictionRequest, ContradictionResponse

logger = logging.getLogger(__name__)


async def generate_contradiction_report(
    request: ContradictionRequest,
) -> ContradictionResponse:
    """Detect contradictions across legal documents using RAG pipeline.

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
        empty_message="(No documents available for contradiction analysis.)",
    )

    topic_instruction = NO_TOPIC_INSTRUCTION
    if request.topic:
        topic_instruction = TOPIC_INSTRUCTION_TEMPLATE.format(topic=request.topic)

    user_prompt = USER_PROMPT_TEMPLATE.format(
        context=context_text,
        scope=request.scope,
        topic_instruction=topic_instruction,
    )

    # Step 3: Call vLLM via core generation
    raw_response = await generate_completion(
        system_prompt=SYSTEM_PROMPT,
        user_prompt=user_prompt,
        max_tokens=settings.contradiction_max_tokens,
        temperature=0.2,
        response_format="json_object",
    )

    # Step 4: Parse and validate
    report_data = _parse_contradiction_response(raw_response)

    # Compute confidence score
    confidence = _compute_confidence(report_data, passages_by_doc)

    contradictions: list[ContradictionItemOut] = []
    for item in report_data.get("contradictions", []):
        if not isinstance(item, dict):
            continue
        contradictions.append(
            ContradictionItemOut(
                document_a_id=item.get("document_a_id", ""),
                document_a_title=item.get("document_a_title", ""),
                document_a_passage=item.get("document_a_passage", ""),
                document_b_id=item.get("document_b_id", ""),
                document_b_title=item.get("document_b_title", ""),
                document_b_passage=item.get("document_b_passage", ""),
                description=item.get("description", ""),
                severity=item.get("severity", "medium"),
                doctrine_area=item.get("doctrine_area"),
            )
        )

    return ContradictionResponse(
        contradictions=contradictions,
        summary=report_data.get("summary", ""),
        documents_analyzed=len(request.document_ids),
        confidence_score=confidence,
        model_name=model_info["model_name"],
        prompt_template_version=PROMPT_VERSION,
    )


def _parse_contradiction_response(raw: str) -> dict[str, Any]:
    """Parse the LLM JSON output into a contradiction report structure."""
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("Failed to parse LLM contradiction response as JSON")
        return {
            "contradictions": [],
            "summary": "The AI was unable to generate a properly formatted contradiction report.",
        }

    return data


def _compute_confidence(
    report_data: dict[str, Any],
    passages_by_doc: dict[str, list[Any]],
) -> float:
    """Compute confidence based on passage availability and contradiction quality."""
    contradictions = report_data.get("contradictions", [])
    doc_count = len(passages_by_doc)

    if doc_count == 0:
        return 0.3

    docs_with_passages = sum(1 for p in passages_by_doc.values() if len(p) > 0)
    passage_availability = docs_with_passages / max(doc_count, 1)

    valid_doc_ids = set(passages_by_doc.keys())
    if contradictions:
        valid_refs = sum(
            1
            for c in contradictions
            if isinstance(c, dict)
            and c.get("document_a_id") in valid_doc_ids
            and c.get("document_b_id") in valid_doc_ids
        )
        ref_accuracy = valid_refs / max(len(contradictions), 1)
    else:
        ref_accuracy = 1.0

    if contradictions:
        with_desc = sum(
            1
            for c in contradictions
            if isinstance(c, dict) and len(c.get("description", "")) > 20
        )
        desc_quality = with_desc / max(len(contradictions), 1)
    else:
        desc_quality = 1.0

    confidence = (
        passage_availability * 0.4 + ref_accuracy * 0.35 + desc_quality * 0.25
    )
    return round(max(0.0, min(1.0, confidence)), 2)
