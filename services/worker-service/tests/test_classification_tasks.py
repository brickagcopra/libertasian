"""Tests for subject classification Celery tasks.

Covers:
1-2: build_subject_registry (format, includes topics)
3-4: classify_document_subjects (happy path, abstain)
5-7: classify_document_subjects (invalid subject code, missing primary, multiple primaries)
8: classify_document_subjects (invalid JSON from LLM)
9-11: validate_classification_output (valid, unknown code, topic not under subject)
12: classify_unclassified_batch (dispatches N tasks)
"""

from __future__ import annotations

import json
import uuid
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from src.tasks.classification_generation_tasks import (
    build_subject_registry,
    classify_document_subjects,
    classify_unclassified_batch,
    validate_classification_output,
    _build_sections_text,
    _truncate_text,
)


def make_uuid() -> str:
    return str(uuid.uuid4())


# ─── Fixtures ────────────────────────────────────────────────────────────


@pytest.fixture()
def document_id() -> str:
    return make_uuid()


@pytest.fixture()
def sample_document(document_id: str) -> dict[str, Any]:
    return {
        "id": document_id,
        "title": "Republic v. Sandiganbayan, G.R. No. 123456",
        "document_type": "case",
        "decision_date": "2024-01-15",
        "ponente": "Gesmundo, C.J.",
        "court": "Supreme Court",
        "citation_text": "G.R. No. 123456",
        "status": "published",
    }


@pytest.fixture()
def sample_sections(document_id: str) -> list[dict[str, Any]]:
    return [
        {
            "id": make_uuid(),
            "section_type": "facts",
            "section_label": "Facts",
            "plain_text": "The petitioner filed a case for recovery of ill-gotten wealth. " * 20,
            "page_start": 1,
            "page_end": 3,
            "ordering": 1,
        },
        {
            "id": make_uuid(),
            "section_type": "ruling",
            "section_label": "Ruling",
            "plain_text": "The Court finds the petition meritorious. " * 20,
            "page_start": 3,
            "page_end": 5,
            "ordering": 2,
        },
    ]


@pytest.fixture()
def sample_subjects() -> list[dict[str, Any]]:
    return [
        {
            "id": make_uuid(),
            "code": "political_law",
            "name": "Political Law and Public International Law",
            "description": "Constitutional law, admin law, PIL",
            "display_order": 1,
            "topics": [
                {
                    "id": make_uuid(),
                    "code": "political_law.constitutional_doctrines",
                    "name": "Fundamental constitutional doctrines",
                    "description": "Due process, equal protection, etc.",
                    "display_order": 1,
                },
            ],
        },
        {
            "id": make_uuid(),
            "code": "civil_law",
            "name": "Civil Law",
            "description": "Persons, family, property, obligations, contracts",
            "display_order": 3,
            "topics": [
                {
                    "id": make_uuid(),
                    "code": "civil_law.persons_family",
                    "name": "Persons and Family Relations",
                    "description": None,
                    "display_order": 1,
                },
                {
                    "id": make_uuid(),
                    "code": "civil_law.property",
                    "name": "Property",
                    "description": "Ownership, possession, co-ownership",
                    "display_order": 2,
                },
            ],
        },
        {
            "id": make_uuid(),
            "code": "criminal_law",
            "name": "Criminal Law",
            "description": None,
            "display_order": 6,
            "topics": [],
        },
    ]


@pytest.fixture()
def valid_subject_codes(sample_subjects: list[dict[str, Any]]) -> set[str]:
    return {s["code"] for s in sample_subjects}


@pytest.fixture()
def valid_topic_codes(sample_subjects: list[dict[str, Any]]) -> dict[str, set[str]]:
    return {
        s["code"]: {t["code"] for t in s.get("topics", [])}
        for s in sample_subjects
    }


@pytest.fixture()
def valid_classification_output() -> dict[str, Any]:
    return {
        "assignments": [
            {
                "subjectCode": "political_law",
                "subjectTopicCode": "political_law.constitutional_doctrines",
                "confidence": 0.92,
                "isPrimary": True,
                "rationale": "Core constitutional law issue",
            },
            {
                "subjectCode": "civil_law",
                "confidence": 0.6,
                "isPrimary": False,
                "rationale": "Touches property law tangentially",
            },
        ],
    }


