"""Re-score persisted derivative artifacts under the corrected confidence formula.

#313 fixed `source_passage_coverage` but changed no existing row, so artifacts
written before it still carry their capped scores and the bulk-approve sweep
keeps returning 0 candidates for them.

READ THIS BEFORE CHANGING ANY QUERY OR EXTRACTION HERE.

The first version of this script recomputed every `mcq_question` row to 0.200
and reported 46,081 of them as dropping below the auto-approval bar. Those
drops were fabricated by a wrong extraction: the script assumed a row's
`content_json` had the same shape the generation-time scorer consumed. For MCQ
it does not. Applying that run would have destroyed 46,081 valid scores.

## What one row actually holds, per type

`flashcard` — RE-SCORABLE
    row: ``{cards: [{front, back, mnemonicHint, tags, supportingSectionIds}],
    style, cardCount, generatedAt}``, one row per deck.
    scored at generation over the same deck, against that one document's
    ``sections_with_text``.

`essay_prompt` — RE-SCORABLE
    row: the whole LLM output, incl.
    ``modelAnswer.outlineSections[].citedSectionIds``, one row per prompt.
    scored at generation over the same object, one source document.

`doctrine_extract` — RE-SCORABLE
    row: the whole RAG output, incl. ``doctrines[].source_section_id``
    (snake_case), one row per extraction.
    scored at generation over the same object, one source document.

`mcq_question` — NOT RE-SCORABLE
    row: **a single question**, ``{questionStem, options[], ...}``. There is
    no ``questions`` list on a row.
    scored at generation over the **whole generated set** of questions at
    once, and the resulting number is copied onto every artifact in the
    batch: ``internal-derivatives.service.ts:328`` loops
    ``for (const q of dto.questions)`` writing ``confidenceScore:
    dto.confidenceScore`` on each. The stored score is a property of the
    batch, not of the row.

`subject_outline` — NOT RE-SCORABLE
    row: ``{sections: [{heading, citedSectionIds, subSections[]}]}``.
    scored at generation against the flattened sections of **multiple**
    source documents (``outline_generation_tasks.py:283``), while the row
    records only the primary ``source_document_id``, so the denominator
    cannot be reconstructed from the row.

### Citation derivation at generation time

- `flashcard` — `supportingSectionIds` per card, already filtered at write time
  to UUIDs present in the source (`_build_derivative_cards`).
- `essay_prompt` — `citedSectionIds` per model-answer outline section.
- `doctrine_extract` — one `source_section_id` per doctrine, snake_case.
- `mcq_question` — `supportingSectionIds` per question, but aggregated across
  the batch before scoring.
- `subject_outline` — `citedSectionIds` on every node, walked recursively
  through `subSections`.

The two IMPOSSIBLE types are refused outright, not silently skipped or
best-effort scored. An MCQ row's stored number is a property of its batch;
recomputing it from one question is a category error, and no tolerance setting
makes it correct. Re-deriving those would mean re-scoring whole batches from
the generation job, which this script does not do.

## The gate

`--apply` requires THREE things, not one:

1. `--apply` on the command line,
2. `RESCORE_ALLOW_WRITE=1` in the environment,
3. **a passing reproduction check for every selected type.**

The reproduction check recomputes a sample of live rows under the *old*
denominator (`COVERAGE_MODE_DOCUMENT`) using the same extraction that would
produce the new score, and compares against what is stored. If the script
cannot reproduce the value already in the column, its reading of that type is
wrong and it has no business writing a new one. That check is what would have
caught the MCQ shape mismatch before the dry run, rather than after.

Usage (from services/worker-service/):

    # dry run + reproduction report
    uv run python -m src.scripts.rescore_derivatives

    # reproduction check only
    uv run python -m src.scripts.rescore_derivatives --verify-only

    # write (all three gates must be satisfied)
    RESCORE_ALLOW_WRITE=1 uv run python -m src.scripts.rescore_derivatives --apply

Caveat that remains true: scores are recomputed from the persisted
`content_json`, which already had non-UUID and unknown section IDs stripped at
write time, so a recomputed score can differ from what a re-generation would
produce. This measures the formula change, not generation quality.

The 0.70 threshold here is display-only. It is not read from, and does not
write to, any DTO default or config.
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
    COVERAGE_MODE_DOCUMENT,
    compute_doctrine_confidence_score,
    compute_essay_confidence_score,
    compute_flashcard_confidence_score,
)

logger = logging.getLogger(__name__)

# Display-only. Mirrors CLAUDE.md's auto-approval bar so the table can say
# which rows cross it. Changing this changes the report, nothing else.
REPORT_THRESHOLD = 0.7

PAGE_SIZE = 500

# Rows sampled per type for the reproduction check.
DEFAULT_VERIFY_SAMPLE = 50

# Stored scores are float4 (@db.Real) and the scorer rounds to 4 dp, so an
# exact match is not expected; anything looser than this would start hiding
# real extraction differences.
DEFAULT_VERIFY_TOLERANCE = 1e-4

Scorer = Callable[..., float]

SCORERS: dict[str, Scorer] = {
    "flashcard": compute_flashcard_confidence_score,
    "essay_prompt": compute_essay_confidence_score,
    "doctrine_extract": compute_doctrine_confidence_score,
}

# Types this script must never score or write, with the reason surfaced in the
# report. See the module docstring for the full derivation.
UNSUPPORTED_TYPES: dict[str, str] = {
    "mcq_question": (
        "a row is ONE question while the stored score was computed over the "
        "whole generated set and copied onto every row in the batch — the "
        "score is a property of the batch, not the row, so it cannot be "
        "recomputed from row content at all"
    ),
    "subject_outline": (
        "scored at generation time against the flattened sections of MULTIPLE "
        "source documents, while the row records only the primary "
        "source_document_id — the denominator cannot be reconstructed"
    ),
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


class VerifyResult:
    """Reproduction check outcome for one type."""

    def __init__(self, dtype: str) -> None:
        self.dtype = dtype
        self.checked = 0
        self.matched = 0
        self.mismatches: list[tuple[str, float, float]] = []
        self.skipped = 0

    @property
    def passed(self) -> bool:
        # A type with nothing to sample has proved nothing, so it does not pass.
        return self.checked > 0 and self.matched == self.checked

    def summary(self) -> str:
        if self.checked == 0:
            return f"{self.dtype}: NO ROWS SAMPLED — nothing proved"
        verdict = "OK" if self.passed else "FAILED"
        return (
            f"{self.dtype}: {verdict} — reproduced {self.matched}/{self.checked} "
            f"stored scores"
        )


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


def _iter_artifacts(types: list[str], limit: int | None) -> Any:
    """Keyset-paginate derivative_artifacts, oldest id first.

    Soft-deleted rows are excluded, matching the rebuild job and the
    bulk-approve sweep.

    The cursor placeholders cast to ``uuid``, not ``text``.
    ``derivative_artifacts.id`` is ``@db.Uuid``, and PostgreSQL has no
    ``uuid > text`` operator — a ``::text`` cast there raises
    ``operator does not exist`` on the very first page, which is how an
    earlier version of this script failed on prod without reading a row.
    ``last_id`` stays a ``str | None``; psycopg2 adapts it to uuid.

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


