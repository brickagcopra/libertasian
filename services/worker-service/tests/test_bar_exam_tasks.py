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
from src.parsers.lawphil_bar_html import parse_page as _parse_page

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
        mock_db.replace_legal_document_sections.return_value = [
            str(uuid.uuid4()) for _ in range(20)
        ]
        # Default: a re-ingest is safe and changes nothing. Each re-ingest
        # test states its own situation.
        mock_db.count_section_references.return_value = {}
        mock_db.get_bar_exam_questions_for_sitting.return_value = []
        mock_db.get_bar_exam_answer_states.return_value = {}
        mock_db.delete_pending_bar_exam_answers.return_value = []
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


@pytest.fixture()
def mock_lawphil_bar_fetcher_2015_criminal():
    html = _load_fixture("2015_criminal.html")
    with patch("src.tasks.bar_exam_tasks.LawphilBarFetcher") as MockClass:
        instance = MagicMock()
        instance.fetch_content.return_value = FetchedContent(
            url="https://lawphil.net/courts/bm/barQ/2015/criminalQ.html",
            html=html,
            status_code=200,
            content_type="text/html",
            fetched_at="2026-09-14T18:00:00+00:00",
        )
        MockClass.return_value = instance
        yield instance


#: What the parser makes of the 2015 fixture right now, read once. Tests that
#: need "the text this question will be upserted with" take it from here
#: rather than hardcoding a string that the next fixture refresh would
#: silently turn into an unrelated assertion.
_PARSED_2015 = {
    q.question_number: q.question_text
    for q in _parse_page(_load_fixture("2015_criminal.html")).questions
}
_PARSED_Q3 = _PARSED_2015[3]


def _sitting_row(document_id: str | None, sitting_id: str) -> dict:
    return {
        "id": sitting_id,
        "year": 2015,
        "part": None,
        "subject_study_code": "criminal_law",
        "subject_bar_admin_code": "criminal",
        "source_document_id": document_id,
        "source_url": "https://lawphil.net/courts/bm/barQ/2015/criminalQ.html",
        "chairperson": None,
        "taxonomy_version": "study_8",
    }


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


# ---------------------------------------------------------------------------
# Re-ingest safety. Prod holds 105 bar-exam documents for 97 external_ids
# because this task used to INSERT a new published document every run, and
# five 2015 sittings hold four instruction paragraphs each because the parser
# could not read their format. Fixing the parser means re-running the ingest
# over sittings that already have questions and answers, so the re-run itself
# has to be safe.
# ---------------------------------------------------------------------------


class TestDocumentReuse:
    def test_a_sitting_with_a_document_reuses_it_instead_of_publishing_a_copy(
        self,
        mock_in_window,  # noqa: ARG001
        mock_db_for_bar_tasks,
        mock_lawphil_bar_fetcher_2015_criminal,  # noqa: ARG001
    ):
        """The duplicate-document bug, pinned.

        A re-parse must add a version to the existing document, not create a
        second published one carrying the same external_id.
        """
        document_id = str(uuid.uuid4())
        sitting_id = str(uuid.uuid4())
        mock_db_for_bar_tasks.find_bar_exam_sitting.return_value = _sitting_row(
            document_id, sitting_id,
        )

        from src.tasks.bar_exam_tasks import ingest_sitting

        result = ingest_sitting(year=2015, subject_slug="criminalQ")

        assert result["status"] == "completed"
        assert result["document_id"] == document_id
        assert result["document_reused"] is True
        mock_db_for_bar_tasks.create_legal_document.assert_not_called()
        # A new version row, never an overwrite of an existing one.
        version_call = mock_db_for_bar_tasks.create_legal_document_version.call_args
        assert version_call.kwargs["legal_document_id"] == document_id
        assert version_call.kwargs["parser_version"] == "lawphil-bar-v2"
        # Sections replaced on the same document, not appended to it.
        mock_db_for_bar_tasks.replace_legal_document_sections.assert_called_once()
        mock_db_for_bar_tasks.create_legal_document_sections.assert_not_called()
        assert (
            mock_db_for_bar_tasks.replace_legal_document_sections.call_args.args[0]
            == document_id
        )

    def test_a_sitting_with_no_document_still_creates_one(
        self,
        mock_in_window,  # noqa: ARG001
        mock_db_for_bar_tasks,
        mock_lawphil_bar_fetcher_2015_criminal,  # noqa: ARG001
    ):
        """A sitting row can predate its document. That is still a create."""
        sitting_id = str(uuid.uuid4())
        mock_db_for_bar_tasks.find_bar_exam_sitting.return_value = _sitting_row(
            None, sitting_id,
        )

        from src.tasks.bar_exam_tasks import ingest_sitting

        result = ingest_sitting(year=2015, subject_slug="criminalQ")

        assert result["document_reused"] is False
        mock_db_for_bar_tasks.create_legal_document.assert_called_once()
        mock_db_for_bar_tasks.create_legal_document_sections.assert_called_once()
        mock_db_for_bar_tasks.replace_legal_document_sections.assert_not_called()

    def test_the_2015_page_now_ingests_all_22_questions(
        self,
        mock_in_window,  # noqa: ARG001
        mock_db_for_bar_tasks,
        mock_lawphil_bar_fetcher_2015_criminal,  # noqa: ARG001
    ):
        from src.tasks.bar_exam_tasks import ingest_sitting

        result = ingest_sitting(year=2015, subject_slug="criminalQ")

        assert result["questions_parsed"] == 22
        assert result["expected_items"] == 22
        assert result["page_format"] == "ordered_list"
        upsert = mock_db_for_bar_tasks.upsert_bar_exam_questions.call_args
        assert len(upsert.kwargs["questions"]) == 22
        # Recorded in the version row as well as the telemetry, so the
        # document's own history says which parse produced it.
        extracted = (
            mock_db_for_bar_tasks.create_legal_document_version.call_args
            .kwargs["extracted_json"]
        )
        assert extracted["questions_parsed"] == 22
        assert extracted["expected_items"] == 22
        assert extracted["parser_version"] == "lawphil-bar-v2"
        audit = mock_db_for_bar_tasks.create_audit_log.call_args.kwargs["metadata"]
        assert audit["questions_parsed"] == 22
        assert audit["expected_items"] == 22


