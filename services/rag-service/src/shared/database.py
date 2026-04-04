"""Async PostgreSQL connection pool and document fetch helpers."""

from __future__ import annotations

import logging
from typing import Any

import asyncpg

from ..config import settings

logger = logging.getLogger(__name__)

_pool: asyncpg.Pool | None = None  # type: ignore[type-arg]


async def get_db_pool() -> asyncpg.Pool:  # type: ignore[type-arg]
    """Return a shared asyncpg connection pool, creating it on first call."""
    global _pool  # noqa: PLW0603
    if _pool is None:
        _pool = await asyncpg.create_pool(
            dsn=settings.database_url,
            min_size=2,
            max_size=10,
        )
    return _pool


async def close_db_pool() -> None:
    """Close the shared database pool."""
    global _pool  # noqa: PLW0603
    if _pool is not None:
        await _pool.close()
        _pool = None


async def fetch_documents_by_ids(
    document_ids: list[str],
) -> list[dict[str, Any]]:
    """Fetch legal document metadata from PostgreSQL by IDs.

    Used for citation validation — confirms that cited source IDs actually exist.
    """
    if not document_ids:
        return []

    pool = await get_db_pool()
    query = """
        SELECT id, title, citation_text, document_type, source_authority_level
        FROM legal_documents
        WHERE id = ANY($1::uuid[])
    """
    rows = await pool.fetch(query, document_ids)
    return [dict(row) for row in rows]


async def fetch_document_sections(
    document_id: str,
    section_ids: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Fetch document sections for provenance verification."""
    pool = await get_db_pool()

    if section_ids:
        query = """
            SELECT id, document_id, section_number, heading, plain_text
            FROM legal_document_sections
            WHERE document_id = $1 AND id = ANY($2::uuid[])
        """
        rows = await pool.fetch(query, document_id, section_ids)
    else:
        query = """
            SELECT id, document_id, section_number, heading, plain_text
            FROM legal_document_sections
            WHERE document_id = $1
            ORDER BY section_number
        """
        rows = await pool.fetch(query, document_id)

    return [dict(row) for row in rows]
