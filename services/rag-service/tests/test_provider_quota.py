"""OpenAI quota exhaustion: 503 mapping, circuit breaker, and retry policy.

On 2026-09-26 every OpenAI call returned 429 ``insufficient_quota`` /
``credit_balance_exhausted`` for ~8 hours. These tests pin the fix:

- quota exhaustion raises ProviderQuotaExhaustedError, is never retried, and
  trips the ``llm:provider:quota_exhausted`` breaker (SET NX, 300s TTL);
- while the breaker is set no OpenAI call is made at all;
- a Redis outage fails OPEN (the call proceeds);
- a plain ``rate_limit_exceeded`` 429 is still retried twice and then
  surfaces as the same RateLimitError as before;
- every generating route answers 503 with the "temporarily unavailable"
  body, and /answer/stream emits the same error chunk a budget stop does.

Route tests use their own ``pytest_asyncio`` client fixture (like
test_passages_router.py) so they run under pytest-asyncio strict mode.
"""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator, Iterator
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import openai
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from src.config import settings
from src.core import generation
from src.core.generation import (
    QUOTA_BREAKER_KEY,
    QUOTA_BREAKER_TTL_SECONDS,
    generate_completion,
    generate_completion_with_usage,
    stream_completion,
)
from src.core.ranked import RankedPassages
from src.main import app
from src.shared.exceptions import BudgetExceededError, ProviderQuotaExhaustedError

UNAVAILABLE = "AI generation is temporarily unavailable. Please try again later."


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------
class FakeRedis:
    """Just enough of redis.asyncio for the budget check + breaker."""

    def __init__(self, *, down: bool = False) -> None:
        self.down = down
        self.store: dict[str, str] = {}
        self.set_calls: list[tuple[str, str, int | None, bool]] = []

    async def get(self, key: str) -> str | None:
        if self.down:
            raise ConnectionError("redis down")
        return self.store.get(key)

    async def hget(self, key: str, field: str) -> str | None:  # noqa: ARG002
        if self.down:
            raise ConnectionError("redis down")
        return None

    async def set(
        self, key: str, value: str, *, ex: int | None = None, nx: bool = False
    ) -> bool | None:
        if self.down:
            raise ConnectionError("redis down")
        self.set_calls.append((key, value, ex, nx))
        if nx and key in self.store:
            return None
        self.store[key] = value
        return True

    def pipeline(self) -> MagicMock:
        pipe = MagicMock()
        pipe.execute = AsyncMock(return_value=[])
        return pipe


def _request() -> httpx.Request:
    return httpx.Request("POST", "https://api.openai.com/v1/chat/completions")


def _rate_limit_error(
    *, code: str | None, err_type: str | None, envelope: bool = False
) -> openai.RateLimitError:
    """Build the RateLimitError the SDK raises for a 429.

    ``envelope=True`` passes the full ``{"error": {...}}`` body, for which the
    SDK leaves ``.code``/``.type`` as None; the classifier must still read
    them out of ``.body``.
    """
    inner = {"message": "boom", "type": err_type, "code": code, "param": None}
    body: dict[str, Any] = {"error": inner} if envelope else inner
    response = httpx.Response(429, request=_request())
    return openai.RateLimitError("Error code: 429", response=response, body=body)


def _quota_error(envelope: bool = False) -> openai.RateLimitError:
    return _rate_limit_error(
        code="credit_balance_exhausted", err_type="insufficient_quota", envelope=envelope
    )


def _ok_response(content: str = "ok") -> MagicMock:
    resp = MagicMock()
    resp.choices = [MagicMock()]
    resp.choices[0].message.content = content
    resp.usage = MagicMock(prompt_tokens=10, completion_tokens=5)
    return resp


class Env:
    def __init__(self, redis: FakeRedis, create: AsyncMock) -> None:
        self.redis = redis
        self.create = create


@pytest.fixture()
def env(monkeypatch: pytest.MonkeyPatch) -> Iterator[Env]:
    """OpenAI backend on, fake Redis, mocked OpenAI client, zero retry delay."""
    redis = FakeRedis()
    create = AsyncMock(side_effect=_quota_error())
    client = MagicMock()
    client.chat.completions.create = create

    monkeypatch.setattr(settings, "openai_api_key", "sk-test")
    monkeypatch.setattr(settings, "internal_api_key", "")
    monkeypatch.setattr(generation, "_retry_delay", lambda exc, attempt: 0.0)

    async def _get_redis() -> FakeRedis:
        return redis

    with (
        patch("src.core.generation._get_redis", _get_redis),
        patch("src.core.generation._get_openai_client", return_value=client),
    ):
        yield Env(redis, create)


