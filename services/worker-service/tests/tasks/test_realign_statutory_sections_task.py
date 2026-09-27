"""Tests for ``realign_statutory_sections_task``.

Pure-function tests cover the alignment algorithm. DB-layer tests swap
``get_read_connection`` / ``get_connection`` for an in-memory fake (the
same approach as ``test_dedup_backfill.py``) — no live database.
"""

from __future__ import annotations

import csv
import json
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest

from src.tasks import realign_statutory_sections_task as realign
from src.tasks.realign_statutory_sections_task import (
    SKIP_CHAR_COUNT_CHANGED,
    SKIP_DUPLICATE_ORDERING,
    SKIP_HTML_TEXT,
    SKIP_LABEL_NOT_FOUND,
    SKIP_NO_SECTIONS,
    SKIP_TEXT_BEFORE_FIRST_LABEL,
    AlignmentResult,
    SectionRow,
    align_sections,
    label_pattern,
)
from src.tasks.seed_codals_task import _parse_sections

# ---------------------------------------------------------------------------
# Fixtures: what the pre-fix parser wrote for this LawPhil markup
# ---------------------------------------------------------------------------

_HTML = """
<html><body>
  <p>REPUBLIC ACT NO. 386</p>
  <p align="center"><b>CHAPTER 2<br>Consent</b></p>
  <p><b>Article 1316.</b> Real contracts shall not be perfected until the
     delivery of the object. (n)</p>
  <p><b>Article 1317.</b> No one may contract in the name of another without
     being authorized by the latter.</p>
  <p>A contract entered into in the name of another by one who has no
     authority shall be unenforceable. (1259a)</p>
  <p align="center"><b>CHAPTER 3</b></p>
  <p align="center">Object of Contracts</p>
  <p><b>Article 1318.</b> There is no contract unless the following
     requisites concur: (1261)</p>
  <p>(1) Consent of the contracting parties;</p>
</body></html>
"""

_P1316 = (
    "Article 1316. Real contracts shall not be perfected until the "
    "delivery of the object. (n)"
)
_P1317A = (
    "Article 1317. No one may contract in the name of another without "
    "being authorized by the latter."
)
_P1317B = (
    "A contract entered into in the name of another by one who has no "
    "authority shall be unenforceable. (1259a)"
)
_P1318A = "Article 1318. There is no contract unless the following requisites concur: (1261)"
_P1318B = "(1) Consent of the contracting parties;"


def _buggy_rows() -> list[SectionRow]:
    """Rows exactly as the old descendant walk produced them: each row
    ends with the NEXT marker's opening paragraph, and the paragraph that
    opened the first marker was dropped (no section open yet)."""
    return [
        SectionRow("s-ch2", "CHAPTER 2 Consent", 1, _P1316),
        SectionRow("s-1316", "Article 1316.", 2, _P1317A),
        SectionRow("s-1317", "Article 1317.", 3, f"{_P1317B} CHAPTER 3"),
        SectionRow("s-ch3", "CHAPTER 3", 4, f"Object of Contracts {_P1318A}"),
        SectionRow("s-1318", "Article 1318.", 5, _P1318B),
    ]


def _texts(rows: list[SectionRow], result: AlignmentResult) -> dict[str, str]:
    """Apply ``result`` to ``rows`` and return {label: text}."""
    new = {c.section_id: c.after for c in result.changes}
    return {r.section_label or "": new.get(r.id, r.plain_text or "") for r in rows}


def _apply(rows: list[SectionRow], result: AlignmentResult) -> list[SectionRow]:
    new = {c.section_id: c.after for c in result.changes}
    return [
        SectionRow(r.id, r.section_label, r.ordering, new.get(r.id, r.plain_text))
        for r in rows
    ]


# ---------------------------------------------------------------------------
# Pure alignment
# ---------------------------------------------------------------------------


