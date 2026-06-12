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
    _adapt_flat_shape,
    _sanitize_topic_codes,
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
    @patch("src.tasks.classification_generation_tasks._get_redis_client")
    @patch("src.tasks.classification_generation_tasks.classify_document_subjects")
    @patch("src.tasks.classification_generation_tasks.class_db")
    def test_12_dispatches_tasks_for_unclassified_docs(
        self,
        mock_class_db: MagicMock,
        mock_classify_task: MagicMock,
        mock_get_redis: MagicMock,
    ) -> None:
        doc_ids = [make_uuid() for _ in range(5)]
        mock_class_db.get_unclassified_document_ids.return_value = doc_ids
        mock_redis = MagicMock()
        mock_redis.get.return_value = None  # no prior failures
        mock_get_redis.return_value = mock_redis

        result = classify_unclassified_batch.run(limit=50)

        assert result["status"] == "completed"
        assert result["dispatched"] == 5
        assert result["skipped"] == 0
        assert mock_classify_task.delay.call_count == 5
        # Over-fetches limit * 10 candidates so the dispatch budget can still
        # be filled after skipping attempt-capped docs.
        mock_class_db.get_unclassified_document_ids.assert_called_once_with(limit=500)


# ─── _adapt_flat_shape ───────────────────────────────────────────────────


