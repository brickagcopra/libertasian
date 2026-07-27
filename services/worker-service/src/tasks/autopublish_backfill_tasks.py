"""LIBERTASIAN Worker Service — Re-validation backfill for drafts stranded by
the unreachable citation gate.

``truthfulness_validator.citation_mapping`` used to be a blocking check
requiring ``resolved_citations / total_citations >= 0.8``. Measured on prod
2026-07-27 the corpus-wide resolution ratio is median 0.000 / mean 0.024 over
~16 citations per document, so the check failed 13,025 of 13,093 drafts. Every
one of those documents has sections, a source, a high-trust source, and (bar
one) a decision date — they are complete. Auto-publish stopped at ``created_at``
2026-05-30 while ingestion kept running to 2026-07-10, leaving 76% of
``legal_documents`` in ``status='draft'`` and therefore out of OpenSearch.
Searching a stranded document's exact title returns a different case.

The validator now treats ``citation_mapping`` as advisory. This task re-runs
``validate_document`` over every ``status='draft'`` row under the corrected
rules and publishes the ones that come back ``PUBLISH``, triggering OpenSearch
indexing for each so the published row is actually searchable.

DRY RUN BY DEFAULT. ``dry_run=True`` reads only: no document is published, no
audit row is written, no index is triggered. The report is the deliverable —
verdict distribution, how many would publish, and which blocking checks account
for the rest.

What this task deliberately does NOT do:

- **It never quarantines.** A ``QUARANTINE`` verdict here is reported and the
  row is left alone. Quarantining thousands of rows in a sweep is an editorial
  decision, not a side effect of a search-visibility fix.
- **It never touches already-published rows.** 3,909 of the 4,042 published
  documents also fail the citation check (they were published before it
  existed). They are already searchable; re-validating them could only take
  visibility away.
- **It does not re-run or fix the citation resolver.** The resolver resolving
  ~0% of ~16 citations per document is a separate defect, tracked separately.
  This task changes nothing about citation data.

Idempotent: rows are selected by ``status='draft'``, and publishing flips
``status`` to ``'published'``, so a re-run sees a strictly smaller set. Rows
already ``verified``/``quarantined`` are skipped the same way
``ingestion.validate_and_publish`` skips them.
"""

from __future__ import annotations

import logging
from collections import Counter
from collections.abc import Callable, Iterator
from typing import Any

from celery import shared_task

from ..clients import ingestion_db_client as db
from ..clients import nestjs_client
from ..validators.truthfulness_validator import ValidationResult, Verdict, validate_document

logger = logging.getLogger(__name__)

PAGE_SIZE = 500

# Log a progress line every N documents scanned. 13k rows at one page query
# per 500 is fast, but an --apply run does an HTTP index call per publish.
PROGRESS_EVERY = 1000

# Statuses that mean a human or an earlier run already settled this document.
SETTLED_STATUSES = ("verified", "quarantined")


def iter_draft_documents(
    limit: int | None = None,
    page_size: int = PAGE_SIZE,
) -> Iterator[dict[str, Any]]:
    """Keyset-walk ``status='draft'`` documents, oldest id first.

    Reads through the replica DSN when one is configured. The cursor is the
    row ``id`` as ``str``; psycopg2 adapts it back to uuid on the next page.
    """
    cursor: str | None = None
    yielded = 0

    while True:
        page = db.get_draft_documents_for_validation_after(cursor, page_size)
        if not page:
            return

        for row in page:
            yield row
            yielded += 1
            if limit is not None and yielded >= limit:
                return

        if len(page) < page_size:
            return
        cursor = str(page[-1]["id"])


def validate_row(row: dict[str, Any]) -> ValidationResult:
    """Run ``validate_document`` over one page row.

    ``is_from_scan=False`` / ``ocr_confidence=None`` mirror
    ``ingestion.validate_and_publish``: these are crawler-ingested corpus
    documents, never camera scans, and carry no OCR confidence. Feeding a
    different assumption here would make the backfill's verdict disagree with
    the verdict the live pipeline produces for the same row.
    """
    decision_date = row.get("decision_date")
    return validate_document(
        title=row.get("title"),
        document_type=row.get("document_type"),
        court=row.get("court"),
        decision_date=str(decision_date) if decision_date else None,
        gr_no=row.get("gr_no"),
        status=row.get("status", "draft"),
        truthfulness_status=row.get("truthfulness_status", ""),
        is_published=bool(row.get("is_published")),
        source_trust_level=row.get("source_trust_level"),
        section_count=int(row.get("section_count") or 0),
        is_from_scan=False,
        ocr_confidence=None,
        open_flags=list(row.get("open_flags") or []),
        total_citations=int(row.get("total_citations") or 0),
        resolved_citations=int(row.get("resolved_citations") or 0),
    )


