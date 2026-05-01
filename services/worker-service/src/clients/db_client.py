"""LIBERTASIAN Worker Service — PostgreSQL client for Celery tasks.

Uses psycopg2 (sync) for database updates from Celery workers.
Per CLAUDE.md: Python services can read/write their own tables but
Prisma owns schema migrations. All table/column names are snake_case
in PostgreSQL via Prisma ``@@map``/``@map`` directives — never quote
PascalCase identifiers in raw SQL here.
"""

import json
import logging
import uuid as uuid_mod
from collections.abc import Generator
from contextlib import contextmanager
from typing import Any

import psycopg2
import psycopg2.errors
import psycopg2.extras

from ..config import settings

logger = logging.getLogger(__name__)


class SchemaIntegrityError(RuntimeError):
    """Raised when raw SQL references a table or column that does not exist.

    This indicates a code/schema drift bug (e.g. PascalCase identifier left
    over from a pre-``@@map`` schema). Tasks MUST NOT swallow this error —
    it has to surface to the DLQ so the bug stays visible. A "non-blocking,
    document ingestion continues" log line for this class of failure is how
    the original PascalCase regression hid in production for days while
    1421 documents were ingested without citations / doctrines / embeddings.
    """


@contextmanager
def get_connection() -> Generator[Any, None, None]:
    """Yield a database connection, committing on success and rolling back on
    error.

    Re-raises ``UndefinedTable`` / ``UndefinedColumn`` as
    :class:`SchemaIntegrityError` so callers can distinguish hard schema
    bugs from transient errors and refuse to swallow them.
    """
    conn = psycopg2.connect(settings.database_url)
    try:
        yield conn
        conn.commit()
    except (
        psycopg2.errors.UndefinedTable,
        psycopg2.errors.UndefinedColumn,
    ) as exc:
        conn.rollback()
        raise SchemaIntegrityError(
            f"Schema integrity error from raw SQL: {exc}",
        ) from exc
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


@contextmanager
def get_read_connection() -> Generator[Any, None, None]:
    """Yield a read-only database connection routed at the replica DSN.

    Falls back to ``settings.database_url`` when no replica is configured
    so dev / single-node deployments still function. Read-heavy backfills
    SHOULD use this rather than ``get_connection`` to avoid loading the
    primary with long-running scans.
    """
    dsn = settings.database_read_replica_url or settings.database_url
    conn = psycopg2.connect(dsn)
    try:
        conn.set_session(readonly=True)
        yield conn
    except (
        psycopg2.errors.UndefinedTable,
        psycopg2.errors.UndefinedColumn,
    ) as exc:
        raise SchemaIntegrityError(
            f"Schema integrity error from raw SQL: {exc}",
        ) from exc
    finally:
        conn.close()


def update_upload_ocr_status(
    upload_id: str,
    ocr_status: str,
) -> None:
    """Update the ``ocr_status`` of a row in ``user_uploads``.

    ``user_uploads`` has no ``updated_at`` column (see Prisma schema), so
    only ``ocr_status`` is touched.
    """
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE user_uploads SET ocr_status = %s WHERE id = %s",
            (ocr_status, upload_id),
        )
    logger.info("Updated upload %s ocr_status=%s", upload_id, ocr_status)


def update_upload_processing_status(
    upload_id: str,
    processing_status: str,
) -> None:
    """Update the ``processing_status`` of a row in ``user_uploads``."""
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE user_uploads SET processing_status = %s WHERE id = %s",
            (processing_status, upload_id),
        )
    logger.info(
        "Updated upload %s processing_status=%s", upload_id, processing_status,
    )


def update_upload_classification(
    upload_id: str,
    document_type: str,
    citations_json: dict[str, Any],
    ocr_text_object_key: str | None = None,
) -> None:
    """Update classification fields on a row in ``user_uploads``."""
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """UPDATE user_uploads
                   SET classified_document_type = %s,
                       extracted_citations_json = %s,
                       ocr_text_object_key = COALESCE(
                           %s, ocr_text_object_key
                       )
                   WHERE id = %s""",
            (
                document_type,
                json.dumps(citations_json),
                ocr_text_object_key,
                upload_id,
            ),
        )
    logger.info("Updated upload %s classification=%s", upload_id, document_type)


