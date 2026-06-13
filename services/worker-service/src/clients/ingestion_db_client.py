"""LIBERTASIAN Worker Service — PostgreSQL client for ingestion pipeline.

Database operations for the ingestion pipeline tables:
ingestion_jobs, ingestion_candidates, legal_documents,
legal_document_versions, legal_document_sections, sources, source_endpoints.

Per CLAUDE.md: Python services read/write their own tables but Prisma owns
schema migrations. All table/column names use snake_case via Prisma @@map/@map.
"""

import json
import logging
from typing import Any

import psycopg2.extras

from .db_client import get_connection

logger = logging.getLogger(__name__)


# ─── Read Operations ─────────────────────────────────────────────────────


def get_pending_ingestion_jobs(limit: int = 10) -> list[dict[str, Any]]:
    """Fetch pending ingestion jobs ordered by creation (oldest first).

    Backfill-triggered jobs are excluded. Backfill work now flows through
    ``process_ingestion_candidate`` dispatched directly by the tick
    (see ``backfill_tasks._tick_single_batch``); any residual
    ``trigger_type='backfill'`` rows are wedged leftovers from the pre-fix
    run and must not be resurrected by the poller.
    """
    with get_connection() as conn, \
            conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT id, source_id, source_endpoint_id, job_type, status
               FROM ingestion_jobs
               WHERE status = 'pending'
                 AND trigger_type != 'backfill'
               ORDER BY id ASC
               LIMIT %s""",
            (limit,),
        )
        return [dict(row) for row in cur.fetchall()]


def get_source_with_endpoints(source_id: str) -> dict[str, Any] | None:
    """Fetch a source and its active endpoints."""
    with get_connection() as conn, \
            conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT id, name, type, domain, trust_level, enabled, fetch_strategy
               FROM sources
               WHERE id = %s""",
            (source_id,),
        )
        source = cur.fetchone()
        if not source:
            return None

        result = dict(source)

        cur.execute(
            """SELECT id, endpoint_url, content_type_hint, parser_type,
                      last_fetched_at, last_success_at, status
               FROM source_endpoints
               WHERE source_id = %s AND status = 'active'
               ORDER BY id ASC""",
            (source_id,),
        )
        result["endpoints"] = [dict(row) for row in cur.fetchall()]
        return result


def find_candidate_by_similarity_key(
    source_id: str,
    similarity_key: str,
) -> dict[str, Any] | None:
    """Find an existing ingestion candidate by similarity key for dedup."""
    with get_connection() as conn, \
            conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT id, status, detected_url
               FROM ingestion_candidates
               WHERE source_id = %s AND similarity_key = %s
               LIMIT 1""",
            (source_id, similarity_key),
        )
        row = cur.fetchone()
        return dict(row) if row else None


def find_document_by_checksum(checksum: str) -> dict[str, Any] | None:
    """Find an existing legal document by content checksum."""
    with get_connection() as conn, \
            conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT id, title, gr_no, source_id
               FROM legal_documents
               WHERE checksum = %s
               LIMIT 1""",
            (checksum,),
        )
        row = cur.fetchone()
        return dict(row) if row else None


def find_document_by_gr_no(
    gr_no: str,
    source_id: str,
) -> dict[str, Any] | None:
    """Find an existing legal document by GR number and source for update detection."""
    with get_connection() as conn, \
            conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """SELECT id, title, checksum, version_no
                   FROM legal_documents
                   WHERE gr_no = %s AND source_id = %s
                   LIMIT 1""",
                (gr_no, source_id),
            )
            row = cur.fetchone()
            return dict(row) if row else None


# ─── Write Operations ────────────────────────────────────────────────────


def claim_ingestion_job(job_id: str) -> bool:
    """Atomically claim a pending job by setting status to 'running'.

    Returns True if the job was claimed (was still pending), False otherwise.
    Uses optimistic locking via WHERE status='pending'.
    """
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """UPDATE ingestion_jobs
                   SET status = 'running', started_at = NOW()
                   WHERE id = %s AND status = 'pending'""",
            (job_id,),
        )
        claimed = bool(cur.rowcount > 0)
    if claimed:
        logger.info("Claimed ingestion job %s", job_id)
    else:
        logger.warning("Failed to claim ingestion job %s (already claimed?)", job_id)
    return claimed


def complete_ingestion_job(
    job_id: str,
    records_found: int,
    records_created: int,
    records_updated: int,
) -> None:
    """Mark an ingestion job as completed with result counters."""
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """UPDATE ingestion_jobs
                   SET status = 'completed',
                       finished_at = NOW(),
                       records_found = %s,
                       records_created = %s,
                       records_updated = %s
                   WHERE id = %s""",
            (records_found, records_created, records_updated, job_id),
        )
    logger.info(
        "Completed ingestion job %s: found=%d created=%d updated=%d",
        job_id,
        records_found,
        records_created,
        records_updated,
    )


def fail_ingestion_job(
    job_id: str,
    errors: list[dict[str, Any]],
) -> None:
    """Mark an ingestion job as failed with error details."""
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """UPDATE ingestion_jobs
                   SET status = 'failed',
                       finished_at = NOW(),
                       errors_json = %s::jsonb
                   WHERE id = %s""",
            (json.dumps(errors), job_id),
        )
    logger.error("Failed ingestion job %s: %d errors", job_id, len(errors))


