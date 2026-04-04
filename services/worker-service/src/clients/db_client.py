"""LIBERTASIAN Worker Service — PostgreSQL client for Celery tasks.

Uses psycopg2 (sync) for database updates from Celery workers.
Per CLAUDE.md: Python services can read/write their own tables but
Prisma owns schema migrations.
"""

import json
import logging
from contextlib import contextmanager
from typing import Any, Generator

import psycopg2
import psycopg2.extras

from ..config import settings

logger = logging.getLogger(__name__)


@contextmanager
def get_connection() -> Generator[Any, None, None]:
    """Get a database connection with auto-commit and cleanup."""
    conn = psycopg2.connect(settings.database_url)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def update_upload_ocr_status(
    upload_id: str,
    ocr_status: str,
) -> None:
    """Update the OCR status of a UserUpload."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                'UPDATE "UserUpload" SET "ocrStatus" = %s, "updatedAt" = NOW() WHERE id = %s',
                (ocr_status, upload_id),
            )
    logger.info("Updated upload %s ocrStatus=%s", upload_id, ocr_status)


def update_upload_processing_status(
    upload_id: str,
    processing_status: str,
) -> None:
    """Update the processing status of a UserUpload."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                'UPDATE "UserUpload" SET "processingStatus" = %s, "updatedAt" = NOW() WHERE id = %s',
                (processing_status, upload_id),
            )
    logger.info("Updated upload %s processingStatus=%s", upload_id, processing_status)


def update_upload_classification(
    upload_id: str,
    document_type: str,
    citations_json: dict[str, Any],
    ocr_text_object_key: str | None = None,
) -> None:
    """Update classification results on a UserUpload."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """UPDATE "UserUpload"
                   SET "classifiedDocumentType" = %s,
                       "extractedCitationsJson" = %s,
                       "ocrTextObjectKey" = COALESCE(%s, "ocrTextObjectKey"),
                       "updatedAt" = NOW()
                   WHERE id = %s""",
                (document_type, json.dumps(citations_json), ocr_text_object_key, upload_id),
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
    """Create an OcrResult record and return its ID."""
    import uuid

    result_id = str(uuid.uuid4())
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO "OcrResult"
                   (id, "userUploadId", "pageNumber", "qualityScore", "ocrConfidence",
                    "languageDetected", "extractedTextObjectKey", "wordCount", "createdAt")
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
    logger.info("Created OcrResult %s for upload %s page %d", result_id, upload_id, page_number)
    return result_id


def update_camera_capture_quality(
    upload_id: str,
    quality_score: float,
) -> None:
    """Update the quality score on the CameraCapture linked to this upload."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """UPDATE "CameraCapture"
                   SET "captureQualityScore" = %s
                   WHERE "userUploadId" = %s""",
                (quality_score, upload_id),
            )
    logger.info("Updated CameraCapture quality=%s for upload %s", quality_score, upload_id)


def update_processing_job(
    upload_id: str,
    job_type: str,
    status: str,
    error_message: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    """Update the status of an UploadProcessingJob."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """UPDATE "UploadProcessingJob"
                   SET status = %s,
                       "errorMessage" = %s,
                       metadata = COALESCE(%s::jsonb, metadata),
                       attempts = attempts + 1,
                       "updatedAt" = NOW()
                   WHERE "userUploadId" = %s AND "jobType" = %s""",
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
    """Get the S3 object key for an upload."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                'SELECT "objectKey" FROM "UserUpload" WHERE id = %s',
                (upload_id,),
            )
            row = cur.fetchone()
            return row[0] if row else None


# ─── Phase 5 Batch 7: Doctrine & Citation DB operations ───


