"""Case-codal auto-suggestion service.

Analyzes a case document and suggests which codal provisions it references,
using a combination of OpenSearch retrieval and LLM analysis.
"""

import json
import logging
from typing import Any

from ..config import settings
from ..core.generation import generate_completion, get_model_info
from ..shared.database import acquire_connection
from ..shared.opensearch import opensearch_search
from .prompts_codal import PROMPT_VERSION, SYSTEM_PROMPT, USER_PROMPT_TEMPLATE
from .schemas import (
    CaseCodalSuggestionRequest,
    CaseCodalSuggestionResponse,
    SuggestedCaseCodalLink,
)

logger = logging.getLogger(__name__)

# Max characters of case text to send to the LLM
_CASE_TEXT_MAX_CHARS = 30_000

# Max codal candidates to retrieve from OpenSearch
_MAX_CODAL_CANDIDATES = 20

# The BM25 alias the API actually maintains (see apps/api .../index-mappings.ts
# KEYWORD_INDEX). This module queried a bare "legal_documents" index that has
# never existed, so every codal candidate search 404'd and silently returned [].
# The mapping calls the body field `plain_text`, not `content`.
_CODAL_INDEX = "legal_documents_keyword"


async def suggest_case_codal_links(
    request: CaseCodalSuggestionRequest,
) -> CaseCodalSuggestionResponse:
    """Suggest codal provisions referenced by a case.

    Steps:
    1. Fetch case document text from PostgreSQL
    2. Search OpenSearch for candidate codal provisions
    3. Send case text + candidates to LLM for analysis
    4. Parse and validate LLM output
    """
    model_info = get_model_info()

    # Step 1: Fetch case text. The schema has no ``full_text`` column on
    # ``legal_documents`` — case text lives in ``legal_document_sections``.
    # The previous SELECT referenced a phantom ``"fullText"`` and so always
    # failed, falling through to the section fetch (which itself was
    # quoting non-existent PascalCase identifiers and so always returned 0
    # rows). Net effect: every case-codal suggestion request received an
    # empty ``case_text`` and short-circuited to a no-suggestion reply.
    #
    # Route through ``acquire_connection`` (shared/database.py) so any
    # future schema regression surfaces as ``SchemaIntegrityError`` rather
    # than being silently swallowed by a downstream catch-all.
    async with acquire_connection() as conn:
        case_doc = await conn.fetchrow(
            """SELECT id, title, short_title, citation_text
               FROM legal_documents
               WHERE id = $1 AND status = 'published'
               LIMIT 1""",
            request.document_id,
        )

        if not case_doc:
            return CaseCodalSuggestionResponse(
                document_id=request.document_id,
                document_title="Not Found",
                suggestions=[],
                model_name=model_info["model_name"],
                prompt_template_version=PROMPT_VERSION,
            )

        case_title = case_doc["title"] or "Untitled"

        # Fetch the case text from sections — the canonical home for
        # document body content. ``ordering`` is the section sequence
        # column on ``legal_document_sections``; ``page_start`` is a
        # secondary sort for OCR'd documents that paginate.
        sections = await conn.fetch(
            """SELECT plain_text FROM legal_document_sections
               WHERE legal_document_id = $1
               ORDER BY ordering ASC NULLS LAST, page_start ASC NULLS LAST
               LIMIT 50""",
            request.document_id,
        )
        case_text = "\n\n".join(
            row["plain_text"] for row in sections if row["plain_text"]
        )

        if len(case_text.strip()) < 100:
            return CaseCodalSuggestionResponse(
                document_id=request.document_id,
                document_title=case_title,
                suggestions=[],
                model_name=model_info["model_name"],
                prompt_template_version=PROMPT_VERSION,
            )

        # Step 2: Search for candidate codal provisions via OpenSearch
        codal_candidates = await _search_codal_candidates(case_text[:5000])

        # Also fetch codal info from DB for candidates found
        codal_map: dict[str, dict[str, Any]] = {}
        if codal_candidates:
            codal_ids = [c["id"] for c in codal_candidates]
            codals = await conn.fetch(
                """SELECT id, title, citation_text
                   FROM legal_documents
                   WHERE id = ANY($1::uuid[])""",
                codal_ids,
            )
            for row in codals:
                codal_map[str(row["id"])] = {
                    "title": row["title"],
                    "citation": row["citation_text"],
                }

    if not codal_candidates:
        return CaseCodalSuggestionResponse(
            document_id=request.document_id,
            document_title=case_title,
            suggestions=[],
            model_name=model_info["model_name"],
            prompt_template_version=PROMPT_VERSION,
        )

    # Step 3: Build prompt and call LLM
    codal_text = _format_codal_candidates(codal_candidates, codal_map)
    truncated_case = case_text[:_CASE_TEXT_MAX_CHARS]

    user_prompt = USER_PROMPT_TEMPLATE.format(
        case_text=truncated_case,
        codal_candidates=codal_text,
    )

    raw_response = await generate_completion(
        system_prompt=SYSTEM_PROMPT,
        user_prompt=user_prompt,
        max_tokens=settings.memo_max_tokens,
        temperature=0.1,
        response_format="json_object",
    )

    # Step 4: Parse LLM output
    suggestions = _parse_suggestions(raw_response, codal_map, request.max_suggestions)

    logger.info(
        "Case-codal suggestions for document %s: %d suggestions",
        request.document_id,
        len(suggestions),
    )

    return CaseCodalSuggestionResponse(
        document_id=request.document_id,
        document_title=case_title,
        suggestions=suggestions,
        model_name=model_info["model_name"],
        prompt_template_version=PROMPT_VERSION,
    )