def create_ingestion_candidate(
    source_id: str,
    detected_url: str | None,
    detected_title: str | None,
    detected_document_type: str | None,
    similarity_key: str | None,
) -> str:
    """Create an ingestion candidate record. Returns the new ID."""
    import uuid

    candidate_id = str(uuid.uuid4())
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO ingestion_candidates
                   (id, source_id, detected_url, detected_title,
                    detected_document_type, similarity_key, status, created_at)
                   VALUES (%s, %s, %s, %s, %s, %s, 'new', NOW())""",
            (
                candidate_id,
                source_id,
                detected_url,
                detected_title,
                detected_document_type,
                similarity_key,
            ),
        )
    logger.info("Created ingestion candidate %s for source %s", candidate_id, source_id)
    return candidate_id


def update_candidate_status(candidate_id: str, status: str) -> None:
    """Update the status of an ingestion candidate."""
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE ingestion_candidates SET status = %s WHERE id = %s",
            (status, candidate_id),
        )
    logger.info("Updated candidate %s status=%s", candidate_id, status)


def create_legal_document(
    source_id: str,
    title: str,
    document_type: str,
    canonical_url: str | None = None,
    external_id: str | None = None,
    gr_no: str | None = None,
    docket_no: str | None = None,
    citation_text: str | None = None,
    decision_date: str | None = None,
    promulgation_date: str | None = None,
    ponente: str | None = None,
    court: str | None = None,
    checksum: str | None = None,
    is_official: bool = False,
) -> str:
    """Create a legal document record (status='draft', truthfulness='needs_review').

    Per plan: new documents start unpublished and need admin review.
    Returns the new document ID.
    """
    import uuid

    doc_id = str(uuid.uuid4())
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO legal_documents
                   (id, source_id, title, document_type, canonical_url, external_id,
                    gr_no, docket_no, citation_text, decision_date, promulgation_date,
                    ponente, court, checksum, jurisdiction, status, language,
                    version_no, is_official, is_published, truthfulness_status,
                    created_at, updated_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                           'PH', 'draft', 'en', 1, %s, false, 'needs_review',
                           NOW(), NOW())""",
            (
                doc_id,
                source_id,
                title,
                document_type,
                canonical_url,
                external_id,
                gr_no,
                docket_no,
                citation_text,
                decision_date,
                promulgation_date,
                ponente,
                court,
                checksum,
                is_official,
            ),
        )
    logger.info("Created legal document %s: %s", doc_id, title[:80])
    return doc_id


def create_legal_document_version(
    legal_document_id: str,
    snapshot_hash: str,
    raw_file_object_key: str | None = None,
    normalized_text_object_key: str | None = None,
    html_object_key: str | None = None,
    extracted_json: dict[str, Any] | None = None,
    parser_version: str | None = None,
) -> str:
    """Create a new version row for a legal document. Never overwrites existing versions.

    Per CLAUDE.md: updated documents create new version rows.
    Returns the new version ID.
    """
    import uuid

    version_id = str(uuid.uuid4())
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO legal_document_versions
                   (id, legal_document_id, raw_file_object_key,
                    normalized_text_object_key, html_object_key,
                    extracted_json, snapshot_hash, parser_version, created_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NOW())""",
            (
                version_id,
                legal_document_id,
                raw_file_object_key,
                normalized_text_object_key,
                html_object_key,
                json.dumps(extracted_json) if extracted_json else None,
                snapshot_hash,
                parser_version,
            ),
        )
    logger.info("Created version %s for document %s", version_id, legal_document_id)
    return version_id


def create_legal_document_sections(
    legal_document_id: str,
    sections: list[dict[str, Any]],
) -> list[str]:
    """Batch insert legal document sections. Returns list of new section IDs."""
    import uuid

    section_ids: list[str] = []
    if not sections:
        return section_ids

    with get_connection() as conn, conn.cursor() as cur:
        for idx, section in enumerate(sections):
            section_id = str(uuid.uuid4())
            section_ids.append(section_id)
            cur.execute(
                """INSERT INTO legal_document_sections
                       (id, legal_document_id, section_type, section_label,
                        ordering, plain_text, html_text, page_start, page_end,
                        token_count, created_at)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())""",
                (
                    section_id,
                    legal_document_id,
                    section.get("section_type", "body"),
                    section.get("section_label"),
                    section.get("ordering", idx),
                    section.get("plain_text"),
                    section.get("html_text"),
                    section.get("page_start"),
                    section.get("page_end"),
                    section.get("token_count"),
                ),
            )
    logger.info(
        "Created %d sections for document %s",
        len(section_ids),
        legal_document_id,
    )
    return section_ids


# ─── Validation / Auto-Publish Read Operations ─────────────────────────


def get_document_for_validation(doc_id: str) -> dict[str, Any] | None:
    """Fetch document fields needed for truthfulness validation."""
    with get_connection() as conn, \
            conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT id, title, document_type, court, decision_date,
                      gr_no, status, truthfulness_status, is_published,
                      is_official, source_id, checksum
               FROM legal_documents
               WHERE id = %s""",
            (doc_id,),
        )
        row = cur.fetchone()
        return dict(row) if row else None


def get_source_for_validation(source_id: str) -> dict[str, Any] | None:
    """Fetch source trust_level for validation decisions."""
    with get_connection() as conn, \
            conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT id, name, type, trust_level
               FROM sources
               WHERE id = %s""",
            (source_id,),
        )
        row = cur.fetchone()
        return dict(row) if row else None


def get_document_sections_for_validation(doc_id: str) -> list[dict[str, Any]]:
    """Lightweight section list for validation (id + type only)."""
    with get_connection() as conn, \
            conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT id, section_type
               FROM legal_document_sections
               WHERE legal_document_id = %s""",
            (doc_id,),
        )
        return [dict(row) for row in cur.fetchall()]


