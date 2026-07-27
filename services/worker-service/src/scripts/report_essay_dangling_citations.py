"""Report essay citations that resolve to nothing. READ ONLY.

**This script cannot write.** No ``--apply``, no ``UPDATE``, no ``INSERT``, no
``DELETE``, no ``commit()``. A test greps the source to keep it that way, so it
is safe to point at prod.

## What it counts

An essay artifact stores its citations at
``content_json -> 'modelAnswer' -> 'outlineSections'[] -> 'citedSectionIds'``.
A **ref** is one entry in one of those lists. A ref is **dangling** when it
matches no ``legal_document_sections.id`` — not merely when it belongs to a
different document. The distinction matters: measured on prod 2026-07-27,
39,992 of 67,515 refs (59.2%) resolved to *nothing*, and **zero** resolved to a
section of another document. Those IDs were invented, not mis-attributed, and
"fix the join" was never an available reading.

Per essay the script also reports whether the artifact has **any** dangling
ref, because that, not the ref count, is what makes a published artifact
uncitable for a reader.

## Why it exists

It is the acceptance evidence for `fix/essay-citation-hallucination`. The unit
tests prove that a fabricated ID is stripped and scored accordingly; they
cannot prove the model stopped emitting them, or that the strip is reached on
the live path. Only live rows show that.

Run it **after** the fix has been deployed and some essays have been generated
under it::

    cd services/worker-service
    uv run python -m src.scripts.report_essay_dangling_citations
    uv run python -m src.scripts.report_essay_dangling_citations --split-by-version
    uv run python -m src.scripts.report_essay_dangling_citations --created-after 2026-07-28

``--split-by-version`` is the honest comparison. It joins ``model_runs`` and
groups by ``prompt_template_version``, so post-fix rows are identified by the
prompt that produced them (``essay_generation.v2``) rather than by a timestamp
guessed against a deploy. Rows whose ``model_run_id`` is null or missing are
reported as ``unknown`` rather than folded into either bucket.

## The published list

``--published`` prints the ``public_editorial`` essays carrying at least one
dangling ref, as a markdown table, for pasting into a PR or an issue. The
0.70 gate kept most ungrounded essays out of that set — ``source_passage_
coverage`` is the one term that has always validated IDs, so a wholly
fabricated essay scored 0.5 and never crossed — which is why the published
count is small and the private one is not. It is a report. Deciding whether
to unpublish or correct those rows is not this script's business, and it has
no way to act on them regardless.
"""

from __future__ import annotations

import argparse
import json
import logging
from typing import Any

import psycopg2.extras

from ..clients.db_client import get_connection

logger = logging.getLogger(__name__)

PAGE_SIZE = 500

# The prompt version that first bound citedSectionIds to a closed list.
FIXED_PROMPT_VERSION = "essay_generation.v2"


class Tally:
    """Counts for one bucket of essays."""

    def __init__(self, label: str) -> None:
        self.label = label
        self.essays = 0
        self.essays_with_any_ref = 0
        self.essays_with_dangling = 0
        self.refs = 0
        self.refs_resolving_to_source = 0
        self.refs_resolving_to_other_document = 0
        self.refs_dangling = 0
        self.outline_sections = 0
        self.outline_sections_grounded = 0
        self.unreadable = 0

    @property
    def dangling_ref_rate(self) -> float:
        return self.refs_dangling / self.refs if self.refs else 0.0

    @property
    def dangling_essay_rate(self) -> float:
        return (
            self.essays_with_dangling / self.essays_with_any_ref
            if self.essays_with_any_ref
            else 0.0
        )

    @property
    def citation_mapping(self) -> float:
        """The validated citation term, recomputed across the bucket."""
        return (
            self.outline_sections_grounded / self.outline_sections
            if self.outline_sections
            else 0.0
        )


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


def _refs(content: dict[str, Any]) -> list[list[str]]:
    """Per outline section, the string IDs it cites."""
    model_answer = content.get("modelAnswer")
    if not isinstance(model_answer, dict):
        return []
    outline_sections = model_answer.get("outlineSections")
    if not isinstance(outline_sections, list):
        return []
    out: list[list[str]] = []
    for section in outline_sections:
        if not isinstance(section, dict):
            continue
        raw = section.get("citedSectionIds")
        out.append([v for v in raw if isinstance(v, str)] if isinstance(raw, list) else [])
    return out


