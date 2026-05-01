"""Tests for ``tasks.dedup_backfill_published_documents``.

The task walks ``legal_documents`` checksum-duplicate groups and writes
one ``document_similarities`` + ``audit_logs`` row per non-canonical
duplicate. Tests cover the canonical pairing rule, idempotency on
re-runs, dry-run rollback, singleton skip, and audit-log fan-out.

External dependencies are mocked:
- ``get_read_connection`` (read replica DSN) — yields the duplicate groups
- ``psycopg2.connect`` (write DSN) — captures per-batch INSERTs in fake
  cursors so we can assert exact SQL / parameter shape without a live DB.
"""

from __future__ import annotations

from contextlib import contextmanager
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from .conftest import make_uuid

# ─── Fakes ─────────────────────────────────────────────────────────────


class _FakeWriteCursor:
    """Records every ``execute`` call and exposes a settable ``rowcount``.

    ``sim_rowcounts`` lets a test simulate the "row already exists" path
    of ``create_document_similarity_if_absent`` by returning ``0`` for a
    given INSERT-into-document_similarities call.
    """

    def __init__(self, sim_rowcounts: list[int] | None = None) -> None:
        self.executed: list[tuple[str, tuple[Any, ...] | None]] = []
        self._sim_rowcounts = list(sim_rowcounts) if sim_rowcounts else None
        self._sim_call_idx = 0
        self.rowcount = 0

    def execute(self, sql: str, params: tuple[Any, ...] | None = None) -> None:
        self.executed.append((sql, params))
        if "document_similarities" in sql:
            if self._sim_rowcounts is None:
                self.rowcount = 1
            else:
                self.rowcount = self._sim_rowcounts[self._sim_call_idx]
                self._sim_call_idx += 1
        else:
            self.rowcount = 1

    def __enter__(self) -> _FakeWriteCursor:
        return self

    def __exit__(self, *exc: Any) -> bool:
        return False

    def similarity_inserts(self) -> list[tuple[str, tuple[Any, ...] | None]]:
        return [
            (sql, params) for sql, params in self.executed
            if "document_similarities" in sql
        ]

    def audit_inserts(self) -> list[tuple[str, tuple[Any, ...] | None]]:
        return [
            (sql, params) for sql, params in self.executed
            if "audit_logs" in sql
        ]


class _FakeWriteConn:
    """Bare-minimum psycopg2 connection stand-in for the write path."""

    def __init__(self, cursor: _FakeWriteCursor) -> None:
        self._cursor = cursor
        self.committed = False
        self.rolled_back = False
        self.closed = False

    def cursor(self, cursor_factory: Any = None) -> _FakeWriteCursor:
        return self._cursor

    def commit(self) -> None:
        self.committed = True

    def rollback(self) -> None:
        self.rolled_back = True

    def close(self) -> None:
        self.closed = True


# ─── Fixtures ──────────────────────────────────────────────────────────


@pytest.fixture()
def fake_read_groups() -> Any:
    """Patch ``_fetch_duplicate_groups`` and ``get_read_connection`` so the
    task receives caller-supplied groups without touching the DB.
    """
    @contextmanager
    def _noop_read_conn() -> Any:
        yield MagicMock()

    with patch(
        "src.tasks.dedup_backfill_tasks.get_read_connection",
        _noop_read_conn,
    ), patch(
        "src.tasks.dedup_backfill_tasks._fetch_duplicate_groups",
    ) as mock_fetch:
        yield mock_fetch


@pytest.fixture()
def fake_write_conn() -> Any:
    """Patch ``psycopg2.connect`` inside the dedup backfill module so write
    transactions go to an in-memory recorder. The fixture yields a
    ``(conn, cursor_factory)`` pair where ``cursor_factory(rowcounts)``
    swaps in a cursor that returns the supplied rowcounts for similarity
    inserts (so callers can simulate the "already exists" path).
    """
    state: dict[str, Any] = {"conn": None, "cursor": None}

    def _make_cursor(sim_rowcounts: list[int] | None = None) -> _FakeWriteCursor:
        cur = _FakeWriteCursor(sim_rowcounts=sim_rowcounts)
        conn = _FakeWriteConn(cur)
        state["conn"] = conn
        state["cursor"] = cur
        return cur

    # Default cursor (always inserts) — most tests use this.
    _make_cursor()

    def _connect(_dsn: str) -> _FakeWriteConn:
        return state["conn"]

    with patch(
        "src.tasks.dedup_backfill_tasks.psycopg2.connect",
        side_effect=_connect,
    ):
        yield state, _make_cursor


# ─── Tests ─────────────────────────────────────────────────────────────


def test_writes_one_row_per_non_canonical(
    fake_read_groups: MagicMock,
    fake_write_conn: tuple[dict[str, Any], Any],
) -> None:
    """3 docs in one checksum group → 2 similarity rows (oldest is canonical)."""
    from src.tasks.dedup_backfill_tasks import dedup_backfill_published_documents

    state, _ = fake_write_conn
    canonical_id = make_uuid()
    dup_a = make_uuid()
    dup_b = make_uuid()
    fake_read_groups.return_value = [
        {
            "checksum": "deadbeef",
            "canonical_created": "2024-01-01T00:00:00Z",
            "ids": [canonical_id, dup_a, dup_b],
        },
    ]

    result = dedup_backfill_published_documents()

    assert result["groups"] == 1
    assert result["pairs_planned"] == 2
    assert result["similarities_written"] == 2
    assert result["audits_written"] == 2
    assert result["dry_run"] is False

    cursor: _FakeWriteCursor = state["cursor"]
    sim_calls = cursor.similarity_inserts()
    assert len(sim_calls) == 2
    # Each insert: document_a_id is canonical, document_b_id is the duplicate.
    pairs_in_sql = [(p[1], p[2]) for _, p in sim_calls]
    assert pairs_in_sql == [(canonical_id, dup_a), (canonical_id, dup_b)]
    # Confirm the canonical_document_id column carries the canonical id too.
    canonical_col_values = [p[9] for _, p in sim_calls]
    assert canonical_col_values == [canonical_id, canonical_id]
    assert state["conn"].committed is True
    assert state["conn"].rolled_back is False


