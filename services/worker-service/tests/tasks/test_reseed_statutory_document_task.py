"""Tests for ``reseed_statutory_document_task`` and the parser fixes it ships.

Parser fixtures reproduce each defect seen on prod (2026-09-27) in LawPhil
markup trimmed from the live pages. Plan tests are pure. DB-layer tests
swap ``get_read_connection`` / ``get_connection`` for an in-memory fake
(the approach of ``test_realign_statutory_sections_task.py``) — no live
database, no network.
"""

from __future__ import annotations

import csv
import json
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest

from src.tasks import reseed_statutory_document_task as reseed
from src.tasks.realign_statutory_sections_task import SectionRow
from src.tasks.reseed_statutory_document_task import (
    ACTION_INSERT,
    ACTION_UNMATCHED,
    ACTION_UPDATE,
    SKIP_DUPLICATE_ORDERING,
    SKIP_HTML_TEXT,
    SKIP_NO_STRUCTURE,
    plan_reseed,
)
from src.tasks.seed_codals_task import ParsedSection, _parse_sections

# ---------------------------------------------------------------------------
# Parser fixtures — one per defect
# ---------------------------------------------------------------------------

# 1987 Constitution, Art. III §3: each clause is <li><p>…</p></li>. The
# descendant walk appended the <li> AND its <p>, so every clause was stored
# twice (35 prod rows).
_CONSTI_LIST_HTML = """
<html><body>
<p align="center"><b>ARTICLE III<br />BILL OF RIGHTS</b></p>
<p><b>Section 3.</b></p>
<ol>
<li><p align="justify">The privacy of communication and correspondence shall be inviolable.</p></li>
<li><p align="justify">Any evidence obtained in violation of this shall be inadmissible.</p></li>
</ol>
<p align="justify"><b>Section 4.</b> No law shall be passed abridging the freedom of speech.</p>
</body></html>
"""

# 1987 Constitution, Art. III §2: LawPhil's page carries a malformed
# ``<nd private sectors, …>`` tag. lxml opens an <nd> element inside §2's <p>
# that swallows the following sections, so §2's text repeated §§3–12.
_CONSTI_SWALLOW_HTML = """
<html><body>
<p align="justify"><b>Section 1.</b> No person shall be deprived of life.</p>
<p align="justify"><b>Section 2.</b> The right of the people to be secure shall be inviolable.
<br /><nd private sectors, to form unions shall not be abridged. </p>
<p><b>Section 3.</b></p>
<ol>
<li><p align="justify">The privacy of communication shall be inviolable.</p></li>
</ol>
<p align="justify"><b>Section 4.</b> No law shall be passed abridging speech.</p>
<p align="justify"><b>Section 5.</b> No law respecting an establishment of religion.</p>
</body></html>
"""

# Rules of Court, Special Proceedings: the same "Section N." label recurs
# in every Rule, so matching must follow order, not the first occurrence.
_RULES_HTML = """
<html><body>
<p align="center"><b>RULE 73</b></p>
<p align="justify"><b>Section 1.</b> Where estate of deceased persons settled.</p>
<p align="justify"><b>Section 2.</b> Where estate settled upon dissolution of marriage.</p>
<p align="center"><b>RULE 74</b></p>
<p align="justify"><b>Section 1.</b> Extrajudicial settlement by agreement between heirs.</p>
<p align="justify">The fact of the extrajudicial settlement shall be published.</p>
<p align="justify"><b>Section 2.</b> Summary settlement of estates of small value.</p>
</body></html>
"""


def _labels(sections: list[ParsedSection]) -> list[str]:
    return [s.section_label for s in sections]


def test_parser_list_item_paragraphs_are_not_doubled() -> None:
    sections = _parse_sections(_CONSTI_LIST_HTML)
    s3 = next(s for s in sections if s.section_label == "Section 3.")
    assert s3.plain_text == (
        "The privacy of communication and correspondence shall be inviolable. "
        "Any evidence obtained in violation of this shall be inadmissible."
    )
    assert s3.plain_text.count("The privacy of communication") == 1