def test_realigns_the_off_by_one_rows() -> None:
    rows = _buggy_rows()
    result = align_sections(rows)
    assert result.status == "aligned", result.reason
    assert result.first_label_missing is True
    assert _texts(rows, result) == {
        "CHAPTER 2 Consent": "",
        "Article 1316.": _P1316,
        "Article 1317.": f"{_P1317A} {_P1317B}",
        "CHAPTER 3": "CHAPTER 3 Object of Contracts",
        "Article 1318.": f"{_P1318A} {_P1318B}",
    }


def test_realigned_articles_match_the_fixed_parser() -> None:
    """Cross-check: after repair each article row holds exactly what the
    fixed ``_parse_sections`` produces for it, prefixed by its label."""
    rows = _buggy_rows()
    realigned = _texts(rows, align_sections(rows))
    fixed = {s.section_label: s.plain_text for s in _parse_sections(_HTML)}
    for label in ("Article 1316.", "Article 1317.", "Article 1318."):
        assert " ".join(realigned[label].split()) == " ".join(
            f"{label} {fixed[label]}".split(),
        )


def test_keeps_ids_labels_and_orderings() -> None:
    rows = _buggy_rows()
    result = align_sections(rows)
    by_id = {r.id: r for r in rows}
    for change in result.changes:
        assert change.section_label == by_id[change.section_id].section_label
        assert change.ordering == by_id[change.section_id].ordering
    assert {c.section_id for c in result.changes} <= set(by_id)


def test_non_space_character_count_is_preserved() -> None:
    rows = _buggy_rows()
    result = align_sections(rows)
    before = "".join("".join((r.plain_text or "").split()) for r in rows)
    after = "".join("".join(t.split()) for t in _texts(rows, result).values())
    assert len(before) == len(after) == result.non_space_chars
    # The text itself, in order, is untouched — only the cut points move.
    assert after == before


def test_is_idempotent() -> None:
    rows = _buggy_rows()
    once = _apply(rows, align_sections(rows))
    second = align_sections(once)
    assert second.status == "unchanged"
    assert second.changes == []


def test_already_aligned_document_is_unchanged() -> None:
    rows = [
        SectionRow("a", "Section 1.", 1, "Section 1. One."),
        SectionRow("b", "Section 2.", 2, "Section 2. Two."),
    ]
    result = align_sections(rows)
    assert result.status == "unchanged"
    assert result.first_label_missing is False


def test_rows_are_processed_in_ordering_order() -> None:
    rows = list(reversed(_buggy_rows()))
    result = align_sections(rows)
    assert result.status == "aligned"
    assert _texts(rows, result)["Article 1316."] == _P1316


def test_label_not_found_skips_whole_document() -> None:
    rows = _buggy_rows()
    rows[2] = SectionRow("s-1317", "Article 9999.", 3, rows[2].plain_text)
    result = align_sections(rows)
    assert result.status == "skipped"
    assert result.reason is not None
    assert result.reason.startswith(SKIP_LABEL_NOT_FOUND)
    assert "Article 9999." in result.reason
    assert result.changes == []


def test_labels_must_appear_in_order() -> None:
    rows = [
        SectionRow("a", "Section 1.", 1, "Section 1. One. Section 2. Two."),
        SectionRow("b", "Section 3.", 2, "Section 3. Three."),
        SectionRow("c", "Section 2.", 3, ""),
    ]
    result = align_sections(rows)
    assert result.status == "skipped"
    assert result.reason is not None and "Section 2." in result.reason


def test_text_before_a_found_first_label_skips() -> None:
    rows = [
        SectionRow("a", "Section 1.", 1, "Stray preamble. Section 1. One."),
        SectionRow("b", "Section 2.", 2, "Section 2. Two."),
    ]
    result = align_sections(rows)
    assert result.status == "skipped"
    assert result.reason == SKIP_TEXT_BEFORE_FIRST_LABEL


def test_first_row_label_missing_starts_at_zero() -> None:
    rows = [
        SectionRow("a", "Article 1.", 1, "continuation of one Article 2. Two."),
        SectionRow("b", "Article 2.", 2, "more two"),
    ]
    result = align_sections(rows)
    assert result.status == "aligned"
    assert result.first_label_missing is True
    assert _texts(rows, result) == {
        "Article 1.": "continuation of one",
        "Article 2.": "Article 2. Two. more two",
    }