# ---------------------------------------------------------------------------
# Core: classification, breaker, retries
# ---------------------------------------------------------------------------
class TestQuotaClassification:
    @pytest.mark.parametrize("envelope", [False, True])
    @pytest.mark.parametrize(
        ("code", "err_type"),
        [
            ("insufficient_quota", "insufficient_quota"),
            ("credit_balance_exhausted", "insufficient_quota"),
            ("credit_balance_exhausted", None),
            (None, "insufficient_quota"),
        ],
    )
    def test_quota_variants(
        self, code: str | None, err_type: str | None, envelope: bool
    ) -> None:
        exc = _rate_limit_error(code=code, err_type=err_type, envelope=envelope)
        assert generation._is_quota_exhausted(exc)

    @pytest.mark.parametrize("envelope", [False, True])
    def test_plain_rate_limit_is_not_quota(self, envelope: bool) -> None:
        exc = _rate_limit_error(
            code="rate_limit_exceeded", err_type="requests", envelope=envelope
        )
        assert not generation._is_quota_exhausted(exc)

    def test_quota_error_is_a_budget_error(self) -> None:
        # Every place that maps BudgetExceededError to "unavailable" covers it.
        assert issubclass(ProviderQuotaExhaustedError, BudgetExceededError)

    def test_real_client_has_sdk_retries_disabled(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "openai_api_key", "sk-test")
        monkeypatch.setattr(generation, "_openai_client", None)
        client = generation._get_openai_client()
        assert client.max_retries == 0
        monkeypatch.setattr(generation, "_openai_client", None)


class TestQuotaBreaker:
    @pytest.mark.asyncio
    async def test_exhaustion_raises_and_sets_breaker_without_retry(
        self, env: Env
    ) -> None:
        with pytest.raises(ProviderQuotaExhaustedError):
            await generate_completion("sys", "user")

        assert env.create.await_count == 1  # never retried
        assert env.redis.store[QUOTA_BREAKER_KEY]
        key, _value, ttl, nx = env.redis.set_calls[0]
        assert (key, ttl, nx) == (QUOTA_BREAKER_KEY, 300, True)
        assert QUOTA_BREAKER_TTL_SECONDS == 300

    @pytest.mark.asyncio
    async def test_envelope_body_also_trips(self, env: Env) -> None:
        env.create.side_effect = _quota_error(envelope=True)
        with pytest.raises(ProviderQuotaExhaustedError):
            await generate_completion_with_usage("sys", "user")
        assert QUOTA_BREAKER_KEY in env.redis.store

    @pytest.mark.asyncio
    async def test_breaker_set_means_no_openai_call(self, env: Env) -> None:
        env.redis.store[QUOTA_BREAKER_KEY] = "credit_balance_exhausted"

        with pytest.raises(ProviderQuotaExhaustedError):
            await generate_completion("sys", "user")
        with pytest.raises(ProviderQuotaExhaustedError):
            await generate_completion_with_usage("sys", "user")
        with pytest.raises(ProviderQuotaExhaustedError):
            async for _ in stream_completion("sys", "user"):
                pass

        env.create.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_one_error_log_per_trip(
        self, env: Env, caplog: pytest.LogCaptureFixture
    ) -> None:
        caplog.set_level(logging.ERROR, logger="src.core.generation")
        # Three in-flight requests that all got past the breaker check before
        # the first one set the key: only the SET NX winner logs.
        for _ in range(3):
            with pytest.raises(ProviderQuotaExhaustedError):
                await _call_bypassing_check(env)

        errors = [r for r in caplog.records if r.levelno == logging.ERROR]
        assert len(errors) == 1
        assert getattr(errors[0], "event", None) == "llm_provider_quota_exhausted"
        assert len(env.redis.set_calls) == 3  # SET NX attempted each time

    @pytest.mark.asyncio
    async def test_redis_down_fails_open(self, env: Env) -> None:
        env.redis.down = True
        env.create.side_effect = None
        env.create.return_value = _ok_response("hello")

        # _check_budget still needs Redis, so exercise the breaker path directly.
        await generation._check_quota_breaker()
        result = await generation._openai_create(
            generation._get_openai_client(), model="m", messages=[]
        )

        assert result.choices[0].message.content == "hello"
        env.create.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_redis_down_still_raises_quota_error(self, env: Env) -> None:
        env.redis.down = True
        with pytest.raises(ProviderQuotaExhaustedError):
            await generation._openai_create(
                generation._get_openai_client(), model="m", messages=[]
            )


async def _call_bypassing_check(env: Env) -> Any:
    """Call _openai_create as if each request raced past the breaker check."""
    with patch("src.core.generation._check_quota_breaker", AsyncMock()):
        return await generation._openai_create(
            generation._get_openai_client(), model="m", messages=[]
        )


