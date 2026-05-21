"""LIBERTASIAN Worker Service — One-shot backfill of ``legal_documents.ponente``
for rows where the metadata extractor previously persisted garbage values.

Context: the v1 ponente extractor did not recognise the spaced-out
``D E C I S I O N`` header that lawphil and SC E-Library dumps routinely
use, and the bare-name ``JUSTICE_PATTERN`` would then match the wrong
substring — frequently capturing the case caption verbatim. Prod sample
counted ~834 rows with values like ``"D E C I S I O N PERALTA"``,
``"PEOPLE OF THE PHILIPPINES, ... D E C I S I O N ROSARIO"``, or other
caption fragments.

This task re-parses the ponente field from each affected document's
section bodies (or, as a fallback, the document's plain text) using the
fixed extractor logic and updates the row in place.

**Manual trigger only** — NOT scheduled on the Celery beat. Fire from a
worker shell, e.g.:

    docker compose -f docker-compose.prod.yml exec worker-service \\
        uv run python -m src.tasks.backfill_ponente_task --dry-run

    docker compose -f docker-compose.prod.yml exec worker-service \\
        uv run python -m src.tasks.backfill_ponente_task --commit --batch=100

Idempotent: rows whose ponente no longer matches the garbage pattern (or
whose re-parse yields the same value) are skipped.
"""

from __future__ import annotations

import argparse
import logging
import sys
from typing import Any

import psycopg2
import psycopg2.extras
from celery import shared_task

from ..clients.db_client import get_connection
from ..parsers.metadata_extractor import _extract_ponente

logger = logging.getLogger(__name__)


# Pattern of "bad" ponente values that need re-parsing. The
# legal_documents.ponente column should never legitimately contain these
# tokens — see _CAPTION_REJECT_TOKENS in parsers/metadata_extractor.py.
_BAD_PONENTE_SQL = """
    ponente IS NOT NULL
    AND (
        LENGTH(ponente) > 40
        OR ponente ILIKE '%%DECISION%%'
        OR ponente ILIKE '%%RESOLUTION%%'
        OR ponente ILIKE '%%D E C I S I O N%%'
        OR ponente ILIKE '%%R E S O L U T I O N%%'
        OR ponente ILIKE '%% VS %%'
        OR ponente ILIKE '%% VS. %%'
        OR ponente ILIKE '%% V. %%'
        OR ponente ILIKE '%%PETITIONER%%'
        OR ponente ILIKE '%%RESPONDENT%%'
    )
"""


def _fetch_candidate_batch(
    conn: Any,
    *,
    batch: int,
    after_id: str | None,
) -> list[dict[str, Any]]:
    """Return the next batch of legal_documents with bad ponente values.

    Cursor-based pagination on ``id`` — safe against concurrent updates
    (the just-updated rows fall out of the WHERE clause naturally).
    """
    after_clause = "AND id > %s" if after_id else ""
    params: list[Any] = []
    if after_id:
        params.append(after_id)
    params.append(batch)
    sql = f"""
        SELECT id, ponente
        FROM legal_documents
        WHERE {_BAD_PONENTE_SQL}
        {after_clause}
        ORDER BY id ASC
        LIMIT %s
    """
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(sql, tuple(params))
        return [dict(r) for r in cur.fetchall()]


def _fetch_header_text(conn: Any, document_id: str) -> str | None:
    """Return the document's section bodies (concatenated, header-area only).

    Prefers ``legal_document_sections.body`` for richer source text; falls
    back to a NULL return if no sections exist (caller skips the row).
    """
    with conn.cursor() as cur:
        cur.execute(
            """SELECT plain_text
               FROM legal_document_sections
               WHERE legal_document_id = %s
                 AND plain_text IS NOT NULL
               ORDER BY ordering ASC
               LIMIT 5""",
            (document_id,),
        )
        rows = cur.fetchall()
    if not rows:
        return None
    parts = [row[0] for row in rows if row[0]]
    if not parts:
        return None
    # Only the header area (first ~3000 chars) is used by the extractor.
    return "\n\n".join(parts)[:6000]


def _update_ponente(conn: Any, document_id: str, ponente: str | None) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE legal_documents SET ponente = %s WHERE id = %s",
            (ponente, document_id),
        )


def run_backfill(*, dry_run: bool, batch: int, limit: int | None) -> dict[str, int]:
    """Iterate bad-ponente rows and re-parse from sections.

    Returns counters: ``processed``, ``updated``, ``cleared``,
    ``unchanged``, ``no_sections``.
    """
    counters = {
        "processed": 0,
        "updated": 0,
        "cleared": 0,
        "unchanged": 0,
        "no_sections": 0,
    }
    after_id: str | None = None
    previews_shown = 0
    while True:
        if limit is not None and counters["processed"] >= limit:
            break
        remaining = (
            limit - counters["processed"] if limit is not None else None
        )
        take = min(batch, remaining) if remaining is not None else batch

        with get_connection() as conn:
            rows = _fetch_candidate_batch(conn, batch=take, after_id=after_id)
            if not rows:
                break
            for row in rows:
                counters["processed"] += 1
                after_id = str(row["id"])
                doc_id = str(row["id"])
                header = _fetch_header_text(conn, doc_id)
                if not header:
                    counters["no_sections"] += 1
                    continue
                new_ponente = _extract_ponente(header)
                if new_ponente == row["ponente"]:
                    counters["unchanged"] += 1
                    continue
                if previews_shown < 3:
                    previews_shown += 1
                    logger.info(
                        "preview %d (id=%s): %r -> %r",
                        previews_shown,
                        doc_id,
                        row["ponente"],
                        new_ponente,
                    )
                if not dry_run:
                    _update_ponente(conn, doc_id, new_ponente)
                if new_ponente is None:
                    counters["cleared"] += 1
                else:
                    counters["updated"] += 1
        logger.info("batch counters: %s", counters)
        if len(rows) < take:
            break

    return counters


@shared_task(name="backfill.ponente_garbage_rows")
def backfill_ponente_garbage_rows_task(
    dry_run: bool = True,
    batch: int = 100,
    limit: int | None = None,
) -> dict[str, int]:
    """Celery task wrapper. Manual dispatch only — not on beat schedule."""
    return run_backfill(dry_run=dry_run, batch=batch, limit=limit)


def _cli() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", default=True)
    parser.add_argument("--commit", action="store_true", default=False)
    parser.add_argument("--batch", type=int, default=100)
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()

    dry_run = True
    if args.commit:
        dry_run = False

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    counters = run_backfill(
        dry_run=dry_run, batch=args.batch, limit=args.limit
    )
    print("counters:", counters)
    if dry_run:
        print("Dry run only — re-run with --commit to apply.")
    return 0


if __name__ == "__main__":
    sys.exit(_cli())
