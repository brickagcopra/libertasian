"""Tests for flashcards/service.py — AI flashcard generation.

Tests cover: _parse_flashcard_response, _compute_confidence,
and the full generate_flashcards pipeline with mocked LLM.
"""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.core.schemas import Passage
from src.flashcards.schemas import (
    FlashcardGenerationRequest,
    FlashcardGenerationResponse,
    FlashcardType,
    GeneratedFlashcard,
)
from src.flashcards.service import (
    _compute_confidence,
    _parse_flashcard_response,
    _passage_provenance,
    _resolve_card_source,
    generate_flashcards,
)


# ---------------------------------------------------------------------------
# Test data factories
# ---------------------------------------------------------------------------


def _make_full_flashcard_data() -> dict[str, Any]:
    """Return a fully populated flashcard generation response."""
    return {
        "flashcards": [
            {
                "front": "What is constructive dismissal?",
                "back": "A situation where an employee is forced to resign due to the employer's actions that create an unbearable work environment.",
                "source_document_id": "doc-0001",
                "source_section_id": "sec-001",
                "difficulty": "medium",
            },
            {
                "front": "What article of the Labor Code covers termination by employer?",
                "back": "Article 297 (formerly Article 282) of the Labor Code enumerates just causes for termination.",
                "source_document_id": "doc-0002",
                "difficulty": "easy",
            },
            {
                "front": "What is the two-notice rule in Philippine labor law?",
                "back": "The employer must serve two notices: (1) notice of charges, (2) notice of termination after hearing.",
                "source_document_id": "doc-0003",
                "source_section_id": "sec-005",
                "difficulty": "hard",
            },
        ]
    }


def _make_passages(count: int) -> list[MagicMock]:
    return [MagicMock() for _ in range(count)]


# ---------------------------------------------------------------------------
# _parse_flashcard_response
# ---------------------------------------------------------------------------


class TestParseFlashcardResponse:
    def test_valid_json(self) -> None:
        data = _make_full_flashcard_data()
        result = _parse_flashcard_response(json.dumps(data))

        assert len(result["flashcards"]) == 3

    def test_invalid_json_returns_empty(self) -> None:
        result = _parse_flashcard_response("not valid JSON")

        assert result["flashcards"] == []

    def test_empty_json_object(self) -> None:
        result = _parse_flashcard_response("{}")
        assert result.get("flashcards") is None

    def test_empty_string(self) -> None:
        result = _parse_flashcard_response("")
        assert result["flashcards"] == []


# ---------------------------------------------------------------------------
# _compute_confidence
# ---------------------------------------------------------------------------


class TestComputeFlashcardConfidence:
    def test_no_flashcards_returns_low(self) -> None:
        confidence = _compute_confidence([], _make_passages(5))
        assert confidence == 0.2

    def test_full_flashcards_with_sources(self) -> None:
        flashcards = [
            GeneratedFlashcard(
                front="What is Q1?", back="Answer one text", source_document_id="doc-1", difficulty="easy"
            ),
            GeneratedFlashcard(
                front="What is Q2?", back="Answer two text", source_document_id="doc-2", difficulty="medium"
            ),
            GeneratedFlashcard(
                front="What is Q3?", back="Answer three text", source_document_id="doc-3", difficulty="hard"
            ),
            GeneratedFlashcard(
                front="What is Q4?", back="Answer four text", source_document_id="doc-4", difficulty="easy"
            ),
            GeneratedFlashcard(
                front="What is Q5?", back="Answer five text", source_document_id="doc-5", difficulty="medium"
            ),
        ]
        passages = _make_passages(5)
        confidence = _compute_confidence(flashcards, passages)

        # passage_factor=1.0, source_ref=1.0, completeness=1.0
        assert confidence == 1.0

    def test_flashcards_without_sources(self) -> None:
        flashcards = [
            GeneratedFlashcard(front="What is Q1?", back="Answer one text", difficulty="easy"),
            GeneratedFlashcard(front="What is Q2?", back="Answer two text", difficulty="medium"),
        ]
        passages = _make_passages(5)
        confidence = _compute_confidence(flashcards, passages)

        # source_ref_factor = 0/2 = 0.0
        assert confidence < 1.0

    def test_few_passages_lower_confidence(self) -> None:
        flashcards = [
            GeneratedFlashcard(
                front="What is Q1?", back="Answer one text", source_document_id="doc-1", difficulty="easy"
            ),
        ]
        confidence = _compute_confidence(flashcards, _make_passages(2))
        assert confidence < 1.0

    def test_confidence_in_range(self) -> None:
        flashcards = [
            GeneratedFlashcard(front="What is this?", back="Short answer text", difficulty="medium"),
        ]
        confidence = _compute_confidence(flashcards, _make_passages(10))
        assert 0.0 <= confidence <= 1.0

    def test_confidence_is_rounded(self) -> None:
        flashcards = [
            GeneratedFlashcard(front="What is this?", back="Short answer text", difficulty="medium"),
        ]
        confidence = _compute_confidence(flashcards, _make_passages(3))
        assert confidence == round(confidence, 2)


