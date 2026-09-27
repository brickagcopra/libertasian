"""Memo and outline generation service — uses core pipeline for retrieval and generation."""

import json
import logging
from typing import Any

from ..config import settings
from ..core.context import pack_context
from ..core.generation import generate_completion, get_model_info
from ..core.ranked import retrieve_ranked
from ..core.validation import (
    build_citation_check_text,
    invalid_citation_ids,
    invalid_citation_warning,
    validate_citations,
)
from .prompts import (
    MEMO_TYPE_INSTRUCTIONS,
    OUTLINE_PROMPT_VERSION,
    OUTLINE_SYSTEM_PROMPT,
    OUTLINE_TYPE_INSTRUCTIONS,
    OUTLINE_USER_PROMPT_TEMPLATE,
    PROMPT_VERSION,
    SYSTEM_PROMPT,
    USER_PROMPT_TEMPLATE,
)
from .schemas import (
    CitationRef,
    MemoGenerationRequest,
    MemoGenerationResponse,
    MemoSectionOutput,
    OutlineGenerationResponse,
)

logger = logging.getLogger(__name__)


async def generate_memo(request: MemoGenerationRequest) -> MemoGenerationResponse:
    """Generate a structured legal memo using RAG pipeline.

    Steps:
    1. Retrieve relevant source passages via the shared ranked pipeline
       (hybrid BM25 + kNN, cross-encoder rerank, authority boost)
    2. Pack context with citation anchors within the memo token budget
    3. Call vLLM via core generation
    4. Parse the output and validate its citations (reported, not fatal)
    """
    model_info = get_model_info()

    # Step 1: Retrieve relevant passages via the shared ranked pipeline.
    # Per CLAUDE.md: 15 passages after reranking for digest/memo.
    ranked = await retrieve_ranked(request.query.strip(), top_k=15)
    passages = ranked.passages

    # Step 2: Build prompt with context
    memo_instruction = MEMO_TYPE_INSTRUCTIONS.get(
        request.memo_type.value,
        MEMO_TYPE_INSTRUCTIONS["research_summary"],
    )

    # Per CLAUDE.md: 8192-token context budget for digest/memo.
    context_text = pack_context(
        passages, token_budget=settings.memo_context_tokens
    ).formatted_context

    user_prompt = USER_PROMPT_TEMPLATE.format(
        context=context_text,
        query=request.query,
        memo_type_instruction=memo_instruction,
    )

    # Step 3: Call vLLM via core generation
    raw_response = await generate_completion(
        system_prompt=SYSTEM_PROMPT,
        user_prompt=user_prompt,
        max_tokens=settings.memo_max_tokens,
        temperature=0.2,
        response_format="json_object",
    )

    # Step 4: Parse and validate
    memo_data = _parse_memo_response(raw_response)

    # Compute confidence score based on citation coverage
    confidence = _compute_confidence(memo_data, passages)

    sections = [
        MemoSectionOutput(
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
        for s in memo_data.get("sections", [])
        if isinstance(s, dict)
    ]
    all_citations = [
        CitationRef(
            source_id=c.get("source_id", ""),
            section_id=c.get("section_id"),
            text=c.get("text", ""),
        )
        for c in memo_data.get("all_citations", [])
        if isinstance(c, dict) and c.get("source_id")
    ]
    summary = memo_data.get("summary", "")
    conclusion = memo_data.get("conclusion", "")

    # Step 5: Citation validation (NON-OPTIONAL per CLAUDE.md). Invalid IDs are
    # reported on the response rather than failing the memo.
    check_text, malformed = build_citation_check_text(
        [str(summary), *(s.content for s in sections), str(conclusion)],
        [
            (c.source_id, c.section_id)
            for c in [*all_citations, *(c for s in sections for c in s.citations)]
        ],
    )
    validation = await validate_citations(check_text, passages)
    bad_ids = invalid_citation_ids(validation, malformed)
    warnings: list[str] = []
    if bad_ids:
        logger.warning("Memo cites %d invalid source ID(s)", len(bad_ids))
        warnings.append(invalid_citation_warning(bad_ids))

    return MemoGenerationResponse(
        title=memo_data.get("title", "Untitled Memo"),
        summary=summary,
        sections=sections,
        conclusion=conclusion,
        citations=all_citations,
        confidence_score=confidence,
        model_name=model_info["model_name"],
        prompt_template_version=PROMPT_VERSION,
        invalid_citation_ids=bad_ids,
        warnings=warnings,
    )


async def generate_outline(
    request: MemoGenerationRequest,
) -> OutlineGenerationResponse:
    """Generate a structured outline from raw text (e.g. OCR output).

    Unlike memo generation, outlines:
    - Use raw_text directly instead of RAG retrieval
    - Produce hierarchical sections with key points (no prose)
    - Are used for study aids from camera scans
    """
    model_info = get_model_info()

    raw_text = request.raw_text or ""
    if len(raw_text.strip()) < 50:
        return OutlineGenerationResponse(
            outline={
                "title": "Insufficient Text",
                "sections": [
                    {
                        "heading": "Error",
                        "key_points": [
                            "The provided text is too short to generate a meaningful outline."
                        ],
                    }
                ],
            },
            confidence_score=0.0,
            model_name=model_info["model_name"],
            prompt_template_version=OUTLINE_PROMPT_VERSION,
        )

    outline_type = request.outline_type or "topic_outline"
    outline_instruction = OUTLINE_TYPE_INSTRUCTIONS.get(
        outline_type,
        OUTLINE_TYPE_INSTRUCTIONS["topic_outline"],
    )

    user_prompt = OUTLINE_USER_PROMPT_TEMPLATE.format(
        raw_text=raw_text[:50_000],  # Cap input to prevent token overflow
        outline_type_instruction=outline_instruction,
    )

    raw_response = await generate_completion(
        system_prompt=OUTLINE_SYSTEM_PROMPT,
        user_prompt=user_prompt,
        max_tokens=settings.memo_max_tokens,
        temperature=0.2,
        response_format="json_object",
    )

    outline_data = _parse_outline_response(raw_response)
    confidence = _compute_outline_confidence(outline_data, raw_text)

    return OutlineGenerationResponse(
        outline=outline_data,
        confidence_score=confidence,
        model_name=model_info["model_name"],
        prompt_template_version=OUTLINE_PROMPT_VERSION,
    )


# ---- Internal helpers ----


def _parse_memo_response(raw: str) -> dict[str, Any]:
    """Parse the LLM JSON output into a memo structure."""
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("Failed to parse LLM memo response as JSON")
        return {
            "title": "Memo Generation Error",
            "summary": "The AI was unable to generate a properly formatted memo.",
            "sections": [],
            "conclusion": "",
            "all_citations": [],
        }

    return data


def _parse_outline_response(raw: str) -> dict[str, Any]:
    """Parse the LLM JSON output into an outline structure."""
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("Failed to parse LLM outline response as JSON")
        return {
            "title": "Outline Generation Error",
            "sections": [
                {
                    "heading": "Error",
                    "key_points": ["The AI was unable to generate a properly formatted outline."],
                }
            ],
        }

    # Ensure required fields
    if "title" not in data:
        data["title"] = "Untitled Outline"
    if "sections" not in data or not isinstance(data["sections"], list):
        data["sections"] = []

    return data


def _compute_confidence(
    memo_data: dict[str, Any],
    passages: list[Any],
) -> float:
    """Compute confidence score based on citation coverage and passage support.

    Per CLAUDE.md: score = source coverage + citation mapping + quality factor.
    """
    sections = memo_data.get("sections", [])

    if not sections:
        return 0.3  # Low confidence if no sections generated

    # Source coverage: proportion of sections with content
    sections_with_content = sum(
        1 for s in sections if isinstance(s, dict) and s.get("content")
    )
    source_coverage = sections_with_content / max(len(sections), 1)

    # Citation mapping: proportion of sections with citations
    sections_with_citations = sum(
        1
        for s in sections
        if isinstance(s, dict) and s.get("citations") and len(s["citations"]) > 0
    )
    citation_mapping = sections_with_citations / max(len(sections), 1)

    # Passage availability factor
    passage_factor = min(len(passages) / 5, 1.0)  # At least 5 passages for full score

    # Weighted confidence
    confidence = source_coverage * 0.3 + citation_mapping * 0.4 + passage_factor * 0.3
    return round(max(0.0, min(1.0, confidence)), 2)


def _compute_outline_confidence(
    outline_data: dict[str, Any],
    raw_text: str,
) -> float:
    """Compute confidence score for outline generation."""
    sections = outline_data.get("sections", [])

    if not sections:
        return 0.1

    # Section count factor: more sections = better extraction
    section_factor = min(len(sections) / 3, 1.0)

    # Key points density: average key points per section
    total_points = sum(
        len(s.get("key_points", []))
        for s in sections
        if isinstance(s, dict)
    )
    points_per_section = total_points / max(len(sections), 1)
    points_factor = min(points_per_section / 3, 1.0)

    # Input quality: longer text generally yields better outlines
    text_factor = min(len(raw_text) / 1000, 1.0)

    confidence = section_factor * 0.4 + points_factor * 0.4 + text_factor * 0.2
    return round(max(0.0, min(1.0, confidence)), 2)
