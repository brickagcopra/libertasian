"""LIBERTASIAN Worker Service — Classification DB client.

Read-only PostgreSQL queries for the subject classification pipeline.
Reads subjects, subject_topics, and document metadata needed for
the classify_document_subjects Celery task.
"""

from __future__ import annotations

import logging
from typing import Any

import psycopg2.extras

from .db_client import get_connection

logger = logging.getLogger(__name__)


def get_subjects_with_topics(taxonomy_version: str = "study_8") -> list[dict[str, Any]]:
    """Fetch all subjects with their topics for the given taxonomy version.

    Returns a list of subject dicts, each with a 'topics' list of topic dicts.
    Ordered by display_order.
    """
    with get_connection() as conn, \
            conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT id, code, name, description, display_order
               FROM subjects
               WHERE taxonomy_version = %s
               ORDER BY display_order ASC""",
            (taxonomy_version,),
        )
        subjects = [dict(row) for row in cur.fetchall()]

        for subject in subjects:
            cur.execute(
                """SELECT id, code, name, description, display_order
                   FROM subject_topics
                   WHERE subject_id = %s
                   ORDER BY display_order ASC""",
                (subject["id"],),
            )
            subject["topics"] = [dict(row) for row in cur.fetchall()]

    return subjects


def get_document_for_classification(document_id: str) -> dict[str, Any] | None:
    """Fetch document metadata needed for classification prompting."""
    with get_connection() as conn, \
            conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT id, title, document_type, decision_date, ponente,
                      court, citation_text, status
               FROM legal_documents
               WHERE id = %s""",
            (document_id,),
        )
        row = cur.fetchone()
        return dict(row) if row else None


def get_document_sections_for_classification(
    document_id: str,
    max_sections: int = 3,
) -> list[dict[str, Any]]:
    """Fetch the first N sections with text for classification.

    Returns sections ordered by ordering, limited to max_sections.
    """
    with get_connection() as conn, \
            conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT id, section_type, section_label, plain_text,
                      page_start, page_end, ordering
               FROM legal_document_sections
               WHERE legal_document_id = %s
               AND plain_text IS NOT NULL
               AND plain_text != ''
               ORDER BY ordering ASC
               LIMIT %s""",
            (document_id, max_sections),
        )
        return [dict(row) for row in cur.fetchall()]


def get_unclassified_document_ids(limit: int = 50) -> list[str]:
    """Find legal document IDs that have no DocumentSubjectAssignment rows.

    Returns up to `limit` document IDs, oldest first.
    """
    with get_connection() as conn, \
            conn.cursor() as cur:
        cur.execute(
            """SELECT ld.id
               FROM legal_documents ld
               LEFT JOIN document_subject_assignments dsa
                   ON dsa.legal_document_id = ld.id
               WHERE dsa.id IS NULL
               AND ld.status IN ('published', 'draft')
               ORDER BY ld.created_at ASC
               LIMIT %s""",
            (limit,),
        )
        return [row[0] for row in cur.fetchall()]


def get_existing_digest_summary(document_id: str) -> str | None:
    """Get existing digest summary for a document (if any) to aid classification."""
    with get_connection() as conn, \
            conn.cursor() as cur:
        cur.execute(
            """SELECT summary
               FROM digests
               WHERE legal_document_id = %s
               AND summary IS NOT NULL
               ORDER BY created_at DESC
               LIMIT 1""",
            (document_id,),
        )
        row = cur.fetchone()
        return row[0] if row else None
