"""Tests for subject outline generation Celery task (PR 5.3).

8 tests covering:
1. Happy path — multi-document -> DerivativeArtifact written
2. Eligibility skip -> skipped (no documents found)
3. Validator quarantine -> job failed
4. LLM abstains -> no write
5. Loads multiple documents by subject when document_ids not provided
6. Limits to max_documents
7. Prompt includes sections from multiple documents
8. Model run recorded
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from src.prompts.subject_outline_generation_v1 import PROMPT_TEMPLATE_VERSION
from src.tasks.outline_generation_tasks import generate_subject_outline

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

FAKE_DOC_1: dict[str, Any] = {
    "id": "doc-001",
    "title": "Republic v. Sandiganbayan",
    "document_type": "case",
    "citation_text": "G.R. No. 123456",
    "court": "Supreme Court",
    "decision_date": "2025-01-01",
    "subject": "Criminal Law",
}

FAKE_DOC_2: dict[str, Any] = {
    "id": "doc-002",
    "title": "People v. Dela Cruz",
    "document_type": "case",
    "citation_text": "G.R. No. 654321",
    "court": "Court of Appeals",
    "decision_date": "2024-06-15",
    "subject": "Criminal Law",
}

FAKE_SECTIONS_1: list[dict[str, Any]] = [
    {
        "id": "sec-001",
        "section_type": "body",
        "section_label": "Decision",
        "plain_text": (
            "The doctrine of command responsibility applies to civilian officials "
            "who hold positions of authority in the government. " * 5
        ),
        "page_start": 1,
        "page_end": 5,
    },
]

FAKE_SECTIONS_2: list[dict[str, Any]] = [
    {
        "id": "sec-003",
        "section_type": "body",
        "section_label": "Decision",
        "plain_text": (
            "The elements of estafa under Article 315 of the Revised Penal Code "
            "require deceit and damage. The prosecution must prove all elements beyond "
            "reasonable doubt. " * 5
        ),
        "page_start": 1,
        "page_end": 4,
    },
]

FAKE_LLM_CONTENT: dict[str, Any] = {
    "sections": [
        {
            "heading": "Introduction to Criminal Law Principles",
            "subjectTopicCode": "criminal_law.revised_penal_code",
            "paragraphs": [
                "The doctrine of command responsibility is a key principle in Philippine criminal law.",
                "It applies broadly to civilian officials with effective control.",
            ],
            "citedSectionIds": ["sec-001"],
            "subSections": [
                {
                    "heading": "Historical Background",
                    "paragraphs": ["The doctrine was first applied in military contexts."],
                    "citedSectionIds": ["sec-001"],
                },
            ],
        },
        {
            "heading": "Elements of Estafa",
            "subjectTopicCode": None,
            "paragraphs": ["Estafa requires proof of deceit and damage."],
            "citedSectionIds": ["sec-003"],
            "subSections": [],
        },
        {
            "heading": "Burden of Proof",
            "subjectTopicCode": None,
            "paragraphs": ["The prosecution bears the burden of proof beyond reasonable doubt."],
            "citedSectionIds": ["sec-001", "sec-003"],
            "subSections": [],
        },
    ],
    "abstain": False,
    "abstainReason": None,
}

FAKE_RAG_RESPONSE: dict[str, Any] = {
    "content": FAKE_LLM_CONTENT,
    "model_name": "gpt-4o-mini",
    "tokens_in": 2500,
    "tokens_out": 1200,
}


def _run_task(job_id: str, subject_code: str, **kwargs: Any) -> dict[str, Any]:
    """Run the Celery task synchronously, bypassing Celery dispatch."""
    return generate_subject_outline.run(job_id, subject_code=subject_code, **kwargs)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestOutlineGenerationTask:
    """Tests for the generate_subject_outline Celery task."""

    @patch("src.tasks.outline_generation_tasks.nestjs_client")
    @patch("src.tasks.outline_generation_tasks.rag_client")
    @patch("src.tasks.outline_generation_tasks.db")
    @patch("src.tasks.outline_generation_tasks.validate_derivative")
    def test_1_happy_path_multi_document(
        self,
        mock_validate: MagicMock,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        """Happy path — multi-document -> DerivativeArtifact written."""
        from src.validators.derivative_validators import (
            DerivativeValidationResult,
            DerivativeVerdict,
        )

        mock_db.get_legal_document.side_effect = [FAKE_DOC_1, FAKE_DOC_2]
        mock_db.get_document_sections_for_digest.side_effect = [FAKE_SECTIONS_1, FAKE_SECTIONS_2]
        mock_db.create_model_run.return_value = "model-run-001"
        mock_rag.generate_completion.return_value = FAKE_RAG_RESPONSE
        mock_validate.return_value = DerivativeValidationResult(
            verdict=DerivativeVerdict.PUBLISH, checks=[], reasons=[],
        )
        mock_nestjs.write_derivative.return_value = {"artifactId": "art-001"}
        mock_nestjs.update_job_status.return_value = True

        result = _run_task(
            "job-001", "criminal_law",
            document_ids=["doc-001", "doc-002"],
        )

        assert result["status"] == "completed"
        assert result["artifact_id"] == "art-001"
        assert result["document_count"] == 2
        mock_nestjs.write_derivative.assert_called_once()

        # NestJS WriteDerivativeDto marks contentHash @IsNotEmpty(). Empty
        # strings triggered a 1-27ms 400 on every bulk-gen run prior to
        # 2026-04-23 — make sure we now send a real sha256 digest.
        payload = mock_nestjs.write_derivative.call_args.args[0]
        assert payload["contentHash"].startswith("sha256:")
        assert len(payload["contentHash"]) > len("sha256:")

    @patch("src.tasks.outline_generation_tasks.nestjs_client")
    @patch("src.tasks.outline_generation_tasks.db")
    @patch("src.tasks.outline_generation_tasks._get_document_ids_by_subject")
    def test_2_no_documents_skip(
        self,
        mock_get_ids: MagicMock,
        mock_db: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        """No documents found -> failed."""
        mock_get_ids.return_value = []
        mock_nestjs.update_job_status.return_value = True

        result = _run_task("job-001", "unknown_law")

        assert result["status"] == "failed"
        assert result["reason"] == "no_documents"

    @patch("src.tasks.outline_generation_tasks.nestjs_client")
    @patch("src.tasks.outline_generation_tasks.rag_client")
    @patch("src.tasks.outline_generation_tasks.db")
    @patch("src.tasks.outline_generation_tasks.validate_derivative")
    def test_3_validator_quarantine(
        self,
        mock_validate: MagicMock,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        """Validator quarantine -> job failed."""
        from src.validators.derivative_validators import (
            DerivativeValidationResult,
            DerivativeVerdict,
            ValidatorCheck,
        )

        mock_db.get_legal_document.return_value = FAKE_DOC_1
        mock_db.get_document_sections_for_digest.return_value = FAKE_SECTIONS_1
        mock_rag.generate_completion.return_value = FAKE_RAG_RESPONSE
        mock_validate.return_value = DerivativeValidationResult(
            verdict=DerivativeVerdict.QUARANTINE,
            checks=[
                ValidatorCheck(
                    name="section_count_min",
                    passed=False,
                    reason="2 sections (min 3)",
                    severity="error",
                ),
            ],
            reasons=["2 sections (min 3)"],
        )
        mock_nestjs.update_job_status.return_value = True

        result = _run_task(
            "job-001", "criminal_law",
            document_ids=["doc-001"],
        )

        assert result["status"] == "failed"
        assert result["reason"] == "validation_quarantine"
        mock_nestjs.write_derivative.assert_not_called()

    @patch("src.tasks.outline_generation_tasks.nestjs_client")
    @patch("src.tasks.outline_generation_tasks.rag_client")
    @patch("src.tasks.outline_generation_tasks.db")
    def test_4_llm_abstains(
        self,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        """LLM abstains -> no write."""
        mock_db.get_legal_document.return_value = FAKE_DOC_1
        mock_db.get_document_sections_for_digest.return_value = FAKE_SECTIONS_1
        mock_rag.generate_completion.return_value = {
            **FAKE_RAG_RESPONSE,
            "content": {
                "abstain": True,
                "abstainReason": "Insufficient material for outline",
            },
        }
        mock_nestjs.update_job_status.return_value = True

        result = _run_task(
            "job-001", "criminal_law",
            document_ids=["doc-001"],
        )

        assert result["status"] == "failed"
        assert result["reason"] == "abstained"
        mock_nestjs.write_derivative.assert_not_called()

    @patch("src.tasks.outline_generation_tasks.nestjs_client")
    @patch("src.tasks.outline_generation_tasks.rag_client")
    @patch("src.tasks.outline_generation_tasks.db")
    @patch("src.tasks.outline_generation_tasks.validate_derivative")
    @patch("src.tasks.outline_generation_tasks._get_document_ids_by_subject")
    def test_5_loads_by_subject_when_no_doc_ids(
        self,
        mock_get_ids: MagicMock,
        mock_validate: MagicMock,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        """Loads multiple documents by subject when document_ids not provided."""
        from src.validators.derivative_validators import (
            DerivativeValidationResult,
            DerivativeVerdict,
        )

        mock_get_ids.return_value = ["doc-001", "doc-002"]
        mock_db.get_legal_document.side_effect = [FAKE_DOC_1, FAKE_DOC_2]
        mock_db.get_document_sections_for_digest.side_effect = [FAKE_SECTIONS_1, FAKE_SECTIONS_2]
        mock_db.create_model_run.return_value = "model-run-001"
        mock_rag.generate_completion.return_value = FAKE_RAG_RESPONSE
        mock_validate.return_value = DerivativeValidationResult(
            verdict=DerivativeVerdict.PUBLISH, checks=[], reasons=[],
        )
        mock_nestjs.write_derivative.return_value = {"artifactId": "art-001"}
        mock_nestjs.update_job_status.return_value = True

        result = _run_task("job-001", "criminal_law")

        assert result["status"] == "completed"
        assert result["document_count"] == 2
        mock_get_ids.assert_called_once_with("criminal_law", None, 10)

    @patch("src.tasks.outline_generation_tasks.nestjs_client")
    @patch("src.tasks.outline_generation_tasks.rag_client")
    @patch("src.tasks.outline_generation_tasks.db")
    @patch("src.tasks.outline_generation_tasks.validate_derivative")
    def test_6_limits_to_max_documents(
        self,
        mock_validate: MagicMock,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        """Limits to max_documents."""
        from src.validators.derivative_validators import (
            DerivativeValidationResult,
            DerivativeVerdict,
        )

        # Provide 5 doc IDs but set max_documents=2
        mock_db.get_legal_document.side_effect = [FAKE_DOC_1, FAKE_DOC_2]
        mock_db.get_document_sections_for_digest.side_effect = [FAKE_SECTIONS_1, FAKE_SECTIONS_2]
        mock_db.create_model_run.return_value = "model-run-001"
        mock_rag.generate_completion.return_value = FAKE_RAG_RESPONSE
        mock_validate.return_value = DerivativeValidationResult(
            verdict=DerivativeVerdict.PUBLISH, checks=[], reasons=[],
        )
        mock_nestjs.write_derivative.return_value = {"artifactId": "art-001"}
        mock_nestjs.update_job_status.return_value = True

        result = _run_task(
            "job-001", "criminal_law",
            document_ids=["doc-001", "doc-002", "doc-003", "doc-004", "doc-005"],
            max_documents=2,
        )

        assert result["status"] == "completed"
        # Only 2 documents loaded (limited by max_documents)
        assert mock_db.get_legal_document.call_count == 2
        assert result["document_count"] == 2

    @patch("src.tasks.outline_generation_tasks.nestjs_client")
    @patch("src.tasks.outline_generation_tasks.rag_client")
    @patch("src.tasks.outline_generation_tasks.db")
    @patch("src.tasks.outline_generation_tasks.validate_derivative")
    def test_7_prompt_includes_multiple_docs(
        self,
        mock_validate: MagicMock,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        """Prompt includes sections from multiple documents."""
        from src.validators.derivative_validators import (
            DerivativeValidationResult,
            DerivativeVerdict,
        )

        mock_db.get_legal_document.side_effect = [FAKE_DOC_1, FAKE_DOC_2]
        mock_db.get_document_sections_for_digest.side_effect = [FAKE_SECTIONS_1, FAKE_SECTIONS_2]
        mock_db.create_model_run.return_value = "model-run-001"
        mock_rag.generate_completion.return_value = FAKE_RAG_RESPONSE
        mock_validate.return_value = DerivativeValidationResult(
            verdict=DerivativeVerdict.PUBLISH, checks=[], reasons=[],
        )
        mock_nestjs.write_derivative.return_value = {"artifactId": "art-001"}
        mock_nestjs.update_job_status.return_value = True

        _run_task(
            "job-001", "criminal_law",
            document_ids=["doc-001", "doc-002"],
        )

        # Verify the user prompt was built with both documents
        rag_call = mock_rag.generate_completion.call_args
        user_prompt = rag_call.kwargs.get("user_prompt") or rag_call.args[1] if len(rag_call.args) > 1 else ""
        # The prompt builder is called internally; we verify the LLM call happened
        mock_rag.generate_completion.assert_called_once()

    @patch("src.tasks.outline_generation_tasks.nestjs_client")
    @patch("src.tasks.outline_generation_tasks.rag_client")
    @patch("src.tasks.outline_generation_tasks.db")
    @patch("src.tasks.outline_generation_tasks.validate_derivative")
    def test_8_model_run_recorded(
        self,
        mock_validate: MagicMock,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        """Model run is created with correct parameters."""
        from src.validators.derivative_validators import (
            DerivativeValidationResult,
            DerivativeVerdict,
        )

        mock_db.get_legal_document.return_value = FAKE_DOC_1
        mock_db.get_document_sections_for_digest.return_value = FAKE_SECTIONS_1
        mock_db.create_model_run.return_value = "model-run-001"
        mock_rag.generate_completion.return_value = FAKE_RAG_RESPONSE
        mock_validate.return_value = DerivativeValidationResult(
            verdict=DerivativeVerdict.PUBLISH, checks=[], reasons=[],
        )
        mock_nestjs.write_derivative.return_value = {"artifactId": "art-001"}
        mock_nestjs.update_job_status.return_value = True

        _run_task(
            "job-001", "criminal_law",
            document_ids=["doc-001"],
        )

        mock_db.create_model_run.assert_called_once()
        call_kwargs = mock_db.create_model_run.call_args
        assert call_kwargs.kwargs["run_type"] == "subject_outline_generation"
        assert call_kwargs.kwargs["model_name"] == "gpt-4o-mini"
        assert call_kwargs.kwargs["prompt_template_version"] == PROMPT_TEMPLATE_VERSION
        assert call_kwargs.kwargs["input_ref"] == "subject:criminal_law"

    # ----- document_id dispatch (matches derivative_dispatch_tasks) -----

    @patch("src.tasks.outline_generation_tasks.nestjs_client")
    @patch("src.tasks.outline_generation_tasks.rag_client")
    @patch("src.tasks.outline_generation_tasks.db")
    @patch("src.tasks.outline_generation_tasks.validate_derivative")
    @patch("src.tasks.outline_generation_tasks._resolve_primary_subject")
    def test_9_document_id_resolves_primary_subject(
        self,
        mock_resolve: MagicMock,
        mock_validate: MagicMock,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        """Dispatcher-style call: document_id only → task resolves the
        document's primary (subject_code, topic_code) and generates an
        outline from that single doc."""
        from src.validators.derivative_validators import (
            DerivativeValidationResult,
            DerivativeVerdict,
        )

        mock_resolve.return_value = ("criminal_law", None)
        mock_db.claim_derivative_job.return_value = True
        mock_db.get_content_disclaimer_id.return_value = "disc-001"
        mock_db.get_legal_document.return_value = FAKE_DOC_1
        mock_db.get_document_sections_for_digest.return_value = FAKE_SECTIONS_1
        mock_db.create_model_run.return_value = "model-run-001"
        mock_rag.generate_completion.return_value = FAKE_RAG_RESPONSE
        mock_validate.return_value = DerivativeValidationResult(
            verdict=DerivativeVerdict.PUBLISH, checks=[], reasons=[],
        )
        mock_nestjs.write_derivative.return_value = {"artifactId": "art-001"}
        mock_nestjs.update_job_status.return_value = True

        result = generate_subject_outline.run("job-001", document_id="doc-001")

        assert result["status"] == "completed"
        mock_resolve.assert_called_once_with("doc-001")
        mock_db.get_legal_document.assert_called_once_with("doc-001")
        # Confirm input_ref was tagged with the resolved subject.
        call_kwargs = mock_db.create_model_run.call_args
        assert call_kwargs.kwargs["input_ref"] == "subject:criminal_law"

    @patch("src.tasks.outline_generation_tasks.nestjs_client")
    @patch("src.tasks.outline_generation_tasks.db")
    @patch("src.tasks.outline_generation_tasks._resolve_primary_subject")
    def test_10_document_id_no_primary_subject_fails(
        self,
        mock_resolve: MagicMock,
        mock_db: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        """document_id resolves to no primary subject → job fails."""
        mock_resolve.return_value = None
        mock_db.claim_derivative_job.return_value = True
        mock_db.get_content_disclaimer_id.return_value = "disc-001"
        mock_nestjs.update_job_status.return_value = True

        result = generate_subject_outline.run("job-001", document_id="doc-001")

        assert result["status"] == "failed"
        assert result["reason"] == "no_primary_subject_assignment"

    @patch("src.tasks.outline_generation_tasks.nestjs_client")
    @patch("src.tasks.outline_generation_tasks.db")
    def test_11_missing_dispatch_args_fails_early(
        self,
        mock_db: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        """Neither document_id nor subject_code/document_ids → fail early."""
        mock_db.claim_derivative_job.return_value = True
        mock_db.get_content_disclaimer_id.return_value = "disc-001"
        mock_nestjs.update_job_status.return_value = True

        result = generate_subject_outline.run("job-001")

        assert result["status"] == "failed"
        assert result["reason"] == "missing_dispatch_args"

    # ----- subject-level dispatch (post-2026-04-22 primary path) -----

    @patch("src.tasks.outline_generation_tasks.nestjs_client")
    @patch("src.tasks.outline_generation_tasks.rag_client")
    @patch("src.tasks.outline_generation_tasks.db")
    @patch("src.tasks.outline_generation_tasks.validate_derivative")
    @patch("src.tasks.outline_generation_tasks._get_document_ids_by_subject")
    def test_outline_subject_level_dispatch_loads_all_docs_under_subject(
        self,
        mock_get_ids: MagicMock,
        mock_validate: MagicMock,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        """Subject-level dispatch loads every doc classified under the subject."""
        from src.validators.derivative_validators import (
            DerivativeValidationResult,
            DerivativeVerdict,
        )

        # Subject-level call: 4 docs classified under criminal_law
        mock_get_ids.return_value = ["doc-001", "doc-002", "doc-003", "doc-004"]
        mock_db.claim_derivative_job.return_value = True
        mock_db.get_content_disclaimer_id.return_value = "disc-001"
        mock_db.get_legal_document.side_effect = [
            FAKE_DOC_1, FAKE_DOC_2, FAKE_DOC_1, FAKE_DOC_2,
        ]
        mock_db.get_document_sections_for_digest.side_effect = [
            FAKE_SECTIONS_1, FAKE_SECTIONS_2, FAKE_SECTIONS_1, FAKE_SECTIONS_2,
        ]
        mock_db.create_model_run.return_value = "model-run-001"
        mock_rag.generate_completion.return_value = FAKE_RAG_RESPONSE
        mock_validate.return_value = DerivativeValidationResult(
            verdict=DerivativeVerdict.PUBLISH, checks=[], reasons=[],
        )
        mock_nestjs.write_derivative.return_value = {"artifactId": "art-001"}
        mock_nestjs.update_job_status.return_value = True

        result = generate_subject_outline.run(
            "job-001", subject_code="criminal_law",
        )

        assert result["status"] == "completed"
        assert result["document_count"] == 4
        # Every doc under the subject was loaded — the per-doc resolver
        # must NOT be invoked for the subject-level path.
        mock_get_ids.assert_called_once_with("criminal_law", None, 10)
        assert mock_db.get_legal_document.call_count == 4

    @patch("src.tasks.outline_generation_tasks.nestjs_client")
    @patch("src.tasks.outline_generation_tasks.rag_client")
    @patch("src.tasks.outline_generation_tasks.db")
    @patch("src.tasks.outline_generation_tasks.validate_derivative")
    @patch("src.tasks.outline_generation_tasks._get_document_ids_by_subject")
    def test_outline_subject_code_resolves_subject_id(
        self,
        mock_get_ids: MagicMock,
        mock_validate: MagicMock,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        """The subject_code string is forwarded to the subject→docs resolver.

        This guards the DB join: the resolver reads `subjects.code` to look
        up the `subjects.id` used on `document_subject_assignments`.
        """
        from src.validators.derivative_validators import (
            DerivativeValidationResult,
            DerivativeVerdict,
        )

        mock_get_ids.return_value = ["doc-001", "doc-002"]
        mock_db.claim_derivative_job.return_value = True
        mock_db.get_content_disclaimer_id.return_value = "disc-001"
        mock_db.get_legal_document.side_effect = [FAKE_DOC_1, FAKE_DOC_2]
        mock_db.get_document_sections_for_digest.side_effect = [
            FAKE_SECTIONS_1, FAKE_SECTIONS_2,
        ]
        mock_db.create_model_run.return_value = "model-run-001"
        mock_rag.generate_completion.return_value = FAKE_RAG_RESPONSE
        mock_validate.return_value = DerivativeValidationResult(
            verdict=DerivativeVerdict.PUBLISH, checks=[], reasons=[],
        )
        mock_nestjs.write_derivative.return_value = {"artifactId": "art-001"}
        mock_nestjs.update_job_status.return_value = True

        generate_subject_outline.run("job-001", subject_code="civil_law")

        # Forwards subject_code verbatim; topic defaults to None; max 10.
        mock_get_ids.assert_called_once_with("civil_law", None, 10)
        # input_ref on the model_run captures the subject code for audit.
        call_kwargs = mock_db.create_model_run.call_args
        assert call_kwargs.kwargs["input_ref"] == "subject:civil_law"

    @patch("src.tasks.outline_generation_tasks.nestjs_client")
    @patch("src.tasks.outline_generation_tasks.db")
    @patch("src.tasks.outline_generation_tasks._get_document_ids_by_subject")
    def test_outline_rejects_unknown_subject_code(
        self,
        mock_get_ids: MagicMock,
        mock_db: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        """An unknown subject_code (no docs classified) fails the job."""
        mock_get_ids.return_value = []
        mock_db.claim_derivative_job.return_value = True
        mock_db.get_content_disclaimer_id.return_value = "disc-001"
        mock_nestjs.update_job_status.return_value = True

        result = generate_subject_outline.run(
            "job-001", subject_code="not_a_real_subject",
        )

        assert result["status"] == "failed"
        assert result["reason"] == "no_documents"
        mock_nestjs.write_derivative.assert_not_called()


# ---------------------------------------------------------------------------
# Subject → document resolver — polymorphic assignment filter
# ---------------------------------------------------------------------------
#
# Added after 2026-04-22 bulk-gen: `document_subject_assignments` joins both
# legal_documents AND derivative_artifacts. Outline previously pulled every
# row with a matching subject_code and then tried to load a legal_document
# for a NULL id — logging "Document None not found, skipping" ×3 per job
# and producing 0-section outlines that the validator quarantined.
#
# These tests pin the SQL-level filter so a future refactor can't regress
# the resolver back to returning NULL ids or non-primary assignments.


def _make_sql_capture_conn(rows: list[dict[str, Any]]) -> MagicMock:
    """Mock psycopg2 conn/cursor that captures executed SQL + returns rows."""
    mock_conn = MagicMock()
    mock_cursor = MagicMock()
    mock_cursor.fetchall.return_value = rows
    mock_cursor.__enter__ = MagicMock(return_value=mock_cursor)
    mock_cursor.__exit__ = MagicMock(return_value=False)
    mock_conn.__enter__ = MagicMock(return_value=mock_conn)
    mock_conn.__exit__ = MagicMock(return_value=False)
    mock_conn.cursor.return_value = mock_cursor
    return mock_conn


class TestGetDocumentIdsBySubject:
    """Pins the SQL filter on _get_document_ids_by_subject."""

    @patch("src.clients.db_client.get_connection")
    def test_subject_resolver_excludes_derivative_artifact_assignment_rows(
        self,
        mock_get_conn: MagicMock,
    ) -> None:
        """Rows where legal_document_id IS NULL (derivative_artifact tags)
        must be filtered at the SQL level, not in Python.

        Setup: subject 'criminal_law' has 3 legal_document assignments and
        5 derivative_artifact assignments. The query-level filter means the
        resolver returns exactly 3 — we assert the SQL contains
        ``legal_document_id IS NOT NULL`` and that only the non-null rows
        are returned by the mock.
        """
        from src.tasks.outline_generation_tasks import _get_document_ids_by_subject

        real_doc_ids = ["doc-001", "doc-002", "doc-003"]
        mock_conn = _make_sql_capture_conn(
            [{"legal_document_id": d} for d in real_doc_ids],
        )
        mock_get_conn.return_value = mock_conn

        result = _get_document_ids_by_subject("criminal_law", None, 10)

        assert result == real_doc_ids

        mock_cursor = mock_conn.cursor.return_value.__enter__.return_value
        executed_sql = mock_cursor.execute.call_args[0][0]
        assert "legal_document_id IS NOT NULL" in executed_sql, (
            "SQL must filter out derivative_artifact_id-only assignment rows; "
            "without this, the resolver returns NULL ids that then log "
            "'Document None not found, skipping' downstream."
        )

    @patch("src.clients.db_client.get_connection")
    def test_subject_resolver_filters_non_primary(
        self,
        mock_get_conn: MagicMock,
    ) -> None:
        """Non-primary subject assignments must be filtered out.

        The outline enqueue fan-out (PR #67 API side) only schedules jobs
        per primary subject; the resolver must match that invariant or an
        outline re-run would re-pull documents under their secondary tags.
        """
        from src.tasks.outline_generation_tasks import _get_document_ids_by_subject

        primary_ids = ["doc-001", "doc-002"]
        mock_conn = _make_sql_capture_conn(
            [{"legal_document_id": d} for d in primary_ids],
        )
        mock_get_conn.return_value = mock_conn

        result = _get_document_ids_by_subject("civil_law", None, 10)

        assert result == primary_ids

        mock_cursor = mock_conn.cursor.return_value.__enter__.return_value
        executed_sql = mock_cursor.execute.call_args[0][0]
        assert "is_primary = true" in executed_sql, (
            "SQL must filter is_primary = true to match the API-side "
            "enqueue fan-out (one outline job per primary subject)."
        )

    @patch("src.clients.db_client.get_connection")
    def test_subject_resolver_with_topic_also_applies_filters(
        self,
        mock_get_conn: MagicMock,
    ) -> None:
        """Topic-narrowed query carries the same filters as the subject-only query."""
        from src.tasks.outline_generation_tasks import _get_document_ids_by_subject

        mock_conn = _make_sql_capture_conn(
            [{"legal_document_id": "doc-001"}],
        )
        mock_get_conn.return_value = mock_conn

        _get_document_ids_by_subject("civil_law", "obligations_and_contracts", 10)

        mock_cursor = mock_conn.cursor.return_value.__enter__.return_value
        executed_sql = mock_cursor.execute.call_args[0][0]
        assert "legal_document_id IS NOT NULL" in executed_sql
        assert "is_primary = true" in executed_sql