def _sections_for(
    document_id: str, cache: dict[str, list[dict[str, Any]]]
) -> list[dict[str, Any]]:
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


def _row_inputs(
    row: dict[str, Any], section_cache: dict[str, list[dict[str, Any]]]
) -> tuple[dict[str, Any], list[dict[str, Any]]] | None:
    """Content + source sections for a row, or None when unusable."""
    content = _coerce_content(row.get("content_json"))
    raw_document_id = row.get("source_document_id")
    if content is None or not raw_document_id:
        return None
    sections = _sections_for(str(raw_document_id), section_cache)
    if not sections:
        return None
    return content, sections


def verify_type(
    dtype: str,
    sample: int,
    tolerance: float,
    section_cache: dict[str, list[dict[str, Any]]],
) -> VerifyResult:
    """Reproduce stored scores for a sample of live rows.

    Recomputes under ``COVERAGE_MODE_DOCUMENT`` — the denominator that produced
    the stored values — through the same extraction the new score would use. A
    type that cannot reproduce what is already in the column is being read
    wrongly, whatever the new number looks like.
    """
    result = VerifyResult(dtype)
    scorer = SCORERS[dtype]

    for row in _iter_artifacts([dtype], sample):
        stored = row.get("confidence_score")
        inputs = _row_inputs(row, section_cache)
        if stored is None or inputs is None:
            result.skipped += 1
            continue
        content, sections = inputs

        legacy = scorer(
            content=content,
            source_sections=sections,
            coverage_mode=COVERAGE_MODE_DOCUMENT,
        )
        result.checked += 1
        if abs(legacy - float(stored)) <= tolerance:
            result.matched += 1
        else:
            result.mismatches.append((str(row["id"]), float(stored), legacy))

    return result


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


def _print_verification(results: list[VerifyResult], tolerance: float) -> None:
    print()
    print(f"Reproduction check (tolerance {tolerance:g}) — can this script "
          "reproduce the score already stored?")
    print("-" * 78)
    for r in results:
        print(f"  {r.summary()}")
        for artifact_id, stored, legacy in r.mismatches[:5]:
            print(f"      {artifact_id}  stored={stored:.4f}  recomputed={legacy:.4f}")
        if len(r.mismatches) > 5:
            print(f"      … and {len(r.mismatches) - 5} more")
        if r.skipped:
            print(f"      ({r.skipped} sampled rows unusable: no source or no sections)")


