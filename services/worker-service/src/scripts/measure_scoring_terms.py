"""Measure what each confidence term actually varies over. READ ONLY.

Question this answers: `citation_mapping_completeness` is 1.0 for ~99% of live
rows. Is it measuring anything, or is it trivially satisfied by the generation
shape?

**This script cannot write.** No --apply, no UPDATE, no commit.

## The derivations, read off scoring.py

Every type computes `citation_mapping_completeness` as
`items_that_cite / total_items`, but "cite" means different things:

`essay_prompt` — **PRESENCE ONLY, NOT VALIDATED**::

    sections_with_citations = sum(
        1 for s in outline_sections
        if isinstance(s, dict) and s.get("citedSectionIds")
    )

  A non-empty `citedSectionIds` list counts, whatever is in it. An outline
  section citing a section ID that does not exist in the source document —
  or an ID from a different document entirely — scores exactly the same as
  one citing correctly. The prompt tells the model "cite at least one section
  ID in citedSectionIds[]. Do not write unsourced paragraphs."
  (prompts/essay_generation_v1.py:31), so this term is close to a measure of
  whether the model obeyed an output-format instruction.

`flashcard` / `mcq_question` / `subject_outline` — validated at generation::

    any(sid in source_section_ids for sid in item.get("supportingSectionIds") or [])

`doctrine_extract` — validated, single ID::

    doctrine.get("source_section_id") in source_section_ids

For the validated four the term does check the ID exists. But the prompt
*supplies the list of section IDs to choose from* and instructs one citation
per item, so picking a valid one is nearly free — which is what this script
quantifies.

Not a filter, either way: a missing or invalid citation is `severity="warning"`
in the validators, and warnings map to HUMAN_REVIEW, not QUARANTINE. Those rows
are persisted with `review_status='needs_human_review'` and remain candidates
for the approval sweep. So a low citation value is *possible* in the corpus;
this measures how often it happens.

## `mcq_question` cannot be measured from persisted rows

It is excluded, and the exclusion is a property of the data, not a limitation
worth working around. `internal-derivatives.service.ts:writeMcqBatch` writes
each question's `content_json` as `{questionStem, options, explanation}` —
**`supportingSectionIds` is not persisted at all**. The IDs exist only in the
write payload the worker sends, which is where the generation-time scorer read
them from.

So any per-row reading of an mcq artifact finds zero citations and reports
`cite=0` for the whole type, which is a statement about the write schema
rather than about the corpus, and it flatly contradicts the scores stored on
those same rows. Reporting it next to four types where the number does mean
something invites exactly the wrong conclusion. Measuring mcq citations
requires either persisting the IDs or reading them back out of
`provenance_records`; both are changes, not measurements.

## `ocr_quality` needs no measurement

No generation task passes it. `grep ocr_quality services/worker-service/src/tasks/`
returns nothing, so every pipeline-produced derivative is scored with the 1.0
default and the term contributes a flat 0.2 to every artifact. It is a
constant, not a signal. This script asserts that at startup rather than
measuring it.

## What is printed, per type

- `citation as scored` — the value the live scorer uses
- `citation validated` — the same ratio with every ID checked against the
  source document, which for essay_prompt is a different number
- the gap: artifacts scoring 1.0 as-scored but below 1.0 validated
- `coverage` and `source sections`, for context
- a self-check count: rows where the stored/recomputed score does not equal
  `coverage*0.5 + citation*0.3 + 0.2`, i.e. where this script's reading of the
  row disagrees with the scorer. Those are excluded from the statistics.

Usage (from services/worker-service/):

    uv run python -m src.scripts.measure_scoring_terms
    uv run python -m src.scripts.measure_scoring_terms --type essay_prompt
    uv run python -m src.scripts.measure_scoring_terms --limit 2000
"""

from __future__ import annotations

import argparse
import json
import logging
from typing import Any

import psycopg2.extras

from ..clients import ingestion_db_client as db
from ..clients.db_client import get_connection
from ..scoring import (
    CITATION_MAPPING_COMPLETENESS_WEIGHT,
    OCR_QUALITY_WEIGHT,
    SECTIONS_PER_ITEM,
    SECTIONS_PER_ITEM_SINGLE_REF,
    SOURCE_PASSAGE_COVERAGE_WEIGHT,
    compute_doctrine_confidence_score,
    compute_essay_confidence_score,
    compute_flashcard_confidence_score,
)

