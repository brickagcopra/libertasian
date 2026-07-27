"""Tests for the bounded retry on the OpenSearch index trigger.

The trigger fires *after* the publish has been committed, so a dropped call
does not fail loudly — it leaves a live document out of the search index. That
is what happened to 5,220 documents during the #322 backfill, all of them 429s
from the gateway throttler. These tests pin the retry envelope: what is
retried, what is not, and that exhaustion reports False rather than True.

Transport is mocked with ``httpx.MockTransport``; ``time.sleep`` is patched out
so the backoff costs no wall-clock.
"""

from __future__ import annotations

from typing import Any

import httpx
import pytest

from src.clients import nestjs_client
from src.config import settings

DOC_ID = "11111111-1111-4111-8111-111111111111"


@pytest.fixture
def sleeps(monkeypatch: pytest.MonkeyPatch) -> list[float]:
    """Record every backoff sleep instead of performing it."""
    recorded: list[float] = []
    monkeypatch.setattr(
        nestjs_client.time, "sleep", lambda s: recorded.append(s)
    )
    return recorded


@pytest.fixture
def responder(monkeypatch: pytest.MonkeyPatch) -> Any:
    """Drive ``trigger_opensearch_index`` against a scripted transport.

    Returns a callable taking the list of responses (or exceptions) to serve,
    one per attempt, and yielding the list of requests actually made.
    """

    def install(script: list[Any]) -> list[httpx.Request]:
        seen: list[httpx.Request] = []
        remaining = list(script)

        def handler(request: httpx.Request) -> httpx.Response:
            seen.append(request)
            if not remaining:
                raise AssertionError(
                    f"unexpected extra request #{len(seen)} to {request.url}"
                )
            nxt = remaining.pop(0)
            if isinstance(nxt, Exception):
                raise nxt
            return nxt

        transport = httpx.MockTransport(handler)
        real_client = httpx.Client

        def fake_client(*args: Any, **kwargs: Any) -> httpx.Client:
            kwargs["transport"] = transport
            return real_client(*args, **kwargs)

        monkeypatch.setattr(nestjs_client.httpx, "Client", fake_client)
        return seen

    return install


def _ok() -> httpx.Response:
    return httpx.Response(201, json={"success": True})


def _status(code: int, **headers: str) -> httpx.Response:
    return httpx.Response(code, headers=headers, text="nope")


class TestSuccess:
    def test_first_attempt_success_makes_one_call(
        self, responder: Any, sleeps: list[float]
    ) -> None:
        seen = responder([_ok()])
        assert nestjs_client.trigger_opensearch_index(DOC_ID) is True
        assert len(seen) == 1
        assert sleeps == []

    def test_sends_the_internal_api_key_header(self, responder: Any) -> None:
        seen = responder([_ok()])
        nestjs_client.trigger_opensearch_index(DOC_ID)
        # InternalApiGuard reads X-Internal-Api-Key, not the X-Internal-Auth
        # header the derivatives endpoints use. Different guard, different key.
        assert seen[0].headers["X-Internal-Api-Key"] == settings.internal_api_key
        assert DOC_ID in str(seen[0].url)

    def test_200_is_accepted_as_well_as_201(self, responder: Any) -> None:
        responder([httpx.Response(200, json={"success": True})])
        assert nestjs_client.trigger_opensearch_index(DOC_ID) is True


class TestRetryable:
    def test_429_then_200_succeeds(
        self, responder: Any, sleeps: list[float]
    ) -> None:
        seen = responder([_status(429), _ok()])
        assert nestjs_client.trigger_opensearch_index(DOC_ID) is True
        assert len(seen) == 2
        assert len(sleeps) == 1

    @pytest.mark.parametrize("code", [500, 502, 503, 504])
    def test_5xx_then_200_succeeds(self, responder: Any, code: int) -> None:
        seen = responder([_status(code), _ok()])
        assert nestjs_client.trigger_opensearch_index(DOC_ID) is True
        assert len(seen) == 2

    def test_timeout_then_200_succeeds(self, responder: Any) -> None:
        seen = responder([httpx.ReadTimeout("too slow"), _ok()])
        assert nestjs_client.trigger_opensearch_index(DOC_ID) is True
        assert len(seen) == 2

    def test_connection_error_then_200_succeeds(self, responder: Any) -> None:
        seen = responder([httpx.ConnectError("refused"), _ok()])
        assert nestjs_client.trigger_opensearch_index(DOC_ID) is True
        assert len(seen) == 2


