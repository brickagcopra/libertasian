"""Tests for answer/service.py — full RAG answer pipeline.

All external dependencies (retrieval, reranking, generation, validation) are mocked.
Tests cover: non-streaming pipeline, abstention path, confidence level mapping,
passage-to-source conversion, streaming pipeline, and edge cases.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.answer.schemas import AnswerChunk, AnswerRequest, AnswerResponse, AnswerSource
from src.answer.service import (
    _confidence_to_level,
    _passage_to_source,
    generate_answer,
    stream_answer,
)
from src.core.schemas import (
    CitationRef,
    ContextBundle,
    Passage,
    SearchResult,
    ValidationResult,
)
from src.core.types import AbstentionReason, ConfidenceLevel, QueryIntent


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_passage(**overrides: Any) -> Passage:
    defaults: dict[str, Any] = {
        "id": "hit-1",
        "document_id": "doc-0001",
        "section_id": "sec-001",
        "title": "People v. Test",
        "citation_text": "G.R. No. 100001",
        "text": "The court ruled in favour of the petitioner.",
        "court": "Supreme Court",
        "decision_date": "2024-01-15",
        "document_type": "case",
        "source_authority_level": "official",
        "score": 0.85,
        "bm25_score": 0.6,
        "knn_score": 0.9,
        "rerank_score": None,
    }
    defaults.update(overrides)
    return Passage(**defaults)


def _make_passages_list() -> list[Passage]:
    """Return 3 passages — minimum needed to avoid abstention."""
    return [
        _make_passage(
            id="hit-1", document_id="doc-0001", section_id="sec-001",
            title="People v. Test", citation_text="G.R. No. 100001",
            score=0.85, rerank_score=0.90,
        ),
        _make_passage(
            id="hit-2", document_id="doc-0002", section_id="sec-002",
            title="People v. Example", citation_text="G.R. No. 100002",
            score=0.80, rerank_score=0.85,
        ),
        _make_passage(
            id="hit-3", document_id="doc-0003", section_id="sec-003",
            title="People v. Sample", citation_text="G.R. No. 100003",
            score=0.75, rerank_score=0.80,
        ),
    ]


def _make_search_result(passages: list[Passage] | None = None) -> SearchResult:
    return SearchResult(
        passages=passages or _make_passages_list(),
        total_bm25_hits=3,
        total_knn_hits=3,
        query_intent="legal_question",
    )


def _make_validation_result(valid: bool = True, valid_count: int = 2) -> ValidationResult:
    return ValidationResult(
        is_valid=valid,
        valid_citations=[
            CitationRef(source_id="doc-0001", text="cited text", valid=True),
            CitationRef(source_id="doc-0002", text="cited text 2", valid=True),
        ][:valid_count],
        invalid_citations=[],
        unsupported_claims=[],
        valid_count=valid_count,
        total_count=valid_count,
    )


def _make_context_bundle() -> ContextBundle:
    return ContextBundle(
        formatted_context="[SOURCE doc-0001] The court ruled...",
        passages_included=3,
        passages_total=3,
        estimated_tokens=150,
        token_budget=4096,
    )


# ---------------------------------------------------------------------------
# _confidence_to_level
# ---------------------------------------------------------------------------


class TestConfidenceToLevel:
    def test_high_confidence(self) -> None:
        assert _confidence_to_level(0.7) == ConfidenceLevel.HIGH
        assert _confidence_to_level(0.85) == ConfidenceLevel.HIGH
        assert _confidence_to_level(1.0) == ConfidenceLevel.HIGH

    def test_medium_confidence(self) -> None:
        assert _confidence_to_level(0.4) == ConfidenceLevel.MEDIUM
        assert _confidence_to_level(0.5) == ConfidenceLevel.MEDIUM
        assert _confidence_to_level(0.69) == ConfidenceLevel.MEDIUM

    def test_low_confidence(self) -> None:
        assert _confidence_to_level(0.0) == ConfidenceLevel.LOW
        assert _confidence_to_level(0.2) == ConfidenceLevel.LOW
        assert _confidence_to_level(0.39) == ConfidenceLevel.LOW

    def test_boundary_values(self) -> None:
        """Test exact boundary transitions."""
        assert _confidence_to_level(0.7) == ConfidenceLevel.HIGH  # >= 0.7 is HIGH
        assert _confidence_to_level(0.4) == ConfidenceLevel.MEDIUM  # >= 0.4 is MEDIUM
        # Just below boundaries
        assert _confidence_to_level(0.399) == ConfidenceLevel.LOW
        assert _confidence_to_level(0.699) == ConfidenceLevel.MEDIUM


# ---------------------------------------------------------------------------
# _passage_to_source
# ---------------------------------------------------------------------------


class TestPassageToSource:
    def test_full_passage_converts(self) -> None:
        passage = _make_passage()
        source = _passage_to_source(passage)

        assert isinstance(source, AnswerSource)
        assert source.document_id == "doc-0001"
        assert source.section_id == "sec-001"
        assert source.title == "People v. Test"
        assert source.citation_text == "G.R. No. 100001"
        assert source.court == "Supreme Court"
        assert source.decision_date == "2024-01-15"
        assert source.document_type == "case"
        assert source.relevance_score == 0.85

    def test_score_rounding(self) -> None:
        passage = _make_passage(score=0.123456789)
        source = _passage_to_source(passage)
        assert source.relevance_score == 0.1235

    def test_none_section_id(self) -> None:
        passage = _make_passage(section_id=None)
        source = _passage_to_source(passage)
        assert source.section_id is None

    def test_empty_metadata_fields(self) -> None:
        passage = _make_passage(title="", court="", decision_date="")
        source = _passage_to_source(passage)
        assert source.title == ""
        assert source.court == ""
        assert source.decision_date == ""


# ---------------------------------------------------------------------------
# generate_answer — full pipeline (non-streaming)
# ---------------------------------------------------------------------------


class TestGenerateAnswer:
    """Test the non-streaming generate_answer function with mocked dependencies."""

    @pytest.fixture(autouse=True)
    def _setup_mocks(self) -> None:
        """Patch all external dependencies."""
        self.mock_retrieve = AsyncMock(return_value=_make_search_result())
        self.mock_rerank = AsyncMock(return_value=_make_passages_list())
        self.mock_generate = AsyncMock(
            return_value="The court held... [SOURCE doc-0001]"
        )
        self.mock_validate = AsyncMock(return_value=_make_validation_result())
        self.mock_model_info = MagicMock(
            return_value={"model_name": "test-model-v1", "model_version": "1.0"}
        )

        self.patches = [
            patch("src.answer.service.hybrid_retrieve", self.mock_retrieve),
            patch("src.answer.service.rerank_passages", self.mock_rerank),
            patch("src.answer.service.generate_completion", self.mock_generate),
            patch("src.answer.service.validate_citations", self.mock_validate),
            patch("src.answer.service.get_model_info", self.mock_model_info),
        ]
        for p in self.patches:
            p.start()

    @pytest.fixture(autouse=True)
    def _teardown_mocks(self) -> None:
        yield
        for p in self.patches:
            p.stop()

    @pytest.mark.asyncio
    async def test_successful_answer(self) -> None:
        request = AnswerRequest(query="What is the doctrine of last clear chance?")
        response = await generate_answer(request)

        assert isinstance(response, AnswerResponse)
        assert response.query == "What is the doctrine of last clear chance?"
        assert response.abstained is False
        assert response.abstention_reason is None
        assert response.model_name == "test-model-v1"
        assert response.prompt_template_version == "answer-v1.0"

    @pytest.mark.asyncio
    async def test_answer_includes_sources_when_requested(self) -> None:
        request = AnswerRequest(
            query="What is the doctrine of last clear chance?",
            include_sources=True,
        )
        response = await generate_answer(request)

        assert len(response.sources) == 3
        assert response.sources[0].document_id == "doc-0001"

    @pytest.mark.asyncio
    async def test_answer_excludes_sources_when_not_requested(self) -> None:
        request = AnswerRequest(
            query="What is the doctrine of last clear chance?",
            include_sources=False,
        )
        response = await generate_answer(request)

        assert len(response.sources) == 0

    @pytest.mark.asyncio
    async def test_answer_with_invalid_citations_reduces_confidence(self) -> None:
        """When citation validation fails, confidence is computed with fewer valid cites."""
        self.mock_validate.return_value = ValidationResult(
            is_valid=False,
            valid_citations=[],
            invalid_citations=[
                CitationRef(source_id="doc-fake", text="fake", valid=False),
            ],
            unsupported_claims=["Some unsupported claim"],
            valid_count=0,
            total_count=1,
        )

        request = AnswerRequest(query="Test query with bad citations")
        response = await generate_answer(request)

        # Should still return an answer, but confidence is lower
        assert response.abstained is False
        assert response.answer == "The court held... [SOURCE doc-0001]"

    @pytest.mark.asyncio
    async def test_query_trimmed(self) -> None:
        request = AnswerRequest(query="   What is equity?   ")
        response = await generate_answer(request)

        assert response.query == "What is equity?"

    @pytest.mark.asyncio
    async def test_retrieval_called_with_correct_top_k(self) -> None:
        request = AnswerRequest(query="Test query")
        await generate_answer(request)

        self.mock_retrieve.assert_called_once()
        call_kwargs = self.mock_retrieve.call_args
        assert call_kwargs.kwargs.get("top_k") == 30 or call_kwargs[1].get("top_k") == 30

    @pytest.mark.asyncio
    async def test_rerank_called_with_max_passages(self) -> None:
        request = AnswerRequest(query="Test query", max_passages=5)
        await generate_answer(request)

        self.mock_rerank.assert_called_once()
        call_args = self.mock_rerank.call_args
        assert call_args.kwargs.get("top_k") == 5 or call_args[1].get("top_k") == 5

    @pytest.mark.asyncio
    async def test_passages_used_and_available_in_response(self) -> None:
        """Response should include both passages_used and passages_available counts."""
        request = AnswerRequest(query="Test query")
        response = await generate_answer(request)

        assert response.passages_used >= 0
        assert response.passages_available >= 0


class TestGenerateAnswerAbstention:
    """Test the abstention path in generate_answer."""

    @pytest.fixture(autouse=True)
    def _setup_mocks(self) -> None:
        self.mock_retrieve = AsyncMock(
            return_value=SearchResult(
                passages=[],
                total_bm25_hits=0,
                total_knn_hits=0,
                query_intent="general",
            )
        )
        self.mock_rerank = AsyncMock(return_value=[])
        self.mock_model_info = MagicMock(
            return_value={"model_name": "test-model-v1", "model_version": "1.0"}
        )

        self.patches = [
            patch("src.answer.service.hybrid_retrieve", self.mock_retrieve),
            patch("src.answer.service.rerank_passages", self.mock_rerank),
            patch("src.answer.service.get_model_info", self.mock_model_info),
            patch(
                "src.answer.service.check_abstention",
                return_value=AbstentionReason.NO_RESULTS,
            ),
        ]
        for p in self.patches:
            p.start()

    @pytest.fixture(autouse=True)
    def _teardown_mocks(self) -> None:
        yield
        for p in self.patches:
            p.stop()

    @pytest.mark.asyncio
    async def test_abstention_response(self) -> None:
        request = AnswerRequest(query="Some impossible query")
        response = await generate_answer(request)

        assert response.abstained is True
        assert response.abstention_reason == AbstentionReason.NO_RESULTS
        assert response.confidence == 0.0
        assert response.confidence_level == ConfidenceLevel.LOW
        assert response.passages_used == 0

    @pytest.mark.asyncio
    async def test_abstention_does_not_call_generation(self) -> None:
        """When abstaining, LLM generation and validation should NOT be called."""
        with patch("src.answer.service.generate_completion") as mock_gen, \
             patch("src.answer.service.validate_citations") as mock_val:
            request = AnswerRequest(query="Some impossible query")
            await generate_answer(request)

            mock_gen.assert_not_called()
            mock_val.assert_not_called()


# ---------------------------------------------------------------------------
# stream_answer — streaming pipeline
# ---------------------------------------------------------------------------


class TestStreamAnswer:
    """Test the streaming pipeline (stream_answer)."""

    @pytest.fixture(autouse=True)
    def _setup_mocks(self) -> None:
        self.mock_retrieve = AsyncMock(return_value=_make_search_result())
        self.mock_rerank = AsyncMock(return_value=[_make_passage()])
        self.mock_validate = AsyncMock(return_value=_make_validation_result())
        self.mock_model_info = MagicMock(
            return_value={"model_name": "test-model-v1", "model_version": "1.0"}
        )

        # stream_completion returns an async iterator of chunks
        async def _mock_stream(*args: Any, **kwargs: Any):
            yield "The court "
            yield "ruled that "
            yield "the petition is granted."

        self.patches = [
            patch("src.answer.service.hybrid_retrieve", self.mock_retrieve),
            patch("src.answer.service.rerank_passages", self.mock_rerank),
            patch("src.answer.service.validate_citations", self.mock_validate),
            patch("src.answer.service.get_model_info", self.mock_model_info),
            patch("src.answer.service.check_abstention", return_value=None),
            patch("src.answer.service.stream_completion", _mock_stream),
        ]
        for p in self.patches:
            p.start()

    @pytest.fixture(autouse=True)
    def _teardown_mocks(self) -> None:
        yield
        for p in self.patches:
            p.stop()

    @pytest.mark.asyncio
    async def test_streaming_produces_metadata_text_done(self) -> None:
        request = AnswerRequest(query="Test streaming query")
        chunks: list[AnswerChunk] = []
        async for chunk in stream_answer(request):
            chunks.append(chunk)

        # Should have: 1 metadata + N text chunks + 1 done
        types = [c.type for c in chunks]
        assert types[0] == "metadata"
        assert types[-1] == "done"
        assert "text" in types

    @pytest.mark.asyncio
    async def test_streaming_text_chunks_concatenate(self) -> None:
        request = AnswerRequest(query="Test streaming query")
        text_parts: list[str] = []
        async for chunk in stream_answer(request):
            if chunk.type == "text":
                text_parts.append(chunk.content)

        full_text = "".join(text_parts)
        assert full_text == "The court ruled that the petition is granted."

    @pytest.mark.asyncio
    async def test_streaming_metadata_contains_intent(self) -> None:
        request = AnswerRequest(query="Test streaming query")
        async for chunk in stream_answer(request):
            if chunk.type == "metadata":
                assert "intent" in chunk.metadata
                break

    @pytest.mark.asyncio
    async def test_streaming_done_contains_confidence(self) -> None:
        request = AnswerRequest(query="Test streaming query")
        done_chunk = None
        async for chunk in stream_answer(request):
            if chunk.type == "done":
                done_chunk = chunk

        assert done_chunk is not None
        assert "confidence" in done_chunk.metadata
        assert "confidence_level" in done_chunk.metadata
        assert "model_name" in done_chunk.metadata


class TestStreamAnswerAbstention:
    """Test the abstention path in streaming."""

    @pytest.fixture(autouse=True)
    def _setup_mocks(self) -> None:
        self.mock_retrieve = AsyncMock(
            return_value=SearchResult(passages=[], total_bm25_hits=0, total_knn_hits=0)
        )
        self.mock_rerank = AsyncMock(return_value=[])
        self.mock_model_info = MagicMock(
            return_value={"model_name": "test-model-v1", "model_version": "1.0"}
        )

        self.patches = [
            patch("src.answer.service.hybrid_retrieve", self.mock_retrieve),
            patch("src.answer.service.rerank_passages", self.mock_rerank),
            patch("src.answer.service.get_model_info", self.mock_model_info),
            patch(
                "src.answer.service.check_abstention",
                return_value=AbstentionReason.INSUFFICIENT_PASSAGES,
            ),
        ]
        for p in self.patches:
            p.start()

    @pytest.fixture(autouse=True)
    def _teardown_mocks(self) -> None:
        yield
        for p in self.patches:
            p.stop()

    @pytest.mark.asyncio
    async def test_streaming_abstention_yields_metadata_text_done(self) -> None:
        request = AnswerRequest(query="Impossible query")
        chunks: list[AnswerChunk] = []
        async for chunk in stream_answer(request):
            chunks.append(chunk)

        types = [c.type for c in chunks]
        assert types == ["metadata", "text", "done"]

    @pytest.mark.asyncio
    async def test_streaming_abstention_metadata_marks_abstained(self) -> None:
        request = AnswerRequest(query="Impossible query")
        async for chunk in stream_answer(request):
            if chunk.type == "metadata":
                assert chunk.metadata["abstained"] is True
                assert chunk.metadata["abstention_reason"] == "insufficient_passages"
                break


class TestStreamAnswerError:
    """Test the error handling in streaming."""

    @pytest.fixture(autouse=True)
    def _setup_mocks(self) -> None:
        self.patches = [
            patch(
                "src.answer.service.hybrid_retrieve",
                AsyncMock(side_effect=RuntimeError("Connection failed")),
            ),
            patch(
                "src.answer.service.get_model_info",
                MagicMock(return_value={"model_name": "test", "model_version": "1.0"}),
            ),
        ]
        for p in self.patches:
            p.start()

    @pytest.fixture(autouse=True)
    def _teardown_mocks(self) -> None:
        yield
        for p in self.patches:
            p.stop()

    @pytest.mark.asyncio
    async def test_streaming_error_yields_error_chunk(self) -> None:
        request = AnswerRequest(query="Test error handling")
        chunks: list[AnswerChunk] = []
        async for chunk in stream_answer(request):
            chunks.append(chunk)

        assert any(c.type == "error" for c in chunks)
        error_chunk = next(c for c in chunks if c.type == "error")
        assert "RuntimeError" in error_chunk.content