# ─── build_subject_registry ──────────────────────────────────────────────


class TestBuildSubjectRegistry:
    @patch("src.tasks.classification_generation_tasks.class_db")
    def test_1_returns_formatted_string_with_all_subjects(
        self, mock_class_db: MagicMock, sample_subjects: list[dict[str, Any]],
    ) -> None:
        mock_class_db.get_subjects_with_topics.return_value = sample_subjects

        result = build_subject_registry("study_8")

        assert "political_law" in result
        assert "civil_law" in result
        assert "criminal_law" in result
        assert "Political Law and Public International Law" in result
        mock_class_db.get_subjects_with_topics.assert_called_once_with("study_8")

    @patch("src.tasks.classification_generation_tasks.class_db")
    def test_2_includes_sub_topics(
        self, mock_class_db: MagicMock, sample_subjects: list[dict[str, Any]],
    ) -> None:
        mock_class_db.get_subjects_with_topics.return_value = sample_subjects

        result = build_subject_registry("study_8")

        assert "political_law.constitutional_doctrines" in result
        assert "civil_law.persons_family" in result
        assert "civil_law.property" in result
        assert "Topics:" in result


# ─── classify_document_subjects ──────────────────────────────────────────


class TestClassifyDocumentSubjects:
    @patch("src.tasks.classification_generation_tasks.nestjs_client")
    @patch("src.tasks.classification_generation_tasks.rag_client")
    @patch("src.tasks.classification_generation_tasks.db")
    @patch("src.tasks.classification_generation_tasks.class_db")
    def test_3_happy_path_writes_classification(
        self,
        mock_class_db: MagicMock,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        mock_nestjs: MagicMock,
        document_id: str,
        sample_document: dict[str, Any],
        sample_sections: list[dict[str, Any]],
        sample_subjects: list[dict[str, Any]],
        valid_classification_output: dict[str, Any],
    ) -> None:
        mock_class_db.get_document_for_classification.return_value = sample_document
        mock_class_db.get_document_sections_for_classification.return_value = sample_sections
        mock_class_db.get_existing_digest_summary.return_value = "A tax case summary"
        mock_class_db.get_subjects_with_topics.return_value = sample_subjects
        mock_db.create_model_run.return_value = "model-run-001"
        mock_rag.generate_completion.return_value = {
            "content": json.dumps(valid_classification_output),
            "model_name": "gpt-4o-mini",
            "tokens_in": 500,
            "tokens_out": 100,
        }
        mock_nestjs.write_classification.return_value = {
            "assignmentIds": ["assign-1", "assign-2"],
        }

        result = classify_document_subjects.run(document_id)

        assert result["status"] == "completed"
        assert result["assignments_count"] == 2
        assert result["model_run_id"] == "model-run-001"
        mock_nestjs.write_classification.assert_called_once()
        call_payload = mock_nestjs.write_classification.call_args[0][0]
        assert call_payload["legalDocumentId"] == document_id
        assert call_payload["classifiedBy"] == "ai"

    @patch("src.tasks.classification_generation_tasks.nestjs_client")
    @patch("src.tasks.classification_generation_tasks.rag_client")
    @patch("src.tasks.classification_generation_tasks.db")
    @patch("src.tasks.classification_generation_tasks.class_db")
    def test_4_abstain_returns_no_write(
        self,
        mock_class_db: MagicMock,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        mock_nestjs: MagicMock,
        document_id: str,
        sample_document: dict[str, Any],
        sample_sections: list[dict[str, Any]],
        sample_subjects: list[dict[str, Any]],
    ) -> None:
        mock_class_db.get_document_for_classification.return_value = sample_document
        mock_class_db.get_document_sections_for_classification.return_value = sample_sections
        mock_class_db.get_existing_digest_summary.return_value = None
        mock_class_db.get_subjects_with_topics.return_value = sample_subjects
        mock_rag.generate_completion.return_value = {
            "content": json.dumps({"abstain": True, "abstainReason": "ambiguous content"}),
            "model_name": "gpt-4o-mini",
            "tokens_in": 500,
            "tokens_out": 50,
        }

        result = classify_document_subjects.run(document_id)

        assert result["status"] == "abstained"
        mock_nestjs.write_classification.assert_not_called()
        mock_db.create_model_run.assert_not_called()

    @patch("src.tasks.classification_generation_tasks.nestjs_client")
    @patch("src.tasks.classification_generation_tasks.rag_client")
    @patch("src.tasks.classification_generation_tasks.db")
    @patch("src.tasks.classification_generation_tasks.class_db")
    def test_5_invalid_subject_code_fails_validation(
        self,
        mock_class_db: MagicMock,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        mock_nestjs: MagicMock,
        document_id: str,
        sample_document: dict[str, Any],
        sample_sections: list[dict[str, Any]],
        sample_subjects: list[dict[str, Any]],
    ) -> None:
        mock_class_db.get_document_for_classification.return_value = sample_document
        mock_class_db.get_document_sections_for_classification.return_value = sample_sections
        mock_class_db.get_existing_digest_summary.return_value = None
        mock_class_db.get_subjects_with_topics.return_value = sample_subjects
        mock_rag.generate_completion.return_value = {
            "content": json.dumps({
                "assignments": [
                    {"subjectCode": "nonexistent_law", "confidence": 0.9, "isPrimary": True},
                ],
            }),
            "model_name": "gpt-4o-mini",
            "tokens_in": 500,
            "tokens_out": 80,
        }

        result = classify_document_subjects.run(document_id)

        assert result["status"] == "failed"
        assert result["reason"] == "validation_failed"
        mock_nestjs.write_classification.assert_not_called()

    @patch("src.tasks.classification_generation_tasks.nestjs_client")
    @patch("src.tasks.classification_generation_tasks.rag_client")
    @patch("src.tasks.classification_generation_tasks.db")
    @patch("src.tasks.classification_generation_tasks.class_db")
    def test_6_missing_primary_fails_validation(
        self,
        mock_class_db: MagicMock,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        mock_nestjs: MagicMock,
        document_id: str,
        sample_document: dict[str, Any],
        sample_sections: list[dict[str, Any]],
        sample_subjects: list[dict[str, Any]],
    ) -> None:
        mock_class_db.get_document_for_classification.return_value = sample_document
        mock_class_db.get_document_sections_for_classification.return_value = sample_sections
        mock_class_db.get_existing_digest_summary.return_value = None
        mock_class_db.get_subjects_with_topics.return_value = sample_subjects
        mock_rag.generate_completion.return_value = {
            "content": json.dumps({
                "assignments": [
                    {"subjectCode": "political_law", "confidence": 0.9, "isPrimary": False},
                ],
            }),
            "model_name": "gpt-4o-mini",
            "tokens_in": 500,
            "tokens_out": 80,
        }

        result = classify_document_subjects.run(document_id)

        assert result["status"] == "failed"
        assert result["reason"] == "validation_failed"
        assert any("primary" in e.lower() for e in result["errors"])

    @patch("src.tasks.classification_generation_tasks.nestjs_client")
    @patch("src.tasks.classification_generation_tasks.rag_client")
    @patch("src.tasks.classification_generation_tasks.db")
    @patch("src.tasks.classification_generation_tasks.class_db")
    def test_7_multiple_primaries_fails_validation(
        self,
        mock_class_db: MagicMock,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        mock_nestjs: MagicMock,
        document_id: str,
        sample_document: dict[str, Any],
        sample_sections: list[dict[str, Any]],
        sample_subjects: list[dict[str, Any]],
    ) -> None:
        mock_class_db.get_document_for_classification.return_value = sample_document
        mock_class_db.get_document_sections_for_classification.return_value = sample_sections
        mock_class_db.get_existing_digest_summary.return_value = None
        mock_class_db.get_subjects_with_topics.return_value = sample_subjects
        mock_rag.generate_completion.return_value = {
            "content": json.dumps({
                "assignments": [
                    {"subjectCode": "political_law", "confidence": 0.9, "isPrimary": True},
                    {"subjectCode": "civil_law", "confidence": 0.8, "isPrimary": True},
                ],
            }),
            "model_name": "gpt-4o-mini",
            "tokens_in": 500,
            "tokens_out": 80,
        }

        result = classify_document_subjects.run(document_id)

        assert result["status"] == "failed"
        assert result["reason"] == "validation_failed"

    @patch("src.tasks.classification_generation_tasks.nestjs_client")
    @patch("src.tasks.classification_generation_tasks.rag_client")
    @patch("src.tasks.classification_generation_tasks.db")
    @patch("src.tasks.classification_generation_tasks.class_db")
    def test_8_invalid_json_returns_failed(
        self,
        mock_class_db: MagicMock,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        mock_nestjs: MagicMock,
        document_id: str,
        sample_document: dict[str, Any],
        sample_sections: list[dict[str, Any]],
        sample_subjects: list[dict[str, Any]],
    ) -> None:
        mock_class_db.get_document_for_classification.return_value = sample_document
        mock_class_db.get_document_sections_for_classification.return_value = sample_sections
        mock_class_db.get_existing_digest_summary.return_value = None
        mock_class_db.get_subjects_with_topics.return_value = sample_subjects
        mock_rag.generate_completion.return_value = {
            "content": "This is not valid JSON at all {{{",
            "model_name": "gpt-4o-mini",
            "tokens_in": 500,
            "tokens_out": 50,
        }

        result = classify_document_subjects.run(document_id)

        assert result["status"] == "failed"
        assert result["reason"] == "invalid_json"
        mock_nestjs.write_classification.assert_not_called()