def test_duplicate_ordering_skips() -> None:
    rows = [
        SectionRow("a", "Section 1.", 1, "Section 1. One."),
        SectionRow("b", "Section 2.", 1, "Section 2. Two."),
    ]
    assert align_sections(rows).reason == SKIP_DUPLICATE_ORDERING


def test_html_text_skips() -> None:
    rows = [
        SectionRow("a", "Section 1.", 1, "One. Section 2. Two.", html_text="<p>x</p>"),
        SectionRow("b", "Section 2.", 2, "more"),
    ]
    assert align_sections(rows).reason == SKIP_HTML_TEXT


def test_no_sections_skips() -> None:
    result = align_sections([])
    assert result.status == "skipped"
    assert result.reason == SKIP_NO_SECTIONS


def test_char_count_guard_reason_is_exported() -> None:
    # The guard is unreachable by construction (new texts are slices of the
    # concatenation) but it must stay wired as a last line of defence.
    assert SKIP_CHAR_COUNT_CHANGED == "non_space_char_count_changed"


def test_null_plain_text_rows_are_handled() -> None:
    rows = [
        SectionRow("a", "Section 1.", 1, "Section 1. One. Section 2. Two."),
        SectionRow("b", "Section 2.", 2, None),
    ]
    result = align_sections(rows)
    assert result.status == "aligned"
    assert _texts(rows, result) == {
        "Section 1.": "Section 1. One.",
        "Section 2.": "Section 2. Two.",
    }
    b_change = next(c for c in result.changes if c.section_id == "b")
    assert b_change.before == ""


def test_token_count_recomputed_only_when_previously_set() -> None:
    rows = [
        SectionRow("a", "Section 1.", 1, "Section 1. One two. Section 2. x", token_count=9),
        SectionRow("b", "Section 2.", 2, "y z"),
    ]
    result = align_sections(rows)
    by_id = {c.section_id: c for c in result.changes}
    assert by_id["a"].token_count == int(4 * 1.3)
    assert by_id["b"].token_count is None


def test_single_full_text_row_is_unchanged() -> None:
    rows = [SectionRow("a", "Full Text", 1, "Whole unstructured body.")]
    assert align_sections(rows).status == "unchanged"


# ---------------------------------------------------------------------------
# label_pattern
# ---------------------------------------------------------------------------


def test_label_pattern_requires_word_boundaries() -> None:
    pat = label_pattern("Section 3")
    assert pat is not None
    assert pat.search("see Section 30 here") is None
    assert pat.search("xSection 3 here") is None
    assert pat.search("text. Section 3 Scope") is not None


def test_label_pattern_article_with_period_does_not_match_longer_number() -> None:
    pat = label_pattern("Article 13.")
    assert pat is not None
    assert pat.search("Article 1318. text") is None
    assert pat.search("end. Article 13. text") is not None


def test_label_pattern_is_whitespace_insensitive() -> None:
    pat = label_pattern("CHAPTER 2 Consent")
    assert pat is not None
    assert pat.search("x CHAPTER  2\nConsent y") is not None


def test_label_pattern_is_case_sensitive() -> None:
    """Running cross-references use lowercase ``article N``; the heading
    is capitalised, so a cross-reference never steals the split point."""
    pat = label_pattern("Article 1318.")
    assert pat is not None
    assert pat.search("as provided in article 1318.") is None


def test_label_pattern_empty_or_none() -> None:
    assert label_pattern(None) is None
    assert label_pattern("   ") is None


def test_lowercase_cross_reference_does_not_split_early() -> None:
    rows = [
        SectionRow("a", "Article 1.", 1, "Article 1. See article 2. for more."),
        SectionRow("b", "Article 2.", 2, "Article 2. Two."),
    ]
    assert align_sections(rows).status == "unchanged"


# ---------------------------------------------------------------------------
# DB layer (in-memory fake)
# ---------------------------------------------------------------------------


