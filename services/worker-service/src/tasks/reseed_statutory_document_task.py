"""LIBERTASIAN Worker Service — Re-seed a statutory document in place.

``seed_codals_task`` skips any codal that already exists, so a document
imported by the pre-#512 parser (off-by-one sections) or one whose LawPhil
markup doubled paragraphs (the 1987 Constitution's ``<li><p>…</p></li>``
clauses and its Art. III §§3–12 block repeated inside §2) had no way back
to the fixed parser. ``realign_statutory_sections_task`` can only re-cut
text that is already stored; it cannot remove a duplicate or recover a
paragraph the old seed dropped.

This task re-fetches the document's LawPhil page, re-parses it with the
current ``seed_codals_task._parse_sections`` and writes the result onto the
EXISTING rows:

1. New sections are matched to existing rows by ``(section_label, order)``
   — a longest-common-subsequence alignment of the two label sequences
   (``difflib.SequenceMatcher``), so a label that repeats per article
   (``Section 1.``) matches its own occurrence, not the first one.
2. A matched row is UPDATEd in place: ``plain_text``, ``token_count``
   (only when it was already populated) and ``ordering`` (only when an
   inserted row shifts it). Its ``id`` survives — bookmarks, annotations,
   provenance_records and audio_renditions reference it.
3. A new section with no matching row is INSERTed.
4. An existing row with no matching section is NEVER deleted. It is kept,
   listed in the report as ``unmatched_kept`` with its reference counts,
   and left for an editor to resolve.

Each changed document gets one new ``legal_document_versions`` row (an
existing version row is never overwritten; the raw HTML goes to a new,
version-scoped object key), a bumped ``legal_documents.version_no`` /
``checksum``, and one append-only ``audit_logs`` row — all in ONE
transaction per document, with rows re-read ``FOR UPDATE`` and every
UPDATE guarded on the text it replaces.

Out of scope, reported only: OpenSearch documents, section embeddings and
audio renditions computed from the old text are NOT refreshed here.

**Manual trigger only** — NOT on the Celery beat. ``--document-id`` is
required (repeatable). Dry-run is the default: it fetches and parses but
writes nothing to the database, only report files. LawPhil only answers
between 1 PM and 6 PM US Eastern, so both modes must run in that window.

    docker compose -f docker-compose.prod.yml exec worker-service \\
        uv run python -m src.tasks.reseed_statutory_document_task \\
        --document-id <uuid> [--document-id <uuid> ...]

    ... --commit

Reports land in ``--out-dir``: ``documents.csv``, ``sections.csv`` (full
before/after text of every updated, inserted and unmatched row — keep it,
it is the rollback record), ``audio_renditions.csv`` (renditions voicing
an updated section — listed, never modified) and ``summary.txt``.
"""

from __future__ import annotations

import argparse
import csv
import difflib
import hashlib
import json
import logging
import sys
import uuid
from collections import Counter
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import psycopg2.extras
from celery import shared_task

from ..clients.db_client import get_connection, get_read_connection
from ..clients.s3_client import upload_file
from ..config import settings
from ..fetchers.lawphil import LawphilFetcher
from .realign_statutory_sections_task import (
    AUDIO_COLUMNS,
    ConcurrentChangeError,
    SectionRow,
    _chunks,
    _estimate_tokens,
    _fetch_audio_renditions,
    _fetch_section_rows,
    _sha256,
)
from .seed_codals_task import ParsedSection, _parse_sections

logger = logging.getLogger(__name__)

TASK_NAME = "reseed_statutory_document"
AUDIT_ACTION = "document.statutory_reseeded"
PARSER_VERSION = "codal_seed_v2"
LAWPHIL_HOST = "lawphil.net"
SAMPLES_PER_DOC = 3
# Structural churn above this share of the existing rows means the new
# parse disagrees with the stored segmentation, not just with its text:
# flagged needs_decision so a human reads the report before --commit.
NEEDS_DECISION_RATIO = 0.05
SAMPLE_CHARS = 160