def test_parser_malformed_tag_does_not_swallow_following_sections() -> None:
    sections = _parse_sections(_CONSTI_SWALLOW_HTML)
    assert _labels(sections) == [
        "Section 1.", "Section 2.", "Section 3.", "Section 4.", "Section 5.",
    ]
    by_label = {s.section_label: s.plain_text for s in sections}
    assert by_label["Section 2."] == "The right of the people to be secure shall be inviolable."
    assert by_label["Section 3."] == "The privacy of communication shall be inviolable."
    assert by_label["Section 4."] == "No law shall be passed abridging speech."
    everything = " ".join(by_label.values())
    assert everything.count("No law respecting an establishment") == 1


def test_parser_collapses_consecutive_duplicate_paragraphs() -> None:
    html = """<html><body>
      <p><b>Section 9.</b> Private property shall not be taken.</p>
      <p>Just compensation is required.</p>
      <p>Just compensation is required.</p>
      <p>Other text.</p>
      <p>Just compensation is required.</p>
    </body></html>"""
    (s9,) = _parse_sections(html)
    assert s9.plain_text == (
        "Private property shall not be taken. Just compensation is required. "
        "Other text. Just compensation is required."
    )


def test_parser_leaves_flat_markup_unchanged() -> None:
    # No nested blocks: text is byte-identical to the #512 parser's output.
    sections = _parse_sections(_RULES_HTML)
    assert _labels(sections) == [
        "RULE 73", "Section 1.", "Section 2.", "RULE 74", "Section 1.", "Section 2.",
    ]
    assert sections[4].plain_text == (
        "Extrajudicial settlement by agreement between heirs. "
        "The fact of the extrajudicial settlement shall be published."
    )


# ---------------------------------------------------------------------------
# Pure planning
# ---------------------------------------------------------------------------


def _off_by_one_rules_rows() -> list[SectionRow]:
    """What the pre-#512 seed wrote for ``_RULES_HTML``: each row holds the
    NEXT marker's opening paragraph, and the first one was dropped."""
    return [
        SectionRow("r73", "RULE 73", 1, "Section 1. Where estate of deceased persons settled."),
        SectionRow(
            "r73s1", "Section 1.", 2,
            "Section 2. Where estate settled upon dissolution of marriage.",
        ),
        SectionRow("r73s2", "Section 2.", 3, "RULE 74"),
        SectionRow(
            "r74", "RULE 74", 4,
            "Section 1. Extrajudicial settlement by agreement between heirs.",
            token_count=7,
        ),
        SectionRow(
            "r74s1", "Section 1.", 5,
            "The fact of the extrajudicial settlement shall be published. "
            "Section 2. Summary settlement of estates of small value.",
        ),
        SectionRow("r74s2", "Section 2.", 6, ""),
    ]


def test_plan_fixes_off_by_one_in_place_keeping_ids() -> None:
    plan = plan_reseed(_off_by_one_rules_rows(), _parse_sections(_RULES_HTML))

    assert plan.status == "reseeded"
    assert plan.matched == 6
    assert plan.of(ACTION_INSERT) == []
    assert plan.of(ACTION_UNMATCHED) == []
    after = {c.section_id: c.after for c in plan.changes}
    assert after["r73"] == ""
    assert after["r73s1"] == "Where estate of deceased persons settled."
    assert after["r73s2"] == "Where estate settled upon dissolution of marriage."
    # The repeated label "Section 1." matched its OWN rule's row.
    assert after["r74s1"] == (
        "Extrajudicial settlement by agreement between heirs. "
        "The fact of the extrajudicial settlement shall be published."
    )
    assert after["r74s2"] == "Summary settlement of estates of small value."
    assert all(c.old_ordering == c.new_ordering for c in plan.changes)


def test_plan_token_count_recomputed_only_when_previously_set() -> None:
    plan = plan_reseed(_off_by_one_rules_rows(), _parse_sections(_RULES_HTML))
    tokens = {c.section_id: c.token_count for c in plan.changes}
    assert tokens["r74"] == 0  # was 7, the heading row is now empty
    assert tokens["r73s1"] is None


