"""Pleading generation service — uses core pipeline for retrieval and generation."""

import json
import logging
from typing import Any

from ..config import settings
from ..core.generation import generate_completion, get_model_info
from ..core.retrieval import retrieve_by_query
from ..shared.formatting import format_passages
from .prompts import (
    CATEGORY_INSTRUCTIONS,
    PROMPT_VERSION,
    SYSTEM_PROMPT,
    USER_PROMPT_TEMPLATE,
)
from .schemas import (
    CitationRef,
    PleadingGenerationRequest,
    PleadingGenerationResponse,
    PleadingSectionOutput,
)

logger = logging.getLogger(__name__)


async def generate_pleading(
    request: PleadingGenerationRequest,
) -> PleadingGenerationResponse:
    """Generate a structured legal pleading using RAG pipeline.

    Steps:
    1. Build search query from input data and context
    2. Retrieve relevant legal passages via core pipeline
    3. Call vLLM via core generation
    4. Parse and validate output
    """
    model_info = get_model_info()

    # Step 1: Build search query from input
    search_query = _build_search_query(request)

    # Step 2: Retrieve relevant passages via core pipeline
    passages = await retrieve_by_query(
        search_query,
        top_k=10,
        text_truncate=2000,
    )

    # Step 3: Build prompt
    category_instruction = CATEGORY_INSTRUCTIONS.get(
        request.template_category,
        CATEGORY_INSTRUCTIONS["other"],
    )

    context_text = format_passages(passages)
    input_data_text = _format_input_data(request.input_data, request.template_json)

    additional_context = ""
    if request.context_query:
        additional_context = (
            f"Additional context from user: {request.context_query}"
        )

    user_prompt = USER_PROMPT_TEMPLATE.format(
        template_name=request.template_name,
        template_category=request.template_category,
        context=context_text,
        input_data=input_data_text,
        category_instruction=category_instruction,
        additional_context=additional_context,
    )

    # Step 4: Call vLLM via core generation
    raw_response = await generate_completion(
        system_prompt=SYSTEM_PROMPT,
        user_prompt=user_prompt,
        max_tokens=settings.pleading_max_tokens,
        temperature=0.2,
        response_format="json_object",
    )

    # Step 5: Parse and validate
    pleading_data = _parse_pleading_response(raw_response)

    confidence = _compute_confidence(pleading_data, passages)

    return PleadingGenerationResponse(
        title=pleading_data.get("title", request.template_name),
        sections=[
            PleadingSectionOutput(
                key=s.get("key", ""),
                heading=s.get("heading", ""),
                content=s.get("content", ""),
                citations=[
                    CitationRef(
                        source_id=c.get("source_id", ""),
                        section_id=c.get("section_id"),
                        text=c.get("text", ""),
                    )
                    for c in s.get("citations", [])
                    if isinstance(c, dict) and c.get("source_id")
                ],
            )
            for s in pleading_data.get("sections", [])
            if isinstance(s, dict)
        ],
        citations=[
            CitationRef(
                source_id=c.get("source_id", ""),
                section_id=c.get("section_id"),
                text=c.get("text", ""),
            )
            for c in pleading_data.get("all_citations", [])
            if isinstance(c, dict) and c.get("source_id")
        ],
        confidence_score=confidence,
        model_name=model_info["model_name"],
        prompt_template_version=PROMPT_VERSION,
    )


def _build_search_query(request: PleadingGenerationRequest) -> str:
    """Build a search query from the pleading request for retrieving relevant context."""
    parts: list[str] = []

    if request.context_query:
        parts.append(request.context_query)

    input_data = request.input_data
    for key in ["cause_of_action", "legal_basis", "grounds", "issues", "subject_matter"]:
        value = input_data.get(key)
        if isinstance(value, str) and value.strip():
            parts.append(value.strip())

    if not parts:
        parts.append(f"{request.template_category} {request.template_name}")

    return " ".join(parts)[:500]


def _format_input_data(
    input_data: dict[str, Any],
    template_json: Any,
) -> str:
    """Format input data into a readable string for the prompt."""
    parts: list[str] = []

    section_labels: dict[str, str] = {}
    if isinstance(template_json, dict):
        for section in template_json.get("sections", []):
            if isinstance(section, dict):
                section_labels[section.get("key", "")] = section.get("label", "")

    for key, value in input_data.items():
        label = section_labels.get(key, key.replace("_", " ").title())
        if isinstance(value, list):
            value_str = "\n  ".join(str(v) for v in value)
            parts.append(f"{label}:\n  {value_str}")
        elif isinstance(value, dict):
            value_str = json.dumps(value, indent=2, ensure_ascii=False)
            parts.append(f"{label}: {value_str}")
        else:
            parts.append(f"{label}: {value}")

    return "\n".join(parts) if parts else "(No input data provided)"


def _parse_pleading_response(raw: str) -> dict[str, Any]:
    """Parse the LLM JSON output into a pleading structure."""
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("Failed to parse LLM pleading response as JSON")
        return {
            "title": "Pleading Generation Error",
            "sections": [],
            "all_citations": [],
        }

    return data


def _compute_confidence(
    pleading_data: dict[str, Any],
    passages: list[Any],
) -> float:
    """Compute confidence score based on section coverage and citation support."""
    sections = pleading_data.get("sections", [])

    if not sections:
        return 0.3

    sections_with_content = sum(
        1 for s in sections if isinstance(s, dict) and s.get("content")
    )
    section_coverage = sections_with_content / max(len(sections), 1)

    sections_with_citations = sum(
        1
        for s in sections
        if isinstance(s, dict) and s.get("citations") and len(s["citations"]) > 0
    )
    citation_density = sections_with_citations / max(len(sections), 1)

    passage_factor = min(len(passages) / 5, 1.0)

    confidence = section_coverage * 0.4 + citation_density * 0.3 + passage_factor * 0.3
    return round(max(0.0, min(1.0, confidence)), 2)