# Row actions — stable strings, they appear in sections.csv.
ACTION_UPDATE = "update"
ACTION_INSERT = "insert"
ACTION_UNMATCHED = "unmatched_kept"

# Skip reasons — stable strings, they appear in documents.csv and summary.
SKIP_NOT_FOUND = "document_not_found"
SKIP_DECISION = "decision_not_statutory"
SKIP_NOT_LAWPHIL = "canonical_url_not_lawphil"
SKIP_FETCH_FAILED = "fetch_failed"
SKIP_EMPTY_HTML = "empty_html"
SKIP_NO_STRUCTURE = "no_structural_markers"
SKIP_DUPLICATE_ORDERING = "duplicate_ordering"
SKIP_HTML_TEXT = "html_text_present"
SKIP_CHANGED_DURING_COMMIT = "changed_during_commit"

# Tables whose rows point at a section id. A kept-but-unmatched row is
# reported with these counts so an editor can see what depends on it.
_SECTION_REFERENCES: tuple[tuple[str, str, str], ...] = (
    ("bookmarks", "bookmarks", "legal_document_section_id::text"),
    ("annotations", "annotations", "section_id::text"),
    ("provenance_records", "provenance_records", "source_section_id::text"),
    ("audio_renditions", "audio_renditions", "content_id"),
)


# ---------------------------------------------------------------------------
# Pure matching
# ---------------------------------------------------------------------------


def normalize_label(label: str | None) -> str:
    """Whitespace-collapsed label: the match key's label half."""
    return " ".join((label or "").split())


@dataclass(frozen=True)
class RowChange:
    action: str  # ACTION_UPDATE | ACTION_INSERT | ACTION_UNMATCHED
    section_id: str
    section_label: str | None
    section_type: str | None
    old_ordering: int | None
    new_ordering: int
    before: str
    after: str
    token_count: int | None  # new value for update/insert


@dataclass
class ReseedPlan:
    status: str  # "reseeded" | "unchanged" | "skipped"
    reason: str | None = None
    old_count: int = 0
    new_count: int = 0
    matched: int = 0
    changes: list[RowChange] = field(default_factory=list)

    def of(self, action: str) -> list[RowChange]:
        return [c for c in self.changes if c.action == action]

    @property
    def text_updates(self) -> list[RowChange]:
        return [c for c in self.of(ACTION_UPDATE) if c.before != c.after]

    @property
    def needs_decision(self) -> bool:
        """Inserts + unmatched rows exceed ``NEEDS_DECISION_RATIO`` of the
        existing rows (any structural change at all on an empty document)."""
        if self.status == "skipped":
            return False
        churn = len(self.of(ACTION_INSERT)) + len(self.of(ACTION_UNMATCHED))
        if self.old_count == 0:
            return churn > 0
        return churn / self.old_count > NEEDS_DECISION_RATIO


