"""Score bar exam answers under the grounded formula. READ ONLY.

**This script cannot write.** No ``--apply``, no ``UPDATE``, no ``INSERT``, no
``DELETE``, no ``commit()``. A test greps the source to keep it that way, so it
is safe to point at prod.

## What it is for

It is the acceptance evidence for `feat/bar-exam-answer-confidence`. The unit
tests prove the scorer is arithmetically what it claims; they cannot prove the
distribution it produces on real answers is usable. Only live rows show that,
and until the pilot runs nobody — including this script's author — knows
whether the 0.70 bar is reachable here.

    # Everything, split by prompt version. Pre-#356 rows are the v1 bucket.
    uv run python -m src.scripts.score_bar_exam_answers_dryrun

    # Just the pilot rows, per subject, in the shape the PR 2 report needs.
    uv run python -m src.scripts.score_bar_exam_answers_dryrun --pilot

    # Per-row detail for pasting into a report.
    uv run python -m src.scripts.score_bar_exam_answers_dryrun --pilot --json

Expect the 58 pre-#356 rows to score **0.000**: they are ``bar_exam_alac.v1``,
priors-only, and carry no ``citedSectionIds`` at all. That is the formula
working — an answer that grounded nothing scores the floor — not a defect to
tune away.

## Why the report breaks out by denominator

The bar is **adaptive**, and a single blended pass rate would hide that.
Validated on prod 2026-08-05 over 64 questions (8 per subject, all 8
subjects): the breadth denominator ``min(3, distinct docs available)`` is 3
for 66% of questions, 2 for 31%, and 1 for 3%. At denominator 3, 0.70 means
"two distinct clean authorities"; at denominator 2, ONE clean citation scores
0.75 and passes; at denominator 1, one citation scores 1.0.

So an aggregate pass rate mixes answer quality with retrieval breadth, and
retrieval breadth varies by subject (legal_ethics averages 2.9 distinct
documents, criminal_law 5.0). Read the by-denominator block before the
aggregate; the aggregate is the number most likely to be quoted and the least
likely to mean what it appears to.

## How "retrieval succeeded" is read

Off the **prompt version**, not off the score. ``bar_exam_alac.v2`` is
selected by the generation task only when retrieval actually returned
passages, so a v2 row IS a row where retrieval succeeded, and a v1 row written
after the #356 deploy is one where it did not. An answer that retrieved eight
passages and then cited none of them is a v2 row scoring 0.0 — a different
failure from a retrieval miss, and the two must not collapse into one number.

## What this script CANNOT show, and why

The retrieved passage set itself is **not persisted**. What IS persisted, as
of this PR, is the ``grounding`` counts block the generation task writes into
``structured_answer_json`` — emitted / valid / fabricated ids, cited and
available document counts, and the breadth denominator. Counts only: no BM25
scores, no document ids, no passage text, because that block is served
verbatim to the public endpoint (``bar-exam-answers.public.controller.ts:126``).

That block is what makes the by-denominator breakout exact. Without it the
denominator would have to be reconstructed from surviving citations, which can
only ever yield a **lower bound** — every row would be classified at or below
its true denominator, systematically misclassifying rows downward and hiding
the exact effect the breakout exists to show.

Two consequences remain:

* For a v2 row the authoritative score is the one written at generation time,
  from the live passage set — this script reads it. The recomputed-from-
  storage score is printed alongside as a cross-check; a divergence means the
  corpus moved under the row (a cited section was deleted), which is worth
  knowing but is not a scoring bug.
* For a **pre-#357 row** there is no ``grounding`` block, so its denominator
  is unknown and it is reported under ``denominator=?`` rather than guessed
  into a bucket. Every one of the 58 legacy rows lands there, which is
  correct: they are priors-only and had no denominator.

Retrieval-side diagnostics — BM25 spread, "passages above a relevance floor" —
are still **not available here**, and deliberately so: they would mean putting
retrieval internals in a public payload. The generation task logs the
per-answer term breakdown, which is where those numbers live.
"""

from __future__ import annotations

import argparse
import json
import logging
import statistics
import uuid as _uuid
from typing import Any

import psycopg2.extras

from ..clients.db_client import get_connection
from ..scoring_bar_exam import BarExamConfidence, compute_bar_exam_answer_confidence

logger = logging.getLogger(__name__)

# The prompt version that first bound citedSectionIds to a closed list.
GROUNDED_PROMPT_VERSION = "bar_exam_alac.v2"

