"""Tests for ``rag_client.retrieve_passages`` field preservation.

Until 2026-08-05 this function flattened every passage to ``{id, title,
text}``. That discarded the two fields grounding is measured with:
``section_id`` (the only id a citation can be checked against — ``id`` is the
OpenSearch hit id and resolves to nothing) and ``document_id`` (the only field
that can tell three sections of one statute from three authorities).
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock, patch

from src.clients import rag_client

SEC = "aaaaaaaa-0000-4000-8000-000000000001"
DOC = "11111111-1111-4111-8111-111111111111"


def _api_passage(**overrides: Any) -> dict[str, Any]:
    base = {
        "id": "hit-1",
        "section_id": SEC,
        "document_id": DOC,
        "title": "RPC Art. 315",
        "citation_text": "G.R. No. 1",
        "text": "estafa elements",
        "score": 412.5,
    }
    base.update(overrides)
    return base


def _mock_response(passages: list[dict[str, Any]]) -> MagicMock:
    response = MagicMock()
    response.json.return_value = {"passages": passages}
    response.raise_for_status.return_value = None
    client = MagicMock()
    client.__enter__.return_value.post.return_value = response
    return client


class TestFieldPreservation:
    @patch("src.clients.rag_client.httpx.Client")
    def test_section_id_document_id_and_score_survive(self, mock_client: MagicMock):
        mock_client.return_value = _mock_response([_api_passage()])

        result = rag_client.retrieve_passages("estafa", top_k=8)

        assert result[0]["section_id"] == SEC
        assert result[0]["document_id"] == DOC
        assert result[0]["score"] == 412.5

    @patch("src.clients.rag_client.httpx.Client")
    def test_null_section_id_stays_null_rather_than_becoming_a_string(
        self, mock_client: MagicMock
    ):
        """15-29% of prod passages carry no section id; they are not citable."""
        mock_client.return_value = _mock_response([_api_passage(section_id=None)])

        result = rag_client.retrieve_passages("estafa")

        assert result[0]["section_id"] is None

    @patch("src.clients.rag_client.httpx.Client")
    def test_missing_score_defaults_to_zero(self, mock_client: MagicMock):
        passage = _api_passage()
        del passage["score"]
        mock_client.return_value = _mock_response([passage])

        assert rag_client.retrieve_passages("estafa")[0]["score"] == 0.0

    @patch("src.clients.rag_client.httpx.Client")
    def test_title_falls_back_to_citation_text_then_source(
        self, mock_client: MagicMock
    ):
        mock_client.return_value = _mock_response(
            [
                _api_passage(title=""),
                _api_passage(title="", citation_text=""),
            ]
        )

        result = rag_client.retrieve_passages("estafa")

        assert result[0]["title"] == "G.R. No. 1"
        assert result[1]["title"] == "Source"

    @patch("src.clients.rag_client.httpx.Client")
    def test_retrieval_failure_still_returns_empty_list(self, mock_client: MagicMock):
        """Soft failure is the contract here — the caller falls back to priors."""
        mock_client.side_effect = RuntimeError("connection refused")

        assert rag_client.retrieve_passages("estafa", question_id="q-1") == []

    @patch("src.clients.rag_client.httpx.Client")
    def test_non_dict_entries_are_skipped(self, mock_client: MagicMock):
        mock_client.return_value = _mock_response([_api_passage(), "junk"])  # type: ignore[list-item]

        assert len(rag_client.retrieve_passages("estafa")) == 1