def _print_unsupported(types: list[str]) -> None:
    if not types:
        return
    print()
    print("REFUSED — these types cannot be re-scored from row content:")
    for t in types:
        print(f"  {t}: {UNSUPPORTED_TYPES[t]}")


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
        print("Dry run — nothing was written.")


def main_with_args(argv: list[str] | None = None) -> int:
    """Entry point taking explicit argv so tests can drive the whole path.

    ``main()`` is the console shim. The split exists because this script
    shipped with no test that executed any of its database code, and a
    ``uuid``/``text`` cast mismatch reached prod as a result.
    """
    parser = argparse.ArgumentParser(
        description="Recompute derivative confidence scores under the corrected "
        "formula. Dry run unless --apply, RESCORE_ALLOW_WRITE=1 and a passing "
        "reproduction check all hold.",
    )
    parser.add_argument(
        "--type",
        action="append",
        dest="types",
        choices=sorted(SCORERS) + sorted(UNSUPPORTED_TYPES),
        help="Restrict to one derivative type. Repeatable. Default: all "
        "re-scorable types.",
    )
    parser.add_argument("--limit", type=int, default=None, help="Stop after N rows.")
    parser.add_argument(
        "--threshold",
        type=float,
        default=REPORT_THRESHOLD,
        help="Report-only bar for the 'newly eligible' column. Writes nothing.",
    )
    parser.add_argument(
        "--verify-sample",
        type=int,
        default=DEFAULT_VERIFY_SAMPLE,
        help="Rows per type used for the reproduction check.",
    )
    parser.add_argument(
        "--verify-tolerance",
        type=float,
        default=DEFAULT_VERIFY_TOLERANCE,
        help="Max difference between a stored and a reproduced score.",
    )
    parser.add_argument(
        "--verify-only",
        action="store_true",
        help="Run the reproduction check and stop.",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Persist the recomputed scores. Requires RESCORE_ALLOW_WRITE=1 "
        "AND a passing reproduction check for every selected type.",
    )
    parser.add_argument(
        "--log-level", default="WARNING", choices=["DEBUG", "INFO", "WARNING", "ERROR"]
    )
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=getattr(logging, args.log_level),
        format="%(levelname)s %(name)s: %(message)s",
    )

    requested = args.types or sorted(SCORERS)
    refused = [t for t in requested if t in UNSUPPORTED_TYPES]
    types = [t for t in requested if t in SCORERS]

    if refused and args.types:
        # Explicitly asked for a type that cannot be re-scored: say so and stop,
        # rather than quietly producing a report about the other types.
        _print_unsupported(refused)
        print(
            "\nRefusing to continue: a requested type cannot be re-scored from "
            "row content.",
            file=sys.stderr,
        )
        return 4

    if not types:
        print("No re-scorable types selected.", file=sys.stderr)
        return 4

    if args.apply and os.environ.get("RESCORE_ALLOW_WRITE") != "1":
        print(
            "Refusing to write: --apply was passed but RESCORE_ALLOW_WRITE=1 is not "
            "set. This rewrites the column the editorial approval gate reads.",
            file=sys.stderr,
        )
        return 2

    section_cache: dict[str, list[dict[str, Any]]] = {}

    # Reproduction check first — it decides whether writing is allowed at all.
    verifications = [
        verify_type(t, args.verify_sample, args.verify_tolerance, section_cache)
        for t in types
    ]
    _print_verification(verifications, args.verify_tolerance)
    verification_passed = all(v.passed for v in verifications)

    if args.verify_only:
        _print_unsupported(sorted(UNSUPPORTED_TYPES))
        return 0 if verification_passed else 3

    if args.apply and not verification_passed:
        failing = ", ".join(v.dtype for v in verifications if not v.passed)
        print(
            f"\nRefusing to write: the reproduction check failed for {failing}. "
            "A re-score that cannot reproduce the score already stored has no "
            "business writing a new one.",
            file=sys.stderr,
        )
        return 3

    stats: dict[str, TypeStats] = {t: TypeStats() for t in types}
    updates: list[tuple[str, float]] = []

    for row in _iter_artifacts(types, args.limit):
        dtype = row["derivative_type"]
        stat = stats[dtype]

        inputs = _row_inputs(row, section_cache)
        if inputs is None:
            if _coerce_content(row.get("content_json")) is None or not row.get(
                "source_document_id"
            ):
                stat.skipped_no_source += 1
            else:
                stat.skipped_no_sections += 1
            continue
        content, sections = inputs

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
    _print_unsupported(sorted(UNSUPPORTED_TYPES))

    if not applied:
        print(
            "Re-run with --apply and RESCORE_ALLOW_WRITE=1 to persist "
            "(the reproduction check must still pass)."
        )
    return 0


def main() -> int:
    """Console entry point — reads sys.argv."""
    return main_with_args(None)


if __name__ == "__main__":
    raise SystemExit(main())
