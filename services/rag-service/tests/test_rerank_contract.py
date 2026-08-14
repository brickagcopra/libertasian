"""The cross-service contract between rag-service and reranker-service.

`core/reranking.py` was written long before reranker-service existed and its
request/response shapes were frozen by that client. Nothing in either codebase
types the two halves together: rag-service builds a dict and parses a dict, and
reranker-service declares Pydantic models in a different package. A drift on
either side produces a 4xx/parse failure that `rerank_passages` catches and
turns into an RRF fallback — an answer that still comes back, just silently
ordered by rank position instead of relevance. Exactly the class of silent
degradation this epic has spent three PRs eliminating.

So this test drives the REAL client against the REAL service schemas:

  * the payload `_call_reranker` sends must validate as `RerankRequest`
  * a `RerankResponse` the service would emit must parse back into passages

reranker-service's schema module is loaded by file path rather than imported,
because both services name their top-level package `src` and only one can win
on `sys.path`.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from src.core.reranking import _call_reranker
from src.core.schemas import Passage

_REPO_ROOT = Path(__file__).resolve().parents[3]
_RERANKER_SCHEMAS = _REPO_ROOT / "services/reranker-service/src/rerank/schemas.py"


def _load_reranker_schemas() -> Any:
    """Load reranker-service's schemas module standalone, under its own name."""
    spec = importlib.util.spec_from_file_location(
        "reranker_service_schemas", _RERANKER_SCHEMAS
    )
    assert spec and spec.loader, f"cannot load {_RERANKER_SCHEMAS}"
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _passage(pid: str, text: str = "passage body", score: float = 0.5) -> Passage:
    return Passage(id=pid, document_id=f"doc-{pid}", text=text, score=score)


async def _capture_payload(
    passages: list[Passage], query: str = "What is estafa?"
) -> dict[str, Any]:
    """Run the real client and return the exact JSON body it posted."""
    captured: dict[str, Any] = {}

    response = MagicMock()
    response.json.return_value = {"results": [{"id": p.id, "score": 0.5} for p in passages]}
    response.raise_for_status = lambda: None

    async def _post(
        url: str, json: dict[str, Any], headers: dict[str, str] | None = None
    ) -> Any:
        captured.update(json)
        return response

    with patch("src.core.reranking.httpx.AsyncClient") as mock_client:
        instance = MagicMock()
        instance.post = _post
        instance.__aenter__ = _async_return(instance)
        instance.__aexit__ = _async_return(False)
        mock_client.return_value = instance
        await _call_reranker("http://reranker-service:8002", query, passages)

    return captured


def _async_return(value: Any) -> Any:
    async def _inner(*_args: Any, **_kwargs: Any) -> Any:
        return value

    return _inner


class TestSchemaFileIsPresent:
    def test_reranker_schemas_exist(self) -> None:
        """A moved service must fail loudly, not skip the contract."""
        assert _RERANKER_SCHEMAS.is_file(), f"not found: {_RERANKER_SCHEMAS}"


class TestRequestShape:
    """What the client sends must be what the service accepts."""

    @pytest.mark.asyncio
    async def test_payload_validates_as_request(self) -> None:
        schemas = _load_reranker_schemas()
        payload = await _capture_payload([_passage("p1"), _passage("p2")])

        model = schemas.RerankRequest.model_validate(payload)

        assert model.query == "What is estafa?"
        assert [p.id for p in model.passages] == ["p1", "p2"]

    @pytest.mark.asyncio
    async def test_payload_keys_are_exactly_expected(self) -> None:
        """Strict-mode models reject unknown keys; catch an added field here."""
        schemas = _load_reranker_schemas()
        payload = await _capture_payload([_passage("p1")])

        assert set(payload) == set(schemas.RerankRequest.model_fields)
        assert set(payload["passages"][0]) == set(schemas.RerankPassage.model_fields)

    @pytest.mark.asyncio
    async def test_truncated_text_is_within_limits(self) -> None:
        """The client truncates to 1000 chars; the service must accept that."""
        schemas = _load_reranker_schemas()
        payload = await _capture_payload([_passage("p1", text="x" * 5000)])

        assert len(payload["passages"][0]["text"]) == 1000
        schemas.RerankRequest.model_validate(payload)

    @pytest.mark.asyncio
    async def test_empty_passage_text_is_accepted(self) -> None:
        """A hit with no body text still has to be scoreable, not a 422."""
        schemas = _load_reranker_schemas()
        payload = await _capture_payload([_passage("p1", text="")])

        schemas.RerankRequest.model_validate(payload)