# ---------------------------------------------------------------------------
# generate_flashcards — full pipeline
# ---------------------------------------------------------------------------


class TestGenerateFlashcards:
    """Test the full generate_flashcards function with mocked dependencies."""

    @pytest.fixture(autouse=True)
    def _setup_mocks(self) -> None:
        self.mock_model_info = MagicMock(
            return_value={"model_name": "test-flashcard-model", "model_version": "1.0"}
        )
        self.llm_response = json.dumps(_make_full_flashcard_data())
        self.mock_generate = AsyncMock(return_value=self.llm_response)
        self.mock_retrieve_query = AsyncMock(return_value=_make_passages(5))
        self.mock_retrieve_doc = AsyncMock(return_value=_make_passages(3))

        self.patches = [
            patch("src.flashcards.service.get_model_info", self.mock_model_info),
            patch("src.flashcards.service.generate_completion", self.mock_generate),
            patch("src.flashcards.service.retrieve_by_query", self.mock_retrieve_query),
            patch("src.flashcards.service.retrieve_by_document_id", self.mock_retrieve_doc),
        ]
        for p in self.patches:
            p.start()

    @pytest.fixture(autouse=True)
    def _teardown_mocks(self) -> None:
        yield
        for p in self.patches:
            p.stop()

    @pytest.mark.asyncio
    async def test_topic_based_generation(self) -> None:
        request = FlashcardGenerationRequest(
            topic="Constructive dismissal in labor law",
            card_type=FlashcardType.MIXED,
            count=10,
        )
        response = await generate_flashcards(request)

        assert isinstance(response, FlashcardGenerationResponse)
        assert response.total_generated == 3
        assert response.topic == "Constructive dismissal in labor law"
        self.mock_retrieve_query.assert_called_once()

    @pytest.mark.asyncio
    async def test_document_based_generation(self) -> None:
        request = FlashcardGenerationRequest(
            topic="Labor law flashcards",
            card_type=FlashcardType.CASE_HOLDING,
            count=10,
            context_document_ids=["doc-001", "doc-002"],
        )
        response = await generate_flashcards(request)

        assert isinstance(response, FlashcardGenerationResponse)
        assert self.mock_retrieve_doc.call_count == 2
        self.mock_retrieve_query.assert_not_called()

    @pytest.mark.asyncio
    async def test_count_limits_output(self) -> None:
        request = FlashcardGenerationRequest(
            topic="Test topic for flashcards",
            count=2,
        )
        response = await generate_flashcards(request)

        assert response.total_generated <= 2

    @pytest.mark.asyncio
    async def test_invalid_cards_filtered(self) -> None:
        data = {
            "flashcards": [
                {"front": "Valid question?", "back": "Valid answer"},
                {"front": "", "back": "Missing front"},  # empty front
                {"front": "Missing back", "back": ""},  # empty back
                "not a dict",
                {"front": "Valid 2?", "back": "Valid answer 2"},
            ]
        }
        self.mock_generate.return_value = json.dumps(data)

        request = FlashcardGenerationRequest(
            topic="Test filtering invalid cards",
            count=10,
        )
        response = await generate_flashcards(request)

        assert response.total_generated == 2

    @pytest.mark.asyncio
    async def test_invalid_llm_response_returns_empty(self) -> None:
        self.mock_generate.return_value = "not json"

        request = FlashcardGenerationRequest(
            topic="Test invalid response handling",
            count=5,
        )
        response = await generate_flashcards(request)

        assert response.total_generated == 0
        assert response.flashcards == []

    @pytest.mark.asyncio
    async def test_bar_subject_filter_passed(self) -> None:
        request = FlashcardGenerationRequest(
            topic="Civil law obligations",
            bar_subject="Civil Law",
            count=5,
        )
        await generate_flashcards(request)

        call_kwargs = self.mock_retrieve_query.call_args.kwargs
        assert call_kwargs.get("filter_terms") == {"bar_subject": "Civil Law"}

    @pytest.mark.asyncio
    async def test_confidence_in_range(self) -> None:
        request = FlashcardGenerationRequest(
            topic="Test confidence range",
            count=10,
        )
        response = await generate_flashcards(request)

        assert 0.0 <= response.confidence_score <= 1.0

    @pytest.mark.asyncio
    async def test_model_info_populated(self) -> None:
        request = FlashcardGenerationRequest(
            topic="Test model info in response",
            count=5,
        )
        response = await generate_flashcards(request)

        assert response.model_name == "test-flashcard-model"

    @pytest.mark.asyncio
    async def test_generation_called_with_json_format(self) -> None:
        request = FlashcardGenerationRequest(
            topic="Test generation parameters",
            count=5,
        )
        await generate_flashcards(request)

        call_kwargs = self.mock_generate.call_args.kwargs
        assert call_kwargs.get("response_format") == "json_object"
        assert call_kwargs.get("temperature") == 0.3


