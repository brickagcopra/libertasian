"""Tests for backfill_db_client — database operations for backfill engine.

Covers:
16. transition_batch — succeeds for valid transition
17. transition_batch — returns False for invalid transition
18. update_checkpoint — writes both checkpoint_state and checkpoint row
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any
from unittest.mock import MagicMock, patch

from src.clients import backfill_db_client as backfill_db

# ─── Helpers ─────────────────────────────────────────────────────────────


def _make_mock_conn(
    fetchone_value: Any = None,
    fetchall_value: Any = None,
    rowcount: int = 1,
) -> MagicMock:
    """Create a mock connection + cursor for get_connection() context manager."""
    mock_cursor = MagicMock()
    mock_cursor.fetchone.return_value = fetchone_value
    mock_cursor.fetchall.return_value = fetchall_value or []
    mock_cursor.rowcount = rowcount
    mock_cursor.__enter__ = MagicMock(return_value=mock_cursor)
    mock_cursor.__exit__ = MagicMock(return_value=False)

    mock_conn = MagicMock()
    mock_conn.cursor.return_value = mock_cursor
    mock_conn.__enter__ = MagicMock(return_value=mock_conn)
    mock_conn.__exit__ = MagicMock(return_value=False)

    return mock_conn


# ─── Test 16: transition_batch — valid transition ────────────────────────


class TestTransitionBatch:
    @patch("src.clients.backfill_db_client.get_connection")
    def test_valid_transition_succeeds(self, mock_get_conn: MagicMock) -> None:
        """transition_batch returns True when the DB update matches a row."""
        mock_conn = _make_mock_conn(rowcount=1)
        mock_get_conn.return_value = mock_conn

        result = backfill_db.transition_batch("batch-1", "enumerating")

        assert result is True
        # Verify the SQL was called with the batch_id and allowed_from statuses
        cursor = mock_conn.cursor.return_value
        cursor.__enter__.return_value.execute.assert_called_once()
        sql, params = cursor.__enter__.return_value.execute.call_args[0]
        assert "UPDATE backfill_batches" in sql
        assert "batch-1" in params
        assert "enumerating" in params

    # ─── Test 17: transition_batch — invalid transition ──────────────────

    @patch("src.clients.backfill_db_client.get_connection")
    def test_invalid_transition_returns_false(self, mock_get_conn: MagicMock) -> None:
        """transition_batch returns False when no valid from-status exists."""
        # 'completed' is not a valid target from any status in VALID_TRANSITIONS
        result = backfill_db.transition_batch("batch-1", "pending")

        # Should return False without even hitting the DB
        assert result is False
        mock_get_conn.assert_not_called()

    @patch("src.clients.backfill_db_client.get_connection")
    def test_transition_with_extra_fields(self, mock_get_conn: MagicMock) -> None:
        """transition_batch includes extra fields in the SET clause."""
        mock_conn = _make_mock_conn(rowcount=1)
        mock_get_conn.return_value = mock_conn

        from datetime import UTC, datetime

        now = datetime.now(UTC)
        result = backfill_db.transition_batch(
            "batch-1",
            "running",
            started_at=now,
            admin_notes="Starting backfill",
        )

        assert result is True
        cursor = mock_conn.cursor.return_value
        sql, params = cursor.__enter__.return_value.execute.call_args[0]
        assert "started_at" in sql
        assert "admin_notes" in sql
        assert now in params

    @patch("src.clients.backfill_db_client.get_connection")
    def test_transition_fails_when_no_row_matched(
        self, mock_get_conn: MagicMock,
    ) -> None:
        """transition_batch returns False when WHERE clause matches 0 rows."""
        mock_conn = _make_mock_conn(rowcount=0)
        mock_get_conn.return_value = mock_conn

        result = backfill_db.transition_batch("batch-1", "running")

        assert result is False


# ─── Test 18: update_checkpoint ──────────────────────────────────────────


class TestUpdateCheckpoint:
    @patch("src.clients.backfill_db_client.get_connection")
    def test_writes_both_batch_and_checkpoint_row(
        self, mock_get_conn: MagicMock,
    ) -> None:
        """update_checkpoint writes to backfill_batches AND backfill_checkpoints."""
        mock_conn = _make_mock_conn()
        mock_get_conn.return_value = mock_conn

        checkpoint_state = {"current_index": 5, "total_candidates": 100}
        backfill_db.update_checkpoint("batch-1", checkpoint_state, 5)

        cursor = mock_conn.cursor.return_value.__enter__.return_value
        assert cursor.execute.call_count == 2

        # First call: UPDATE backfill_batches
        first_sql = cursor.execute.call_args_list[0][0][0]
        assert "UPDATE backfill_batches" in first_sql
        assert "checkpoint_state" in first_sql

        # Second call: INSERT INTO backfill_checkpoints
        second_sql = cursor.execute.call_args_list[1][0][0]
        assert "INSERT INTO backfill_checkpoints" in second_sql
        assert "cursor_json" in second_sql


# ─── Test: get_batch_budget_remaining ────────────────────────────────────


class TestGetBatchBudgetRemaining:
    @patch("src.clients.backfill_db_client.get_connection")
    def test_returns_remaining_budget(
        self, mock_get_conn: MagicMock,
    ) -> None:
        """get_batch_budget_remaining returns ceiling - consumed."""
        mock_conn = _make_mock_conn(fetchone_value=(Decimal("100.00"), Decimal("35.50")))
        mock_get_conn.return_value = mock_conn

        remaining = backfill_db.get_batch_budget_remaining("batch-1")

        assert remaining == Decimal("64.50")

    @patch("src.clients.backfill_db_client.get_connection")
    def test_returns_zero_when_batch_not_found(
        self, mock_get_conn: MagicMock,
    ) -> None:
        """get_batch_budget_remaining returns 0 when batch doesn't exist."""
        mock_conn = _make_mock_conn(fetchone_value=None)
        mock_get_conn.return_value = mock_conn

        remaining = backfill_db.get_batch_budget_remaining("nonexistent")

        assert remaining == Decimal("0")