class FakeDB:
    def __init__(self) -> None:
        self.documents: list[dict[str, Any]] = []
        self.sections: dict[str, dict[str, Any]] = {}
        self.audio: list[dict[str, Any]] = []
        self.embeddings: list[tuple[str, str]] = []  # (entity_type, entity_id)
        self.audit_rows: list[tuple[Any, ...]] = []
        self.write_sql: list[str] = []
        self.section_reads: list[str] = []
        self.read_conns = 0
        self.write_conns: list[FakeConn] = []
        self.mutate_before_update: dict[str, str] = {}

    def add_doc(self, doc_id: str, doc_type: str, rows: list[SectionRow]) -> None:
        self.documents.append(
            {"id": doc_id, "title": f"Doc {doc_id}", "document_type": doc_type},
        )
        for r in rows:
            self.sections[r.id] = {
                "id": r.id,
                "legal_document_id": doc_id,
                "section_label": r.section_label,
                "ordering": r.ordering,
                "plain_text": r.plain_text,
                "html_text": r.html_text,
                "token_count": r.token_count,
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

    def execute(self, sql: str, params: Any = None) -> None:
        db = self.db
        norm = " ".join(sql.split())
        if norm.startswith(("UPDATE", "INSERT")):
            assert not self.conn.readonly, "write on a read-only connection"
            db.write_sql.append(norm)
        if norm.startswith("SELECT id::text, title, document_type FROM legal_documents"):
            assert "document_type <> 'decision'" in norm
            docs = [d for d in db.documents if d["document_type"] != "decision"]
            p = list(params)
            if "ANY(%s)" in norm:
                ids = p.pop(0)
                docs = [d for d in docs if d["id"] in ids]
            docs.sort(key=lambda d: d["id"])
            if "LIMIT" in norm:
                docs = docs[: p.pop(0)]
            self._rows = [dict(d) for d in docs]
        elif "FROM legal_document_sections" in norm and norm.startswith("SELECT"):
            (doc_id,) = params
            db.section_reads.append(doc_id)
            if "FOR UPDATE" in norm:
                for sid, text in db.mutate_before_update.items():
                    db.sections[sid]["plain_text"] = text
            rows = [s for s in db.sections.values() if s["legal_document_id"] == doc_id]
            rows.sort(key=lambda s: (s["ordering"], s["id"]))
            self._rows = [dict(s) for s in rows]
        elif norm.startswith("SELECT document_type FROM legal_documents"):
            (doc_id,) = params
            self._rows = [
                (d["document_type"],) for d in db.documents if d["id"] == doc_id
            ]
        elif norm.startswith("UPDATE legal_document_sections"):
            after, token_count, sid, doc_id, before = params
            row = db.sections.get(sid)
            if (
                row is not None
                and row["legal_document_id"] == doc_id
                and (row["plain_text"] or "") == before
            ):
                self.conn.pending.append((sid, after, token_count))
                self.rowcount = 1
            else:
                self.rowcount = 0
        elif norm.startswith("INSERT INTO audit_logs"):
            self.conn.pending_audit.append(tuple(params))
            self.rowcount = 1
        elif "FROM audio_renditions" in norm:
            (ids,) = params
            self._rows = [dict(a) for a in db.audio if a["section_id"] in ids]
        elif "FROM embeddings" in norm:
            (ids,) = params
            n = sum(1 for et, eid in db.embeddings if et == "section" and eid in ids)
            self._rows = [(n,)]
        else:  # pragma: no cover - surfaces an unexpected query
            raise AssertionError(f"unexpected SQL: {norm}")

    def fetchall(self) -> list[Any]:
        return list(self._rows)

    def fetchone(self) -> Any:
        return self._rows[0] if self._rows else None


class FakeConn:
    def __init__(self, db: FakeDB, *, readonly: bool) -> None:
        self.db = db
        self.readonly = readonly
        self.pending: list[tuple[str, str, int | None]] = []
        self.pending_audit: list[tuple[Any, ...]] = []
        self.committed = False
        self.rolled_back = False

    def cursor(self, cursor_factory: Any = None) -> FakeCursor:
        return FakeCursor(self)

    def commit(self) -> None:
        for sid, after, token_count in self.pending:
            self.db.sections[sid]["plain_text"] = after
            self.db.sections[sid]["token_count"] = token_count
        self.db.audit_rows.extend(self.pending_audit)
        self.committed = True

    def rollback(self) -> None:
        self.pending.clear()
        self.pending_audit.clear()
        self.rolled_back = True


@pytest.fixture()
def fake_db() -> Iterator[FakeDB]:
    db = FakeDB()

    @contextmanager
    def read_conn() -> Iterator[FakeConn]:
        db.read_conns += 1
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
        patch.object(realign, "get_read_connection", read_conn),
        patch.object(realign, "get_connection", write_conn),
    ):
        yield db