def get_legal_document_sections_with_text(
    legal_document_id: str,
) -> list[dict[str, Any]]:
    """Fetch all sections for a doc with their plain_text body, ordered."""
    with get_connection() as conn, \
            conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT id, plain_text
               FROM legal_document_sections
               WHERE legal_document_id = %s
               ORDER BY ordering ASC, created_at ASC""",
            (legal_document_id,),
        )
        return [dict(row) for row in cur.fetchall()]


def get_corpus_doc_ids_missing_citations_after(
    after_cursor: str | None,
    limit: int,
) -> list[str]:
    """Keyset page of legal_documents.id where the doc has zero citation
    rows. Ordered by id ASC. ``after_cursor=None`` starts from the beginning.

    The NOT EXISTS skip filter is what makes the backfill orchestrator's
    re-runs no-op once a doc has any citation row.
    """
    with get_connection() as conn, \
            conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        if after_cursor is None:
            cur.execute(
                """SELECT id
                   FROM legal_documents
                   WHERE NOT EXISTS (
                       SELECT 1 FROM citations
                       WHERE from_document_id = legal_documents.id
                   )
                   ORDER BY id ASC
                   LIMIT %s""",
                (limit,),
            )
        else:
            cur.execute(
                """SELECT id
                   FROM legal_documents
                   WHERE id > %s
                     AND NOT EXISTS (
                         SELECT 1 FROM citations
                         WHERE from_document_id = legal_documents.id
                     )
                   ORDER BY id ASC
                   LIMIT %s""",
                (after_cursor, limit),
            )
        return [str(row["id"]) for row in cur.fetchall()]


def count_corpus_docs_with_citations_in_range(
    after_cursor: str | None,
    end_cursor_inclusive: str | None,
) -> int:
    """Count legal_documents in id-range (after_cursor, end_cursor_inclusive]
    that already have at least one citation row. ``None`` cursors mean
    open-ended on that side. Used by the backfill orchestrator to surface
    its ``skipped_already_has_citations`` counter.
    """
    sql = (
        "SELECT COUNT(*) AS c FROM legal_documents "
        "WHERE EXISTS ("
        "  SELECT 1 FROM citations WHERE from_document_id = legal_documents.id"
        ")"
    )
    params: list[Any] = []
    if after_cursor is not None:
        sql += " AND id > %s"
        params.append(after_cursor)
    if end_cursor_inclusive is not None:
        sql += " AND id <= %s"
        params.append(end_cursor_inclusive)

    with get_connection() as conn, \
            conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(sql, tuple(params))
        row = cur.fetchone()
        return int(row["c"]) if row else 0


def insert_citations_ignore_dupes(
    rows: list[dict[str, Any]],
) -> int:
    """Bulk-insert Citation rows, skipping duplicates per the partial unique
    index uq_citations_section_normalized. Returns inserted-row count.
    """
    if not rows:
        return 0
    inserted = 0
    with get_connection() as conn, conn.cursor() as cur:
        for r in rows:
            cur.execute(
                """INSERT INTO citations
                       (id, from_document_id, from_section_id, to_document_id,
                        citation_text, citation_type, normalized_citation,
                        confidence, created_at)
                       VALUES (gen_random_uuid(), %s, %s, NULL, %s, %s, %s, NULL, NOW())
                       ON CONFLICT (from_section_id, normalized_citation)
                       WHERE from_section_id IS NOT NULL
                         AND normalized_citation IS NOT NULL
                       DO NOTHING""",
                (
                    r["from_document_id"],
                    r["from_section_id"],
                    r["citation_text"],
                    r["citation_type"],
                    r["normalized_citation"],
                ),
            )
            inserted += cur.rowcount
    return inserted


def get_editorial_flags_for_document(doc_id: str) -> list[dict[str, Any]]:
    """Fetch open editorial flags for a document."""
    with get_connection() as conn, \
            conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT id, flag_type, severity, status
               FROM editorial_flags
               WHERE legal_document_id = %s AND status = 'open'""",
            (doc_id,),
        )
        return [dict(row) for row in cur.fetchall()]


def get_citation_counts(doc_id: str) -> dict[str, int]:
    """Get resolved vs total citation counts for a document."""
    with get_connection() as conn, \
            conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT
                   COUNT(*) AS total,
                   COUNT(to_document_id) AS resolved
               FROM citations
               WHERE from_document_id = %s""",
            (doc_id,),
        )
        row = cur.fetchone()
        if row:
            return {"total": int(row["total"]), "resolved": int(row["resolved"])}
        return {"total": 0, "resolved": 0}


# ─── Validation / Auto-Publish Write Operations ────────────────────────


def publish_document(doc_id: str) -> None:
    """Atomically set a document to published + verified state."""
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """UPDATE legal_documents
                   SET status = 'published',
                       truthfulness_status = 'verified',
                       is_published = true,
                       updated_at = NOW()
                   WHERE id = %s""",
            (doc_id,),
        )
    logger.info("Published document %s", doc_id)


def quarantine_document(doc_id: str) -> None:
    """Set a document's truthfulness status to quarantined."""
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """UPDATE legal_documents
                   SET truthfulness_status = 'quarantined',
                       is_published = false,
                       updated_at = NOW()
                   WHERE id = %s""",
            (doc_id,),
        )
    logger.info("Quarantined document %s", doc_id)


def create_audit_log(
    action: str,
    entity_type: str,
    entity_id: str | None = None,
    actor_type: str = "system",
    actor_user_id: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    """Write an audit log entry from the worker service."""
    import uuid

    log_id = str(uuid.uuid4())
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO audit_logs
                   (id, actor_user_id, actor_type, action,
                    entity_type, entity_id, metadata_json, created_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, NOW())""",
            (
                log_id,
                actor_user_id,
                actor_type,
                action,
                entity_type,
                entity_id,
                json.dumps(metadata) if metadata else "{}",
            ),
        )
    logger.info("Audit log: action=%s entity=%s/%s", action, entity_type, entity_id)


def create_editorial_flag_for_failed_task(
    document_id: str | None,
    candidate_id: str | None,
    task_name: str,
    error_message: str,
) -> str | None:
    """Create an editorial flag for a permanently failed ingestion task.

    Links to the document if available, otherwise records the candidate_id
    in metadata for manual investigation.
    """
    import uuid

    if not document_id and not candidate_id:
        return None

    flag_id = str(uuid.uuid4())
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO editorial_flags
                   (id, legal_document_id, flag_type, severity, status,
                    details, created_at)
                   VALUES (%s, %s, %s, %s, 'open', %s, NOW())""",
            (
                flag_id,
                document_id,
                "ingestion_failure",
                "high",
                f"Task {task_name} permanently failed after max retries. "
                f"Candidate: {candidate_id or 'N/A'}. "
                f"Error: {error_message[:500]}",
            ),
        )
    logger.info(
        "Created editorial flag %s for failed task %s (doc=%s, candidate=%s)",
        flag_id,
        task_name,
        document_id,
        candidate_id,
    )
    return flag_id


