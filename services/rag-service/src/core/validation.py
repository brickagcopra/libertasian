"""Citation existence check and unsupported claim detection.

Per CLAUDE.md: Output validation is NON-OPTIONAL. Every LLM response passes
through citation verification before reaching the user.
"""

from __future__ import annotations

import logging
import re
from collections.abc import Iterable
from typing import Any

from ..shared.database import fetch_documents_by_ids
from ..shared.exceptions import SchemaIntegrityError
from .schemas import CitationRef, Passage, ValidationResult

logger = logging.getLogger(__name__)

# Pattern to extract SOURCE references from LLM output
# Matches: [SOURCE uuid], [SOURCE uuid§section_uuid], (SOURCE uuid)
_SOURCE_REF_PATTERN = re.compile(
    r"[\[\(]SOURCE\s+([0-9a-f-]+)(?:§([0-9a-f-]+))?[\]\)]",
    re.IGNORECASE,
)


async def validate_citations(
    generated_text: str,
    source_passages: list[Passage],
) -> ValidationResult:
    """Validate that all citations in the generated text reference real documents.

    Steps:
    1. Extract SOURCE references from the generated text.
    2. Check each reference against the provided source passages.
    3. For references not in the passages, query PostgreSQL to verify existence.
    4. Flag unsupported claims (sentences with assertions but no citation).

    Args:
        generated_text: The LLM-generated answer text.
        source_passages: The passages that were provided as context.

    Returns:
        ValidationResult with valid/invalid citations and unsupported claims.
    """
    # 1. Extract citations from text
    extracted_refs = _extract_citations(generated_text)

    if not extracted_refs:
        # No citations at all — check if the response makes claims
        unsupported = _detect_unsupported_claims(generated_text)
        return ValidationResult(
            is_valid=len(unsupported) == 0,
            valid_citations=[],
            invalid_citations=[],
            unsupported_claims=unsupported,
            valid_count=0,
            total_count=0,
        )

    # 2. Build passage lookup
    passage_doc_ids = {p.document_id for p in source_passages}

    # 3. Separate citations into those found in passages vs needing DB check
    valid: list[CitationRef] = []
    needs_db_check: list[CitationRef] = []

    for ref in extracted_refs:
        if ref.source_id in passage_doc_ids:
            valid.append(ref.model_copy(update={"valid": True}))
        else:
            needs_db_check.append(ref)

    # 4. Verify remaining citations against PostgreSQL
    invalid: list[CitationRef] = []
    if needs_db_check:
        db_ids = [ref.source_id for ref in needs_db_check]
        try:
            db_docs = await fetch_documents_by_ids(db_ids)
            existing_ids = {str(doc["id"]) for doc in db_docs}

            for ref in needs_db_check:
                if ref.source_id in existing_ids:
                    valid.append(ref.model_copy(update={"valid": True}))
                else:
                    invalid.append(ref.model_copy(update={"valid": False}))
        except SchemaIntegrityError:
            # Schema-level bugs (missing tables/columns from raw SQL) MUST
            # surface — swallowing them is what hid the
            # ``source_authority_level`` UndefinedColumn for an unknown
            # number of /answer calls, silently marking every cited
            # authority as invalid. Re-raise so the request returns 5xx
            # and the bug becomes visible instead of degrading citations
            # to false-negatives in the background.
            logger.exception(
                "Citation validation failed with SchemaIntegrityError — "
                "failing loudly",
            )
            raise
        except Exception:
            logger.warning("Database check failed for citation validation", exc_info=True)
            # On transient DB failure, mark unverified citations as
            # invalid (safe default — pessimistic toward the citation).
            for ref in needs_db_check:
                invalid.append(ref.model_copy(update={"valid": False}))

    # 5. Detect unsupported claims
    unsupported_claims = _detect_unsupported_claims(generated_text)

    total = len(valid) + len(invalid)
    is_valid = len(invalid) == 0 and len(unsupported_claims) == 0

    return ValidationResult(
        is_valid=is_valid,
        valid_citations=valid,
        invalid_citations=invalid,
        unsupported_claims=unsupported_claims,
        valid_count=len(valid),
        total_count=total,
    )


