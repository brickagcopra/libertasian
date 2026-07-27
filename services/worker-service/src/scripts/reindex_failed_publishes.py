"""Re-trigger OpenSearch indexing for documents whose index call failed.

## Why this exists

The index trigger fires *after* the publish is committed to PostgreSQL, so a
failed trigger is silent: the document is live, `status='published'`, and
absent from the search index. During the #322 backfill 11,561 documents
published and 5,220 index triggers failed — every one a 429 from the gateway
throttler, discarded by a client that did not retry. The only recovery
available at the time was a wholesale index rebuild, which is a heavy,
all-or-nothing operation for what was a 45% partial failure.

This script is the targeted recovery. It reads back the very audit rows the
publish path wrote (``document.auto_publish`` carries
``metadata_json->>'opensearch_indexed'``), re-triggers indexing for the ones
that record a failure, and records what it did.

## The latest-row-per-document rule

A document can have several ``document.auto_publish`` rows, and this script
adds ``search.index.reindex`` rows of its own. Only the **most recent** row per
``entity_id`` decides whether the document still needs work. Filtering on
``opensearch_indexed = 'false'`` inside the SQL ``WHERE`` would break that: it
would find an old failure row for a document that has since been indexed
successfully and re-process it forever. So the query ranks *all* of a
document's rows, takes the latest, and the flag is read from that one row.

That rule is also what makes the script idempotent. A successful re-index
writes a newer row saying ``opensearch_indexed: true``, so the next run does
not see the document at all.

## Append-only

``audit_logs`` is append-only — the application DB role holds no ``UPDATE`` or
``DELETE`` on it (CLAUDE.md, Philippine Data Privacy Act retention). The
original failure row is never modified. A success writes a **new** row; a
failure writes nothing and the document id goes to the still-failing file
instead, so a re-run picks it up again.

## Usage (from services/worker-service/)

    # dry run — reads only, writes nothing (default)
    uv run python -m src.scripts.reindex_failed_publishes

    # re-index for real
    uv run python -m src.scripts.reindex_failed_publishes --apply

    # cap the work and choose where failures are written
    uv run python -m src.scripts.reindex_failed_publishes --apply \\
        --limit 500 --failures-file /tmp/still-failing.txt

An ``--apply`` run makes one HTTP call per candidate document against the
NestJS internal index endpoint. That endpoint no longer throttles the worker
and the client now retries, so the failure mode this script recovers from
should not recur — but the script stays as the recovery path regardless.
"""

from __future__ import annotations

import argparse
import logging
import sys
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import psycopg2.extras

from ..clients import ingestion_db_client as db
from ..clients import nestjs_client
from ..clients.db_client import get_connection

logger = logging.getLogger(__name__)

PAGE_SIZE = 500
PROGRESS_EVERY = 200

# The publish path's action, and this script's own. Both are ranked when
# deciding a document's latest state — see the module docstring.
ACTION_AUTO_PUBLISH = "document.auto_publish"
ACTION_REINDEX = "search.index.reindex"
RANKED_ACTIONS = (ACTION_AUTO_PUBLISH, ACTION_REINDEX)

ENTITY_TYPE = "legal_document"

DEFAULT_FAILURES_FILE = "reindex_still_failing.txt"