def update_source_endpoint_fetch_time(
    endpoint_id: str,
    success: bool = True,
) -> None:
    """Update the last fetch timestamps on a source endpoint."""
    with get_connection() as conn, conn.cursor() as cur:
        if success:
            cur.execute(
                """UPDATE source_endpoints
                       SET last_fetched_at = NOW(), last_success_at = NOW()
                       WHERE id = %s""",
                (endpoint_id,),
            )
        else:
            cur.execute(
                """UPDATE source_endpoints
                       SET last_fetched_at = NOW()
                       WHERE id = %s""",
                (endpoint_id,),
            )
    logger.info("Updated endpoint %s fetch time (success=%s)", endpoint_id, success)


# ─── Dedup Classification Operations ──────────────────────────────────


def find_documents_by_gr_no_cross_source(
    gr_no: str,
    exclude_source_id: str,
) -> list[dict[str, Any]]:
    """Find documents with the same GR No. from other sources (mirror detection)."""
    with get_connection() as conn, \
            conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT id, title, gr_no, citation_text, source_id, checksum, court
               FROM legal_documents
               WHERE gr_no = %s AND source_id != %s
               LIMIT 10""",
            (gr_no, exclude_source_id),
        )
        return [dict(row) for row in cur.fetchall()]


def find_documents_by_title_similarity(
    source_id: str,
    document_type: str,
    limit: int = 100,
) -> list[dict[str, Any]]:
    """Fetch recent documents from the same source and type for title comparison.

    Scoped to same source + same document_type to avoid O(n^2) scaling.
    Returns at most `limit` recent documents.
    """
    with get_connection() as conn, \
            conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT id, title, court, citation_text, checksum
               FROM legal_documents
               WHERE source_id = %s AND document_type = %s
               ORDER BY created_at DESC
               LIMIT %s""",
            (source_id, document_type, limit),
        )
        return [dict(row) for row in cur.fetchall()]