def _extract_citations(text: str) -> list[CitationRef]:
    """Extract SOURCE references from generated text."""
    refs: list[CitationRef] = []
    seen: set[str] = set()

    for match in _SOURCE_REF_PATTERN.finditer(text):
        source_id = match.group(1)
        section_id = match.group(2)

        dedup_key = f"{source_id}:{section_id or ''}"
        if dedup_key in seen:
            continue
        seen.add(dedup_key)

        refs.append(
            CitationRef(
                source_id=source_id,
                section_id=section_id,
                text=match.group(0),
            )
        )

    return refs


def _detect_unsupported_claims(text: str) -> list[str]:
    """Detect sentences that make legal assertions without citation support.

    Heuristic: sentences containing strong assertion patterns
    ("the court held", "it is settled", "the law provides") that lack
    a [SOURCE ...] reference nearby.
    """
    assertion_patterns = [
        r"the (?:court|Supreme Court) (?:held|ruled|decided|declared)",
        r"it is (?:settled|well-settled|established|hornbook)",
        r"the law (?:provides|requires|mandates|states)",
        r"jurisprudence (?:dictates|holds|provides)",
        r"under (?:the|Philippine) law",
        r"pursuant to",
    ]

    unsupported: list[str] = []
    sentences = re.split(r"(?<=[.!?])\s+", text)

    for sentence in sentences:
        has_assertion = any(
            re.search(pattern, sentence, re.IGNORECASE)
            for pattern in assertion_patterns
        )
        has_citation = bool(_SOURCE_REF_PATTERN.search(sentence))

        if has_assertion and not has_citation:
            # Check if a citation exists in the immediately following sentence
            # (some models place citations at sentence boundaries)
            unsupported.append(sentence.strip()[:200])

    return unsupported


# ---------------------------------------------------------------------------
# Structured-output citations (memos, research workspaces)
# ---------------------------------------------------------------------------

# What `_SOURCE_REF_PATTERN` accepts as an ID. A structured citation whose
# ``source_id`` is not in this shape cannot be a document ID at all.
_WELL_FORMED_ID = re.compile(r"[0-9a-f-]+", re.IGNORECASE)


def build_citation_check_text(
    texts: Iterable[str],
    cited: Iterable[tuple[str, str | None]],
) -> tuple[str, list[str]]:
    """Render JSON-structured output into text `validate_citations` can check.

    `validate_citations` reads ``[SOURCE id§section]`` anchors out of prose.
    Memos and research workspaces return JSON, where citations are separate
    ``{source_id, section_id}`` objects the anchor pattern never sees. They are
    rendered as anchors and appended to the prose fields (which may carry
    inline anchors of their own), so both kinds go through the one check.

    Args:
        texts: The prose fields of the output.
        cited: ``(source_id, section_id)`` pairs from the structured citations.

    Returns:
        The text to validate, and the ``source_id`` values that are not
        well-formed document IDs. Those are invalid by construction: the anchor
        regex would skip them, so a fabricated ``"G.R. No. 12345"`` would
        otherwise read as "no citations" rather than as a bad one.
    """
    anchors: list[str] = []
    malformed: list[str] = []
    for source_id, section_id in cited:
        if not _WELL_FORMED_ID.fullmatch(source_id):
            malformed.append(source_id)
            continue
        if section_id and _WELL_FORMED_ID.fullmatch(section_id):
            anchors.append(f"[SOURCE {source_id}§{section_id}]")
        else:
            anchors.append(f"[SOURCE {source_id}]")
    return "\n\n".join([*texts, *anchors]), malformed


def invalid_citation_ids(
    result: ValidationResult,
    malformed: Iterable[str] = (),
) -> list[str]:
    """The distinct invalid ``source_id`` values, in first-seen order."""
    ids = [ref.source_id for ref in result.invalid_citations]
    return list(dict.fromkeys([*ids, *malformed]))


def invalid_citation_warning(ids: list[str]) -> str:
    """Human-readable warning for an output that cites unknown documents."""
    return (
        f"{len(ids)} cited source ID(s) match no retrieved passage and no known "
        f"legal document, and may be fabricated: {', '.join(ids)}"
    )
