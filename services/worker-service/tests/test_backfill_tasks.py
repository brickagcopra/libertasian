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
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from src.fetchers.base import CloudflareBlockedError
from src.tasks.backfill_tasks import (
    MONTHLY_URL_BUILDERS,
    _build_lawphil_monthly_urls,
    _build_scel_monthly_urls,
    _tick_single_batch,
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
        mock_db.create_backfill_ingestion_job.return_value = make_uuid()
        mock_db.get_inflight_jobs_count.return_value = 0
        mock_db.get_batch_budget_remaining.return_value = Decimal("100.00")
        yield mock_db


@pytest.fixture()
def mock_ingestion_db_for_backfill() -> MagicMock:
    """Mock the ingestion DB client used by backfill tasks."""
    with patch("src.tasks.backfill_tasks.ingestion_db") as mock_db:
        mock_db.get_source_with_endpoints.return_value = None
        yield mock_db


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
    def test_creates_child_jobs_and_advances_cursor(
        self,
        sample_batch: dict,
        mock_backfill_db: MagicMock,
    ) -> None:
        """Test 9: creates child jobs and advances cursor."""
        sample_batch["status"] = "running"
        sample_batch["checkpoint_state"] = {
            "candidate_urls": [
                {"url": f"https://lawphil.net/doc{i}.html", "year": 2023, "month": 1, "index": i}
                for i in range(10)
            ],
            "current_index": 0,
            "total_candidates": 10,
        }
        mock_backfill_db.get_batches_by_status.return_value = [sample_batch]
        mock_backfill_db.get_batch_budget_remaining.return_value = Decimal("100.00")
        mock_backfill_db.get_inflight_jobs_count.return_value = 0

        result = run_backfill_batch_tick()

        assert result["batches_processed"] == 1
        tick_result = result["results"][0]
        assert tick_result["status"] == "ticked"
        assert tick_result["jobs_created"] == 5  # MAX_INFLIGHT_JOBS_PER_BATCH
        assert tick_result["progress"] == "5/10"

        # Verify child jobs were created
        assert mock_backfill_db.create_backfill_ingestion_job.call_count == 5

    def test_transitions_to_completed_when_cursor_reaches_end(
        self,
        sample_batch: dict,
        mock_backfill_db: MagicMock,
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

    def test_waits_when_max_inflight_reached(
        self,
        sample_batch: dict,
        mock_backfill_db: MagicMock,
    ) -> None:
        """Test 12: waits when 5 jobs already in-flight."""
        sample_batch["status"] = "running"
        sample_batch["checkpoint_state"] = {
            "candidate_urls": [{"url": "https://lawphil.net/doc1.html"}],
            "current_index": 0,
            "total_candidates": 1,
        }
        mock_backfill_db.get_batches_by_status.return_value = [sample_batch]
        mock_backfill_db.get_batch_budget_remaining.return_value = Decimal("100.00")
        mock_backfill_db.get_inflight_jobs_count.return_value = 5

        result = run_backfill_batch_tick()

        tick_result = result["results"][0]
        assert tick_result["status"] == "waiting_inflight"
        assert tick_result["inflight"] == 5
        # No child jobs should have been created
        mock_backfill_db.create_backfill_ingestion_job.assert_not_called()

    def test_idle_when_no_running_batches(
        self,
        mock_backfill_db: MagicMock,
    ) -> None:
        """Test 13: returns idle when no batches in 'running' status."""
        mock_backfill_db.get_batches_by_status.return_value = []

        result = run_backfill_batch_tick()

        assert result["status"] == "idle"
        assert result["batches_processed"] == 0

    def test_creates_fewer_jobs_when_near_end(
        self,
        sample_batch: dict,
        mock_backfill_db: MagicMock,
    ) -> None:
        """Creates only remaining candidates when fewer than max slots available."""
        sample_batch["status"] = "running"
        sample_batch["checkpoint_state"] = {
            "candidate_urls": [
                {"url": f"https://lawphil.net/doc{i}.html", "year": 2023, "month": 1, "index": i}
                for i in range(3)
            ],
            "current_index": 1,  # 2 remaining
            "total_candidates": 3,
        }
        mock_backfill_db.get_batches_by_status.return_value = [sample_batch]
        mock_backfill_db.get_batch_budget_remaining.return_value = Decimal("100.00")
        mock_backfill_db.get_inflight_jobs_count.return_value = 0

        result = run_backfill_batch_tick()

        tick_result = result["results"][0]
        assert tick_result["jobs_created"] == 2
        assert tick_result["progress"] == "3/3"


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