def create_document_similarity(
    document_a_id: str,
    document_b_id: str,
    similarity_score: float,
    similarity_type: str,
    status: str = "pending",
    classification_tier: str | None = None,
    classification_confidence: float | None = None,
    classification_metadata: dict[str, Any] | None = None,
    canonical_document_id: str | None = None,
) -> str:
    """Create a DocumentSimilarity record. Returns the new ID."""
    import uuid

    sim_id = str(uuid.uuid4())
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO document_similarities
                   (id, document_a_id, document_b_id, similarity_score,
                    similarity_type, status, classification_tier,
                    classification_confidence, classification_metadata_json,
                    canonical_document_id, created_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, NOW())""",
            (
                sim_id,
                document_a_id,
                document_b_id,
                similarity_score,
                similarity_type,
                status,
                classification_tier,
                classification_confidence,
                json.dumps(classification_metadata)
                if classification_metadata
                else None,
                canonical_document_id,
            ),
        )
    logger.info(
        "Created document similarity %s: %s <-> %s (tier=%s, score=%.2f)",
        sim_id,
        document_a_id,
        document_b_id,
        classification_tier,
        similarity_score,
    )
    return sim_id


def create_document_similarity_if_absent(
    document_a_id: str,
    document_b_id: str,
    similarity_score: float,
    similarity_type: str,
    status: str = "pending",
    classification_tier: str | None = None,
    classification_confidence: float | None = None,
    classification_metadata: dict[str, Any] | None = None,
    canonical_document_id: str | None = None,
    cursor: Any | None = None,
) -> str | None:
    """Insert a DocumentSimilarity row only if no row exists for the same
    ``(document_a_id, document_b_id)`` pair.

    Returns the new id, or ``None`` when an existing row blocked the insert.
    Used by the post-publish dedup backfill so re-runs are idempotent
    without depending on a unique index. The existence check and the
    insert share a single statement (``INSERT ... SELECT ... WHERE NOT
    EXISTS``), so the inner gap is closed inside one query.

    If ``cursor`` is provided, executes on the caller's cursor without
    opening a new connection — this lets a backfill batch wrap many
    inserts in a single transaction. When ``cursor`` is ``None`` the
    helper opens and commits its own connection.
    """
    import uuid

    sim_id = str(uuid.uuid4())
    sql = """INSERT INTO document_similarities
                 (id, document_a_id, document_b_id, similarity_score,
                  similarity_type, status, classification_tier,
                  classification_confidence, classification_metadata_json,
                  canonical_document_id, created_at)
                 SELECT %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, NOW()
                 WHERE NOT EXISTS (
                     SELECT 1 FROM document_similarities
                     WHERE document_a_id = %s AND document_b_id = %s
                 )"""
    params = (
        sim_id,
        document_a_id,
        document_b_id,
        similarity_score,
        similarity_type,
        status,
        classification_tier,
        classification_confidence,
        json.dumps(classification_metadata)
        if classification_metadata
        else None,
        canonical_document_id,
        document_a_id,
        document_b_id,
    )

    if cursor is not None:
        cursor.execute(sql, params)
        if cursor.rowcount == 0:
            return None
    else:
        with get_connection() as conn, conn.cursor() as cur:
            cur.execute(sql, params)
            if cur.rowcount == 0:
                return None

    logger.info(
        "Created document similarity %s: %s <-> %s (tier=%s, score=%.2f)",
        sim_id,
        document_a_id,
        document_b_id,
        classification_tier,
        similarity_score,
    )
    return sim_id


def update_candidate_dedup_classification(
    candidate_id: str,
    dedup_classification: str,
    dedup_confidence: float,
    matched_document_id: str | None = None,
) -> None:
    """Update dedup classification fields on an ingestion candidate."""
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """UPDATE ingestion_candidates
                   SET dedup_classification = %s,
                       dedup_confidence = %s,
                       matched_document_id = %s,
                       processed_at = NOW()
                   WHERE id = %s""",
            (dedup_classification, dedup_confidence, matched_document_id, candidate_id),
        )
    logger.info(
        "Updated candidate %s dedup: class=%s conf=%.2f matched=%s",
        candidate_id,
        dedup_classification,
        dedup_confidence,
        matched_document_id,
    )


def complete_ingestion_job_with_dedup(
    job_id: str,
    records_found: int,
    records_created: int,
    records_updated: int,
    records_skipped: int,
    records_duplicate: int,
    duration_ms: int | None = None,
) -> None:
    """Mark an ingestion job as completed with full dedup counters."""
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """UPDATE ingestion_jobs
                   SET status = 'completed',
                       finished_at = NOW(),
                       records_found = %s,
                       records_created = %s,
                       records_updated = %s,
                       records_skipped = %s,
                       records_duplicate = %s,
                       duration_ms = %s
                   WHERE id = %s""",
            (
                records_found,
                records_created,
                records_updated,
                records_skipped,
                records_duplicate,
                duration_ms,
                job_id,
            ),
        )
    logger.info(
        "Completed ingestion job %s: found=%d created=%d updated=%d skipped=%d dup=%d",
        job_id,
        records_found,
        records_created,
        records_updated,
        records_skipped,
        records_duplicate,
    )


# ─── Content Disclaimer Lookup ─────────────────────────────────────────

# Module-scope cache: (content_class, version) -> disclaimer UUID
_disclaimer_id_cache: dict[tuple[str, int], str] = {}


def get_content_disclaimer_id(content_class: str, version: int = 1) -> str:
    """Look up a content_disclaimers row by content_class + version.

    Caches results module-scope so the DB is hit at most once per
    (content_class, version) pair per worker process lifetime.

    Raises ValueError if no matching row exists — callers must NOT
    fall back to a placeholder UUID (see PR #28).
    """
    cache_key = (content_class, version)
    cached = _disclaimer_id_cache.get(cache_key)
    if cached is not None:
        return cached

    with get_connection() as conn, \
            conn.cursor() as cur:
        cur.execute(
            """SELECT id FROM content_disclaimers
               WHERE content_class = %s AND version = %s AND is_active = true
               LIMIT 1""",
            (content_class, version),
        )
        row = cur.fetchone()

    if not row:
        raise ValueError(
            f"No active content_disclaimers row for "
            f"content_class={content_class!r} version={version}. "
            f"Run the disclaimer seed before dispatching derivative jobs."
        )

    disclaimer_id: str = row[0]
    _disclaimer_id_cache[cache_key] = disclaimer_id
    logger.info(
        "Resolved content_disclaimer: class=%s version=%d -> %s",
        content_class, version, disclaimer_id,
    )
    return disclaimer_id


# ─── Derivative Job Claim ──────────────────────────────────────────────


def enqueue_derivative_job_if_absent(
    document_id: str,
    derivative_type: str,
    trigger_type: str,
    backfill_batch_id: str | None = None,
) -> str | None:
    """Insert a ``derivative_generation_jobs`` row for (document, type) if
    no live row already exists for that pair. Returns the new job id, or
    ``None`` if skipped.

    Skips when:
    - A pending/running/dispatched job already targets the same
      (source_document_id, derivative_type), OR
    - A non-deleted ``derivative_artifacts`` row already exists for that
      (source_document_id, derivative_type).

    The read + insert run in a single connection (single transaction) so
    a concurrent ingestion-tick can't produce two jobs for the same pair.
    """
    import uuid

    job_id = str(uuid.uuid4())
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """SELECT 1 FROM derivative_generation_jobs
               WHERE source_document_id = %s
                 AND derivative_type = %s
                 AND status IN ('pending', 'dispatched', 'running')
               LIMIT 1""",
            (document_id, derivative_type),
        )
        if cur.fetchone() is not None:
            return None

        cur.execute(
            """SELECT 1 FROM derivative_artifacts
               WHERE source_document_id = %s
                 AND derivative_type = %s
                 AND deleted_at IS NULL
               LIMIT 1""",
            (document_id, derivative_type),
        )
        if cur.fetchone() is not None:
            return None

        cur.execute(
            """INSERT INTO derivative_generation_jobs
                   (id, derivative_type, trigger_type, source_document_id,
                    backfill_batch_id, status, created_at)
                   VALUES (%s, %s, %s, %s, %s, 'pending', NOW())""",
            (
                job_id,
                derivative_type,
                trigger_type,
                document_id,
                backfill_batch_id,
            ),
        )
    return job_id


def claim_derivative_job(job_id: str) -> bool:
    """Atomically claim a dispatched derivative job by setting status to 'running'.

    Returns True if the job was claimed (was still 'dispatched' or 'pending'),
    False otherwise (already running, completed, or failed).
    Uses optimistic locking via WHERE status IN ('dispatched', 'pending').
    """
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """UPDATE derivative_generation_jobs
                   SET status = 'running', started_at = NOW()
                   WHERE id = %s AND status IN ('dispatched', 'pending')""",
            (job_id,),
        )
        claimed = bool(cur.rowcount > 0)
    if claimed:
        logger.info("Claimed derivative job %s", job_id)
    else:
        logger.warning("Failed to claim derivative job %s (already claimed?)", job_id)
    return claimed


# ─── Digest Generation Operations ──────────────────────────────────────


def get_legal_document_ids_in_window(
    start_date: str,
    end_date: str,
) -> list[str]:
    """Return ids of ``legal_documents`` rows with ``created_at`` in
    ``[start_date, end_date)``.

    ``start_date`` / ``end_date`` are ISO-8601 strings (``YYYY-MM-DD`` or
    full timestamp). Used by the reprocessing job to find documents that
    were ingested while the worker had a broken raw-SQL bug and therefore
    have no embeddings / doctrines / citations attached.
    """
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """SELECT id::text
               FROM legal_documents
               WHERE created_at >= %s::timestamptz
                 AND created_at < %s::timestamptz
               ORDER BY created_at ASC""",
            (start_date, end_date),
        )
        return [row[0] for row in cur.fetchall()]


def count_doctrine_extracts_for_document(document_id: str) -> int:
    """Return the number of ``doctrine_extracts`` rows attached to a
    document.

    Used by the reprocess task to skip documents that already have
    doctrines from a prior run.
    """
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT COUNT(*) FROM doctrine_extracts WHERE legal_document_id = %s",
            (document_id,),
        )
        row = cur.fetchone()
        return int(row[0]) if row else 0


def count_section_embeddings_for_document(document_id: str) -> int:
    """Return the number of section embeddings already stored for a
    document.

    Embeddings live in the ``embeddings`` table keyed by
    ``(entity_type='section', entity_id=<section.id>)``. We join through
    ``legal_document_sections`` to find which of this document's sections
    already have embeddings.
    """
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """SELECT COUNT(*)
               FROM embeddings e
               JOIN legal_document_sections s
                 ON s.id = e.entity_id
               WHERE e.entity_type = 'section'
                 AND s.legal_document_id = %s""",
            (document_id,),
        )
        row = cur.fetchone()
        return int(row[0]) if row else 0


def count_resolved_citations_for_document(document_id: str) -> int:
    """Return the number of ``citations`` rows for the document that have
    been resolved (``to_document_id IS NOT NULL``).
    """
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """SELECT COUNT(*) FROM citations
               WHERE from_document_id = %s
                 AND to_document_id IS NOT NULL""",
            (document_id,),
        )
        row = cur.fetchone()
        return int(row[0]) if row else 0


def get_legal_document(document_id: str) -> dict[str, Any] | None:
    """Fetch a legal document by ID with full metadata for digest generation."""
    with get_connection() as conn, \
            conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT id, title, short_title, document_type, gr_no,
                      citation_text, court, ponente, decision_date,
                      source_id, is_official, status, truthfulness_status
               FROM legal_documents
               WHERE id = %s""",
            (document_id,),
        )
        row = cur.fetchone()
        return dict(row) if row else None


