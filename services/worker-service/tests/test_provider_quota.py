"""Worker behaviour while the LLM provider is out of credit.

rag-service answers HTTP 503 ``{"code": "provider_quota_exhausted"}`` and
sets the Redis key ``llm:provider:quota_exhausted`` (300s TTL) when OpenAI
reports insufficient_quota. The worker must:

- turn that 503 into ProviderQuotaExhaustedError (a BudgetExceededError);
- stop the beat producers (backfill tick, derivative poller) while the key
  is set, leaving work queued rather than failing it;
- not self.retry() the per-document LLM tasks on it;
- fail OPEN when Redis cannot be read.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock, patch

import httpx
import pytest

from src.clients import rag_client
from src.clients.rag_client import (
    QUOTA_BREAKER_KEY,
    BudgetExceededError,
    ProviderQuotaExhaustedError,
)
from src.clients.rag_client import (
    provider_quota_exhausted as real_provider_quota_exhausted,
)

from .conftest import make_uuid

QUOTA_BODY = {
    "detail": "AI generation is temporarily unavailable. Please try again later.",
    "code": "provider_quota_exhausted",
    "scope": None,
    "period": None,
}


def _response(status: int, body: Any) -> httpx.Response:
    request = httpx.Request("POST", "http://rag:8000/x")
    return httpx.Response(status, json=body, request=request)


# ─── rag_client ─────────────────────────────────────────────────────────


class TestRaiseForBudget:
    def test_quota_503_raises_quota_error(self) -> None:
        with pytest.raises(ProviderQuotaExhaustedError) as exc_info:
            rag_client._raise_for_budget(_response(503, QUOTA_BODY))
        # Still a budget error (bar exam pauses on it) and an HTTPStatusError
        # (every existing `except httpx.HTTPStatusError` keeps catching it).
        assert isinstance(exc_info.value, BudgetExceededError)
        assert isinstance(exc_info.value, httpx.HTTPStatusError)

    def test_budget_503_is_not_a_quota_error(self) -> None:
        body = {"code": "budget_exceeded", "scope": "mcq", "period": "daily"}
        with pytest.raises(BudgetExceededError) as exc_info:
            rag_client._raise_for_budget(_response(503, body))
        assert not isinstance(exc_info.value, ProviderQuotaExhaustedError)
        assert exc_info.value.scope == "mcq"

    def test_plain_503_left_to_raise_for_status(self) -> None:
        rag_client._raise_for_budget(_response(503, {"detail": "down"}))

    @pytest.mark.parametrize(
        ("func", "kwargs"),
        [
            ("generate_completion", {"system_prompt": "s", "user_prompt": "u"}),
            ("extract_doctrines", {"document_id": "d"}),
            ("generate_digest", {"document_id": "d", "sections": []}),
        ],
    )
    def test_llm_calls_raise_quota_error(
        self, func: str, kwargs: dict[str, Any]
    ) -> None:
        with patch.object(
            httpx.Client, "post", return_value=_response(503, QUOTA_BODY)
        ), pytest.raises(ProviderQuotaExhaustedError):
            getattr(rag_client, func)(**kwargs)


class TestProviderQuotaExhausted:
    def test_reads_breaker_key(self, monkeypatch: pytest.MonkeyPatch) -> None:
        fake = MagicMock()
        fake.exists.return_value = 1
        monkeypatch.setattr(rag_client, "_breaker_redis", fake)
        assert real_provider_quota_exhausted() is True
        fake.exists.assert_called_once_with(QUOTA_BREAKER_KEY)

        fake.exists.return_value = 0
        assert real_provider_quota_exhausted() is False

    def test_redis_error_fails_open(self, monkeypatch: pytest.MonkeyPatch) -> None:
        fake = MagicMock()
        fake.exists.side_effect = ConnectionError("redis down")
        monkeypatch.setattr(rag_client, "_breaker_redis", fake)
        assert real_provider_quota_exhausted() is False


# ─── Beat producers ─────────────────────────────────────────────────────


class TestDerivativePollerSkips:
    @patch("src.tasks.derivative_dispatch_tasks.get_connection")
    def test_no_claim_while_breaker_set(
        self, mock_get_conn: MagicMock, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from src.tasks.derivative_dispatch_tasks import poll_pending_derivative_jobs

        monkeypatch.setattr(rag_client, "provider_quota_exhausted", lambda: True)
        result = poll_pending_derivative_jobs.run()

        assert result == {"dispatched": 0, "status": "skipped_provider_quota_exhausted"}
        mock_get_conn.assert_not_called()  # jobs stay 'pending'


class TestBackfillTickSkips:
    def test_batch_idles_while_breaker_set(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from src.tasks import backfill_tasks

        monkeypatch.setattr(rag_client, "provider_quota_exhausted", lambda: True)
        batch_id = make_uuid()
        with patch.object(backfill_tasks, "is_in_fetch_window", return_value=True), \
             patch.object(backfill_tasks, "backfill_db") as mock_db, \
             patch.object(backfill_tasks, "_get_redis_client") as mock_redis:
            result = backfill_tasks._tick_single_batch(
                {"id": batch_id, "checkpoint_state": {"candidate_urls": [{"url": "u"}]}}
            )

        assert result == {
            "batch_id": batch_id,
            "status": "skipped_provider_quota_exhausted",
        }
        # last_tick_at refreshed so the inactivity watchdog does not reap it.
        mock_db.update_batch_counters.assert_called_once()
        assert "last_tick_at" in mock_db.update_batch_counters.call_args.kwargs
        mock_db.update_checkpoint.assert_not_called()
        mock_redis.assert_not_called()


# ─── Per-document LLM tasks: no retry on quota ──────────────────────────


class TestNoRetryOnQuota:
    def test_extract_doctrines_task(
        self,
        mock_db_client: MagicMock,
        mock_rag_client: MagicMock,
        document_id: str,
    ) -> None:
        from src.tasks.doctrine_tasks import extract_doctrines_task

        mock_db_client.get_document_sections.return_value = []
        mock_rag_client.extract_doctrines.side_effect = ProviderQuotaExhaustedError(
            "quota",
            request=httpx.Request("POST", "http://rag"),
            response=_response(503, QUOTA_BODY),
        )

        with patch.object(extract_doctrines_task, "retry") as mock_retry:
            result = extract_doctrines_task(document_id=document_id)

        assert result["status"] == "skipped"
        assert result["reason"] == "provider_quota_exhausted"
        mock_retry.assert_not_called()

    def test_generate_ingestion_digest(self, document_id: str) -> None:
        from src.tasks.digest_tasks import generate_ingestion_digest

        with patch("src.tasks.digest_tasks.db") as mock_db, \
             patch("src.tasks.digest_tasks.rag_client") as mock_rag, \
             patch.object(generate_ingestion_digest, "retry") as mock_retry:
            mock_db.get_document_metadata_for_digest.return_value = {
                "document_type": "case",
            }
            mock_db.get_document_sections_for_digest.return_value = [
                {"id": "s1", "section_type": "facts", "plain_text": "Facts."},
            ]
            mock_rag.generate_digest.side_effect = ProviderQuotaExhaustedError(
                "quota",
                request=httpx.Request("POST", "http://rag"),
                response=_response(503, QUOTA_BODY),
            )
            result = generate_ingestion_digest(document_id=document_id)

        assert result["status"] == "skipped"
        assert result["reason"] == "provider_quota_exhausted"
        mock_retry.assert_not_called()
