"""Tests for the one-shot ``reprocess_documents_in_window`` Celery task.

Verifies happy path (re-fires all three follow-ups for documents missing
outputs) and idempotency (skips documents that already have outputs).
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from pydantic import ValidationError

from .conftest import make_uuid


@pytest.fixture()
def mock_reprocess_db() -> Any:
    """Mock ``ingestion_db_client`` accessed from
    ``src.tasks.reprocess_tasks``.
    """
    with patch("src.tasks.reprocess_tasks.db") as mock_db:
        yield mock_db


@pytest.fixture()
def mock_followup_tasks() -> Any:
    """Mock the three follow-up tasks the reprocess job dispatches.

    The task imports each one inline; patching at the module path each
    test imports keeps the wiring local.
    """
    with patch(
        "src.tasks.doctrine_tasks.extract_doctrines_task",
    ) as doctrines, patch(
        "src.tasks.citation_tasks.resolve_citations_task",
    ) as citations, patch(
        "src.tasks.embedding_tasks.generate_document_embeddings_task",
    ) as embeddings:
        yield {
            "doctrines": doctrines,
            "citations": citations,
            "embeddings": embeddings,
        }


def test_dispatches_all_followups_for_degraded_documents(
    mock_reprocess_db: MagicMock,
    mock_followup_tasks: dict[str, MagicMock],
) -> None:
    """Documents that have NO doctrines, NO resolved citations, and NO
    embeddings must trigger all three follow-up tasks.
    """
    from src.tasks.reprocess_tasks import reprocess_documents_in_window

    doc_ids = [make_uuid(), make_uuid(), make_uuid()]
    mock_reprocess_db.get_legal_document_ids_in_window.return_value = doc_ids
    mock_reprocess_db.count_doctrine_extracts_for_document.return_value = 0
    mock_reprocess_db.count_resolved_citations_for_document.return_value = 0
    mock_reprocess_db.count_section_embeddings_for_document.return_value = 0

    result = reprocess_documents_in_window(
        start_date="2026-04-24", end_date="2026-04-27",
    )

    assert result["documents_found"] == 3
    assert result["dispatched"] == {
        "doctrines": 3,
        "citations": 3,
        "embeddings": 3,
    }
    assert result["skipped"] == {
        "doctrines": 0,
        "citations": 0,
        "embeddings": 0,
    }
    assert mock_followup_tasks["doctrines"].delay.call_count == 3
    assert mock_followup_tasks["citations"].delay.call_count == 3
    assert mock_followup_tasks["embeddings"].delay.call_count == 3


def test_skips_documents_that_already_have_outputs(
    mock_reprocess_db: MagicMock,
    mock_followup_tasks: dict[str, MagicMock],
) -> None:
    """Idempotency: if a document already has doctrines + resolved
    citations + section embeddings, the reprocess task must NOT re-fire
    follow-ups for it.
    """
    from src.tasks.reprocess_tasks import reprocess_documents_in_window

    doc_ids = [make_uuid()]
    mock_reprocess_db.get_legal_document_ids_in_window.return_value = doc_ids
    mock_reprocess_db.count_doctrine_extracts_for_document.return_value = 5
    mock_reprocess_db.count_resolved_citations_for_document.return_value = 3
    mock_reprocess_db.count_section_embeddings_for_document.return_value = 12

    result = reprocess_documents_in_window(
        start_date="2026-04-24", end_date="2026-04-27",
    )

    assert result["dispatched"] == {
        "doctrines": 0,
        "citations": 0,
        "embeddings": 0,
    }
    assert result["skipped"] == {
        "doctrines": 1,
        "citations": 1,
        "embeddings": 1,
    }
    mock_followup_tasks["doctrines"].delay.assert_not_called()
    mock_followup_tasks["citations"].delay.assert_not_called()
    mock_followup_tasks["embeddings"].delay.assert_not_called()


def test_force_dispatches_even_when_outputs_exist(
    mock_reprocess_db: MagicMock,
    mock_followup_tasks: dict[str, MagicMock],
) -> None:
    """``force=True`` overrides the idempotency check — useful when the
    pre-existing outputs themselves are suspect.
    """
    from src.tasks.reprocess_tasks import reprocess_documents_in_window

    doc_ids = [make_uuid(), make_uuid()]
    mock_reprocess_db.get_legal_document_ids_in_window.return_value = doc_ids
    # All counts non-zero — without force, nothing would dispatch.
    mock_reprocess_db.count_doctrine_extracts_for_document.return_value = 5
    mock_reprocess_db.count_resolved_citations_for_document.return_value = 5
    mock_reprocess_db.count_section_embeddings_for_document.return_value = 5

    result = reprocess_documents_in_window(
        start_date="2026-04-24",
        end_date="2026-04-27",
        force=True,
    )

    assert result["dispatched"] == {
        "doctrines": 2,
        "citations": 2,
        "embeddings": 2,
    }


def test_empty_window_dispatches_nothing(
    mock_reprocess_db: MagicMock,
    mock_followup_tasks: dict[str, MagicMock],
) -> None:
    from src.tasks.reprocess_tasks import reprocess_documents_in_window

    mock_reprocess_db.get_legal_document_ids_in_window.return_value = []

    result = reprocess_documents_in_window(
        start_date="2026-04-24", end_date="2026-04-25",
    )

    assert result["documents_found"] == 0
    mock_followup_tasks["doctrines"].delay.assert_not_called()
    mock_followup_tasks["citations"].delay.assert_not_called()
    mock_followup_tasks["embeddings"].delay.assert_not_called()


def test_strict_pydantic_rejects_non_string_dates(
    mock_reprocess_db: MagicMock,
    mock_followup_tasks: dict[str, MagicMock],
) -> None:
    """Pydantic strict mode catches operator typos like ints or None."""
    from src.tasks.reprocess_tasks import ReprocessWindow

    with pytest.raises(ValidationError):
        ReprocessWindow(start_date=20260424, end_date="2026-04-27")  # type: ignore[arg-type]


def test_create_digest_idempotent_on_unique_constraint() -> None:
    """``create_digest`` must use ``ON CONFLICT DO NOTHING`` and fall back
    to the existing row's id on conflict, so a digest task retry does not
    explode with ``UniqueViolation`` on ``uq_digest_document_type``.
    """
    from src.clients import ingestion_db_client

    with patch(
        "src.clients.ingestion_db_client.get_connection",
    ) as mock_get_conn:
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        # First execute is the INSERT — simulate ON CONFLICT (no row
        # returned). Second execute is the SELECT for the existing id.
        mock_cursor.fetchone.side_effect = [None, ("existing-digest-id",)]
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
        mock_conn.cursor.return_value.__exit__.return_value = False
        mock_get_conn.return_value.__enter__.return_value = mock_conn
        mock_get_conn.return_value.__exit__.return_value = False

        digest_id = ingestion_db_client.create_digest(
            document_id="doc-1",
            title="Digest: Test",
            source_origin="official_pipeline",
            digest_type="case_digest",
            summary="s",
            facts="f",
            petitioner_arguments=None,
            respondent_arguments=None,
            issues=None,
            ruling=None,
            doctrine=None,
            dispositive=None,
            cited_authorities_json="[]",
            confidence_score=0.8,
            review_status="ai_generated",
            visibility="public_editorial",
        )

        assert digest_id == "existing-digest-id"
        # The first executed SQL must contain ON CONFLICT.
        first_sql = mock_cursor.execute.call_args_list[0].args[0]
        assert "ON CONFLICT" in first_sql.upper()
        assert "DO NOTHING" in first_sql.upper()
        assert "RETURNING id" in first_sql