# ─── validate_classification_output ──────────────────────────────────────


class TestValidateClassificationOutput:
    def test_9_valid_output_passes(
        self,
        valid_classification_output: dict[str, Any],
        valid_subject_codes: set[str],
        valid_topic_codes: dict[str, set[str]],
    ) -> None:
        is_valid, errors = validate_classification_output(
            valid_classification_output, valid_subject_codes, valid_topic_codes,
        )

        assert is_valid is True
        assert errors == []

    def test_10_unknown_subject_code_fails(
        self,
        valid_subject_codes: set[str],
        valid_topic_codes: dict[str, set[str]],
    ) -> None:
        output = {
            "assignments": [
                {"subjectCode": "fake_law", "confidence": 0.9, "isPrimary": True},
            ],
        }

        is_valid, errors = validate_classification_output(
            output, valid_subject_codes, valid_topic_codes,
        )

        assert is_valid is False
        assert any("fake_law" in e for e in errors)

    def test_11_topic_code_not_under_subject_fails(
        self,
        valid_subject_codes: set[str],
        valid_topic_codes: dict[str, set[str]],
    ) -> None:
        output = {
            "assignments": [
                {
                    "subjectCode": "political_law",
                    # This topic belongs to civil_law, not political_law
                    "subjectTopicCode": "civil_law.persons_family",
                    "confidence": 0.9,
                    "isPrimary": True,
                },
            ],
        }

        is_valid, errors = validate_classification_output(
            output, valid_subject_codes, valid_topic_codes,
        )

        assert is_valid is False
        assert any("civil_law.persons_family" in e for e in errors)


# ─── classify_unclassified_batch ─────────────────────────────────────────


class TestClassifyUnclassifiedBatch:
    @patch("src.tasks.classification_generation_tasks.classify_document_subjects")
    @patch("src.tasks.classification_generation_tasks.class_db")
    def test_12_dispatches_tasks_for_unclassified_docs(
        self,
        mock_class_db: MagicMock,
        mock_classify_task: MagicMock,
    ) -> None:
        doc_ids = [make_uuid() for _ in range(5)]
        mock_class_db.get_unclassified_document_ids.return_value = doc_ids

        result = classify_unclassified_batch.run(limit=50)

        assert result["status"] == "completed"
        assert result["dispatched"] == 5
        assert mock_classify_task.delay.call_count == 5
        mock_class_db.get_unclassified_document_ids.assert_called_once_with(limit=50)
