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

## How "retrieval succeeded" is read

Off the **prompt version**, not off the score. ``bar_exam_alac.v2`` is
selected by the generation task only when retrieval actually returned
passages, so a v2 row IS a row where retrieval succeeded, and a v1 row written
after the #356 deploy is one where it did not. An answer that retrieved eight
passages and then cited none of them is a v2 row scoring 0.0 — a different
failure from a retrieval miss, and the two must not collapse into one number.

## What this script CANNOT show, and why

The retrieved passage set is **not persisted anywhere**. That has two
consequences worth stating rather than papering over:

* For a v2 row the authoritative score is the one written at generation time,
  from the live passage set — this script reads it. The recomputed-from-
  storage score is printed alongside as a cross-check; a divergence means the
  corpus moved under the row (a cited section was deleted), which is worth
  knowing but is not a scoring bug.
* For a v1 row there is nothing to read, so breadth is reconstructed from the
  documents its surviving citations belong to, which makes it a **lower
  bound**. Labelled as such in the output.

Retrieval-side diagnostics — BM25 spread, "passages above a relevance floor" —
are therefore **not available here at all**. Getting them means persisting the
retrieved set, and the obvious home for it, ``structured_answer_json``, is
served verbatim to the public bar exam answer endpoint
(``bar-exam-answers.public.controller.ts:126``), while ``model_runs`` has no
metadata column. That is a schema decision, not a scoring one, and it is not
in this PR. The generation task logs the per-answer term breakdown, which is
where those numbers live until then.
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
    ) -> None:
        self.answer_id = answer_id
        self.question_id = question_id
        self.subject = subject or "unknown"
        self.prompt_version = prompt_version
        self.review_status = review_status
        self.stored_confidence = stored_confidence
        self.recomputed = recomputed

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
    emitted = _stored_cited_ids(row.get("structured_answer_json"))
    valid = [i for i in emitted if i in resolved]
    cited_documents = {resolved[i] for i in valid}

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
    )


def _stored_cited_ids(structured: Any) -> list[str]:
    """Pull ``citedSectionIds`` out of a stored structured answer."""
    if isinstance(structured, str):
        try:
            structured = json.loads(structured)
        except json.JSONDecodeError:
            return []
    if not isinstance(structured, dict):
        return []
    raw = structured.get("citedSectionIds") or []
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

    lines.append("")
    lines.append("  per-subject >= bar:")
    by_subject: dict[str, list[Row]] = {}
    for row in rows:
        by_subject.setdefault(row.subject, []).append(row)
    for subject in sorted(by_subject):
        subject_rows = by_subject[subject]
        subject_pass = sum(1 for r in subject_rows if r.passes)
        subject_scores = sorted(r.score for r in subject_rows)
        lines.append(
            f"    {subject:<20} {subject_pass}/{len(subject_rows)}"
            f"   median {statistics.median(subject_scores):.3f}"
        )

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