def get_document_sections_for_digest(doc_id: str) -> list[dict[str, Any]]:
    """Fetch full document sections for digest generation."""
    with get_connection() as conn, \
            conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT id, section_type, section_label, plain_text,
                      page_start, page_end, ordering
               FROM legal_document_sections
               WHERE legal_document_id = %s
               ORDER BY ordering ASC""",
            (doc_id,),
        )
        return [dict(row) for row in cur.fetchall()]


def get_document_metadata_for_digest(doc_id: str) -> dict[str, Any] | None:
    """Fetch document metadata needed for digest generation."""
    with get_connection() as conn, \
            conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT id, title, short_title, document_type, gr_no,
                      citation_text, court, ponente, decision_date, source_id
               FROM legal_documents
               WHERE id = %s""",
            (doc_id,),
        )
        row = cur.fetchone()
        return dict(row) if row else None


def create_digest(
    document_id: str,
    title: str,
    source_origin: str,
    digest_type: str,
    summary: str | None,
    facts: str | None,
    petitioner_arguments: str | None,
    respondent_arguments: str | None,
    issues: str | None,
    ruling: str | None,
    doctrine: str | None,
    dispositive: str | None,
    cited_authorities_json: str,
    confidence_score: float | None,
    review_status: str,
    visibility: str,
) -> str:
    """Create a digest row, idempotent on ``(legal_document_id, digest_type)``.

    The ``uq_digest_document_type`` unique index causes ``INSERT`` retries to
    raise ``UniqueViolation`` and abort the whole task chain. ``ON CONFLICT
    DO NOTHING`` + ``RETURNING id`` either returns the freshly-inserted id
    or, on conflict, falls back to a plain ``SELECT`` for the existing row's
    id. Either way the caller gets a valid digest id and downstream
    provenance / model-run inserts continue.
    """
    import uuid

    digest_id = str(uuid.uuid4())
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO digests
                   (id, legal_document_id, source_origin, title, digest_type,
                    facts, issues, ruling, doctrine, dispositive,
                    summary, petitioner_arguments, respondent_arguments,
                    cited_authorities_json, confidence_score,
                    review_status, visibility, created_at, updated_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                           %s, %s, %s, %s::jsonb, %s, %s, %s, NOW(), NOW())
                   ON CONFLICT (legal_document_id, digest_type) DO NOTHING
                   RETURNING id""",
            (
                digest_id,
                document_id,
                source_origin,
                title,
                digest_type,
                facts,
                issues,
                ruling,
                doctrine,
                dispositive,
                summary,
                petitioner_arguments,
                respondent_arguments,
                cited_authorities_json,
                confidence_score,
                review_status,
                visibility,
            ),
        )
        row = cur.fetchone()
        if row is not None:
            logger.info("Created digest %s for document %s", row[0], document_id)
            return str(row[0])

        # Pre-existing row from a prior run wins. Look up its id so the
        # caller can attach provenance / model_runs to it.
        cur.execute(
            """SELECT id FROM digests
               WHERE legal_document_id = %s AND digest_type = %s""",
            (document_id, digest_type),
        )
        existing = cur.fetchone()
        if existing is None:
            # Should never happen — we just hit ON CONFLICT, the row exists.
            raise RuntimeError(
                f"Digest upsert returned no row for "
                f"document_id={document_id} digest_type={digest_type}",
            )
        logger.info(
            "Digest already exists for document %s (digest_type=%s) — "
            "reusing %s",
            document_id, digest_type, existing[0],
        )
        return str(existing[0])


def create_provenance_records(records: list[dict[str, Any]]) -> int:
    """Batch insert provenance records. Returns count of records created."""
    import uuid

    if not records:
        return 0

    with get_connection() as conn, conn.cursor() as cur:
        for record in records:
            record_id = str(uuid.uuid4())
            cur.execute(
                """INSERT INTO provenance_records
                       (id, entity_type, entity_id, source_document_id,
                        source_section_id, provenance_type, created_at)
                       VALUES (%s, %s, %s, %s, %s, %s, NOW())""",
                (
                    record_id,
                    record.get("entity_type", "digest"),
                    record["entity_id"],
                    record["source_document_id"],
                    record.get("source_section_id"),
                    record.get("provenance_type", "generated"),
                ),
            )
    logger.info("Created %d provenance records", len(records))
    return len(records)


def create_model_run(
    run_type: str,
    model_name: str,
    model_version: str | None = None,
    prompt_template_version: str | None = None,
    input_ref: str | None = None,
    output_ref: str | None = None,
    confidence: float | None = None,
    tokens_in: int | None = None,
    tokens_out: int | None = None,
    latency_ms: int | None = None,
) -> str:
    """Create a model run audit record. Returns the new model run ID."""
    import uuid

    run_id = str(uuid.uuid4())
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO model_runs
                   (id, run_type, model_name, model_version,
                    prompt_template_version, input_ref, output_ref,
                    confidence, tokens_in, tokens_out, latency_ms, created_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())""",
            (
                run_id,
                run_type,
                model_name,
                model_version,
                prompt_template_version,
                input_ref,
                output_ref,
                confidence,
                tokens_in,
                tokens_out,
                latency_ms,
            ),
        )
    logger.info("Created model run %s: type=%s model=%s", run_id, run_type, model_name)
    return run_id