class TestPlainRateLimitUnchanged:
    @pytest.mark.asyncio
    async def test_rate_limit_retried_twice_then_raised(self, env: Env) -> None:
        env.create.side_effect = _rate_limit_error(
            code="rate_limit_exceeded", err_type="requests"
        )
        with pytest.raises(openai.RateLimitError):
            await generate_completion("sys", "user")

        assert env.create.await_count == 3  # 1 + SDK-default 2 retries
        assert QUOTA_BREAKER_KEY not in env.redis.store

    @pytest.mark.asyncio
    async def test_rate_limit_recovers_on_retry(self, env: Env) -> None:
        env.create.side_effect = [
            _rate_limit_error(code="rate_limit_exceeded", err_type="requests"),
            _ok_response("second time"),
        ]
        assert await generate_completion("sys", "user") == "second time"
        assert env.create.await_count == 2

    @pytest.mark.asyncio
    async def test_server_error_still_retried(self, env: Env) -> None:
        response = httpx.Response(500, request=_request())
        env.create.side_effect = [
            openai.InternalServerError("boom", response=response, body=None),
            _ok_response("ok"),
        ]
        assert await generate_completion("sys", "user") == "ok"

    @pytest.mark.asyncio
    async def test_bad_request_not_retried(self, env: Env) -> None:
        response = httpx.Response(400, request=_request())
        env.create.side_effect = openai.BadRequestError(
            "bad", response=response, body=None
        )
        with pytest.raises(openai.BadRequestError):
            await generate_completion("sys", "user")
        assert env.create.await_count == 1

    def test_retry_after_header_honoured(self) -> None:
        response = httpx.Response(429, request=_request(), headers={"retry-after": "3"})
        exc = openai.RateLimitError("x", response=response, body=None)
        assert generation._retry_delay(exc, 0) == 3.0

    def test_backoff_without_header(self) -> None:
        response = httpx.Response(429, request=_request())
        exc = openai.RateLimitError("x", response=response, body=None)
        assert 0.375 <= generation._retry_delay(exc, 0) <= 0.5
        assert 6.0 <= generation._retry_delay(exc, 10) <= 8.0


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@pytest_asyncio.fixture()
async def client() -> AsyncIterator[AsyncClient]:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


def _ranked(make_passage: Any) -> RankedPassages:
    return RankedPassages(
        passages=[make_passage() for _ in range(4)],
        top_rerank_score=0.9,
    )


def _assert_503(resp: httpx.Response) -> None:
    assert resp.status_code == 503, resp.text
    body = resp.json()
    assert body["detail"] == UNAVAILABLE
    assert body["code"] == "provider_quota_exhausted"


