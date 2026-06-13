"""Tests for the suggested bar answer projection task (Phase 3b).

Covers:
- happy path: builds the renderer-contract contentJson and writes an
  approved/public_editorial derivative with provenance + deterministic hash
- idempotent skip: an answer whose content hash already exists is not
  re-written
- partial-failure tolerance: one write raising does not abort the batch
- missing source document: cannot record provenance -> skipped, no write
- empty answers list short-circuits
- deterministic hash: same (year, subject, question) -> same hash
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock, patch

from src.tasks.suggested_bar_answer_projection_tasks import (
    DERIVATIVE_TYPE,
    _content_hash,
    project_approved_bar_answers,
)

DISCLAIMER_ID = "11111111-1111-1111-1111-111111111111"
SOURCE_DOC_ID = "22222222-2222-2222-2222-222222222222"


def _answer(
    answer_id: str = "ans-1",
    question_id: str = "q-1",
    question_text: str = (
        "Distinguish between a contract of sale and a contract to sell. "
        "Explain the legal consequences of each."
    ),
    answer_text: str = (
        "**Answer.** A contract of sale transfers ownership upon delivery, "
        "while a contract to sell reserves ownership until full payment.\n"
    ),
    sitting_year: int = 2018,
    subject_study_code: str = "civil_law",
    source_document_id: str | None = SOURCE_DOC_ID,
) -> dict[str, Any]:
    return {
        "answer_id": answer_id,
        "question_id": question_id,
        "answer_text": answer_text,
        "structured_answer_json": {"answer": "...", "law": "..."},
        "confidence": 0.92,
        "question_text": question_text,
        "sitting_year": sitting_year,
        "subject_study_code": subject_study_code,
        "subject_bar_admin_code": "civil_land_titles",
        "source_document_id": source_document_id,
        "source_url": "https://lawphil.net/courts/bm/barQ/2018/civilQ.html",
    }


class TestProjectApprovedBarAnswers:
    @patch("src.tasks.suggested_bar_answer_projection_tasks.nestjs_client")
    @patch("src.tasks.suggested_bar_answer_projection_tasks.db")
    def test_happy_path_writes_public_editorial_artifact(
        self,
        mock_db: MagicMock,
        mock_nest: MagicMock,
    ) -> None:
        mock_db.get_content_disclaimer_id.return_value = DISCLAIMER_ID
        mock_db.get_approved_bar_exam_answers.return_value = [_answer()]
        mock_db.derivative_artifact_exists_by_content_hash.return_value = False
        mock_nest.write_derivative.return_value = {"artifactId": "art-1"}

        result = project_approved_bar_answers.run()

        assert result["processed"] == 1
        assert result["written"] == 1
        assert result["skipped"] == 0
        assert result["failed"] == 0

        mock_nest.write_derivative.assert_called_once()
        payload = mock_nest.write_derivative.call_args.args[0]

        # Top-level write fields
        assert payload["derivativeType"] == DERIVATIVE_TYPE
        assert payload["reviewStatus"] == "approved"
        assert payload["visibility"] == "public_editorial"
        assert payload["contentDisclaimerId"] == DISCLAIMER_ID
        assert payload["contentRights"] == "ai_generated_derivative"
        assert payload["sourceDocumentId"] == SOURCE_DOC_ID
        assert payload["contentHash"]  # non-empty (DTO @IsNotEmpty)

        # Provenance anchors back to the bar-question document
        assert payload["provenanceRecords"] == [
            {
                "sourceDocumentId": SOURCE_DOC_ID,
                "provenanceType": "source_passage",
            },
        ]

        # Artifact-level subject assignment so the Library hub counts it
        assert payload["subjectAssignments"] == [
            {"subjectCode": "civil_law", "isPrimary": True},
        ]

        # contentJson matches the renderer contract exactly
        content = payload["contentJson"]
        assert set(content.keys()) == {
            "questionText",
            "suggestedAnswer",
            "examSubject",
            "barYear",
            "annotations",
            "sourceAttribution",
        }
        assert content["questionText"].startswith("Distinguish between")
        assert content["suggestedAnswer"].startswith("**Answer.**")
        assert content["examSubject"] == "Civil Law"
        assert content["barYear"] == 2018
        assert content["annotations"] == []
        assert "2018 Philippine Bar Examinations" in content["sourceAttribution"]
        assert "Civil Law" in content["sourceAttribution"]

    @patch("src.tasks.suggested_bar_answer_projection_tasks.nestjs_client")
    @patch("src.tasks.suggested_bar_answer_projection_tasks.db")
    def test_idempotent_skip_when_hash_exists(
        self,
        mock_db: MagicMock,
        mock_nest: MagicMock,
    ) -> None:
        mock_db.get_content_disclaimer_id.return_value = DISCLAIMER_ID
        mock_db.get_approved_bar_exam_answers.return_value = [_answer()]
        # Artifact with this content hash already exists -> skip.
        mock_db.derivative_artifact_exists_by_content_hash.return_value = True

        result = project_approved_bar_answers.run()

        assert result["processed"] == 1
        assert result["written"] == 0
        assert result["skipped"] == 1
        assert result["failed"] == 0
        assert result["results"][0]["status"] == "skipped_exists"
        mock_nest.write_derivative.assert_not_called()

    @patch("src.tasks.suggested_bar_answer_projection_tasks.nestjs_client")
    @patch("src.tasks.suggested_bar_answer_projection_tasks.db")
    def test_partial_failure_does_not_abort_batch(
        self,
        mock_db: MagicMock,
        mock_nest: MagicMock,
    ) -> None:
        mock_db.get_content_disclaimer_id.return_value = DISCLAIMER_ID
        mock_db.get_approved_bar_exam_answers.return_value = [
            _answer(answer_id="ans-1", question_text="First question text here?"),
            _answer(answer_id="ans-2", question_text="Second question text here?"),
            _answer(answer_id="ans-3", question_text="Third question text here?"),
        ]
        mock_db.derivative_artifact_exists_by_content_hash.return_value = False
        # The middle write blows up; the surrounding loop must keep going.
        mock_nest.write_derivative.side_effect = [
            {"artifactId": "art-1"},
            RuntimeError("nestjs 500"),
            {"artifactId": "art-3"},
        ]

        result = project_approved_bar_answers.run()

        assert result["processed"] == 3
        assert result["written"] == 2
        assert result["failed"] == 1
        assert result["skipped"] == 0
        statuses = [r["status"] for r in result["results"]]
        assert statuses == ["written", "error", "written"]
        assert mock_nest.write_derivative.call_count == 3

    @patch("src.tasks.suggested_bar_answer_projection_tasks.nestjs_client")
    @patch("src.tasks.suggested_bar_answer_projection_tasks.db")
    def test_skips_answer_without_source_document(
        self,
        mock_db: MagicMock,
        mock_nest: MagicMock,
    ) -> None:
        mock_db.get_content_disclaimer_id.return_value = DISCLAIMER_ID
        mock_db.get_approved_bar_exam_answers.return_value = [
            _answer(source_document_id=None),
        ]
        mock_db.derivative_artifact_exists_by_content_hash.return_value = False

        result = project_approved_bar_answers.run()

        assert result["written"] == 0
        assert result["skipped"] == 1
        assert result["results"][0]["status"] == "skipped_no_source_document"
        mock_nest.write_derivative.assert_not_called()
        # Never even reaches the idempotency probe for an unprojectable row.
        mock_db.derivative_artifact_exists_by_content_hash.assert_not_called()

    @patch("src.tasks.suggested_bar_answer_projection_tasks.nestjs_client")
    @patch("src.tasks.suggested_bar_answer_projection_tasks.db")
    def test_empty_list_short_circuits(
        self,
        mock_db: MagicMock,
        mock_nest: MagicMock,
    ) -> None:
        mock_db.get_content_disclaimer_id.return_value = DISCLAIMER_ID
        mock_db.get_approved_bar_exam_answers.return_value = []

        result = project_approved_bar_answers.run()

        assert result == {
            "processed": 0,
            "written": 0,
            "skipped": 0,
            "failed": 0,
            "results": [],
        }
        mock_nest.write_derivative.assert_not_called()


class TestContentHash:
    def test_deterministic_for_same_inputs(self) -> None:
        a = _content_hash(2018, "civil_law", "Same question text.")
        b = _content_hash(2018, "civil_law", "Same question text.")
        assert a == b

    def test_whitespace_insensitive(self) -> None:
        a = _content_hash(2018, "civil_law", "Same   question   text.")
        b = _content_hash(2018, "civil_law", " Same question text. ")
        assert a == b

    def test_differs_on_year_subject_or_question(self) -> None:
        base = _content_hash(2018, "civil_law", "Q")
        assert base != _content_hash(2019, "civil_law", "Q")
        assert base != _content_hash(2018, "criminal_law", "Q")
        assert base != _content_hash(2018, "civil_law", "Different Q")
