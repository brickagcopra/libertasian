"""Digest generation service — produces DFIR+ structured digests from document sections."""

import json
import logging
import uuid
from typing import Any

from ..config import settings
from ..core.generation import generate_completion_with_usage, get_model_info
from .prompts import PROMPT_VERSION, SYSTEM_PROMPT, USER_PROMPT_TEMPLATE
from .schemas import (
    CitedAuthority,
    DigestGenerationRequest,
    DigestGenerationResponse,
    ProvenanceEntry,
)

logger = logging.getLogger(__name__)

# Placeholder strings the LLM sometimes echoes verbatim from prompt examples.
# These are never valid UUIDs; drop them silently rather than logging at WARN.
_PROVENANCE_PLACEHOLDERS = frozenset({"section-uuid", "doc-uuid"})


def _coerce_text(value: Any) -> str | None:
    """Coerce a digest field value to str or None.

    LLMs sometimes return list[str] instead of str for DFIR+ fields like
    ``issues`` or ``facts``.  This normalises the value at the service
    boundary so downstream code always sees ``str | None``.
    """
    if value is None:
        return None
    if isinstance(value, str):
        return value if value.strip() else None
    if isinstance(value, list):
        items = [str(item).strip() for item in value if item]
        if not items:
            return None
        # If the items look like enumerated points, bullet them.
        return "\n\n".join(f"- {item}" for item in items)
    # Unexpected type — stringify as fallback
    return str(value)


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

    # Step 3: Call vLLM. Use the with_usage variant so we can surface
    # tokens_in/tokens_out — the worker uses them to bill the originating
    # backfill batch's budget_consumed_usd via pricing.cost_for. The plain
    # generate_completion path is otherwise identical.
    completion = await generate_completion_with_usage(
        system_prompt=SYSTEM_PROMPT,
        user_prompt=user_prompt,
        max_tokens=settings.digest_max_tokens,
        temperature=0.2,
        response_format="json_object",
    )

    # Step 4: Parse response
    digest_data = _parse_digest_response(completion["content"])

    # Step 5: Compute confidence
    confidence = _compute_confidence(digest_data, request.sections)

    # Build provenance entries with document_id filled in
    provenance = _extract_provenance(digest_data, request.document_id)

    return DigestGenerationResponse(
        summary=_coerce_text(digest_data.get("summary")),
        facts=_coerce_text(digest_data.get("facts")),
        petitioner_arguments=_coerce_text(digest_data.get("petitioner_arguments")),
        respondent_arguments=_coerce_text(digest_data.get("respondent_arguments")),
        issues=_coerce_text(digest_data.get("issues")),
        ruling=_coerce_text(digest_data.get("ruling")),
        doctrine=_coerce_text(digest_data.get("doctrine")),
        dispositive=_coerce_text(digest_data.get("dispositive")),
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
        model_name=completion.get("model_name", model_info["model_name"]),
        prompt_template_version=PROMPT_VERSION,
        tokens_in=int(completion.get("tokens_in", 0) or 0),
        tokens_out=int(completion.get("tokens_out", 0) or 0),
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


def _clean_uuid_token(value: Any) -> str | None:
    """Normalize a section/document id token to a bare UUID string.

    Defenses against LLM output drift documented in prompts.py v2:
    - Strips a leading ``§`` (the v1 prompt taught the model to emit
      ``[§<uuid>]`` and some completions echo the prefix into the JSON).
    - Drops the literal placeholders ``section-uuid`` / ``doc-uuid`` that
      leak from the example block in the prompt.
    - Validates with ``uuid.UUID`` and returns ``None`` on parse failure
      so the worker's ``provenance_records.source_section_id::uuid`` cast
      never sees a malformed value (which used to crash the digest task
      and lock inflight slots for 9 minutes per retry cycle).
    """
    if not isinstance(value, str):
        return None
    cleaned = value.strip().lstrip("§").strip()
    if not cleaned or cleaned in _PROVENANCE_PLACEHOLDERS:
        return None
    try:
        return str(uuid.UUID(cleaned))
    except (ValueError, AttributeError):
        logger.debug(
            "_extract_provenance: dropping malformed section/document id %r",
            value,
        )
        return None


def _extract_provenance(
    digest_data: dict[str, Any],
    document_id: str,
) -> list[ProvenanceEntry]:
    """Extract and normalize provenance entries from the LLM response.

    Returns only entries whose ``source_section_id`` parses as a UUID after
    cleaning. Malformed entries are dropped (not raised) — digest write
    proceeds without them; the worker's ``create_provenance_records`` would
    otherwise reject the whole batch.
    """
    raw_provenance = digest_data.get("provenance", [])
    entries: list[ProvenanceEntry] = []
    for p in raw_provenance:
        if not isinstance(p, dict):
            continue
        field = p.get("field")
        section_id = _clean_uuid_token(p.get("source_section_id"))
        if not field or not section_id:
            continue
        # Document id has the same drift potential — fall back to the request
        # document_id if the LLM emitted a placeholder or malformed token.
        doc_id = _clean_uuid_token(p.get("source_document_id")) or document_id
        entries.append(
            ProvenanceEntry(
                field=field,
                source_section_id=section_id,
                source_document_id=doc_id,
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
    # Use _coerce_text so list-valued fields (from LLM drift) are counted
    filled = sum(
        1 for f in dfir_fields
        if _coerce_text(digest_data.get(f)) is not None
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
