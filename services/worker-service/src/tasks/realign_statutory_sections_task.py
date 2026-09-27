"""LIBERTASIAN Worker Service — Realign off-by-one statutory sections.

Repairs ``legal_document_sections`` rows written by the pre-fix
``seed_codals_task._parse_sections``. LawPhil markup is
``<p><b>Article 1317.</b> text…</p>``; the old parser visited the parent
``<p>`` before its child ``<b>``, so the paragraph was appended to the
CURRENT (Art. 1316) buffer before the marker opened Art. 1317. Every row
labelled "Article N." therefore holds the continuation of Art. N plus the
first paragraph of Art. N+1 (prod 2026-09-27: 3,414 of 3,420 checkable
sections disagree with their label).

Algorithm (per statutory document, i.e. ``document_type <> 'decision'``):

1. Take the rows ordered by ``ordering`` and concatenate their
   ``plain_text`` (joined by one space, as the parser joined paragraphs).
2. For each row, search forward from the cursor for the row's OWN label
   string (e.g. ``Article 1318.``), whitespace-insensitive, with word
   boundaries so ``Section 3`` never matches ``Section 30``.
3. A row's new text runs from its label to the next row's label.

Every row keeps its ``id``, ``section_label`` and ``ordering`` — bookmarks,
annotations, provenance_records and audio_renditions reference them. Only
``plain_text`` (and ``token_count`` when it was already populated) changes.

A document is skipped whole when any label (other than the first row's —
see ``align_sections``) is not found, when the non-space character count
would change, when two rows share an ``ordering``, or when any row carries
``html_text`` (it would be left describing the old split). Decisions are
never touched. No ``legal_document_versions`` row is written or modified:
the document's text is invariant, only its segmentation moves.

**Manual trigger only** — NOT on the Celery beat. Dry-run is the default
and writes nothing to the database, only report files:

    docker compose -f docker-compose.prod.yml exec worker-service \\
        uv run python -m src.tasks.realign_statutory_sections_task --dry-run

    docker compose -f docker-compose.prod.yml exec worker-service \\
        uv run python -m src.tasks.realign_statutory_sections_task --commit

``--commit`` applies one transaction per document (rows re-read ``FOR
UPDATE`` and re-aligned inside it, each UPDATE guarded on the old text)
plus one append-only ``audit_logs`` row per document. Re-running is a
no-op: an aligned document realigns to itself.

Reports (both modes) land in ``--out-dir``: ``documents.csv``,
``sections.csv`` (full before/after text of every changed row — keep it,
it is the rollback record), ``audio_renditions.csv`` (renditions voicing a
changed section — listed, never modified) and ``summary.txt``.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import logging
import re
import sys
import uuid
from collections import Counter
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import psycopg2.extras
from celery import shared_task

from ..clients.db_client import get_connection, get_read_connection

logger = logging.getLogger(__name__)

TASK_NAME = "realign_statutory_sections"
AUDIT_ACTION = "document.sections_realigned"
SAMPLES_PER_DOC = 3
SAMPLE_CHARS = 160
_ID_CHUNK = 1000

# Skip reasons — stable strings, they appear in the CSV and summary.
SKIP_NO_SECTIONS = "no_sections"
SKIP_DUPLICATE_ORDERING = "duplicate_ordering"
SKIP_HTML_TEXT = "html_text_present"
SKIP_LABEL_NOT_FOUND = "label_not_found"
SKIP_TEXT_BEFORE_FIRST_LABEL = "text_before_first_label"
SKIP_CHAR_COUNT_CHANGED = "non_space_char_count_changed"
SKIP_CHANGED_DURING_COMMIT = "changed_during_commit"


# ---------------------------------------------------------------------------
# Pure alignment
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class SectionRow:
    id: str
    section_label: str | None
    ordering: int
    plain_text: str | None
    html_text: str | None = None
    token_count: int | None = None


@dataclass(frozen=True)
class SectionChange:
    section_id: str
    ordering: int
    section_label: str | None
    before: str
    after: str
    token_count: int | None  # new value; None leaves the column NULL


@dataclass
class AlignmentResult:
    status: str  # "aligned" | "unchanged" | "skipped"
    reason: str | None = None
    changes: list[SectionChange] = field(default_factory=list)
    section_count: int = 0
    first_label_missing: bool = False
    non_space_chars: int = 0


def _non_space_count(text: str) -> int:
    return sum(1 for ch in text if not ch.isspace())


def _estimate_tokens(text: str) -> int:
    """Same estimate as ``parsers.html_parser`` (~1.3 tokens per word)."""
    return int(len(text.split()) * 1.3)


def label_pattern(label: str | None) -> re.Pattern[str] | None:
    """Whitespace-insensitive, word-bounded, case-sensitive label regex.

    Case-sensitive on purpose: LawPhil headings are ``Article 1318.``
    while running cross-references are usually ``article 1318``.
    """
    if label is None:
        return None
    words = label.split()
    if not words:
        return None
    body = r"\s+".join(re.escape(w) for w in words)
    prefix = r"(?<!\w)" if words[0][0].isalnum() or words[0][0] == "_" else ""
    suffix = r"(?!\w)" if words[-1][-1].isalnum() or words[-1][-1] == "_" else ""
    return re.compile(prefix + body + suffix)


def align_sections(rows: Sequence[SectionRow]) -> AlignmentResult:
    """Compute the realigned ``plain_text`` for one document's rows.

    ``rows`` may arrive in any order; they are sorted by ``ordering``.
    The first row's label may be absent from the text: the old parser
    dropped the paragraph that opened the first marker (no section was
    open yet), so the first row starts at offset 0 instead and the doc is
    flagged ``first_label_missing`` (the lost paragraph needs a re-seed).
    Every other label must be found, in order, or the doc is skipped.
    """
    ordered = sorted(rows, key=lambda r: r.ordering)
    result = AlignmentResult(status="skipped", section_count=len(ordered))
    if not ordered:
        result.reason = SKIP_NO_SECTIONS
        return result
    if len({r.ordering for r in ordered}) != len(ordered):
        result.reason = SKIP_DUPLICATE_ORDERING
        return result
    if any(r.html_text for r in ordered):
        result.reason = SKIP_HTML_TEXT
        return result

    olds = [r.plain_text or "" for r in ordered]
    concat = " ".join(olds)
    before_count = sum(_non_space_count(t) for t in olds)
    result.non_space_chars = before_count

    starts: list[int] = []
    cursor = 0
    for idx, row in enumerate(ordered):
        pattern = label_pattern(row.section_label)
        match = pattern.search(concat, cursor) if pattern else None
        if match is None:
            if idx == 0:
                result.first_label_missing = True
                starts.append(0)
                continue
            result.reason = (
                f"{SKIP_LABEL_NOT_FOUND}: ordering={row.ordering} "
                f"label={row.section_label!r}"
            )
            return result
        starts.append(match.start())
        cursor = match.end()

    if concat[: starts[0]].strip():
        result.reason = SKIP_TEXT_BEFORE_FIRST_LABEL
        return result

    bounds = [*starts[1:], len(concat)]
    news = [concat[s:e].strip() for s, e in zip(starts, bounds, strict=True)]
    after_count = sum(_non_space_count(t) for t in news)
    if after_count != before_count:
        result.reason = f"{SKIP_CHAR_COUNT_CHANGED}: {before_count} -> {after_count}"
        return result

    for row, old, new in zip(ordered, olds, news, strict=True):
        if old == new:
            continue
        result.changes.append(
            SectionChange(
                section_id=row.id,
                ordering=row.ordering,
                section_label=row.section_label,
                before=old,
                after=new,
                token_count=(
                    _estimate_tokens(new) if row.token_count is not None else None
                ),
            ),
        )
    result.status = "aligned" if result.changes else "unchanged"
    return result


# ---------------------------------------------------------------------------
# Database access
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class StatutoryDocument:
    id: str
    title: str | None
    document_type: str


def _fetch_statutory_documents(
    conn: Any,
    *,
    document_ids: list[str] | None,
    limit: int | None,
) -> list[StatutoryDocument]:
    """Every non-decision document, oldest id first. Decisions are excluded
    in SQL AND by the caller-supplied id filter never widening it."""
    sql = (
        "SELECT id::text, title, document_type FROM legal_documents "
        "WHERE document_type <> 'decision'"
    )
    params: list[Any] = []
    if document_ids:
        sql += " AND id::text = ANY(%s)"
        params.append(document_ids)
    sql += " ORDER BY id"
    if limit is not None:
        sql += " LIMIT %s"
        params.append(limit)
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(sql, params)
        return [
            StatutoryDocument(
                id=str(r["id"]),
                title=r["title"],
                document_type=str(r["document_type"]),
            )
            for r in cur.fetchall()
        ]


def _fetch_section_rows(
    conn: Any,
    document_id: str,
    *,
    for_update: bool = False,
) -> list[SectionRow]:
    sql = (
        "SELECT id::text, section_label, ordering, plain_text, html_text, "
        "token_count FROM legal_document_sections "
        "WHERE legal_document_id = %s ORDER BY ordering, id"
    )
    if for_update:
        sql += " FOR UPDATE"
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(sql, (document_id,))
        return [
            SectionRow(
                id=str(r["id"]),
                section_label=r["section_label"],
                ordering=int(r["ordering"]),
                plain_text=r["plain_text"],
                html_text=r["html_text"],
                token_count=r["token_count"],
            )
            for r in cur.fetchall()
        ]


def _document_type_of(conn: Any, document_id: str) -> str | None:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT document_type FROM legal_documents WHERE id = %s FOR UPDATE",
            (document_id,),
        )
        row = cur.fetchone()
        return str(row[0]) if row else None


class ConcurrentChangeError(RuntimeError):
    """A guarded UPDATE matched no row — the text moved under us."""


def _apply_changes(cur: Any, document_id: str, changes: list[SectionChange]) -> None:
    for change in changes:
        cur.execute(
            """UPDATE legal_document_sections
                  SET plain_text = %s,
                      token_count = %s
                WHERE id = %s
                  AND legal_document_id = %s
                  AND COALESCE(plain_text, '') = %s""",
            (
                change.after,
                change.token_count,
                change.section_id,
                document_id,
                change.before,
            ),
        )
        if cur.rowcount != 1:
            raise ConcurrentChangeError(
                f"section {change.section_id} changed during realignment",
            )


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def build_audit_metadata(result: AlignmentResult) -> dict[str, Any]:
    """Diff metadata for the audit row: hashes and lengths, not full text
    (a Civil Code run would otherwise put megabytes in one row). The full
    before/after text is in ``sections.csv``."""
    return {
        "task": TASK_NAME,
        "section_count": result.section_count,
        "rows_changed": len(result.changes),
        "first_label_missing": result.first_label_missing,
        "non_space_chars": result.non_space_chars,
        "changed_fields": ["plain_text", "token_count"],
        "changes": [
            {
                "section_id": c.section_id,
                "ordering": c.ordering,
                "section_label": c.section_label,
                "before_sha256": _sha256(c.before),
                "after_sha256": _sha256(c.after),
                "before_len": len(c.before),
                "after_len": len(c.after),
            }
            for c in result.changes
        ],
    }


def _insert_audit_log(cur: Any, *, document_id: str, metadata: dict[str, Any]) -> None:
    """Append one ``audit_logs`` row (table is append-only)."""
    cur.execute(
        """INSERT INTO audit_logs
               (id, actor_user_id, actor_type, action,
                entity_type, entity_id, metadata_json, created_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, NOW())""",
        (
            str(uuid.uuid4()),
            None,
            "system",
            AUDIT_ACTION,
            "legal_document",
            document_id,
            json.dumps(metadata),
        ),
    )


def _commit_document(document_id: str) -> AlignmentResult:
    """Re-read under row locks, re-align, apply and audit in ONE
    transaction. Anything unexpected rolls the whole document back."""
    with get_connection() as conn:
        doc_type = _document_type_of(conn, document_id)
        if doc_type is None or doc_type == "decision":
            return AlignmentResult(status="skipped", reason="not_statutory")
        rows = _fetch_section_rows(conn, document_id, for_update=True)
        result = align_sections(rows)
        if result.status != "aligned":
            return result
        with conn.cursor() as cur:
            _apply_changes(cur, document_id, result.changes)
            _insert_audit_log(
                cur,
                document_id=document_id,
                metadata=build_audit_metadata(result),
            )
        return result


def _chunks(items: list[str], size: int) -> Iterable[list[str]]:
    for i in range(0, len(items), size):
        yield items[i : i + size]


AUDIO_COLUMNS = (
    "audio_rendition_id",
    "section_id",
    "language",
    "voice_id",
    "engine",
    "status",
    "content_hash",
    "audio_object_key",
    "readalong_object_key",
    "created_at",
)


def _fetch_audio_renditions(conn: Any, section_ids: list[str]) -> list[dict[str, Any]]:
    """Renditions voicing a changed section. Read-only: listed, never
    modified — their audio and read-along no longer match the text."""
    out: list[dict[str, Any]] = []
    for chunk in _chunks(section_ids, _ID_CHUNK):
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """SELECT id::text AS audio_rendition_id,
                          content_id AS section_id,
                          language, voice_id, engine, status, content_hash,
                          audio_object_key, readalong_object_key, created_at
                     FROM audio_renditions
                    WHERE content_type = 'legal_document_section'
                      AND content_id = ANY(%s)
                    ORDER BY content_id, language, voice_id""",
                (chunk,),
            )
            out.extend(dict(r) for r in cur.fetchall())
    return out


def _count_section_embeddings(conn: Any, section_ids: list[str]) -> int:
    """Embeddings computed from the old text (entity_type='section')."""
    total = 0
    for chunk in _chunks(section_ids, _ID_CHUNK):
        with conn.cursor() as cur:
            cur.execute(
                """SELECT COUNT(*) FROM embeddings
                    WHERE entity_type = 'section'
                      AND entity_id::text = ANY(%s)""",
                (chunk,),
            )
            row = cur.fetchone()
            total += int(row[0]) if row else 0
    return total


# ---------------------------------------------------------------------------
# Reports
# ---------------------------------------------------------------------------


@dataclass
class DocumentReport:
    document: StatutoryDocument
    result: AlignmentResult
    committed: bool = False


def _truncate(text: str, limit: int = SAMPLE_CHARS) -> str:
    flat = " ".join(text.split())
    return flat if len(flat) <= limit else flat[: limit - 1] + "…"


def build_counters(reports: list[DocumentReport]) -> dict[str, Any]:
    reasons: Counter[str] = Counter()
    for rep in reports:
        if rep.result.status == "skipped":
            reasons[(rep.result.reason or "unknown").split(":", 1)[0]] += 1
    return {
        "docs_scanned": len(reports),
        "docs_aligned": sum(1 for r in reports if r.result.status == "aligned"),
        "docs_unchanged": sum(1 for r in reports if r.result.status == "unchanged"),
        "docs_skipped": sum(1 for r in reports if r.result.status == "skipped"),
        "docs_committed": sum(1 for r in reports if r.committed),
        "docs_first_label_missing": sum(
            1 for r in reports if r.result.first_label_missing
        ),
        "rows_changed": sum(
            len(r.result.changes) for r in reports if r.result.status == "aligned"
        ),
        "skip_reasons": dict(sorted(reasons.items())),
    }


def format_summary(
    reports: list[DocumentReport],
    *,
    dry_run: bool,
    audio_rows: list[dict[str, Any]],
    embedding_rows: int,
) -> str:
    counters = build_counters(reports)
    lines = [
        f"realign_statutory_sections — {'DRY RUN (no DB writes)' if dry_run else 'COMMIT'}",
        f"docs scanned:   {counters['docs_scanned']}",
        f"docs aligned:   {counters['docs_aligned']}"
        + ("" if dry_run else f" (committed {counters['docs_committed']})"),
        f"docs unchanged: {counters['docs_unchanged']}",
        f"docs skipped:   {counters['docs_skipped']}",
    ]
    for reason, n in counters["skip_reasons"].items():
        lines.append(f"  - {reason}: {n}")
    lines += [
        f"rows changed:   {counters['rows_changed']}",
        f"docs whose first row's label was missing (opening paragraph lost at "
        f"seed time; re-seed to recover): {counters['docs_first_label_missing']}",
        f"audio_renditions voicing a changed section (listed, NOT modified): "
        f"{len(audio_rows)}",
        f"section embeddings computed from old text (NOT modified): {embedding_rows}",
        "",
    ]
    skipped = [r for r in reports if r.result.status == "skipped"]
    if skipped:
        lines.append("Skipped documents:")
        for rep in skipped:
            lines.append(
                f"  {rep.document.id} [{rep.document.document_type}] "
                f"{rep.document.title!r}: {rep.result.reason}",
            )
        lines.append("")
    for rep in reports:
        if rep.result.status != "aligned":
            continue
        lines.append(
            f"== {rep.document.id} [{rep.document.document_type}] "
            f"{rep.document.title!r} — {len(rep.result.changes)} of "
            f"{rep.result.section_count} rows change",
        )
        for change in rep.result.changes[:SAMPLES_PER_DOC]:
            lines.append(f"  #{change.ordering} {change.section_label!r}")
            lines.append(f"    before: {_truncate(change.before)}")
            lines.append(f"    after:  {_truncate(change.after)}")
        lines.append("")
    return "\n".join(lines)


def write_reports(
    out_dir: Path,
    reports: list[DocumentReport],
    *,
    dry_run: bool,
    audio_rows: list[dict[str, Any]],
    embedding_rows: int,
) -> str:
    out_dir.mkdir(parents=True, exist_ok=True)
    with (out_dir / "documents.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow([
            "document_id", "document_type", "title", "status", "reason",
            "section_count", "rows_changed", "first_label_missing", "committed",
        ])
        for rep in reports:
            w.writerow([
                rep.document.id, rep.document.document_type, rep.document.title,
                rep.result.status, rep.result.reason or "",
                rep.result.section_count, len(rep.result.changes),
                rep.result.first_label_missing, rep.committed,
            ])
    with (out_dir / "sections.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow([
            "document_id", "section_id", "ordering", "section_label",
            "before_len", "after_len", "before_text", "after_text",
        ])
        for rep in reports:
            if rep.result.status != "aligned":
                continue
            for c in rep.result.changes:
                w.writerow([
                    rep.document.id, c.section_id, c.ordering, c.section_label,
                    len(c.before), len(c.after), c.before, c.after,
                ])
    with (out_dir / "audio_renditions.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(AUDIO_COLUMNS)
        for row in audio_rows:
            w.writerow([row.get(col) for col in AUDIO_COLUMNS])
    summary = format_summary(
        reports, dry_run=dry_run, audio_rows=audio_rows, embedding_rows=embedding_rows,
    )
    (out_dir / "summary.txt").write_text(summary, encoding="utf-8")
    return summary


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------


def _default_out_dir() -> Path:
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    return Path("realign_reports") / stamp


def run_realign(
    *,
    dry_run: bool = True,
    document_ids: list[str] | None = None,
    limit: int | None = None,
    out_dir: Path | None = None,
) -> dict[str, Any]:
    """Scan (read replica), optionally commit per document, write reports."""
    out = out_dir or _default_out_dir()
    reports: list[DocumentReport] = []

    with get_read_connection() as rconn:
        documents = _fetch_statutory_documents(
            rconn, document_ids=document_ids, limit=limit,
        )
        for doc in documents:
            result = align_sections(_fetch_section_rows(rconn, doc.id))
            reports.append(DocumentReport(document=doc, result=result))

    if not dry_run:
        for rep in reports:
            if rep.result.status != "aligned":
                continue
            try:
                committed = _commit_document(rep.document.id)
            except ConcurrentChangeError as exc:
                logger.warning("%s: rolled back — %s", rep.document.id, exc)
                rep.result = AlignmentResult(
                    status="skipped",
                    reason=f"{SKIP_CHANGED_DURING_COMMIT}: {exc}",
                    section_count=rep.result.section_count,
                )
                continue
            rep.result = committed
            rep.committed = committed.status == "aligned"

    changed_ids = [
        c.section_id
        for rep in reports
        if rep.result.status == "aligned"
        for c in rep.result.changes
    ]
    audio_rows: list[dict[str, Any]] = []
    embedding_rows = 0
    if changed_ids:
        with get_read_connection() as rconn:
            audio_rows = _fetch_audio_renditions(rconn, changed_ids)
            embedding_rows = _count_section_embeddings(rconn, changed_ids)

    summary = write_reports(
        out, reports, dry_run=dry_run, audio_rows=audio_rows,
        embedding_rows=embedding_rows,
    )
    logger.info("realign_statutory_sections report written to %s", out)
    counters = build_counters(reports)
    counters.update(
        {
            "dry_run": dry_run,
            "audio_renditions_affected": len(audio_rows),
            "section_embeddings_stale": embedding_rows,
            "report_dir": str(out),
            "summary": summary,
        },
    )
    return counters


@shared_task(name="maintenance.realign_statutory_sections")
def realign_statutory_sections_task(
    dry_run: bool = True,
    document_ids: list[str] | None = None,
    limit: int | None = None,
    out_dir: str | None = None,
) -> dict[str, Any]:
    """Celery wrapper. Manual dispatch only — dry-run unless told otherwise."""
    result = run_realign(
        dry_run=dry_run,
        document_ids=document_ids,
        limit=limit,
        out_dir=Path(out_dir) if out_dir else None,
    )
    result.pop("summary", None)
    return result


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--dry-run", action="store_true", default=True)
    parser.add_argument("--commit", action="store_true", default=False)
    parser.add_argument(
        "--document-id",
        action="append",
        dest="document_ids",
        default=None,
        help="Restrict to this legal_documents.id (repeatable).",
    )
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=None,
        help="Report directory (default: realign_reports/<UTC timestamp>).",
    )
    return parser


def _cli(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    dry_run = not args.commit
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    result = run_realign(
        dry_run=dry_run,
        document_ids=args.document_ids,
        limit=args.limit,
        out_dir=args.out_dir,
    )
    print(result["summary"])
    print(f"Reports: {result['report_dir']}")
    if dry_run:
        print("Dry run only — re-run with --commit to apply.")
    return 0


if __name__ == "__main__":
    sys.exit(_cli())