# ─── Bar Exam Sittings + Questions Operations ──────────────────────────


def find_source_by_domain(domain: str) -> dict[str, Any] | None:
    """Look up a sources row by its ``domain`` column.

    The bar-exam ingest task reuses the existing LawPhil source row to
    keep all LawPhil-derived rows under a single trust-tier entry rather
    than creating a parallel source registry.
    """
    with get_connection() as conn, \
            conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT id, name, type, trust_level, enabled
               FROM sources
               WHERE domain = %s
               LIMIT 1""",
            (domain,),
        )
        row = cur.fetchone()
        return dict(row) if row else None


def find_bar_exam_sitting(
    year: int,
    part: str | None,
    subject_study_code: str,
) -> dict[str, Any] | None:
    """Look up an existing bar exam sitting by its unique key.

    Returns ``{id, source_document_id, ...}`` or ``None``. The unique
    constraint ``(year, part, subjectStudyCode)`` makes this an exact
    match; ``part IS NULL`` is matched explicitly so the legacy single-
    paper subjects (no morning/afternoon split) resolve correctly.
    """
    with get_connection() as conn, \
            conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        if part is None:
            cur.execute(
                """SELECT id, year, part, subject_study_code,
                          subject_bar_admin_code, source_document_id,
                          source_url, chairperson, taxonomy_version
                   FROM bar_exam_sittings
                   WHERE year = %s AND part IS NULL
                     AND subject_study_code = %s
                   LIMIT 1""",
                (year, subject_study_code),
            )
        else:
            cur.execute(
                """SELECT id, year, part, subject_study_code,
                          subject_bar_admin_code, source_document_id,
                          source_url, chairperson, taxonomy_version
                   FROM bar_exam_sittings
                   WHERE year = %s AND part = %s
                     AND subject_study_code = %s
                   LIMIT 1""",
                (year, part, subject_study_code),
            )
        row = cur.fetchone()
        return dict(row) if row else None


def create_bar_exam_sitting(
    year: int,
    part: str | None,
    subject_study_code: str,
    subject_bar_admin_code: str | None,
    source_document_id: str | None,
    source_url: str,
    taxonomy_version: str,
    chairperson: str | None = None,
) -> str:
    """Insert a new bar_exam_sittings row and return its id.

    Caller is expected to have already checked ``find_bar_exam_sitting``
    for an existing match — re-INSERTing the same key violates the
    unique index ``(year, part, subjectStudyCode)``.
    """
    import uuid

    sitting_id = str(uuid.uuid4())
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO bar_exam_sittings
                   (id, year, part, subject_study_code, subject_bar_admin_code,
                    chairperson, source_document_id, source_url, taxonomy_version)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (
                sitting_id,
                year,
                part,
                subject_study_code,
                subject_bar_admin_code,
                chairperson,
                source_document_id,
                source_url,
                taxonomy_version,
            ),
        )
    logger.info(
        "Created bar exam sitting %s: year=%d part=%s subject=%s",
        sitting_id, year, part, subject_study_code,
    )
    return sitting_id


def update_bar_exam_sitting_source_doc(
    sitting_id: str,
    source_document_id: str,
    source_url: str,
    chairperson: str | None,
) -> None:
    """Refresh the source_document_id and metadata on an existing sitting.

    Re-running ingestion creates a fresh legal_document version chain;
    the sitting row points to the most recent canonical document.
    """
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """UPDATE bar_exam_sittings
                   SET source_document_id = %s,
                       source_url = %s,
                       chairperson = COALESCE(%s, chairperson)
                   WHERE id = %s""",
            (source_document_id, source_url, chairperson, sitting_id),
        )


def upsert_bar_exam_questions(
    sitting_id: str,
    questions: list[dict[str, Any]],
    source_url: str,
) -> int:
    """UPSERT questions for a sitting; returns count inserted-or-updated.

    Each question dict must carry ``question_number``, ``question_text``,
    and ``sub_parts_count``; ``source_section_anchor`` is optional. The
    ``ON CONFLICT … DO UPDATE`` clause refreshes the question_text and
    sub_parts_count so re-runs pick up LawPhil typo fixes without
    duplicating rows.
    """
    if not questions:
        return 0
    written = 0
    with get_connection() as conn, conn.cursor() as cur:
        for q in questions:
            cur.execute(
                """INSERT INTO bar_exam_questions
                       (id, bar_exam_sitting_id, question_number, question_text,
                        sub_parts_count, source_url, source_section_anchor,
                        parsed_at, created_at, updated_at)
                       VALUES (gen_random_uuid(), %s, %s, %s, %s, %s, %s,
                               NOW(), NOW(), NOW())
                       ON CONFLICT (bar_exam_sitting_id, question_number)
                       DO UPDATE SET question_text = EXCLUDED.question_text,
                                     sub_parts_count = EXCLUDED.sub_parts_count,
                                     source_url = EXCLUDED.source_url,
                                     source_section_anchor =
                                         EXCLUDED.source_section_anchor,
                                     parsed_at = EXCLUDED.parsed_at,
                                     updated_at = NOW()""",
                (
                    sitting_id,
                    q["question_number"],
                    q["question_text"],
                    q.get("sub_parts_count", 0),
                    source_url,
                    q.get("source_section_anchor"),
                ),
            )
            written += cur.rowcount
    logger.info(
        "Upserted %d questions for bar exam sitting %s (input=%d)",
        written, sitting_id, len(questions),
    )
    return written


def publish_legal_document_immediately(document_id: str) -> None:
    """Mark a freshly-ingested official-source document as published.

    Used by the bar exam ingest task: LawPhil bar Q pages are static
    official content, so the truthfulness validator's "needs review"
    holding pattern adds no signal. We mark the document published +
    verified at ingest time so it surfaces in the public Library
    immediately, bypassing the auto-publish chain that targets
    case decisions.
    """
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """UPDATE legal_documents
                   SET status = 'published',
                       truthfulness_status = 'verified',
                       is_published = true,
                       is_official = true,
                       updated_at = NOW()
                   WHERE id = %s""",
            (document_id,),
        )
    logger.info("Published bar exam document %s immediately", document_id)


# ─── Bar Exam Answers (Phase 3a) ────────────────────────────────────────


def get_bar_exam_question_with_context(
    question_id: str,
) -> dict[str, Any] | None:
    """Fetch a bar exam question joined with its sitting's year + subject.

    Returns ``{id, question_text, subject_study_code, sitting_year,
    sitting_id}`` or ``None`` if the question doesn't exist. The columns
    drive prompt rendering and citation retrieval.
    """
    with get_connection() as conn, \
            conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT q.id,
                      q.question_text,
                      q.bar_exam_sitting_id AS sitting_id,
                      s.year AS sitting_year,
                      s.subject_study_code,
                      s.subject_bar_admin_code
               FROM bar_exam_questions q
               JOIN bar_exam_sittings s ON s.id = q.bar_exam_sitting_id
               WHERE q.id = %s""",
            (question_id,),
        )
        row = cur.fetchone()
        return dict(row) if row else None