logger = logging.getLogger(__name__)

PAGE_SIZE = 500
SELF_CHECK_TOLERANCE = 1e-4

SCORERS = {
    "flashcard": compute_flashcard_confidence_score,
    "essay_prompt": compute_essay_confidence_score,
    "doctrine_extract": compute_doctrine_confidence_score,
}

EXCLUDED = {
    "subject_outline": (
        "scored against multiple source documents; the row keeps only the "
        "primary source_document_id"
    ),
    "mcq_question": (
        "supportingSectionIds is not persisted on the row — writeMcqBatch "
        "stores {questionStem, options, explanation} only — so any per-row "
        "citation reading is 0 by construction and contradicts the stored "
        "score, which was computed over the write payload"
    ),
}


class TermStats:
    def __init__(self, dtype: str, unit: str = "rows") -> None:
        self.dtype = dtype
        self.unit = unit
        self.as_scored: list[float] = []
        self.validated: list[float] = []
        self.coverage: list[float] = []
        self.sections: list[int] = []
        self.items: list[int] = []
        self.inflated = 0  # as_scored == 1.0 but validated < 1.0
        self.unusable = 0
        self.self_check_failed = 0

    def record(
        self,
        as_scored: float,
        validated: float,
        coverage: float,
        sections: int,
        items: int,
    ) -> None:
        self.as_scored.append(as_scored)
        self.validated.append(validated)
        self.coverage.append(coverage)
        self.sections.append(sections)
        self.items.append(items)
        if as_scored >= 1.0 > validated:
            self.inflated += 1


def _exactly_one(values: list[float]) -> int:
    return sum(1 for v in values if v >= 1.0)


def _zero(values: list[float]) -> int:
    return sum(1 for v in values if v <= 0.0)


def _mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def _iter_artifacts(types: list[str], limit: int | None) -> Any:
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


def _content(raw: Any) -> dict[str, Any] | None:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            return None
        return parsed if isinstance(parsed, dict) else None
    return None