def create_ocr_result(
    upload_id: str,
    page_number: int,
    quality_score: float | None,
    ocr_confidence: float | None,
    language_detected: str | None,
    extracted_text_object_key: str,
    word_count: int | None,
) -> str:
    """Insert a row into ``ocr_results`` and return its id."""
    result_id = str(uuid_mod.uuid4())
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO ocr_results
                   (id, user_upload_id, page_number, quality_score,
                    ocr_confidence, language_detected,
                    extracted_text_object_key, word_count, created_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NOW())""",
            (
                result_id,
                upload_id,
                page_number,
                quality_score,
                ocr_confidence,
                language_detected,
                extracted_text_object_key,
                word_count,
            ),
        )
    logger.info(
        "Created ocr_results %s for upload %s page %d",
        result_id, upload_id, page_number,
    )
    return result_id


def update_camera_capture_quality(
    upload_id: str,
    quality_score: float,
) -> None:
    """Update ``capture_quality_score`` on the matching ``camera_captures``
    row.
    """
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """UPDATE camera_captures
                   SET capture_quality_score = %s
                   WHERE user_upload_id = %s""",
            (quality_score, upload_id),
        )
    logger.info(
        "Updated camera_captures quality=%s for upload %s",
        quality_score, upload_id,
    )


def update_processing_job(
    upload_id: str,
    job_type: str,
    status: str,
    error_message: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    """Update an ``upload_processing_jobs`` row by ``(user_upload_id,
    job_type)``.
    """
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """UPDATE upload_processing_jobs
                   SET status = %s,
                       error_message = %s,
                       metadata = COALESCE(%s::jsonb, metadata),
                       attempts = attempts + 1,
                       updated_at = NOW()
                   WHERE user_upload_id = %s AND job_type = %s""",
            (
                status,
                error_message,
                json.dumps(metadata) if metadata else None,
                upload_id,
                job_type,
            ),
        )
    logger.info("Updated job %s/%s status=%s", upload_id, job_type, status)


def get_upload_object_key(upload_id: str) -> str | None:
    """Return the ``object_key`` for a ``user_uploads`` row, or ``None``."""
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT object_key FROM user_uploads WHERE id = %s",
            (upload_id,),
        )
        row = cur.fetchone()
        return row[0] if row else None


# ─── Phase 5 Batch 7: Doctrine & Citation DB operations ───


def get_document_sections(document_id: str) -> list[dict[str, Any]]:
    """Fetch all ``legal_document_sections`` rows for a document."""
    with get_connection() as conn, \
            conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT id, section_type, section_label,
                      plain_text, page_start, page_end, ordering
               FROM legal_document_sections
               WHERE legal_document_id = %s
               ORDER BY ordering ASC""",
            (document_id,),
        )
        return [dict(row) for row in cur.fetchall()]


def create_doctrine_extract(
    legal_document_id: str,
    text: str,
    normalized_text: str | None,
    doctrine_type: str,
    source_section_id: str | None,
    confidence: float,
    review_status: str,
) -> str:
    """Insert a row into ``doctrine_extracts`` and return its id."""
    doctrine_id = str(uuid_mod.uuid4())
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO doctrine_extracts
                   (id, legal_document_id, text, normalized_text,
                    doctrine_type, source_section_id, confidence,
                    review_status, created_at, updated_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW())""",
            (
                doctrine_id,
                legal_document_id,
                text,
                normalized_text,
                doctrine_type,
                source_section_id,
                confidence,
                review_status,
            ),
        )
    logger.info(
        "Created doctrine_extracts %s for document %s type=%s confidence=%.2f",
        doctrine_id,
        legal_document_id,
        doctrine_type,
        confidence,
    )
    return doctrine_id


def get_unresolved_citations(document_id: str) -> list[dict[str, Any]]:
    """Fetch unresolved ``citations`` rows for a document
    (``to_document_id IS NULL``).
    """
    with get_connection() as conn, \
            conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT id, citation_text, normalized_citation,
                      citation_type, from_document_id
               FROM citations
               WHERE from_document_id = %s
                 AND to_document_id IS NULL
               ORDER BY created_at ASC""",
            (document_id,),
        )
        return [dict(row) for row in cur.fetchall()]