class TestRetryAfter:
    def test_retry_after_is_honoured_over_the_computed_backoff(
        self, responder: Any, sleeps: list[float]
    ) -> None:
        responder([_status(429, **{"Retry-After": "7"}), _ok()])
        assert nestjs_client.trigger_opensearch_index(DOC_ID) is True
        assert sleeps == [7.0]

    def test_retry_after_is_capped(
        self, responder: Any, sleeps: list[float]
    ) -> None:
        responder([_status(429, **{"Retry-After": "99999"}), _ok()])
        nestjs_client.trigger_opensearch_index(DOC_ID)
        assert sleeps == [nestjs_client.MAX_RETRY_AFTER_SEC]

    @pytest.mark.parametrize(
        "value", ["Wed, 21 Oct 2026 07:28:00 GMT", "soon", "-5", ""]
    )
    def test_unparseable_retry_after_falls_back_to_backoff(
        self, responder: Any, sleeps: list[float], value: str
    ) -> None:
        responder([_status(429, **{"Retry-After": value}), _ok()])
        nestjs_client.trigger_opensearch_index(DOC_ID)
        assert len(sleeps) == 1
        # Full jitter over [0, base * 2^0]; never the header's value.
        assert 0.0 <= sleeps[0] <= settings.opensearch_index_retry_base_delay


class TestNotRetryable:
    @pytest.mark.parametrize("code", [401, 404, 400, 403])
    def test_client_errors_are_not_retried(
        self, responder: Any, sleeps: list[float], code: int
    ) -> None:
        seen = responder([_status(code)])
        assert nestjs_client.trigger_opensearch_index(DOC_ID) is False
        assert len(seen) == 1
        assert sleeps == []


class TestExhaustion:
    def test_exhaustion_returns_false_after_max_attempts(
        self, responder: Any, sleeps: list[float]
    ) -> None:
        attempts = settings.opensearch_index_max_attempts
        seen = responder([_status(429) for _ in range(attempts)])
        assert nestjs_client.trigger_opensearch_index(DOC_ID) is False
        assert len(seen) == attempts
        # One sleep between attempts, none after the last.
        assert len(sleeps) == attempts - 1

    def test_final_status_code_is_logged(
        self,
        responder: Any,
        sleeps: list[float],
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        attempts = settings.opensearch_index_max_attempts
        responder([_status(503) for _ in range(attempts)])
        with caplog.at_level("ERROR", logger=nestjs_client.__name__):
            assert nestjs_client.trigger_opensearch_index(DOC_ID) is False
        # The whole point: after the fact a 429 must be distinguishable from
        # a 500 without re-querying prod.
        assert "HTTP 503" in caplog.text
        assert DOC_ID in caplog.text

    def test_attempt_count_is_configurable(
        self,
        responder: Any,
        sleeps: list[float],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(settings, "opensearch_index_max_attempts", 2)
        seen = responder([_status(429), _status(429)])
        assert nestjs_client.trigger_opensearch_index(DOC_ID) is False
        assert len(seen) == 2

    def test_backoff_grows_with_the_attempt_number(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "opensearch_index_retry_base_delay", 1.0)
        # Full jitter is uniform over [0, ceiling]; pin the ceiling by making
        # random.uniform return its upper bound.
        monkeypatch.setattr(nestjs_client.random, "uniform", lambda _lo, hi: hi)
        assert [nestjs_client._backoff_delay(n) for n in (1, 2, 3)] == [
            1.0,
            2.0,
            4.0,
        ]

    def test_backoff_is_jittered(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # A burst of failures must not re-converge on the gateway in lockstep.
        monkeypatch.setattr(settings, "opensearch_index_retry_base_delay", 1.0)
        assert len({nestjs_client._backoff_delay(3) for _ in range(20)}) > 1