async def _search_codal_candidates(case_excerpt: str) -> list[dict[str, Any]]:
    """Search OpenSearch for codal provisions that may be referenced in the case."""
    query = {
        "size": _MAX_CODAL_CANDIDATES,
        "query": {
            "bool": {
                "must": [
                    {
                        "multi_match": {
                            "query": case_excerpt,
                            "fields": ["title^2", "citation_text^2", "plain_text"],
                            "type": "best_fields",
                        }
                    }
                ],
                "filter": [
                    {
                        "terms": {
                            # Values measured against `legal_documents_keyword`
                            # on 2026-09-02. "statute" was dropped: a terms
                            # aggregation returns ZERO documents for it, so it
                            # only ever widened the filter on paper.
                            # "constitution" was added — without it this filter
                            # excludes the 1987 Constitution, and a codal
                            # suggestion for it was impossible to produce.
                            "document_type": [
                                "constitution",
                                "republic_act",
                                "presidential_decree",
                                "executive_order",
                                "administrative_order",
                                "rules_of_court",
                                "codal",
                            ]
                        }
                    }
                ],
            }
        },
        # `section_text` as well as `plain_text`: the keyword index stores a
        # document-level row carrying `plain_text` plus one row per section
        # carrying `section_text` and no `plain_text` at all, and the section
        # rows are the bulk of it. Requesting only `plain_text` gave most
        # candidates an empty snippet, i.e. a codal citation handed to the LLM
        # with none of the provision's actual words attached.
        "_source": ["document_id", "title", "citation_text", "plain_text", "section_text"],
    }

    try:
        result = await opensearch_search(_CODAL_INDEX, query)
        hits = result.get("hits", {}).get("hits", [])
        return [
            {
                "id": hit["_source"].get("document_id", hit["_id"]),
                "title": hit["_source"].get("title", ""),
                "citation": hit["_source"].get("citation_text", ""),
                "snippet": (
                    hit["_source"].get("plain_text")
                    or hit["_source"].get("section_text")
                    or ""
                )[:500],
                "score": hit.get("_score", 0),
            }
            for hit in hits
        ]
    except Exception:
        # Deliberate soft failure: codal candidates only enrich the LLM prompt
        # with extra context, and the suggestion pass still produces output
        # from the case text alone. This is the opt-in described in
        # shared/opensearch.opensearch_search — degrading here is a decision,
        # not a default.
        logger.warning("OpenSearch codal candidate search failed", exc_info=True)
        return []


def _format_codal_candidates(
    candidates: list[dict[str, Any]],
    codal_map: dict[str, dict[str, Any]],
) -> str:
    """Format codal candidates into a text block for the LLM prompt."""
    parts: list[str] = []
    for c in candidates:
        doc_id = c["id"]
        info = codal_map.get(doc_id, {})
        title = info.get("title") or c.get("title", "Unknown")
        citation = info.get("citation") or c.get("citation", "")
        snippet = c.get("snippet", "")

        entry = f"[CODAL {doc_id}] {title}"
        if citation:
            entry += f" | {citation}"
        if snippet:
            entry += f"\n{snippet}"
        parts.append(entry)

    return "\n---\n".join(parts)


def _parse_suggestions(
    raw: str,
    codal_map: dict[str, dict[str, Any]],
    max_suggestions: int,
) -> list[SuggestedCaseCodalLink]:
    """Parse LLM JSON output into suggestion objects."""
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("Failed to parse case-codal suggestion response as JSON")
        return []

    suggestions_raw = data.get("suggestions", [])
    if not isinstance(suggestions_raw, list):
        return []

    valid_link_types = {"interprets", "applies", "invalidates", "modifies", "upholds", "cites"}
    suggestions: list[SuggestedCaseCodalLink] = []

    for s in suggestions_raw[:max_suggestions]:
        if not isinstance(s, dict):
            continue

        codal_id = s.get("codal_document_id", "")
        link_type = s.get("link_type", "cites")
        if link_type not in valid_link_types:
            link_type = "cites"

        info = codal_map.get(codal_id, {})
        confidence = s.get("confidence", 0.5)
        if not isinstance(confidence, (int, float)):
            confidence = 0.5
        confidence = max(0.0, min(1.0, float(confidence)))

        suggestions.append(
            SuggestedCaseCodalLink(
                codal_document_id=codal_id,
                codal_title=info.get("title", "Unknown"),
                codal_citation=info.get("citation"),
                link_type=link_type,
                relevant_excerpt=s.get("relevant_excerpt", ""),
                confidence=confidence,
                reasoning=s.get("reasoning", ""),
            )
        )

    return suggestions
