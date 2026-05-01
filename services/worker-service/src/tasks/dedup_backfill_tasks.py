"""LIBERTASIAN Worker Service — One-shot backfill of dedup similarity rows
for legacy checksum-duplicate documents that predate the candidate-stage
detector (or were classified as ``new_document``).

Manual trigger only — not registered on the Celery beat schedule. Fire via:

    docker exec libertasian-worker-service celery -A src.celery_app call \\
        tasks.dedup_backfill_published_documents

Each checksum group's oldest ``legal_documents.id`` is treated as canonical;
every other row in the group gets one ``document_similarities`` row with
``similarity_type='exact_duplicate'`` + ``status='auto_dismissed'`` and one
matching ``audit_logs`` entry. The insert path uses
``create_document_similarity_if_absent`` so re-running the task on the same
data is idempotent — only previously-unrecorded pairs become new rows.
"""

from __future__ import annotations

import json
import logging
import uuid
from typing import Any

import psycopg2
import psycopg2.extras
from celery import shared_task

from ..clients import ingestion_db_client as ingestion_db
from ..clients.db_client import get_read_connection
from ..config import settings

logger = logging.getLogger(__name__)


def _fetch_duplicate_groups(conn: Any) -> list[dict[str, Any]]:
    """Return one row per checksum group with ``COUNT(*) > 1``.

    Each row carries the canonical id (oldest by ``created_at``) and the
    ordered list of duplicate ids that need a similarity row.
    """
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT checksum,
                      MIN(created_at) AS canonical_created,
                      ARRAY_AGG(id::text ORDER BY created_at ASC, id ASC)
                          AS ids
               FROM legal_documents
               WHERE checksum IS NOT NULL
               GROUP BY checksum
               HAVING COUNT(*) > 1
               ORDER BY checksum ASC"""
        )
        return [dict(row) for row in cur.fetchall()]


def _insert_audit_log(
    cur: Any,
    *,
    entity_id: str,
    metadata: dict[str, Any],
) -> None:
    """Insert one ``audit_logs`` row using the supplied write cursor."""
    cur.execute(
        """INSERT INTO audit_logs
               (id, actor_user_id, actor_type, action,
                entity_type, entity_id, metadata_json, created_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, NOW())""",
        (
            str(uuid.uuid4()),
            None,
            "system",
            "document.dedup_backfilled",
            "legal_document",
            entity_id,
            json.dumps(metadata),
        ),
    )


def _process_batch(
    pairs: list[tuple[str, str, str]],
    *,
    dry_run: bool,
) -> tuple[int, int]:
    """Insert similarity + audit rows for one batch of (canonical, duplicate,
    checksum) pairs in a single transaction.

    Returns ``(similarities_written, audits_written)``. Both counts reflect
    the pre-rollback state when ``dry_run=True`` so callers can still log
    what *would* have happened.
    """
    if not pairs:
        return 0, 0

    sim_written = 0
    audits_written = 0
    conn = psycopg2.connect(settings.database_url)
    try:
        with conn.cursor() as cur:
            for canonical_id, duplicate_id, checksum in pairs:
                sim_id = ingestion_db.create_document_similarity_if_absent(
                    document_a_id=canonical_id,
                    document_b_id=duplicate_id,
                    similarity_score=1.0,
                    similarity_type="exact_duplicate",
                    status="auto_dismissed",
                    classification_tier="exact_duplicate",
                    classification_confidence=1.0,
                    classification_metadata={
                        "source": "backfill",
                        "matched_on": "checksum",
                    },
                    canonical_document_id=canonical_id,
                    cursor=cur,
                )
                if sim_id is None:
                    continue

                sim_written += 1
                _insert_audit_log(
                    cur,
                    entity_id=duplicate_id,
                    metadata={
                        "canonical_id": canonical_id,
                        "checksum": checksum,
                        "source": "backfill_task",
                    },
                )
                audits_written += 1

        if dry_run:
            conn.rollback()
        else:
            conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    return sim_written, audits_written


@shared_task(
    name="tasks.dedup_backfill_published_documents",
    bind=True,
    acks_late=True,
    reject_on_worker_lost=True,
    max_retries=0,
)
def dedup_backfill_published_documents(
    self: Any,
    batch_size: int = 500,
    dry_run: bool = False,
) -> dict[str, Any]:
    """Backfill ``document_similarities`` rows for checksum-duplicate
    ``legal_documents`` that have no similarity row linking them yet.

    Args:
        batch_size: Number of (canonical, duplicate) pairs per write
            transaction. Keeps lock contention bounded on the
            ``document_similarities`` table.
        dry_run: When ``True``, all SQL still runs but every per-batch
            transaction is rolled back. Useful for sizing the work
            before flipping the switch.

    Returns:
        ``{groups, pairs_planned, similarities_written, audits_written,
           batches, dry_run}``.
    """
    logger.info(
        "dedup_backfill_published_documents start: batch_size=%d dry_run=%s",
        batch_size,
        dry_run,
    )

    with get_read_connection() as read_conn:
        groups = _fetch_duplicate_groups(read_conn)

    pairs: list[tuple[str, str, str]] = []
    for group in groups:
        ids: list[str] = group["ids"]
        if len(ids) < 2:
            continue
        canonical_id = ids[0]
        for duplicate_id in ids[1:]:
            pairs.append((canonical_id, duplicate_id, group["checksum"]))

    total_pairs = len(pairs)
    logger.info(
        "Planning dedup backfill: %d duplicate groups, %d non-canonical pairs",
        len(groups),
        total_pairs,
    )

    similarities_written = 0
    audits_written = 0
    batches = 0

    for offset in range(0, total_pairs, batch_size):
        chunk = pairs[offset : offset + batch_size]
        batches += 1
        sim_count, audit_count = _process_batch(chunk, dry_run=dry_run)
        similarities_written += sim_count
        audits_written += audit_count
        logger.info(
            "dedup backfill batch %d: pairs=%d similarities=%d audits=%d "
            "(dry_run=%s)",
            batches,
            len(chunk),
            sim_count,
            audit_count,
            dry_run,
        )

    summary: dict[str, Any] = {
        "groups": len(groups),
        "pairs_planned": total_pairs,
        "similarities_written": similarities_written,
        "audits_written": audits_written,
        "batches": batches,
        "dry_run": dry_run,
    }
    logger.info("dedup_backfill_published_documents complete: %s", summary)
    return summary
