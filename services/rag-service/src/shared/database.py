"""Async PostgreSQL connection pool and document fetch helpers."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import asyncpg

from ..config import settings
from .exceptions import SchemaIntegrityError

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


@asynccontextmanager
async def acquire_connection() -> AsyncIterator[asyncpg.Connection]:
    """Acquire a pooled connection, re-raising schema errors as
    :class:`SchemaIntegrityError`.

    Mirrors the worker-service ``db_client.get_connection`` pattern from
    PR #78. asyncpg raises ``UndefinedTableError`` / ``UndefinedColumnError``
    for code/schema drift bugs (typically PascalCase identifier left over
    from a pre-``@@map`` schema, or a phantom column referenced from a
    SELECT list). Wrapping them here at the connection layer means callers
    can't accidentally swallow schema bugs behind a generic
    ``except Exception``: ``SchemaIntegrityError`` deliberately is NOT a
    subclass of ``RagPipelineError`` so a pipeline-level catch-all still
    lets it bubble up to FastAPI's error handler.
    """
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        try:
            yield conn
        except (
            asyncpg.exceptions.UndefinedTableError,
            asyncpg.exceptions.UndefinedColumnError,
        ) as exc:
            raise SchemaIntegrityError(
                f"Schema integrity error from raw SQL: {exc}",
            ) from exc


async def fetch_documents_by_ids(
    document_ids: list[str],
) -> list[dict[str, Any]]:
    """Fetch legal document metadata from PostgreSQL by IDs.

    Used for citation validation — confirms that cited source IDs actually exist.
    """
    if not document_ids:
        return []

    # The Prisma schema has no ``source_authority_level`` column on
    # ``legal_documents`` (the prior SELECT referenced a phantom column and
    # so every citation-validation lookup raised UndefinedColumn, was
    # swallowed by a generic ``except`` in core.validation, and silently
    # marked every cited authority as invalid — masking citation existence
    # checks across every /answer call). The authority signal we *do* have
    # is ``is_official``; surface it under the same key the caller already
    # references so behaviour stays compatible if a downstream reader
    # exists.
    query = """
        SELECT id, title, citation_text, document_type, is_official
        FROM legal_documents
        WHERE id = ANY($1::uuid[])
    """
    async with acquire_connection() as conn:
        rows = await conn.fetch(query, document_ids)
    return [dict(row) for row in rows]


async def fetch_document_sections(
    document_id: str,
    section_ids: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Fetch document sections for provenance verification.

    Schema note: ``legal_document_sections`` rows reference their parent
    via ``legal_document_id`` (not ``document_id``); section identity is
    expressed via ``section_type`` + ``section_label`` + ``ordering``,
    not via ``section_number``/``heading`` (which never existed).
    """
    async with acquire_connection() as conn:
        if section_ids:
            query = """
                SELECT id, legal_document_id, section_type, section_label,
                       ordering, plain_text
                FROM legal_document_sections
                WHERE legal_document_id = $1 AND id = ANY($2::uuid[])
            """
            rows = await conn.fetch(query, document_id, section_ids)
        else:
            query = """
                SELECT id, legal_document_id, section_type, section_label,
                       ordering, plain_text
                FROM legal_document_sections
                WHERE legal_document_id = $1
                ORDER BY ordering
            """
            rows = await conn.fetch(query, document_id)

    return [dict(row) for row in rows]