def test_plan_repairs_doubled_constitution_rows() -> None:
    doubled = (
        "The privacy of communication and correspondence shall be inviolable. "
        "The privacy of communication and correspondence shall be inviolable. "
        "Any evidence obtained in violation of this shall be inadmissible. "
        "Any evidence obtained in violation of this shall be inadmissible."
    )
    rows = [
        SectionRow("a3", "ARTICLE III BILL OF RIGHTS", 1, ""),
        SectionRow("a3s3", "Section 3.", 2, doubled),
        SectionRow(
            "a3s4", "Section 4.", 3, "No law shall be passed abridging the freedom of speech.",
        ),
    ]
    plan = plan_reseed(rows, _parse_sections(_CONSTI_LIST_HTML))

    assert plan.status == "reseeded"
    (change,) = plan.text_updates
    assert change.section_id == "a3s3"
    assert change.before == doubled
    assert change.after.count("The privacy of communication") == 1


def test_plan_repairs_swallowed_block() -> None:
    rows = [
        SectionRow("s1", "Section 1.", 1, "No person shall be deprived of life."),
        SectionRow(
            "s2", "Section 2.", 2,
            "The right of the people to be secure shall be inviolable. Section 3. "
            "The privacy of communication shall be inviolable. Section 4. No law "
            "shall be passed abridging speech. Section 5. No law respecting an "
            "establishment of religion.",
        ),
        SectionRow("s3", "Section 3.", 3, "The privacy of communication shall be inviolable."),
        SectionRow("s4", "Section 4.", 4, "No law shall be passed abridging speech."),
        SectionRow("s5", "Section 5.", 5, "No law respecting an establishment of religion."),
    ]
    plan = plan_reseed(rows, _parse_sections(_CONSTI_SWALLOW_HTML))

    assert [(c.section_id, c.after) for c in plan.text_updates] == [
        ("s2", "The right of the people to be secure shall be inviolable."),
    ]


def test_plan_inserts_new_labels_and_keeps_unmatched_rows() -> None:
    rows = [
        SectionRow("h", "RULE 73", 1, ""),
        SectionRow("x", "Section 9.", 2, "A row the new parse no longer has."),
        SectionRow("s2", "Section 2.", 3, "old two"),
    ]
    parsed = [
        ParsedSection("rule", "RULE 73", ""),
        ParsedSection("section", "Section 1.", "one"),
        ParsedSection("section", "Section 2.", "two"),
    ]
    ids = iter(["new-1"])
    plan = plan_reseed(rows, parsed, new_id=lambda: next(ids))

    assert plan.status == "reseeded"
    by_id = {c.section_id: c for c in plan.changes}
    # Unmatched row: kept verbatim, never deleted, text untouched.
    assert by_id["x"].action == ACTION_UNMATCHED
    assert by_id["x"].before == by_id["x"].after == "A row the new parse no longer has."
    # New label inserted at its parsed position; the matched row after it moves.
    assert by_id["new-1"].action == ACTION_INSERT
    assert by_id["new-1"].section_type == "section"
    assert by_id["new-1"].after == "one"
    assert by_id["s2"].action == ACTION_UPDATE
    assert by_id["s2"].after == "two"
    orderings = sorted((c.new_ordering, c.section_id) for c in plan.changes)
    assert orderings == [(2, "x"), (3, "new-1"), (4, "s2")]


def test_plan_is_unchanged_when_rows_already_match() -> None:
    parsed = _parse_sections(_RULES_HTML)
    rows = [
        SectionRow(f"id{i}", s.section_label, i, s.plain_text)
        for i, s in enumerate(parsed, start=1)
    ]
    plan = plan_reseed(rows, parsed)
    assert plan.status == "unchanged"
    assert plan.changes == []


def test_plan_matches_labels_whitespace_insensitively() -> None:
    rows = [SectionRow("a", "ARTICLE  III\nBILL OF RIGHTS", 1, "x")]
    plan = plan_reseed(rows, [ParsedSection("article", "ARTICLE III BILL OF RIGHTS", "y")])
    assert [c.action for c in plan.changes] == [ACTION_UPDATE]


def _churn_plan(existing: int, extra_new: int) -> reseed.ReseedPlan:
    rows = [SectionRow(f"r{i}", f"Section {i}.", i, "old") for i in range(1, existing + 1)]
    parsed = [
        ParsedSection("section", f"Section {i}.", "new")
        for i in range(1, existing + extra_new + 1)
    ]
    return plan_reseed(rows, parsed)


def test_needs_decision_threshold_is_five_percent_of_existing_rows() -> None:
    at_limit = _churn_plan(100, 5)  # 5 inserts / 100 rows = exactly 5%
    assert len(at_limit.of(ACTION_INSERT)) == 5
    assert at_limit.needs_decision is False
    over = _churn_plan(100, 6)
    assert over.needs_decision is True