class TestAdaptFlatShape:
    def test_adapt_flat_shape_primary_only(self) -> None:
        llm_output = {
            "isPrimary": True,
            "primarySubject": "criminal_law",
            "subjectTopicCode": "criminal_law.rpc_book_1",
            "secondarySubjects": [],
            "confidence": 0.9,
        }

        adapted = _adapt_flat_shape(llm_output)

        assert adapted["assignments"] == [
            {
                "subjectCode": "criminal_law",
                "subjectTopicCode": "criminal_law.rpc_book_1",
                "isPrimary": True,
                "confidence": 0.9,
            }
        ]
        # Preserves other keys (forward-compat)
        assert adapted["primarySubject"] == "criminal_law"

    def test_adapt_flat_shape_with_dict_secondaries(self) -> None:
        llm_output = {
            "primarySubject": "civil_law",
            "subjectTopicCode": "civil_law.persons_family",
            "secondarySubjects": [
                {"subjectCode": "political_law", "subjectTopicCode": None, "confidence": 0.6},
                {"subjectCode": "remedial_law", "subjectTopicCode": "remedial_law.civ_pro", "confidence": 0.55},
            ],
            "confidence": 0.85,
        }

        adapted = _adapt_flat_shape(llm_output)

        assignments = adapted["assignments"]
        assert len(assignments) == 3
        primaries = [a for a in assignments if a["isPrimary"]]
        assert len(primaries) == 1
        assert primaries[0]["subjectCode"] == "civil_law"
        assert primaries[0]["confidence"] == 0.85
        secondaries = [a for a in assignments if not a["isPrimary"]]
        assert {s["subjectCode"] for s in secondaries} == {"political_law", "remedial_law"}
        remedial = next(s for s in secondaries if s["subjectCode"] == "remedial_law")
        assert remedial["subjectTopicCode"] == "remedial_law.civ_pro"
        assert remedial["confidence"] == 0.55

    def test_adapt_flat_shape_with_string_secondaries(self) -> None:
        llm_output = {
            "primarySubject": "tax_law",
            "subjectTopicCode": None,
            "secondarySubjects": ["commercial_law", "remedial_law"],
            "confidence": 0.75,
        }

        adapted = _adapt_flat_shape(llm_output)

        assignments = adapted["assignments"]
        assert len(assignments) == 3
        secondaries = [a for a in assignments if not a["isPrimary"]]
        assert all(s["subjectTopicCode"] is None for s in secondaries)
        assert all(s["confidence"] == 0.75 for s in secondaries)
        assert {s["subjectCode"] for s in secondaries} == {"commercial_law", "remedial_law"}

    def test_adapt_flat_shape_already_normalized_passthrough(self) -> None:
        already = {
            "assignments": [
                {
                    "subjectCode": "criminal_law",
                    "subjectTopicCode": "criminal_law.rpc_book_1",
                    "isPrimary": True,
                    "confidence": 0.9,
                }
            ]
        }

        adapted = _adapt_flat_shape(already)

        assert adapted is already
        assert adapted == already

    def test_adapt_flat_shape_abstain_passthrough(self) -> None:
        abstain_output = {"abstain": True, "abstainReason": "low_confidence"}

        adapted = _adapt_flat_shape(abstain_output)

        assert adapted is abstain_output
        assert "assignments" not in adapted

    def test_adapt_flat_shape_unknown_shape_passthrough(self) -> None:
        unknown = {"classification": "criminal", "score": 0.8}

        adapted = _adapt_flat_shape(unknown)

        assert adapted is unknown
        assert "assignments" not in adapted

    def test_adapt_flat_shape_then_validator_accepts(self) -> None:
        llm_output = {
            "isPrimary": True,
            "primarySubject": "criminal_law",
            "subjectTopicCode": "criminal_law.rpc_book_1",
            "secondarySubjects": [],
            "confidence": 0.9,
        }
        valid_subject_codes = {"criminal_law"}
        valid_topic_codes = {"criminal_law": {"criminal_law.rpc_book_1"}}

        adapted = _adapt_flat_shape(llm_output)
        is_valid, errors = validate_classification_output(
            adapted, valid_subject_codes, valid_topic_codes,
        )

        assert is_valid is True
        assert errors == []

    def test_adapt_flat_shape_secondary_with_subject_key(self) -> None:
        llm_output = {
            "isPrimary": True,
            "primarySubject": "remedial_law",
            "subjectTopicCode": "remedial_law.civil_procedure",
            "secondarySubjects": [
                {
                    "isPrimary": False,
                    "subject": "political_law",
                    "subjectTopicCode": "political_law.administrative_law",
                }
            ],
            "confidence": 0.9,
        }

        adapted = _adapt_flat_shape(llm_output)

        secondaries = [a for a in adapted["assignments"] if not a["isPrimary"]]
        assert len(secondaries) == 1
        assert secondaries[0]["subjectCode"] == "political_law"
        assert secondaries[0]["subjectTopicCode"] == "political_law.administrative_law"
        assert secondaries[0]["isPrimary"] is False

    def test_adapt_flat_shape_secondary_with_subject_code_key_regression(self) -> None:
        llm_output = {
            "primarySubject": "civil_law",
            "subjectTopicCode": None,
            "secondarySubjects": [
                {"subjectCode": "criminal_law", "subjectTopicCode": None, "confidence": 0.6},
            ],
            "confidence": 0.8,
        }

        adapted = _adapt_flat_shape(llm_output)

        secondaries = [a for a in adapted["assignments"] if not a["isPrimary"]]
        assert len(secondaries) == 1
        assert secondaries[0]["subjectCode"] == "criminal_law"
        assert secondaries[0]["confidence"] == 0.6

    def test_adapt_flat_shape_secondary_with_primary_subject_key(self) -> None:
        llm_output = {
            "primarySubject": "tax_law",
            "subjectTopicCode": None,
            "secondarySubjects": [
                {"primarySubject": "commercial_law", "subjectTopicCode": None, "confidence": 0.55},
            ],
            "confidence": 0.8,
        }

        adapted = _adapt_flat_shape(llm_output)

        secondaries = [a for a in adapted["assignments"] if not a["isPrimary"]]
        assert len(secondaries) == 1
        assert secondaries[0]["subjectCode"] == "commercial_law"

    def test_adapt_flat_shape_secondary_missing_all_subject_keys(self) -> None:
        llm_output = {
            "primarySubject": "civil_law",
            "subjectTopicCode": None,
            "secondarySubjects": [
                {"subjectTopicCode": "civil_law.property", "confidence": 0.5},
            ],
            "confidence": 0.8,
        }

        adapted = _adapt_flat_shape(llm_output)

        secondaries = [a for a in adapted["assignments"] if not a["isPrimary"]]
        assert len(secondaries) == 1
        assert secondaries[0]["subjectCode"] is None
        assert secondaries[0]["subjectTopicCode"] == "civil_law.property"

    def test_adapt_flat_shape_prod_example_passes_validator(self) -> None:
        llm_output = {
            "isPrimary": True,
            "primarySubject": "remedial_law",
            "subjectTopicCode": "remedial_law.civil_procedure",
            "secondarySubjects": [
                {
                    "isPrimary": False,
                    "subject": "political_law",
                    "subjectTopicCode": "political_law.administrative_law",
                }
            ],
            "confidence": 0.9,
        }
        valid_subject_codes = {"remedial_law", "political_law"}
        valid_topic_codes = {
            "remedial_law": {"remedial_law.civil_procedure"},
            "political_law": {"political_law.administrative_law"},
        }

        adapted = _adapt_flat_shape(llm_output)
        is_valid, errors = validate_classification_output(
            adapted, valid_subject_codes, valid_topic_codes,
        )

        assert is_valid is True
        assert errors == []

    def test_adapt_flat_shape_dict_secondary_inherits_top_level_confidence(self) -> None:
        llm_output = {
            "isPrimary": True,
            "primarySubject": "remedial_law",
            "subjectTopicCode": "remedial_law.civil_procedure",
            "secondarySubjects": [
                {
                    "isPrimary": False,
                    "subject": "political_law",
                    "subjectTopicCode": "political_law.administrative_law",
                }
            ],
            "confidence": 0.9,
        }

        adapted = _adapt_flat_shape(llm_output)

        secondaries = [a for a in adapted["assignments"] if not a["isPrimary"]]
        assert len(secondaries) == 1
        assert secondaries[0]["confidence"] == 0.9

    def test_adapt_flat_shape_dict_secondary_explicit_confidence_wins(self) -> None:
        llm_output = {
            "primarySubject": "civil_law",
            "subjectTopicCode": None,
            "secondarySubjects": [
                {"subjectCode": "criminal_law", "subjectTopicCode": None, "confidence": 0.7},
            ],
            "confidence": 0.9,
        }

        adapted = _adapt_flat_shape(llm_output)

        secondaries = [a for a in adapted["assignments"] if not a["isPrimary"]]
        assert len(secondaries) == 1
        assert secondaries[0]["confidence"] == 0.7

    def test_adapt_flat_shape_dict_secondary_no_confidence_anywhere_stays_none(self) -> None:
        llm_output = {
            "primarySubject": "civil_law",
            "subjectTopicCode": None,
            "secondarySubjects": [
                {"subject": "political_law", "subjectTopicCode": None},
            ],
        }

        adapted = _adapt_flat_shape(llm_output)

        secondaries = [a for a in adapted["assignments"] if not a["isPrimary"]]
        assert len(secondaries) == 1
        assert secondaries[0]["confidence"] is None

    def test_adapt_flat_shape_dict_secondary_explicit_none_confidence_inherits(self) -> None:
        llm_output = {
            "primarySubject": "civil_law",
            "subjectTopicCode": None,
            "secondarySubjects": [
                {"subject": "political_law", "subjectTopicCode": None, "confidence": None},
            ],
            "confidence": 0.8,
        }

        adapted = _adapt_flat_shape(llm_output)

        secondaries = [a for a in adapted["assignments"] if not a["isPrimary"]]
        assert len(secondaries) == 1
        assert secondaries[0]["confidence"] == 0.8

    def test_adapt_flat_shape_prod_e2e_both_assignments_confidence_after_validator(self) -> None:
        llm_output = {
            "isPrimary": True,
            "primarySubject": "remedial_law",
            "subjectTopicCode": "remedial_law.civil_procedure",
            "secondarySubjects": [
                {
                    "isPrimary": False,
                    "subject": "political_law",
                    "subjectTopicCode": "political_law.administrative_law",
                }
            ],
            "confidence": 0.9,
        }
        valid_subject_codes = {"remedial_law", "political_law"}
        valid_topic_codes = {
            "remedial_law": {"remedial_law.civil_procedure"},
            "political_law": {"political_law.administrative_law"},
        }

        adapted = _adapt_flat_shape(llm_output)
        is_valid, errors = validate_classification_output(
            adapted, valid_subject_codes, valid_topic_codes,
        )

        assert is_valid is True
        assert errors == []

        assignments = adapted["assignments"]
        assert len(assignments) == 2
        primary = next(a for a in assignments if a["isPrimary"])
        secondary = next(a for a in assignments if not a["isPrimary"])
        assert primary["subjectCode"] == "remedial_law"
        assert secondary["subjectCode"] == "political_law"
        assert primary["confidence"] == 0.9
        assert secondary["confidence"] == 0.9


