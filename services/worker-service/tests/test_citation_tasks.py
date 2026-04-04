"""Tests for citation resolution Celery tasks.

Mocks: db_client, rag_client.
Verifies: unresolved citation fetching, RAG service call, resolution updates,
partial resolution handling, retry behavior.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock, call

import pytest

from .conftest import make_uuid


class TestResolveCitationsTask:
    """Tests for the resolve_citations_task Celery task."""

    def test_no_unresolved_citations_completes_immediately(
        self,
        mock_db_client: MagicMock,
        mock_rag_client: MagicMock,
        document_id: str,
    ) -> None:
        from src.tasks.citation_tasks import resolve_citations_task

        mock_db_client.get_unresolved_citations.return_value = []

        result = resolve_citations_task(document_id=document_id)

        assert result["status"] == "completed"
        assert result["total_citations"] == 0
        assert result["resolved_count"] == 0
        mock_rag_client.resolve_citations.assert_not_called()

    def test_resolves_citations_via_rag_service(
        self,
        mock_db_client: MagicMock,
        mock_rag_client: MagicMock,
        document_id: str,
        sample_citations: list[dict[str, Any]],
    ) -> None:
        from src.tasks.citation_tasks import resolve_citations_task

        target_doc_id = make_uuid()
        mock_db_client.get_unresolved_citations.return_value = sample_citations
        mock_rag_client.resolve_citations.return_value = {
            "results": [
                {
                    "citation_id": sample_citations[0]["id"],
                    "resolved": True,
                    "to_document_id": target_doc_id,
                    "confidence": 0.92,
                    "resolver_method": "exact_match",
                },
            ],
        }

        result = resolve_citations_task(document_id=document_id)

        assert result["status"] == "completed"
        assert result["total_citations"] == 2
        assert result["resolved_count"] == 1
        assert result["unresolved_count"] == 1
        mock_db_client.update_citation_resolution.assert_called_once_with(
            citation_id=sample_citations[0]["id"],
            to_document_id=target_doc_id,
            confidence=0.92,
            resolver_method="exact_match",
        )

    def test_all_citations_resolved(
        self,
        mock_db_client: MagicMock,
        mock_rag_client: MagicMock,
        document_id: str,
        sample_citations: list[dict[str, Any]],
    ) -> None:
        from src.tasks.citation_tasks import resolve_citations_task

        target_ids = [make_uuid(), make_uuid()]
        mock_db_client.get_unresolved_citations.return_value = sample_citations
        mock_rag_client.resolve_citations.return_value = {
            "results": [
                {
                    "citation_id": sample_citations[0]["id"],
                    "resolved": True,
                    "to_document_id": target_ids[0],
                    "confidence": 0.95,
                    "resolver_method": "exact_match",
                },
                {
                    "citation_id": sample_citations[1]["id"],
                    "resolved": True,
                    "to_document_id": target_ids[1],
                    "confidence": 0.78,
                    "resolver_method": "fuzzy_match",
                },
            ],
        }

        result = resolve_citations_task(document_id=document_id)

        assert result["resolved_count"] == 2
        assert result["unresolved_count"] == 0
        assert mock_db_client.update_citation_resolution.call_count == 2

    def test_unresolved_result_not_updated_in_db(
        self,
        mock_db_client: MagicMock,
        mock_rag_client: MagicMock,
        document_id: str,
        sample_citations: list[dict[str, Any]],
    ) -> None:
        from src.tasks.citation_tasks import resolve_citations_task

        mock_db_client.get_unresolved_citations.return_value = sample_citations
        mock_rag_client.resolve_citations.return_value = {
            "results": [
                {
                    "citation_id": sample_citations[0]["id"],
                    "resolved": False,
                    "to_document_id": None,
                },
            ],
        }

        result = resolve_citations_task(document_id=document_id)

        assert result["resolved_count"] == 0
        mock_db_client.update_citation_resolution.assert_not_called()

    def test_missing_to_document_id_not_counted(
        self,
        mock_db_client: MagicMock,
        mock_rag_client: MagicMock,
        document_id: str,
        sample_citations: list[dict[str, Any]],
    ) -> None:
        """Even if resolved=True, missing to_document_id means not resolved."""
        from src.tasks.citation_tasks import resolve_citations_task

        mock_db_client.get_unresolved_citations.return_value = sample_citations
        mock_rag_client.resolve_citations.return_value = {
            "results": [
                {
                    "citation_id": sample_citations[0]["id"],
                    "resolved": True,
                    "to_document_id": None,
                },
            ],
        }

        result = resolve_citations_task(document_id=document_id)

        assert result["resolved_count"] == 0
        mock_db_client.update_citation_resolution.assert_not_called()

    def test_default_confidence_and_resolver_method(
        self,
        mock_db_client: MagicMock,
        mock_rag_client: MagicMock,
        document_id: str,
        sample_citations: list[dict[str, Any]],
    ) -> None:
        """When RAG result omits confidence/resolver_method, defaults apply."""
        from src.tasks.citation_tasks import resolve_citations_task

        target_id = make_uuid()
        mock_db_client.get_unresolved_citations.return_value = [sample_citations[0]]
        mock_rag_client.resolve_citations.return_value = {
            "results": [
                {
                    "citation_id": sample_citations[0]["id"],
                    "resolved": True,
                    "to_document_id": target_id,
                    # no confidence or resolver_method keys
                },
            ],
        }

        resolve_citations_task(document_id=document_id)

        mock_db_client.update_citation_resolution.assert_called_once_with(
            citation_id=sample_citations[0]["id"],
            to_document_id=target_id,
            confidence=0.0,
            resolver_method="auto",
        )

    def test_rag_payload_format(
        self,
        mock_db_client: MagicMock,
        mock_rag_client: MagicMock,
        document_id: str,
        sample_citations: list[dict[str, Any]],
    ) -> None:
        """Verify the citations payload sent to RAG service."""
        from src.tasks.citation_tasks import resolve_citations_task

        mock_db_client.get_unresolved_citations.return_value = sample_citations
        mock_rag_client.resolve_citations.return_value = {"results": []}

        resolve_citations_task(document_id=document_id)

        call_args = mock_rag_client.resolve_citations.call_args
        assert call_args.kwargs["document_id"] == document_id
        payload = call_args.kwargs["citations"]
        assert len(payload) == 2
        assert payload[0]["citation_text"] == "G.R. No. 111111"
        assert payload[1]["citation_type"] == "statute"

    def test_empty_results_from_rag(
        self,
        mock_db_client: MagicMock,
        mock_rag_client: MagicMock,
        document_id: str,
        sample_citations: list[dict[str, Any]],
    ) -> None:
        """RAG returns empty results list — all citations remain unresolved."""
        from src.tasks.citation_tasks import resolve_citations_task

        mock_db_client.get_unresolved_citations.return_value = sample_citations
        mock_rag_client.resolve_citations.return_value = {"results": []}

        result = resolve_citations_task(document_id=document_id)

        assert result["total_citations"] == 2
        assert result["resolved_count"] == 0
        assert result["unresolved_count"] == 2