def test_needs_decision_counts_unmatched_rows_and_ignores_text_only_changes() -> None:
    rows = [SectionRow(f"r{i}", f"Section {i}.", i, "old") for i in range(1, 11)]
    text_only = plan_reseed(
        rows, [ParsedSection("section", f"Section {i}.", "new") for i in range(1, 11)],
    )
    assert len(text_only.text_updates) == 10
    assert text_only.needs_decision is False
    dropped = plan_reseed(
        rows, [ParsedSection("section", f"Section {i}.", "old") for i in range(1, 10)],
    )
    assert len(dropped.of(ACTION_UNMATCHED)) == 1  # 1 of 10 = 10%
    assert dropped.needs_decision is True


def test_skipped_plan_never_needs_decision() -> None:
    plan = plan_reseed([SectionRow("a", "Section 1.", 1, "x")], [])
    assert plan.status == "skipped"
    assert plan.needs_decision is False


@pytest.mark.parametrize(
    ("rows", "parsed", "reason"),
    [
        (
            [SectionRow("a", "Section 1.", 1, "x"), SectionRow("b", "Section 2.", 1, "y")],
            [ParsedSection("section", "Section 1.", "x")],
            SKIP_DUPLICATE_ORDERING,
        ),
        (
            [SectionRow("a", "Section 1.", 1, "x", html_text="<p>x</p>")],
            [ParsedSection("section", "Section 1.", "x")],
            SKIP_HTML_TEXT,
        ),
        (
            [SectionRow("a", "Section 1.", 1, "x")],
            [ParsedSection("section", "Full Text", "everything")],
            SKIP_NO_STRUCTURE,
        ),
        ([SectionRow("a", "Section 1.", 1, "x")], [], SKIP_NO_STRUCTURE),
    ],
)
def test_plan_skips_unsafe_documents(
    rows: list[SectionRow], parsed: list[ParsedSection], reason: str,
) -> None:
    plan = plan_reseed(rows, parsed)
    assert plan.status == "skipped"
    assert plan.reason == reason
    assert plan.changes == []


# ---------------------------------------------------------------------------
# DB-layer fakes
# ---------------------------------------------------------------------------

_URL = "https://lawphil.net/courts/rules/rc_72-109_proceedings.html"


class FakeDB:
    def __init__(self) -> None:
        self.documents: dict[str, dict[str, Any]] = {}
        self.sections: dict[str, dict[str, Any]] = {}
        self.versions: list[tuple[Any, ...]] = []
        self.audit_rows: list[tuple[Any, ...]] = []
        self.audio: list[dict[str, Any]] = []
        self.bookmarks: list[str] = []  # section ids
        self.write_sql: list[str] = []
        self.write_conns: list[FakeConn] = []
        self.mutate_before_update: dict[str, str] = {}

    def add_doc(
        self, doc_id: str, rows: list[SectionRow], *,
        doc_type: str = "rules_of_court", url: str | None = _URL,
    ) -> None:
        self.documents[doc_id] = {
            "id": doc_id, "title": f"Doc {doc_id}", "document_type": doc_type,
            "canonical_url": url, "version_no": 1, "checksum": "old-sha",
        }
        for r in rows:
            self.sections[r.id] = {
                "id": r.id, "legal_document_id": doc_id,
                "section_label": r.section_label, "ordering": r.ordering,
                "plain_text": r.plain_text, "html_text": r.html_text,
                "token_count": r.token_count, "section_type": "section",
            }


