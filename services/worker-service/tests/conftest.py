"""Shared test fixtures for LIBERTASIAN worker service integration tests.

Provides mock clients, sample data, and Celery test configuration.
All external dependencies (DB, S3, RAG, OCR, NestJS) are mocked.
"""

from __future__ import annotations

import uuid
from typing import Any
from unittest.mock import MagicMock, patch

import pytest


# ─── Sample Data Factories ──────────────────────────────────────────────


def make_uuid() -> str:
    return str(uuid.uuid4())


@pytest.fixture()
def source_id() -> str:
    return make_uuid()


@pytest.fixture()
def document_id() -> str:
    return make_uuid()


@pytest.fixture()
def candidate_id() -> str:
    return make_uuid()


@pytest.fixture()
def job_id() -> str:
    return make_uuid()


@pytest.fixture()
def sample_source(source_id: str) -> dict[str, Any]:
    return {
        "id": source_id,
        "name": "Supreme Court E-Library",
        "type": "official",
        "domain": "elibrary.judiciary.gov.ph",
        "trust_level": "high",
        "enabled": True,
        "fetch_strategy": "crawler",
        "endpoints": [
            {
                "id": make_uuid(),
                "source_id": source_id,
                "endpoint_url": "https://elibrary.judiciary.gov.ph/dtSearch/search.html",
                "parser_type": "supreme_court_elibrary",
                "status": "active",
                "last_fetched_at": None,
            },
        ],
    }


@pytest.fixture()
def sample_document(document_id: str, source_id: str) -> dict[str, Any]:
    return {
        "id": document_id,
        "source_id": source_id,
        "title": "Republic v. Sandiganbayan",
        "document_type": "case",
        "court": "Supreme Court",
        "decision_date": "2024-01-15",
        "gr_no": "G.R. No. 123456",
        "status": "draft",
        "truthfulness_status": "needs_review",
        "is_published": False,
        "checksum": "abc123def456",
    }


@pytest.fixture()
def sample_sections(document_id: str) -> list[dict[str, Any]]:
    return [
        {
            "id": make_uuid(),
            "legal_document_id": document_id,
            "section_type": "facts",
            "plain_text": "The petitioner filed a case against respondent...",
            "ordering": 0,
        },
        {
            "id": make_uuid(),
            "legal_document_id": document_id,
            "section_type": "ruling",
            "plain_text": "The Court finds that the petitioner has standing...",
            "ordering": 1,
        },
        {
            "id": make_uuid(),
            "legal_document_id": document_id,
            "section_type": "dispositive",
            "plain_text": "WHEREFORE, the petition is GRANTED.",
            "ordering": 2,
        },
    ]


@pytest.fixture()
def sample_citations(document_id: str) -> list[dict[str, Any]]:
    return [
        {
            "id": make_uuid(),
            "from_document_id": document_id,
            "citation_text": "G.R. No. 111111",
            "normalized_citation": "G.R. No. 111111",
            "citation_type": "case",
        },
        {
            "id": make_uuid(),
            "from_document_id": document_id,
            "citation_text": "Republic Act No. 9165",
            "normalized_citation": "RA 9165",
            "citation_type": "statute",
        },
    ]


@pytest.fixture()
def sample_editorial_flags() -> list[dict[str, Any]]:
    return []


# ─── Mock Clients ────────────────────────────────────────────────────────


@pytest.fixture()
def mock_ingestion_db() -> MagicMock:
    """Mock the ingestion DB client used by ingestion tasks."""
    with patch("src.tasks.ingestion_tasks.db") as mock_db:
        mock_db.get_pending_ingestion_jobs.return_value = []
        mock_db.claim_ingestion_job.return_value = True
        mock_db.create_ingestion_candidate.return_value = make_uuid()
        mock_db.create_legal_document.return_value = make_uuid()
        mock_db.create_legal_document_version.return_value = make_uuid()
        mock_db.create_legal_document_sections.return_value = [make_uuid()]
        mock_db.find_candidate_by_similarity_key.return_value = None
        mock_db.find_document_by_checksum.return_value = None
        mock_db.find_document_by_gr_no.return_value = None
        mock_db.get_editorial_flags_for_document.return_value = []
        mock_db.get_citation_counts.return_value = {"total": 0, "resolved": 0}
        yield mock_db


@pytest.fixture()
def mock_db_client() -> MagicMock:
    """Mock the general DB client used by doctrine/citation tasks."""
    mock_db = MagicMock()
    mock_db.get_document_sections.return_value = []
    mock_db.get_unresolved_citations.return_value = []
    mock_db.create_doctrine_extract.return_value = make_uuid()
    mock_db.create_model_run.return_value = make_uuid()
    mock_db.update_citation_resolution.return_value = None
    with patch("src.tasks.doctrine_tasks.db_client", mock_db), \
         patch("src.tasks.citation_tasks.db_client", mock_db):
        yield mock_db


@pytest.fixture()
def mock_embedding_db_client() -> MagicMock:
    """Mock the DB client used by embedding tasks."""
    with patch("src.tasks.embedding_tasks.db_client") as mock_db:
        mock_db.get_document_sections.return_value = []
        mock_db.get_existing_embedding_ids.return_value = set()
        mock_db.create_embeddings_batch.return_value = []
        mock_db.create_model_run.return_value = make_uuid()
        yield mock_db


@pytest.fixture()
def mock_embedding_client() -> MagicMock:
    """Mock the embedding service HTTP client."""
    with patch("src.tasks.embedding_tasks.embedding_client") as mock_embed:
        mock_embed.is_available.return_value = True
        mock_embed.generate_embeddings_batch.return_value = {
            "embeddings": [],
            "model_name": "BAAI/bge-small-en-v1.5",
            "dimension": 384,
            "count": 0,
        }
        yield mock_embed


@pytest.fixture()
def mock_rag_client() -> MagicMock:
    """Mock the RAG service HTTP client."""
    mock_rag = MagicMock()
    mock_rag.extract_doctrines.return_value = {
        "doctrines": [],
        "model_name": "test-model",
        "prompt_template_version": "v1",
        "strategy_used": "auto",
    }
    mock_rag.resolve_citations.return_value = {
        "results": [],
    }
    with patch("src.tasks.doctrine_tasks.rag_client", mock_rag), \
         patch("src.tasks.citation_tasks.rag_client", mock_rag):
        yield mock_rag


@pytest.fixture()
def mock_s3_client() -> MagicMock:
    """Mock the S3/MinIO client."""
    with patch("src.tasks.ingestion_tasks.s3_client") as mock_s3:
        mock_s3.upload_file.return_value = None
        mock_s3.download_file.return_value = b"<html>test</html>"
        yield mock_s3


@pytest.fixture()
def mock_nestjs_client() -> MagicMock:
    """Mock the NestJS API HTTP client."""
    with patch("src.tasks.ingestion_tasks.nestjs_client") as mock_nestjs:
        mock_nestjs.trigger_opensearch_index.return_value = True
        yield mock_nestjs


@pytest.fixture()
def mock_dlq_db() -> MagicMock:
    """Mock the DB client for DLQ tasks."""
    with patch("src.tasks.dlq_tasks.db") as mock_db:
        mock_db.create_audit_log.return_value = None
        mock_db.create_editorial_flag_for_failed_task.return_value = make_uuid()
        yield mock_db