# ─── _sanitize_topic_codes ───────────────────────────────────────────────


class TestSanitizeTopicCodes:
    """Root-cause fix: null out hallucinated sub-topics instead of rejecting
    the whole classification (the re-billing loop)."""

    def test_valid_subject_invalid_topic_nulls_topic_keeps_assignment(self) -> None:
        content = {
            "assignments": [
                {
                    "subjectCode": "civil_law",
                    "subjectTopicCode": "civil_law.special_contracts",  # not seeded
                    "isPrimary": True,
                    "confidence": 0.8,
                },
            ],
        }
        valid_subject_codes = {"civil_law"}
        valid_topic_codes = {"civil_law": {"civil_law.property"}}

        result = _sanitize_topic_codes(content, valid_subject_codes, valid_topic_codes)

        assert len(result["assignments"]) == 1
        assignment = result["assignments"][0]
        assert assignment["subjectTopicCode"] is None
        # Rest of the assignment untouched.
        assert assignment["subjectCode"] == "civil_law"
        assert assignment["isPrimary"] is True
        assert assignment["confidence"] == 0.8

    def test_valid_subject_valid_topic_unchanged(self) -> None:
        content = {
            "assignments": [
                {
                    "subjectCode": "civil_law",
                    "subjectTopicCode": "civil_law.property",
                    "isPrimary": True,
                    "confidence": 0.9,
                },
            ],
        }
        valid_subject_codes = {"civil_law"}
        valid_topic_codes = {"civil_law": {"civil_law.property"}}

        result = _sanitize_topic_codes(content, valid_subject_codes, valid_topic_codes)

        assert result["assignments"][0]["subjectTopicCode"] == "civil_law.property"
        # No change → same object returned.
        assert result is content

    def test_invalid_subject_untouched_so_validator_still_rejects(self) -> None:
        content = {
            "assignments": [
                {
                    "subjectCode": "made_up_law",
                    "subjectTopicCode": "made_up_law.whatever",
                    "isPrimary": True,
                    "confidence": 0.8,
                },
            ],
        }
        valid_subject_codes = {"civil_law"}
        valid_topic_codes = {"civil_law": {"civil_law.property"}}

        result = _sanitize_topic_codes(content, valid_subject_codes, valid_topic_codes)

        # Invalid subject + its topic left as-is — the validator must reject it.
        assert result["assignments"][0]["subjectCode"] == "made_up_law"
        assert result["assignments"][0]["subjectTopicCode"] == "made_up_law.whatever"

        is_valid, errors = validate_classification_output(
            result, valid_subject_codes, valid_topic_codes,
        )
        assert is_valid is False
        assert any("made_up_law" in e for e in errors)

    def test_input_not_mutated(self) -> None:
        content = {
            "assignments": [
                {
                    "subjectCode": "civil_law",
                    "subjectTopicCode": "civil_law.special_contracts",  # not seeded
                    "isPrimary": True,
                    "confidence": 0.8,
                },
            ],
        }
        valid_subject_codes = {"civil_law"}
        valid_topic_codes = {"civil_law": {"civil_law.property"}}

        result = _sanitize_topic_codes(content, valid_subject_codes, valid_topic_codes)

        # Original input still carries the bad topic; only the copy was changed.
        assert content["assignments"][0]["subjectTopicCode"] == "civil_law.special_contracts"
        assert result is not content
        assert result["assignments"][0]["subjectTopicCode"] is None

    def test_end_to_end_real_failing_payload_now_validates(self) -> None:
        """The exact prod payload that re-billed forever: valid subject
        `mercantile_law`, hallucinated topic `mercantile_law.special_contracts`.
        adapt → sanitize → validate now returns is_valid=True with topic None."""
        llm_output = {
            "primarySubject": "mercantile_law",
            "subjectTopicCode": "mercantile_law.special_contracts",
            "isPrimary": True,
            "confidence": 0.8,
            "secondarySubjects": [],
        }
        valid_subject_codes = {"mercantile_law"}
        # The hallucinated topic is NOT seeded under the subject.
        valid_topic_codes = {"mercantile_law": {"mercantile_law.negotiable_instruments"}}

        adapted = _adapt_flat_shape(llm_output)
        sanitized = _sanitize_topic_codes(
            adapted, valid_subject_codes, valid_topic_codes,
        )
        is_valid, errors = validate_classification_output(
            sanitized, valid_subject_codes, valid_topic_codes,
        )

        assert is_valid is True
        assert errors == []
        primary = sanitized["assignments"][0]
        assert primary["subjectCode"] == "mercantile_law"
        assert primary["subjectTopicCode"] is None


