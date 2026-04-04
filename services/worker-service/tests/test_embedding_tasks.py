"""Tests for embedding generation Celery tasks.

Mocks: db_client, embedding_client.
Verifies: section fetching, idempotency, batch embedding,
DB storage, model run auditing, graceful degradation.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

from .conftest import make_uuid


class TestGenerateDocumentEmbeddingsTask:
    """Tests for the generate_document_embeddings_task Celery task."""

    def test_skips_when_embedding_service_unavailable(
        self,
        mock_embedding_db_client: MagicMock,
        mock_embedding_client: MagicMock,
        document_id: str,
    ) -> None:
        from src.tasks.embedding_tasks import generate_document_embeddings_task

        mock_embedding_client.is_available.return_value = False

        result = generate_document_embeddings_task(document_id=document_id)

        assert result["status"] == "skipped"
        assert result["reason"] == "embedding_service_unavailable"
        mock_embedding_db_client.get_document_sections.assert_not_called()

    def test_skips_when_no_sections(
        self,
        mock_embedding_db_client: MagicMock,
        mock_embedding_client: MagicMock,
        document_id: str,
    ) -> None:
        from src.tasks.embedding_tasks import generate_document_embeddings_task

        mock_embedding_db_client.get_document_sections.return_value = []

        result = generate_document_embeddings_task(document_id=document_id)

        assert result["status"] == "skipped"
        assert result["reason"] == "no_sections"

    def test_skips_when_all_sections_empty_text(
        self,
        mock_embedding_db_client: MagicMock,
        mock_embedding_client: MagicMock,
        document_id: str,
    ) -> None:
        from src.tasks.embedding_tasks import generate_document_embeddings_task

        mock_embedding_db_client.get_document_sections.return_value = [
            {"id": make_uuid(), "plain_text": "", "section_type": "body"},
            {"id": make_uuid(), "plain_text": None, "section_type": "body"},
            {"id": make_uuid(), "plain_text": "   ", "section_type": "body"},
        ]

        result = generate_document_embeddings_task(document_id=document_id)

        assert result["status"] == "skipped"
        assert result["reason"] == "empty_sections"

    def test_skips_already_embedded_sections(
        self,
        mock_embedding_db_client: MagicMock,
        mock_embedding_client: MagicMock,
        document_id: str,
        sample_sections: list[dict[str, Any]],
    ) -> None:
        """Idempotent: if all sections already have embeddings, skip."""
        from src.tasks.embedding_tasks import generate_document_embeddings_task

        mock_embedding_db_client.get_document_sections.return_value = sample_sections
        # All section IDs already have embeddings
        existing_ids = {s["id"] for s in sample_sections}
        mock_embedding_db_client.get_existing_embedding_ids.return_value = existing_ids

        result = generate_document_embeddings_task(document_id=document_id)

        assert result["status"] == "skipped"
        assert result["reason"] == "already_embedded"
        assert result["existing_count"] == len(sample_sections)
        mock_embedding_client.generate_embeddings_batch.assert_not_called()

    def test_generates_embeddings_for_new_sections(
        self,
        mock_embedding_db_client: MagicMock,
        mock_embedding_client: MagicMock,
        document_id: str,
        sample_sections: list[dict[str, Any]],
    ) -> None:
        from src.tasks.embedding_tasks import generate_document_embeddings_task

        mock_embedding_db_client.get_document_sections.return_value = sample_sections
        mock_embedding_db_client.get_existing_embedding_ids.return_value = set()

        # Return one embedding per section
        fake_embeddings = [[0.1, 0.2, 0.3] for _ in sample_sections]
        mock_embedding_client.generate_embeddings_batch.return_value = {
            "embeddings": fake_embeddings,
            "model_name": "BAAI/bge-small-en-v1.5",
            "dimension": 384,
            "count": len(sample_sections),
        }

        embedding_ids = [make_uuid() for _ in sample_sections]
        mock_embedding_db_client.create_embeddings_batch.return_value = embedding_ids

        result = generate_document_embeddings_task(document_id=document_id)

        assert result["status"] == "completed"
        assert result["embeddings_created"] == len(sample_sections)
        assert result["model_name"] == "BAAI/bge-small-en-v1.5"
        mock_embedding_client.generate_embeddings_batch.assert_called_once()
        mock_embedding_db_client.create_embeddings_batch.assert_called_once()

    def test_partial_embedding_only_processes_new_sections(
        self,
        mock_embedding_db_client: MagicMock,
        mock_embedding_client: MagicMock,
        document_id: str,
        sample_sections: list[dict[str, Any]],
    ) -> None:
        """Idempotent: only embed sections that don't yet have embeddings."""
        from src.tasks.embedding_tasks import generate_document_embeddings_task

        mock_embedding_db_client.get_document_sections.return_value = sample_sections
        # First section already has embedding
        mock_embedding_db_client.get_existing_embedding_ids.return_value = {
            sample_sections[0]["id"],
        }

        new_count = len(sample_sections) - 1
        fake_embeddings = [[0.1, 0.2, 0.3] for _ in range(new_count)]
        mock_embedding_client.generate_embeddings_batch.return_value = {
            "embeddings": fake_embeddings,
            "model_name": "BAAI/bge-small-en-v1.5",
            "dimension": 384,
            "count": new_count,
        }

        embedding_ids = [make_uuid() for _ in range(new_count)]
        mock_embedding_db_client.create_embeddings_batch.return_value = embedding_ids

        result = generate_document_embeddings_task(document_id=document_id)

        assert result["status"] == "completed"
        assert result["embeddings_created"] == new_count
        assert result["sections_skipped"] == 1

        # Verify only new section texts were sent to embedding service
        call_args = mock_embedding_client.generate_embeddings_batch.call_args
        texts_sent = call_args[0][0]
        assert len(texts_sent) == new_count

    def test_model_run_logged_for_audit(
        self,
        mock_embedding_db_client: MagicMock,
        mock_embedding_client: MagicMock,
        document_id: str,
        sample_sections: list[dict[str, Any]],
    ) -> None:
        """Per CLAUDE.md: pin model versions in model_runs table."""
        from src.tasks.embedding_tasks import generate_document_embeddings_task

        mock_embedding_db_client.get_document_sections.return_value = sample_sections

        fake_embeddings = [[0.1] for _ in sample_sections]
        mock_embedding_client.generate_embeddings_batch.return_value = {
            "embeddings": fake_embeddings,
            "model_name": "BAAI/bge-small-en-v1.5",
            "dimension": 384,
            "count": len(sample_sections),
        }
        mock_embedding_db_client.create_embeddings_batch.return_value = [
            make_uuid() for _ in sample_sections
        ]

        generate_document_embeddings_task(document_id=document_id)

        mock_embedding_db_client.create_model_run.assert_called_once()
        call_args = mock_embedding_db_client.create_model_run.call_args
        assert call_args.kwargs["run_type"] == "embedding_generation"
        assert call_args.kwargs["model_name"] == "BAAI/bge-small-en-v1.5"

    def test_embedding_records_have_correct_structure(
        self,
        mock_embedding_db_client: MagicMock,
        mock_embedding_client: MagicMock,
        document_id: str,
        sample_sections: list[dict[str, Any]],
    ) -> None:
        from src.tasks.embedding_tasks import generate_document_embeddings_task

        mock_embedding_db_client.get_document_sections.return_value = sample_sections

        fake_embeddings = [[0.1, 0.2] for _ in sample_sections]
        mock_embedding_client.generate_embeddings_batch.return_value = {
            "embeddings": fake_embeddings,
            "model_name": "BAAI/bge-small-en-v1.5",
            "dimension": 384,
            "count": len(sample_sections),
        }
        mock_embedding_db_client.create_embeddings_batch.return_value = [
            make_uuid() for _ in sample_sections
        ]

        generate_document_embeddings_task(document_id=document_id)

        call_args = mock_embedding_db_client.create_embeddings_batch.call_args
        records = call_args[0][0]

        assert len(records) == len(sample_sections)
        for record in records:
            assert record["entity_type"] == "section"
            assert record["embedding_model"] == "BAAI/bge-small-en-v1.5"
            assert "vector_ref" in record
            assert record["entity_id"] in {s["id"] for s in sample_sections}

    def test_truncates_long_section_text(
        self,
        mock_embedding_db_client: MagicMock,
        mock_embedding_client: MagicMock,
        document_id: str,
    ) -> None:
        from src.tasks.embedding_tasks import (
            MAX_TEXT_LENGTH,
            generate_document_embeddings_task,
        )

        long_section = {
            "id": make_uuid(),
            "plain_text": "x" * (MAX_TEXT_LENGTH + 5000),
            "section_type": "body",
        }
        mock_embedding_db_client.get_document_sections.return_value = [long_section]

        mock_embedding_client.generate_embeddings_batch.return_value = {
            "embeddings": [[0.1]],
            "model_name": "test",
            "dimension": 384,
            "count": 1,
        }
        mock_embedding_db_client.create_embeddings_batch.return_value = [make_uuid()]

        generate_document_embeddings_task(document_id=document_id)

        call_args = mock_embedding_client.generate_embeddings_batch.call_args
        texts = call_args[0][0]
        assert len(texts[0]) == MAX_TEXT_LENGTH