def iter_latest_audit_rows(page_size: int = PAGE_SIZE) -> Iterator[dict[str, Any]]:
    """Yield the latest ranked audit row per ``entity_id``, keyset-paginated.

    ``DISTINCT ON (entity_id)`` with ``ORDER BY entity_id, created_at DESC``
    collapses each document to its most recent row. The ``opensearch_indexed``
    flag is deliberately NOT in the ``WHERE`` clause — filtering there would
    select the latest *failure* rather than the latest row, and would keep
    re-processing documents that have since been indexed.

    ``entity_id`` is ``@db.Uuid``; it is cast as ``uuid`` in the cursor
    comparison. Casting to ``text`` would order lexicographically and silently
    skip rows (that was #314).
    """
    last_id: str | None = None
    while True:
        with get_connection() as conn, conn.cursor(
            cursor_factory=psycopg2.extras.RealDictCursor
        ) as cur:
            cur.execute(
                """SELECT DISTINCT ON (entity_id)
                          entity_id,
                          id AS audit_id,
                          action,
                          created_at,
                          metadata_json->>'opensearch_indexed' AS indexed_flag,
                          metadata_json->>'source' AS source
                     FROM audit_logs
                    WHERE action = ANY(%s)
                      AND entity_type = %s
                      AND entity_id IS NOT NULL
                      AND (%s::uuid IS NULL OR entity_id > %s::uuid)
                    ORDER BY entity_id, created_at DESC, id DESC
                    LIMIT %s""",
                (
                    list(RANKED_ACTIONS),
                    ENTITY_TYPE,
                    last_id,
                    last_id,
                    page_size,
                ),
            )
            rows = [dict(r) for r in cur.fetchall()]

        if not rows:
            return
        yield from rows
        if len(rows) < page_size:
            return
        last_id = str(rows[-1]["entity_id"])


def needs_reindex(row: dict[str, Any]) -> bool:
    """True when this document's latest audit row records a failed index.

    The flag is written by the publish path as a JSON boolean, so ``->>``
    renders it ``'false'``. A missing flag means the row predates the flag and
    says nothing about search visibility — it is not evidence of failure, so
    it is left alone rather than re-indexed on a guess.
    """
    return row.get("indexed_flag") == "false"


def reindex_one(document_id: str, audit_id: str | None = None) -> bool:
    """Re-trigger indexing for one document and audit the success.

    Returns whether indexing succeeded. On failure nothing is written: the
    original row stays the document's latest state, so the next run finds it
    again. ``audit_logs`` is append-only — the failure row is never updated.
    """
    indexed = nestjs_client.trigger_opensearch_index(document_id)
    if not indexed:
        logger.warning(
            "Re-index still failing for document %s (published in PostgreSQL "
            "but not searchable)",
            document_id,
        )
        return False

    db.create_audit_log(
        action=ACTION_REINDEX,
        entity_type=ENTITY_TYPE,
        entity_id=document_id,
        metadata={
            "opensearch_indexed": True,
            "source": "reindex_failed_publishes",
            "recovered_from_audit_id": str(audit_id) if audit_id else None,
        },
    )
    return True


def run_reindex(
    *,
    dry_run: bool = True,
    limit: int | None = None,
    page_size: int = PAGE_SIZE,
    on_progress: Callable[[dict[str, Any]], None] | None = None,
) -> dict[str, Any]:
    """Re-index every document whose latest audit row reports a failed index.

    Args:
        dry_run: When ``True`` (default) nothing is written — no index call,
            no audit row. The report still names every candidate.
        limit: Stop after N candidate documents (not N rows scanned).
        page_size: Rows per keyset page.
        on_progress: Called every ``PROGRESS_EVERY`` candidates with the
            running report.

    Returns:
        ``scanned`` (documents whose audit history was examined),
        ``candidates`` (latest row says the index failed), ``reindexed``
        (0 on a dry run), ``still_failing``, ``still_failing_ids``,
        ``sources`` (which writer produced the failure rows), ``dry_run``.
    """
    scanned = 0
    candidates = 0
    reindexed = 0
    still_failing: list[str] = []
    sources: dict[str, int] = {}

    def report() -> dict[str, Any]:
        return {
            "scanned": scanned,
            "candidates": candidates,
            "reindexed": reindexed,
            "still_failing": len(still_failing),
            "still_failing_ids": still_failing,
            "sources": dict(sources),
            "dry_run": dry_run,
        }

    for row in iter_latest_audit_rows(page_size=page_size):
        scanned += 1
        if not needs_reindex(row):
            continue

        candidates += 1
        source = row.get("source") or "unknown"
        sources[source] = sources.get(source, 0) + 1
        document_id = str(row["entity_id"])

        if not dry_run:
            if reindex_one(document_id, row.get("audit_id")):
                reindexed += 1
            else:
                still_failing.append(document_id)
        else:
            still_failing.append(document_id)

        if on_progress and candidates % PROGRESS_EVERY == 0:
            on_progress(report())

        if limit is not None and candidates >= limit:
            break

    return report()