class FakeCursor:
    def __init__(self, conn: FakeConn) -> None:
        self.conn = conn
        self.db = conn.db
        self._rows: list[Any] = []
        self.rowcount = 0

    def __enter__(self) -> FakeCursor:
        return self

    def __exit__(self, *exc: Any) -> bool:
        return False

    def execute(self, sql: str, params: Any = None) -> None:  # noqa: C901
        db, conn = self.db, self.conn
        norm = " ".join(sql.split())
        if norm.startswith(("UPDATE", "INSERT", "DELETE")):
            assert not conn.readonly, "write on a read-only connection"
            db.write_sql.append(norm)
        if norm.startswith("SELECT id::text, title, document_type, canonical_url"):
            (doc_id,) = params
            doc = db.documents.get(doc_id)
            self._rows = [dict(doc)] if doc else []
        elif norm.startswith("SELECT") and "FROM legal_document_sections" in norm:
            (doc_id,) = params
            if "FOR UPDATE" in norm:
                for sid, text in db.mutate_before_update.items():
                    db.sections[sid]["plain_text"] = text
            rows = [s for s in db.sections.values() if s["legal_document_id"] == doc_id]
            rows.sort(key=lambda s: (s["ordering"], s["id"]))
            self._rows = [dict(s) for s in rows]
        elif norm.startswith("UPDATE legal_document_sections SET plain_text"):
            after, token_count, ordering, sid, doc_id, before = params
            self._guarded(sid, doc_id, before, {
                "plain_text": after, "token_count": token_count, "ordering": ordering,
            })
        elif norm.startswith("UPDATE legal_document_sections SET ordering"):
            ordering, sid, doc_id, before = params
            self._guarded(sid, doc_id, before, {"ordering": ordering})
        elif norm.startswith("INSERT INTO legal_document_sections"):
            sid, doc_id, section_type, label, ordering, text = params
            conn.pending.append(("insert", sid, {
                "id": sid, "legal_document_id": doc_id, "section_label": label,
                "ordering": ordering, "plain_text": text, "html_text": None,
                "token_count": None, "section_type": section_type,
            }))
            self.rowcount = 1
        elif norm.startswith("INSERT INTO legal_document_versions"):
            conn.pending.append(("version", None, tuple(params)))
            self.rowcount = 1
        elif norm.startswith("UPDATE legal_documents SET version_no"):
            checksum, doc_id = params
            conn.pending.append(("bump", doc_id, {"checksum": checksum}))
            self.rowcount = 1
        elif norm.startswith("INSERT INTO audit_logs"):
            conn.pending.append(("audit", None, tuple(params)))
            self.rowcount = 1
        elif "FROM audio_renditions" in norm and norm.startswith("SELECT id::text"):
            (ids,) = params
            self._rows = [dict(a) for a in db.audio if a["section_id"] in ids]
        elif norm.startswith("SELECT legal_document_section_id::text, COUNT(*) FROM bookmarks"):
            (ids,) = params
            self._rows = [
                (sid, db.bookmarks.count(sid)) for sid in ids if sid in db.bookmarks
            ]
        elif norm.startswith("SELECT") and "COUNT(*) FROM" in norm:
            self._rows = []  # annotations / provenance / audio: none in fixtures
        else:  # pragma: no cover - surfaces an unexpected query
            raise AssertionError(f"unexpected SQL: {norm}")

    def _guarded(self, sid: str, doc_id: str, before: str, values: dict[str, Any]) -> None:
        row = self.db.sections.get(sid)
        if row and row["legal_document_id"] == doc_id and (row["plain_text"] or "") == before:
            self.conn.pending.append(("update", sid, values))
            self.rowcount = 1
        else:
            self.rowcount = 0

    def fetchall(self) -> list[Any]:
        return list(self._rows)

    def fetchone(self) -> Any:
        return self._rows[0] if self._rows else None


class FakeConn:
    def __init__(self, db: FakeDB, *, readonly: bool) -> None:
        self.db = db
        self.readonly = readonly
        self.pending: list[tuple[str, str | None, Any]] = []
        self.committed = False
        self.rolled_back = False

    def cursor(self, cursor_factory: Any = None) -> FakeCursor:
        return FakeCursor(self)

    def commit(self) -> None:
        for kind, key, value in self.pending:
            if kind == "update":
                self.db.sections[key].update(value)
            elif kind == "insert":
                self.db.sections[key] = value
            elif kind == "version":
                self.db.versions.append(value)
            elif kind == "bump":
                doc = self.db.documents[key]
                doc["version_no"] += 1
                doc.update(value)
            elif kind == "audit":
                self.db.audit_rows.append(value)
        self.committed = True

    def rollback(self) -> None:
        self.pending.clear()
        self.rolled_back = True


@dataclass
class FakeFetched:
    html: str


