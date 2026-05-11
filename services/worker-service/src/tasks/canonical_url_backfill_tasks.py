"""LIBERTASIAN Worker Service — One-shot backfill of dedup similarity rows
for legacy ``legal_documents`` pairs that share the same ``canonical_url``
but have different checksums.

The v1 dedup backfill (``dedup_backfill_published_documents``) handles the
checksum-equal case as ``auto_dismissed``. This v2 task handles the
checksum-NOT-equal-same-URL case as ``pending`` review queue rows. Mirror
sites (Lawphil ↔ SC E-Library) publish under the same URL but their content
can diverge, so a same-URL collision is NEVER auto-dismissed — a reviewer
must classify it manually as merge / version_update / dismiss.

Manual trigger only — not registered on the Celery beat schedule. Fire via
the admin endpoint:

    POST /api/v1/admin/duplicates/canonical-url-backfill

HARD CAP: ``MAX_PAIRS_PER_DISPATCH = 500``. Re-dispatch the task to drain
more pairs in subsequent passes. The cap exists to protect reviewer queue
from a sudden flood on first run.

Idempotency: ``create_document_similarity_if_absent`` skips any pair that
already has a row in ``document_similarities``, so re-runs only insert
previously-unrecorded pairs.
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

# Hard cap on pairs per dispatch — protects the reviewer queue from a sudden
# flood on first run. Re-dispatch the task to drain more pairs.
MAX_PAIRS_PER_DISPATCH = 500


def _fetch_canonical_url_collision_groups(conn: Any) -> list[dict[str, Any]]:
    """Return one row per canonical_url that has at least two
    ``legal_documents`` with distinct checksums.

    Each row carries the ``canonical_url`` and the list of doc ids in that
    group ordered by ``created_at`` ASC (oldest first → canonical). Groups
    where every doc shares the same checksum are filtered out — those are
    handled by the v1 exact-duplicate backfill, not this one.
    """
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT canonical_url,
                      ARRAY_AGG(id::text ORDER BY created_at ASC, id ASC)
                          AS ids,
                      ARRAY_AGG(checksum ORDER BY created_at ASC, id ASC)
                          AS checksums
               FROM legal_documents
               WHERE canonical_url IS NOT NULL
                 AND checksum IS NOT NULL
               GROUP BY canonical_url
               HAVING COUNT(*) > 1
                  AND COUNT(DISTINCT checksum) > 1
               ORDER BY canonical_url ASC"""
        )
        return [dict(row) for row in cur.fetchall()]


def _build_pairs(
    groups: list[dict[str, Any]],
) -> list[tuple[str, str, str]]:
    """Expand canonical-url groups into (canonical_id, duplicate_id, url)
    pairs where the duplicate's checksum differs from the canonical's.

    Same-checksum pairs are intentionally skipped — those collide with v1's
    exact-duplicate backfill scope.
    """
    pairs: list[tuple[str, str, str]] = []
    for group in groups:
        ids: list[str] = group["ids"]
        checksums: list[str | None] = group["checksums"]
        if len(ids) < 2:
            continue
        canonical_id = ids[0]
        canonical_checksum = checksums[0]
        for dup_id, dup_checksum in zip(ids[1:], checksums[1:], strict=False):
            if dup_checksum == canonical_checksum:
                continue
            pairs.append((canonical_id, dup_id, group["canonical_url"]))
    return pairs


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
            "document.canonical_url_backfilled",
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
    canonical_url) tuples in a single transaction.

    Returns ``(similarities_written, audits_written)``. Counts reflect the
    pre-rollback state when ``dry_run=True`` so callers can still log what
    *would* have happened.
    """
    if not pairs:
        return 0, 0

    sim_written = 0
    audits_written = 0
    conn = psycopg2.connect(settings.database_url)
    try:
        with conn.cursor() as cur:
            for canonical_id, duplicate_id, url in pairs:
                sim_id = ingestion_db.create_document_similarity_if_absent(
                    document_a_id=canonical_id,
                    document_b_id=duplicate_id,
                    similarity_score=0.75,
                    similarity_type="canonical_url_match",
                    status="pending",
                    classification_tier="canonical_url_match",
                    classification_confidence=0.75,
                    classification_metadata={
                        "source": "backfill",
                        "matched_on": "canonical_url",
                        "url": url,
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
                        "canonical_url": url,
                        "source": "canonical_url_backfill_task",
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
    name="tasks.canonical_url_backfill_published_documents",
    bind=True,
    acks_late=True,
    reject_on_worker_lost=True,
    max_retries=0,
)
def canonical_url_backfill_published_documents(
    self: Any,
    batch_size: int = 100,
    dry_run: bool = False,
) -> dict[str, Any]:
    """Backfill ``document_similarities`` rows (status='pending') for
    canonical_url collisions in ``legal_documents`` where the colliding
    docs have different checksums.

    Hard-capped at ``MAX_PAIRS_PER_DISPATCH`` pairs per dispatch. Idempotent
    via ``create_document_similarity_if_absent`` — already-recorded pairs
    are skipped.

    Args:
        batch_size: Pairs per write transaction. Keeps lock contention bounded.
        dry_run: When ``True``, all SQL runs but each batch is rolled back.

    Returns:
        ``{groups, pairs_planned, pairs_capped, similarities_written,
           audits_written, batches, dry_run}``. ``pairs_capped`` is the
        number trimmed by ``MAX_PAIRS_PER_DISPATCH`` (zero on most runs).
    """
    logger.info(
        "canonical_url_backfill_published_documents start: "
        "batch_size=%d dry_run=%s cap=%d",
        batch_size,
        dry_run,
        MAX_PAIRS_PER_DISPATCH,
    )

    with get_read_connection() as read_conn:
        groups = _fetch_canonical_url_collision_groups(read_conn)

    pairs = _build_pairs(groups)
    total_pairs_found = len(pairs)
    pairs_capped = max(0, total_pairs_found - MAX_PAIRS_PER_DISPATCH)
    if pairs_capped > 0:
        pairs = pairs[:MAX_PAIRS_PER_DISPATCH]
        logger.warning(
            "canonical_url backfill: trimmed %d pairs to honor "
            "MAX_PAIRS_PER_DISPATCH=%d (found=%d)",
            pairs_capped,
            MAX_PAIRS_PER_DISPATCH,
            total_pairs_found,
        )

    total_pairs = len(pairs)
    logger.info(
        "Planning canonical_url backfill: %d groups, %d pairs after cap",
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
            "canonical_url backfill batch %d: pairs=%d similarities=%d "
            "audits=%d (dry_run=%s)",
            batches,
            len(chunk),
            sim_count,
            audit_count,
            dry_run,
        )

    summary: dict[str, Any] = {
        "groups": len(groups),
        "pairs_planned": total_pairs,
        "pairs_capped": pairs_capped,
        "similarities_written": similarities_written,
        "audits_written": audits_written,
        "batches": batches,
        "dry_run": dry_run,
    }
    logger.info(
        "canonical_url_backfill_published_documents complete: %s", summary,
    )
    return summary
