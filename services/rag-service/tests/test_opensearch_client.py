"""Tests for the shared OpenSearch client (auth, TLS, and failure propagation).

Regression cover for the 2026-05 → 2026-08 outage: the client was built with
neither auth nor a TLS verification setting, so every request against the prod
cluster (self-signed cert + basic auth) raised SSL: CERTIFICATE_VERIFY_FAILED —
and ``opensearch_search`` turned that into an empty hit set, making a total
connectivity failure look exactly like a query with no matches.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from src.config import Settings
from src.shared import opensearch as os_module
from src.shared.opensearch import (
    close_opensearch,
    get_opensearch,
    opensearch_search,
    ping_opensearch,
)


@pytest.fixture(autouse=True)
def _reset_client():
    """Drop the module-level singleton around every test."""
    os_module._client = None
    yield
    os_module._client = None


# ---------------------------------------------------------------------------
# Settings — where the credentials are actually read from
# ---------------------------------------------------------------------------


class TestCredentialSources:
    """The rag-service container already carries the UNPREFIXED pair.

    ``env_prefix`` is ``RAG_``, so declaring ``opensearch_username`` alone would
    have read only ``RAG_OPENSEARCH_USERNAME`` — which nothing sets — and the
    service would have traded CERTIFICATE_VERIFY_FAILED for a 401. These tests
    are what make the fix code-only: no .env edit, no compose edit.
    """

    def test_reads_unprefixed_env_pair(self, monkeypatch):
        monkeypatch.delenv("RAG_OPENSEARCH_USERNAME", raising=False)
        monkeypatch.delenv("RAG_OPENSEARCH_PASSWORD", raising=False)
        monkeypatch.setenv("OPENSEARCH_USERNAME", "admin")
        monkeypatch.setenv("OPENSEARCH_PASSWORD", "from-container-env")

        loaded = Settings(_env_file=None)

        assert loaded.opensearch_username == "admin"
        assert loaded.opensearch_password == "from-container-env"

    def test_reads_prefixed_env_pair(self, monkeypatch):
        monkeypatch.delenv("OPENSEARCH_USERNAME", raising=False)
        monkeypatch.delenv("OPENSEARCH_PASSWORD", raising=False)
        monkeypatch.setenv("RAG_OPENSEARCH_USERNAME", "rag-user")
        monkeypatch.setenv("RAG_OPENSEARCH_PASSWORD", "rag-secret")

        loaded = Settings(_env_file=None)

        assert loaded.opensearch_username == "rag-user"
        assert loaded.opensearch_password == "rag-secret"

    def test_prefixed_pair_wins_over_unprefixed(self, monkeypatch):
        """An explicit per-service override must beat the stack-wide default."""
        monkeypatch.setenv("OPENSEARCH_USERNAME", "shared")
        monkeypatch.setenv("OPENSEARCH_PASSWORD", "shared-secret")
        monkeypatch.setenv("RAG_OPENSEARCH_USERNAME", "rag-user")
        monkeypatch.setenv("RAG_OPENSEARCH_PASSWORD", "rag-secret")

        loaded = Settings(_env_file=None)

        assert loaded.opensearch_username == "rag-user"
        assert loaded.opensearch_password == "rag-secret"

    def test_no_credentials_when_neither_pair_is_set(self, monkeypatch):
        for name in (
            "OPENSEARCH_USERNAME",
            "OPENSEARCH_PASSWORD",
            "RAG_OPENSEARCH_USERNAME",
            "RAG_OPENSEARCH_PASSWORD",
        ):
            monkeypatch.delenv(name, raising=False)

        loaded = Settings(_env_file=None)

        assert loaded.opensearch_username == ""
        assert loaded.opensearch_password == ""

    def test_verify_ssl_defaults_false_for_the_self_signed_internal_cert(self, monkeypatch):
        monkeypatch.delenv("RAG_OPENSEARCH_VERIFY_SSL", raising=False)

        assert Settings(_env_file=None).opensearch_verify_ssl is False


# ---------------------------------------------------------------------------
# get_opensearch — auth + TLS wiring
# ---------------------------------------------------------------------------


def _client_kwargs(**setting_overrides: Any) -> dict[str, Any]:
    """Build the client under patched settings and return the httpx kwargs used."""
    with patch("src.shared.opensearch.httpx.AsyncClient") as mock_client_cls:
        mock_client_cls.return_value.is_closed = False
        with patch.multiple(os_module.settings, **setting_overrides):
            os_module._client = None
            get_opensearch()
    os_module._client = None
    return dict(mock_client_cls.call_args.kwargs)


class TestClientConfiguration:
    def test_basic_auth_wired_when_username_and_password_set(self):
        kwargs = _client_kwargs(opensearch_username="admin", opensearch_password="s3cret")
        assert kwargs["auth"] == ("admin", "s3cret")

    def test_no_auth_when_credentials_absent(self):
        kwargs = _client_kwargs(opensearch_username="", opensearch_password="")
        assert kwargs["auth"] is None

    def test_no_auth_when_only_username_set(self):
        """A half-configured pair must not produce a broken Authorization header."""
        kwargs = _client_kwargs(opensearch_username="admin", opensearch_password="")
        assert kwargs["auth"] is None

    def test_no_auth_when_only_password_set(self):
        kwargs = _client_kwargs(opensearch_username="", opensearch_password="s3cret")
        assert kwargs["auth"] is None

    def test_verify_ssl_disabled_for_self_signed_cert(self):
        kwargs = _client_kwargs(opensearch_verify_ssl=False)
        assert kwargs["verify"] is False

    def test_verify_ssl_honoured_when_enabled(self):
        kwargs = _client_kwargs(opensearch_verify_ssl=True)
        assert kwargs["verify"] is True

    def test_base_url_from_settings(self):
        kwargs = _client_kwargs(opensearch_url="https://opensearch:9200")
        assert kwargs["base_url"] == "https://opensearch:9200"

    def test_real_client_applies_basic_auth_header(self):
        """End-to-end on the real httpx client, not just the kwargs."""
        with patch.multiple(
            os_module.settings,
            opensearch_username="admin",
            opensearch_password="s3cret",
        ):
            client = get_opensearch()

        assert isinstance(client.auth, httpx.BasicAuth)
        request = httpx.Request("GET", "https://opensearch:9200/")
        authed = next(client.auth.auth_flow(request))
        assert authed.headers["Authorization"].startswith("Basic ")

    @pytest.mark.asyncio
    async def test_client_is_reused_across_calls(self):
        first = get_opensearch()
        second = get_opensearch()
        assert first is second
        await close_opensearch()

    @pytest.mark.asyncio
    async def test_closed_client_is_rebuilt(self):
        first = get_opensearch()
        await close_opensearch()
        second = get_opensearch()
        assert first is not second


# ---------------------------------------------------------------------------
# opensearch_search — failures must propagate, never masquerade as zero hits
# ---------------------------------------------------------------------------


class TestSearchFailurePropagation:
    @pytest.mark.asyncio
    async def test_connect_error_propagates(self):
        """A TLS/connection failure is an outage, not an empty result set."""
        fake = AsyncMock()
        fake.post = AsyncMock(side_effect=httpx.ConnectError("certificate verify failed"))

        with (
            patch.object(os_module, "get_opensearch", return_value=fake),
            pytest.raises(httpx.ConnectError),
        ):
            await opensearch_search("legal_documents_keyword", {"size": 1})

    @pytest.mark.asyncio
    async def test_http_status_error_propagates(self):
        """A 404 on a missing index must surface, not read as 'nothing matched'."""
        request = httpx.Request("POST", "https://opensearch:9200/nope/_search")
        response = httpx.Response(404, request=request, json={"error": "index_not_found"})
        fake = AsyncMock()
        fake.post = AsyncMock(return_value=response)

        with (
            patch.object(os_module, "get_opensearch", return_value=fake),
            pytest.raises(httpx.HTTPStatusError),
        ):
            await opensearch_search("nope", {"size": 1})

    @pytest.mark.asyncio
    async def test_auth_failure_propagates(self):
        request = httpx.Request("POST", "https://opensearch:9200/idx/_search")
        response = httpx.Response(401, request=request, json={"error": "Unauthorized"})
        fake = AsyncMock()
        fake.post = AsyncMock(return_value=response)

        with (
            patch.object(os_module, "get_opensearch", return_value=fake),
            pytest.raises(httpx.HTTPStatusError),
        ):
            await opensearch_search("idx", {"size": 1})

    @pytest.mark.asyncio
    async def test_failure_is_logged_at_error_level(self, caplog):
        fake = AsyncMock()
        fake.post = AsyncMock(side_effect=httpx.ConnectError("boom"))

        with (
            patch.object(os_module, "get_opensearch", return_value=fake),
            caplog.at_level("ERROR"),
            pytest.raises(httpx.ConnectError),
        ):
            await opensearch_search("legal_documents_keyword", {"size": 1})

        assert any(r.levelname == "ERROR" for r in caplog.records)

    @pytest.mark.asyncio
    async def test_successful_search_returns_parsed_body(self):
        payload: dict[str, Any] = {
            "hits": {"total": {"value": 2}, "hits": [{"_id": "a"}, {"_id": "b"}]},
        }
        request = httpx.Request("POST", "https://opensearch:9200/idx/_search")
        response = httpx.Response(200, request=request, json=payload)
        fake = AsyncMock()
        fake.post = AsyncMock(return_value=response)

        with patch.object(os_module, "get_opensearch", return_value=fake):
            result = await opensearch_search("idx", {"size": 2})

        assert result == payload
        assert len(result["hits"]["hits"]) == 2

    @pytest.mark.asyncio
    async def test_zero_hits_is_still_a_valid_empty_result(self):
        """A genuine no-match response must NOT raise — only failures do."""
        payload = {"hits": {"total": {"value": 0}, "hits": []}}
        request = httpx.Request("POST", "https://opensearch:9200/idx/_search")
        response = httpx.Response(200, request=request, json=payload)
        fake = AsyncMock()
        fake.post = AsyncMock(return_value=response)

        with patch.object(os_module, "get_opensearch", return_value=fake):
            result = await opensearch_search("idx", {"size": 2})

        assert result["hits"]["hits"] == []


# ---------------------------------------------------------------------------
# ping_opensearch — startup visibility
# ---------------------------------------------------------------------------


class TestPing:
    @pytest.mark.asyncio
    async def test_ping_returns_cluster_info(self):
        payload = {"version": {"distribution": "opensearch", "number": "2.11.0"}}
        request = httpx.Request("GET", "https://opensearch:9200/")
        response = httpx.Response(200, request=request, json=payload)
        fake = AsyncMock()
        fake.get = AsyncMock(return_value=response)

        with patch.object(os_module, "get_opensearch", return_value=fake):
            info = await ping_opensearch()

        assert info["version"]["number"] == "2.11.0"

    @pytest.mark.asyncio
    async def test_ping_raises_when_unreachable(self):
        fake = AsyncMock()
        fake.get = AsyncMock(side_effect=httpx.ConnectError("certificate verify failed"))

        with (
            patch.object(os_module, "get_opensearch", return_value=fake),
            pytest.raises(httpx.ConnectError),
        ):
            await ping_opensearch()
