"""HTTP endpoint tests for the /passages router.

Mocks ``retrieve_by_query`` so the tests don't touch OpenSearch. The router is
a thin wrapper, so coverage focuses on request validation and that the request
fields make it through to the retrieval helper unchanged.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from src.core.schemas import Passage
from src.main import app


@pytest_asyncio.fixture()
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


def _fake_passage(idx: int, text: str = "lorem ipsum") -> Passage:
    return Passage(
        id=f"hit-{idx}",
        document_id=f"doc-{idx:04d}",
        section_id=None,
        title=f"Doc {idx}",
        citation_text=f"G.R. No. {100000 + idx}",
        text=text,
        court="Supreme Court",
        decision_date="2024-01-15",
        document_type="case",
        source_authority_level="official",
        score=0.85,
        bm25_score=0.85,
        knn_score=0.0,
        rerank_score=None,
    )


class TestPassagesRetrieveEndpoint:
    @pytest.mark.asyncio
    @patch("src.passages.router.retrieve_by_query")
    async def test_happy_path_respects_top_k(
        self,
        mock_retrieve: AsyncMock,
        client: AsyncClient,
    ) -> None:
        mock_retrieve.return_value = [_fake_passage(i) for i in range(1, 4)]

        resp = await client.post(
            "/passages/retrieve",
            json={"query": "habeas corpus remedy", "top_k": 3},
        )

        assert resp.status_code == 200
        data = resp.json()
        assert len(data["passages"]) == 3
        assert data["passages"][0]["id"] == "hit-1"

        mock_retrieve.assert_awaited_once()
        kwargs = mock_retrieve.await_args.kwargs
        assert kwargs["query"] == "habeas corpus remedy"
        assert kwargs["top_k"] == 3

    @pytest.mark.asyncio
    @patch("src.passages.router.retrieve_by_query")
    async def test_text_truncate_is_forwarded(
        self,
        mock_retrieve: AsyncMock,
        client: AsyncClient,
    ) -> None:
        mock_retrieve.return_value = [_fake_passage(1, text="x" * 500)]

        resp = await client.post(
            "/passages/retrieve",
            json={
                "query": "double jeopardy",
                "top_k": 1,
                "text_truncate": 500,
            },
        )

        assert resp.status_code == 200
        kwargs = mock_retrieve.await_args.kwargs
        assert kwargs["text_truncate"] == 500

    @pytest.mark.asyncio
    @patch("src.passages.router.retrieve_by_query")
    async def test_rejects_empty_query(
        self,
        mock_retrieve: AsyncMock,
        client: AsyncClient,
    ) -> None:
        resp = await client.post(
            "/passages/retrieve",
            json={"query": "", "top_k": 5},
        )
        assert resp.status_code == 422
        mock_retrieve.assert_not_called()

    @pytest.mark.asyncio
    @patch("src.passages.router.retrieve_by_query")
    async def test_rejects_top_k_out_of_range(
        self,
        mock_retrieve: AsyncMock,
        client: AsyncClient,
    ) -> None:
        resp = await client.post(
            "/passages/retrieve",
            json={"query": "valid query", "top_k": 50},
        )
        assert resp.status_code == 422
        mock_retrieve.assert_not_called()

    @pytest.mark.asyncio
    @patch("src.passages.router.retrieve_by_query")
    async def test_text_truncate_below_minimum_rejected(
        self,
        mock_retrieve: AsyncMock,
        client: AsyncClient,
    ) -> None:
        resp = await client.post(
            "/passages/retrieve",
            json={"query": "valid", "text_truncate": 100},
        )
        assert resp.status_code == 422
        mock_retrieve.assert_not_called()
