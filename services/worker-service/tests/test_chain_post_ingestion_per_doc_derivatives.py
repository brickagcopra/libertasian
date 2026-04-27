"""Tests for the per-doc derivative auto-dispatch added to
``chain_post_ingestion``: essay_prompt, mcq_question, flashcard.

DB enqueue helper + each .delay() are mocked at function level. Existing
chain dispatches (doctrine/digest/citation/etc.) are mocked too so the
test focuses on the new behaviour and stays runnable without Redis.
"""

from __future__ import annotations

import uuid
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

_PER_DOC_TYPES = ("essay_prompt", "mcq_question", "flashcard")


@pytest.fixture()
def patched_chain() -> Any:
    """Patch every dispatched task + the new enqueue helper."""
    with patch("src.tasks.ingestion_tasks.db") as mock_db, \
         patch("src.tasks.ingestion_tasks.validate_and_publish") as mock_val, \
         patch("src.tasks.citation_tasks.resolve_citations_task"), \
         patch("src.tasks.doctrine_tasks.extract_doctrines_task"), \
         patch("src.tasks.digest_tasks.generate_ingestion_digest"), \
         patch("src.tasks.categorization_tasks.categorize_document_task"), \
         patch(
             "src.tasks.classification_generation_tasks.classify_document_subjects",
         ), \
         patch(
             "src.tasks.embedding_tasks.generate_document_embeddings_task",
         ), \
         patch(
             "src.tasks.essay_generation_tasks.generate_essay_prompt",
         ) as mock_essay, \
         patch(
             "src.tasks.mcq_generation_tasks.generate_mcq_questions",
         ) as mock_mcq, \
         patch(
             "src.tasks.flashcard_generation_tasks.generate_flashcards",
         ) as mock_flash:
        mock_val.apply_async = MagicMock()
        mock_essay.delay = MagicMock()
        mock_mcq.delay = MagicMock()
        mock_flash.delay = MagicMock()
        # Default: enqueue helper returns a fresh job id every call —
        # individual tests override .side_effect to test idempotency.
        mock_db.enqueue_derivative_job_if_absent.side_effect = (
            lambda **_kwargs: str(uuid.uuid4())
        )
        yield {
            "db": mock_db,
            "essay": mock_essay,
            "mcq": mock_mcq,
            "flash": mock_flash,
        }


def test_dispatches_three_per_doc_derivatives(
    patched_chain: dict[str, MagicMock],
) -> None:
    from src.tasks.ingestion_tasks import chain_post_ingestion

    document_id = str(uuid.uuid4())
    chain_post_ingestion(document_id=document_id)

    assert (
        patched_chain["db"].enqueue_derivative_job_if_absent.call_count == 3
    )
    enqueued_types = [
        c.kwargs["derivative_type"]
        for c in patched_chain["db"].enqueue_derivative_job_if_absent.call_args_list
    ]
    assert sorted(enqueued_types) == sorted(_PER_DOC_TYPES)

    for c in patched_chain["db"].enqueue_derivative_job_if_absent.call_args_list:
        assert c.kwargs["trigger_type"] == "auto_ingest"
        assert c.kwargs["document_id"] == document_id

    assert patched_chain["essay"].delay.call_count == 1
    assert patched_chain["mcq"].delay.call_count == 1
    assert patched_chain["flash"].delay.call_count == 1


def test_idempotency_skips_when_helper_returns_none(
    patched_chain: dict[str, MagicMock],
) -> None:
    """When a derivative_artifact / live job already exists for one type,
    the helper returns None and the .delay() for that type is suppressed.
    Other types still fire."""
    from src.tasks.ingestion_tasks import chain_post_ingestion

    document_id = str(uuid.uuid4())

    def helper(*, derivative_type: str, **_: Any) -> str | None:
        if derivative_type == "essay_prompt":
            return None
        return str(uuid.uuid4())

    patched_chain["db"].enqueue_derivative_job_if_absent.side_effect = helper

    chain_post_ingestion(document_id=document_id)

    patched_chain["essay"].delay.assert_not_called()
    patched_chain["mcq"].delay.assert_called_once()
    patched_chain["flash"].delay.assert_called_once()


def test_failure_isolation_one_dispatch_failure_does_not_block_others(
    patched_chain: dict[str, MagicMock],
) -> None:
    from src.tasks.ingestion_tasks import chain_post_ingestion

    document_id = str(uuid.uuid4())

    patched_chain["essay"].delay.side_effect = RuntimeError("broker down")

    result = chain_post_ingestion(document_id=document_id)

    # Outer chain still returns dispatched (per-block try/except absorbed
    # the essay failure).
    assert result["status"] == "dispatched"
    patched_chain["mcq"].delay.assert_called_once()
    patched_chain["flash"].delay.assert_called_once()


def test_backfill_batch_id_forwarded_to_all_three(
    patched_chain: dict[str, MagicMock],
) -> None:
    from src.tasks.ingestion_tasks import chain_post_ingestion

    document_id = str(uuid.uuid4())
    batch_id = "abc"

    chain_post_ingestion(
        document_id=document_id, backfill_batch_id=batch_id,
    )

    for c in patched_chain["db"].enqueue_derivative_job_if_absent.call_args_list:
        assert c.kwargs["backfill_batch_id"] == batch_id

    for mock_task in (patched_chain["essay"], patched_chain["mcq"], patched_chain["flash"]):
        assert mock_task.delay.call_count == 1
        assert mock_task.delay.call_args.kwargs["backfill_batch_id"] == batch_id


def test_backfill_batch_id_none_forwarded_as_none(
    patched_chain: dict[str, MagicMock],
) -> None:
    from src.tasks.ingestion_tasks import chain_post_ingestion

    document_id = str(uuid.uuid4())
    chain_post_ingestion(document_id=document_id, backfill_batch_id=None)

    for c in patched_chain["db"].enqueue_derivative_job_if_absent.call_args_list:
        assert c.kwargs["backfill_batch_id"] is None
    for mock_task in (patched_chain["essay"], patched_chain["mcq"], patched_chain["flash"]):
        assert mock_task.delay.call_args.kwargs["backfill_batch_id"] is None


def test_subject_outline_explicitly_skipped(
    patched_chain: dict[str, MagicMock],
) -> None:
    """subject_outline is per-subject (PR #67) and must NOT be enqueued
    from the per-doc post-ingestion chain — would cause the same 8/103
    success rate as 2026-04-22 bulk-gen if added here."""
    from src.tasks.ingestion_tasks import chain_post_ingestion

    chain_post_ingestion(document_id=str(uuid.uuid4()))

    enqueued_types = {
        c.kwargs["derivative_type"]
        for c in patched_chain["db"].enqueue_derivative_job_if_absent.call_args_list
    }
    assert "subject_outline" not in enqueued_types