class TestSectionsReferencedAbort:
    def test_a_referenced_section_stops_the_whole_re_ingest(
        self,
        mock_in_window,  # noqa: ARG001
        mock_db_for_bar_tasks,
        mock_lawphil_bar_fetcher_2015_criminal,  # noqa: ARG001
    ):
        """Replacing sections another table points at would cut a citation,
        a bookmark or a digest's provenance loose from its source. The run
        stops before writing anything at all."""
        document_id = str(uuid.uuid4())
        sitting_id = str(uuid.uuid4())
        mock_db_for_bar_tasks.find_bar_exam_sitting.return_value = _sitting_row(
            document_id, sitting_id,
        )
        mock_db_for_bar_tasks.count_section_references.return_value = {
            "citations": 3,
            "provenance_records": 1,
        }

        from src.tasks.bar_exam_tasks import ingest_sitting

        result = ingest_sitting(year=2015, subject_slug="criminalQ")

        assert result["status"] == "sections_referenced"
        assert result["section_references"] == {
            "citations": 3,
            "provenance_records": 1,
        }
        assert result["document_id"] == document_id
        assert result["sitting_id"] == sitting_id
        # Nothing written: not the sections, not the questions, not even a
        # version row on the document's history.
        mock_db_for_bar_tasks.replace_legal_document_sections.assert_not_called()
        mock_db_for_bar_tasks.create_legal_document_sections.assert_not_called()
        mock_db_for_bar_tasks.create_legal_document_version.assert_not_called()
        mock_db_for_bar_tasks.upsert_bar_exam_questions.assert_not_called()
        mock_db_for_bar_tasks.delete_pending_bar_exam_answers.assert_not_called()
        mock_db_for_bar_tasks.publish_legal_document_immediately.assert_not_called()
        # The abort itself is recorded — a silent no-op would be worse than
        # the duplicate documents this replaces.
        audit = mock_db_for_bar_tasks.create_audit_log.call_args.kwargs
        assert audit["action"] == "bar_exam.sitting_ingest_aborted"
        assert audit["metadata"]["reason"] == "sections_referenced"