def _seed(db: FakeDB) -> None:
    db.add_doc("doc-civil", "codal", _buggy_rows())
    db.add_doc(
        "doc-skip",
        "republic_act",
        [
            SectionRow("k1", "Section 1.", 1, "Section 1. One. Section 2. Two."),
            SectionRow("k2", "Section 7.", 2, "Three."),
        ],
    )
    db.add_doc(
        "doc-aligned",
        "rules_of_court",
        [
            SectionRow("r1", "RULE 1", 1, "RULE 1 General."),
            SectionRow("r2", "RULE 2", 2, "RULE 2 Cause."),
        ],
    )
    db.add_doc(
        "doc-decision",
        "decision",
        [
            SectionRow("d1", "Article 1.", 1, "junk Article 2. text"),
            SectionRow("d2", "Article 2.", 2, "more"),
        ],
    )
    db.audio = [
        {
            "audio_rendition_id": "ar-1",
            "section_id": "s-1316",
            "language": "en",
            "voice_id": "Joanna",
            "engine": "polly",
            "status": "ready",
            "content_hash": "h",
            "audio_object_key": "audio/s-1316.mp3",
            "readalong_object_key": None,
            "created_at": "2026-09-01",
        },
        {
            "audio_rendition_id": "ar-unchanged",
            "section_id": "r1",
            "language": "en",
            "voice_id": "Joanna",
            "engine": "polly",
            "status": "ready",
            "content_hash": "h2",
            "audio_object_key": "audio/r1.mp3",
            "readalong_object_key": None,
            "created_at": "2026-09-01",
        },
    ]
    db.embeddings = [("section", "s-1317"), ("section", "r2"), ("document", "s-1318")]


def _read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as fh:
        return list(csv.DictReader(fh))


def test_dry_run_writes_nothing_and_reports(fake_db: FakeDB, tmp_path: Path) -> None:
    _seed(fake_db)
    before = {sid: dict(s) for sid, s in fake_db.sections.items()}

    out = realign.run_realign(dry_run=True, out_dir=tmp_path)

    assert fake_db.write_conns == []
    assert fake_db.write_sql == []
    assert fake_db.sections == before
    assert out["dry_run"] is True
    assert out["docs_scanned"] == 3  # decision excluded
    assert out["docs_aligned"] == 1
    assert out["docs_unchanged"] == 1
    assert out["docs_skipped"] == 1
    assert out["skip_reasons"] == {SKIP_LABEL_NOT_FOUND: 1}
    assert out["rows_changed"] == 5
    assert out["audio_renditions_affected"] == 1
    assert out["section_embeddings_stale"] == 1
    assert "doc-decision" not in fake_db.section_reads

    docs = {r["document_id"]: r for r in _read_csv(tmp_path / "documents.csv")}
    assert set(docs) == {"doc-civil", "doc-skip", "doc-aligned"}
    assert docs["doc-skip"]["status"] == "skipped"
    assert "Section 7." in docs["doc-skip"]["reason"]
    assert docs["doc-civil"]["first_label_missing"] == "True"

    sections = _read_csv(tmp_path / "sections.csv")
    assert len(sections) == 5
    s1316 = next(r for r in sections if r["section_id"] == "s-1316")
    assert s1316["before_text"] == _P1317A
    assert s1316["after_text"] == _P1316

    audio = _read_csv(tmp_path / "audio_renditions.csv")
    assert [a["audio_rendition_id"] for a in audio] == ["ar-1"]

    summary = (tmp_path / "summary.txt").read_text(encoding="utf-8")
    assert "DRY RUN" in summary
    assert "docs scanned:   3" in summary
    assert "label_not_found: 1" in summary
    assert "rows changed:   5" in summary
    assert "doc-civil" in summary
    # Exactly SAMPLES_PER_DOC before/after samples for the aligned doc.
    assert summary.count("    before: ") == realign.SAMPLES_PER_DOC
    assert summary.count("    after:  ") == realign.SAMPLES_PER_DOC