def get_document_sections(document_id: str) -> list[dict[str, Any]]:
    """Fetch all sections for a legal document."""
    with get_connection() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """SELECT id, "sectionType" as section_type, "sectionLabel" as section_label,
                          "plainText" as plain_text, "pageStart" as page_start,
                          "pageEnd" as page_end, ordering
                   FROM "LegalDocumentSection"
                   WHERE "legalDocumentId" = %s
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
    """Create a DoctrineExtract record and return its ID."""
    import uuid as uuid_mod

    doctrine_id = str(uuid_mod.uuid4())
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO "DoctrineExtract"
                   (id, "legalDocumentId", text, "normalizedText", "doctrineType",
                    "sourceSectionId", confidence, "reviewStatus", "createdAt", "updatedAt")
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
        "Created DoctrineExtract %s for document %s type=%s confidence=%.2f",
        doctrine_id,
        legal_document_id,
        doctrine_type,
        confidence,
    )
    return doctrine_id


def get_unresolved_citations(document_id: str) -> list[dict[str, Any]]:
    """Fetch unresolved citations for a document (toDocumentId IS NULL)."""
    with get_connection() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """SELECT id, "citationText" as citation_text,
                          "normalizedCitation" as normalized_citation,
                          "citationType" as citation_type,
                          "fromDocumentId" as from_document_id
                   FROM "Citation"
                   WHERE "fromDocumentId" = %s
                   AND "toDocumentId" IS NULL
                   ORDER BY "createdAt" ASC""",
                (document_id,),
            )
            return [dict(row) for row in cur.fetchall()]


def update_citation_resolution(
    citation_id: str,
    to_document_id: str,
    confidence: float,
    resolver_method: str,
) -> None:
    """Update a Citation record with the resolved target document."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """UPDATE "Citation"
                   SET "toDocumentId" = %s,
                       confidence = %s,
                       "resolvedAt" = NOW(),
                       "resolverMethod" = %s
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
    """Create a ModelRun audit record and return its ID."""
    import uuid as uuid_mod

    run_id = str(uuid_mod.uuid4())
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO "ModelRun"
                   (id, "runType", "modelName", "modelVersion", "promptTemplateVersion",
                    "inputRef", "outputRef", confidence, "tokensIn", "tokensOut",
                    "latencyMs", "createdAt")
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())""",
                (
                    run_id,
                    run_type,
                    model_name,
                    model_name,  # modelVersion same as modelName for now
                    prompt_template_version,
                    input_ref,
                    output_ref,
                    confidence,
                    tokens_in,
                    tokens_out,
                    latency_ms,
                ),
            )
    logger.info("Created ModelRun %s type=%s model=%s", run_id, run_type, model_name)
    return run_id


# ─── Embedding DB operations ──────────────────────────────────────────


def get_existing_embedding_ids(
    entity_type: str,
    entity_ids: list[str],
) -> set[str]:
    """Return the set of entity_ids that already have embeddings."""
    if not entity_ids:
        return set()

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT DISTINCT entity_id
                   FROM embeddings
                   WHERE entity_type = %s
                   AND entity_id = ANY(%s)""",
                (entity_type, entity_ids),
            )
            return {row[0] for row in cur.fetchall()}


def create_embedding(
    entity_type: str,
    entity_id: str,
    embedding_model: str,
    vector_ref: str,
) -> str:
    """Insert a row into the embeddings table. Returns the new ID.

    Args:
        entity_type: 'document' or 'section'.
        entity_id: UUID of the legal document or section.
        embedding_model: Model name used to generate the embedding.
        vector_ref: JSON-serialized embedding vector string.
    """
    import uuid as uuid_mod

    embedding_id = str(uuid_mod.uuid4())
    with get_connection() as conn:
        with conn.cursor() as cur:
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
        "Created embedding %s for %s/%s model=%s",
        embedding_id,
        entity_type,
        entity_id,
        embedding_model,
    )
    return embedding_id


def create_embeddings_batch(
    records: list[dict[str, Any]],
) -> list[str]:
    """Batch insert embedding rows. Returns list of new IDs.

    Each record must have: entity_type, entity_id, embedding_model, vector_ref.
    """
    import uuid as uuid_mod

    if not records:
        return []

    ids: list[str] = []
    with get_connection() as conn:
        with conn.cursor() as cur:
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