class TestChangedQuestionAnswers:
    """An AI answer answers the text it was generated from."""

    def _existing_questions(self, changed_id: str, unchanged_id: str) -> list:
        # Question 1's stored text is the instruction paragraph prod holds;
        # the new parse replaces it, so its answer is answering nothing.
        # Question 3 is given the text the new parse produces for it, so it
        # counts as unchanged.
        return [
            {
                "id": changed_id,
                "question_number": 1,
                "question_text": "1. This Questionnaire contains eleven (11) pages.",
            },
            {
                "id": unchanged_id,
                "question_number": 3,
                "question_text": _PARSED_Q3,
            },
        ]

    def test_a_pending_answer_on_changed_text_is_deleted(
        self,
        mock_in_window,  # noqa: ARG001
        mock_db_for_bar_tasks,
        mock_lawphil_bar_fetcher_2015_criminal,  # noqa: ARG001
    ):
        changed_id, unchanged_id = str(uuid.uuid4()), str(uuid.uuid4())
        mock_db_for_bar_tasks.find_bar_exam_sitting.return_value = _sitting_row(
            str(uuid.uuid4()), str(uuid.uuid4()),
        )
        mock_db_for_bar_tasks.get_bar_exam_questions_for_sitting.return_value = (
            self._existing_questions(changed_id, unchanged_id)
        )
        mock_db_for_bar_tasks.get_bar_exam_answer_states.return_value = {
            changed_id: {"id": "ans-1", "review_status": "pending"},
        }
        mock_db_for_bar_tasks.delete_pending_bar_exam_answers.return_value = [
            changed_id,
        ]

        from src.tasks.bar_exam_tasks import ingest_sitting

        result = ingest_sitting(year=2015, subject_slug="criminalQ")

        assert result["questions_changed"] == 1
        assert result["pending_answers_deleted"] == [changed_id]
        assert result["reviewed_answer_on_changed_question"] == []
        # Only the changed question's answer is even considered.
        states_call = mock_db_for_bar_tasks.get_bar_exam_answer_states.call_args
        assert states_call.args[0] == [changed_id]
        delete_call = mock_db_for_bar_tasks.delete_pending_bar_exam_answers.call_args
        assert delete_call.args[0] == [changed_id]

    @pytest.mark.parametrize("review_status", ["approved", "rejected"])
    def test_a_reviewed_answer_on_changed_text_is_kept_and_reported(
        self,
        mock_in_window,  # noqa: ARG001
        mock_db_for_bar_tasks,
        mock_lawphil_bar_fetcher_2015_criminal,  # noqa: ARG001
        review_status,
    ):
        """A human decision outranks a re-parse. The question id is surfaced
        instead, so an editor can look at an answer whose question moved."""
        changed_id, unchanged_id = str(uuid.uuid4()), str(uuid.uuid4())
        mock_db_for_bar_tasks.find_bar_exam_sitting.return_value = _sitting_row(
            str(uuid.uuid4()), str(uuid.uuid4()),
        )
        mock_db_for_bar_tasks.get_bar_exam_questions_for_sitting.return_value = (
            self._existing_questions(changed_id, unchanged_id)
        )
        mock_db_for_bar_tasks.get_bar_exam_answer_states.return_value = {
            changed_id: {"id": "ans-1", "review_status": review_status},
        }

        from src.tasks.bar_exam_tasks import ingest_sitting

        result = ingest_sitting(year=2015, subject_slug="criminalQ")

        assert result["reviewed_answer_on_changed_question"] == [changed_id]
        assert result["pending_answers_deleted"] == []
        mock_db_for_bar_tasks.delete_pending_bar_exam_answers.assert_not_called()
        audit = mock_db_for_bar_tasks.create_audit_log.call_args.kwargs["metadata"]
        assert audit["reviewed_answer_on_changed_question"] == [changed_id]

    def test_an_unchanged_question_keeps_its_pending_answer(
        self,
        mock_in_window,  # noqa: ARG001
        mock_db_for_bar_tasks,
        mock_lawphil_bar_fetcher_2015_criminal,  # noqa: ARG001
    ):
        """Re-running the ingest on an unchanged page must cost nothing."""
        unchanged_id = str(uuid.uuid4())
        mock_db_for_bar_tasks.find_bar_exam_sitting.return_value = _sitting_row(
            str(uuid.uuid4()), str(uuid.uuid4()),
        )
        mock_db_for_bar_tasks.get_bar_exam_questions_for_sitting.return_value = [
            {
                "id": unchanged_id,
                "question_number": 3,
                "question_text": _PARSED_Q3,
            },
        ]

        from src.tasks.bar_exam_tasks import ingest_sitting

        result = ingest_sitting(year=2015, subject_slug="criminalQ")

        assert result["questions_changed"] == 0
        assert result["pending_answers_deleted"] == []
        mock_db_for_bar_tasks.delete_pending_bar_exam_answers.assert_not_called()

    def test_questions_the_parse_no_longer_covers_are_kept_and_listed(
        self,
        mock_in_window,  # noqa: ARG001
        mock_db_for_bar_tasks,
        mock_lawphil_bar_fetcher_2015_criminal,  # noqa: ARG001
    ):
        """The 22 → 4 regression, run the other way.

        If a future parser finds fewer questions than are stored, the extras
        stay: deleting them would take their answers with them on the word of
        the parse that just got worse.
        """
        mock_db_for_bar_tasks.find_bar_exam_sitting.return_value = _sitting_row(
            str(uuid.uuid4()), str(uuid.uuid4()),
        )
        mock_db_for_bar_tasks.get_bar_exam_questions_for_sitting.return_value = [
            {"id": str(uuid.uuid4()), "question_number": number,
             "question_text": f"stored question {number}"}
            for number in (22, 23, 24)
        ]

        from src.tasks.bar_exam_tasks import ingest_sitting

        result = ingest_sitting(year=2015, subject_slug="criminalQ")

        # 23 and 24 are beyond the 22 the page now yields.
        assert result["questions_missing_from_parse"] == [23, 24]
        deletes = [
            call[0] for call in mock_db_for_bar_tasks.mock_calls
            if call[0].startswith("delete_")
        ]
        assert deletes == [], f"a delete ran on a shrinking parse: {deletes}"
        audit = mock_db_for_bar_tasks.create_audit_log.call_args.kwargs["metadata"]
        assert audit["questions_missing_from_parse"] == [23, 24]
