"""Integration tests for the LawPhil bar-exam ingestion tasks.

The DB layer is mocked at the ``ingestion_db_client`` boundary used by
the tasks; the HTTP layer is mocked at the fetcher's ``fetch_content``
entry point. We verify the task wires those calls together with the
right values: a legal_document is created with the expected metadata,
sections match the parsed questions one-to-one, and the bar_exam_sitting
+ bar_exam_questions rows are written via the upsert helpers.
"""

from __future__ import annotations

import uuid
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from src.fetchers.base import FetchedContent

FIXTURES = Path(__file__).parent / "fixtures" / "lawphil_bar"


def _load_fixture(name: str) -> str:
    return (FIXTURES / name).read_bytes().decode("windows-1252", errors="replace")


@pytest.fixture()
def mock_in_window():
    with patch(
        "src.tasks.bar_exam_tasks.is_in_fetch_window", return_value=True,
    ):
        yield


@pytest.fixture()
def mock_db_for_bar_tasks():
    """Patch the ingestion_db_client module imported by the bar-exam task."""
    with patch("src.tasks.bar_exam_tasks.db") as mock_db:
        mock_db.find_source_by_domain.return_value = {
            "id": str(uuid.uuid4()),
            "name": "Lawphil",
            "type": "official",
            "trust_level": "high",
            "enabled": True,
        }
        mock_db.find_bar_exam_sitting.return_value = None
        mock_db.create_legal_document.return_value = str(uuid.uuid4())
        mock_db.create_legal_document_version.return_value = str(uuid.uuid4())
        mock_db.create_legal_document_sections.return_value = [
            str(uuid.uuid4()) for _ in range(20)
        ]
        mock_db.publish_legal_document_immediately.return_value = None
        mock_db.create_bar_exam_sitting.return_value = str(uuid.uuid4())
        mock_db.update_bar_exam_sitting_source_doc.return_value = None
        mock_db.upsert_bar_exam_questions.return_value = 0
        mock_db.create_audit_log.return_value = None
        yield mock_db


@pytest.fixture()
def mock_lawphil_bar_fetcher_2018_criminal():
    html = _load_fixture("2018_criminal.html")
    with patch("src.tasks.bar_exam_tasks.LawphilBarFetcher") as MockClass:
        instance = MagicMock()
        instance.fetch_content.return_value = FetchedContent(
            url="https://lawphil.net/courts/bm/barQ/2018/criminalQ.html",
            html=html,
            status_code=200,
            content_type="text/html",
            fetched_at="2026-04-27T10:00:00+00:00",
        )
        MockClass.return_value = instance
        yield instance


@pytest.fixture()
def mock_lawphil_bar_fetcher_2022_civil():
    html = _load_fixture("2022_civil_I.html")
    with patch("src.tasks.bar_exam_tasks.LawphilBarFetcher") as MockClass:
        instance = MagicMock()
        instance.fetch_content.return_value = FetchedContent(
            url="https://lawphil.net/courts/bm/barQ/2022/civil-I_Q.html",
            html=html,
            status_code=200,
            content_type="text/html",
            fetched_at="2026-04-27T10:00:00+00:00",
        )
        MockClass.return_value = instance
        yield instance


