"""Tests for rerank/router.py — the HTTP surface, including auth.

The auth tests are the important ones here. embedding-service enforces
``X-Internal-Api-Key`` and rag-service's reranker client historically sent no
headers at all, so a service that enforces auth against a client that does not
send it produces a 403 that the client swallows into an RRF fallback — visually
identical to "no reranker deployed". Both halves are asserted: here that the
service rejects an unauthenticated call, and in rag-service's
`test_reranking.py` that the client sends the header.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from src.main import app


def _payload(n: int = 2) -> dict[str, Any]:
    return {
        "query": "What is estafa under Philippine law?",
        "passages": [{"id": f"p{i}", "text": f"passage body {i}"} for i in range(n)],
    }


@pytest.fixture
def client() -> Any:
    return TestClient(app)


class TestAuth:
    def test_rejects_missing_key(self, client: Any, with_auth: str) -> None:
        response = client.post("/rerank", json=_payload())
        assert response.status_code == 403

    def test_rejects_wrong_key(self, client: Any, with_auth: str) -> None:
        response = client.post(
            "/rerank", json=_payload(), headers={"X-Internal-Api-Key": "wrong"}
        )
        assert response.status_code == 403

    def test_accepts_correct_key(self, client: Any, with_auth: str, mock_model: Any) -> None:
        with patch("src.rerank.service._get_model", return_value=mock_model):
            response = client.post(
                "/rerank", json=_payload(), headers={"X-Internal-Api-Key": with_auth}
            )
        assert response.status_code == 200

    def test_header_name_matches_embedding(self) -> None:
        """One header name across internal services, or callers get it wrong."""
        from src.shared.auth import _api_key_header

        assert _api_key_header.model.name == "X-Internal-Api-Key"

    def test_open_when_no_key_configured(
        self, client: Any, no_auth: Any, mock_model: Any
    ) -> None:
        """Dev mode, matching embedding-service."""
        with patch("src.rerank.service._get_model", return_value=mock_model):
            response = client.post("/rerank", json=_payload())
        assert response.status_code == 200


class TestRerankEndpoint:
    def test_returns_every_passage(self, client: Any, no_auth: Any, mock_model: Any) -> None:
        with patch("src.rerank.service._get_model", return_value=mock_model):
            response = client.post("/rerank", json=_payload(5))

        body = response.json()
        assert len(body["results"]) == 5
        assert body["count"] == 5

    def test_scores_are_in_unit_range(self, client: Any, no_auth: Any, mock_model: Any) -> None:
        with patch("src.rerank.service._get_model", return_value=mock_model):
            response = client.post("/rerank", json=_payload(5))

        assert all(0.0 <= r["score"] <= 1.0 for r in response.json()["results"])

    def test_results_are_sorted(self, client: Any, no_auth: Any, mock_model: Any) -> None:
        with patch("src.rerank.service._get_model", return_value=mock_model):
            response = client.post("/rerank", json=_payload(5))

        scores = [r["score"] for r in response.json()["results"]]
        assert scores == sorted(scores, reverse=True)

    def test_rejects_empty_passages(self, client: Any, no_auth: Any) -> None:
        response = client.post("/rerank", json={"query": "q", "passages": []})
        assert response.status_code == 422

    def test_rejects_empty_query(self, client: Any, no_auth: Any) -> None:
        response = client.post(
            "/rerank", json={"query": "", "passages": [{"id": "a", "text": "b"}]}
        )
        assert response.status_code == 422

    def test_rejects_too_many_passages(
        self, client: Any, no_auth: Any, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A cross-encoder is O(n) forward passes — an unbounded list pins CPU."""
        from src.config import settings

        monkeypatch.setattr(settings, "max_passages", 3)
        response = client.post("/rerank", json=_payload(10))
        assert response.status_code == 413

    def test_model_failure_returns_500(self, client: Any, no_auth: Any) -> None:
        with patch("src.rerank.service._get_model", side_effect=RuntimeError("no model")):
            response = client.post("/rerank", json=_payload())

        assert response.status_code == 500
        assert "Reranking failed" in response.json()["detail"]

    def test_empty_text_is_allowed(self, client: Any, no_auth: Any, mock_model: Any) -> None:
        """rag-service sends `p.text[:1000]`, which is "" for a textless hit."""
        with patch("src.rerank.service._get_model", return_value=mock_model):
            response = client.post(
                "/rerank", json={"query": "q", "passages": [{"id": "a", "text": ""}]}
            )
        assert response.status_code == 200


class TestHealth:
    def test_health_is_ok(self, client: Any) -> None:
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json()["status"] == "ok"
        assert response.json()["service"] == "reranker-service"

    def test_health_needs_no_auth(self, client: Any, with_auth: str) -> None:
        """The container healthcheck curls this with no headers."""
        assert client.get("/health").status_code == 200

    def test_health_does_not_load_model(self, client: Any) -> None:
        """Loading a cross-encoder on every healthcheck would be absurd."""
        with patch("src.rerank.service._get_model") as loader:
            client.get("/health")
        loader.assert_not_called()