class FakeFetcher:
    def __init__(self, pages: dict[str, str], *, fail: bool = False) -> None:
        self.pages = pages
        self.fail = fail
        self.urls: list[str] = []

    def fetch_content(self, url: str) -> FakeFetched:
        self.urls.append(url)
        if self.fail:
            raise RuntimeError("403 outside LawPhil hours")
        return FakeFetched(self.pages[url])


@pytest.fixture()
def fake_db() -> Iterator[FakeDB]:
    db = FakeDB()

    @contextmanager
    def read_conn() -> Iterator[FakeConn]:
        yield FakeConn(db, readonly=True)

    @contextmanager
    def write_conn() -> Iterator[FakeConn]:
        # Mirrors db_client.get_connection: commit on success, rollback on error.
        conn = FakeConn(db, readonly=False)
        db.write_conns.append(conn)
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise

    with (
        patch.object(reseed, "get_read_connection", read_conn),
        patch.object(reseed, "get_connection", write_conn),
        patch.object(
            reseed, "_upload_version_objects",
            lambda doc_id, version_id, source: (
                f"codals/{doc_id}/versions/{version_id}/raw.html",
                f"codals/{doc_id}/versions/{version_id}/normalized.txt",
            ),
        ),
    ):
        yield db


def _read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as fh:
        return list(csv.DictReader(fh))


def _seed_rules(db: FakeDB) -> None:
    rows = _off_by_one_rules_rows()
    rows.append(SectionRow("stale", "Section 99.", 7, "Row the new parse lacks."))
    db.add_doc("doc-sp", rows)
    db.bookmarks = ["stale", "stale", "r74s1"]
    db.audio = [{
        "audio_rendition_id": "ar-1", "section_id": "r73s1", "language": "en",
        "voice_id": "af_heart", "engine": "kokoro", "status": "ready",
        "content_hash": "h", "audio_object_key": "audio/r73s1.mp3",
        "readalong_object_key": None, "created_at": "2026-09-01",
    }]


def test_dry_run_writes_nothing_and_reports(fake_db: FakeDB, tmp_path: Path) -> None:
    _seed_rules(fake_db)
    before = {sid: dict(s) for sid, s in fake_db.sections.items()}
    fetcher = FakeFetcher({_URL: _RULES_HTML})

    out = reseed.run_reseed(
        document_ids=["doc-sp"], dry_run=True, out_dir=tmp_path, fetcher=fetcher,
    )

    assert fetcher.urls == [_URL]
    assert fake_db.write_conns == []
    assert fake_db.write_sql == []
    assert fake_db.sections == before
    assert out["dry_run"] is True
    assert out["docs_reseeded"] == 1
    assert out["rows_updated"] == 6
    assert out["rows_inserted"] == 0
    assert out["rows_unmatched_kept"] == 1
    assert out["audio_renditions_affected"] == 1
    # 1 unmatched of 7 existing rows = 14% > 5%.
    assert out["docs_needs_decision"] == 1

    docs = _read_csv(tmp_path / "documents.csv")
    assert [
        (d["document_id"], d["status"], d["needs_decision"], d["committed"]) for d in docs
    ] == [("doc-sp", "reseeded", "True", "False")]
    sections = _read_csv(tmp_path / "sections.csv")
    stale = next(r for r in sections if r["section_id"] == "stale")
    assert stale["action"] == ACTION_UNMATCHED
    assert json.loads(stale["references"]) == {"bookmarks": 2}
    r73s1 = next(r for r in sections if r["section_id"] == "r73s1")
    assert r73s1["before_text"].startswith("Section 2.")
    assert r73s1["after_text"] == "Where estate of deceased persons settled."
    audio = _read_csv(tmp_path / "audio_renditions.csv")
    assert [a["audio_rendition_id"] for a in audio] == ["ar-1"]

    summary = (tmp_path / "summary.txt").read_text(encoding="utf-8")
    assert "DRY RUN" in summary
    assert "rows unmatched, kept (NOT deleted): 1" in summary
    assert "UNMATCHED kept #7 'Section 99.' stale" in summary
    assert "docs needs_decision" in summary
    assert "'Doc doc-sp' — NEEDS_DECISION" in summary