def test_ingest_sitting_legacy_format_creates_full_row_set(
    mock_in_window,  # noqa: ARG001
    mock_db_for_bar_tasks,
    mock_lawphil_bar_fetcher_2018_criminal,  # noqa: ARG001
):
    """The legacy 2018 format flows through: legal_document, sections,
    bar_exam_sitting, and ≥15 bar_exam_questions all get created."""
    from src.tasks.bar_exam_tasks import ingest_sitting

    result = ingest_sitting(year=2018, subject_slug="criminalQ")

    assert result["status"] == "completed"
    assert result["year"] == 2018
    assert result["subject_slug"] == "criminalQ"
    assert result["questions_parsed"] >= 15

    # legal_document creation
    create_doc_call = mock_db_for_bar_tasks.create_legal_document.call_args
    assert create_doc_call.kwargs["document_type"] == "bar_exam_questions"
    assert create_doc_call.kwargs["is_official"] is True
    assert "2018 Bar Examinations" in create_doc_call.kwargs["title"]
    assert "Criminal Law" in create_doc_call.kwargs["title"]
    assert create_doc_call.kwargs["external_id"] == "lawphil-bar-2018-criminalQ"

    # sections — one per question, ordered by question_number
    sections_call = mock_db_for_bar_tasks.create_legal_document_sections.call_args
    sections_payload = sections_call.args[1]
    assert len(sections_payload) == result["questions_parsed"]
    assert all(s["section_type"] == "bar_exam_question" for s in sections_payload)

    # publish_legal_document_immediately is called with the new doc id
    mock_db_for_bar_tasks.publish_legal_document_immediately.assert_called_once()

    # sitting created with criminal_law / no part
    sitting_call = mock_db_for_bar_tasks.create_bar_exam_sitting.call_args
    assert sitting_call.kwargs["year"] == 2018
    assert sitting_call.kwargs["part"] is None
    assert sitting_call.kwargs["subject_study_code"] == "criminal_law"
    assert sitting_call.kwargs["subject_bar_admin_code"] == "criminal"
    assert sitting_call.kwargs["taxonomy_version"] == "study_8"

    # questions upserted
    upsert_call = mock_db_for_bar_tasks.upsert_bar_exam_questions.call_args
    assert len(upsert_call.kwargs["questions"]) == result["questions_parsed"]

    # audit log written
    audit_call = mock_db_for_bar_tasks.create_audit_log.call_args
    assert audit_call.kwargs["action"] == "bar_exam.sitting_ingested"


def test_ingest_sitting_2022_split_paper_persists_part(
    mock_in_window,  # noqa: ARG001
    mock_db_for_bar_tasks,
    mock_lawphil_bar_fetcher_2022_civil,  # noqa: ARG001
):
    """2022 Civil-I sitting writes ``part='I'`` on the bar_exam_sitting row."""
    from src.tasks.bar_exam_tasks import ingest_sitting

    result = ingest_sitting(year=2022, subject_slug="civil-I_Q")

    assert result["status"] == "completed"
    sitting_call = mock_db_for_bar_tasks.create_bar_exam_sitting.call_args
    assert sitting_call.kwargs["year"] == 2022
    assert sitting_call.kwargs["part"] == "I"
    assert sitting_call.kwargs["subject_study_code"] == "civil_law"


def test_ingest_sitting_idempotent_reuses_existing_sitting(
    mock_in_window,  # noqa: ARG001
    mock_db_for_bar_tasks,
    mock_lawphil_bar_fetcher_2018_criminal,  # noqa: ARG001
):
    """When find_bar_exam_sitting returns a row, the task updates the
    existing sitting's source_document_id rather than INSERTing a new
    row (which would violate the unique constraint)."""
    existing_id = str(uuid.uuid4())
    mock_db_for_bar_tasks.find_bar_exam_sitting.return_value = {
        "id": existing_id,
        "year": 2018,
        "part": None,
        "subject_study_code": "criminal_law",
        "subject_bar_admin_code": "criminal",
        "source_document_id": str(uuid.uuid4()),
        "source_url": "https://lawphil.net/courts/bm/barQ/2018/criminalQ.html",
        "chairperson": "JUSTICE MARIANO C. DEL CASTILLO",
        "taxonomy_version": "study_8",
    }

    from src.tasks.bar_exam_tasks import ingest_sitting

    result = ingest_sitting(year=2018, subject_slug="criminalQ")

    assert result["sitting_id"] == existing_id
    mock_db_for_bar_tasks.create_bar_exam_sitting.assert_not_called()
    mock_db_for_bar_tasks.update_bar_exam_sitting_source_doc.assert_called_once()