def write_failures_file(path: str, document_ids: list[str], dry_run: bool) -> None:
    """Write the still-failing document ids, one per line.

    Written on a dry run too — there it is the *candidate* list, which is the
    thing worth reviewing before committing to an ``--apply`` run.
    """
    header = (
        "# candidates (dry run — nothing was re-indexed)"
        if dry_run
        else "# still failing after re-index"
    )
    Path(path).write_text(
        header + "\n" + "".join(f"{doc_id}\n" for doc_id in document_ids),
        encoding="utf-8",
    )


def _print_progress(report: dict[str, Any]) -> None:
    print(
        f"  … scanned {report['scanned']}  candidates {report['candidates']}  "
        f"reindexed {report['reindexed']}",
        file=sys.stderr,
        flush=True,
    )


def print_report(report: dict[str, Any], failures_file: str | None) -> None:
    """Human-readable rendering of the report from ``run_reindex``."""
    print()
    print("=" * 72)
    print("OpenSearch re-index of documents whose publish-time index failed")
    print("=" * 72)
    print(f"  documents scanned             {report['scanned']:>8}")
    print(f"  candidates (index failed)     {report['candidates']:>8}")

    if report["sources"]:
        print()
        print("  Failure rows by writer:")
        width = max(len(k) for k in report["sources"])
        for source, count in sorted(
            report["sources"].items(), key=lambda kv: (-kv[1], kv[0])
        ):
            print(f"    {source:<{width}}  {count:>8}")

    print()
    if report["dry_run"]:
        print("Dry run — nothing was indexed and no audit row was written.")
        print("Re-run with --apply to re-index the documents above.")
    else:
        print(f"  re-indexed                    {report['reindexed']:>8}")
        print(f"  still failing                 {report['still_failing']:>8}")
        if report["still_failing"]:
            print()
            print(
                "Documents still failing are published in PostgreSQL but NOT "
                "searchable. Their original audit rows are untouched, so a "
                "re-run picks them up again."
            )

    if failures_file and report["still_failing_ids"]:
        print()
        label = "Candidate" if report["dry_run"] else "Still-failing"
        print(f"{label} ids written to {failures_file}")


def main_with_args(argv: list[str] | None = None) -> int:
    """Entry point taking explicit argv so tests can drive the whole path."""
    parser = argparse.ArgumentParser(
        description=(
            "Re-trigger OpenSearch indexing for published documents whose "
            "index call failed at publish time. Dry run unless --apply."
        ),
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Re-index for real. Without it the run is a dry run.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Explicitly request the default behaviour (reads only).",
    )
    parser.add_argument(
        "--limit", type=int, default=None,
        help="Stop after N candidate documents.",
    )
    parser.add_argument(
        "--page-size", type=int, default=PAGE_SIZE, help="Rows per keyset page."
    )
    parser.add_argument(
        "--failures-file",
        default=DEFAULT_FAILURES_FILE,
        help=(
            "Where to write the ids still failing (or, on a dry run, the "
            f"candidates). Default: {DEFAULT_FAILURES_FILE}"
        ),
    )
    parser.add_argument(
        "--log-level",
        default="WARNING",
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
    )
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=getattr(logging, args.log_level),
        format="%(levelname)s %(name)s: %(message)s",
    )

    if args.apply and args.dry_run:
        print(
            "--apply and --dry-run are mutually exclusive.", file=sys.stderr
        )
        return 2

    report = run_reindex(
        dry_run=not args.apply,
        limit=args.limit,
        page_size=args.page_size,
        on_progress=_print_progress,
    )

    if args.failures_file and report["still_failing_ids"]:
        write_failures_file(
            args.failures_file, report["still_failing_ids"], report["dry_run"]
        )

    print_report(report, args.failures_file)
    return 0


def main() -> int:
    """Console entry point — reads sys.argv."""
    return main_with_args(None)


if __name__ == "__main__":
    raise SystemExit(main())
