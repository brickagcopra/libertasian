"""Tests for timelines/service.py — timeline generation from legal documents.

Tests cover: _parse_timeline_response, _compute_confidence,
and the full generate_timeline pipeline with mocked LLM.
"""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.timelines.schemas import TimelineRequest, TimelineResponse
from src.timelines.service import (
    _compute_confidence,
    _parse_timeline_response,
    generate_timeline,
)


# ---------------------------------------------------------------------------
# Test data factories
# ---------------------------------------------------------------------------


def _make_full_timeline_data() -> dict[str, Any]:
    """Return a fully populated timeline response."""
    return {
        "events": [
            {
                "date": "2020-01-15",
                "label": "Filing of Complaint",
                "description": "Plaintiff filed a complaint for damages before the RTC.",
                "source_document_id": "doc-001",
                "source_section_id": "sec-001",
                "event_type": "filing",
            },
            {
                "date": "2020-03-20",
                "label": "Answer Filed",
                "description": "Defendant filed their Answer with affirmative defenses.",
                "source_document_id": "doc-001",
                "source_section_id": "sec-002",
                "event_type": "filing",
            },
            {
                "date": "2021-06-10",
                "label": "RTC Decision",
                "description": "The Regional Trial Court ruled in favor of the plaintiff.",
                "source_document_id": "doc-002",
                "event_type": "decision",
            },
            {
                "date": "2022-02-28",
                "label": "Appeal Filed",
                "description": "Defendant appealed to the Court of Appeals.",
                "source_document_id": "doc-002",
                "event_type": "filing",
            },
        ],
        "summary": "The case progressed from RTC filing through appeal over approximately two years.",
    }


def _make_passages_by_doc(doc_ids: list[str], count_per: int = 3) -> dict[str, list[MagicMock]]:
    return {doc_id: [MagicMock() for _ in range(count_per)] for doc_id in doc_ids}


# ---------------------------------------------------------------------------
# _parse_timeline_response
# ---------------------------------------------------------------------------


class TestParseTimelineResponse:
    def test_valid_json(self) -> None:
        data = _make_full_timeline_data()
        result = _parse_timeline_response(json.dumps(data))

        assert len(result["events"]) == 4
        assert result["summary"] != ""

    def test_invalid_json_returns_error_structure(self) -> None:
        result = _parse_timeline_response("not valid JSON")

        assert result["events"] == []
        assert "unable" in result["summary"].lower()

    def test_empty_json_object(self) -> None:
        result = _parse_timeline_response("{}")
        assert result.get("events") is None

    def test_empty_string(self) -> None:
        result = _parse_timeline_response("")
        assert result["events"] == []


# ---------------------------------------------------------------------------
# _compute_confidence
# ---------------------------------------------------------------------------


class TestComputeTimelineConfidence:
    def test_full_timeline_high_confidence(self) -> None:
        data = _make_full_timeline_data()
        passages = _make_passages_by_doc(["doc-001", "doc-002"], 5)
        confidence = _compute_confidence(data, passages)

        # 4/4 dates (1.0), 4/4 sources (1.0), 2/2 passages (1.0), 4/(2*3)=0.67 density
        assert confidence >= 0.7

    def test_no_events_low_confidence(self) -> None:
        data = {"events": []}
        passages = _make_passages_by_doc(["doc-001"])
        confidence = _compute_confidence(data, passages)

        assert confidence == 0.3

    def test_no_documents_low_confidence(self) -> None:
        data = _make_full_timeline_data()
        confidence = _compute_confidence(data, {})

        assert confidence == 0.3

    def test_events_without_dates(self) -> None:
        data = {
            "events": [
                {"label": "Event 1", "description": "No date"},
                {"date": "2023-01-01", "label": "Event 2", "description": "Has date"},
            ]
        }
        passages = _make_passages_by_doc(["doc-001"])
        confidence = _compute_confidence(data, passages)

        # 1/2 date coverage = 0.5
        assert confidence < 0.9

    def test_events_without_source_ids(self) -> None:
        data = {
            "events": [
                {"date": "2023-01-01", "label": "E1", "description": "No source"},
                {"date": "2023-02-01", "label": "E2", "description": "No source"},
            ]
        }
        passages = _make_passages_by_doc(["doc-001"])
        confidence = _compute_confidence(data, passages)

        # 0/2 source coverage
        assert confidence < 0.8

    def test_docs_without_passages(self) -> None:
        data = _make_full_timeline_data()
        passages = {"doc-001": [MagicMock()], "doc-002": []}
        confidence = _compute_confidence(data, passages)

        # 1/2 passage_availability
        assert confidence < 1.0

    def test_event_density_caps_at_1(self) -> None:
        data = {
            "events": [
                {"date": f"2023-{i:02d}-01", "label": f"E{i}", "description": "D", "source_document_id": "doc-001"}
                for i in range(1, 13)
            ]
        }
        passages = _make_passages_by_doc(["doc-001"])
        confidence = _compute_confidence(data, passages)

        # Many events → density capped at 1.0
        assert confidence > 0.7

    def test_confidence_in_range(self) -> None:
        data = _make_full_timeline_data()
        passages = _make_passages_by_doc(["doc-001", "doc-002"])
        confidence = _compute_confidence(data, passages)

        assert 0.0 <= confidence <= 1.0

    def test_confidence_is_rounded(self) -> None:
        data = _make_full_timeline_data()
        passages = _make_passages_by_doc(["doc-001"], 2)
        confidence = _compute_confidence(data, passages)

        assert confidence == round(confidence, 2)


