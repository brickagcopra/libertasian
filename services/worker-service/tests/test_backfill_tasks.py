"""Tests for backfill engine Celery tasks.

Covers:
1-5: enumerate_backfill_candidates (happy path, month boundaries,
     checkpoint storage, status transition, error handling)
6-8: _build_lawphil_monthly_urls (single year, multi-year, month boundaries)
9-13: run_backfill_batch_tick (create jobs, completed, halted_budget,
      inflight wait, skip non-running)
14-15: check_backfill_budgets (halt on global budget, no-op when fine)
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from src.fetchers.base import CloudflareBlockedError
from src.tasks.backfill_tasks import (
    MONTHLY_URL_BUILDERS,
    _build_lawphil_monthly_urls,
    _build_scel_monthly_urls,
    check_backfill_budgets,
    enumerate_backfill_candidates,
    run_backfill_batch_tick,
)


def make_uuid() -> str:
    return str(uuid.uuid4())


# ─── Fixtures ────────────────────────────────────────────────────────────


@pytest.fixture()
def batch_id() -> str:
    return make_uuid()


@pytest.fixture()
def source_id() -> str:
    return make_uuid()


@pytest.fixture()
def user_id() -> str:
    return make_uuid()


@pytest.fixture()
def sample_batch(batch_id: str, source_id: str, user_id: str) -> dict[str, Any]:
    return {
        "id": batch_id,
        "source_id": source_id,
        "source_endpoint_id": make_uuid(),
        "name": "LawPhil 2023 Backfill",
        "year_start": 2023,
        "year_end": 2023,
        "month_start": 1,
        "month_end": 3,
        "status": "enumerating",
        "budget_ceiling_usd": Decimal("100.00"),
        "budget_consumed_usd": Decimal("0.00"),
        "candidates_discovered": 0,
        "candidates_processed": 0,
        "candidates_skipped": 0,
        "candidates_failed": 0,
        "documents_created": 0,
        "documents_updated": 0,
        "inflight_cap": 5,
        "checkpoint_state": None,
        "started_at": None,
        "finished_at": None,
        "last_tick_at": None,
        "created_by_user_id": user_id,
        "created_at": datetime.now(UTC),
        "updated_at": datetime.now(UTC),
    }


@pytest.fixture()
def sample_source(source_id: str) -> dict[str, Any]:
    return {
        "id": source_id,
        "name": "LawPhil",
        "type": "semi-official",
        "domain": "lawphil.net",
        "trust_level": "medium",
        "enabled": True,
        "fetch_strategy": "crawler",
        "endpoints": [
            {
                "id": make_uuid(),
                "endpoint_url": "https://lawphil.net/judjuris/juri2023/jan2023/jan2023.html",
                "parser_type": "lawphil",
                "status": "active",
            },
        ],
    }


@pytest.fixture()
def mock_backfill_db() -> MagicMock:
    """Mock the backfill DB client used by backfill tasks."""
    with patch("src.tasks.backfill_tasks.backfill_db") as mock_db:
        mock_db.get_batch.return_value = None
        mock_db.get_batches_by_status.return_value = []
        mock_db.transition_batch.return_value = True
        mock_db.update_batch_counters.return_value = None
        mock_db.update_checkpoint.return_value = None
        mock_db.get_batch_budget_remaining.return_value = Decimal("100.00")
        mock_db.get_stuck_enumerating_batches.return_value = []
        yield mock_db


@pytest.fixture()
def mock_ingestion_db_for_backfill(source_id: str) -> MagicMock:
    """Mock the ingestion DB client used by backfill tasks.

    Tick now reads the source + endpoints to resolve parser_type and
    dedups candidates via similarity_key. Defaults below cover both.
    """
    with patch("src.tasks.backfill_tasks.ingestion_db") as mock_db:
        mock_db.get_source_with_endpoints.return_value = {
            "id": source_id,
            "endpoints": [{"parser_type": "lawphil"}],
        }
        mock_db.find_candidate_by_similarity_key.return_value = None
        mock_db.create_ingestion_candidate.side_effect = (
            lambda **kwargs: make_uuid()
        )
        yield mock_db


@pytest.fixture()
def mock_tick_redis() -> MagicMock:
    """Mock the Redis client used by tick for inflight counter ops."""
    mock_redis = MagicMock()
    mock_redis.get.return_value = None  # inflight = 0 by default
    mock_redis.incrby.return_value = 1
    mock_redis.decr.return_value = 0
    mock_redis.delete.return_value = 1
    mock_redis.set.return_value = True
    with patch(
        "src.tasks.backfill_tasks._get_redis_client", return_value=mock_redis,
    ):
        yield mock_redis


@pytest.fixture()
def mock_fetcher() -> MagicMock:
    """Mock fetcher returned by get_fetcher."""
    mock = MagicMock()
    mock.discover.return_value = []
    return mock


# ─── Tests 6-8: _build_lawphil_monthly_urls ──────────────────────────────


class TestBuildLawphilMonthlyUrls:
    def test_single_year_all_months(self) -> None:
        """Test 6: generates 12 URLs for a single year without month bounds."""
        urls = _build_lawphil_monthly_urls(2023, 2023)

        assert len(urls) == 12
        assert urls[0]["url"] == "https://lawphil.net/judjuris/juri2023/jan2023/jan2023.html"
        assert urls[0]["year"] == 2023
        assert urls[0]["month"] == 1
        assert urls[11]["url"] == "https://lawphil.net/judjuris/juri2023/dec2023/dec2023.html"
        assert urls[11]["month"] == 12

    def test_multi_year_range(self) -> None:
        """Test 7: generates correct URLs for multi-year range."""
        urls = _build_lawphil_monthly_urls(2022, 2023)

        assert len(urls) == 24  # 12 months x 2 years
        # First URL: Jan 2022
        assert urls[0]["year"] == 2022
        assert urls[0]["month"] == 1
        # Last URL: Dec 2023
        assert urls[-1]["year"] == 2023
        assert urls[-1]["month"] == 12

    def test_respects_month_boundaries(self) -> None:
        """Test 8: respects month_start and month_end."""
        urls = _build_lawphil_monthly_urls(2023, 2023, month_start=3, month_end=6)

        assert len(urls) == 4  # Mar, Apr, May, Jun
        assert urls[0]["month"] == 3
        assert urls[0]["url"] == "https://lawphil.net/judjuris/juri2023/mar2023/mar2023.html"
        assert urls[-1]["month"] == 6
        assert urls[-1]["url"] == "https://lawphil.net/judjuris/juri2023/jun2023/jun2023.html"

    def test_multi_year_with_month_boundaries(self) -> None:
        """Month boundaries apply only to start/end years, middle years get all 12."""
        urls = _build_lawphil_monthly_urls(2021, 2023, month_start=6, month_end=3)

        # 2021: Jun-Dec (7 months), 2022: Jan-Dec (12 months), 2023: Jan-Mar (3 months)
        assert len(urls) == 22
        assert urls[0]["year"] == 2021
        assert urls[0]["month"] == 6
        assert urls[-1]["year"] == 2023
        assert urls[-1]["month"] == 3


class TestBuildScelMonthlyUrls:
    def test_single_year_all_months(self) -> None:
        """SCEL URLs use title-cased month code + /1 category suffix."""
        urls = _build_scel_monthly_urls(2023, 2023)

        assert len(urls) == 12
        assert urls[0]["url"] == (
            "https://elibrary.judiciary.gov.ph/thebookshelf/docmonth/Jan/2023/1"
        )
        assert urls[0]["year"] == 2023
        assert urls[0]["month"] == 1
        assert urls[11]["url"] == (
            "https://elibrary.judiciary.gov.ph/thebookshelf/docmonth/Dec/2023/1"
        )

    def test_respects_month_boundaries(self) -> None:
        urls = _build_scel_monthly_urls(2023, 2023, month_start=3, month_end=6)

        assert len(urls) == 4
        assert "/Mar/2023/" in urls[0]["url"]
        assert "/Jun/2023/" in urls[-1]["url"]


class TestMonthlyUrlBuilderRegistry:
    def test_lawphil_and_scel_registered(self) -> None:
        """Both active parser types have a URL builder wired up."""
        assert "lawphil" in MONTHLY_URL_BUILDERS
        assert "supreme_court_elibrary" in MONTHLY_URL_BUILDERS

    def test_builders_are_callable_with_expected_signature(self) -> None:
        for parser_type, builder in MONTHLY_URL_BUILDERS.items():
            urls = builder(2023, 2023, 1, 1)
            assert len(urls) == 1, f"{parser_type}: expected 1 URL, got {len(urls)}"
            assert "url" in urls[0]
            assert "year" in urls[0]
            assert "month" in urls[0]


# ─── Tests 1-5: enumerate_backfill_candidates ────────────────────────────


class TestEnumerateBackfillCandidates:
    def test_happy_path_builds_correct_urls(
        self,
        batch_id: str,
        sample_batch: dict,
        sample_source: dict,
        mock_backfill_db: MagicMock,
        mock_ingestion_db_for_backfill: MagicMock,
    ) -> None:
        """Test 1: builds correct monthly URLs for year range."""
        mock_backfill_db.get_batch.return_value = sample_batch
        mock_ingestion_db_for_backfill.get_source_with_endpoints.return_value = sample_source

        mock_fetcher = MagicMock()
        candidate = MagicMock()
        candidate.url = "https://lawphil.net/judjuris/juri2023/jan2023/doc1.html"
        candidate.title = "Test Case"
        candidate.gr_no = "G.R. No. 123456"
        mock_fetcher.discover.return_value = [candidate]

        with patch("src.tasks.backfill_tasks.get_fetcher", return_value=mock_fetcher):
            result = enumerate_backfill_candidates(batch_id)

        assert result["status"] == "running"
        assert result["candidates_discovered"] == 3  # 3 months x 1 candidate each
        assert result["monthly_pages_scanned"] == 3

    def test_respects_month_boundaries(
        self,
        batch_id: str,
        sample_batch: dict,
        sample_source: dict,
        mock_backfill_db: MagicMock,
        mock_ingestion_db_for_backfill: MagicMock,
    ) -> None:
        """Test 2: respects month_start/month_end boundaries."""
        sample_batch["month_start"] = 2
        sample_batch["month_end"] = 2
        mock_backfill_db.get_batch.return_value = sample_batch
        mock_ingestion_db_for_backfill.get_source_with_endpoints.return_value = sample_source

        mock_fetcher = MagicMock()
        mock_fetcher.discover.return_value = []

        with patch("src.tasks.backfill_tasks.get_fetcher", return_value=mock_fetcher):
            result = enumerate_backfill_candidates(batch_id)

        assert result["monthly_pages_scanned"] == 1
        # Verify discover was called with Feb URL
        mock_fetcher.discover.assert_called_once()
        call_url = mock_fetcher.discover.call_args[0][0]
        assert "feb2023" in call_url

    def test_stores_candidates_in_checkpoint_state(
        self,
        batch_id: str,
        sample_batch: dict,
        sample_source: dict,
        mock_backfill_db: MagicMock,
        mock_ingestion_db_for_backfill: MagicMock,
    ) -> None:
        """Test 3: stores candidate URLs in checkpoint_state."""
        mock_backfill_db.get_batch.return_value = sample_batch
        mock_ingestion_db_for_backfill.get_source_with_endpoints.return_value = sample_source

        mock_fetcher = MagicMock()
        candidate = MagicMock()
        candidate.url = "https://lawphil.net/doc1.html"
        candidate.title = "Case 1"
        candidate.gr_no = "G.R. No. 111"
        mock_fetcher.discover.return_value = [candidate]

        with patch("src.tasks.backfill_tasks.get_fetcher", return_value=mock_fetcher):
            enumerate_backfill_candidates(batch_id)

        # Verify update_checkpoint was called with the candidate list
        mock_backfill_db.update_checkpoint.assert_called_once()
        checkpoint_state = mock_backfill_db.update_checkpoint.call_args[0][1]
        assert checkpoint_state["current_index"] == 0
        assert checkpoint_state["total_candidates"] == 3
        assert len(checkpoint_state["candidate_urls"]) == 3
        assert checkpoint_state["candidate_urls"][0]["url"] == "https://lawphil.net/doc1.html"

    def test_transitions_batch_to_running(
        self,
        batch_id: str,
        sample_batch: dict,
        sample_source: dict,
        mock_backfill_db: MagicMock,
        mock_ingestion_db_for_backfill: MagicMock,
    ) -> None:
        """Test 4: transitions batch enumerating -> running."""
        mock_backfill_db.get_batch.return_value = sample_batch
        mock_ingestion_db_for_backfill.get_source_with_endpoints.return_value = sample_source

        mock_fetcher = MagicMock()
        mock_fetcher.discover.return_value = []

        with patch("src.tasks.backfill_tasks.get_fetcher", return_value=mock_fetcher):
            result = enumerate_backfill_candidates(batch_id)

        assert result["status"] == "running"
        # Verify transition_batch was called with 'running'
        mock_backfill_db.transition_batch.assert_called_once()
        call_args = mock_backfill_db.transition_batch.call_args
        assert call_args[0] == (batch_id, "running")

    def test_transitions_to_failed_on_source_not_found(
        self,
        batch_id: str,
        sample_batch: dict,
        mock_backfill_db: MagicMock,
        mock_ingestion_db_for_backfill: MagicMock,
    ) -> None:
        """Test 5: transitions to failed when source not found."""
        mock_backfill_db.get_batch.return_value = sample_batch
        mock_ingestion_db_for_backfill.get_source_with_endpoints.return_value = None

        result = enumerate_backfill_candidates(batch_id)

        assert result["status"] == "failed"
        assert result["reason"] == "source_not_found"
        mock_backfill_db.transition_batch.assert_called_once()
        call_args = mock_backfill_db.transition_batch.call_args
        assert call_args[0][1] == "failed"

    def test_skips_when_status_not_enumerating(
        self,
        batch_id: str,
        sample_batch: dict,
        mock_backfill_db: MagicMock,
    ) -> None:
        """Skips enumeration if batch is not in 'enumerating' status."""
        sample_batch["status"] = "running"
        mock_backfill_db.get_batch.return_value = sample_batch

        result = enumerate_backfill_candidates(batch_id)

        assert result["status"] == "skipped"
        mock_backfill_db.transition_batch.assert_not_called()

    def test_scel_parser_uses_scel_urls_not_lawphil(
        self,
        batch_id: str,
        sample_batch: dict,
        mock_backfill_db: MagicMock,
        mock_ingestion_db_for_backfill: MagicMock,
    ) -> None:
        """SCEL batches enumerate elibrary docmonth URLs, not lawphil.net.

        Before the parser_type dispatch fix, every batch — regardless of
        source — was fed LawPhil monthly URLs. A SCEL batch would silently
        produce zero candidates because SupremeCourtFetcher cannot parse
        a LawPhil page.
        """
        scel_source = {
            "id": sample_batch["source_id"],
            "endpoints": [{"parser_type": "supreme_court_elibrary"}],
        }
        mock_backfill_db.get_batch.return_value = sample_batch
        mock_ingestion_db_for_backfill.get_source_with_endpoints.return_value = (
            scel_source
        )

        mock_fetcher = MagicMock()
        mock_fetcher.discover.return_value = []

        with patch("src.tasks.backfill_tasks.get_fetcher", return_value=mock_fetcher):
            enumerate_backfill_candidates(batch_id)

        # Every discover() call must have been handed an elibrary URL, never
        # a lawphil.net URL.
        for call in mock_fetcher.discover.call_args_list:
            url = call[0][0]
            assert "elibrary.judiciary.gov.ph" in url
            assert "lawphil.net" not in url

    def test_unknown_parser_type_fails_batch_cleanly(
        self,
        batch_id: str,
        sample_batch: dict,
        mock_backfill_db: MagicMock,
        mock_ingestion_db_for_backfill: MagicMock,
    ) -> None:
        """Parser type with no registered URL builder fails the batch fast.

        Prevents silent zero-yield when a new source is added to the registry
        but its URL scheme isn't wired into MONTHLY_URL_BUILDERS yet.
        """
        exotic_source = {
            "id": sample_batch["source_id"],
            "endpoints": [{"parser_type": "official_gazette"}],
        }
        mock_backfill_db.get_batch.return_value = sample_batch
        mock_ingestion_db_for_backfill.get_source_with_endpoints.return_value = (
            exotic_source
        )

        mock_fetcher = MagicMock()
        with patch("src.tasks.backfill_tasks.get_fetcher", return_value=mock_fetcher):
            result = enumerate_backfill_candidates(batch_id)

        assert result["status"] == "failed"
        assert result["reason"] == "no_url_builder"
        # Fetcher's discover() must not have been called — we bailed first.
        mock_fetcher.discover.assert_not_called()
        # And the batch must have been flipped to failed with a useful admin note.
        mock_backfill_db.transition_batch.assert_called_once()
        call_kwargs = mock_backfill_db.transition_batch.call_args.kwargs
        assert "official_gazette" in call_kwargs["admin_notes"]
        assert "MONTHLY_URL_BUILDERS" in call_kwargs["admin_notes"]

    def test_empty_month_recorded_in_checkpoint(
        self,
        batch_id: str,
        sample_batch: dict,
        sample_source: dict,
        mock_backfill_db: MagicMock,
        mock_ingestion_db_for_backfill: MagicMock,
    ) -> None:
        """Months returning no candidates are counted and recorded as 'empty'.

        Operators reviewing a completed 1941-1945 batch need to distinguish
        "genuinely no decisions" (empty) from "URL 404'd" (error).
        """
        sample_batch["month_start"] = 1
        sample_batch["month_end"] = 1  # one month only
        mock_backfill_db.get_batch.return_value = sample_batch
        mock_ingestion_db_for_backfill.get_source_with_endpoints.return_value = (
            sample_source
        )

        mock_fetcher = MagicMock()
        mock_fetcher.discover.return_value = []  # empty month

        with patch("src.tasks.backfill_tasks.get_fetcher", return_value=mock_fetcher):
            result = enumerate_backfill_candidates(batch_id)

        assert result["skipped_months"] == 1
        assert result["candidates_discovered"] == 0

        # checkpoint_state holds the per-month breakdown.
        checkpoint_state = mock_backfill_db.update_checkpoint.call_args[0][1]
        assert checkpoint_state["skipped_months"] == 1
        assert len(checkpoint_state["month_statuses"]) == 1
        assert checkpoint_state["month_statuses"][0]["status"] == "empty"
        assert checkpoint_state["month_statuses"][0]["candidates"] == 0

        # And candidates_skipped counter advanced on the batch row.
        update_kwargs = mock_backfill_db.update_batch_counters.call_args.kwargs
        assert update_kwargs["candidates_skipped"] == 1

    def test_scel_batch_below_min_year_fails_fast(
        self,
        batch_id: str,
        sample_batch: dict,
        mock_backfill_db: MagicMock,
        mock_ingestion_db_for_backfill: MagicMock,
    ) -> None:
        """SCEL batch with year_start < MIN_SUPPORTED_YEAR is rejected cleanly.

        Without this guard a 1920 SCEL batch would enumerate ~1000 docmonth
        URLs that all 404, waste rate-limit budget, and land with
        candidates_discovered=0 — indistinguishable from a real source
        outage. Fail fast with a clear admin_notes message instead.
        """
        from src.fetchers.supreme_court import SupremeCourtFetcher

        sample_batch["year_start"] = 1920
        sample_batch["year_end"] = 1920
        scel_source = {
            "id": sample_batch["source_id"],
            "endpoints": [{"parser_type": "supreme_court_elibrary"}],
        }
        mock_backfill_db.get_batch.return_value = sample_batch
        mock_ingestion_db_for_backfill.get_source_with_endpoints.return_value = (
            scel_source
        )

        # Use a REAL SupremeCourtFetcher instance so _min_supported_year_for
        # picks up the class attribute. The fetcher's discover() must not be
        # called — we expect the guard to bail before any HTTP.
        real_fetcher = SupremeCourtFetcher()
        with patch.object(real_fetcher, "discover") as mock_discover:
            with patch(
                "src.tasks.backfill_tasks.get_fetcher",
                return_value=real_fetcher,
            ):
                result = enumerate_backfill_candidates(batch_id)

            assert result["status"] == "failed"
            assert result["reason"] == "year_below_min_supported"
            mock_discover.assert_not_called()

        call_kwargs = mock_backfill_db.transition_batch.call_args.kwargs
        assert "1920" in call_kwargs["admin_notes"]
        assert str(SupremeCourtFetcher.MIN_SUPPORTED_YEAR) in call_kwargs["admin_notes"]

    def test_all_months_errored_transitions_batch_to_failed(
        self,
        batch_id: str,
        sample_batch: dict,
        sample_source: dict,
        mock_backfill_db: MagicMock,
        mock_ingestion_db_for_backfill: MagicMock,
    ) -> None:
        """If every monthly page errors, batch must transition to 'failed', not 'running'.

        Regression test for prod incident 2026-04-24: LawPhil IP-blocked the VPS;
        12/12 months returned 'No route to host'; batch silently reported success.
        """
        # Full year, 12 months, every one fails with CloudflareBlockedError
        sample_batch["month_start"] = 1
        sample_batch["month_end"] = 12
        mock_backfill_db.get_batch.return_value = sample_batch
        mock_ingestion_db_for_backfill.get_source_with_endpoints.return_value = (
            sample_source
        )

        mock_fetcher = MagicMock()
        mock_fetcher.discover.side_effect = CloudflareBlockedError(
            endpoint_url="https://lawphil.net/judjuris/juri2023/jan2023/jan2023.html",
            cf_type="challenge",
        )

        with patch("src.tasks.backfill_tasks.get_fetcher", return_value=mock_fetcher):
            result = enumerate_backfill_candidates(batch_id)

        assert result["status"] == "failed"
        assert result["reason"] == "all_months_errored"
        assert result["errored_months"] == 12
        assert result["candidates_discovered"] == 0

        # transition_batch called with "failed", not "running"
        failed_calls = [
            c for c in mock_backfill_db.transition_batch.call_args_list
            if c.args[1] == "failed"
        ]
        assert len(failed_calls) == 1
        assert "12/12 months errored" in failed_calls[0].kwargs["admin_notes"]

        # running transition was NOT called
        running_calls = [
            c for c in mock_backfill_db.transition_batch.call_args_list
            if c.args[1] == "running"
        ]
        assert len(running_calls) == 0

        # Checkpoint was NOT written — leave it untouched so a retry starts fresh.
        mock_backfill_db.update_checkpoint.assert_not_called()

    def test_all_months_empty_still_transitions_to_running(
        self,
        batch_id: str,
        sample_batch: dict,
        sample_source: dict,
        mock_backfill_db: MagicMock,
        mock_ingestion_db_for_backfill: MagicMock,
    ) -> None:
        """A year with zero decisions (all months genuinely 'empty') stays on the
        happy path — transition to 'running' and complete normally. Only errored
        months (status 'error' / 'cloudflare_blocked') trigger the failure branch.
        """
        mock_backfill_db.get_batch.return_value = sample_batch
        mock_ingestion_db_for_backfill.get_source_with_endpoints.return_value = (
            sample_source
        )

        mock_fetcher = MagicMock()
        mock_fetcher.discover.return_value = []  # every month genuinely empty

        with patch("src.tasks.backfill_tasks.get_fetcher", return_value=mock_fetcher):
            result = enumerate_backfill_candidates(batch_id)

        assert result["status"] == "running"
        assert result["candidates_discovered"] == 0
        # Checkpoint written so the tick path can transition to completed.
        mock_backfill_db.update_checkpoint.assert_called_once()

    def test_cloudflare_block_recorded_and_batch_continues(
        self,
        batch_id: str,
        sample_batch: dict,
        sample_source: dict,
        mock_backfill_db: MagicMock,
        mock_ingestion_db_for_backfill: MagicMock,
    ) -> None:
        """CloudflareBlockedError on one month doesn't fail the batch.

        It's a recoverable, source-side block — record it per-month and move
        on to the next. The batch still transitions to 'running' so the tick
        path can process whatever candidates other months surfaced.
        """
        sample_batch["month_start"] = 1
        sample_batch["month_end"] = 2  # two months
        mock_backfill_db.get_batch.return_value = sample_batch
        mock_ingestion_db_for_backfill.get_source_with_endpoints.return_value = (
            sample_source
        )

        good_candidate = MagicMock()
        good_candidate.url = "https://lawphil.net/doc1.html"
        good_candidate.title = "Case 1"
        good_candidate.gr_no = "G.R. No. 111"

        mock_fetcher = MagicMock()
        mock_fetcher.discover.side_effect = [
            [good_candidate],  # Jan: ok
            CloudflareBlockedError(
                endpoint_url="https://lawphil.net/judjuris/juri2023/feb2023/feb2023.html",
                cf_type="managed_challenge",
            ),  # Feb: blocked
        ]

        with patch("src.tasks.backfill_tasks.get_fetcher", return_value=mock_fetcher):
            result = enumerate_backfill_candidates(batch_id)

        assert result["status"] == "running"
        assert result["candidates_discovered"] == 1
        assert result["skipped_months"] == 1

        checkpoint_state = mock_backfill_db.update_checkpoint.call_args[0][1]
        statuses = {m["month"]: m["status"] for m in checkpoint_state["month_statuses"]}
        assert statuses[1] == "ok"
        assert statuses[2] == "cloudflare_blocked"


# ─── Tests 9-13: run_backfill_batch_tick ─────────────────────────────────


class TestRunBackfillBatchTick:
    @pytest.fixture(autouse=True)
    def _force_fetch_window_open(self) -> Any:
        """Tick tests in this class predate the fetch-window gate; pin
        ``is_in_fetch_window`` True so the existing scenarios still
        exercise the post-gate code path."""
        with patch(
            "src.tasks.backfill_tasks.is_in_fetch_window", return_value=True,
        ):
            yield

    def test_creates_child_jobs_and_advances_cursor(
        self,
        sample_batch: dict,
        mock_backfill_db: MagicMock,
        mock_ingestion_db_for_backfill: MagicMock,
        mock_tick_redis: MagicMock,
    ) -> None:
        """Test 9: dispatches process_ingestion_candidate and advances cursor."""
        sample_batch["status"] = "running"
        sample_batch["checkpoint_state"] = {
            "candidate_urls": [
                {
                    "url": f"https://lawphil.net/doc{i}.html",
                    "title": f"Case {i}",
                    "gr_no": f"G.R. No. {1000 + i}",
                    "year": 2023,
                    "month": 1,
                    "index": i,
                }
                for i in range(10)
            ],
            "current_index": 0,
            "total_candidates": 10,
        }
        mock_backfill_db.get_batches_by_status.return_value = [sample_batch]
        mock_backfill_db.get_batch_budget_remaining.return_value = Decimal("100.00")

        with patch(
            "src.tasks.ingestion_tasks.process_ingestion_candidate.delay",
        ) as mock_dispatch:
            result = run_backfill_batch_tick()

        assert result["batches_processed"] == 1
        tick_result = result["results"][0]
        assert tick_result["status"] == "ticked"
        assert tick_result["candidates_dispatched"] == 5
        assert tick_result["progress"] == "5/10"

        # Verify process_ingestion_candidate.delay was called once per slot
        assert mock_dispatch.call_count == 5
        # And inflight counter was bumped by 5
        mock_tick_redis.incrby.assert_called_once()
        incrby_args = mock_tick_redis.incrby.call_args[0]
        assert incrby_args[0].startswith("backfill:inflight:")
        assert incrby_args[1] == 5

    def test_transitions_to_completed_when_cursor_reaches_end(
        self,
        sample_batch: dict,
        mock_backfill_db: MagicMock,
        mock_ingestion_db_for_backfill: MagicMock,
        mock_tick_redis: MagicMock,
    ) -> None:
        """Test 10: transitions to completed when all candidates processed."""
        sample_batch["status"] = "running"
        sample_batch["checkpoint_state"] = {
            "candidate_urls": [
                {"url": "https://lawphil.net/doc1.html", "year": 2023, "month": 1, "index": 0},
            ],
            "current_index": 1,  # Already past the end
            "total_candidates": 1,
        }
        mock_backfill_db.get_batches_by_status.return_value = [sample_batch]

        result = run_backfill_batch_tick()

        tick_result = result["results"][0]
        assert tick_result["status"] == "completed"
        mock_backfill_db.transition_batch.assert_called_once()
        call_args = mock_backfill_db.transition_batch.call_args
        assert call_args[0][1] == "completed"

    def test_halts_on_budget_exhausted(
        self,
        sample_batch: dict,
        mock_backfill_db: MagicMock,
        mock_ingestion_db_for_backfill: MagicMock,
        mock_tick_redis: MagicMock,
    ) -> None:
        """Test 11: transitions to halted_budget when budget exhausted."""
        sample_batch["status"] = "running"
        sample_batch["checkpoint_state"] = {
            "candidate_urls": [{"url": "https://lawphil.net/doc1.html"}],
            "current_index": 0,
            "total_candidates": 1,
        }
        mock_backfill_db.get_batches_by_status.return_value = [sample_batch]
        mock_backfill_db.get_batch_budget_remaining.return_value = Decimal("0")

        result = run_backfill_batch_tick()

        tick_result = result["results"][0]
        assert tick_result["status"] == "halted_budget"
        mock_backfill_db.transition_batch.assert_called_once()
        call_args = mock_backfill_db.transition_batch.call_args
        assert call_args[0][1] == "halted_budget"

    def test_idle_when_no_running_batches(
        self,
        mock_backfill_db: MagicMock,
    ) -> None:
        """Test 13: returns idle when no batches in 'running' status."""
        mock_backfill_db.get_batches_by_status.return_value = []

        result = run_backfill_batch_tick()

        assert result["status"] == "idle"
        assert result["batches_processed"] == 0

    def test_tick_rescues_stuck_enumerating_batch(
        self,
        mock_backfill_db: MagicMock,
    ) -> None:
        """A batch stuck in 'enumerating' with last_tick_at NULL > 5 min is rescued."""
        stuck_batch = {
            "id": "stuck-uuid",
            "status": "enumerating",
            "last_tick_at": None,
            "created_at": datetime.now(UTC) - timedelta(minutes=10),
        }
        mock_backfill_db.get_stuck_enumerating_batches.return_value = [stuck_batch]
        mock_backfill_db.get_batches_by_status.return_value = []

        mock_redis = MagicMock()
        mock_redis.set.return_value = True  # lock acquired

        with patch(
            "src.tasks.backfill_tasks._get_redis_client",
            return_value=mock_redis,
        ), patch(
            "src.tasks.backfill_tasks.enumerate_backfill_candidates.delay",
        ) as mock_enumerate_dispatch:
            result = run_backfill_batch_tick()

        mock_enumerate_dispatch.assert_called_once_with("stuck-uuid")
        assert result["rescued_enumerating"] == 1

    def test_tick_skips_rescue_when_lock_held(
        self,
        mock_backfill_db: MagicMock,
    ) -> None:
        """If Redis lock exists (prior rescue in flight), don't double-dispatch."""
        stuck_batch = {
            "id": "stuck-uuid",
            "status": "enumerating",
            "last_tick_at": None,
            "created_at": datetime.now(UTC) - timedelta(minutes=10),
        }
        mock_backfill_db.get_stuck_enumerating_batches.return_value = [stuck_batch]
        mock_backfill_db.get_batches_by_status.return_value = []

        mock_redis = MagicMock()
        mock_redis.set.return_value = False  # lock held

        with patch(
            "src.tasks.backfill_tasks._get_redis_client",
            return_value=mock_redis,
        ), patch(
            "src.tasks.backfill_tasks.enumerate_backfill_candidates.delay",
        ) as mock_enumerate_dispatch:
            result = run_backfill_batch_tick()

        mock_enumerate_dispatch.assert_not_called()
        assert result["rescued_enumerating"] == 0

    def test_creates_fewer_jobs_when_near_end(
        self,
        sample_batch: dict,
        mock_backfill_db: MagicMock,
        mock_ingestion_db_for_backfill: MagicMock,
        mock_tick_redis: MagicMock,
    ) -> None:
        """Dispatches only remaining candidates when fewer than max slots available."""
        sample_batch["status"] = "running"
        sample_batch["checkpoint_state"] = {
            "candidate_urls": [
                {
                    "url": f"https://lawphil.net/doc{i}.html",
                    "title": f"Case {i}",
                    "gr_no": f"G.R. No. {1000 + i}",
                    "year": 2023,
                    "month": 1,
                    "index": i,
                }
                for i in range(3)
            ],
            "current_index": 1,  # 2 remaining
            "total_candidates": 3,
        }
        mock_backfill_db.get_batches_by_status.return_value = [sample_batch]
        mock_backfill_db.get_batch_budget_remaining.return_value = Decimal("100.00")

        with patch(
            "src.tasks.ingestion_tasks.process_ingestion_candidate.delay",
        ):
            result = run_backfill_batch_tick()

        tick_result = result["results"][0]
        assert tick_result["candidates_dispatched"] == 2
        assert tick_result["progress"] == "3/3"

    # ─── Tick dispatches real candidates (fix for prod incident 2026-04-24) ──

    def test_tick_dispatches_process_ingestion_candidate_with_real_url(
        self,
        sample_batch: dict,
        mock_backfill_db: MagicMock,
        mock_ingestion_db_for_backfill: MagicMock,
        mock_tick_redis: MagicMock,
    ) -> None:
        """Tick dispatches process_ingestion_candidate with the URL from
        checkpoint_state.candidate_urls[idx], not a generic ingestion_job
        that re-crawls the source's default endpoint.

        Regression test for prod incident 2026-04-24 (batch b596d5f7): the
        old tick called create_backfill_ingestion_job, so poll_pending_jobs
        picked up the row and ran fetcher.discover() against the juri2025
        landing page — 299 completed jobs, zero documents created.
        """
        candidate_url = (
            "https://lawphil.net/judjuris/juri2020/jan2020/gr_223623_2020.html"
        )
        sample_batch["status"] = "running"
        sample_batch["checkpoint_state"] = {
            "candidate_urls": [
                {
                    "url": candidate_url,
                    "title": "People v. Dela Cruz",
                    "gr_no": "G.R. No. 223623",
                    "year": 2020,
                    "month": 1,
                    "index": 0,
                },
            ],
            "current_index": 0,
            "total_candidates": 1,
        }
        mock_backfill_db.get_batches_by_status.return_value = [sample_batch]

        fake_candidate_id = make_uuid()
        mock_ingestion_db_for_backfill.create_ingestion_candidate.side_effect = None
        mock_ingestion_db_for_backfill.create_ingestion_candidate.return_value = (
            fake_candidate_id
        )

        with patch(
            "src.tasks.ingestion_tasks.process_ingestion_candidate.delay",
        ) as mock_dispatch:
            run_backfill_batch_tick()

        mock_dispatch.assert_called_once()
        kwargs = mock_dispatch.call_args.kwargs
        assert kwargs["url"] == candidate_url
        assert kwargs["candidate_id"] == fake_candidate_id
        assert kwargs["parser_type"] == "lawphil"
        assert kwargs["candidate_metadata"]["trigger"] == "backfill"
        assert kwargs["candidate_metadata"]["backfill_batch_id"] == str(
            sample_batch["id"],
        )
        assert kwargs["candidate_metadata"]["gr_no"] == "G.R. No. 223623"

        # create_ingestion_candidate was called with the real URL, not
        # the source's default endpoint.
        create_kwargs = (
            mock_ingestion_db_for_backfill.create_ingestion_candidate
            .call_args.kwargs
        )
        assert create_kwargs["detected_url"] == candidate_url

    def test_tick_skips_duplicate_via_similarity_key(
        self,
        sample_batch: dict,
        mock_backfill_db: MagicMock,
        mock_ingestion_db_for_backfill: MagicMock,
        mock_tick_redis: MagicMock,
    ) -> None:
        """If similarity_key already exists, skip dispatch and bump
        candidates_skipped — matches daily_crawl's dedup behavior."""
        sample_batch["status"] = "running"
        sample_batch["checkpoint_state"] = {
            "candidate_urls": [
                {
                    "url": "https://lawphil.net/doc1.html",
                    "title": "People v. Dela Cruz",
                    "gr_no": "G.R. No. 111",
                    "year": 2020,
                    "month": 1,
                    "index": 0,
                },
            ],
            "current_index": 0,
            "total_candidates": 1,
        }
        mock_backfill_db.get_batches_by_status.return_value = [sample_batch]

        # Simulate a pre-existing candidate matching the similarity key
        mock_ingestion_db_for_backfill.find_candidate_by_similarity_key.return_value = {
            "id": make_uuid(),
            "status": "accepted",
        }

        with patch(
            "src.tasks.ingestion_tasks.process_ingestion_candidate.delay",
        ) as mock_dispatch:
            result = run_backfill_batch_tick()

        # No dispatch, no candidate creation
        mock_dispatch.assert_not_called()
        mock_ingestion_db_for_backfill.create_ingestion_candidate.assert_not_called()

        # Cursor advanced, candidates_skipped incremented
        tick_result = result["results"][0]
        assert tick_result["progress"] == "1/1"
        assert tick_result["candidates_skipped"] == 1
        assert tick_result["candidates_dispatched"] == 0

        update_kwargs = mock_backfill_db.update_batch_counters.call_args.kwargs
        assert update_kwargs["candidates_skipped"] == 1

    def test_tick_respects_redis_inflight_cap(
        self,
        sample_batch: dict,
        mock_backfill_db: MagicMock,
        mock_ingestion_db_for_backfill: MagicMock,
        mock_tick_redis: MagicMock,
    ) -> None:
        """When the Redis inflight counter is at the per-batch ``inflight_cap``,
        tick must not dispatch any more candidates or advance the cursor."""
        sample_batch["status"] = "running"
        sample_batch["inflight_cap"] = 5
        sample_batch["checkpoint_state"] = {
            "candidate_urls": [
                {
                    "url": f"https://lawphil.net/doc{i}.html",
                    "title": f"Case {i}",
                    "gr_no": f"G.R. No. {i}",
                    "year": 2020,
                    "month": 1,
                    "index": i,
                }
                for i in range(10)
            ],
            "current_index": 0,
            "total_candidates": 10,
        }
        mock_backfill_db.get_batches_by_status.return_value = [sample_batch]

        # Pre-set Redis counter to the cap
        mock_tick_redis.get.return_value = "5"

        with patch(
            "src.tasks.ingestion_tasks.process_ingestion_candidate.delay",
        ) as mock_dispatch:
            result = run_backfill_batch_tick()

        tick_result = result["results"][0]
        assert tick_result["status"] == "waiting_inflight"
        assert tick_result["inflight"] == 5
        mock_dispatch.assert_not_called()
        mock_ingestion_db_for_backfill.create_ingestion_candidate.assert_not_called()
        mock_tick_redis.incrby.assert_not_called()

    def test_tick_uses_per_batch_inflight_cap_from_row(
        self,
        sample_batch: dict,
        mock_backfill_db: MagicMock,
        mock_ingestion_db_for_backfill: MagicMock,
        mock_tick_redis: MagicMock,
    ) -> None:
        """A batch row with ``inflight_cap=20`` must dispatch up to 20
        candidates per tick — proves the constant fallback is no longer the
        ceiling for per-batch behaviour. Counter starts at 0 → 20 slots."""
        sample_batch["status"] = "running"
        sample_batch["inflight_cap"] = 20
        sample_batch["checkpoint_state"] = {
            "candidate_urls": [
                {
                    "url": f"https://lawphil.net/doc{i}.html",
                    "title": f"Case {i}",
                    "gr_no": f"G.R. No. {i}",
                    "year": 2020,
                    "month": 1,
                    "index": i,
                }
                for i in range(50)
            ],
            "current_index": 0,
            "total_candidates": 50,
        }
        mock_backfill_db.get_batches_by_status.return_value = [sample_batch]

        # Empty inflight counter, so the full cap is available
        mock_tick_redis.get.return_value = None

        # No prior candidate is in the dedup table — every URL becomes a fresh
        # ingestion_candidate row + dispatch.
        mock_ingestion_db_for_backfill.find_candidate_by_similarity_key.return_value = None
        mock_ingestion_db_for_backfill.create_ingestion_candidate.side_effect = (
            lambda **_: make_uuid()
        )

        with patch(
            "src.tasks.ingestion_tasks.process_ingestion_candidate.delay",
        ) as mock_dispatch:
            result = run_backfill_batch_tick()

        tick_result = result["results"][0]
        assert tick_result["status"] == "ticked"
        assert tick_result["candidates_dispatched"] == 20
        assert mock_dispatch.call_count == 20
        mock_tick_redis.incrby.assert_called_once()
        # incrby called with (key, 20) — the per-batch cap value, not 5.
        assert mock_tick_redis.incrby.call_args.args[1] == 20

    def test_tick_falls_back_to_default_when_inflight_cap_missing(
        self,
        sample_batch: dict,
        mock_backfill_db: MagicMock,
        mock_ingestion_db_for_backfill: MagicMock,
        mock_tick_redis: MagicMock,
    ) -> None:
        """If the row was fetched without the ``inflight_cap`` column (pre-
        migration worker hitting a freshly-migrated DB or vice-versa), tick
        must use ``DEFAULT_INFLIGHT_CAP`` rather than dispatching unbounded."""
        from src.tasks.backfill_tasks import DEFAULT_INFLIGHT_CAP

        sample_batch["status"] = "running"
        sample_batch.pop("inflight_cap", None)  # simulate missing column
        sample_batch["checkpoint_state"] = {
            "candidate_urls": [
                {
                    "url": f"https://lawphil.net/doc{i}.html",
                    "title": f"Case {i}",
                    "gr_no": f"G.R. No. {i}",
                    "year": 2020,
                    "month": 1,
                    "index": i,
                }
                for i in range(50)
            ],
            "current_index": 0,
            "total_candidates": 50,
        }
        mock_backfill_db.get_batches_by_status.return_value = [sample_batch]
        mock_tick_redis.get.return_value = None
        mock_ingestion_db_for_backfill.find_candidate_by_similarity_key.return_value = None
        mock_ingestion_db_for_backfill.create_ingestion_candidate.side_effect = (
            lambda **_: make_uuid()
        )

        with patch(
            "src.tasks.ingestion_tasks.process_ingestion_candidate.delay",
        ):
            result = run_backfill_batch_tick()

        tick_result = result["results"][0]
        assert tick_result["candidates_dispatched"] == DEFAULT_INFLIGHT_CAP

    # ─── Bug 5 — terminal-completion drain gate ────────────────────────

    def test_tick_terminal_drain_waits_on_inflight(
        self,
        sample_batch: dict,
        mock_backfill_db: MagicMock,
        mock_ingestion_db_for_backfill: MagicMock,
        mock_tick_redis: MagicMock,
    ) -> None:
        """Cursor at total + inflight>0 + recent last_tick → 'draining_inflight'.

        The terminal-completion gate must wait for completion hooks to drain
        the Redis inflight counter before transitioning. Otherwise the batch
        flips to 'completed' while in-flight jobs are still mutating its
        counters — which is exactly the drift seen in the LawPhil 2020 pilot
        (cursor 933 vs processed 594 vs created 584).
        """
        sample_batch["status"] = "running"
        sample_batch["checkpoint_state"] = {
            "candidate_urls": [
                {"url": f"https://lawphil.net/doc{i}.html"} for i in range(5)
            ],
            "current_index": 5,  # at the end
            "total_candidates": 5,
        }
        sample_batch["last_tick_at"] = datetime.now(UTC) - timedelta(minutes=2)
        mock_backfill_db.get_batches_by_status.return_value = [sample_batch]

        # 2 jobs still in flight per Redis counter
        mock_tick_redis.get.return_value = "2"

        result = run_backfill_batch_tick()

        tick_result = result["results"][0]
        assert tick_result["status"] == "draining_inflight"
        assert tick_result["inflight"] == 2
        assert tick_result["progress"] == "5/5"

        # Crucially: no transition to 'completed', no inflight key delete.
        mock_backfill_db.transition_batch.assert_not_called()
        mock_tick_redis.delete.assert_not_called()

    def test_tick_terminal_reaper_clears_stale_inflight(
        self,
        sample_batch: dict,
        mock_backfill_db: MagicMock,
        mock_ingestion_db_for_backfill: MagicMock,
        mock_tick_redis: MagicMock,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        """Cursor at total + inflight>0 + last_tick stale → reap and complete.

        If the inflight counter never drains (lost completion hook, dropped
        task, hard-error path that bypasses the try/finally outcome
        assignment), don't wedge the batch forever. After
        INFLIGHT_DRAIN_STALENESS the reaper logs WARN, zeroes the key, and
        transitions to 'completed' on the same tick.
        """
        import logging

        sample_batch["status"] = "running"
        sample_batch["checkpoint_state"] = {
            "candidate_urls": [
                {"url": f"https://lawphil.net/doc{i}.html"} for i in range(5)
            ],
            "current_index": 5,
            "total_candidates": 5,
        }
        sample_batch["last_tick_at"] = datetime.now(UTC) - timedelta(minutes=11)
        mock_backfill_db.get_batches_by_status.return_value = [sample_batch]

        mock_tick_redis.get.return_value = "2"

        with caplog.at_level(logging.WARNING, logger="src.tasks.backfill_tasks"):
            result = run_backfill_batch_tick()

        tick_result = result["results"][0]
        assert tick_result["status"] == "completed"
        assert tick_result["reaped_inflight"] == 2

        # Reaper logged the stale counter so operators can audit.
        assert any(
            "stale inflight counter" in record.message.lower()
            for record in caplog.records
        )

        # Inflight key was deleted and the batch was transitioned to completed.
        mock_tick_redis.delete.assert_called_once()
        delete_args = mock_tick_redis.delete.call_args[0]
        assert delete_args[0].startswith("backfill:inflight:")

        mock_backfill_db.transition_batch.assert_called_once()
        call_args = mock_backfill_db.transition_batch.call_args
        assert call_args[0][1] == "completed"

    def test_tick_terminal_clean_completion(
        self,
        sample_batch: dict,
        mock_backfill_db: MagicMock,
        mock_ingestion_db_for_backfill: MagicMock,
        mock_tick_redis: MagicMock,
    ) -> None:
        """Cursor at total + inflight=0 → transition to 'completed' immediately.

        This is the existing happy-path behavior. Preserved by the new gate
        when nothing is in flight: no draining, no reaping, just complete.
        """
        sample_batch["status"] = "running"
        sample_batch["checkpoint_state"] = {
            "candidate_urls": [
                {"url": f"https://lawphil.net/doc{i}.html"} for i in range(5)
            ],
            "current_index": 5,
            "total_candidates": 5,
        }
        sample_batch["last_tick_at"] = datetime.now(UTC) - timedelta(minutes=2)
        mock_backfill_db.get_batches_by_status.return_value = [sample_batch]

        # Counter has fully drained.
        mock_tick_redis.get.return_value = None

        result = run_backfill_batch_tick()

        tick_result = result["results"][0]
        assert tick_result["status"] == "completed"
        # No reaped_inflight key on the clean path.
        assert "reaped_inflight" not in tick_result

        mock_backfill_db.transition_batch.assert_called_once()
        call_args = mock_backfill_db.transition_batch.call_args
        assert call_args[0][1] == "completed"
        mock_tick_redis.delete.assert_called_once()


# ─── Tests 14-15: check_backfill_budgets ─────────────────────────────────


class TestCheckBackfillBudgets:
    @patch("src.tasks.backfill_tasks._get_redis_client")
    def test_halts_batches_when_global_budget_exceeded(
        self,
        mock_redis_factory: MagicMock,
        sample_batch: dict,
        mock_backfill_db: MagicMock,
    ) -> None:
        """Test 14: halts all running batches when global budget exceeded."""
        sample_batch["status"] = "running"
        mock_backfill_db.get_batches_by_status.return_value = [sample_batch]

        # Mock Redis to show global budget exceeded
        mock_redis = MagicMock()
        mock_redis.get.side_effect = lambda key: {
            "llm:config:monthly_budget_usd": "100.00",
        }.get(key, "150.00")  # current spend > budget
        mock_redis_factory.return_value = mock_redis

        result = check_backfill_budgets()

        assert result["global_budget_exceeded"] is True
        assert result["batches_halted"] == 1
        mock_backfill_db.transition_batch.assert_called_once()
        call_args = mock_backfill_db.transition_batch.call_args
        assert call_args[0][1] == "halted_budget"

    @patch("src.tasks.backfill_tasks._get_redis_client")
    def test_no_op_when_budget_is_fine(
        self,
        mock_redis_factory: MagicMock,
        sample_batch: dict,
        mock_backfill_db: MagicMock,
    ) -> None:
        """Test 15: no batches halted when budget is within limits."""
        sample_batch["status"] = "running"
        mock_backfill_db.get_batches_by_status.return_value = [sample_batch]
        mock_backfill_db.get_batch_budget_remaining.return_value = Decimal("50.00")

        # Mock Redis: global budget NOT exceeded
        mock_redis = MagicMock()
        mock_redis.get.side_effect = lambda key: {
            "llm:config:monthly_budget_usd": "500.00",
        }.get(key, "100.00")  # current spend < budget
        mock_redis_factory.return_value = mock_redis

        result = check_backfill_budgets()

        assert result["batches_halted"] == 0
        assert result["global_budget_exceeded"] is False
        mock_backfill_db.transition_batch.assert_not_called()

    @patch("src.tasks.backfill_tasks._get_redis_client")
    def test_halts_batch_on_per_batch_budget(
        self,
        mock_redis_factory: MagicMock,
        sample_batch: dict,
        mock_backfill_db: MagicMock,
    ) -> None:
        """Halts a batch when its own budget is exceeded even if global is fine."""
        sample_batch["status"] = "running"
        mock_backfill_db.get_batches_by_status.return_value = [sample_batch]
        mock_backfill_db.get_batch_budget_remaining.return_value = Decimal("0")

        # Global budget is fine
        mock_redis = MagicMock()
        mock_redis.get.side_effect = lambda key: {
            "llm:config:monthly_budget_usd": "500.00",
        }.get(key, "50.00")
        mock_redis_factory.return_value = mock_redis

        result = check_backfill_budgets()

        assert result["batches_halted"] == 1
        mock_backfill_db.transition_batch.assert_called_once()

    @patch("src.tasks.backfill_tasks._get_redis_client")
    def test_idle_when_no_running_batches(
        self,
        mock_redis_factory: MagicMock,
        mock_backfill_db: MagicMock,
    ) -> None:
        """Returns idle status when no running batches exist."""
        mock_backfill_db.get_batches_by_status.return_value = []

        result = check_backfill_budgets()

        assert result["status"] == "idle"
        assert result["batches_checked"] == 0
