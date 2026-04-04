"""Case comparison service — uses core pipeline for retrieval and generation."""

import json
import logging
from typing import Any

from ..config import settings
from ..core.generation import generate_completion, get_model_info
from ..core.retrieval import retrieve_by_document_id
from ..shared.formatting import format_multi_doc_passages
from .prompts import (
    COMPARISON_TYPE_INSTRUCTIONS,
    PROMPT_VERSION,
    SYSTEM_PROMPT,
    USER_PROMPT_TEMPLATE,
)
from .schemas import (
    CitationRef,
    ComparisonDimension,
    ComparisonDimensionEntry,
    ComparisonDocumentSummary,
    ComparisonRequest,
    ComparisonResponse,
)

logger = logging.getLogger(__name__)


async def generate_comparison(
    request: ComparisonRequest,
) -> ComparisonResponse:
    """Generate a structured case comparison using RAG pipeline.

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
            doc_id, top_k=10, text_truncate=3000,
        )

    # Step 2: Build prompt with multi-doc context
    comparison_instruction = COMPARISON_TYPE_INSTRUCTIONS.get(
        request.comparison_type.value,
        COMPARISON_TYPE_INSTRUCTIONS["full"],
    )

    context_text = format_multi_doc_passages(
        passages_by_doc,
        empty_message="(No documents available for comparison.)",
    )

    user_prompt = USER_PROMPT_TEMPLATE.format(
        context=context_text,
        comparison_type_instruction=comparison_instruction,
    )

    # Step 3: Call vLLM via core generation
    raw_response = await generate_completion(
        system_prompt=SYSTEM_PROMPT,
        user_prompt=user_prompt,
        max_tokens=settings.comparison_max_tokens,
        temperature=0.2,
        response_format="json_object",
    )

    # Step 4: Parse and validate
    comparison_data = _parse_comparison_response(raw_response)

    # Compute confidence score
    confidence = _compute_confidence(comparison_data, passages_by_doc)

    return ComparisonResponse(
        documents=[
            ComparisonDocumentSummary(
                document_id=d.get("document_id", ""),
                title=d.get("title", "Untitled"),
                citation_text=d.get("citation_text", ""),
                court=d.get("court", ""),
                decision_date=d.get("decision_date", ""),
            )
            for d in comparison_data.get("documents", [])
            if isinstance(d, dict)
        ],
        dimensions=[
            ComparisonDimension(
                dimension=dim.get("dimension", ""),
                entries=[
                    ComparisonDimensionEntry(
                        document_id=e.get("document_id", ""),
                        content=e.get("content", ""),
                        citations=[
                            CitationRef(
                                source_id=c.get("source_id", ""),
                                section_id=c.get("section_id"),
                                text=c.get("text", ""),
                            )
                            for c in e.get("citations", [])
                            if isinstance(c, dict) and c.get("source_id")
                        ],
                    )
                    for e in dim.get("entries", [])
                    if isinstance(e, dict)
                ],
                analysis=dim.get("analysis", ""),
            )
            for dim in comparison_data.get("dimensions", [])
            if isinstance(dim, dict)
        ],
        overall_analysis=comparison_data.get("overall_analysis", ""),
        confidence_score=confidence,
        model_name=model_info["model_name"],
        prompt_template_version=PROMPT_VERSION,
    )


def _parse_comparison_response(raw: str) -> dict[str, Any]:
    """Parse the LLM JSON output into a comparison structure."""
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("Failed to parse LLM comparison response as JSON")
        return {
            "documents": [],
            "dimensions": [],
            "overall_analysis": "The AI was unable to generate a properly formatted comparison.",
        }

    return data


def _compute_confidence(
    comparison_data: dict[str, Any],
    passages_by_doc: dict[str, list[Any]],
) -> float:
    """Compute confidence based on dimension coverage and passage support."""
    dimensions = comparison_data.get("dimensions", [])
    doc_count = len(passages_by_doc)

    if not dimensions or doc_count == 0:
        return 0.3

    dims_with_analysis = sum(
        1 for d in dimensions if isinstance(d, dict) and d.get("analysis")
    )
    dimension_coverage = dims_with_analysis / max(len(dimensions), 1)

    total_entries = sum(
        len(d.get("entries", []))
        for d in dimensions
        if isinstance(d, dict)
    )
    expected_entries = len(dimensions) * doc_count
    entry_completeness = min(total_entries / max(expected_entries, 1), 1.0)

    docs_with_passages = sum(1 for p in passages_by_doc.values() if len(p) > 0)
    passage_availability = docs_with_passages / max(doc_count, 1)

    confidence = (
        dimension_coverage * 0.3
        + entry_completeness * 0.4
        + passage_availability * 0.3
    )
    return round(max(0.0, min(1.0, confidence)), 2)