# ─── budget_consumed_usd telemetry ───────────────────────────────────────


class TestUpdateBatchCountersBudgetConsumed:
    @patch("src.clients.backfill_db_client.get_connection")
    def test_increments_budget_consumed_usd(
        self, mock_get_conn: MagicMock,
    ) -> None:
        """update_batch_counters with budget_consumed_usd increments NUMERIC.

        The SQL must use COALESCE + Decimal-cast so per-call LLM costs
        accumulate cleanly. Crucially, budget_consumed_usd must NOT touch
        the int candidates_* / documents_* counters.
        """
        mock_conn = _make_mock_conn(rowcount=1)
        mock_get_conn.return_value = mock_conn

        backfill_db.update_batch_counters(
            "batch-1", budget_consumed_usd=Decimal("0.0042"),
        )

        cursor = mock_conn.cursor.return_value.__enter__.return_value
        cursor.execute.assert_called_once()
        sql, params = cursor.execute.call_args[0]

        # NUMERIC increment, parameterized — no string interpolation, no ::int.
        assert (
            "budget_consumed_usd = COALESCE(budget_consumed_usd, 0) + %s::numeric"
            in sql
        )
        # Integer counter columns must not appear in the SET clause.
        assert "candidates_processed" not in sql
        assert "candidates_failed" not in sql
        assert "documents_created" not in sql
        # The Decimal value flows through as a parameter, not via interpolation.
        assert Decimal("0.0042") in params
        assert "batch-1" in params

    @patch("src.clients.backfill_db_client.get_connection")
    def test_accepts_float_and_str_inputs(
        self, mock_get_conn: MagicMock,
    ) -> None:
        """Float/str inputs are cast to Decimal so callers can pass either.

        ``cost_for`` returns Decimal, but defensively typed callers may pass
        floats. The cast prevents binary float drift in the persisted total.
        """
        mock_conn = _make_mock_conn(rowcount=1)
        mock_get_conn.return_value = mock_conn

        backfill_db.update_batch_counters(
            "batch-1", budget_consumed_usd=0.0042,
        )

        cursor = mock_conn.cursor.return_value.__enter__.return_value
        _, params = cursor.execute.call_args[0]
        # Cast happened — Decimal in params, not raw float.
        assert any(isinstance(p, Decimal) for p in params)
