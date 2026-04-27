"""Tests for the one-shot ``citations.backfill_corpus_documents`` Celery task.

Verifies:
- Happy path: dispatches every doc missing citations, skips those that
  already have them.
- Idempotency: a re-run after the first sweep dispatches zero (the
  NOT EXISTS skip filter excludes already-processed docs).
- Limit + cursor: stops at limit on a full page and returns a resumable
  ``last_cursor``; next call with that cursor finishes the walk.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from .conftest import make_uuid


@pytest.fixture()
def mock_backfill_db() -> Any:
    """Mock ``ingestion_db_client`` accessed from the backfill module."""
    with patch("src.tasks.citations_backfill_tasks.db") as mock_db:
        yield mock_db


@pytest.fixture()
def mock_extract_task() -> Any:
    """Mock the downstream extraction task; we assert dispatches on .delay."""
    with patch(
        "src.tasks.citation_tasks.extract_citations_for_document",
    ) as mock_task:
        yield mock_task


def test_dispatches_only_for_docs_missing_citations(
    mock_backfill_db: MagicMock,
    mock_extract_task: MagicMock,
) -> None:
    """5 corpus docs total: 2 already have citations (skipped), 3 don't.
    The keyset filter returns only the 3 that need processing.
    """
    from src.tasks.citations_backfill_tasks import backfill_corpus_documents

    missing_ids = [make_uuid() for _ in range(3)]
    mock_backfill_db.get_corpus_doc_ids_missing_citations_after.side_effect = [
        missing_ids,
        [],  # next page empty → end of walk
    ]
    mock_backfill_db.count_corpus_docs_with_citations_in_range.return_value = 2

    result = backfill_corpus_documents()

    assert result["dispatched"] == 3
    assert result["skipped_already_has_citations"] == 2
    assert result["last_cursor"] is None
    assert mock_extract_task.delay.call_count == 3
    dispatched_ids = [
        c.kwargs["legal_document_id"] for c in mock_extract_task.delay.call_args_list
    ]
    assert dispatched_ids == missing_ids


def test_rerun_dispatches_zero_when_filter_returns_empty(
    mock_backfill_db: MagicMock,
    mock_extract_task: MagicMock,
) -> None:
    """Idempotency: after a first sweep, the SQL skip filter returns no rows.
    All 5 docs are accounted for as skipped.
    """
    from src.tasks.citations_backfill_tasks import backfill_corpus_documents

    mock_backfill_db.get_corpus_doc_ids_missing_citations_after.return_value = []
    mock_backfill_db.count_corpus_docs_with_citations_in_range.return_value = 5

    result = backfill_corpus_documents()

    assert result["dispatched"] == 0
    assert result["skipped_already_has_citations"] == 5
    assert result["last_cursor"] is None
    mock_extract_task.delay.assert_not_called()


def test_limit_returns_resumable_cursor(
    mock_backfill_db: MagicMock,
    mock_extract_task: MagicMock,
) -> None:
    """``limit=2`` over 5 unprocessed docs: dispatch 2, surface a cursor."""
    from src.tasks.citations_backfill_tasks import backfill_corpus_documents

    first_two = [make_uuid(), make_uuid()]
    mock_backfill_db.get_corpus_doc_ids_missing_citations_after.return_value = first_two
    mock_backfill_db.count_corpus_docs_with_citations_in_range.return_value = 0

    result = backfill_corpus_documents(limit=2)

    assert result["dispatched"] == 2
    assert result["last_cursor"] == first_two[-1]
    assert mock_extract_task.delay.call_count == 2

    fetch_args = (
        mock_backfill_db.get_corpus_doc_ids_missing_citations_after.call_args
    )
    assert fetch_args.args[0] is None  # first call — no cursor
    assert fetch_args.args[1] == 2  # page size capped to remaining limit


def test_resume_with_cursor_finishes_walk(
    mock_backfill_db: MagicMock,
    mock_extract_task: MagicMock,
) -> None:
    """Second call with the prior ``last_cursor`` walks the remaining 3 docs."""
    from src.tasks.citations_backfill_tasks import backfill_corpus_documents

    prior_cursor = make_uuid()
    next_three = [make_uuid(), make_uuid(), make_uuid()]
    mock_backfill_db.get_corpus_doc_ids_missing_citations_after.side_effect = [
        next_three,
        [],
    ]
    mock_backfill_db.count_corpus_docs_with_citations_in_range.return_value = 0

    result = backfill_corpus_documents(after_cursor=prior_cursor)

    assert result["dispatched"] == 3
    assert result["last_cursor"] is None

    first_call = (
        mock_backfill_db.get_corpus_doc_ids_missing_citations_after.call_args_list[0]
    )
    assert first_call.args[0] == prior_cursor


def test_limit_zero_dispatches_nothing(
    mock_backfill_db: MagicMock,
    mock_extract_task: MagicMock,
) -> None:
    """``limit=0`` is a degenerate but legal call — surface an empty result.
    Must not query the keyset page (no work to do)."""
    from src.tasks.citations_backfill_tasks import backfill_corpus_documents

    mock_backfill_db.count_corpus_docs_with_citations_in_range.return_value = 0

    result = backfill_corpus_documents(limit=0)

    assert result["dispatched"] == 0
    assert result["last_cursor"] is None
    mock_backfill_db.get_corpus_doc_ids_missing_citations_after.assert_not_called()
    mock_extract_task.delay.assert_not_called()


def test_full_page_followed_by_short_page_terminates(
    mock_backfill_db: MagicMock,
    mock_extract_task: MagicMock,
) -> None:
    """``limit=None`` walks all pages until one comes back short."""
    from src.tasks import citations_backfill_tasks
    from src.tasks.citations_backfill_tasks import backfill_corpus_documents

    full_page = [make_uuid() for _ in range(citations_backfill_tasks._PAGE_SIZE)]
    short_page = [make_uuid(), make_uuid()]
    mock_backfill_db.get_corpus_doc_ids_missing_citations_after.side_effect = [
        full_page,
        short_page,
    ]
    mock_backfill_db.count_corpus_docs_with_citations_in_range.return_value = 7

    result = backfill_corpus_documents()

    assert result["dispatched"] == citations_backfill_tasks._PAGE_SIZE + 2
    assert result["last_cursor"] is None
    assert result["skipped_already_has_citations"] == 7


class TestKeysetSqlShape:
    """The keyset helper's SQL must use NOT EXISTS against citations and
    parameterized cursor / limit bindings — no string interpolation per
    CLAUDE.md."""

    def test_first_page_uses_no_cursor_predicate(self) -> None:
        with patch(
            "src.clients.ingestion_db_client.get_connection"
        ) as mock_conn:
            cursor_mock = MagicMock()
            cursor_mock.fetchall.return_value = []
            ctx = MagicMock()
            ctx.__enter__ = MagicMock(return_value=cursor_mock)
            ctx.__exit__ = MagicMock(return_value=False)
            conn = MagicMock()
            conn.cursor.return_value = ctx
            mock_conn.return_value.__enter__.return_value = conn
            mock_conn.return_value.__exit__.return_value = False

            from src.clients.ingestion_db_client import (
                get_corpus_doc_ids_missing_citations_after,
            )

            get_corpus_doc_ids_missing_citations_after(None, 50)

            sql, params = cursor_mock.execute.call_args.args
            assert "FROM legal_documents" in sql
            assert "NOT EXISTS" in sql
            assert "FROM citations" in sql
            assert "ORDER BY id ASC" in sql
            assert "id > %s" not in sql
            assert params == (50,)

    def test_resumed_page_includes_cursor_predicate(self) -> None:
        with patch(
            "src.clients.ingestion_db_client.get_connection"
        ) as mock_conn:
            cursor_mock = MagicMock()
            cursor_mock.fetchall.return_value = []
            ctx = MagicMock()
            ctx.__enter__ = MagicMock(return_value=cursor_mock)
            ctx.__exit__ = MagicMock(return_value=False)
            conn = MagicMock()
            conn.cursor.return_value = ctx
            mock_conn.return_value.__enter__.return_value = conn
            mock_conn.return_value.__exit__.return_value = False

            from src.clients.ingestion_db_client import (
                get_corpus_doc_ids_missing_citations_after,
            )

            cursor_id = make_uuid()
            get_corpus_doc_ids_missing_citations_after(cursor_id, 50)

            sql, params = cursor_mock.execute.call_args.args
            assert "id > %s" in sql
            assert params == (cursor_id, 50)
