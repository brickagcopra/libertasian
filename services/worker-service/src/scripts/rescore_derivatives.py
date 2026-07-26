"""Re-score persisted derivative artifacts under the corrected confidence formula.

Every non-MCQ derivative type was structurally incapable of reaching the 0.70
auto-approval bar until the source_passage_coverage denominator was fixed (see
src/scoring.py). Rows written before that fix carry the old, capped score, so
POST /admin/derivatives/bulk-approve-by-confidence keeps returning 0 candidates
for them until they are re-scored.

DRY RUN BY DEFAULT. Writing requires BOTH ``--apply`` and
``RESCORE_ALLOW_WRITE=1`` in the environment, because this rewrites the column
an editorial approval gate reads across the whole corpus. Run the dry run,
read the distribution table, and decide from it.

Usage (from services/worker-service/):

    # dry run, everything, prints the before/after distribution per type
    uv run python -m src.scripts.rescore_derivatives

    # dry run, one type, first 500 rows
    uv run python -m src.scripts.rescore_derivatives --type flashcard --limit 500

    # actually write (both guards required)
    RESCORE_ALLOW_WRITE=1 uv run python -m src.scripts.rescore_derivatives --apply

Caveat worth knowing before reading the output: the score is recomputed from
the PERSISTED content_json, which already had non-UUID and unknown section IDs
stripped at write time (see _build_derivative_cards and its siblings). A row's
recomputed score can therefore differ slightly from what a re-generation would
produce. This script measures the formula change, not generation quality.

The 0.70 threshold is display-only here. It is not read from, and does not
write to, any DTO default or config — it only labels rows in the table.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from collections.abc import Callable
from typing import Any

import psycopg2.extras

from ..clients import ingestion_db_client as db
from ..clients.db_client import get_connection
from ..scoring import (
    compute_doctrine_confidence_score,
    compute_essay_confidence_score,
    compute_flashcard_confidence_score,
    compute_mcq_confidence_score,
    compute_outline_confidence_score,
)

logger = logging.getLogger(__name__)

# Display-only. Mirrors CLAUDE.md's auto-approval bar so the table can say
# which rows cross it. Changing this changes the report, nothing else.
REPORT_THRESHOLD = 0.7

PAGE_SIZE = 500

Scorer = Callable[..., float]

SCORERS: dict[str, Scorer] = {
    "flashcard": compute_flashcard_confidence_score,
    "essay_prompt": compute_essay_confidence_score,
    "mcq_question": compute_mcq_confidence_score,
    "doctrine_extract": compute_doctrine_confidence_score,
    "subject_outline": compute_outline_confidence_score,
}


class TypeStats:
    """Before/after distribution for one derivative type."""

    def __init__(self) -> None:
        self.before: list[float] = []
        self.after: list[float] = []
        self.newly_eligible = 0
        self.newly_ineligible = 0
        self.unchanged = 0
        self.skipped_no_sections = 0
        self.skipped_no_source = 0

    def record(self, before: float, after: float) -> None:
        self.before.append(before)
        self.after.append(after)
        if before < REPORT_THRESHOLD <= after:
            self.newly_eligible += 1
        elif after < REPORT_THRESHOLD <= before:
            self.newly_ineligible += 1
        if abs(after - before) < 1e-9:
            self.unchanged += 1


def _percentile(values: list[float], q: float) -> float:
    """Nearest-rank percentile. Empty input yields 0.0."""
    if not values:
        return 0.0
    ordered = sorted(values)
    idx = min(int(q * len(ordered)), len(ordered) - 1)
    return ordered[idx]


def _fmt(values: list[float]) -> str:
    if not values:
        return "        —         "
    return (
        f"{min(values):.3f} / {_percentile(values, 0.5):.3f} / {max(values):.3f}"
    )


def _iter_artifacts(
    types: list[str], limit: int | None
) -> Any:
    """Keyset-paginate derivative_artifacts, oldest id first.

    Soft-deleted rows are excluded, matching the rebuild job and the
    bulk-approve sweep.

    The cursor placeholders cast to ``uuid``, not ``text``.
    ``derivative_artifacts.id`` is ``@db.Uuid``, and PostgreSQL has no
    ``uuid > text`` operator — a ``::text`` cast there raises
    ``operator does not exist`` on the very first page, which is how the
    original version of this script failed on prod without ever reading a
    row. ``last_id`` stays a ``str | None``; psycopg2 adapts it to uuid.

    Casting to uuid also makes the comparison agree with ``ORDER BY id ASC``:
    uuid ordering is not text ordering, so a text comparison would have
    skipped or repeated rows even where the operator existed.
    """
    last_id: str | None = None
    yielded = 0

    while True:
        with get_connection() as conn, conn.cursor(
            cursor_factory=psycopg2.extras.RealDictCursor
        ) as cur:
            cur.execute(
                """SELECT id, derivative_type, source_document_id,
                          content_json, confidence_score
                     FROM derivative_artifacts
                    WHERE deleted_at IS NULL
                      AND derivative_type = ANY(%s)
                      AND (%s::uuid IS NULL OR id > %s::uuid)
                    ORDER BY id ASC
                    LIMIT %s""",
                (types, last_id, last_id, PAGE_SIZE),
            )
            rows = [dict(r) for r in cur.fetchall()]

        if not rows:
            return

        for row in rows:
            yield row
            yielded += 1
            if limit is not None and yielded >= limit:
                return

        # str(), not the raw value: psycopg2 only returns uuid columns as
        # uuid.UUID once register_uuid() has been called, and only adapts
        # UUID objects back into SQL after the same call — which this script
        # never makes. Whichever way the driver is configured, a str round
        # trips.
        last_id = str(rows[-1]["id"])


def _sections_for(document_id: str, cache: dict[str, list[dict[str, Any]]]) -> list[dict[str, Any]]:
    """Sections with text for a document, mirroring the generation tasks."""
    if document_id not in cache:
        sections = db.get_document_sections_for_digest(document_id)
        cache[document_id] = [
            s for s in sections if s.get("plain_text") and s["plain_text"].strip()
        ]
    return cache[document_id]


def _coerce_content(raw: Any) -> dict[str, Any] | None:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            return None
        return parsed if isinstance(parsed, dict) else None
    return None


def _write_scores(updates: list[tuple[str, float]]) -> int:
    """Apply recomputed scores. Returns the number of rows written.

    ``id`` is cast to uuid explicitly for the same reason the read path
    casts: the column is ``@db.Uuid``. An uncast placeholder happens to work
    (an unknown-type literal is coerced to uuid), but making it implicit is
    what let a ``::text`` cast look reasonable in the read path.
    """
    written = 0
    for start in range(0, len(updates), PAGE_SIZE):
        batch = updates[start : start + PAGE_SIZE]
        with get_connection() as conn, conn.cursor() as cur:
            psycopg2.extras.execute_batch(
                cur,
                """UPDATE derivative_artifacts
                      SET confidence_score = %s
                    WHERE id = %s::uuid
                      AND deleted_at IS NULL""",
                [(score, artifact_id) for artifact_id, score in batch],
            )
            conn.commit()
        written += len(batch)
        logger.info("Wrote %s/%s rows", written, len(updates))
    return written


def _print_report(stats: dict[str, TypeStats], threshold: float, applied: bool) -> None:
    header = (
        f"{'type':<18}{'n':>7}  {'before min/med/max':^26}  "
        f"{'after min/med/max':^26}  {'newly >= ' + f'{threshold:.2f}':>16}"
    )
    print()
    print(header)
    print("-" * len(header))

    total_rows = 0
    total_newly = 0
    for dtype in sorted(stats):
        s = stats[dtype]
        total_rows += len(s.before)
        total_newly += s.newly_eligible
        print(
            f"{dtype:<18}{len(s.before):>7}  {_fmt(s.before):^26}  "
            f"{_fmt(s.after):^26}  {s.newly_eligible:>16}"
        )
    print("-" * len(header))
    print(f"{'TOTAL':<18}{total_rows:>7}{'':>56}{total_newly:>16}")
    print()

    for dtype in sorted(stats):
        s = stats[dtype]
        notes = []
        if s.newly_ineligible:
            notes.append(f"{s.newly_ineligible} DROPPED below the bar")
        if s.unchanged:
            notes.append(f"{s.unchanged} unchanged")
        if s.skipped_no_sections:
            notes.append(f"{s.skipped_no_sections} skipped (source has no text sections)")
        if s.skipped_no_source:
            notes.append(f"{s.skipped_no_source} skipped (no source document / unreadable content)")
        if notes:
            print(f"  {dtype}: " + "; ".join(notes))

    print()
    if applied:
        print("Scores WERE written.")
    else:
        print("Dry run — nothing was written. Re-run with --apply and "
              "RESCORE_ALLOW_WRITE=1 to persist.")


def main_with_args(argv: list[str] | None = None) -> int:
    """Entry point taking explicit argv so tests can drive the whole path.

    ``main()`` is the console shim. The split exists because this script
    shipped with no test that executed any of its database code, and a
    ``uuid``/``text`` cast mismatch reached prod as a result.
    """
    parser = argparse.ArgumentParser(
        description="Recompute derivative confidence scores under the corrected "
        "formula. Dry run unless --apply and RESCORE_ALLOW_WRITE=1.",
    )
    parser.add_argument(
        "--type",
        action="append",
        dest="types",
        choices=sorted(SCORERS),
        help="Restrict to one derivative type. Repeatable. Default: all.",
    )
    parser.add_argument("--limit", type=int, default=None, help="Stop after N rows.")
    parser.add_argument(
        "--threshold",
        type=float,
        default=REPORT_THRESHOLD,
        help="Report-only bar for the 'newly eligible' column. Writes nothing.",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Persist the recomputed scores. Also requires RESCORE_ALLOW_WRITE=1.",
    )
    parser.add_argument(
        "--log-level", default="WARNING", choices=["DEBUG", "INFO", "WARNING", "ERROR"]
    )
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=getattr(logging, args.log_level),
        format="%(levelname)s %(name)s: %(message)s",
    )

    if args.apply and os.environ.get("RESCORE_ALLOW_WRITE") != "1":
        print(
            "Refusing to write: --apply was passed but RESCORE_ALLOW_WRITE=1 is not "
            "set. This rewrites the column the editorial approval gate reads.",
            file=sys.stderr,
        )
        return 2

    types = args.types or sorted(SCORERS)
    stats: dict[str, TypeStats] = {t: TypeStats() for t in types}
    section_cache: dict[str, list[dict[str, Any]]] = {}
    updates: list[tuple[str, float]] = []

    for row in _iter_artifacts(types, args.limit):
        dtype = row["derivative_type"]
        stat = stats[dtype]

        content = _coerce_content(row.get("content_json"))
        raw_document_id = row.get("source_document_id")
        if content is None or not raw_document_id:
            stat.skipped_no_source += 1
            continue
        document_id = str(raw_document_id)

        sections = _sections_for(document_id, section_cache)
        if not sections:
            stat.skipped_no_sections += 1
            continue

        before = float(row.get("confidence_score") or 0.0)
        after = SCORERS[dtype](content=content, source_sections=sections)

        stat.record(before, after)
        if abs(after - before) >= 1e-9:
            updates.append((str(row["id"]), after))

    applied = False
    if args.apply:
        written = _write_scores(updates)
        applied = True
        logger.info("Applied %s updates", written)

    _print_report(stats, args.threshold, applied)
    return 0


def main() -> int:
    """Console entry point — reads sys.argv."""
    return main_with_args(None)


if __name__ == "__main__":
    raise SystemExit(main())