def test_commit_one_transaction_with_version_and_audit(
    fake_db: FakeDB, tmp_path: Path,
) -> None:
    _seed_rules(fake_db)
    ids_before = set(fake_db.sections)

    out = reseed.run_reseed(
        document_ids=["doc-sp"], dry_run=False, out_dir=tmp_path,
        fetcher=FakeFetcher({_URL: _RULES_HTML}),
    )

    assert out["docs_committed"] == 1
    assert len(fake_db.write_conns) == 1
    assert fake_db.write_conns[0].committed
    assert not any(sql.startswith("DELETE") for sql in fake_db.write_sql)
    assert set(fake_db.sections) == ids_before  # every id survives, none added
    assert fake_db.sections["r74s2"]["plain_text"] == (
        "Summary settlement of estates of small value."
    )
    assert fake_db.sections["stale"]["plain_text"] == "Row the new parse lacks."

    (version,) = fake_db.versions
    assert version[1] == "doc-sp"
    assert version[2].startswith("codals/doc-sp/versions/")
    assert version[7] == reseed.PARSER_VERSION
    assert fake_db.documents["doc-sp"]["version_no"] == 2
    assert fake_db.documents["doc-sp"]["checksum"] == version[6]

    (audit,) = fake_db.audit_rows
    assert audit[3] == reseed.AUDIT_ACTION
    assert audit[5] == "doc-sp"
    meta = json.loads(audit[6])
    assert meta["rows_updated"] == 6
    assert meta["rows_unmatched_kept"] == 1
    assert meta["version_no_before"] == 1
    assert "Where estate" not in audit[6]  # hashes, not text


def test_commit_inserts_new_labels(fake_db: FakeDB, tmp_path: Path) -> None:
    rows = [r for r in _off_by_one_rules_rows() if r.id != "r74s2"]
    fake_db.add_doc("doc-sp", rows)

    out = reseed.run_reseed(
        document_ids=["doc-sp"], dry_run=False, out_dir=tmp_path,
        fetcher=FakeFetcher({_URL: _RULES_HTML}),
    )

    assert out["rows_inserted"] == 1
    new_ids = set(fake_db.sections) - {r.id for r in rows}
    (new_id,) = new_ids
    inserted = fake_db.sections[new_id]
    assert inserted["section_label"] == "Section 2."
    assert inserted["ordering"] == 6
    assert inserted["plain_text"] == "Summary settlement of estates of small value."
    # The report names the same id that was written.
    sections = _read_csv(tmp_path / "sections.csv")
    assert [r["section_id"] for r in sections if r["action"] == ACTION_INSERT] == [new_id]


def test_commit_is_idempotent(fake_db: FakeDB, tmp_path: Path) -> None:
    _seed_rules(fake_db)
    fetcher = FakeFetcher({_URL: _RULES_HTML})
    reseed.run_reseed(document_ids=["doc-sp"], dry_run=False, out_dir=tmp_path, fetcher=fetcher)

    again = reseed.run_reseed(
        document_ids=["doc-sp"], dry_run=False, out_dir=tmp_path / "2", fetcher=fetcher,
    )

    assert again["docs_unchanged"] == 1
    assert again["docs_committed"] == 0
    assert len(fake_db.versions) == 1
    assert len(fake_db.audit_rows) == 1


def test_commit_rolls_back_when_text_changes_under_the_guard(
    fake_db: FakeDB, tmp_path: Path,
) -> None:
    _seed_rules(fake_db)
    before = {sid: dict(s) for sid, s in fake_db.sections.items()}

    # A guarded UPDATE that matches no row (text moved after the locked
    # read) must roll back the whole document: no partial rows, no version.
    original = FakeCursor._guarded

    def racing_guard(
        self: FakeCursor, sid: str, doc_id: str, before_text: str, values: dict[str, Any],
    ) -> None:
        if sid == "r74s2":
            self.rowcount = 0
            return
        original(self, sid, doc_id, before_text, values)

    with patch.object(FakeCursor, "_guarded", racing_guard):
        out = reseed.run_reseed(
            document_ids=["doc-sp"], dry_run=False, out_dir=tmp_path,
            fetcher=FakeFetcher({_URL: _RULES_HTML}),
        )

    assert out["docs_committed"] == 0
    assert out["skip_reasons"] == {reseed.SKIP_CHANGED_DURING_COMMIT: 1}
    assert fake_db.write_conns[0].rolled_back
    assert fake_db.sections == before
    assert fake_db.versions == []
    assert fake_db.audit_rows == []