def plan_reseed(
    rows: Sequence[SectionRow],
    parsed: Sequence[ParsedSection],
    *,
    new_id: Callable[[], str] = lambda: str(uuid.uuid4()),
) -> ReseedPlan:
    """Map freshly parsed sections onto a document's existing rows.

    Labels are aligned as sequences so each row keeps its identity: equal
    runs pair row ↔ section in order; a section with no partner is an
    insert; a row with no partner is kept untouched (never deleted) at its
    place in the merged order and reported as unmatched. ``ordering`` is
    the 1-based position in that merged sequence.
    """
    ordered = sorted(rows, key=lambda r: r.ordering)
    plan = ReseedPlan(status="skipped", old_count=len(ordered), new_count=len(parsed))
    if len({r.ordering for r in ordered}) != len(ordered):
        plan.reason = SKIP_DUPLICATE_ORDERING
        return plan
    if any(r.html_text for r in ordered):
        # html_text would keep describing the old segmentation.
        plan.reason = SKIP_HTML_TEXT
        return plan
    if not parsed or (len(parsed) == 1 and parsed[0].section_label == "Full Text"):
        # A parse that found no structure would collapse the document onto
        # one row and orphan every existing one.
        plan.reason = SKIP_NO_STRUCTURE
        return plan

    matcher = difflib.SequenceMatcher(
        None,
        [normalize_label(r.section_label) for r in ordered],
        [normalize_label(s.section_label) for s in parsed],
        autojunk=False,
    )

    merged: list[tuple[str, SectionRow | None, ParsedSection | None]] = []
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            merged.extend(
                (ACTION_UPDATE, row, sec)
                for row, sec in zip(ordered[i1:i2], parsed[j1:j2], strict=True)
            )
            continue
        merged.extend((ACTION_UNMATCHED, row, None) for row in ordered[i1:i2])
        merged.extend((ACTION_INSERT, None, sec) for sec in parsed[j1:j2])

    for position, (action, row, sec) in enumerate(merged, start=1):
        if action == ACTION_UPDATE:
            assert row is not None and sec is not None
            plan.matched += 1
            before = row.plain_text or ""
            if before == sec.plain_text and row.ordering == position:
                continue
            plan.changes.append(
                RowChange(
                    action=ACTION_UPDATE,
                    section_id=row.id,
                    section_label=row.section_label,
                    section_type=None,
                    old_ordering=row.ordering,
                    new_ordering=position,
                    before=before,
                    after=sec.plain_text,
                    token_count=(
                        _estimate_tokens(sec.plain_text)
                        if row.token_count is not None
                        else None
                    ),
                ),
            )
        elif action == ACTION_INSERT:
            assert sec is not None
            plan.changes.append(
                RowChange(
                    action=ACTION_INSERT,
                    section_id=new_id(),
                    section_label=sec.section_label,
                    section_type=sec.section_type,
                    old_ordering=None,
                    new_ordering=position,
                    before="",
                    after=sec.plain_text,
                    token_count=None,  # seed_codals_task leaves it NULL too
                ),
            )
        else:
            assert row is not None
            plan.changes.append(
                RowChange(
                    action=ACTION_UNMATCHED,
                    section_id=row.id,
                    section_label=row.section_label,
                    section_type=None,
                    old_ordering=row.ordering,
                    new_ordering=position,
                    before=row.plain_text or "",
                    after=row.plain_text or "",
                    token_count=row.token_count,
                ),
            )

    # Update and insert entries are writes by construction; an unmatched
    # row is a write only when an insert moved its ordering.
    writes = any(
        c.action != ACTION_UNMATCHED or c.old_ordering != c.new_ordering
        for c in plan.changes
    )
    plan.status = "reseeded" if writes else "unchanged"
    return plan


# ---------------------------------------------------------------------------
# Database access
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class TargetDocument:
    id: str
    title: str | None
    document_type: str
    canonical_url: str | None
    version_no: int
    checksum: str | None


_DOC_COLUMNS = (
    "SELECT id::text, title, document_type, canonical_url, version_no, checksum "
    "FROM legal_documents WHERE id::text = %s"
)


def _row_to_document(r: dict[str, Any]) -> TargetDocument:
    return TargetDocument(
        id=str(r["id"]),
        title=r["title"],
        document_type=str(r["document_type"]),
        canonical_url=r["canonical_url"],
        version_no=int(r["version_no"] or 1),
        checksum=r["checksum"],
    )


def _fetch_document(
    conn: Any, document_id: str, *, for_update: bool = False,
) -> TargetDocument | None:
    sql = _DOC_COLUMNS + (" FOR UPDATE" if for_update else "")
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(sql, (document_id,))
        row = cur.fetchone()
        return _row_to_document(row) if row else None


