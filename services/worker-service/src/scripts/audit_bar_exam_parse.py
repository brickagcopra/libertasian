"""Compare stored bar exam questions against a fresh parse. READ ONLY.

**This script cannot write.** No ``--apply``, no ``UPDATE``, no ``INSERT``,
no ``DELETE``, no ``commit()``. A test greps the source to keep it that way,
so it is safe to point at prod.

## What it is for

Five 2015 sittings on prod stored four "questions" each that were not
questions at all — they were the exam instructions ("1. This Questionnaire
contains …"), taken from the page because a 2015 paper hands its numbering to
the browser via ``<ol type="I">`` and so carries no Roman numeral the old
parser could see. Nothing detected it: the ingest reported success, the
document published, and the sittings simply held four rows apiece.

What makes that detectable is comparing three numbers that should agree:

* **stored** — how many ``bar_exam_questions`` rows the sitting has now.
* **parsed** — how many the current parser finds in the page today.
* **expected** — how many the page itself says it has ("There are 22 items"),
  or blank when it does not say.

A row is flagged MISMATCH when any two of those disagree. A 2015 criminal
sitting reads ``stored=4 parsed=22 expected=22`` — the fix and its evidence
in one line.

## Usage

    # Every sitting in the registry. Slow: one polite fetch per page.
    uv run python -m src.scripts.audit_bar_exam_parse

    # Just the years in question.
    uv run python -m src.scripts.audit_bar_exam_parse --years 2007,2011,2015

    # Only what disagrees.
    uv run python -m src.scripts.audit_bar_exam_parse --mismatches-only

    # JSON for a report.
    uv run python -m src.scripts.audit_bar_exam_parse --years 2015 --json

## The fetch window

Fetching goes through ``LawphilBarFetcher``, the same client the ingest task
uses, so the shared polite delay and Cloudflare detection apply. The run
refuses to start outside the configured fetch window (13:00-18:00
America/New_York by default): auditing the whole registry is ~100 requests,
and the window exists because LawPhil throttles during PH business hours.
``--force-window`` overrides that for a small targeted run; it is a
deliberate choice a human makes, never a default.
"""

from __future__ import annotations

import argparse
import json
import logging
from dataclasses import asdict, dataclass
from typing import Any

import psycopg2.extras

from ..backfill.fetch_window import is_in_fetch_window
from ..clients.db_client import get_connection
from ..fetchers.lawphil_bar import LawphilBarFetcher
from ..parsers.lawphil_bar_html import parse_page
from ..tasks.bar_exam_subjects import (
    ALL_YEAR_SLUGS,
    archive_url_for,
    get_subject_meta,
)

logger = logging.getLogger(__name__)


@dataclass
class AuditRow:
    """One (year, slug) sitting: what is stored vs what the page says now."""

    year: int
    subject_slug: str
    subject_study_code: str | None
    sitting_id: str | None
    document_id: str | None
    stored_questions: int | None
    parsed_questions: int | None
    expected_items: int | None
    page_format: str | None
    error: str | None = None

    @property
    def mismatch(self) -> bool:
        """True when the three counts do not agree.

        A sitting that does not exist yet is not a mismatch — there is
        nothing stored to disagree with the page. A fetch or parse error is,
        because an audit that cannot see the page cannot clear it either.
        """
        if self.error is not None:
            return True
        if self.parsed_questions is None:
            return True
        if (
            self.expected_items is not None
            and self.parsed_questions != self.expected_items
        ):
            return True
        if self.sitting_id is None:
            return False
        return self.stored_questions != self.parsed_questions


def stored_counts() -> dict[tuple[int, str], dict[str, Any]]:
    """``{(year, study_code): {sitting_id, document_id, questions}}`` for
    every sitting, with its question count. One query, not one per sitting.
    """
    sql = """
        SELECT s.id AS sitting_id,
               s.year,
               s.subject_study_code,
               s.source_document_id,
               COUNT(q.id) AS questions
        FROM bar_exam_sittings s
        LEFT JOIN bar_exam_questions q ON q.bar_exam_sitting_id = s.id
        GROUP BY s.id, s.year, s.subject_study_code, s.source_document_id
    """
    with get_connection() as conn, \
            conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(sql)
        rows = cur.fetchall()
    return {
        (int(r["year"]), str(r["subject_study_code"])): {
            "sitting_id": str(r["sitting_id"]),
            "document_id": (
                str(r["source_document_id"]) if r["source_document_id"] else None
            ),
            "questions": int(r["questions"]),
        }
        for r in rows
    }