# ─── classify_unclassified_batch — per-doc attempt cap ───────────────────


class TestClassifyAttemptCap:
    @patch("src.tasks.classification_generation_tasks._get_redis_client")
    @patch("src.tasks.classification_generation_tasks.classify_document_subjects")
    @patch("src.tasks.classification_generation_tasks.class_db")
    def test_doc_at_attempt_cap_is_skipped(
        self,
        mock_class_db: MagicMock,
        mock_classify_task: MagicMock,
        mock_get_redis: MagicMock,
    ) -> None:
        capped = make_uuid()
        fresh = make_uuid()
        mock_class_db.get_unclassified_document_ids.return_value = [capped, fresh]

        mock_redis = MagicMock()

        def fake_get(key: str) -> str | None:
            # classify_max_attempts default is 5 → capped doc is at the cap.
            if key.endswith(capped):
                return "5"
            return None

        mock_redis.get.side_effect = fake_get
        mock_get_redis.return_value = mock_redis

        result = classify_unclassified_batch.run(limit=10)

        assert result["status"] == "completed"
        assert result["dispatched"] == 1
        assert result["skipped"] == 1
        # Only the fresh doc was dispatched.
        dispatched_ids = [c.args[0] for c in mock_classify_task.delay.call_args_list]
        assert dispatched_ids == [fresh]
        # Dispatched doc had its counter incremented + TTL set.
        mock_redis.incr.assert_called_once()
        mock_redis.expire.assert_called_once()

    @patch("src.tasks.classification_generation_tasks._get_redis_client")
    @patch("src.tasks.classification_generation_tasks.classify_document_subjects")
    @patch("src.tasks.classification_generation_tasks.class_db")
    def test_redis_error_is_fail_open_docs_still_dispatched(
        self,
        mock_class_db: MagicMock,
        mock_classify_task: MagicMock,
        mock_get_redis: MagicMock,
    ) -> None:
        doc_ids = [make_uuid() for _ in range(3)]
        mock_class_db.get_unclassified_document_ids.return_value = doc_ids

        mock_redis = MagicMock()
        mock_redis.get.side_effect = RuntimeError("redis down")
        mock_get_redis.return_value = mock_redis

        result = classify_unclassified_batch.run(limit=10)

        # Fail-open: Redis raised, so we fell back to uncapped dispatch.
        assert result["status"] == "completed"
        assert result["dispatched"] == 3
        assert mock_classify_task.delay.call_count == 3
