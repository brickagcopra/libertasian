"""Re-validate stranded draft documents and report what would publish.

Thin CLI over ``src.tasks.autopublish_backfill_tasks.run_backfill`` — same code
path the Celery task runs, so the dry-run report is evidence about the task,
not about a parallel implementation.

Why this exists: ``citation_mapping`` was a blocking check requiring an 80%
citation resolution ratio against a resolver whose real-world ratio is ~0
(median 0.000, mean 0.024 over ~16 citations per document, prod 2026-07-27).
It failed 13,025 of 13,093 drafts and stopped auto-publish dead on 2026-05-30,
leaving 76% of ``legal_documents`` unsearchable. The validator now treats that
check as advisory; this sweep applies the corrected rules to the rows the old
gate stranded.

The dry-run output over live rows is the acceptance evidence for that change.
A fixture where citations resolve at 90% would pass every unit test while
saying nothing about a corpus that resolves at 0%.

Usage (from services/worker-service/):

    # dry run over the whole draft corpus — writes nothing
    uv run python -m src.scripts.backfill_autopublish_drafts

    # dry run over the first 500 drafts
    uv run python -m src.scripts.backfill_autopublish_drafts --limit 500

    # publish for real (both gates required)
    AUTOPUBLISH_BACKFILL_ALLOW_WRITE=1 \
        uv run python -m src.scripts.backfill_autopublish_drafts --apply

``--apply`` publishes documents and triggers one OpenSearch index call each.
It is a production operation: run the dry run first and read the verdict
distribution before considering it.
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from typing import Any

from ..tasks.autopublish_backfill_tasks import PAGE_SIZE, run_backfill

logger = logging.getLogger(__name__)

WRITE_ENV_VAR = "AUTOPUBLISH_BACKFILL_ALLOW_WRITE"


def _print_progress(report: dict[str, Any]) -> None:
    print(
        f"  … scanned {report['scanned']}  "
        f"publish={report['verdicts'].get('publish', 0)}  "
        f"review={report['verdicts'].get('human_review', 0)}  "
        f"quarantine={report['verdicts'].get('quarantine', 0)}",
        file=sys.stderr,
        flush=True,
    )


def _print_distribution(title: str, counts: dict[str, int], total: int) -> None:
    if not counts:
        return
    print()
    print(title)
    width = max(len(k) for k in counts)
    for key, count in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0])):
        share = f"{count / total:.1%}" if total else "—"
        print(f"  {key:<{width}}  {count:>8}  {share:>7}")


def print_report(report: dict[str, Any]) -> None:
    """Human-readable rendering of the report dict from ``run_backfill``."""
    scanned = report["scanned"]
    verdicts: dict[str, int] = report["verdicts"]
    decided = sum(verdicts.values())

    print()
    print("=" * 72)
    print("Draft re-validation under the corrected rules "
          "(citation_mapping advisory)")
    print("=" * 72)
    print(f"  draft rows scanned            {scanned:>8}")
    if report["skipped_already_settled"]:
        print(
            "  skipped (already settled)     "
            f"{report['skipped_already_settled']:>8}"
        )

    _print_distribution("Verdict distribution:", verdicts, decided)

    print()
    print(f"  WOULD PUBLISH                 {report['would_publish']:>8}")
    print(
        "    of which the old blocking citation gate was holding: "
        f"{report['publishes_with_failing_citation_check']}"
    )

    _print_distribution(
        "Blocking checks failed by the documents that still go to review "
        "(a row can fail more than one):",
        report["blocking_failures"],
        verdicts.get("human_review", 0),
    )
    _print_distribution(
        "Quarantine reasons:",
        report["quarantine_reasons"],
        verdicts.get("quarantine", 0),
    )

    print()
    if report["dry_run"]:
        print("Dry run — nothing was published, indexed, or audited.")
        print(
            f"Re-run with --apply and {WRITE_ENV_VAR}=1 to publish "
            "the rows above."
        )
    else:
        print(f"Published                       {report['published']:>8}")
        print(f"OpenSearch index failures       {report['index_failures']:>8}")
        print(f"Publish errors                  {report['publish_errors']:>8}")
        for sample in report["error_samples"]:
            print(f"    {sample['document_id']}: {sample['error']}")
        if report["index_failures"]:
            print()
            print(
                "Documents whose index call failed are published in PostgreSQL "
                "but NOT searchable. Re-run the indexing trigger for them."
            )


def main_with_args(argv: list[str] | None = None) -> int:
    """Entry point taking explicit argv so tests can drive the whole path."""
    parser = argparse.ArgumentParser(
        description="Re-validate status='draft' legal documents under the "
        "corrected auto-publish rules and report what would publish. Dry run "
        f"unless --apply and {WRITE_ENV_VAR}=1 both hold.",
    )
    parser.add_argument(
        "--limit", type=int, default=None, help="Stop after N draft rows."
    )
    parser.add_argument(
        "--page-size", type=int, default=PAGE_SIZE, help="Rows per keyset page."
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help=f"Publish for real. Requires {WRITE_ENV_VAR}=1.",
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

    if args.apply and os.environ.get(WRITE_ENV_VAR) != "1":
        print(
            f"Refusing to write: --apply was passed but {WRITE_ENV_VAR}=1 is "
            "not set. This publishes documents into the public corpus and "
            "pushes them to OpenSearch.",
            file=sys.stderr,
        )
        return 2

    report = run_backfill(
        dry_run=not args.apply,
        limit=args.limit,
        page_size=args.page_size,
        on_progress=_print_progress,
    )
    print_report(report)
    return 0


def main() -> int:
    """Console entry point — reads sys.argv."""
    return main_with_args(None)


if __name__ == "__main__":
    raise SystemExit(main())