def _apply_plan(cur: Any, document_id: str, plan: ReseedPlan) -> None:
    for change in plan.changes:
        if change.action == ACTION_UPDATE:
            cur.execute(
                """UPDATE legal_document_sections
                      SET plain_text = %s,
                          token_count = %s,
                          ordering = %s
                    WHERE id = %s
                      AND legal_document_id = %s
                      AND COALESCE(plain_text, '') = %s""",
                (
                    change.after,
                    change.token_count,
                    change.new_ordering,
                    change.section_id,
                    document_id,
                    change.before,
                ),
            )
            if cur.rowcount != 1:
                raise ConcurrentChangeError(
                    f"section {change.section_id} changed during re-seed",
                )
        elif change.action == ACTION_UNMATCHED:
            if change.old_ordering == change.new_ordering:
                continue
            cur.execute(
                """UPDATE legal_document_sections
                      SET ordering = %s
                    WHERE id = %s
                      AND legal_document_id = %s
                      AND COALESCE(plain_text, '') = %s""",
                (change.new_ordering, change.section_id, document_id, change.before),
            )
            if cur.rowcount != 1:
                raise ConcurrentChangeError(
                    f"section {change.section_id} changed during re-seed",
                )
        else:
            cur.execute(
                """INSERT INTO legal_document_sections
                       (id, legal_document_id, section_type, section_label,
                        ordering, plain_text, created_at)
                       VALUES (%s, %s, %s, %s, %s, %s, NOW())""",
                (
                    change.section_id,
                    document_id,
                    change.section_type,
                    change.section_label,
                    change.new_ordering,
                    change.after,
                ),
            )


def _insert_version(
    cur: Any,
    *,
    version_id: str,
    document_id: str,
    raw_object_key: str | None,
    normalized_object_key: str | None,
    snapshot_hash: str,
    extracted: dict[str, Any],
) -> None:
    """Append a version row. Existing version rows are never modified."""
    cur.execute(
        """INSERT INTO legal_document_versions
               (id, legal_document_id, raw_file_object_key,
                normalized_text_object_key, html_object_key, extracted_json,
                snapshot_hash, parser_version, created_at)
               VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s, %s, NOW())""",
        (
            version_id,
            document_id,
            raw_object_key,
            normalized_object_key,
            raw_object_key,
            json.dumps(extracted),
            snapshot_hash,
            PARSER_VERSION,
        ),
    )


def _bump_document(cur: Any, *, document_id: str, checksum: str) -> None:
    cur.execute(
        """UPDATE legal_documents
              SET version_no = version_no + 1,
                  checksum = %s,
                  updated_at = NOW()
            WHERE id = %s""",
        (checksum, document_id),
    )