class TestRoutesEndToEnd:
    """Real generation code, mocked OpenAI returning the quota 429."""

    @pytest.mark.asyncio
    async def test_completions(self, env: Env, client: AsyncClient) -> None:
        resp = await client.post(
            "/completions/generate",
            json={"system_prompt": "s", "user_prompt": "u", "response_format": "json"},
        )
        _assert_503(resp)
        assert QUOTA_BREAKER_KEY in env.redis.store
        assert env.create.await_count == 1

    @pytest.mark.asyncio
    async def test_breaker_open_route_makes_no_call(
        self, env: Env, client: AsyncClient
    ) -> None:
        env.redis.store[QUOTA_BREAKER_KEY] = "insufficient_quota"
        resp = await client.post(
            "/completions/generate", json={"system_prompt": "s", "user_prompt": "u"}
        )
        _assert_503(resp)
        env.create.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_answer(
        self, env: Env, client: AsyncClient, make_passage: Any
    ) -> None:
        with (
            patch("src.answer.service._retrieve", AsyncMock(return_value=_ranked(make_passage))),
            patch("src.answer.service.check_abstention", return_value=None),
        ):
            resp = await client.post("/answer", json={"query": "What is habeas corpus?"})
        _assert_503(resp)

    @pytest.mark.asyncio
    async def test_answer_stream_emits_budget_error_chunk(
        self, env: Env, client: AsyncClient, make_passage: Any
    ) -> None:
        with (
            patch("src.answer.service._retrieve", AsyncMock(return_value=_ranked(make_passage))),
            patch("src.answer.service.check_abstention", return_value=None),
        ):
            resp = await client.post(
                "/answer/stream", json={"query": "What is habeas corpus?"}
            )
        assert resp.status_code == 200
        chunks = [
            json.loads(line[6:])
            for line in resp.text.splitlines()
            if line.startswith("data: ")
        ]
        assert chunks[-1]["type"] == "error"
        # Byte-identical to what a BudgetExceededError produces today.
        assert chunks[-1]["content"] == (
            "An error occurred while generating the answer: BudgetExceededError"
        )

    # /memos/generate and /comparisons/generate cannot be reached over HTTP
    # in a test: their strict-mode request models reject every JSON string
    # for the enum fields (memo_type, comparison_type) with a 422, before the
    # handler runs. That is a pre-existing bug, logged in pending-tasks. The
    # endpoint functions are called directly instead; the exception they
    # raise is what the app-level 503 handler (covered above and below) maps.
    @pytest.mark.asyncio
    async def test_memos_endpoint(self, env: Env, make_passage: Any) -> None:
        from src.memos.router import generate_memo_endpoint
        from src.memos.schemas import MemoGenerationRequest, MemoType, OutputType

        with patch(
            "src.memos.service.retrieve_ranked",
            AsyncMock(return_value=_ranked(make_passage)),
        ):
            with pytest.raises(ProviderQuotaExhaustedError):
                await generate_memo_endpoint(
                    MemoGenerationRequest(
                        query="Is a verbal lease valid?",
                        memo_type=MemoType.LEGAL_OPINION,
                    )
                )
            with pytest.raises(ProviderQuotaExhaustedError):
                await generate_memo_endpoint(
                    MemoGenerationRequest(
                        query="Outline this for me",
                        memo_type=MemoType.LEGAL_OPINION,
                        output_type=OutputType.OUTLINE,
                        raw_text="Article 1305. A contract is a meeting of minds. " * 3,
                    )
                )
        assert env.create.await_count == 1  # second call short-circuited

    @pytest.mark.asyncio
    async def test_comparisons_endpoint(self, env: Env) -> None:
        from src.comparisons.router import generate_comparison_endpoint
        from src.comparisons.schemas import ComparisonRequest, ComparisonType

        with patch(
            "src.comparisons.router.generate_comparison",
            AsyncMock(side_effect=ProviderQuotaExhaustedError("quota")),
        ), pytest.raises(ProviderQuotaExhaustedError):
            await generate_comparison_endpoint(
                ComparisonRequest(
                    document_ids=["a", "b"], comparison_type=ComparisonType.FULL
                )
            )

    @pytest.mark.asyncio
    async def test_research_workspaces(
        self, env: Env, client: AsyncClient, make_passage: Any
    ) -> None:
        with patch(
            "src.research_workspaces.service.retrieve_ranked",
            AsyncMock(return_value=_ranked(make_passage)),
        ):
            resp = await client.post(
                "/research_workspaces/query",
                json={"query": "Is a verbal lease valid?"},
            )
        _assert_503(resp)

    @pytest.mark.asyncio
    async def test_digests(self, env: Env, client: AsyncClient) -> None:
        resp = await client.post(
            "/digests/generate",
            json={
                "document_id": "doc-1",
                "sections": [
                    {"id": "s1", "section_type": "facts", "plain_text": "Facts here."}
                ],
            },
        )
        _assert_503(resp)


# Every other generating route: the service raises, the app must answer 503.
_OTHER_ROUTES: list[tuple[str, str, dict[str, Any]]] = [
    ("src.doctrines.router.extract_doctrines", "/doctrines/extract", {"document_id": "d"}),
    ("src.flashcards.router.generate_flashcards", "/flashcards/generate", {"topic": "habeas corpus"}),
    ("src.contradictions.router.generate_contradiction_report", "/contradictions/generate", {
        "document_ids": ["a", "b"],
    }),
    ("src.hearing_prep.router.generate_hearing_prep", "/hearing-prep/generate", {"topic": "bail hearing"}),
    ("src.pleadings.router.generate_pleading", "/pleadings/generate", {
        "template_name": "t", "template_category": "c", "template_json": {}, "input_data": {},
    }),
    ("src.timelines.router.generate_timeline", "/timelines/generate", {
        "document_ids": ["a"], "title": "t",
    }),
    ("src.citations.router.suggest_case_codal_links", "/citations/suggest-case-codal", {
        "document_id": "d",
    }),
]


class TestOtherRoutesMapTo503:
    @pytest.mark.asyncio
    @pytest.mark.parametrize(("target", "path", "payload"), _OTHER_ROUTES)
    async def test_route(
        self,
        target: str,
        path: str,
        payload: dict[str, Any],
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(settings, "internal_api_key", "")
        with patch(
            target,
            AsyncMock(side_effect=ProviderQuotaExhaustedError("quota")),
        ):
            resp = await client.post(path, json=payload)
        _assert_503(resp)

    @pytest.mark.asyncio
    async def test_budget_errors_keep_their_body(
        self, client: AsyncClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "internal_api_key", "")
        with patch(
            "src.flashcards.router.generate_flashcards",
            AsyncMock(side_effect=BudgetExceededError("x", scope="flashcard", period="daily")),
        ):
            resp = await client.post("/flashcards/generate", json={"topic": "habeas corpus"})
        assert resp.status_code == 503
        assert resp.json() == {
            "detail": UNAVAILABLE,
            "code": "budget_exceeded",
            "scope": "flashcard",
            "period": "daily",
        }
