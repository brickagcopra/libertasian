"""Doctrine extraction service — uses core generation for LLM-based extraction."""

import json
import logging
from typing import Any

import asyncpg

from ..config import settings
from ..core.generation import generate_completion, get_model_info
from .prompts import PROMPT_VERSION, SYSTEM_PROMPT, USER_PROMPT_FULL_TEXT, USER_PROMPT_SECTIONS
from .schemas import (
    DoctrineExtractionRequest,
    DoctrineExtractionResponse,
    DoctrineType,
    ExtractedDoctrine,
    ExtractionStrategy,
)

logger = logging.getLogger(__name__)


async def extract_doctrines(request: DoctrineExtractionRequest) -> DoctrineExtractionResponse:
    """Extract doctrines from a legal document using LLM."""
    model_info = get_model_info()
    strategy = _determine_strategy(request)

    if strategy == ExtractionStrategy.SECTIONS_ONLY and request.sections:
        user_prompt = _build_sections_prompt(request.sections)
    else:
        text = request.document_text or ""
        if not text:
            text = await _fetch_document_text(request.document_id)
        # Truncate to approximate token budget (4 chars ~ 1 token)
        user_prompt = USER_PROMPT_FULL_TEXT.format(
            document_text=text[: settings.doctrine_max_tokens * 4]
        )

    # Call vLLM via core generation
    raw_response = await generate_completion(
        system_prompt=SYSTEM_PROMPT,
        user_prompt=user_prompt,
        max_tokens=settings.doctrine_max_tokens,
        temperature=0.1,
        response_format="json_object",
    )

    # Parse the LLM output
    doctrines = _parse_extraction_response(raw_response, request)

    return DoctrineExtractionResponse(
        document_id=request.document_id,
        doctrines=doctrines,
        strategy_used=strategy.value,
        model_name=model_info["model_name"],
        prompt_template_version=PROMPT_VERSION,
    )


def _determine_strategy(request: DoctrineExtractionRequest) -> ExtractionStrategy:
    """Determine the extraction strategy based on request data."""
    if request.strategy != ExtractionStrategy.AUTO:
        return request.strategy
    if request.sections and len(request.sections) > 0:
        return ExtractionStrategy.SECTIONS_ONLY
    return ExtractionStrategy.FULL_TEXT


def _build_sections_prompt(sections: list[dict[str, Any]]) -> str:
    """Build a prompt from individual document sections."""
    parts: list[str] = []
    for s in sections:
        section_id = s.get("id", "unknown")
        section_type = s.get("section_type", "unknown")
        text = s.get("plain_text", "")
        if text:
            parts.append(
                f"---SECTION [{section_id}] ({section_type})---\n{text}\n---END SECTION---"
            )
    return USER_PROMPT_SECTIONS.format(sections_text="\n\n".join(parts))


async def _fetch_document_text(document_id: str) -> str:
    """Fetch document text from PostgreSQL (sections concatenated).

    Uses asyncpg for direct read-only access per CLAUDE.md architecture rule:
    Python services read PostgreSQL directly (read-only pool).
    """
    conn: asyncpg.Connection = await asyncpg.connect(settings.database_url)
    try:
        rows = await conn.fetch(
            """SELECT "plainText" FROM "LegalDocumentSection"
               WHERE "legalDocumentId" = $1
               ORDER BY ordering ASC""",
            document_id,
        )
        return "\n\n".join(row["plainText"] or "" for row in rows)
    finally:
        await conn.close()


def _parse_extraction_response(
    raw: str,
    request: DoctrineExtractionRequest,
) -> list[ExtractedDoctrine]:
    """Parse the LLM JSON output into ExtractedDoctrine objects."""
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("Failed to parse LLM response as JSON for doc %s", request.document_id)
        return []

    doctrines_raw = data.get("doctrines", [])
    results: list[ExtractedDoctrine] = []

    # Build section ID lookup from provided sections
    section_map: dict[str, str] = {}
    if request.sections:
        for s in request.sections:
            sid = s.get("id", "")
            stype = s.get("section_type", "")
            if sid:
                section_map[sid] = sid
                section_map[stype] = sid

    for d in doctrines_raw:
        if not isinstance(d, dict) or not d.get("text"):
            continue

        raw_type = d.get("doctrine_type", "other")
        try:
            dtype = DoctrineType(raw_type)
        except ValueError:
            dtype = DoctrineType.OTHER

        try:
            confidence = float(d.get("confidence", 0.5))
            confidence = max(0.0, min(1.0, confidence))
        except (TypeError, ValueError):
            confidence = 0.5

        source_section = d.get("source_section")
        section_id: str | None = None
        if source_section and source_section in section_map:
            section_id = section_map[source_section]

        results.append(
            ExtractedDoctrine(
                text=str(d["text"]),
                normalized_text=str(d["text"]).strip()[:500] if d.get("text") else None,
                doctrine_type=dtype,
                source_section_id=section_id,
                confidence=confidence,
            )
        )

    return results