# The editorial bar. Printed, never enforced — this script decides nothing.
CONFIDENCE_BAR = 0.70


class Row:
    """One answer: what it stored, and what it scores now."""

    def __init__(
        self,
        answer_id: str,
        question_id: str,
        subject: str,
        prompt_version: str | None,
        review_status: str,
        stored_confidence: float | None,
        recomputed: BarExamConfidence,
        grounding: dict[str, Any] | None = None,
    ) -> None:
        self.answer_id = answer_id
        self.question_id = question_id
        self.subject = subject or "unknown"
        self.prompt_version = prompt_version
        self.review_status = review_status
        self.stored_confidence = stored_confidence
        self.recomputed = recomputed
        self.grounding = grounding or {}

    @property
    def denominator(self) -> int | None:
        """The breadth denominator this answer was actually scored against.

        ``None`` for a row written before the ``grounding`` block existed.
        Those are reported in their own bucket rather than guessed into one —
        reconstructing a denominator from surviving citations yields a lower
        bound, and a lower bound silently sorted into the wrong bucket is
        worse than an honest unknown.
        """
        value = self.grounding.get("breadthDenominator")
        return int(value) if isinstance(value, int) else None

    @property
    def grounded(self) -> bool:
        """True when this row was generated on the v2 grounded path.

        Which is the same statement as "retrieval returned passages for this
        question" — the task only selects v2 when it did.
        """
        return self.prompt_version == GROUNDED_PROMPT_VERSION

    @property
    def score(self) -> float:
        """The score to report: stored when it exists, recomputed otherwise.

        Stored wins because it was computed against the passage set that
        actually grounded the answer. Recomputation cannot see that set.
        """
        if self.stored_confidence is not None:
            return float(self.stored_confidence)
        return self.recomputed.score

    @property
    def diverges(self) -> bool:
        """Stored and recomputed disagree by more than rounding."""
        if self.stored_confidence is None:
            return False
        return abs(float(self.stored_confidence) - self.recomputed.score) > 0.001

    @property
    def passes(self) -> bool:
        return self.score >= CONFIDENCE_BAR


def iter_answers(limit: int | None = None) -> list[dict[str, Any]]:
    """Read every ai_generated answer with its model run and question subject.

    A single ordered read, deliberately: the table holds 58 rows today and
    1,536 at its theoretical maximum (one per question), so paginating would
    be pretending at a scale this does not have.
    """
    sql = """
        SELECT a.id,
               a.bar_exam_question_id,
               a.confidence AS stored_confidence,
               a.review_status,
               a.structured_answer_json,
               mr.prompt_template_version,
               q.subject_study_code
        FROM bar_exam_answers a
        LEFT JOIN model_runs mr ON mr.id = a.model_run_id
        LEFT JOIN bar_exam_questions q ON q.id = a.bar_exam_question_id
        WHERE a.answer_type = 'ai_generated'
        ORDER BY a.created_at ASC
    """
    params: list[Any] = []
    if limit is not None:
        sql += " LIMIT %s"
        params.append(limit)

    with get_connection() as conn, \
            conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(sql, params)
        return [dict(row) for row in cur.fetchall()]