class TestResponseShape:
    """What the service returns must be what the client parses."""

    @pytest.mark.asyncio
    # Name length is load-bearing: TruffleHog's Lob detector matches `test_`
    # plus exactly 35 characters and reports it as a VERIFIED secret.
    async def test_response_parses_into_scores(self) -> None:
        schemas = _load_reranker_schemas()
        passages = [_passage("p1"), _passage("p2")]

        # Built through the service's own model, so a renamed field fails here.
        service_response = schemas.RerankResponse(
            results=[
                schemas.RerankResult(id="p1", score=0.9312),
                schemas.RerankResult(id="p2", score=0.0041),
            ],
            model_name="BAAI/bge-reranker-base",
            count=2,
        ).model_dump()

        response = MagicMock()
        response.json.return_value = service_response
        response.raise_for_status = lambda: None

        async def _post(
        url: str, json: dict[str, Any], headers: dict[str, str] | None = None
    ) -> Any:
            return response

        with patch("src.core.reranking.httpx.AsyncClient") as mock_client:
            instance = MagicMock()
            instance.post = _post
            instance.__aenter__ = _async_return(instance)
            instance.__aexit__ = _async_return(False)
            mock_client.return_value = instance
            reranked = await _call_reranker("http://reranker-service:8002", "q", passages)

        by_id = {p.id: p.rerank_score for p in reranked}
        assert by_id == {"p1": pytest.approx(0.9312), "p2": pytest.approx(0.0041)}

    def test_result_field_names_match(self) -> None:
        """`_call_reranker` indexes result['id'] and result['score'] by name."""
        schemas = _load_reranker_schemas()

        assert set(schemas.RerankResult.model_fields) >= {"id", "score"}

    def test_results_key_is_named_results(self) -> None:
        """The client reads `data.get("results", [])` — a rename is a silent
        empty score map, i.e. every rerank_score None."""
        schemas = _load_reranker_schemas()

        assert "results" in schemas.RerankResponse.model_fields

    def test_score_is_a_float(self) -> None:
        """It feeds `check_abstention`'s numeric threshold comparison."""
        schemas = _load_reranker_schemas()

        assert schemas.RerankResult.model_fields["score"].annotation is float


class TestScoreRangeContract:
    """`score` is 0-1, and `abstention_score_threshold` depends on it.

    These read the DECLARED DEFAULT off the Settings class rather than the
    live `settings` object, because `conftest._patch_settings` pins the
    threshold to 0.01 for the rest of the suite — reading the instance would
    assert against the fixture instead of the shipped configuration.
    """

    @staticmethod
    def _declared_threshold() -> float:
        from src.config import Settings

        default = Settings.model_fields["abstention_score_threshold"].default
        assert isinstance(default, float)
        return default

    def test_threshold_sits_inside_unit_range(self) -> None:
        assert 0.0 < self._declared_threshold() < 1.0

    def test_threshold_rederived_for_reranker(self) -> None:
        """0.01 was the pre-reranker default, chosen against RRF scores. It
        would abstain on a query measured as answerable (lowest answerable
        top-1 was 0.0044), so carrying it over would have been a regression the
        moment the reranker shipped."""
        threshold = self._declared_threshold()

        assert threshold != 0.01
        assert threshold < 0.0044

    def test_threshold_above_model_noise_floor(self) -> None:
        """Measured: both deliberately-unanswerable queries scored 3.74e-05.
        A threshold at or below that would never abstain on anything."""
        assert self._declared_threshold() > 3.75e-05