def _publish(document_id: str, result: ValidationResult) -> bool:
    """Publish one document and trigger indexing. Returns index success.

    Mirrors the PUBLISH branch of ``ingestion.validate_and_publish`` exactly,
    including the audit entry, so a backfilled publish is indistinguishable
    from one the pipeline made — apart from ``source``, which names this task.
    """
    db.publish_document(document_id)
    indexed = nestjs_client.trigger_opensearch_index(document_id)
    if not indexed:
        logger.warning(
            "OpenSearch indexing failed for backfilled document %s "
            "(published in PostgreSQL but not yet searchable)",
            document_id,
        )
    db.create_audit_log(
        action="document.auto_publish",
        entity_type="legal_document",
        entity_id=document_id,
        metadata={
            "confidence_score": result.confidence_score,
            "reasons": result.reasons,
            "source": "backfill_autopublish_drafts",
            "opensearch_indexed": indexed,
        },
    )
    return indexed


def run_backfill(
    *,
    dry_run: bool = True,
    limit: int | None = None,
    page_size: int = PAGE_SIZE,
    on_progress: Callable[[dict[str, Any]], None] | None = None,
) -> dict[str, Any]:
    """Re-validate every draft document and publish the ones that pass.

    Args:
        dry_run: When ``True`` (default) nothing is written — no publish, no
            audit row, no index trigger. The returned report still describes
            exactly what an ``--apply`` run would do.
        limit: Stop after N draft rows. ``None`` walks the whole corpus.
        page_size: Rows per keyset page.
        on_progress: Optional callback invoked every ``PROGRESS_EVERY`` rows
            with the running report, so a CLI can show progress on a sweep of
            13k rows.

    Returns:
        A report dict: ``scanned``, ``verdicts`` (verdict → count),
        ``would_publish`` (PUBLISH verdicts) vs ``published`` (rows actually
        written — 0 on a dry run), ``publishes_with_failing_citation_check``
        (documents the old blocking gate was holding), ``blocking_failures``
        (check name → count across HUMAN_REVIEW rows), ``quarantine_reasons``,
        ``index_failures``, ``publish_errors``, ``skipped_already_settled``.
    """
    verdicts: Counter[str] = Counter()
    blocking_failures: Counter[str] = Counter()
    quarantine_reasons: Counter[str] = Counter()
    scanned = 0
    skipped_settled = 0
    published = 0
    advisory_only = 0
    index_failures = 0
    publish_errors = 0
    error_samples: list[dict[str, str]] = []

    def _report() -> dict[str, Any]:
        return {
            "dry_run": dry_run,
            "scanned": scanned,
            "skipped_already_settled": skipped_settled,
            "verdicts": dict(verdicts),
            # would_publish is the verdict count; published is what was
            # actually written. They differ on a dry run (published stays 0)
            # and on an --apply run that hit per-row errors.
            "would_publish": verdicts.get(Verdict.PUBLISH.value, 0),
            "published": published,
            "publishes_with_failing_citation_check": advisory_only,
            "blocking_failures": dict(blocking_failures),
            "quarantine_reasons": dict(quarantine_reasons),
            "index_failures": index_failures,
            "publish_errors": publish_errors,
            "error_samples": error_samples[:5],
        }

    logger.info(
        "backfill_autopublish_drafts start: dry_run=%s limit=%s page_size=%d",
        dry_run,
        limit,
        page_size,
    )

    for row in iter_draft_documents(limit=limit, page_size=page_size):
        scanned += 1
        document_id = str(row["id"])

        if row.get("truthfulness_status") in SETTLED_STATUSES:
            skipped_settled += 1
            continue

        result = validate_row(row)
        verdicts[result.verdict.value] += 1

        if result.verdict == Verdict.PUBLISH:
            # The number this backfill exists for: a document that publishes
            # while the citation check fails is one the old blocking gate held.
            if any(c.advisory and not c.passed for c in result.checks):
                advisory_only += 1
            if not dry_run:
                try:
                    if not _publish(document_id, result):
                        index_failures += 1
                    published += 1
                except Exception as exc:  # noqa: BLE001 — one bad row must not
                    # abort a 13k-row sweep; the id is recorded and reported.
                    publish_errors += 1
                    error_samples.append({"document_id": document_id, "error": str(exc)})
                    logger.exception("Failed to publish document %s", document_id)
        elif result.verdict == Verdict.HUMAN_REVIEW:
            for check in result.checks:
                if not check.advisory and not check.passed:
                    blocking_failures[check.name] += 1
        else:
            for reason in result.reasons:
                quarantine_reasons[reason.split("(")[0].strip()] += 1

        if on_progress is not None and scanned % PROGRESS_EVERY == 0:
            on_progress(_report())

    report = _report()
    logger.info("backfill_autopublish_drafts complete: %s", report)
    return report


@shared_task(
    name="ingestion.backfill_autopublish_drafts",
    bind=True,
    acks_late=True,
    reject_on_worker_lost=True,
    max_retries=0,
)
def backfill_autopublish_drafts(
    self: Any,
    dry_run: bool = True,
    limit: int | None = None,
    page_size: int = PAGE_SIZE,
) -> dict[str, Any]:
    """Celery entry point for :func:`run_backfill`. Dry run unless told otherwise.

    ``max_retries=0`` on purpose: a partial sweep is safe to re-dispatch by
    hand (published rows drop out of the ``status='draft'`` selection), but an
    automatic retry of a 13k-row publish sweep is not something to trigger on a
    transient error.
    """
    return run_backfill(dry_run=dry_run, limit=limit, page_size=page_size)
