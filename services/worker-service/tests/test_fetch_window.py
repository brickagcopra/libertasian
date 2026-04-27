"""Tests for the backfill fetch-window gate.

Pure unit tests on ``is_in_fetch_window`` (just clock arithmetic) plus
gate-application tests against ``_tick_single_batch`` and
``_run_incremental_crawl`` with the clock mocked at out-of-window
moments.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from src.backfill.fetch_window import is_in_fetch_window


def _utc(year: int, month: int, day: int, hour: int) -> datetime:
    return datetime(year, month, day, hour, 0, 0, tzinfo=UTC)


class TestIsInFetchWindow:
    """Default window 13:00–18:00 America/New_York. EDT (UTC-4) all year-
    around for simplicity; the test dates are in summer to avoid the DST
    boundary mucking with the offset assertion."""

    def test_in_window_at_window_start_local(self) -> None:
        # 13:00 EDT = 17:00 UTC during EDT.
        assert is_in_fetch_window(_utc(2026, 6, 1, 17)) is True

    def test_in_window_at_minute_before_window_end_local(self) -> None:
        # 17:59 EDT = 21:59 UTC. 17 < 18 → still in window.
        assert (
            is_in_fetch_window(
                datetime(2026, 6, 1, 21, 59, 0, tzinfo=UTC)
            )
            is True
        )

    def test_out_of_window_at_window_end_local(self) -> None:
        # 18:00 EDT = 22:00 UTC. End is exclusive.
        assert is_in_fetch_window(_utc(2026, 6, 1, 22)) is False

    def test_out_of_window_one_hour_before_start_local(self) -> None:
        # 12:00 EDT = 16:00 UTC.
        assert is_in_fetch_window(_utc(2026, 6, 1, 16)) is False

    def test_out_of_window_far_outside_local(self) -> None:
        # 09:00 EDT = 13:00 UTC.
        assert is_in_fetch_window(_utc(2026, 6, 1, 13)) is False


# ── Backfill tick gate ─────────────────────────────────────────────────


@pytest.fixture()
def mock_backfill_deps() -> Any:
    """Mock the DB client + Redis layer accessed inside _tick_single_batch."""
    with patch("src.tasks.backfill_tasks.backfill_db") as mock_db, \
         patch("src.tasks.backfill_tasks._get_redis_client") as mock_redis_factory:
        mock_db.update_batch_counters.return_value = None
        mock_db.transition_batch.return_value = None
        mock_db.update_checkpoint.return_value = None
        mock_db.get_batch_budget_remaining.return_value = None  # n/a out-of-window
        mock_redis = MagicMock()
        mock_redis_factory.return_value = mock_redis
        yield {"db": mock_db, "redis": mock_redis, "redis_factory": mock_redis_factory}


def test_tick_outside_window_noops_and_refreshes_last_tick_at(
    mock_backfill_deps: dict[str, MagicMock],
) -> None:
    from src.tasks.backfill_tasks import _tick_single_batch

    batch = {
        "id": "batch-1",
        "checkpoint_state": {
            "candidate_urls": ["u1", "u2", "u3"],
            "current_index": 0,
            "total_candidates": 3,
        },
        "last_tick_at": datetime.now(UTC) - timedelta(minutes=2),
        "status": "running",
    }

    # Force out-of-window. 12:00 EDT = 16:00 UTC.
    with patch(
        "src.tasks.backfill_tasks.is_in_fetch_window",
        return_value=False,
    ) as gate:
        result = _tick_single_batch(batch)

    assert result["status"] == "skipped_outside_fetch_window"
    assert result["batch_id"] == "batch-1"

    # last_tick_at refreshed (the watchdog uses this to decide stale-drain
    # reaping; we must NOT look idle just because we're sleeping).
    assert mock_backfill_deps["db"].update_batch_counters.call_count == 1
    call = mock_backfill_deps["db"].update_batch_counters.call_args
    assert call.args == ("batch-1",)
    assert "last_tick_at" in call.kwargs

    # Status not touched, cursor not advanced, budget not checked, inflight
    # not bumped.
    mock_backfill_deps["db"].transition_batch.assert_not_called()
    mock_backfill_deps["db"].update_checkpoint.assert_not_called()
    mock_backfill_deps["db"].get_batch_budget_remaining.assert_not_called()
    mock_backfill_deps["redis"].incrby.assert_not_called()
    gate.assert_called_once()


def test_tick_inside_window_proceeds_past_gate(
    mock_backfill_deps: dict[str, MagicMock],
) -> None:
    """Inside the window, the gate doesn't short-circuit; the existing
    cursor-completion / budget / dispatch logic runs."""
    from src.tasks.backfill_tasks import _tick_single_batch

    # All-candidates-processed shape — cursor at total, inflight at 0 →
    # transition_batch('completed') is called. We use that path because
    # it hits the post-gate code without needing the full dispatch fixture.
    batch = {
        "id": "batch-2",
        "checkpoint_state": {
            "candidate_urls": ["u1"],
            "current_index": 1,
            "total_candidates": 1,
        },
        "last_tick_at": datetime.now(UTC),
        "status": "running",
    }
    mock_backfill_deps["redis"].get.return_value = b"0"  # inflight=0

    with patch(
        "src.tasks.backfill_tasks.is_in_fetch_window",
        return_value=True,
    ):
        result = _tick_single_batch(batch)

    assert result["status"] == "completed"
    mock_backfill_deps["db"].transition_batch.assert_called_once()


# ── Daily-crawl gate ───────────────────────────────────────────────────


def test_daily_crawl_outside_window_returns_skipped() -> None:
    from src.tasks.daily_crawl_tasks import _run_incremental_crawl

    with patch("src.tasks.daily_crawl_tasks.settings") as mock_settings, \
         patch(
             "src.tasks.daily_crawl_tasks.is_in_fetch_window",
             return_value=False,
         ):
        mock_settings.crawl_daily_enabled = True

        result = _run_incremental_crawl("lawphil.net", "crawl.lawphil_test")

    assert result == {"skipped": True, "reason": "outside_fetch_window"}


def test_daily_crawl_disabled_short_circuits_before_window_check() -> None:
    """Disabled flag should win over the window gate — confirm the
    existing 'disabled' early-return is unaffected by the new gate."""
    from src.tasks.daily_crawl_tasks import _run_incremental_crawl

    with patch("src.tasks.daily_crawl_tasks.settings") as mock_settings, \
         patch("src.tasks.daily_crawl_tasks.is_in_fetch_window") as gate:
        mock_settings.crawl_daily_enabled = False

        result = _run_incremental_crawl("lawphil.net", "crawl.lawphil_test")

    assert result == {"skipped": True, "reason": "disabled"}
    gate.assert_not_called()


# ── Config validation ─────────────────────────────────────────────────


def test_config_rejects_start_geq_end() -> None:
    from src.config import Settings

    with pytest.raises(ValueError, match="strictly less than"):
        Settings(
            backfill_fetch_window_hour_start=18,
            backfill_fetch_window_hour_end=18,
        )

    with pytest.raises(ValueError, match="strictly less than"):
        Settings(
            backfill_fetch_window_hour_start=20,
            backfill_fetch_window_hour_end=10,
        )


def test_config_rejects_invalid_tz() -> None:
    from src.config import Settings

    with pytest.raises(ValueError, match="backfill_fetch_window_tz"):
        Settings(backfill_fetch_window_tz="Mars/Olympus_Mons")


def test_config_rejects_out_of_range_hour() -> None:
    from pydantic import ValidationError

    from src.config import Settings

    with pytest.raises(ValidationError):
        Settings(backfill_fetch_window_hour_start=24)

    with pytest.raises(ValidationError):
        Settings(backfill_fetch_window_hour_end=-1)