def audit_one(
    year: int,
    slug: str,
    stored: dict[tuple[int, str], dict[str, Any]],
    fetcher: LawphilBarFetcher,
) -> AuditRow:
    """Fetch and parse one page, and line it up against what is stored."""
    meta = get_subject_meta(slug)
    study_code = meta.study_code if meta else None
    existing = stored.get((year, study_code)) if study_code else None
    row = AuditRow(
        year=year,
        subject_slug=slug,
        subject_study_code=study_code,
        sitting_id=existing["sitting_id"] if existing else None,
        document_id=existing["document_id"] if existing else None,
        stored_questions=existing["questions"] if existing else None,
        parsed_questions=None,
        expected_items=None,
        page_format=None,
    )
    if meta is None:
        row.error = f"unknown_subject_slug:{slug}"
        return row

    url = archive_url_for(year, slug)
    try:
        content = fetcher.fetch_content(url)
    except Exception as exc:  # noqa: BLE001 — one bad page must not end the run
        row.error = f"{type(exc).__name__}: {exc}"[:200]
        return row

    page = parse_page(content.html)
    row.parsed_questions = len(page.questions)
    row.expected_items = page.expected_items
    row.page_format = page.page_format
    return row


def format_table(rows: list[AuditRow]) -> str:
    """Fixed-width report. The MISMATCH column is the point of the script."""
    header = (
        f"{'year':<6}{'slug':<14}{'stored':>7}{'parsed':>7}{'expected':>9}"
        f"  {'format':<13}{'flag':<9}notes"
    )
    lines = [header, "-" * len(header)]
    for row in rows:
        lines.append(
            f"{row.year:<6}{row.subject_slug:<14}"
            f"{_num(row.stored_questions):>7}{_num(row.parsed_questions):>7}"
            f"{_num(row.expected_items):>9}  {(row.page_format or '-'):<13}"
            f"{('MISMATCH' if row.mismatch else 'ok'):<9}{row.error or ''}"
        )
    flagged = sum(1 for r in rows if r.mismatch)
    lines.append("-" * len(header))
    lines.append(f"{len(rows)} sitting(s) audited, {flagged} flagged MISMATCH")
    return "\n".join(lines)


def _num(value: int | None) -> str:
    return "-" if value is None else str(value)


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Compare stored bar exam question counts against a fresh parse "
            "(read only)."
        ),
    )
    parser.add_argument(
        "--years",
        default=None,
        help="Comma-separated years to audit, e.g. 2007,2011,2015. "
             "Default: every year in the registry.",
    )
    parser.add_argument(
        "--mismatches-only",
        action="store_true",
        help="Print only the sittings whose counts disagree.",
    )
    parser.add_argument("--json", action="store_true", help="Emit JSON rows.")
    parser.add_argument(
        "--force-window",
        action="store_true",
        help="Run outside the configured LawPhil fetch window. Use only for a "
             "small targeted audit.",
    )
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    if not is_in_fetch_window() and not args.force_window:
        raise SystemExit(
            "Outside the LawPhil fetch window (default 13:00-18:00 "
            "America/New_York). Re-run inside it, or pass --force-window for a "
            "small targeted audit."
        )

    years: set[int] | None = None
    if args.years:
        years = {int(part) for part in args.years.split(",") if part.strip()}

    targets = [
        (year, slug)
        for year, slug in ALL_YEAR_SLUGS
        if years is None or year in years
    ]
    if not targets:
        raise SystemExit(f"No sittings in the registry for years={args.years}")

    stored = stored_counts()
    fetcher = LawphilBarFetcher()
    rows = [audit_one(year, slug, stored, fetcher) for year, slug in targets]

    if args.mismatches_only:
        rows = [row for row in rows if row.mismatch]

    if args.json:
        print(json.dumps([
            {**asdict(row), "mismatch": row.mismatch} for row in rows
        ], indent=2))
        return

    print(format_table(rows))


if __name__ == "__main__":
    main()
