"""LIBERTASIAN Worker Service — One-shot reprocessing for degraded documents.

When a downstream-consumer bug (e.g. a PascalCase identifier in raw SQL
that resolves to ``relation "X" does not exist``) silently strips
embeddings / doctrines / citations from the post-ingestion chain, the
documents created during that window land in PostgreSQL without their
derivative artifacts. ``reprocess_documents_in_window`` walks every
``legal_documents`` row in a date window and re-fires the affected
follow-up tasks.

The reprocess is **idempotent** — for each document we skip extraction or
embedding generation if the corresponding output rows already exist. The
underlying tasks themselves are also idempotent (acks_late +
reject_on_worker_lost), so re-running this is safe.
"""

from __future__ import annotations

import logging
from typing import Any

from celery import shared_task
from pydantic import BaseModel, ConfigDict, Field

from ..clients import ingestion_db_client as db

logger = logging.getLogger(__name__)


class ReprocessWindow(BaseModel):
    """Inclusive-start / exclusive-end timestamp window for reprocessing.

    Pydantic strict mode per CLAUDE.md — silently coercing date strings
    here would mask typos in operator-supplied inputs.
    """

    model_config = ConfigDict(strict=True)

    start_date: str = Field(
        ...,
        description=(
            "Inclusive start, ISO-8601 (e.g. ``2026-04-24`` or "
            "``2026-04-24T00:00:00Z``)."
        ),
    )
    end_date: str = Field(
        ...,
        description="Exclusive end, ISO-8601.",
    )
    force: bool = Field(
        default=False,
        description=(
            "When true, dispatch tasks even for documents that already have "
            "outputs. Useful if the prior outputs are themselves suspect."
        ),
    )


@shared_task(
    name="reprocess.documents_in_window",
    bind=True,
    acks_late=True,
    reject_on_worker_lost=True,
    max_retries=0,
)
def reprocess_documents_in_window(
    self: Any,
    start_date: str,
    end_date: str,
    force: bool = False,
) -> dict[str, Any]:
    """Re-fire follow-up tasks for every ``legal_documents`` row in a window.

    Per document, dispatches:
    - ``doctrine.extract`` if no ``doctrine_extracts`` rows exist (or
      ``force``).
    - ``citation.resolve_for_document`` if any unresolved citations remain
      (or ``force``).
    - ``embedding.generate_document_embeddings`` if any section is missing
      its embedding (or ``force``).

    Args:
        start_date: Inclusive ISO-8601 start. Pass-through to PostgreSQL
            ``timestamptz`` cast.
        end_date: Exclusive ISO-8601 end.
        force: When true, dispatch follow-ups regardless of pre-existing
            outputs.

    Returns:
        Summary counters per dispatched task category.
    """
    window = ReprocessWindow(
        start_date=start_date, end_date=end_date, force=force,
    )

    # Late imports keep circular-import risk to zero — the follow-up tasks
    # share no symbols with this module beyond Celery's task registry.
    from .citation_tasks import resolve_citations_task
    from .doctrine_tasks import extract_doctrines_task
    from .embedding_tasks import generate_document_embeddings_task

    document_ids = db.get_legal_document_ids_in_window(
        window.start_date, window.end_date,
    )

    logger.info(
        "reprocess_documents_in_window: window=[%s, %s) found=%d documents "
        "force=%s",
        window.start_date,
        window.end_date,
        len(document_ids),
        window.force,
    )

    dispatched_doctrines = 0
    dispatched_citations = 0
    dispatched_embeddings = 0
    skipped_doctrines = 0
    skipped_citations = 0
    skipped_embeddings = 0

    for document_id in document_ids:
        if window.force or db.count_doctrine_extracts_for_document(document_id) == 0:
            extract_doctrines_task.delay(document_id=document_id, strategy="auto")
            dispatched_doctrines += 1
        else:
            skipped_doctrines += 1

        # Citations: re-fire resolution if there are any unresolved rows OR
        # if no citations exist yet (the extraction step may have been
        # skipped). The downstream task handles the empty case as a no-op.
        resolved = db.count_resolved_citations_for_document(document_id)
        if window.force or resolved == 0:
            resolve_citations_task.delay(document_id=document_id)
            dispatched_citations += 1
        else:
            skipped_citations += 1

        if window.force or db.count_section_embeddings_for_document(document_id) == 0:
            generate_document_embeddings_task.delay(document_id=document_id)
            dispatched_embeddings += 1
        else:
            skipped_embeddings += 1

    summary = {
        "window": {
            "start_date": window.start_date,
            "end_date": window.end_date,
            "force": window.force,
        },
        "documents_found": len(document_ids),
        "dispatched": {
            "doctrines": dispatched_doctrines,
            "citations": dispatched_citations,
            "embeddings": dispatched_embeddings,
        },
        "skipped": {
            "doctrines": skipped_doctrines,
            "citations": skipped_citations,
            "embeddings": skipped_embeddings,
        },
    }

    logger.info(
        "reprocess_documents_in_window complete: %s",
        summary,
    )
    return summary
