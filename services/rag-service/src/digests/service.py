"""Digest generation service — produces DFIR+ structured digests from document sections."""

import json
import logging
from typing import Any

from ..config import settings
from ..core.generation import generate_completion, get_model_info
from .prompts import PROMPT_VERSION, SYSTEM_PROMPT, USER_PROMPT_TEMPLATE
from .schemas import (
    CitedAuthority,
    DigestGenerationRequest,
    DigestGenerationResponse,
    ProvenanceEntry,
)

logger = logging.getLogger(__name__)


async def generate_digest(
    request: DigestGenerationRequest,
) -> DigestGenerationResponse:
    """Generate a structured DFIR+ digest from document sections.

    Steps:
    1. Format document sections as context with section IDs
    2. Build prompt with DFIR+ template
    3. Call vLLM via core generation
    4. Parse and validate output
    5. Compute confidence score
    """
    model_info = get_model_info()

    # Step 1: Format sections as context
    context_text = _format_sections(request.sections)

    # Step 2: Build prompt
    user_prompt = USER_PROMPT_TEMPLATE.format(
        context=context_text,
        document_id=request.document_id,
        document_type=request.document_type,
    )

    # Step 3: Call vLLM
    raw_response = await generate_completion(
        system_prompt=SYSTEM_PROMPT,
        user_prompt=user_prompt,
        max_tokens=settings.digest_max_tokens,
        temperature=0.2,
        response_format="json_object",
    )

    # Step 4: Parse response
    digest_data = _parse_digest_response(raw_response)

    # Step 5: Compute confidence
    confidence = _compute_confidence(digest_data, request.sections)

    # Build provenance entries with document_id filled in
    provenance = _extract_provenance(digest_data, request.document_id)

    return DigestGenerationResponse(
        summary=digest_data.get("summary") or None,
        facts=digest_data.get("facts") or None,
        petitioner_arguments=digest_data.get("petitioner_arguments") or None,
        respondent_arguments=digest_data.get("respondent_arguments") or None,
        issues=digest_data.get("issues") or None,
        ruling=digest_data.get("ruling") or None,
        doctrine=digest_data.get("doctrine") or None,
        dispositive=digest_data.get("dispositive") or None,
        cited_authorities=[
            CitedAuthority(
                citation_text=c.get("citation_text", ""),
                document_type=c.get("document_type", "case"),
                gr_no=c.get("gr_no"),
            )
            for c in digest_data.get("cited_authorities", [])
            if isinstance(c, dict) and c.get("citation_text")
        ],
        provenance=provenance,
        confidence_score=confidence,
        model_name=model_info["model_name"],
        prompt_template_version=PROMPT_VERSION,
    )


def _format_sections(
    sections: list[Any],
) -> str:
    """Format document sections into a labeled context string with section IDs."""
    parts: list[str] = []
    for section in sections:
        text = section.plain_text
        if not text or not text.strip():
            continue
        label = section.section_label or section.section_type
        header = f"[§{section.id}] {label}"
        if section.page_start is not None:
            header += f" (pages {section.page_start}-{section.page_end or section.page_start})"
        parts.append(f"{header}\n{text.strip()}")
    return "\n\n".join(parts)


def _parse_digest_response(raw: str) -> dict[str, Any]:
    """Parse the LLM JSON output into a digest structure."""
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("Failed to parse LLM digest response as JSON")
        return {
            "summary": None,
            "facts": None,
            "petitioner_arguments": None,
            "respondent_arguments": None,
            "issues": None,
            "ruling": None,
            "doctrine": None,
            "dispositive": None,
            "cited_authorities": [],
            "provenance": [],
        }
    return data


def _extract_provenance(
    digest_data: dict[str, Any],
    document_id: str,
) -> list[ProvenanceEntry]:
    """Extract and normalize provenance entries from the LLM response."""
    raw_provenance = digest_data.get("provenance", [])
    entries: list[ProvenanceEntry] = []
    for p in raw_provenance:
        if not isinstance(p, dict):
            continue
        field = p.get("field")
        section_id = p.get("source_section_id")
        if not field or not section_id:
            continue
        entries.append(
            ProvenanceEntry(
                field=field,
                source_section_id=section_id,
                source_document_id=p.get("source_document_id", document_id),
            )
        )
    return entries


def _compute_confidence(
    digest_data: dict[str, Any],
    sections: list[Any],
) -> float:
    """Compute confidence score based on field coverage and provenance.

    Per CLAUDE.md: score = source coverage + citation mapping + quality factor.
    """
    # DFIR+ has 8 content fields
    dfir_fields = [
        "summary",
        "facts",
        "petitioner_arguments",
        "respondent_arguments",
        "issues",
        "ruling",
        "doctrine",
        "dispositive",
    ]

    # Source coverage: proportion of fields with content
    filled = sum(
        1 for f in dfir_fields
        if digest_data.get(f) and isinstance(digest_data[f], str) and digest_data[f].strip()
    )
    # petitioner_arguments and respondent_arguments may legitimately be null
    # so use 6 as the denominator for required fields
    required_count = 6  # summary, facts, issues, ruling, doctrine, dispositive
    source_coverage = min(filled / required_count, 1.0)

    # Citation mapping: provenance entries per filled field
    provenance_count = len(digest_data.get("provenance", []))
    citation_mapping = min(provenance_count / max(filled, 1), 1.0) if filled > 0 else 0.0

    # Section availability factor
    section_count = sum(1 for s in sections if s.plain_text and s.plain_text.strip())
    section_factor = min(section_count / 3, 1.0)  # At least 3 sections for full score

    # Weighted confidence
    confidence = source_coverage * 0.4 + citation_mapping * 0.3 + section_factor * 0.3
    return round(max(0.0, min(1.0, confidence)), 2)
