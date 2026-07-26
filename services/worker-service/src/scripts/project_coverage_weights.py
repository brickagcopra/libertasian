"""Project the short-source coverage taper over live prod rows. READ ONLY.

This script exists because fixtures lied. #313 passed 15 CI checks and moved 7
rows out of 29,471, because its fixture assumed a 40-section source while the
corpus averages 3.4 sections. Unit tests prove the formula does what it says;
only this tells you what it does to the corpus.

**It cannot write.** There is no --apply, no UPDATE statement, and no code path
that opens a write transaction. It is safe to run against prod.

What it prints, per derivative type:

- the stored score distribution (min / median / max) — what the corpus has now
- the projected distribution under the current formula
- how many rows cross the 0.70 bar in each direction
- the source-section-count distribution, since the taper is a function of it

## Which types can be projected, and why the others cannot

`flashcard`, `essay_prompt` and `doctrine_extract` hold their whole generated
object in one row and are scored against one document, so a row can be
re-scored on its own.

`mcq_question` cannot be scored per row — a row is one question and its stored
score belongs to the generation batch. It IS projected here, but at the batch
level: rows are grouped by generation job (falling back to source document),
each group's questions are reassembled into the `{questions: [...]}` shape the
generation-time scorer consumed, and the group is scored once. The
reconstruction is checked before it is trusted: scoring the reassembled batch
under the pre-taper weights and the old denominator must reproduce the stored
score, and groups that fail are reported as unreconstructable rather than
counted.

`subject_outline` is excluded outright. It is scored against the flattened
sections of multiple source documents while the row keeps only the primary
`source_document_id`, so its denominator cannot be rebuilt from the database.

Usage (from services/worker-service/):

    uv run python -m src.scripts.project_coverage_weights
    uv run python -m src.scripts.project_coverage_weights --type flashcard
    uv run python -m src.scripts.project_coverage_weights --limit 2000
"""

from __future__ import annotations

import argparse
import json
import logging
from collections import defaultdict
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
    compute_mcq_confidence_score,
)

logger = logging.getLogger(__name__)

REPORT_THRESHOLD = 0.7
PAGE_SIZE = 500
REPRODUCTION_TOLERANCE = 1e-4

ROW_LEVEL_SCORERS: dict[str, Callable[..., float]] = {
    "flashcard": compute_flashcard_confidence_score,
    "essay_prompt": compute_essay_confidence_score,
    "doctrine_extract": compute_doctrine_confidence_score,
}

BATCH_LEVEL_TYPES = ("mcq_question",)

EXCLUDED_TYPES = {
    "subject_outline": (
        "scored against the flattened sections of MULTIPLE source documents "
        "while the row keeps only the primary source_document_id — the "
        "denominator cannot be rebuilt from the database"
    ),
}


class Projection:
    """Stored vs projected scores for one type."""

    def __init__(self, dtype: str, unit: str = "rows") -> None:
        self.dtype = dtype
        self.unit = unit
        self.stored: list[float] = []
        self.projected: list[float] = []
        self.section_counts: list[int] = []
        self.crossing_up = 0
        self.crossing_down = 0
        self.unchanged = 0
        self.unusable = 0
        self.unreconstructable = 0

    def record(self, stored: float, projected: float, sections: int) -> None:
        self.stored.append(stored)
        self.projected.append(projected)
        self.section_counts.append(sections)
        if stored < REPORT_THRESHOLD <= projected:
            self.crossing_up += 1
        elif projected < REPORT_THRESHOLD <= stored:
            self.crossing_down += 1
        if abs(projected - stored) < 1e-9:
            self.unchanged += 1

    @property
    def above_bar_before(self) -> int:
        return sum(1 for s in self.stored if s >= REPORT_THRESHOLD)

    @property
    def above_bar_after(self) -> int:
        return sum(1 for s in self.projected if s >= REPORT_THRESHOLD)