# ---------------------------------------------------------------------------
# Provenance resolution — the 0.65 ceiling regression
# ---------------------------------------------------------------------------


def _make_real_passages(
    count: int, document_id: str = "doc-1", start: int = 0
) -> list[Passage]:
    """Real Passage objects — the MagicMocks above carry no usable IDs."""
    return [
        Passage(
            id=f"hit-{i}",
            document_id=document_id,
            section_id=f"sec-{i:03d}",
            text=f"Passage {i} body text.",
        )
        for i in range(start, start + count)
    ]


class TestResolveCardSource:
    """Provenance comes from the retrieved passages, not the LLM's say-so."""

    def _index(self, passages: list[Passage]):
        return _passage_provenance(passages)

    def test_declared_section_wins_and_brings_its_document(self) -> None:
        docs, sections, sole = self._index(_make_real_passages(3))
        assert _resolve_card_source(
            declared_document_id=None,
            declared_section_id="sec-001",
            document_ids=docs,
            section_to_document=sections,
            sole_document_id=sole,
        ) == ("doc-1", "sec-001")

    def test_declared_document_wins_when_retrieved(self) -> None:
        passages = _make_real_passages(2, "doc-a") + _make_real_passages(2, "doc-b", 2)
        docs, sections, sole = self._index(passages)
        assert sole is None  # two documents -> ambiguous
        assert _resolve_card_source(
            declared_document_id="doc-b",
            declared_section_id=None,
            document_ids=docs,
            section_to_document=sections,
            sole_document_id=sole,
        ) == ("doc-b", None)

    def test_single_document_retrieval_resolves_an_undeclared_card(self) -> None:
        """The case that used to score zero: the model emitted nothing."""
        docs, sections, sole = self._index(_make_real_passages(5))
        assert _resolve_card_source(
            declared_document_id=None,
            declared_section_id=None,
            document_ids=docs,
            section_to_document=sections,
            sole_document_id=sole,
        ) == ("doc-1", None)

    def test_hallucinated_ids_earn_nothing_across_documents(self) -> None:
        passages = _make_real_passages(2, "doc-a") + _make_real_passages(2, "doc-b", 2)
        docs, sections, sole = self._index(passages)
        assert _resolve_card_source(
            declared_document_id="doc-invented",
            declared_section_id="sec-invented",
            document_ids=docs,
            section_to_document=sections,
            sole_document_id=sole,
        ) == (None, None)

    def test_hallucinated_section_does_not_become_an_invalid_fk(self) -> None:
        """A made-up section is dropped even when the document resolves."""
        docs, sections, sole = self._index(_make_real_passages(3))
        assert _resolve_card_source(
            declared_document_id=None,
            declared_section_id="sec-invented",
            document_ids=docs,
            section_to_document=sections,
            sole_document_id=sole,
        ) == ("doc-1", None)

    def test_non_string_declarations_are_ignored(self) -> None:
        docs, sections, sole = self._index(_make_real_passages(3))
        assert _resolve_card_source(
            declared_document_id=42,
            declared_section_id={"nope": True},
            document_ids=docs,
            section_to_document=sections,
            sole_document_id=sole,
        ) == ("doc-1", None)

    def test_no_passages_resolves_to_nothing(self) -> None:
        docs, sections, sole = self._index([])
        assert _resolve_card_source(
            declared_document_id="doc-1",
            declared_section_id="sec-001",
            document_ids=docs,
            section_to_document=sections,
            sole_document_id=sole,
        ) == (None, None)