def test_ingest_sitting_skipped_outside_fetch_window(
    mock_db_for_bar_tasks,  # noqa: ARG001
):
    """Out-of-window invocation is a no-op — the fetcher is never built."""
    with patch(
        "src.tasks.bar_exam_tasks.is_in_fetch_window", return_value=False,
    ), patch("src.tasks.bar_exam_tasks.LawphilBarFetcher") as MockFetcher:
        from src.tasks.bar_exam_tasks import ingest_sitting

        result = ingest_sitting(year=2018, subject_slug="criminalQ")

        assert result["status"] == "skipped"
        assert result["reason"] == "outside_fetch_window"
        MockFetcher.assert_not_called()


def test_ingest_sitting_unknown_subject_slug_returns_error(
    mock_in_window,  # noqa: ARG001
):
    from src.tasks.bar_exam_tasks import ingest_sitting

    result = ingest_sitting(year=2018, subject_slug="not_a_real_slug")
    assert result["status"] == "error"
    assert "unknown_subject_slug" in result["reason"]


def test_backfill_lawphil_archive_dispatches_missing_combinations(
    mock_in_window,  # noqa: ARG001
):
    """The backfill task calls ingest_sitting.delay for every (year, slug)
    combination not already present."""
    with patch("src.tasks.bar_exam_tasks.db") as mock_db, \
         patch("src.tasks.bar_exam_tasks.ingest_sitting.delay") as mock_delay:
        mock_db.find_bar_exam_sitting.return_value = None

        from src.tasks.bar_exam_tasks import backfill_lawphil_archive

        result = backfill_lawphil_archive(
            year_start=2018, year_end=2018, limit=None,
        )

        assert result["status"] == "completed"
        # 2018 is a legacy year with 8 papers
        assert result["dispatched"] == 8
        assert result["skipped_already_present"] == 0
        assert mock_delay.call_count == 8


def test_backfill_lawphil_archive_skips_present_sittings(
    mock_in_window,  # noqa: ARG001
):
    """A sitting that already has a source_document_id is skipped."""
    existing_doc_id = str(uuid.uuid4())
    with patch("src.tasks.bar_exam_tasks.db") as mock_db, \
         patch("src.tasks.bar_exam_tasks.ingest_sitting.delay") as mock_delay:
        mock_db.find_bar_exam_sitting.return_value = {
            "id": str(uuid.uuid4()),
            "source_document_id": existing_doc_id,
        }

        from src.tasks.bar_exam_tasks import backfill_lawphil_archive

        result = backfill_lawphil_archive(
            year_start=2018, year_end=2018, limit=None,
        )

        assert result["dispatched"] == 0
        assert result["skipped_already_present"] == 8
        mock_delay.assert_not_called()


def test_backfill_lawphil_archive_honors_limit(mock_in_window):  # noqa: ARG001
    with patch("src.tasks.bar_exam_tasks.db") as mock_db, \
         patch("src.tasks.bar_exam_tasks.ingest_sitting.delay") as mock_delay:
        mock_db.find_bar_exam_sitting.return_value = None

        from src.tasks.bar_exam_tasks import backfill_lawphil_archive

        result = backfill_lawphil_archive(
            year_start=2006, year_end=2022, limit=3,
        )

        assert result["dispatched"] == 3
        assert mock_delay.call_count == 3


def test_backfill_skipped_outside_fetch_window():
    with patch(
        "src.tasks.bar_exam_tasks.is_in_fetch_window", return_value=False,
    ), patch("src.tasks.bar_exam_tasks.ingest_sitting.delay") as mock_delay:
        from src.tasks.bar_exam_tasks import backfill_lawphil_archive

        result = backfill_lawphil_archive()
        assert result["status"] == "skipped"
        assert result["reason"] == "outside_fetch_window"
        mock_delay.assert_not_called()