def _percentile(values: list[float], q: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    return ordered[min(int(q * len(ordered)), len(ordered) - 1)]


def _dist(values: list[float]) -> str:
    if not values:
        return "         —          "
    return (
        f"{min(values):.3f} / {_percentile(values, 0.5):.3f} / {max(values):.3f}"
    )


def _iter_artifacts(types: list[str], limit: int | None) -> Any:
    """Keyset-paginate derivative_artifacts. Read-only, uuid-safe cursor."""
    last_id: str | None = None
    yielded = 0

    while True:
        with get_connection() as conn, conn.cursor(
            cursor_factory=psycopg2.extras.RealDictCursor
        ) as cur:
            cur.execute(
                """SELECT id, derivative_type, source_document_id,
                          derivative_generation_job_id, content_json,
                          confidence_score
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

        last_id = str(rows[-1]["id"])


def _sections_for(
    document_id: str, cache: dict[str, list[dict[str, Any]]]
) -> list[dict[str, Any]]:
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


def project_row_level(
    dtype: str, limit: int | None, section_cache: dict[str, list[dict[str, Any]]]
) -> Projection:
    """One row, one score."""
    projection = Projection(dtype)
    scorer = ROW_LEVEL_SCORERS[dtype]

    for row in _iter_artifacts([dtype], limit):
        content = _coerce_content(row.get("content_json"))
        document_id = row.get("source_document_id")
        stored = row.get("confidence_score")
        if content is None or not document_id or stored is None:
            projection.unusable += 1
            continue
        sections = _sections_for(str(document_id), section_cache)
        if not sections:
            projection.unusable += 1
            continue

        projected = scorer(content=content, source_sections=sections)
        projection.record(float(stored), projected, len(sections))

    return projection


def project_mcq_batches(
    limit: int | None, section_cache: dict[str, list[dict[str, Any]]]
) -> Projection:
    """Reassemble each generation batch, then score it once.

    A batch is only counted once its reconstruction has been shown to
    reproduce the stored score under the pre-taper weights and the old
    denominator. Anything else is reported as unreconstructable — the same
    principle as the re-score script's gate: do not project from a shape you
    cannot prove you read correctly.
    """
    projection = Projection("mcq_question", unit="batches")
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)

    for row in _iter_artifacts(["mcq_question"], limit):
        key = row.get("derivative_generation_job_id") or row.get("source_document_id")
        if not key:
            projection.unusable += 1
            continue
        groups[str(key)].append(row)

    for rows in groups.values():
        questions: list[dict[str, Any]] = []
        for row in rows:
            content = _coerce_content(row.get("content_json"))
            if content is not None:
                questions.append(content)

        document_id = rows[0].get("source_document_id")
        stored = rows[0].get("confidence_score")
        if not questions or not document_id or stored is None:
            projection.unusable += 1
            continue

        sections = _sections_for(str(document_id), section_cache)
        if not sections:
            projection.unusable += 1
            continue

        batch_content = {"questions": questions}

        # Prove the reconstruction before trusting it.
        reproduced = compute_mcq_confidence_score(
            content=batch_content,
            source_sections=sections,
            coverage_mode=COVERAGE_MODE_DOCUMENT,
        )
        if abs(reproduced - float(stored)) > REPRODUCTION_TOLERANCE:
            projection.unreconstructable += 1
            continue

        projected = compute_mcq_confidence_score(
            content=batch_content,
            source_sections=sections,
        )
        projection.record(float(stored), projected, len(sections))

    return projection


def print_report(projections: list[Projection]) -> None:
    header = (
        f"{'type':<18}{'n':>8}  {'stored min/med/max':^22}  "
        f"{'projected min/med/max':^22}  {'>=0.70 before':>14}{'>=0.70 after':>14}"
    )
    print()
    print("PROJECTION — no rows were modified.")
    print()
    print(header)
    print("-" * len(header))
    for p in projections:
        print(
            f"{p.dtype:<18}{len(p.stored):>8}  {_dist(p.stored):^22}  "
            f"{_dist(p.projected):^22}  {p.above_bar_before:>14}{p.above_bar_after:>14}"
        )
    print("-" * len(header))

    print()
    for p in projections:
        bits = [
            f"unit={p.unit}",
            f"crossing up={p.crossing_up}",
            f"crossing down={p.crossing_down}",
            f"unchanged={p.unchanged}",
        ]
        if p.unusable:
            bits.append(f"unusable={p.unusable}")
        if p.unreconstructable:
            bits.append(f"UNRECONSTRUCTABLE={p.unreconstructable}")
        print(f"  {p.dtype}: " + ", ".join(bits))
        if p.section_counts:
            counts = sorted(p.section_counts)
            mean = sum(counts) / len(counts)
            print(
                f"      source sections: min={counts[0]} median="
                f"{counts[len(counts) // 2]} mean={mean:.1f} max={counts[-1]}"
            )

    if EXCLUDED_TYPES:
        print()
        print("EXCLUDED — cannot be projected:")
        for dtype, reason in EXCLUDED_TYPES.items():
            print(f"  {dtype}: {reason}")

    print()
    print("How to read this:")
    print()
    print("  'crossing down' is EXPECTED to be non-zero, and is not by itself")
    print("  a reason to stop. The taper moves weight off coverage and onto")
    print("  citation mapping, so an artifact that covered every section but")
    print("  grounded only some of its items loses ground — deliberately, since")
    print("  that is the artifact whose old score came from breadth rather than")
    print("  grounding. Example: coverage 1.0 with citation 0.4 scores 0.82")
    print("  under the old weights and 0.694 under the taper on a 3-section")
    print("  source, so it drops below the bar.")
    print()
    print("  What to judge instead: whether the artifacts crossing down are the")
    print("  weakly-grounded ones (intended) or well-grounded ones (a bug), and")
    print("  whether 'crossing up' is a plausible number of newly approvable")
    print("  artifacts rather than a landslide.")


def main_with_args(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Project the coverage-weight taper over live rows. "
        "READ ONLY — this script cannot write.",
    )
    parser.add_argument(
        "--type",
        action="append",
        dest="types",
        choices=sorted(ROW_LEVEL_SCORERS) + list(BATCH_LEVEL_TYPES),
        help="Restrict to one type. Repeatable. Default: all projectable types.",
    )
    parser.add_argument(
        "--limit", type=int, default=None, help="Stop after N rows per type."
    )
    parser.add_argument(
        "--log-level", default="WARNING", choices=["DEBUG", "INFO", "WARNING", "ERROR"]
    )
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=getattr(logging, args.log_level),
        format="%(levelname)s %(name)s: %(message)s",
    )

    selected = args.types or (sorted(ROW_LEVEL_SCORERS) + list(BATCH_LEVEL_TYPES))
    section_cache: dict[str, list[dict[str, Any]]] = {}
    projections: list[Projection] = []

    for dtype in selected:
        if dtype in ROW_LEVEL_SCORERS:
            projections.append(project_row_level(dtype, args.limit, section_cache))
        elif dtype in BATCH_LEVEL_TYPES:
            projections.append(project_mcq_batches(args.limit, section_cache))

    print_report(projections)
    return 0


def main() -> int:
    return main_with_args(None)


if __name__ == "__main__":
    raise SystemExit(main())
