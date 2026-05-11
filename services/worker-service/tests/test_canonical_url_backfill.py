"""Tests for ``tasks.canonical_url_backfill_published_documents``.

This is the v2 dedup backfill: same canonical_url + different checksum →
``document_similarities`` row with ``status='pending'`` (NEVER
auto_dismissed). Tests cover pair detection (same-checksum siblings within
a URL group are skipped), idempotency on re-runs, the 500-pair hard cap,
and the dry-run rollback path.

External dependencies are mocked the same way the v1 backfill tests do —
``get_read_connection`` yields canned groups and ``psycopg2.connect``
captures writes in a fake cursor.
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

    ``sim_rowcounts`` simulates ``create_document_similarity_if_absent``'s
    "row already exists" path: returning ``0`` for the matching INSERT.
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
            (sql, params)
            for sql, params in self.executed
            if "document_similarities" in sql
        ]

    def audit_inserts(self) -> list[tuple[str, tuple[Any, ...] | None]]:
        return [
            (sql, params)
            for sql, params in self.executed
            if "audit_logs" in sql
        ]


class _FakeWriteConn:
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
    @contextmanager
    def _noop_read_conn() -> Any:
        yield MagicMock()

    with patch(
        "src.tasks.canonical_url_backfill_tasks.get_read_connection",
        _noop_read_conn,
    ), patch(
        "src.tasks.canonical_url_backfill_tasks."
        "_fetch_canonical_url_collision_groups",
    ) as mock_fetch:
        yield mock_fetch


@pytest.fixture()
def fake_write_conn() -> Any:
    state: dict[str, Any] = {"conn": None, "cursor": None}

    def _make_cursor(sim_rowcounts: list[int] | None = None) -> _FakeWriteCursor:
        cur = _FakeWriteCursor(sim_rowcounts=sim_rowcounts)
        conn = _FakeWriteConn(cur)
        state["conn"] = conn
        state["cursor"] = cur
        return cur

    # Default cursor: every insert succeeds.
    _make_cursor()

    def _connect(_dsn: str) -> _FakeWriteConn:
        return state["conn"]

    with patch(
        "src.tasks.canonical_url_backfill_tasks.psycopg2.connect",
        side_effect=_connect,
    ):
        yield state, _make_cursor


# ─── Pair detection ────────────────────────────────────────────────────


def test_pair_detection_skips_same_checksum_siblings(
    fake_read_groups: MagicMock,
    fake_write_conn: tuple[dict[str, Any], Any],
) -> None:
    """A URL group with 3 docs — one shares the canonical's checksum, one
    differs. Only the differing pair becomes a similarity row; the
    same-checksum sibling is left to v1's exact-duplicate backfill.
    """
    from src.tasks.canonical_url_backfill_tasks import (
        canonical_url_backfill_published_documents,
    )

    state, _ = fake_write_conn
    canonical = make_uuid()
    same_checksum_dup = make_uuid()
    diff_checksum_dup = make_uuid()

    fake_read_groups.return_value = [
        {
            "canonical_url": "https://lawphil.net/x.html",
            "ids": [canonical, same_checksum_dup, diff_checksum_dup],
            "checksums": ["abc", "abc", "def"],
        },
    ]

    result = canonical_url_backfill_published_documents()

    # 3 docs in the group, but only one pair has different checksums.
    assert result["groups"] == 1
    assert result["pairs_planned"] == 1
    assert result["pairs_capped"] == 0
    assert result["similarities_written"] == 1
    assert result["audits_written"] == 1
    assert result["dry_run"] is False

    cursor: _FakeWriteCursor = state["cursor"]
    sim_calls = cursor.similarity_inserts()
    assert len(sim_calls) == 1
    # The single inserted pair is (canonical, diff_checksum_dup).
    pair_in_sql = (sim_calls[0][1][1], sim_calls[0][1][2])
    assert pair_in_sql == (canonical, diff_checksum_dup)

    # status='pending' is the 6th positional parameter on the INSERT.
    inserted_status = sim_calls[0][1][5]
    assert inserted_status == "pending"
    # similarity_type='canonical_url_match' is the 5th positional parameter.
    inserted_type = sim_calls[0][1][4]
    assert inserted_type == "canonical_url_match"


def test_no_groups_writes_nothing(
    fake_read_groups: MagicMock,
    fake_write_conn: tuple[dict[str, Any], Any],
) -> None:
    """Clean state — no canonical_url collisions found. Task short-circuits
    without opening a write connection.
    """
    from src.tasks.canonical_url_backfill_tasks import (
        canonical_url_backfill_published_documents,
    )

    state, _ = fake_write_conn
    fake_read_groups.return_value = []

    result = canonical_url_backfill_published_documents()

    assert result["groups"] == 0
    assert result["pairs_planned"] == 0
    assert result["similarities_written"] == 0
    assert result["batches"] == 0

    cursor: _FakeWriteCursor = state["cursor"]
    assert cursor.executed == []
    assert state["conn"].committed is False


# ─── Idempotency ───────────────────────────────────────────────────────


def test_idempotent_on_existing_pair(
    fake_read_groups: MagicMock,
    fake_write_conn: tuple[dict[str, Any], Any],
) -> None:
    """Re-run safety: when the INSERT ... WHERE NOT EXISTS clause matches a
    pair already in document_similarities, rowcount=0 → no audit row fires
    and the summary reports zero writes. Future invocations of the task
    only add previously-unseen pairs.
    """
    from src.tasks.canonical_url_backfill_tasks import (
        canonical_url_backfill_published_documents,
    )

    state, make_cursor = fake_write_conn
    canonical = make_uuid()
    dup = make_uuid()

    # Force the lone similarity INSERT to return rowcount=0 (already exists).
    make_cursor(sim_rowcounts=[0])

    fake_read_groups.return_value = [
        {
            "canonical_url": "https://example.com/case",
            "ids": [canonical, dup],
            "checksums": ["abc", "def"],
        },
    ]

    result = canonical_url_backfill_published_documents()

    assert result["pairs_planned"] == 1
    assert result["similarities_written"] == 0
    assert result["audits_written"] == 0

    cursor: _FakeWriteCursor = state["cursor"]
    # The similarity INSERT was attempted, but no audit row followed it.
    assert len(cursor.similarity_inserts()) == 1
    assert cursor.audit_inserts() == []


# ─── 500-pair cap ──────────────────────────────────────────────────────


def test_pairs_cap_is_500(
    fake_read_groups: MagicMock,
    fake_write_conn: tuple[dict[str, Any], Any],
) -> None:
    """A run that finds 700 collision pairs must trim to 500 and report
    pairs_capped=200. The cap protects reviewers from a sudden flood on
    first run — re-dispatching drains the rest.
    """
    from src.tasks.canonical_url_backfill_tasks import (
        MAX_PAIRS_PER_DISPATCH,
        canonical_url_backfill_published_documents,
    )

    assert MAX_PAIRS_PER_DISPATCH == 500

    state, _ = fake_write_conn
    # Build 700 single-pair groups (canonical + one differing-checksum dup).
    groups = []
    for i in range(700):
        canonical = make_uuid()
        dup = make_uuid()
        groups.append({
            "canonical_url": f"https://example.com/doc-{i}",
            "ids": [canonical, dup],
            "checksums": ["aaa", "bbb"],
        })
    fake_read_groups.return_value = groups

    result = canonical_url_backfill_published_documents(batch_size=100)

    assert result["groups"] == 700
    assert result["pairs_planned"] == 500
    assert result["pairs_capped"] == 200
    assert result["similarities_written"] == 500
    assert result["audits_written"] == 500
    # 500 pairs / batch_size 100 = 5 batches.
    assert result["batches"] == 5

    cursor: _FakeWriteCursor = state["cursor"]
    assert len(cursor.similarity_inserts()) == 500


def test_below_cap_does_not_trim(
    fake_read_groups: MagicMock,
    fake_write_conn: tuple[dict[str, Any], Any],
) -> None:
    """Below the cap, pairs_capped stays 0 and every pair is written."""
    from src.tasks.canonical_url_backfill_tasks import (
        canonical_url_backfill_published_documents,
    )

    groups = []
    for i in range(5):
        groups.append({
            "canonical_url": f"https://example.com/doc-{i}",
            "ids": [make_uuid(), make_uuid()],
            "checksums": ["aaa", "bbb"],
        })
    fake_read_groups.return_value = groups

    result = canonical_url_backfill_published_documents()

    assert result["pairs_capped"] == 0
    assert result["pairs_planned"] == 5
    assert result["similarities_written"] == 5


# ─── Dry run ───────────────────────────────────────────────────────────


def test_dry_run_writes_nothing(
    fake_read_groups: MagicMock,
    fake_write_conn: tuple[dict[str, Any], Any],
) -> None:
    """dry_run=True still executes SQL (so counters are accurate for sizing)
    but rolls back every batch — no row is persisted.
    """
    from src.tasks.canonical_url_backfill_tasks import (
        canonical_url_backfill_published_documents,
    )

    state, _ = fake_write_conn
    fake_read_groups.return_value = [
        {
            "canonical_url": "https://example.com/x",
            "ids": [make_uuid(), make_uuid()],
            "checksums": ["a", "b"],
        },
    ]

    result = canonical_url_backfill_published_documents(dry_run=True)

    assert result["dry_run"] is True
    assert result["pairs_planned"] == 1
    assert result["similarities_written"] == 1  # counter reflects would-write
    assert state["conn"].committed is False
    assert state["conn"].rolled_back is True


# ─── Evidence + audit shape ────────────────────────────────────────────


def test_audit_log_action_and_entity(
    fake_read_groups: MagicMock,
    fake_write_conn: tuple[dict[str, Any], Any],
) -> None:
    """Audit row carries action='document.canonical_url_backfilled' and the
    duplicate id as entity_id (matching v1 backfill convention)."""
    from src.tasks.canonical_url_backfill_tasks import (
        canonical_url_backfill_published_documents,
    )

    state, _ = fake_write_conn
    canonical = make_uuid()
    dup = make_uuid()
    fake_read_groups.return_value = [
        {
            "canonical_url": "https://example.com/x",
            "ids": [canonical, dup],
            "checksums": ["a", "b"],
        },
    ]

    canonical_url_backfill_published_documents()

    cursor: _FakeWriteCursor = state["cursor"]
    audit_calls = cursor.audit_inserts()
    assert len(audit_calls) == 1
    # Audit row positional params:
    # (id, actor_user_id, actor_type, action, entity_type, entity_id, metadata).
    params = audit_calls[0][1]
    assert params is not None
    assert params[2] == "system"
    assert params[3] == "document.canonical_url_backfilled"
    assert params[4] == "legal_document"
    assert params[5] == dup