def test_commit_replans_from_the_locked_read(fake_db: FakeDB, tmp_path: Path) -> None:
    _seed_rules(fake_db)
    # Text moves between the dry scan and the FOR UPDATE read: the commit
    # plans from what it locked, so the guard holds and the write lands.
    fake_db.mutate_before_update = {"r73s1": "edited by an editor"}

    out = reseed.run_reseed(
        document_ids=["doc-sp"], dry_run=False, out_dir=tmp_path,
        fetcher=FakeFetcher({_URL: _RULES_HTML}),
    )

    assert out["docs_committed"] == 1
    assert fake_db.sections["r73s1"]["plain_text"] == "Where estate of deceased persons settled."
    change = next(
        c for c in json.loads(fake_db.audit_rows[0][6])["changes"] if c["section_id"] == "r73s1"
    )
    assert change["before_len"] == len("edited by an editor")


@pytest.mark.parametrize(
    ("doc_type", "url", "reason"),
    [
        ("decision", _URL, reseed.SKIP_DECISION),
        ("rules_of_court", "https://example.com/rc.html", reseed.SKIP_NOT_LAWPHIL),
        ("rules_of_court", None, reseed.SKIP_NOT_LAWPHIL),
    ],
)
def test_refuses_decisions_and_non_lawphil_sources(
    fake_db: FakeDB, tmp_path: Path, doc_type: str, url: str | None, reason: str,
) -> None:
    fake_db.add_doc("doc-x", [SectionRow("a", "Section 1.", 1, "x")], doc_type=doc_type, url=url)
    fetcher = FakeFetcher({})

    out = reseed.run_reseed(
        document_ids=["doc-x"], dry_run=False, out_dir=tmp_path, fetcher=fetcher,
    )

    assert fetcher.urls == []
    assert fake_db.write_conns == []
    assert list(out["skip_reasons"]) == [reason]


def test_missing_document_and_fetch_failure_are_reported(
    fake_db: FakeDB, tmp_path: Path,
) -> None:
    _seed_rules(fake_db)

    out = reseed.run_reseed(
        document_ids=["nope", "doc-sp", "doc-sp"], dry_run=False, out_dir=tmp_path,
        fetcher=FakeFetcher({}, fail=True),
    )

    assert out["docs_requested"] == 2  # duplicate id collapsed
    assert out["skip_reasons"] == {
        reseed.SKIP_FETCH_FAILED: 1, reseed.SKIP_NOT_FOUND: 1,
    }
    assert fake_db.write_conns == []
    reasons = {d["document_id"]: d["reason"] for d in _read_csv(tmp_path / "documents.csv")}
    assert "outside LawPhil hours" in reasons["doc-sp"]


def test_run_reseed_requires_document_ids(fake_db: FakeDB, tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="document id"):
        reseed.run_reseed(document_ids=[], out_dir=tmp_path, fetcher=FakeFetcher({}))


# ---------------------------------------------------------------------------
# Entry points
# ---------------------------------------------------------------------------


def test_cli_requires_document_id() -> None:
    with pytest.raises(SystemExit):
        reseed._build_parser().parse_args([])


def test_cli_defaults_to_dry_run(tmp_path: Path) -> None:
    with patch.object(reseed, "run_reseed") as run:
        run.return_value = {"summary": "", "report_dir": str(tmp_path)}
        assert reseed._cli(["--document-id", "a", "--document-id", "b"]) == 0
    run.assert_called_once_with(document_ids=["a", "b"], dry_run=True, out_dir=None)


def test_cli_commit_flag(tmp_path: Path) -> None:
    with patch.object(reseed, "run_reseed") as run:
        run.return_value = {"summary": "", "report_dir": str(tmp_path)}
        reseed._cli(["--document-id", "a", "--commit", "--out-dir", str(tmp_path)])
    run.assert_called_once_with(document_ids=["a"], dry_run=False, out_dir=tmp_path)


def test_celery_task_defaults_to_dry_run() -> None:
    with patch.object(reseed, "run_reseed") as run:
        run.return_value = {"summary": "s", "report_dir": "r"}
        result = reseed.reseed_statutory_document_task(document_ids=["a"])
    run.assert_called_once_with(document_ids=["a"], dry_run=True, out_dir=None)
    assert "summary" not in result