def test_commit_realigns_in_one_transaction_per_doc_with_audit(
    fake_db: FakeDB, tmp_path: Path,
) -> None:
    _seed(fake_db)
    ids_before = {
        sid: (s["legal_document_id"], s["section_label"], s["ordering"])
        for sid, s in fake_db.sections.items()
    }

    out = realign.run_realign(dry_run=False, out_dir=tmp_path)

    assert out["docs_committed"] == 1
    assert len(fake_db.write_conns) == 1  # only the doc that needs changes
    assert fake_db.write_conns[0].committed is True
    # ids, labels, orderings untouched
    assert {
        sid: (s["legal_document_id"], s["section_label"], s["ordering"])
        for sid, s in fake_db.sections.items()
    } == ids_before
    texts = {sid: s["plain_text"] for sid, s in fake_db.sections.items()}
    assert texts["s-1316"] == _P1316
    assert texts["s-1317"] == f"{_P1317A} {_P1317B}"
    assert texts["s-1318"] == f"{_P1318A} {_P1318B}"
    # Skipped, aligned and decision docs untouched.
    assert texts["k1"] == "Section 1. One. Section 2. Two."
    assert texts["r1"] == "RULE 1 General."
    assert texts["d1"] == "junk Article 2. text"

    assert len(fake_db.audit_rows) == 1
    (_id, actor, actor_type, action, entity_type, entity_id, meta_json) = (
        fake_db.audit_rows[0]
    )
    assert actor is None
    assert actor_type == "system"
    assert action == realign.AUDIT_ACTION
    assert entity_type == "legal_document"
    assert entity_id == "doc-civil"
    meta = json.loads(meta_json)
    assert meta["rows_changed"] == 5
    assert meta["first_label_missing"] is True
    assert {c["section_id"] for c in meta["changes"]} == {
        "s-ch2", "s-1316", "s-1317", "s-ch3", "s-1318",
    }
    assert all(len(c["after_sha256"]) == 64 for c in meta["changes"])
    # Only section UPDATEs and the audit INSERT were issued — nothing on
    # legal_document_versions or anywhere else.
    assert all(
        sql.startswith(("UPDATE legal_document_sections", "INSERT INTO audit_logs"))
        for sql in fake_db.write_sql
    )


def test_commit_is_idempotent(fake_db: FakeDB, tmp_path: Path) -> None:
    _seed(fake_db)
    realign.run_realign(dry_run=False, out_dir=tmp_path / "one")
    snapshot = {sid: dict(s) for sid, s in fake_db.sections.items()}
    fake_db.write_conns.clear()

    out = realign.run_realign(dry_run=False, out_dir=tmp_path / "two")

    assert out["docs_aligned"] == 0
    assert out["rows_changed"] == 0
    assert fake_db.write_conns == []
    assert len(fake_db.audit_rows) == 1  # still only the first run's row
    assert fake_db.sections == snapshot


