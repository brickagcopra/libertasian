"""Tests for doctrine extraction Celery tasks.

Mocks: db_client, rag_client.
Verifies: section fetching, RAG service call, doctrine saving,
confidence thresholds, model run auditing.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from .conftest import make_uuid


class TestExtractDoctrinesTask:
    """Tests for the extract_doctrines_task Celery task."""

    def test_no_sections_uses_empty_text(
        self,
        mock_db_client: MagicMock,
        mock_rag_client: MagicMock,
        document_id: str,
    ) -> None:
        from src.tasks.doctrine_tasks import extract_doctrines_task

        mock_db_client.get_document_sections.return_value = []
        mock_rag_client.extract_doctrines.return_value = {
            "doctrines": [],
            "model_name": "test-model",
            "prompt_template_version": "v1",
            "strategy_used": "full_text",
        }

        result = extract_doctrines_task(document_id=document_id)

        assert result["status"] == "completed"
        assert result["doctrines_extracted"] == 0
        mock_db_client.create_model_run.assert_called_once()

    def test_extracts_and_saves_doctrines(
        self,
        mock_db_client: MagicMock,
        mock_rag_client: MagicMock,
        document_id: str,
        sample_sections: list[dict[str, Any]],
    ) -> None:
        from src.tasks.doctrine_tasks import extract_doctrines_task

        doctrine_id = make_uuid()
        mock_db_client.get_document_sections.return_value = sample_sections
        mock_db_client.create_doctrine_extract.return_value = doctrine_id
        mock_rag_client.extract_doctrines.return_value = {
            "doctrines": [
                {
                    "text": "The doctrine of res judicata applies when...",
                    "normalized_text": "res judicata",
                    "doctrine_type": "principle",
                    "confidence": 0.85,
                    "source_section_id": sample_sections[1]["id"],
                },
            ],
            "model_name": "llama-3.1-70b",
            "prompt_template_version": "doctrine-v2",
            "strategy_used": "sections_only",
        }

        result = extract_doctrines_task(document_id=document_id)

        assert result["status"] == "completed"
        assert result["doctrines_extracted"] == 1
        assert result["model_name"] == "llama-3.1-70b"
        mock_db_client.create_doctrine_extract.assert_called_once()

    def test_high_confidence_gets_ai_generated_status(
        self,
        mock_db_client: MagicMock,
        mock_rag_client: MagicMock,
        document_id: str,
        sample_sections: list[dict[str, Any]],
    ) -> None:
        """Per CLAUDE.md: confidence >= 0.7 -> 'ai_generated' status."""
        from src.tasks.doctrine_tasks import extract_doctrines_task

        mock_db_client.get_document_sections.return_value = sample_sections
        mock_rag_client.extract_doctrines.return_value = {
            "doctrines": [
                {"text": "test", "confidence": 0.75, "doctrine_type": "principle"},
            ],
            "model_name": "test-model",
            "prompt_template_version": "v1",
        }

        extract_doctrines_task(document_id=document_id)

        call_args = mock_db_client.create_doctrine_extract.call_args
        assert call_args.kwargs["review_status"] == "ai_generated"

    def test_low_confidence_gets_needs_review_status(
        self,
        mock_db_client: MagicMock,
        mock_rag_client: MagicMock,
        document_id: str,
        sample_sections: list[dict[str, Any]],
    ) -> None:
        """Per CLAUDE.md: confidence < 0.7 -> 'needs_human_review' status."""
        from src.tasks.doctrine_tasks import extract_doctrines_task

        mock_db_client.get_document_sections.return_value = sample_sections
        mock_rag_client.extract_doctrines.return_value = {
            "doctrines": [
                {"text": "test", "confidence": 0.5, "doctrine_type": "principle"},
            ],
            "model_name": "test-model",
            "prompt_template_version": "v1",
        }

        extract_doctrines_task(document_id=document_id)

        call_args = mock_db_client.create_doctrine_extract.call_args
        assert call_args.kwargs["review_status"] == "needs_human_review"

    def test_full_text_strategy_concatenates_sections(
        self,
        mock_db_client: MagicMock,
        mock_rag_client: MagicMock,
        document_id: str,
        sample_sections: list[dict[str, Any]],
    ) -> None:
        from src.tasks.doctrine_tasks import extract_doctrines_task

        mock_db_client.get_document_sections.return_value = sample_sections
        mock_rag_client.extract_doctrines.return_value = {
            "doctrines": [],
            "model_name": "test",
            "prompt_template_version": "v1",
        }

        extract_doctrines_task(document_id=document_id, strategy="full_text")

        # Should pass document_text (not sections) to RAG service
        call_args = mock_rag_client.extract_doctrines.call_args
        assert call_args.kwargs.get("document_text") is not None

    def test_model_run_logged_for_audit(
        self,
        mock_db_client: MagicMock,
        mock_rag_client: MagicMock,
        document_id: str,
    ) -> None:
        """Per CLAUDE.md: pin model versions in model_runs table."""
        from src.tasks.doctrine_tasks import extract_doctrines_task

        mock_db_client.get_document_sections.return_value = []
        mock_rag_client.extract_doctrines.return_value = {
            "doctrines": [],
            "model_name": "llama-3.1-70b",
            "prompt_template_version": "doctrine-v2",
        }

        extract_doctrines_task(document_id=document_id)

        mock_db_client.create_model_run.assert_called_once()
        call_args = mock_db_client.create_model_run.call_args
        assert call_args.kwargs["run_type"] == "doctrine_extract"
        assert call_args.kwargs["model_name"] == "llama-3.1-70b"
        assert call_args.kwargs["prompt_template_version"] == "doctrine-v2"

    def test_multiple_doctrines_saved(
        self,
        mock_db_client: MagicMock,
        mock_rag_client: MagicMock,
        document_id: str,
        sample_sections: list[dict[str, Any]],
    ) -> None:
        from src.tasks.doctrine_tasks import extract_doctrines_task

        mock_db_client.get_document_sections.return_value = sample_sections
        mock_rag_client.extract_doctrines.return_value = {
            "doctrines": [
                {"text": "Doctrine 1", "confidence": 0.9, "doctrine_type": "principle"},
                {"text": "Doctrine 2", "confidence": 0.8, "doctrine_type": "rule"},
                {"text": "Doctrine 3", "confidence": 0.6, "doctrine_type": "test"},
            ],
            "model_name": "test-model",
            "prompt_template_version": "v1",
        }

        result = extract_doctrines_task(document_id=document_id)

        assert result["doctrines_extracted"] == 3
        assert mock_db_client.create_doctrine_extract.call_count == 3

    def test_backfill_batch_id_increments_budget_consumed_usd(
        self,
        mock_db_client: MagicMock,
        mock_rag_client: MagicMock,
        document_id: str,
    ) -> None:
        """Bug 7 regression: when ``backfill_batch_id`` is forwarded, the
        per-call LLM cost must accumulate on the batch row's
        ``budget_consumed_usd`` counter via ``update_batch_counters``."""
        from src.tasks.doctrine_tasks import extract_doctrines_task

        batch_id = make_uuid()
        mock_db_client.get_document_sections.return_value = []
        mock_rag_client.extract_doctrines.return_value = {
            "doctrines": [],
            # claude-haiku-4-5 is in pricing._PRICE_PER_MTOK so cost > 0.
            "model_name": "claude-haiku-4-5",
            "prompt_template_version": "v1",
            "strategy_used": "full_text",
            "tokens_in": 1000,
            "tokens_out": 200,
        }

        with patch(
            "src.clients.backfill_db_client.update_batch_counters",
        ) as mock_update:
            extract_doctrines_task(
                document_id=document_id,
                backfill_batch_id=batch_id,
            )

        mock_update.assert_called_once()
        call_kwargs = mock_update.call_args.kwargs
        assert "budget_consumed_usd" in call_kwargs
        # haiku price: $1/Mtok in + $5/Mtok out → 1000*1/1M + 200*5/1M = 0.002
        assert float(call_kwargs["budget_consumed_usd"]) == pytest.approx(0.002)

    def test_no_backfill_batch_id_skips_budget_increment(
        self,
        mock_db_client: MagicMock,
        mock_rag_client: MagicMock,
        document_id: str,
    ) -> None:
        """Daily-crawl / on-demand callers pass no ``backfill_batch_id``;
        the cost-attribution path must short-circuit."""
        from src.tasks.doctrine_tasks import extract_doctrines_task

        mock_db_client.get_document_sections.return_value = []
        mock_rag_client.extract_doctrines.return_value = {
            "doctrines": [],
            "model_name": "claude-haiku-4-5",
            "prompt_template_version": "v1",
            "strategy_used": "full_text",
            "tokens_in": 1000,
            "tokens_out": 200,
        }

        with patch(
            "src.clients.backfill_db_client.update_batch_counters",
        ) as mock_update:
            extract_doctrines_task(document_id=document_id)

        mock_update.assert_not_called()
