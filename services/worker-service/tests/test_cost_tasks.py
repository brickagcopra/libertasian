"""Tests for ``cost.recompute_ledger_amounts`` — the one-shot Celery task
that backfills ``budget_ledger.amount_usd`` for rows that recorded tokens
but no USD cost (Bug 10, 2324 prod rows on 2026-04-27).

Tests use a mock psycopg2 connection so the task runs without a real DB.
"""

from __future__ import annotations

import uuid
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from src.tasks.cost_tasks import recompute_ledger_amounts


@pytest.fixture()
def mock_psycopg2_connect() -> Any:
    """Patch ``psycopg2.connect`` so cost_tasks runs against an in-memory
    cursor that mimics keyset pagination."""
    with patch("src.clients.db_client.psycopg2.connect") as mock_connect:
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
        mock_conn.cursor.return_value.__exit__.return_value = False
        mock_connect.return_value = mock_conn
        yield mock_cursor


def _row(model: str | None, tokens_in: int, tokens_out: int) -> tuple:
    return (uuid.uuid4(), model, tokens_in, tokens_out)


class TestRecomputeLedgerAmounts:
    def test_recomputes_gpt_4o_mini_cost(
        self,
        mock_psycopg2_connect: MagicMock,
    ) -> None:
        """gpt-4o-mini @ 1500 in + 800 out → 0.000705 USD per row."""
        # First batch: one billable row. Second batch: empty (terminate).
        mock_psycopg2_connect.fetchall.side_effect = [
            [_row("gpt-4o-mini", 1500, 800)],
            [],
        ]

        result = recompute_ledger_amounts.run()

        assert result["scanned"] == 1
        assert result["updated"] == 1
        assert result["skipped_no_tokens"] == 0
        assert result["skipped_no_model"] == 0
        assert result["skipped_zero_cost"] == 0

        # The UPDATE went through executemany with the computed cost.
        executemany_calls = mock_psycopg2_connect.executemany.call_args_list
        assert len(executemany_calls) == 1
        sql, rows = executemany_calls[0].args
        assert "UPDATE budget_ledger" in sql
        assert len(rows) == 1
        cost, _row_id = rows[0]
        assert float(cost) == pytest.approx(0.000705, rel=1e-6)

    def test_skips_rows_with_no_tokens(
        self,
        mock_psycopg2_connect: MagicMock,
    ) -> None:
        """tokens_in=0 AND tokens_out=0 → no billing data, skip silently."""
        mock_psycopg2_connect.fetchall.side_effect = [
            [_row("gpt-4o-mini", 0, 0)],
            [],
        ]

        result = recompute_ledger_amounts.run()

        assert result["scanned"] == 1
        assert result["updated"] == 0
        assert result["skipped_no_tokens"] == 1
        mock_psycopg2_connect.executemany.assert_not_called()

    def test_skips_rows_with_null_model_name(
        self,
        mock_psycopg2_connect: MagicMock,
    ) -> None:
        """``model_name IS NULL`` → no pricing key, skip."""
        mock_psycopg2_connect.fetchall.side_effect = [
            [_row(None, 1000, 500)],
            [],
        ]

        result = recompute_ledger_amounts.run()

        assert result["scanned"] == 1
        assert result["updated"] == 0
        assert result["skipped_no_model"] == 1
        mock_psycopg2_connect.executemany.assert_not_called()

    def test_skips_unknown_model(
        self,
        mock_psycopg2_connect: MagicMock,
    ) -> None:
        """Unknown model → cost_for returns 0 + WARN once → skip."""
        mock_psycopg2_connect.fetchall.side_effect = [
            [_row("future-claude-99", 1000, 500)],
            [],
        ]

        result = recompute_ledger_amounts.run()

        assert result["scanned"] == 1
        assert result["updated"] == 0
        assert result["skipped_zero_cost"] == 1
        mock_psycopg2_connect.executemany.assert_not_called()

    def test_idempotent_second_run_is_noop(
        self,
        mock_psycopg2_connect: MagicMock,
    ) -> None:
        """A second run on a healed ledger updates 0 rows. The task only
        SELECTs rows where ``amount_usd = 0``; once we've UPDATEd them they
        no longer match the predicate. We simulate that by returning an
        empty fetch from the start."""
        mock_psycopg2_connect.fetchall.side_effect = [[]]

        result = recompute_ledger_amounts.run()

        assert result["scanned"] == 0
        assert result["updated"] == 0
        mock_psycopg2_connect.executemany.assert_not_called()

    def test_mixed_batch_partial_update(
        self,
        mock_psycopg2_connect: MagicMock,
    ) -> None:
        """Rows that are billable get UPDATEd; non-billable rows in the
        same batch are counted but not written."""
        mock_psycopg2_connect.fetchall.side_effect = [
            [
                _row("gpt-4o-mini", 1500, 800),
                _row(None, 100, 50),
                _row("gpt-4o-mini", 0, 0),
                _row("future-model-x", 200, 100),
                _row("claude-haiku-4-5", 1000, 500),
            ],
            [],
        ]

        result = recompute_ledger_amounts.run()

        assert result["scanned"] == 5
        assert result["updated"] == 2
        assert result["skipped_no_tokens"] == 1
        assert result["skipped_no_model"] == 1
        assert result["skipped_zero_cost"] == 1

    def test_uses_keyset_pagination_across_batches(
        self,
        mock_psycopg2_connect: MagicMock,
    ) -> None:
        """Batch 2 should reuse the last row id as a cursor (keyset
        pagination), so high-write loads can't double-process rows."""
        first_id = uuid.uuid4()
        second_id = uuid.uuid4()
        mock_psycopg2_connect.fetchall.side_effect = [
            [(first_id, "gpt-4o-mini", 1500, 800)],
            [(second_id, "gpt-4o-mini", 1500, 800)],
            [],
        ]

        recompute_ledger_amounts.run(batch_size=1)

        # 3 SELECTs total: initial, second batch with cursor, final empty.
        select_calls = [
            c for c in mock_psycopg2_connect.execute.call_args_list
            if "SELECT" in c.args[0]
        ]
        assert len(select_calls) == 3
        # Second SELECT must include the keyset filter.
        assert "id > %s" in select_calls[1].args[0]
        # Cursor parameter on second batch is the id from the first batch.
        assert select_calls[1].args[1][0] == str(first_id)