# ---------------------------------------------------------------------------
# generate_timeline — full pipeline
# ---------------------------------------------------------------------------


class TestGenerateTimeline:
    """Test the full generate_timeline function with mocked dependencies."""

    @pytest.fixture(autouse=True)
    def _setup_mocks(self) -> None:
        self.mock_model_info = MagicMock(
            return_value={"model_name": "test-timeline-model", "model_version": "1.0"}
        )
        self.llm_response = json.dumps(_make_full_timeline_data())
        self.mock_generate = AsyncMock(return_value=self.llm_response)
        self.mock_retrieve_doc = AsyncMock(return_value=[MagicMock() for _ in range(5)])

        self.patches = [
            patch("src.timelines.service.get_model_info", self.mock_model_info),
            patch("src.timelines.service.generate_completion", self.mock_generate),
            patch("src.timelines.service.retrieve_by_document_id", self.mock_retrieve_doc),
        ]
        for p in self.patches:
            p.start()

    @pytest.fixture(autouse=True)
    def _teardown_mocks(self) -> None:
        yield
        for p in self.patches:
            p.stop()

    @pytest.mark.asyncio
    async def test_successful_timeline(self) -> None:
        request = TimelineRequest(
            document_ids=["doc-001", "doc-002"],
            title="Case History Timeline",
        )
        response = await generate_timeline(request)

        assert isinstance(response, TimelineResponse)
        assert len(response.events) == 4
        assert response.summary != ""
        assert response.model_name == "test-timeline-model"

    @pytest.mark.asyncio
    async def test_events_have_correct_fields(self) -> None:
        request = TimelineRequest(
            document_ids=["doc-001"],
            title="Test Timeline",
        )
        response = await generate_timeline(request)

        event = response.events[0]
        assert event.date == "2020-01-15"
        assert event.label == "Filing of Complaint"
        assert event.source_document_id == "doc-001"
        assert event.event_type == "filing"

    @pytest.mark.asyncio
    async def test_retrieves_for_each_document(self) -> None:
        request = TimelineRequest(
            document_ids=["doc-001", "doc-002", "doc-003"],
            title="Multi-doc Timeline",
        )
        await generate_timeline(request)

        assert self.mock_retrieve_doc.call_count == 3

    @pytest.mark.asyncio
    async def test_confidence_in_range(self) -> None:
        request = TimelineRequest(
            document_ids=["doc-001"],
            title="Timeline",
        )
        response = await generate_timeline(request)

        assert 0.0 <= response.confidence_score <= 1.0

    @pytest.mark.asyncio
    async def test_invalid_llm_response_handled(self) -> None:
        self.mock_generate.return_value = "not json"

        request = TimelineRequest(
            document_ids=["doc-001"],
            title="Timeline",
        )
        response = await generate_timeline(request)

        assert response.events == []
        assert "unable" in response.summary.lower()

    @pytest.mark.asyncio
    async def test_invalid_events_filtered(self) -> None:
        data = _make_full_timeline_data()
        data["events"].append("not a dict")
        data["events"].append(None)
        self.mock_generate.return_value = json.dumps(data)

        request = TimelineRequest(
            document_ids=["doc-001"],
            title="Timeline",
        )
        response = await generate_timeline(request)

        # Only 4 valid events
        assert len(response.events) == 4

    @pytest.mark.asyncio
    async def test_generation_called_with_json_format(self) -> None:
        request = TimelineRequest(
            document_ids=["doc-001"],
            title="Timeline",
        )
        await generate_timeline(request)

        call_kwargs = self.mock_generate.call_args.kwargs
        assert call_kwargs.get("response_format") == "json_object"
        assert call_kwargs.get("temperature") == 0.2