def test_skips_existing_pair(
    fake_read_groups: MagicMock,
    fake_write_conn: tuple[dict[str, Any], Any],
) -> None:
    """Re-run idempotency: if every similarity INSERT hits an existing
    pair (rowcount=0), zero new rows are written and zero audit logs fire.
    """
    from src.tasks.dedup_backfill_tasks import dedup_backfill_published_documents

    state, make_cursor = fake_write_conn
    canonical_id = make_uuid()
    dup_a = make_uuid()
    dup_b = make_uuid()
    # Both similarity inserts collide → rowcount=0 from WHERE NOT EXISTS.
    make_cursor(sim_rowcounts=[0, 0])

    fake_read_groups.return_value = [
        {
            "checksum": "deadbeef",
            "canonical_created": "2024-01-01T00:00:00Z",
            "ids": [canonical_id, dup_a, dup_b],
        },
    ]

    result = dedup_backfill_published_documents()

    assert result["pairs_planned"] == 2
    assert result["similarities_written"] == 0
    assert result["audits_written"] == 0

    cursor: _FakeWriteCursor = state["cursor"]
    # The similarity INSERT was attempted twice, but no audit row followed.
    assert len(cursor.similarity_inserts()) == 2
    assert cursor.audit_inserts() == []


def test_dry_run_writes_nothing(
    fake_read_groups: MagicMock,
    fake_write_conn: tuple[dict[str, Any], Any],
) -> None:
    """``dry_run=True`` rolls back every per-batch transaction; reported
    counts reflect what *would* have been written for sizing purposes.
    """
    from src.tasks.dedup_backfill_tasks import dedup_backfill_published_documents

    state, _ = fake_write_conn
    fake_read_groups.return_value = [
        {
            "checksum": "deadbeef",
            "canonical_created": "2024-01-01T00:00:00Z",
            "ids": [make_uuid(), make_uuid(), make_uuid()],
        },
    ]

    result = dedup_backfill_published_documents(dry_run=True)

    assert result["dry_run"] is True
    assert result["pairs_planned"] == 2
    # Counts reflect what would have been written.
    assert result["similarities_written"] == 2
    assert result["audits_written"] == 2
    # But no commit happened.
    assert state["conn"].committed is False
    assert state["conn"].rolled_back is True


def test_ignores_singletons(
    fake_read_groups: MagicMock,
    fake_write_conn: tuple[dict[str, Any], Any],
) -> None:
    """A defensive ``len(ids) < 2`` guard skips groups with only one id —
    even though the SQL ``HAVING COUNT(*) > 1`` already filters them out
    upstream, the runtime check protects against future query changes.
    """
    from src.tasks.dedup_backfill_tasks import dedup_backfill_published_documents

    state, _ = fake_write_conn
    fake_read_groups.return_value = [
        {
            "checksum": "lonely",
            "canonical_created": "2024-01-01T00:00:00Z",
            "ids": [make_uuid()],
        },
    ]

    result = dedup_backfill_published_documents()

    assert result["groups"] == 1
    assert result["pairs_planned"] == 0
    assert result["similarities_written"] == 0
    assert result["audits_written"] == 0
    assert result["batches"] == 0

    cursor: _FakeWriteCursor = state["cursor"]
    assert cursor.executed == []  # no write-side activity at all
    # No batch ran → connection was never opened / committed.
    assert state["conn"].committed is False


def test_audit_log_per_pair(
    fake_read_groups: MagicMock,
    fake_write_conn: tuple[dict[str, Any], Any],
) -> None:
    """N non-canonical pairs across multiple groups → N audit_log rows,
    each tagged with action='document.dedup_backfilled' and the duplicate
    id as entity_id.
    """
    from src.tasks.dedup_backfill_tasks import dedup_backfill_published_documents

    state, _ = fake_write_conn
    g1_canonical = make_uuid()
    g1_dups = [make_uuid(), make_uuid()]
    g2_canonical = make_uuid()
    g2_dups = [make_uuid(), make_uuid(), make_uuid()]
    fake_read_groups.return_value = [
        {
            "checksum": "g1",
            "canonical_created": "2024-01-01T00:00:00Z",
            "ids": [g1_canonical, *g1_dups],
        },
        {
            "checksum": "g2",
            "canonical_created": "2024-02-01T00:00:00Z",
            "ids": [g2_canonical, *g2_dups],
        },
    ]

    result = dedup_backfill_published_documents()

    assert result["pairs_planned"] == 5
    assert result["similarities_written"] == 5
    assert result["audits_written"] == 5

    cursor: _FakeWriteCursor = state["cursor"]
    audit_calls = cursor.audit_inserts()
    assert len(audit_calls) == 5
    # actor_type='system', action='document.dedup_backfilled',
    # entity_type='legal_document', entity_id=duplicate id.
    actions = {p[3] for _, p in audit_calls}
    entity_types = {p[4] for _, p in audit_calls}
    entity_ids = [p[5] for _, p in audit_calls]
    assert actions == {"document.dedup_backfilled"}
    assert entity_types == {"legal_document"}
    assert entity_ids == [*g1_dups, *g2_dups]