def bar_exam_answer_exists(
    bar_exam_question_id: str,
    answer_type: str = "ai_generated",
) -> bool:
    """Idempotency check for the answer generator — returns True if the
    (question, answer_type) pair already has a row.
    """
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """SELECT 1
                   FROM bar_exam_answers
                   WHERE bar_exam_question_id = %s
                     AND answer_type = %s
                   LIMIT 1""",
            (bar_exam_question_id, answer_type),
        )
        return cur.fetchone() is not None


def delete_pending_bar_exam_answer(
    question_id: str,
    answer_type: str = "ai_generated",
) -> int:
    """Delete a bar_exam_answers row only if its review_status is 'pending'.

    The WHERE clause makes deletion of approved / rejected rows physically
    impossible — that invariant is what lets the admin "force regenerate"
    flow operate safely without an extra application-level guard. Returns
    the number of rows actually deleted (0 or 1).
    """
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """DELETE FROM bar_exam_answers
                   WHERE bar_exam_question_id = %s
                     AND answer_type = %s
                     AND review_status = 'pending'
                   RETURNING id""",
            (question_id, answer_type),
        )
        rows = cur.fetchall()
    deleted = len(rows)
    if deleted:
        logger.info(
            "Deleted pending bar exam answer for question %s (type=%s)",
            question_id,
            answer_type,
        )
    return deleted


def get_approved_bar_exam_answers(
    limit: int | None = None,
) -> list[dict[str, Any]]:
    """Fetch APPROVED bar_exam_answers joined with their question + sitting.

    Drives the suggested-bar-answer Library projection: each row carries
    everything the renderer contract needs (question text, answer body,
    bar year, subject code) plus the sitting's ``source_document_id`` so
    the derivative write can record provenance back to the official
    LawPhil bar-question document.

    Only ``review_status='approved'`` rows are returned — the projection
    never republishes pending or rejected answers. Rows whose sitting has
    no ``source_document_id`` are still returned; the caller decides how
    to handle the missing provenance anchor.
    """
    sql = """SELECT a.id                       AS answer_id,
                    a.bar_exam_question_id      AS question_id,
                    a.answer_text               AS answer_text,
                    a.structured_answer_json    AS structured_answer_json,
                    a.confidence                AS confidence,
                    q.question_text             AS question_text,
                    s.year                      AS sitting_year,
                    s.subject_study_code        AS subject_study_code,
                    s.subject_bar_admin_code    AS subject_bar_admin_code,
                    s.source_document_id        AS source_document_id,
                    s.source_url                AS source_url
             FROM bar_exam_answers a
             JOIN bar_exam_questions q ON q.id = a.bar_exam_question_id
             JOIN bar_exam_sittings s ON s.id = q.bar_exam_sitting_id
             WHERE a.review_status = 'approved'
             ORDER BY a.id ASC"""
    params: tuple[Any, ...] = ()
    if limit is not None:
        sql += " LIMIT %s"
        params = (limit,)

    with get_connection() as conn, \
            conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(sql, params)
        return [dict(row) for row in cur.fetchall()]


def derivative_artifact_exists_by_content_hash(
    content_hash: str,
    derivative_type: str,
) -> bool:
    """Return True if a non-deleted derivative_artifacts row already exists
    for ``(derivative_type, content_hash)``.

    This is the idempotency guard for the suggested-bar-answer projection:
    the content hash is deterministic from (bar year + subject + question
    text), so a re-run skips any answer that has already been projected.
    """
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """SELECT 1 FROM derivative_artifacts
               WHERE derivative_type = %s
                 AND content_hash = %s
                 AND deleted_at IS NULL
               LIMIT 1""",
            (derivative_type, content_hash),
        )
        return cur.fetchone() is not None


def create_bar_exam_answer(
    bar_exam_question_id: str,
    answer_text: str,
    structured_answer: dict[str, Any] | None,
    answer_type: str = "ai_generated",
    model_run_id: str | None = None,
    confidence: float | None = None,
    review_status: str = "pending",
    visibility: str = "private",
) -> str:
    """Insert a bar_exam_answers row. Returns the new id.

    Caller is responsible for the idempotency check
    (``bar_exam_answer_exists``) — the unique constraint will raise on
    conflict if it's skipped.
    """
    import uuid

    answer_id = str(uuid.uuid4())
    structured_json = (
        json.dumps(structured_answer) if structured_answer is not None else None
    )
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO bar_exam_answers
                   (id, bar_exam_question_id, answer_type, answer_text,
                    structured_answer_json, model_run_id, confidence,
                    review_status, visibility, created_at, updated_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW())""",
            (
                answer_id,
                bar_exam_question_id,
                answer_type,
                answer_text,
                structured_json,
                model_run_id,
                confidence,
                review_status,
                visibility,
            ),
        )
    logger.info(
        "Created bar exam answer %s for question %s (type=%s status=%s)",
        answer_id,
        bar_exam_question_id,
        answer_type,
        review_status,
    )
    return answer_id
