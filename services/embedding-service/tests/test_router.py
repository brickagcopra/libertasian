"""Tests for embedding service FastAPI router endpoints."""

import pytest
from unittest.mock import patch, AsyncMock

from httpx import AsyncClient, ASGITransport

from src.main import app


@pytest.fixture
def mock_embed_text():
    """Mock the embed_text service function."""
    with patch("src.embed.router.embed_text", new_callable=AsyncMock) as mock:
        mock.return_value = [0.1] * 384
        yield mock


@pytest.fixture
def mock_embed_batch():
    """Mock the embed_batch service function."""
    with patch("src.embed.router.embed_batch", new_callable=AsyncMock) as mock:
        mock.return_value = [[0.1] * 384, [0.2] * 384]
        yield mock


class TestHealthEndpoint:
    """Tests for the /health endpoint."""

    @pytest.mark.asyncio
    async def test_health_returns_ok(self):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.get("/health")

        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert data["service"] == "embedding-service"
        assert "model_name" in data
        assert "embedding_dim" in data
        assert "version" in data


class TestEmbedSingleEndpoint:
    """Tests for POST /embed endpoint."""

    @pytest.mark.asyncio
    async def test_embed_single_text(self, mock_embed_text):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post("/embed", json={"text": "hello world"})

        assert resp.status_code == 200
        data = resp.json()
        assert "embedding" in data
        assert len(data["embedding"]) == 384
        assert "model_name" in data
        assert "dimension" in data
        mock_embed_text.assert_called_once_with("hello world")

    @pytest.mark.asyncio
    async def test_embed_empty_text_rejected(self):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post("/embed", json={"text": ""})

        assert resp.status_code == 422  # Pydantic validation error

    @pytest.mark.asyncio
    async def test_embed_missing_text_rejected(self):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post("/embed", json={})

        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_embed_service_error_returns_500(self):
        with patch(
            "src.embed.router.embed_text",
            new_callable=AsyncMock,
            side_effect=RuntimeError("Model failed"),
        ):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                resp = await client.post("/embed", json={"text": "test"})

            assert resp.status_code == 500
            assert "failed" in resp.json()["detail"].lower()


class TestEmbedBatchEndpoint:
    """Tests for POST /embed/batch endpoint."""

    @pytest.mark.asyncio
    async def test_embed_batch(self, mock_embed_batch):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post("/embed/batch", json={"texts": ["hello", "world"]})

        assert resp.status_code == 200
        data = resp.json()
        assert "embeddings" in data
        assert len(data["embeddings"]) == 2
        assert data["count"] == 2
        assert "model_name" in data
        mock_embed_batch.assert_called_once_with(["hello", "world"])

    @pytest.mark.asyncio
    async def test_embed_batch_empty_list_rejected(self):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post("/embed/batch", json={"texts": []})

        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_embed_batch_missing_texts_rejected(self):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post("/embed/batch", json={})

        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_embed_batch_service_error_returns_500(self):
        with patch(
            "src.embed.router.embed_batch",
            new_callable=AsyncMock,
            side_effect=RuntimeError("Batch failed"),
        ):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                resp = await client.post("/embed/batch", json={"texts": ["test"]})

            assert resp.status_code == 500
            assert "failed" in resp.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_embed_batch_single_item(self, mock_embed_batch):
        mock_embed_batch.return_value = [[0.1] * 384]
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post("/embed/batch", json={"texts": ["single"]})

        assert resp.status_code == 200
        data = resp.json()
        assert data["count"] == 1