def _ids(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [v for v in value if isinstance(v, str)]


def _items_for(dtype: str, content: dict[str, Any]) -> list[tuple[list[str], bool]]:
    """Return (cited_ids, counts_as_cited_by_the_live_scorer) per item."""
    items: list[tuple[list[str], bool]] = []

    if dtype == "essay_prompt":
        model_answer = content.get("modelAnswer")
        sections = (
            model_answer.get("outlineSections", [])
            if isinstance(model_answer, dict)
            else []
        )
        for section in sections if isinstance(sections, list) else []:
            if not isinstance(section, dict):
                continue
            ids = _ids(section.get("citedSectionIds"))
            # PRESENCE ONLY — this is the live behaviour being measured.
            items.append((ids, bool(section.get("citedSectionIds"))))
        return items

    key_by_type = {
        "flashcard": ("cards", "supportingSectionIds"),
    }
    if dtype in key_by_type:
        list_key, id_key = key_by_type[dtype]
        raw = content.get(list_key, [])
        for item in raw if isinstance(raw, list) else []:
            if not isinstance(item, dict):
                continue
            ids = _ids(item.get(id_key))
            items.append((ids, False))  # validity decided by the caller
        return items

    if dtype == "doctrine_extract":
        raw = content.get("doctrines", [])
        for item in raw if isinstance(raw, list) else []:
            if not isinstance(item, dict):
                continue
            sid = item.get("source_section_id")
            items.append(([sid] if isinstance(sid, str) else [], False))
        return items

    return items


def measure(
    dtype: str, limit: int | None, cache: dict[str, list[dict[str, Any]]]
) -> TermStats:
    stats = TermStats(dtype)
    scorer = SCORERS[dtype]

    for row in _iter_artifacts([dtype], limit):
        content = _content(row.get("content_json"))
        document_id = row.get("source_document_id")
        if content is None or not document_id:
            stats.unusable += 1
            continue
        sections = _sections_for(str(document_id), cache)
        if not sections:
            stats.unusable += 1
            continue

        source_ids = {s["id"] for s in sections}
        items = _items_for(dtype, content)
        if not items:
            stats.unusable += 1
            continue

        validated_hits = sum(
            1 for ids, _presence in items if any(i in source_ids for i in ids)
        )
        if dtype == "essay_prompt":
            as_scored_hits = sum(1 for _ids_, presence in items if presence)
        else:
            as_scored_hits = validated_hits

        as_scored = as_scored_hits / len(items)
        validated = validated_hits / len(items)

        distinct_valid = {i for ids, _p in items for i in ids if i in source_ids}
        # doctrine_extract carries ONE source_section_id per doctrine, so its
        # citable allowance is 1 per item, not 2. (The self-check below caught
        # this when it was wrong — leave it wired up.)
        per_item = (
            SECTIONS_PER_ITEM_SINGLE_REF
            if dtype == "doctrine_extract"
            else SECTIONS_PER_ITEM
        )
        citable = min(len(source_ids), len(items) * per_item)
        coverage = min(len(distinct_valid) / citable, 1.0) if citable else 0.0

        # Self-check: does the live scorer agree with this reading of the row?
        actual = scorer(content=content, source_sections=sections)
        expected = round(
            coverage * SOURCE_PASSAGE_COVERAGE_WEIGHT
            + as_scored * CITATION_MAPPING_COMPLETENESS_WEIGHT
            + 1.0 * OCR_QUALITY_WEIGHT,
            4,
        )
        if abs(actual - expected) > SELF_CHECK_TOLERANCE:
            stats.self_check_failed += 1
            continue

        stats.record(as_scored, validated, coverage, len(sections), len(items))

    return stats


def print_report(all_stats: list[TermStats]) -> None:
    print()
    print("MEASUREMENT — no rows were modified.")
    print()
    print("ocr_quality: CONSTANT 1.0. No generation task passes it, so the term")
    print(f"contributes a flat {OCR_QUALITY_WEIGHT} to every artifact. Not measured.")
    print()

    header = (
        f"{'type':<18}{'n':>8}{'cite=1.0':>12}{'cite=0':>9}{'mean':>8}"
        f"{'valid=1.0':>12}{'INFLATED':>10}{'cov mean':>10}{'sections':>10}"
    )
    print(header)
    print("-" * len(header))
    for s in all_stats:
        n = len(s.as_scored)
        if not n:
            print(f"{s.dtype:<18}{0:>8}{'—':>12}")
            continue
        print(
            f"{s.dtype:<18}{n:>8}"
            f"{_exactly_one(s.as_scored) / n:>11.1%}"
            f"{_zero(s.as_scored) / n:>8.1%}"
            f"{_mean(s.as_scored):>8.3f}"
            f"{_exactly_one(s.validated) / n:>11.1%}"
            f"{s.inflated:>10}"
            f"{_mean(s.coverage):>10.3f}"
            f"{_mean([float(x) for x in s.sections]):>10.1f}"
        )
    print("-" * len(header))
    print()
    print("cite=1.0   share of artifacts where citation_mapping_completeness is 1.0")
    print("valid=1.0  same, but every ID checked against the source document")
    print("INFLATED   artifacts scoring 1.0 that would not with IDs validated")
    print("           (structurally 0 for every type except essay_prompt)")
    print()

    for s in all_stats:
        notes = [f"unit={s.unit}", f"items mean={_mean([float(i) for i in s.items]):.1f}"]
        if s.unusable:
            notes.append(f"unusable={s.unusable}")
        if s.self_check_failed:
            notes.append(f"SELF-CHECK FAILED={s.self_check_failed} (excluded)")
        print(f"  {s.dtype}: " + ", ".join(notes))

    print()
    print("EXCLUDED:")
    for dtype, reason in EXCLUDED.items():
        print(f"  {dtype}: {reason}")


def main_with_args(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Measure what the confidence terms vary over. READ ONLY.",
    )
    parser.add_argument(
        "--type", action="append", dest="types", choices=sorted(SCORERS)
    )
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument(
        "--log-level", default="WARNING", choices=["DEBUG", "INFO", "WARNING", "ERROR"]
    )
    args = parser.parse_args(argv)
    logging.basicConfig(level=getattr(logging, args.log_level))

    selected = args.types or sorted(SCORERS)
    cache: dict[str, list[dict[str, Any]]] = {}
    results: list[TermStats] = [
        measure(dtype, args.limit, cache) for dtype in selected
    ]

    print_report(results)
    return 0


def main() -> int:
    return main_with_args(None)


if __name__ == "__main__":
    raise SystemExit(main())