def update_citation_resolution(
    citation_id: str,
    to_document_id: str,
    confidence: float,
    resolver_method: str,
) -> None:
    """Update a ``citations`` row with the resolved target document."""
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """UPDATE citations
                   SET to_document_id = %s,
                       confidence = %s,
                       resolved_at = NOW(),
                       resolver_method = %s
                   WHERE id = %s""",
            (to_document_id, confidence, resolver_method, citation_id),
        )
    logger.info(
        "Resolved citation %s -> document %s (method=%s, confidence=%.2f)",
        citation_id,
        to_document_id,
        resolver_method,
        confidence,
    )


def create_model_run(
    run_type: str,
    model_name: str,
    prompt_template_version: str,
    input_ref: str | None,
    output_ref: str | None,
    confidence: float | None,
    tokens_in: int | None = None,
    tokens_out: int | None = None,
    latency_ms: int | None = None,
) -> str:
    """Insert a row into ``model_runs`` and return its id."""
    run_id = str(uuid_mod.uuid4())
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO model_runs
                   (id, run_type, model_name, model_version,
                    prompt_template_version, input_ref, output_ref,
                    confidence, tokens_in, tokens_out, latency_ms,
                    created_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())""",
            (
                run_id,
                run_type,
                model_name,
                model_name,  # model_version mirrors model_name for now
                prompt_template_version,
                input_ref,
                output_ref,
                confidence,
                tokens_in,
                tokens_out,
                latency_ms,
            ),
        )
    logger.info("Created model_runs %s type=%s model=%s", run_id, run_type, model_name)
    return run_id


# ─── Embedding DB operations ──────────────────────────────────────────


def get_existing_embedding_ids(
    entity_type: str,
    entity_ids: list[str],
) -> set[str]:
    """Return the subset of ``entity_ids`` that already have embeddings."""
    if not entity_ids:
        return set()

    with get_connection() as conn, conn.cursor() as cur:
        # ``embeddings.entity_id`` is ``uuid``; psycopg2 binds a Python
        # ``list[str]`` as ``text[]``, so without an explicit cast PG sees
        # ``uuid = ANY(text[])`` and refuses with
        # ``operator does not exist: uuid = text``. Casting at the SQL
        # layer keeps callers from having to know about pg's strict typing.
        cur.execute(
            """SELECT DISTINCT entity_id
               FROM embeddings
               WHERE entity_type = %s
                 AND entity_id = ANY(%s::uuid[])""",
            (entity_type, entity_ids),
        )
        return {str(row[0]) for row in cur.fetchall()}


def create_embedding(
    entity_type: str,
    entity_id: str,
    embedding_model: str,
    vector_ref: str,
) -> str:
    """Insert a row into ``embeddings`` and return its id.

    Args:
        entity_type: ``'document'`` or ``'section'``.
        entity_id: UUID of the legal document or section.
        embedding_model: Model name used to generate the embedding.
        vector_ref: JSON-serialized embedding vector string.
    """
    embedding_id = str(uuid_mod.uuid4())
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO embeddings
                   (id, entity_type, entity_id, embedding_model,
                    vector_ref, created_at)
                   VALUES (%s, %s, %s, %s, %s, NOW())""",
            (
                embedding_id,
                entity_type,
                entity_id,
                embedding_model,
                vector_ref,
            ),
        )
    logger.info(
        "Created embeddings %s for %s/%s model=%s",
        embedding_id,
        entity_type,
        entity_id,
        embedding_model,
    )
    return embedding_id


def create_embeddings_batch(
    records: list[dict[str, Any]],
) -> list[str]:
    """Batch insert rows into ``embeddings``. Returns the new ids.

    Each record must have: ``entity_type``, ``entity_id``,
    ``embedding_model``, ``vector_ref``.
    """
    if not records:
        return []

    ids: list[str] = []
    with get_connection() as conn, conn.cursor() as cur:
        for record in records:
            embedding_id = str(uuid_mod.uuid4())
            ids.append(embedding_id)
            cur.execute(
                """INSERT INTO embeddings
                       (id, entity_type, entity_id, embedding_model,
                        vector_ref, created_at)
                       VALUES (%s, %s, %s, %s, %s, NOW())""",
                (
                    embedding_id,
                    record["entity_type"],
                    record["entity_id"],
                    record["embedding_model"],
                    record["vector_ref"],
                ),
            )
    logger.info("Created %d embedding records", len(ids))
    return ids