class TestConfidenceCeilingRegression:
    """A well-formed generation with real provenance must clear 0.70.

    source_ref_factor carried weight 0.35 and counted only cards whose LLM
    output object happened to carry source_document_id — which it almost never
    did. That pinned the reachable ceiling at 0.4 + 0.25 = 0.65, below the 0.70
    bar, for every generation on this path.
    """

    AUTO_APPROVAL_THRESHOLD = 0.7

    @pytest.mark.asyncio
    async def test_undeclared_cards_over_one_document_reach_full_confidence(
        self,
    ) -> None:
        """The exact shape that used to cap at 0.65."""
        llm_output = json.dumps(
            {
                "flashcards": [
                    {"front": f"What is Q{i}?", "back": f"Answer {i} body text."}
                    for i in range(5)
                ]
            }
        )
        with (
            patch(
                "src.flashcards.service.get_model_info",
                MagicMock(return_value={"model_name": "m", "model_version": "1"}),
            ),
            patch(
                "src.flashcards.service.generate_completion",
                AsyncMock(return_value=llm_output),
            ),
            patch(
                "src.flashcards.service.retrieve_by_query",
                AsyncMock(return_value=_make_real_passages(5)),
            ),
        ):
            response = await generate_flashcards(
                FlashcardGenerationRequest(
                    topic="Constructive dismissal in labor law",
                    count=5,
                )
            )

        # passage 1.0 * 0.4 + source_ref 1.0 * 0.35 + completeness 1.0 * 0.25
        assert response.confidence_score == 1.0
        assert response.confidence_score >= self.AUTO_APPROVAL_THRESHOLD
        # and the provenance is on the cards, so persistence stores a real FK
        assert all(c.source_document_id == "doc-1" for c in response.flashcards)

    @pytest.mark.asyncio
    async def test_ungrounded_cards_across_documents_stay_below(self) -> None:
        """Ambiguous retrieval + no declarations still earns no provenance."""
        llm_output = json.dumps(
            {
                "flashcards": [
                    {"front": f"What is Q{i}?", "back": f"Answer {i} body text."}
                    for i in range(5)
                ]
            }
        )
        passages = _make_real_passages(3, "doc-a") + _make_real_passages(2, "doc-b", 3)
        with (
            patch(
                "src.flashcards.service.get_model_info",
                MagicMock(return_value={"model_name": "m", "model_version": "1"}),
            ),
            patch(
                "src.flashcards.service.generate_completion",
                AsyncMock(return_value=llm_output),
            ),
            patch(
                "src.flashcards.service.retrieve_by_query",
                AsyncMock(return_value=passages),
            ),
        ):
            response = await generate_flashcards(
                FlashcardGenerationRequest(topic="Labor law across cases", count=5)
            )

        # 0.4 + 0 + 0.25 = 0.65 — the old ceiling, now only reachable when the
        # provenance genuinely cannot be resolved.
        assert response.confidence_score == 0.65
        assert response.confidence_score < self.AUTO_APPROVAL_THRESHOLD
        assert all(c.source_document_id is None for c in response.flashcards)
