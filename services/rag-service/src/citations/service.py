"""Citation resolution service — matches unresolved citations to target documents."""

import logging
import re
from typing import Any

import asyncpg

from ..shared.database import acquire_connection
from .schemas import (
    CitationResolutionRequest,
    CitationResolutionResponse,
    CitationToResolve,
    ResolvedCitation,
)

logger = logging.getLogger(__name__)

# Canonical citation patterns for matching
_GR_PATTERN = re.compile(r"G\.R\.\s*No\.\s*([\dLl][\d\-LlSs]*)", re.IGNORECASE)
_RA_PATTERN = re.compile(r"R\.A\.\s*No\.\s*(\d+)", re.IGNORECASE)
_PD_PATTERN = re.compile(r"P\.D\.\s*No\.\s*(\d+)", re.IGNORECASE)
_EO_PATTERN = re.compile(r"E\.O\.\s*No\.\s*(\d+)", re.IGNORECASE)
_AM_PATTERN = re.compile(r"A\.M\.\s*No\.\s*([\w\-]+)", re.IGNORECASE)


async def resolve_citations(
    request: CitationResolutionRequest,
) -> CitationResolutionResponse:
    """Resolve a batch of citations for a document.

    For each unresolved citation, attempt to match it to a legal document in the
    corpus by GR number, citation text, or normalized citation.
    """
    results: list[ResolvedCitation] = []
    resolved_count = 0

    # Route through ``acquire_connection`` (shared/database.py) so any
    # ``UndefinedTableError`` / ``UndefinedColumnError`` from psycopg2 is
    # re-raised as ``SchemaIntegrityError`` and surfaces to the FastAPI
    # error handler instead of being swallowed by a downstream
    # generic-Exception catch.
    async with acquire_connection() as conn:
        for citation in request.citations:
            result = await _resolve_single_citation(conn, citation)
            results.append(result)
            if result.resolved:
                resolved_count += 1

    return CitationResolutionResponse(
        document_id=request.document_id,
        total_citations=len(request.citations),
        resolved_count=resolved_count,
        unresolved_count=len(request.citations) - resolved_count,
        results=results,
    )


async def _resolve_single_citation(
    conn: asyncpg.Connection,
    citation: CitationToResolve,
) -> ResolvedCitation:
    """Try to resolve a single citation to a target document."""
    text = citation.normalized_citation or citation.citation_text

    # Strategy 1: Match by G.R. number
    gr_match = _GR_PATTERN.search(text)
    if gr_match:
        gr_no = f"G.R. No. {gr_match.group(1).strip()}"
        doc = await _find_by_gr_no(conn, gr_no)
        if doc:
            return ResolvedCitation(
                citation_id=citation.id,
                to_document_id=str(doc["id"]),
                confidence=0.95,
                resolver_method="gr_number_exact",
                resolved=True,
            )

    # Strategy 2: Match by exact citation text
    doc = await _find_by_citation_text(conn, text)
    if doc:
        return ResolvedCitation(
            citation_id=citation.id,
            to_document_id=str(doc["id"]),
            confidence=0.90,
            resolver_method="citation_text_exact",
            resolved=True,
        )

    # Strategy 3: Match by normalized citation (partial match)
    if citation.normalized_citation:
        doc = await _find_by_citation_partial(conn, citation.normalized_citation)
        if doc:
            return ResolvedCitation(
                citation_id=citation.id,
                to_document_id=str(doc["id"]),
                confidence=0.80,
                resolver_method="citation_text_partial",
                resolved=True,
            )

    # Strategy 4: Match RA/PD/EO/AM numbers
    doc = await _find_by_statute_number(conn, text)
    if doc:
        return ResolvedCitation(
            citation_id=citation.id,
            to_document_id=str(doc["id"]),
            confidence=0.85,
            resolver_method="statute_number",
            resolved=True,
        )

    # Strategy 5: Title-based fuzzy match (case title in citation text)
    doc = await _find_by_title_match(conn, citation.citation_text)
    if doc:
        return ResolvedCitation(
            citation_id=citation.id,
            to_document_id=str(doc["id"]),
            confidence=0.70,
            resolver_method="title_match",
            resolved=True,
        )

    # Unresolved
    return ResolvedCitation(
        citation_id=citation.id,
        to_document_id=None,
        confidence=0.0,
        resolver_method="unresolved",
        resolved=False,
    )


async def _find_by_gr_no(
    conn: asyncpg.Connection,
    gr_no: str,
) -> asyncpg.Record | None:
    """Find a legal document by exact G.R. number."""
    return await conn.fetchrow(
        """SELECT id FROM legal_documents
           WHERE gr_no = $1
           AND status = 'published'
           LIMIT 1""",
        gr_no,
    )


async def _find_by_citation_text(
    conn: asyncpg.Connection,
    citation_text: str,
) -> asyncpg.Record | None:
    """Find a legal document by exact citation text match."""
    return await conn.fetchrow(
        """SELECT id FROM legal_documents
           WHERE citation_text = $1
           AND status = 'published'
           LIMIT 1""",
        citation_text,
    )


async def _find_by_citation_partial(
    conn: asyncpg.Connection,
    normalized: str,
) -> asyncpg.Record | None:
    """Find a legal document by partial citation match."""
    # Use ILIKE for case-insensitive partial matching
    return await conn.fetchrow(
        """SELECT id FROM legal_documents
           WHERE citation_text ILIKE $1
           AND status = 'published'
           LIMIT 1""",
        f"%{normalized}%",
    )


async def _find_by_statute_number(
    conn: asyncpg.Connection,
    text: str,
) -> asyncpg.Record | None:
    """Find a statute/law by RA/PD/EO/AM number."""
    for pattern, prefix in [
        (_RA_PATTERN, "R.A. No."),
        (_PD_PATTERN, "P.D. No."),
        (_EO_PATTERN, "E.O. No."),
        (_AM_PATTERN, "A.M. No."),
    ]:
        m = pattern.search(text)
        if m:
            number = m.group(1).strip()
            search_text = f"{prefix} {number}"
            doc = await conn.fetchrow(
                """SELECT id FROM legal_documents
                   WHERE citation_text ILIKE $1
                   AND status = 'published'
                   LIMIT 1""",
                f"%{search_text}%",
            )
            if doc:
                return doc
    return None


async def _find_by_title_match(
    conn: asyncpg.Connection,
    citation_text: str,
) -> asyncpg.Record | None:
    """Find a legal document by title similarity.

    Extracts case name pattern (X vs. Y or X v. Y) and searches by title.
    """
    # Try to extract a "v." or "vs." party name pattern
    vs_pattern = re.compile(
        r"([A-Z][A-Za-z.\s]+)\s+(?:v\.|vs\.?)\s+([A-Z][A-Za-z.\s]+)",
    )
    m = vs_pattern.search(citation_text)
    if not m:
        return None

    party1 = m.group(1).strip()
    party2 = m.group(2).strip()

    # Search for both party names in title
    return await conn.fetchrow(
        """SELECT id FROM legal_documents
           WHERE title ILIKE $1
           AND title ILIKE $2
           AND document_type = 'case'
           AND status = 'published'
           LIMIT 1""",
        f"%{party1}%",
        f"%{party2}%",
    )
