"""Tests for ``citation.extract_for_document`` Celery task.

DB is mocked at the function level on ``ingestion_db_client`` so the task
runs without Postgres. Idempotency is exercised by calling the task twice
and asserting the SQL contains the ON CONFLICT DO NOTHING clause that
the deployed partial unique index relies on.
"""

from __future__ import annotations

import uuid
from typing import Any
from unittest.mock import MagicMock, patch

import pytest


@pytest.fixture()
def mock_ingestion_db() -> Any:
    with patch("src.tasks.citation_tasks.ingestion_db_client") as mock_db:
        mock_db.get_legal_document_sections_with_text.return_value = []
        mock_db.insert_citations_ignore_dupes.return_value = 0
        yield mock_db


def _section(text: str) -> dict[str, Any]:
    return {"id": str(uuid.uuid4()), "plain_text": text}


class TestExtractCitationsForDocument:
    def test_no_sections_short_circuits(
        self, mock_ingestion_db: MagicMock
    ) -> None:
        from src.tasks.citation_tasks import extract_citations_for_document

        doc_id = str(uuid.uuid4())
        result = extract_citations_for_document(legal_document_id=doc_id)

        assert result["status"] == "completed"
        assert result["sections_scanned"] == 0
        assert result["rows_inserted"] == 0
        mock_ingestion_db.insert_citations_ignore_dupes.assert_not_called()

    def test_extracts_five_mixed_citations_with_correct_section_mapping(
        self, mock_ingestion_db: MagicMock
    ) -> None:
        from src.tasks.citation_tasks import extract_citations_for_document

        doc_id = str(uuid.uuid4())
        sec_a = _section(
            "The Court in G.R. No. 555111 overturned Republic Act No. 9999."
        )
        sec_b = _section(
            "Citing P.D. No. 1083, the Court relied on 200 SCRA 100; "
            "see also B.P. Blg. 22."
        )
        mock_ingestion_db.get_legal_document_sections_with_text.return_value = [
            sec_a,
            sec_b,
        ]
        mock_ingestion_db.insert_citations_ignore_dupes.return_value = 5

        result = extract_citations_for_document(legal_document_id=doc_id)

        assert result["rows_inserted"] == 5
        assert result["sections_scanned"] == 2

        rows = mock_ingestion_db.insert_citations_ignore_dupes.call_args.args[0]
        assert len(rows) == 5

        normalized = sorted(r["normalized_citation"] for r in rows)
        assert normalized == sorted(
            [
                "G.R. No. 555111",
                "R.A. No. 9999",
                "P.D. No. 1083",
                "200 SCRA 100",
                "B.P. Blg. 22",
            ]
        )

        sec_a_rows = [r for r in rows if r["from_section_id"] == sec_a["id"]]
        sec_b_rows = [r for r in rows if r["from_section_id"] == sec_b["id"]]
        assert len(sec_a_rows) == 2
        assert len(sec_b_rows) == 3

        for r in rows:
            assert r["from_document_id"] == doc_id
            assert r["citation_type"] in {"case", "statute", "regulation", "reporter"}

    def test_rerun_yields_identical_row_set(
        self, mock_ingestion_db: MagicMock
    ) -> None:
        """Determinism: same sections in → same rows out (DB layer dedupes via
        ON CONFLICT, but the task itself must produce the same payload twice
        so dedup at the index is a clean no-op)."""
        from src.tasks.citation_tasks import extract_citations_for_document

        doc_id = str(uuid.uuid4())
        sec = _section("See G.R. No. 100 and Republic Act No. 200.")
        mock_ingestion_db.get_legal_document_sections_with_text.return_value = [sec]

        extract_citations_for_document(legal_document_id=doc_id)
        first = mock_ingestion_db.insert_citations_ignore_dupes.call_args.args[0]

        extract_citations_for_document(legal_document_id=doc_id)
        second = mock_ingestion_db.insert_citations_ignore_dupes.call_args.args[0]

        assert first == second
        assert {r["normalized_citation"] for r in first} == {
            "G.R. No. 100",
            "R.A. No. 200",
        }

    def test_skips_sections_with_no_text(
        self, mock_ingestion_db: MagicMock
    ) -> None:
        from src.tasks.citation_tasks import extract_citations_for_document

        doc_id = str(uuid.uuid4())
        empty = {"id": str(uuid.uuid4()), "plain_text": None}
        nonempty = _section("G.R. No. 42 controls.")
        mock_ingestion_db.get_legal_document_sections_with_text.return_value = [
            empty,
            nonempty,
        ]
        mock_ingestion_db.insert_citations_ignore_dupes.return_value = 1

        result = extract_citations_for_document(legal_document_id=doc_id)

        rows = mock_ingestion_db.insert_citations_ignore_dupes.call_args.args[0]
        assert len(rows) == 1
        assert rows[0]["from_section_id"] == nonempty["id"]
        assert result["sections_scanned"] == 2


class TestInsertSqlShape:
    """The deployed migration relies on a partial unique index. The insert
    helper MUST use ON CONFLICT DO NOTHING with that index's predicate so
    re-runs are no-ops at the DB layer."""

    def test_insert_sql_uses_on_conflict_do_nothing(self) -> None:
        from unittest.mock import MagicMock

        with patch(
            "src.clients.ingestion_db_client.get_connection"
        ) as mock_conn:
            cursor = MagicMock()
            cursor.rowcount = 1
            ctx = MagicMock()
            ctx.__enter__ = MagicMock(return_value=cursor)
            ctx.__exit__ = MagicMock(return_value=False)

            conn = MagicMock()
            conn.cursor.return_value = ctx
            mock_conn.return_value.__enter__.return_value = conn
            mock_conn.return_value.__exit__.return_value = False

            from src.clients.ingestion_db_client import (
                insert_citations_ignore_dupes,
            )

            insert_citations_ignore_dupes(
                [
                    {
                        "from_document_id": str(uuid.uuid4()),
                        "from_section_id": str(uuid.uuid4()),
                        "citation_text": "G.R. No. 1",
                        "citation_type": "case",
                        "normalized_citation": "G.R. No. 1",
                    }
                ]
            )

            sql = cursor.execute.call_args.args[0]
            assert "INSERT INTO citations" in sql
            assert "ON CONFLICT" in sql
            assert "from_section_id IS NOT NULL" in sql
            assert "DO NOTHING" in sql