def build_audit_metadata(
    doc: TargetDocument,
    plan: ReseedPlan,
    *,
    version_id: str,
    snapshot_hash: str,
) -> dict[str, Any]:
    """Hashes and lengths, not full text; the text is in sections.csv."""
    return {
        "task": TASK_NAME,
        "source_url": doc.canonical_url,
        "parser_version": PARSER_VERSION,
        "version_id": version_id,
        "version_no_before": doc.version_no,
        "snapshot_hash": snapshot_hash,
        "old_section_count": plan.old_count,
        "new_section_count": plan.new_count,
        "matched": plan.matched,
        "rows_updated": len(plan.text_updates),
        "rows_inserted": len(plan.of(ACTION_INSERT)),
        "rows_unmatched_kept": len(plan.of(ACTION_UNMATCHED)),
        "changed_fields": ["plain_text", "token_count", "ordering"],
        "changes": [
            {
                "action": c.action,
                "section_id": c.section_id,
                "section_label": c.section_label,
                "ordering_before": c.old_ordering,
                "ordering_after": c.new_ordering,
                "before_sha256": _sha256(c.before),
                "after_sha256": _sha256(c.after),
                "before_len": len(c.before),
                "after_len": len(c.after),
            }
            for c in plan.changes
            if c.action != ACTION_UNMATCHED or c.old_ordering != c.new_ordering
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


def _count_references(conn: Any, section_ids: list[str]) -> dict[str, dict[str, int]]:
    """Per-section reference counts for the unmatched rows' report."""
    counts: dict[str, dict[str, int]] = {sid: {} for sid in section_ids}
    for name, table, column in _SECTION_REFERENCES:
        for chunk in _chunks(section_ids, 1000):
            with conn.cursor() as cur:
                # Identifiers come from the constant above, never input.
                cur.execute(
                    f"SELECT {column}, COUNT(*) FROM {table} "  # noqa: S608
                    f"WHERE {column} = ANY(%s) GROUP BY 1",
                    (chunk,),
                )
                for sid, n in cur.fetchall():
                    counts[str(sid)][name] = int(n)
    return counts


# ---------------------------------------------------------------------------
# Fetch + S3
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class FetchedSource:
    html: str
    parsed: list[ParsedSection]
    snapshot_hash: str
    normalized_text: str


def _fetch_and_parse(fetcher: LawphilFetcher, url: str) -> FetchedSource:
    fetched = fetcher.fetch_content(url)
    html = fetched.html
    parsed = _parse_sections(html) if html.strip() else []
    return FetchedSource(
        html=html,
        parsed=parsed,
        # Same bytes and hash as seed_codals_task's checksum.
        snapshot_hash=hashlib.sha256(
            html.encode("windows-1252", errors="replace"),
        ).hexdigest(),
        normalized_text="\n\n".join(
            f"{s.section_label}\n{s.plain_text}" for s in parsed if s.plain_text
        ),
    )


def _upload_version_objects(
    document_id: str, version_id: str, source: FetchedSource,
) -> tuple[str | None, str | None]:
    """Version-scoped keys: the seed's ``codals/{id}/raw.html`` belongs to
    the first version row and must not be overwritten."""
    if not settings.s3_access_key:
        logger.info("S3 not configured (no access key) — skipping object upload")
        return None, None
    prefix = f"codals/{document_id}/versions/{version_id}"
    upload_file(
        f"{prefix}/raw.html",
        source.html.encode("windows-1252", errors="replace"),
        content_type="text/html; charset=windows-1252",
        bucket=settings.s3_bucket_corpus,
    )
    upload_file(
        f"{prefix}/normalized.txt",
        source.normalized_text.encode("utf-8"),
        content_type="text/plain; charset=utf-8",
        bucket=settings.s3_bucket_corpus,
    )
    return f"{prefix}/raw.html", f"{prefix}/normalized.txt"


def _commit_document(
    doc: TargetDocument, source: FetchedSource, *, dry_plan: ReseedPlan,
) -> ReseedPlan:
    """Re-read under row locks, re-plan, apply, version and audit in ONE
    transaction. Anything unexpected rolls the whole document back."""
    version_id = str(uuid.uuid4())
    raw_key, normalized_key = _upload_version_objects(doc.id, version_id, source)
    with get_connection() as conn:
        locked = _fetch_document(conn, doc.id, for_update=True)
        if locked is None:
            return ReseedPlan(status="skipped", reason=SKIP_NOT_FOUND)
        if locked.document_type == "decision":
            return ReseedPlan(status="skipped", reason=SKIP_DECISION)
        rows = _fetch_section_rows(conn, doc.id, for_update=True)
        # Reuse the dry-run's insert ids so the report and the rows agree.
        insert_ids = iter(c.section_id for c in dry_plan.of(ACTION_INSERT))
        plan = plan_reseed(
            rows, source.parsed,
            new_id=lambda: next(insert_ids, None) or str(uuid.uuid4()),
        )
        if plan.status != "reseeded":
            return plan
        with conn.cursor() as cur:
            _apply_plan(cur, doc.id, plan)
            _insert_version(
                cur,
                version_id=version_id,
                document_id=doc.id,
                raw_object_key=raw_key,
                normalized_object_key=normalized_key,
                snapshot_hash=source.snapshot_hash,
                extracted={
                    "task": TASK_NAME,
                    "section_count": plan.new_count,
                    "previous_checksum": locked.checksum,
                },
            )
            _bump_document(cur, document_id=doc.id, checksum=source.snapshot_hash)
            _insert_audit_log(
                cur,
                document_id=doc.id,
                metadata=build_audit_metadata(
                    locked, plan, version_id=version_id,
                    snapshot_hash=source.snapshot_hash,
                ),
            )
        return plan


# ---------------------------------------------------------------------------
# Reports
# ---------------------------------------------------------------------------


@dataclass
class DocumentReport:
    document_id: str
    document: TargetDocument | None
    plan: ReseedPlan
    committed: bool = False
    references: dict[str, dict[str, int]] = field(default_factory=dict)


def _truncate(text: str, limit: int = SAMPLE_CHARS) -> str:
    flat = " ".join(text.split())
    return flat if len(flat) <= limit else flat[: limit - 1] + "…"


def build_counters(reports: list[DocumentReport]) -> dict[str, Any]:
    reasons: Counter[str] = Counter()
    for rep in reports:
        if rep.plan.status == "skipped":
            reasons[(rep.plan.reason or "unknown").split(":", 1)[0]] += 1
    live = [r for r in reports if r.plan.status == "reseeded"]
    return {
        "docs_requested": len(reports),
        "docs_reseeded": len(live),
        "docs_unchanged": sum(1 for r in reports if r.plan.status == "unchanged"),
        "docs_skipped": sum(1 for r in reports if r.plan.status == "skipped"),
        "docs_committed": sum(1 for r in reports if r.committed),
        "docs_needs_decision": sum(1 for r in reports if r.plan.needs_decision),
        "rows_updated": sum(len(r.plan.text_updates) for r in live),
        "rows_inserted": sum(len(r.plan.of(ACTION_INSERT)) for r in live),
        "rows_unmatched_kept": sum(len(r.plan.of(ACTION_UNMATCHED)) for r in live),
        "skip_reasons": dict(sorted(reasons.items())),
    }


def format_summary(
    reports: list[DocumentReport], *, dry_run: bool, audio_rows: list[dict[str, Any]],
) -> str:
    c = build_counters(reports)
    lines = [
        f"reseed_statutory_document — {'DRY RUN (no DB writes)' if dry_run else 'COMMIT'}",
        f"docs requested: {c['docs_requested']}",
        f"docs reseeded:  {c['docs_reseeded']}"
        + ("" if dry_run else f" (committed {c['docs_committed']})"),
        f"docs unchanged: {c['docs_unchanged']}",
        f"docs skipped:   {c['docs_skipped']}",
        f"docs needs_decision (inserts + unmatched > "
        f"{NEEDS_DECISION_RATIO:.0%} of existing rows — review before --commit): "
        f"{c['docs_needs_decision']}",
    ]
    for reason, n in c["skip_reasons"].items():
        lines.append(f"  - {reason}: {n}")
    lines += [
        f"rows updated (text changed): {c['rows_updated']}",
        f"rows inserted (new labels):  {c['rows_inserted']}",
        f"rows unmatched, kept (NOT deleted): {c['rows_unmatched_kept']}",
        f"audio_renditions voicing an updated section (listed, NOT modified): "
        f"{len(audio_rows)}",
        "OpenSearch and section embeddings are NOT refreshed by this task.",
        "",
    ]
    for rep in reports:
        title = rep.document.title if rep.document else None
        head = f"== {rep.document_id} {title!r}"
        if rep.plan.status == "skipped":
            lines.append(f"{head} — skipped: {rep.plan.reason}")
            lines.append("")
            continue
        if rep.plan.needs_decision:
            lines.append(f"{head} — NEEDS_DECISION")
        lines.append(
            f"{head} — {rep.plan.status}: {rep.plan.old_count} rows → "
            f"{rep.plan.new_count} parsed; matched {rep.plan.matched}, "
            f"updated {len(rep.plan.text_updates)}, inserted "
            f"{len(rep.plan.of(ACTION_INSERT))}, unmatched kept "
            f"{len(rep.plan.of(ACTION_UNMATCHED))}",
        )
        for change in rep.plan.text_updates[:SAMPLES_PER_DOC]:
            lines.append(f"  #{change.new_ordering} {change.section_label!r}")
            lines.append(f"    before: {_truncate(change.before)}")
            lines.append(f"    after:  {_truncate(change.after)}")
        for change in rep.plan.of(ACTION_UNMATCHED):
            refs = rep.references.get(change.section_id, {})
            lines.append(
                f"  UNMATCHED kept #{change.old_ordering} {change.section_label!r} "
                f"{change.section_id} refs={json.dumps(refs, sort_keys=True)}",
            )
        lines.append("")
    return "\n".join(lines)


def write_reports(
    out_dir: Path,
    reports: list[DocumentReport],
    *,
    dry_run: bool,
    audio_rows: list[dict[str, Any]],
) -> str:
    out_dir.mkdir(parents=True, exist_ok=True)
    with (out_dir / "documents.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow([
            "document_id", "document_type", "title", "canonical_url", "status",
            "reason", "old_section_count", "new_section_count", "matched",
            "rows_updated", "rows_inserted", "rows_unmatched_kept",
            "needs_decision", "committed",
        ])
        for rep in reports:
            doc = rep.document
            w.writerow([
                rep.document_id,
                doc.document_type if doc else "",
                doc.title if doc else "",
                doc.canonical_url if doc else "",
                rep.plan.status, rep.plan.reason or "",
                rep.plan.old_count, rep.plan.new_count, rep.plan.matched,
                len(rep.plan.text_updates), len(rep.plan.of(ACTION_INSERT)),
                len(rep.plan.of(ACTION_UNMATCHED)), rep.plan.needs_decision,
                rep.committed,
            ])
    with (out_dir / "sections.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow([
            "document_id", "action", "section_id", "section_label",
            "ordering_before", "ordering_after", "before_len", "after_len",
            "references", "before_text", "after_text",
        ])
        for rep in reports:
            if rep.plan.status != "reseeded":
                continue
            for c in rep.plan.changes:
                refs = rep.references.get(c.section_id)
                w.writerow([
                    rep.document_id, c.action, c.section_id, c.section_label,
                    "" if c.old_ordering is None else c.old_ordering,
                    c.new_ordering, len(c.before), len(c.after),
                    json.dumps(refs, sort_keys=True) if refs is not None else "",
                    c.before, c.after,
                ])
    with (out_dir / "audio_renditions.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(AUDIO_COLUMNS)
        for row in audio_rows:
            w.writerow([row.get(col) for col in AUDIO_COLUMNS])
    summary = format_summary(reports, dry_run=dry_run, audio_rows=audio_rows)
    (out_dir / "summary.txt").write_text(summary, encoding="utf-8")
    return summary


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------


def _default_out_dir() -> Path:
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    return Path("reseed_reports") / stamp


def _is_lawphil(url: str | None) -> bool:
    if not url:
        return False
    host = (urlparse(url).hostname or "").lower()
    return host == LAWPHIL_HOST or host.endswith("." + LAWPHIL_HOST)


def _plan_document(
    rconn: Any, fetcher: LawphilFetcher, document_id: str,
) -> tuple[DocumentReport, FetchedSource | None]:
    doc = _fetch_document(rconn, document_id)
    if doc is None:
        return DocumentReport(document_id, None, ReseedPlan("skipped", SKIP_NOT_FOUND)), None
    if doc.document_type == "decision":
        return DocumentReport(document_id, doc, ReseedPlan("skipped", SKIP_DECISION)), None
    if not _is_lawphil(doc.canonical_url):
        return (
            DocumentReport(
                document_id, doc,
                ReseedPlan("skipped", f"{SKIP_NOT_LAWPHIL}: {doc.canonical_url!r}"),
            ),
            None,
        )
    assert doc.canonical_url is not None
    try:
        source = _fetch_and_parse(fetcher, doc.canonical_url)
    except Exception as exc:  # noqa: BLE001 — reported per document
        logger.warning("%s: fetch failed — %s", document_id, exc)
        return (
            DocumentReport(document_id, doc, ReseedPlan("skipped", f"{SKIP_FETCH_FAILED}: {exc}")),
            None,
        )
    if not source.html.strip():
        return DocumentReport(document_id, doc, ReseedPlan("skipped", SKIP_EMPTY_HTML)), None
    rows = _fetch_section_rows(rconn, document_id)
    plan = plan_reseed(rows, source.parsed)
    return DocumentReport(document_id, doc, plan), source


def run_reseed(
    *,
    document_ids: list[str],
    dry_run: bool = True,
    out_dir: Path | None = None,
    fetcher: LawphilFetcher | None = None,
) -> dict[str, Any]:
    """Fetch + plan (read replica), optionally commit per document, report."""
    if not document_ids:
        raise ValueError("at least one document id is required")
    out = out_dir or _default_out_dir()
    fetcher = fetcher or LawphilFetcher()
    reports: list[DocumentReport] = []
    sources: dict[str, FetchedSource] = {}

    # Deduplicate, keep the caller's order.
    wanted = list(dict.fromkeys(document_ids))
    with get_read_connection() as rconn:
        for document_id in wanted:
            report, source = _plan_document(rconn, fetcher, document_id)
            reports.append(report)
            if source is not None:
                sources[document_id] = source

    if not dry_run:
        for rep in reports:
            if rep.plan.status != "reseeded" or rep.document is None:
                continue
            try:
                committed = _commit_document(
                    rep.document, sources[rep.document_id], dry_plan=rep.plan,
                )
            except ConcurrentChangeError as exc:
                logger.warning("%s: rolled back — %s", rep.document_id, exc)
                rep.plan = ReseedPlan(
                    status="skipped",
                    reason=f"{SKIP_CHANGED_DURING_COMMIT}: {exc}",
                    old_count=rep.plan.old_count,
                    new_count=rep.plan.new_count,
                )
                continue
            rep.plan = committed
            rep.committed = committed.status == "reseeded"

    updated_ids = [
        c.section_id
        for rep in reports
        if rep.plan.status == "reseeded"
        for c in rep.plan.text_updates
    ]
    audio_rows: list[dict[str, Any]] = []
    with get_read_connection() as rconn:
        for rep in reports:
            unmatched = [c.section_id for c in rep.plan.of(ACTION_UNMATCHED)]
            if unmatched:
                rep.references = _count_references(rconn, unmatched)
        if updated_ids:
            audio_rows = _fetch_audio_renditions(rconn, updated_ids)

    summary = write_reports(out, reports, dry_run=dry_run, audio_rows=audio_rows)
    logger.info("reseed_statutory_document report written to %s", out)
    counters = build_counters(reports)
    counters.update(
        {
            "dry_run": dry_run,
            "audio_renditions_affected": len(audio_rows),
            "report_dir": str(out),
            "summary": summary,
        },
    )
    return counters


@shared_task(name="maintenance.reseed_statutory_document")
def reseed_statutory_document_task(
    document_ids: list[str],
    dry_run: bool = True,
    out_dir: str | None = None,
) -> dict[str, Any]:
    """Celery wrapper. Manual dispatch only — dry-run unless told otherwise."""
    result = run_reseed(
        document_ids=document_ids,
        dry_run=dry_run,
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
        required=True,
        help="legal_documents.id to re-seed (required, repeatable).",
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=None,
        help="Report directory (default: reseed_reports/<UTC timestamp>).",
    )
    return parser


def _cli(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    dry_run = not args.commit
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    result = run_reseed(
        document_ids=args.document_ids,
        dry_run=dry_run,
        out_dir=args.out_dir,
    )
    print(result["summary"])
    print(f"Reports: {result['report_dir']}")
    if dry_run:
        print("Dry run only — re-run with --commit to apply.")
    return 0


if __name__ == "__main__":
    sys.exit(_cli())