def test_commit_rolls_back_when_text_changes_under_the_guard(
    fake_db: FakeDB, tmp_path: Path,
) -> None:
    _seed(fake_db)
    original = {sid: s["plain_text"] for sid, s in fake_db.sections.items()}

    # Re-read under FOR UPDATE sees one text, but a concurrent writer
    # changes another row between the re-read and the guarded UPDATE.
    def racing_apply(cur: Any, document_id: str, changes: list[Any]) -> None:
        fake_db.sections["s-1318"]["plain_text"] = "edited elsewhere"
        real_apply(cur, document_id, changes)

    real_apply = realign._apply_changes
    with patch.object(realign, "_apply_changes", racing_apply):
        out = realign.run_realign(dry_run=False, out_dir=tmp_path)

    fake_db.sections["s-1318"]["plain_text"] = original["s-1318"]
    assert {sid: s["plain_text"] for sid, s in fake_db.sections.items()} == original
    assert fake_db.write_conns[0].rolled_back is True
    assert fake_db.audit_rows == []
    assert out["docs_committed"] == 0
    assert out["skip_reasons"].get(realign.SKIP_CHANGED_DURING_COMMIT) == 1


def test_commit_realigns_from_fresh_locked_read(fake_db: FakeDB, tmp_path: Path) -> None:
    """The commit path re-reads the rows FOR UPDATE and re-aligns; if the
    fresh read no longer needs changes nothing is written."""
    _seed(fake_db)
    fixed = align_sections(_buggy_rows())
    fake_db.mutate_before_update = {c.section_id: c.after for c in fixed.changes}

    out = realign.run_realign(dry_run=False, out_dir=tmp_path)

    assert out["docs_committed"] == 0
    assert fake_db.audit_rows == []


def test_commit_never_touches_a_decision_even_if_named(
    fake_db: FakeDB, tmp_path: Path,
) -> None:
    _seed(fake_db)
    out = realign.run_realign(
        dry_run=False, document_ids=["doc-decision"], out_dir=tmp_path,
    )
    assert out["docs_scanned"] == 0
    assert fake_db.write_conns == []
    assert fake_db.sections["d1"]["plain_text"] == "junk Article 2. text"


def test_commit_document_refuses_decision_type(fake_db: FakeDB) -> None:
    _seed(fake_db)
    result = realign._commit_document("doc-decision")
    assert result.status == "skipped"
    assert result.reason == "not_statutory"
    assert fake_db.audit_rows == []


def test_document_filter_and_limit(fake_db: FakeDB, tmp_path: Path) -> None:
    _seed(fake_db)
    out = realign.run_realign(dry_run=True, document_ids=["doc-civil"], out_dir=tmp_path)
    assert out["docs_scanned"] == 1
    out = realign.run_realign(dry_run=True, limit=2, out_dir=tmp_path / "b")
    assert out["docs_scanned"] == 2


# ---------------------------------------------------------------------------
# CLI + Celery wrapper
# ---------------------------------------------------------------------------


def test_cli_defaults_to_dry_run(tmp_path: Path) -> None:
    with patch.object(realign, "run_realign") as run:
        run.return_value = {"summary": "s", "report_dir": str(tmp_path)}
        assert realign._cli(["--out-dir", str(tmp_path)]) == 0
    assert run.call_args.kwargs["dry_run"] is True


def test_cli_commit_flag_and_filters(tmp_path: Path) -> None:
    with patch.object(realign, "run_realign") as run:
        run.return_value = {"summary": "s", "report_dir": str(tmp_path)}
        realign._cli([
            "--commit", "--document-id", "a", "--document-id", "b", "--limit", "5",
        ])
    kwargs = run.call_args.kwargs
    assert kwargs["dry_run"] is False
    assert kwargs["document_ids"] == ["a", "b"]
    assert kwargs["limit"] == 5


def test_celery_task_defaults_to_dry_run() -> None:
    with patch.object(realign, "run_realign") as run:
        run.return_value = {"summary": "long", "docs_scanned": 0}
        result = realign.realign_statutory_sections_task.run()
    assert run.call_args.kwargs["dry_run"] is True
    assert "summary" not in result
    assert realign.realign_statutory_sections_task.name == (
        "maintenance.realign_statutory_sections"
    )
