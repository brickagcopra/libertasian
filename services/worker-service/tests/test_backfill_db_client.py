"""Tests for backfill_db_client — database operations for backfill engine.

Covers:
16. transition_batch — succeeds for valid transition
17. transition_batch — returns False for invalid transition
18. update_checkpoint — writes both checkpoint_state and checkpoint row
19. create_backfill_ingestion_job — creates job with correct trigger_type
20. get_inflight_jobs_count — counts pending + running jobs
"""

from __future__ import annotations

import json
import uuid
from decimal import Decimal
from typing import Any
from unittest.mock import MagicMock, call, patch

import pytest

from src.clients import backfill_db_client as backfill_db


def make_uuid() -> str:
    return str(uuid.uuid4())


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


# ─── Test 19: create_backfill_ingestion_job ──────────────────────────────


class TestCreateBackfillIngestionJob:
    @patch("src.clients.backfill_db_client.get_connection")
    def test_creates_job_with_correct_trigger_type(
        self, mock_get_conn: MagicMock,
    ) -> None:
        """create_backfill_ingestion_job creates a job with trigger_type='backfill'."""
        mock_conn = _make_mock_conn()
        mock_get_conn.return_value = mock_conn

        batch_id = make_uuid()
        source_id = make_uuid()
        user_id = make_uuid()

        job_id = backfill_db.create_backfill_ingestion_job(
            source_id=source_id,
            source_endpoint_id=None,
            backfill_batch_id=batch_id,
            triggered_by_user_id=user_id,
        )

        assert job_id  # non-empty UUID string
        cursor = mock_conn.cursor.return_value.__enter__.return_value
        sql, params = cursor.execute.call_args[0]
        assert "INSERT INTO ingestion_jobs" in sql
        assert "'backfill'" in sql
        assert batch_id in params
        assert user_id in params


# ─── Test 20: get_inflight_jobs_count ────────────────────────────────────


class TestGetInflightJobsCount:
    @patch("src.clients.backfill_db_client.get_connection")
    def test_counts_pending_and_running_jobs(
        self, mock_get_conn: MagicMock,
    ) -> None:
        """get_inflight_jobs_count returns count of pending + running jobs."""
        mock_conn = _make_mock_conn(fetchone_value=(3,))
        mock_get_conn.return_value = mock_conn

        count = backfill_db.get_inflight_jobs_count("batch-1")

        assert count == 3
        cursor = mock_conn.cursor.return_value.__enter__.return_value
        sql, params = cursor.execute.call_args[0]
        assert "COUNT(*)" in sql
        assert "backfill_batch_id" in sql
        assert "'pending'" in sql
        assert "'running'" in sql

    @patch("src.clients.backfill_db_client.get_connection")
    def test_returns_zero_when_no_jobs(
        self, mock_get_conn: MagicMock,
    ) -> None:
        """get_inflight_jobs_count returns 0 when fetchone returns (0,)."""
        mock_conn = _make_mock_conn(fetchone_value=(0,))
        mock_get_conn.return_value = mock_conn

        count = backfill_db.get_inflight_jobs_count("batch-1")

        assert count == 0


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
