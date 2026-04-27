"""LIBERTASIAN Worker Service — One-shot backfill of citation extraction
for corpus documents ingested before PR #84.

PR #84 wired ``citation.extract_for_document`` into the post-ingestion
chain so newly-ingested docs populate the ``citations`` graph during
ingestion. The ~685 documents already in ``legal_documents`` at deploy
time skipped that step. This orchestrator walks them and dispatches
``citation.extract_for_document`` per doc.

Idempotent: the keyset page filters out any doc that already has at
least one citation row. Re-runs after a partial sweep no-op those docs.
The downstream task itself is idempotent at the ``citations`` partial
unique index, so even a duplicate dispatch is safe.
"""

from __future__ import annotations

import logging
from typing import Any

from celery import shared_task

from ..clients import ingestion_db_client as db

logger = logging.getLogger(__name__)


_PAGE_SIZE = 50


@shared_task(
    name="citations.backfill_corpus_documents",
    bind=True,
    acks_late=True,
    reject_on_worker_lost=True,
    max_retries=0,
)
def backfill_corpus_documents(
    self: Any,
    limit: int | None = None,
    after_cursor: str | None = None,
) -> dict[str, Any]:
    """Dispatch ``citation.extract_for_document`` for every corpus doc that
    has zero citation rows.

    Args:
        limit: Cap on dispatches per invocation. ``None`` = no cap; walk
            until the keyset page comes back short.
        after_cursor: ``legal_documents.id`` to resume after. ``None`` starts
            from the lowest id. Returned ``last_cursor`` is meant to be
            fed back in for resumed runs.

    Returns:
        ``{dispatched, skipped_already_has_citations, last_cursor}``.
        ``last_cursor=None`` means the walk reached the end.
    """
    from .citation_tasks import extract_citations_for_document

    dispatched = 0
    cursor = after_cursor
    end_cursor_inclusive: str | None = None
    last_cursor: str | None = None

    while True:
        remaining = None if limit is None else max(0, limit - dispatched)
        page_size = _PAGE_SIZE if remaining is None else min(_PAGE_SIZE, remaining)
        if page_size == 0:
            last_cursor = cursor
            break

        page = db.get_corpus_doc_ids_missing_citations_after(cursor, page_size)
        if not page:
            last_cursor = None
            break

        for doc_id in page:
            extract_citations_for_document.delay(legal_document_id=doc_id)
            dispatched += 1

        cursor = page[-1]
        end_cursor_inclusive = cursor

        # Short page = no rows match the filter past this point. End of walk.
        if len(page) < page_size:
            last_cursor = None
            break

        # Hit the limit exactly on a full page — surface a resumable cursor.
        if limit is not None and dispatched >= limit:
            last_cursor = cursor
            break

    skipped = db.count_corpus_docs_with_citations_in_range(
        after_cursor,
        end_cursor_inclusive if last_cursor is not None else None,
    )

    summary: dict[str, Any] = {
        "dispatched": dispatched,
        "skipped_already_has_citations": skipped,
        "last_cursor": last_cursor,
    }
    logger.info("backfill_corpus_documents complete: %s", summary)
    return summary
