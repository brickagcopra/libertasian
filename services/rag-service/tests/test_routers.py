"""HTTP endpoint tests for all RAG service routers (Phase 2 — Coverage Gaps).

Tests cover request validation, error handling, and response shape for
every FastAPI endpoint. Service logic is mocked to isolate HTTP behavior.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from src.main import app


@pytest.fixture()
async def client():
    """Async HTTP client for testing FastAPI endpoints."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


# ---- Health Check ----


class TestHealthEndpoint:
    @pytest.mark.asyncio
    async def test_health_check_returns_ok(self, client: AsyncClient):
        resp = await client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert data["service"] == "rag-service"
        assert "version" in data


# ---- /answer ----


class TestAnswerRouter:
    @pytest.mark.asyncio
    async def test_answer_rejects_empty_query(self, client: AsyncClient):
        resp = await client.post("/answer", json={"query": ""})
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_answer_rejects_short_query(self, client: AsyncClient):
        resp = await client.post("/answer", json={"query": "ab"})
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_answer_rejects_missing_query(self, client: AsyncClient):
        resp = await client.post("/answer", json={})
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_answer_rejects_query_too_long(self, client: AsyncClient):
        resp = await client.post("/answer", json={"query": "x" * 2001})
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_answer_rejects_invalid_max_passages(self, client: AsyncClient):
        resp = await client.post(
            "/answer", json={"query": "What is habeas corpus?", "max_passages": 50}
        )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_answer_rejects_zero_max_passages(self, client: AsyncClient):
        resp = await client.post(
            "/answer", json={"query": "What is habeas corpus?", "max_passages": 0}
        )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    @patch("src.answer.router.generate_answer")
    async def test_answer_success_response_shape(
        self, mock_generate: AsyncMock, client: AsyncClient
    ):
        mock_generate.return_value = MagicMock(
            answer="Habeas corpus is a legal remedy...",
            query="What is habeas corpus?",
            intent="legal_question",
            confidence=0.85,
            confidence_level="high",
            citations=[],
            sources=[],
            abstained=False,
            abstention_reason=None,
            model_name="test-model",
            prompt_template_version="v1",
            passages_used=5,
            passages_available=12,
            model_dump=lambda: {
                "answer": "Habeas corpus is a legal remedy...",
                "query": "What is habeas corpus?",
                "intent": "legal_question",
                "confidence": 0.85,
                "confidence_level": "high",
                "citations": [],
                "sources": [],
                "abstained": False,
                "abstention_reason": None,
                "model_name": "test-model",
                "prompt_template_version": "v1",
                "passages_used": 5,
                "passages_available": 12,
            },
        )

        resp = await client.post(
            "/answer", json={"query": "What is habeas corpus?"}
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "answer" in data
        assert "confidence" in data
        assert "citations" in data
        assert "sources" in data
        assert "abstained" in data
        mock_generate.assert_called_once()

    @pytest.mark.asyncio
    @patch("src.answer.router.generate_answer")
    async def test_answer_pipeline_error_returns_422(
        self, mock_generate: AsyncMock, client: AsyncClient
    ):
        from src.shared.exceptions import RagPipelineError

        mock_generate.side_effect = RagPipelineError("Intent classification failed")

        resp = await client.post(
            "/answer", json={"query": "What is habeas corpus?"}
        )
        assert resp.status_code == 422
        assert "Intent classification failed" in resp.json()["detail"]

    @pytest.mark.asyncio
    @patch("src.answer.router.generate_answer")
    async def test_answer_unexpected_error_returns_500(
        self, mock_generate: AsyncMock, client: AsyncClient
    ):
        mock_generate.side_effect = RuntimeError("Unexpected failure")

        resp = await client.post(
            "/answer", json={"query": "What is habeas corpus?"}
        )
        assert resp.status_code == 500
        assert "internal error" in resp.json()["detail"].lower()

    @pytest.mark.asyncio
    @patch("src.answer.router.stream_answer")
    async def test_answer_stream_returns_sse(
        self, mock_stream: AsyncMock, client: AsyncClient
    ):
        async def fake_stream(request):
            from src.answer.schemas import AnswerChunk

            yield AnswerChunk(type="text", content="Hello")
            yield AnswerChunk(type="done", content="")

        mock_stream.return_value = fake_stream(None)

        resp = await client.post(
            "/answer/stream", json={"query": "What is habeas corpus?"}
        )
        assert resp.status_code == 200
        assert "text/event-stream" in resp.headers["content-type"]

    @pytest.mark.asyncio
    async def test_answer_stream_rejects_short_query(self, client: AsyncClient):
        resp = await client.post("/answer/stream", json={"query": "ab"})
        assert resp.status_code == 422


# ---- /digests ----


class TestDigestsRouter:
    @pytest.mark.asyncio
    async def test_digest_rejects_missing_document_id(self, client: AsyncClient):
        resp = await client.post(
            "/digests/generate", json={"sections": []}
        )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_digest_rejects_missing_sections(self, client: AsyncClient):
        resp = await client.post(
            "/digests/generate", json={"document_id": "doc-001"}
        )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    @patch("src.digests.router.generate_digest")
    async def test_digest_success_response_shape(
        self, mock_gen: AsyncMock, client: AsyncClient
    ):
        mock_gen.return_value = MagicMock(
            model_dump=lambda: {
                "summary": "A case about labor rights.",
                "facts": "The petitioner filed...",
                "issues": "Whether the dismissal was valid.",
                "ruling": "The SC ruled in favor of...",
                "doctrine": "Employer must prove just cause.",
                "dispositive": "Petition granted.",
                "petitioner_arguments": None,
                "respondent_arguments": None,
                "cited_authorities": [],
                "provenance": [{"field": "facts", "source_section_id": "s1", "source_document_id": "doc-001"}],
                "confidence_score": 0.88,
                "model_name": "test-model",
                "prompt_template_version": "v1",
            },
        )

        resp = await client.post(
            "/digests/generate",
            json={
                "document_id": "doc-001",
                "sections": [
                    {"id": "s1", "section_type": "body", "plain_text": "The petitioner filed a complaint."},
                ],
                "document_type": "case",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "confidence_score" in data
        assert "provenance" in data
        assert "model_name" in data
        mock_gen.assert_called_once()


# ---- /citations ----


class TestCitationsRouter:
    @pytest.mark.asyncio
    async def test_resolve_rejects_missing_document_id(self, client: AsyncClient):
        resp = await client.post(
            "/citations/resolve", json={"citations": []}
        )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_resolve_rejects_missing_citations(self, client: AsyncClient):
        resp = await client.post(
            "/citations/resolve", json={"document_id": "doc-001"}
        )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    @patch("src.citations.router.resolve_citations")
    async def test_resolve_success_response_shape(
        self, mock_resolve: AsyncMock, client: AsyncClient
    ):
        mock_resolve.return_value = MagicMock(
            model_dump=lambda: {
                "document_id": "doc-001",
                "total_citations": 1,
                "resolved_count": 1,
                "unresolved_count": 0,
                "results": [
                    {
                        "citation_id": "cit-1",
                        "to_document_id": "doc-002",
                        "confidence": 0.95,
                        "resolver_method": "gr_number",
                        "resolved": True,
                    }
                ],
            },
        )

        resp = await client.post(
            "/citations/resolve",
            json={
                "document_id": "doc-001",
                "citations": [
                    {
                        "id": "cit-1",
                        "citation_text": "G.R. No. 123456",
                        "from_document_id": "doc-001",
                    }
                ],
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_citations"] == 1
        assert data["resolved_count"] == 1
        mock_resolve.assert_called_once()

    @pytest.mark.asyncio
    async def test_suggest_case_codal_rejects_missing_doc_id(self, client: AsyncClient):
        resp = await client.post("/citations/suggest-case-codal", json={})
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_suggest_case_codal_rejects_invalid_max(self, client: AsyncClient):
        resp = await client.post(
            "/citations/suggest-case-codal",
            json={"document_id": "doc-001", "max_suggestions": 100},
        )
        assert resp.status_code == 422


# ---- /flashcards ----


class TestFlashcardsRouter:
    @pytest.mark.asyncio
    async def test_generate_rejects_short_topic(self, client: AsyncClient):
        resp = await client.post(
            "/flashcards/generate", json={"topic": "abc", "count": 5}
        )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_generate_rejects_zero_count(self, client: AsyncClient):
        resp = await client.post(
            "/flashcards/generate", json={"topic": "Civil Law obligations", "count": 0}
        )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_generate_rejects_excessive_count(self, client: AsyncClient):
        resp = await client.post(
            "/flashcards/generate",
            json={"topic": "Civil Law obligations", "count": 50},
        )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    @patch("src.flashcards.router.generate_flashcards")
    async def test_generate_success_response_shape(
        self, mock_gen: AsyncMock, client: AsyncClient
    ):
        mock_gen.return_value = MagicMock(
            model_dump=lambda: {
                "flashcards": [
                    {
                        "front": "What is an obligation?",
                        "back": "An obligation is a juridical necessity...",
                        "source_document_id": None,
                        "source_section_id": None,
                        "difficulty": "easy",
                    }
                ],
                "total_generated": 1,
                "topic": "Civil Law obligations",
                "card_type": "mixed",
                "confidence_score": 0.82,
                "model_name": "test-model",
                "prompt_template_version": "v1",
            },
        )

        resp = await client.post(
            "/flashcards/generate",
            json={"topic": "Civil Law obligations", "count": 5},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "flashcards" in data
        assert "confidence_score" in data
        assert len(data["flashcards"]) == 1
        mock_gen.assert_called_once()

    @pytest.mark.asyncio
    async def test_generate_accepts_valid_card_type(self, client: AsyncClient):
        with patch("src.flashcards.router.generate_flashcards") as mock_gen:
            mock_gen.return_value = MagicMock(
                model_dump=lambda: {
                    "flashcards": [],
                    "total_generated": 0,
                    "topic": "Criminal Law",
                    "card_type": "definition",
                    "confidence_score": 0.5,
                    "model_name": "test-model",
                    "prompt_template_version": "v1",
                },
            )

            resp = await client.post(
                "/flashcards/generate",
                json={
                    "topic": "Criminal Law elements",
                    "card_type": "definition",
                    "count": 5,
                },
            )
            assert resp.status_code == 200

    @pytest.mark.asyncio
    async def test_generate_rejects_invalid_card_type(self, client: AsyncClient):
        resp = await client.post(
            "/flashcards/generate",
            json={
                "topic": "Criminal Law elements",
                "card_type": "invalid_type",
                "count": 5,
            },
        )
        assert resp.status_code == 422


# ---- /comparisons ----


class TestComparisonsRouter:
    @pytest.mark.asyncio
    async def test_generate_rejects_empty_body(self, client: AsyncClient):
        resp = await client.post("/comparisons/generate", json={})
        assert resp.status_code == 422


# ---- /contradictions ----


class TestContradictionsRouter:
    @pytest.mark.asyncio
    async def test_generate_rejects_empty_body(self, client: AsyncClient):
        resp = await client.post("/contradictions/generate", json={})
        assert resp.status_code == 422


# ---- /doctrines ----


class TestDoctrinesRouter:
    @pytest.mark.asyncio
    async def test_extract_rejects_empty_body(self, client: AsyncClient):
        resp = await client.post("/doctrines/extract", json={})
        assert resp.status_code == 422


# ---- /memos ----


class TestMemosRouter:
    @pytest.mark.asyncio
    async def test_generate_rejects_empty_body(self, client: AsyncClient):
        resp = await client.post("/memos/generate", json={})
        assert resp.status_code == 422


# ---- /pleadings ----


class TestPleadingsRouter:
    @pytest.mark.asyncio
    async def test_generate_rejects_empty_body(self, client: AsyncClient):
        resp = await client.post("/pleadings/generate", json={})
        assert resp.status_code == 422


# ---- /timelines ----


class TestTimelinesRouter:
    @pytest.mark.asyncio
    async def test_generate_rejects_empty_body(self, client: AsyncClient):
        resp = await client.post("/timelines/generate", json={})
        assert resp.status_code == 422


# ---- /hearing-prep ----


class TestHearingPrepRouter:
    @pytest.mark.asyncio
    async def test_generate_rejects_empty_body(self, client: AsyncClient):
        resp = await client.post("/hearing-prep/generate", json={})
        assert resp.status_code == 422


# ---- /research-workspaces ----


class TestResearchWorkspacesRouter:
    @pytest.mark.asyncio
    async def test_query_rejects_empty_body(self, client: AsyncClient):
        resp = await client.post("/research_workspaces/query", json={})
        assert resp.status_code == 422