def _iter_essays(
    created_after: str | None, split_by_version: bool
) -> Any:
    """Keyset-paginate essay artifacts. ``id`` is @db.Uuid — cast it as uuid.

    Casting to ``text`` here would order lexicographically and silently skip
    rows; that was #314.
    """
    version_select = (
        ", mr.prompt_template_version AS prompt_template_version"
        if split_by_version
        else ", NULL AS prompt_template_version"
    )
    version_join = (
        " LEFT JOIN model_runs mr ON mr.id = da.model_run_id"
        if split_by_version
        else ""
    )

    last_id: str | None = None
    while True:
        with get_connection() as conn, conn.cursor(
            cursor_factory=psycopg2.extras.RealDictCursor
        ) as cur:
            cur.execute(
                f"""SELECT da.id, da.source_document_id, da.content_json,
                           da.visibility, da.review_status, da.confidence_score,
                           da.created_at{version_select}
                      FROM derivative_artifacts da{version_join}
                     WHERE da.deleted_at IS NULL
                       AND da.derivative_type = 'essay_prompt'
                       AND (%s::uuid IS NULL OR da.id > %s::uuid)
                       AND (%s::timestamptz IS NULL
                            OR da.created_at >= %s::timestamptz)
                     ORDER BY da.id ASC
                     LIMIT %s""",
                (last_id, last_id, created_after, created_after, PAGE_SIZE),
            )
            rows = [dict(r) for r in cur.fetchall()]
        if not rows:
            return
        yield from rows
        last_id = str(rows[-1]["id"])


def _resolve(section_ids: set[str]) -> dict[str, str]:
    """Map each id that exists to the document it belongs to.

    One query for the whole batch of ids, not one per id. Ids absent from the
    result are the dangling ones — the point of the exercise.
    """
    if not section_ids:
        return {}
    with get_connection() as conn, conn.cursor(
        cursor_factory=psycopg2.extras.RealDictCursor
    ) as cur:
        cur.execute(
            """SELECT id, legal_document_id
                 FROM legal_document_sections
                WHERE id = ANY(%s::uuid[])""",
            (sorted(section_ids),),
        )
        return {str(r["id"]): str(r["legal_document_id"]) for r in cur.fetchall()}


def _looks_like_uuid(value: str) -> bool:
    """Cheap shape filter, so a stub like "1" never reaches ``::uuid[]``.

    A malformed literal in the array cast aborts the whole statement, which
    would turn one bad row into a crashed run.
    """
    parts = value.split("-")
    return (
        len(value) == 36
        and len(parts) == 5
        and all(
            len(p) == n and all(c in "0123456789abcdefABCDEF" for c in p)
            for p, n in zip(parts, (8, 4, 4, 4, 12), strict=True)
        )
    )


def collect(
    created_after: str | None, split_by_version: bool
) -> tuple[dict[str, Tally], list[dict[str, Any]]]:
    """Return (tallies by bucket, published essays with dangling refs)."""
    batch: list[dict[str, Any]] = []
    tallies: dict[str, Tally] = {}
    published_dangling: list[dict[str, Any]] = []

    def bucket_for(row: dict[str, Any]) -> str:
        if not split_by_version:
            return "all essays"
        version = row.get("prompt_template_version")
        if not version:
            return "unknown (no model_run)"
        return str(version)

    def flush() -> None:
        if not batch:
            return
        wanted = {
            sid
            for row in batch
            for section in row["_refs"]
            for sid in section
            if _looks_like_uuid(sid)
        }
        resolved = _resolve(wanted)

        for row in batch:
            label = bucket_for(row)
            tally = tallies.setdefault(label, Tally(label))
            tally.essays += 1

            source_document_id = (
                str(row["source_document_id"]) if row["source_document_id"] else None
            )
            row_refs = 0
            row_dangling = 0
            for section in row["_refs"]:
                tally.outline_sections += 1
                grounded = False
                for sid in section:
                    row_refs += 1
                    tally.refs += 1
                    owner = resolved.get(sid)
                    if owner is None:
                        tally.refs_dangling += 1
                        row_dangling += 1
                    elif owner == source_document_id:
                        tally.refs_resolving_to_source += 1
                        grounded = True
                    else:
                        tally.refs_resolving_to_other_document += 1
                        grounded = True
                if grounded:
                    tally.outline_sections_grounded += 1

            if row_refs:
                tally.essays_with_any_ref += 1
            if row_dangling:
                tally.essays_with_dangling += 1
                if row.get("visibility") == "public_editorial":
                    published_dangling.append(
                        {
                            "id": str(row["id"]),
                            "source_document_id": source_document_id,
                            "dangling": row_dangling,
                            "refs": row_refs,
                            "confidence_score": row.get("confidence_score"),
                            "review_status": row.get("review_status"),
                            "created_at": row.get("created_at"),
                            "prompt_template_version": row.get(
                                "prompt_template_version"
                            ),
                        }
                    )
        batch.clear()

    for row in _iter_essays(created_after, split_by_version):
        content = _content(row.get("content_json"))
        if content is None:
            label = bucket_for(row)
            tallies.setdefault(label, Tally(label)).unreadable += 1
            continue
        row["_refs"] = _refs(content)
        batch.append(row)
        if len(batch) >= PAGE_SIZE:
            flush()
    flush()

    published_dangling.sort(key=lambda r: (-r["dangling"], r["id"]))
    return tallies, published_dangling