def resolve_sections(section_ids: set[str]) -> dict[str, str]:
    """``{section_id: legal_document_id}`` for the ids that exist."""
    candidates = {sid for sid in section_ids if _looks_like_uuid(sid)}
    if not candidates:
        return {}
    with get_connection() as conn, \
            conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT id, legal_document_id
               FROM legal_document_sections
               WHERE id = ANY(%s::uuid[])""",
            (list(candidates),),
        )
        return {str(r["id"]): str(r["legal_document_id"]) for r in cur.fetchall()}


def score_row(row: dict[str, Any], resolved: dict[str, str]) -> Row:
    """Recompute one answer's score from what it stored.

    ``resolved`` is the shared ``{section_id: document_id}`` map, looked up
    once for the whole run rather than per row — same reason the generation
    path batches it: one query per answer over 1,536 answers is a self-inflicted
    load problem.
    """
    structured = _as_dict(row.get("structured_answer_json"))
    emitted = _stored_cited_ids(row.get("structured_answer_json"))
    valid = [i for i in emitted if i in resolved]
    cited_documents = {resolved[i] for i in valid}
    grounding = structured.get("grounding")
    grounding = grounding if isinstance(grounding, dict) else {}

    recomputed = compute_bar_exam_answer_confidence(
        emitted_id_count=len(emitted),
        valid_id_count=len(valid),
        cited_document_count=len(cited_documents),
        # Lower bound: the retrieved set is gone, so the only documents known
        # to have been available are the ones actually cited.
        available_document_count=len(cited_documents),
    )

    return Row(
        answer_id=str(row["id"]),
        question_id=str(row["bar_exam_question_id"]),
        subject=str(row.get("subject_study_code") or "unknown"),
        prompt_version=row.get("prompt_template_version"),
        review_status=str(row.get("review_status") or "unknown"),
        stored_confidence=row.get("stored_confidence"),
        recomputed=recomputed,
        grounding=grounding,
    )


def _as_dict(structured: Any) -> dict[str, Any]:
    """Coerce a stored structured answer to a dict, whatever shape it is in."""
    if isinstance(structured, str):
        try:
            structured = json.loads(structured)
        except json.JSONDecodeError:
            return {}
    return structured if isinstance(structured, dict) else {}


def _stored_cited_ids(structured: Any) -> list[str]:
    """Pull ``citedSectionIds`` out of a stored structured answer."""
    parsed = _as_dict(structured)
    raw = parsed.get("citedSectionIds") or []
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    for item in raw:
        if isinstance(item, str) and item.strip() and item not in out:
            out.append(item.strip())
    return out


def _looks_like_uuid(value: object) -> bool:
    if not isinstance(value, str):
        return False
    try:
        _uuid.UUID(value)
    except (ValueError, AttributeError, TypeError):
        return False
    return True


def summarize(rows: list[Row], label: str) -> str:
    """Render one report block. Pure string building — no I/O."""
    if not rows:
        return f"\n{label}\n  (no rows)\n"

    scores = sorted(r.score for r in rows)
    passing = [r for r in rows if r.passes]
    grounded = [r for r in rows if r.grounded]
    diverging = [r for r in rows if r.diverges]

    lines = [
        "",
        label,
        f"  rows:                 {len(rows)}",
        f"  retrieval succeeded:  {len(grounded)} / {len(rows)}"
        "   (rows generated on the v2 grounded path)",
        f"  confidence >= {CONFIDENCE_BAR:.2f}:   {len(passing)} / {len(rows)}"
        f"   ({_pct(len(passing), len(rows))})",
        f"  min / median / max:   {scores[0]:.3f} / "
        f"{statistics.median(scores):.3f} / {scores[-1]:.3f}",
        f"  fabricated ids:       "
        f"{sum(r.recomputed.fabricated_id_count for r in rows)} across "
        f"{sum(1 for r in rows if r.recomputed.fabricated_id_count)} answers",
        f"  unscored (NULL):      {sum(1 for r in rows if r.stored_confidence is None)}",
    ]
    if diverging:
        lines.append(
            f"  stored != recomputed: {len(diverging)}"
            "   (a cited section has since been deleted — investigate, do not rescore)"
        )

    lines.extend(
        [
            "",
            "  BY BREADTH DENOMINATOR — read this before the aggregate above.",
            "  The bar is adaptive: at denominator 3 it asks for two distinct",
            "  clean authorities, at 2 one clean citation scores 0.75 and passes,",
            "  at 1 one citation scores 1.0. A blended pass rate mixes answer",
            "  quality with retrieval breadth.",
        ]
    )

    by_denominator: dict[int | None, list[Row]] = {}
    for row in rows:
        by_denominator.setdefault(row.denominator, []).append(row)

    for denominator in sorted(by_denominator, key=lambda d: (d is None, d or 0)):
        bucket = by_denominator[denominator]
        label = "?" if denominator is None else str(denominator)
        bucket_scores = sorted(r.score for r in bucket)
        bucket_pass = sum(1 for r in bucket if r.passes)
        note = ""
        if denominator is None:
            note = "   (no grounding block — pre-#357 row, denominator unknown)"
        lines.append(
            f"    denominator {label}   {bucket_pass}/{len(bucket)}"
            f"  ({_pct(bucket_pass, len(bucket))})"
            f"   median {statistics.median(bucket_scores):.3f}"
            f"   share {_pct(len(bucket), len(rows))}{note}"
        )

    lines.append("")
    lines.append("  per-subject >= bar (retrieval breadth varies by subject —")
    lines.append("  legal_ethics averages 2.9 distinct documents, criminal_law 5.0,")
    lines.append("  so a subject's pass rate carries its retrieval profile inside it):")
    by_subject: dict[str, list[Row]] = {}
    for row in rows:
        by_subject.setdefault(row.subject, []).append(row)
    for subject in sorted(by_subject):
        subject_rows = by_subject[subject]
        subject_pass = sum(1 for r in subject_rows if r.passes)
        subject_scores = sorted(r.score for r in subject_rows)
        known = [r.denominator for r in subject_rows if r.denominator is not None]
        breadth = f"{statistics.mean(known):.1f}" if known else "?"
        lines.append(
            f"    {subject:<20} {subject_pass}/{len(subject_rows)}"
            f"   median {statistics.median(subject_scores):.3f}"
            f"   mean denominator {breadth}"
        )

    lines.append("")
    lines.append("  per-subject x denominator (where a subject's rate comes from):")
    for subject in sorted(by_subject):
        cells: list[str] = []
        for denominator in (1, 2, 3, None):
            cell_rows = [
                r for r in by_subject[subject] if r.denominator == denominator
            ]
            if not cell_rows:
                continue
            label = "?" if denominator is None else str(denominator)
            passed = sum(1 for r in cell_rows if r.passes)
            cells.append(f"d{label} {passed}/{len(cell_rows)}")
        lines.append(f"    {subject:<20} " + "  ".join(cells))

    resolutions = [r.recomputed.citation_resolution for r in rows]
    breadths = [r.recomputed.authority_breadth for r in rows]
    lines.extend(
        [
            "",
            "  term distribution (the point of the exercise):",
            f"    citation_resolution   min {min(resolutions):.3f}"
            f"  median {statistics.median(resolutions):.3f}"
            f"  max {max(resolutions):.3f}",
            f"    authority_breadth     min {min(breadths):.3f}"
            f"  median {statistics.median(breadths):.3f}"
            f"  max {max(breadths):.3f}",
            "    NOTE: a term whose min == max discriminates nothing and should be",
            "    replaced, not reweighted. Breadth is a LOWER BOUND for rows scored",
            "    from storage — see the module docstring.",
            "",
        ]
    )
    return "\n".join(lines)


def _pct(part: int, whole: int) -> str:
    if whole <= 0:
        return "0.0%"
    return f"{(part / whole) * 100:.1f}%"


def _row_json(row: Row) -> dict[str, Any]:
    return {
        "answer_id": row.answer_id,
        "question_id": row.question_id,
        "subject": row.subject,
        "prompt_template_version": row.prompt_version,
        "review_status": row.review_status,
        "stored_confidence": row.stored_confidence,
        "breadth_denominator": row.denominator,
        "grounding": row.grounding or None,
        "reported_score": row.score,
        "recomputed_score": row.recomputed.score,
        "citation_resolution": row.recomputed.citation_resolution,
        "authority_breadth": row.recomputed.authority_breadth,
        "emitted_ids": row.recomputed.emitted_id_count,
        "valid_ids": row.recomputed.valid_id_count,
        "fabricated_ids": row.recomputed.fabricated_id_count,
        "cited_documents": row.recomputed.cited_document_count,
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Score bar exam answers under the grounded formula (read only).",
    )
    parser.add_argument(
        "--pilot",
        action="store_true",
        help=f"Report only rows generated under {GROUNDED_PROMPT_VERSION}.",
    )
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit per-row JSON instead of the summary.",
    )
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    raw_rows = iter_answers(limit=args.limit)
    resolved = resolve_sections(
        {i for r in raw_rows for i in _stored_cited_ids(r.get("structured_answer_json"))}
    )
    rows = [score_row(r, resolved) for r in raw_rows]

    if args.pilot:
        rows = [r for r in rows if r.grounded]

    if args.json:
        print(json.dumps([_row_json(r) for r in rows], indent=2))
        return

    if args.pilot:
        print(summarize(rows, f"PILOT ({GROUNDED_PROMPT_VERSION})"))
        return

    grounded = [r for r in rows if r.grounded]
    legacy = [r for r in rows if not r.grounded]
    print(summarize(grounded, f"GROUNDED ({GROUNDED_PROMPT_VERSION})"))
    print(
        summarize(
            legacy,
            "PRIORS-ONLY (bar_exam_alac.v1 — pre-#356 rows retrieved nothing)",
        )
    )


if __name__ == "__main__":
    main()