def print_report(
    tallies: dict[str, Tally],
    published_dangling: list[dict[str, Any]],
    show_published: bool,
) -> None:
    print()
    print("ESSAY CITATION RESOLUTION — no rows were modified.")
    print()
    print("A ref is one entry in citedSectionIds[]. 'dangling' means it matches")
    print("no legal_document_sections row at all — not that it points elsewhere.")
    print()

    header = (
        f"{'bucket':<28}{'essays':>8}{'refs':>9}{'->source':>10}{'->other':>9}"
        f"{'DANGLING':>10}{'dang %':>9}{'essays w/':>11}{'cite':>8}"
    )
    print(header)
    print("-" * len(header))
    for label in sorted(tallies):
        t = tallies[label]
        print(
            f"{t.label[:27]:<28}{t.essays:>8}{t.refs:>9}"
            f"{t.refs_resolving_to_source:>10}"
            f"{t.refs_resolving_to_other_document:>9}"
            f"{t.refs_dangling:>10}"
            f"{t.dangling_ref_rate:>8.1%}"
            f"{t.dangling_essay_rate:>10.1%}"
            f"{t.citation_mapping:>8.3f}"
        )
    print("-" * len(header))
    print()
    print("->source   ref resolves to a section of the essay's own source document")
    print("->other    ref resolves to a section of some other document")
    print("dang %     dangling refs / all refs")
    print("essays w/  essays with >= 1 dangling ref, over essays citing anything")
    print("cite       citation_mapping_completeness recomputed with IDs validated")
    print()
    for label in sorted(tallies):
        if tallies[label].unreadable:
            print(f"  {label}: unreadable content_json={tallies[label].unreadable}")

    fixed = tallies.get(FIXED_PROMPT_VERSION)
    if fixed is not None:
        print()
        if fixed.refs_dangling == 0:
            print(
                f"{FIXED_PROMPT_VERSION}: {fixed.refs} refs across {fixed.essays} "
                "essays, none dangling."
            )
        else:
            print(
                f"{FIXED_PROMPT_VERSION}: {fixed.refs_dangling} of {fixed.refs} refs "
                f"still dangling across {fixed.essays} essays. The strip runs before "
                "the write, so a non-zero count here means those rows were written "
                "by a worker that predates the deploy — check when they were created "
                "before reading it as the fix failing."
            )

    print()
    print(f"PUBLISHED (public_editorial) essays with >= 1 dangling ref: "
          f"{len(published_dangling)}")
    if not show_published:
        print("Pass --published to list them.")
        return
    if not published_dangling:
        return
    print()
    print("| artifact_id | source_document_id | dangling/refs | score | review |")
    print("|---|---|---|---|---|")
    for row in published_dangling:
        score = row["confidence_score"]
        score_text = f"{float(score):.4f}" if score is not None else "—"
        print(
            f"| `{row['id']}` | `{row['source_document_id']}` | "
            f"{row['dangling']}/{row['refs']} | {score_text} | "
            f"{row['review_status']} |"
        )


def main_with_args(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Report essay citedSectionIds that resolve to no section. READ ONLY."
        ),
    )
    parser.add_argument(
        "--created-after",
        default=None,
        help="Only essays created at or after this timestamp (ISO 8601).",
    )
    parser.add_argument(
        "--split-by-version",
        action="store_true",
        help=(
            "Group by the prompt_template_version in model_runs, so post-fix "
            "rows are identified by the prompt that produced them."
        ),
    )
    parser.add_argument(
        "--published",
        action="store_true",
        help="List the public_editorial essays carrying a dangling ref.",
    )
    parser.add_argument(
        "--log-level", default="WARNING",
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
    )
    args = parser.parse_args(argv)
    logging.basicConfig(level=getattr(logging, args.log_level))

    tallies, published_dangling = collect(args.created_after, args.split_by_version)
    print_report(tallies, published_dangling, args.published)
    return 0


def main() -> int:
    return main_with_args(None)


if __name__ == "__main__":
    raise SystemExit(main())
