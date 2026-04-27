"""Tests for case digest generation Celery task (PR 3.2B).

12 tests covering:
1. Happy path
2. Eligibility skip — low confidence
3. Eligibility skip — short text
4. Validator quarantine
5. Validator human_review
6. LLM returns invalid JSON
7. LLM timeout/error → retry
8. NestJS write endpoint returns error
9. Prompt building — sections text assembly
10. Prompt building — metadata substitution
11. Provenance records from sectionUsage
12. Model run recorded
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock, patch

import httpx
import pytest

from src.prompts.case_digest_v1 import (
    PROMPT_TEMPLATE_VERSION,
    build_sections_text,
    build_user_prompt,
)
from src.tasks.digest_generation_tasks import (
    _build_provenance_records,
    _build_section_usage_from_provenance,
    _format_issues,
    generate_case_digest,
)

# ---------------------------------------------------------------------------
# Fixtures & Helpers
# ---------------------------------------------------------------------------

FAKE_DOC = {
    "id": "doc-001",
    "title": "Republic v. Sandiganbayan",
    "short_title": "Republic v. Sandiganbayan",
    "document_type": "case",
    "gr_no": "G.R. No. 123456",
    "citation_text": "G.R. No. 123456, January 1, 2025",
    "court": "Supreme Court",
    "ponente": "Justice Cruz",
    "decision_date": "2025-01-01",
    "source_id": "source-001",
    "is_official": True,
    "status": "published",
    "truthfulness_status": "verified",
}

FAKE_SECTIONS = [
    {
        "id": "sec-001",
        "section_type": "body",
        "section_label": "Decision",
        "plain_text": "The accused was charged with plunder. " * 50,
        "page_start": 1,
        "page_end": 5,
        "ordering": 0,
    },
    {
        "id": "sec-002",
        "section_type": "body",
        "section_label": "Dispositive",
        "plain_text": "WHEREFORE, the petition is GRANTED. " * 20,
        "page_start": 5,
        "page_end": 6,
        "ordering": 1,
    },
]

# RAG DigestGenerationResponse shape — flat, snake_case, no content wrapper
FAKE_RAG_RESPONSE: dict[str, Any] = {
    "facts": "The accused was charged with plunder involving ill-gotten wealth. " * 15,
    "issues": "- Whether the Sandiganbayan erred in convicting the accused\n\n- Whether the evidence was sufficient to prove guilt beyond reasonable doubt",
    "ruling": "The Supreme Court affirmed the conviction. " * 20,
    "doctrine": "The doctrine of command responsibility applies to civilian officials. " * 8,
    "dispositive": "WHEREFORE, the appeal is DENIED. The decision of the Sandiganbayan is AFFIRMED.",
    "summary": "The Court upheld the plunder conviction.",
    "petitioner_arguments": None,
    "respondent_arguments": None,
    "cited_authorities": [
        {
            "citation_text": "People v. Estrada, G.R. No. 164368",
            "document_type": "case",
            "gr_no": "G.R. No. 164368",
        },
    ],
    "provenance": [
        {"field": "facts", "source_section_id": "sec-001", "source_document_id": "doc-001"},
        {"field": "issues", "source_section_id": "sec-001", "source_document_id": "doc-001"},
        {"field": "ruling", "source_section_id": "sec-001", "source_document_id": "doc-001"},
        {"field": "dispositive", "source_section_id": "sec-002", "source_document_id": "doc-001"},
    ],
    "confidence_score": 0.85,
    "model_name": "gpt-4o-mini",
    "prompt_template_version": PROMPT_TEMPLATE_VERSION,
    # PR #76 surfaced tokens through DigestGenerationResponse; the worker
    # used to hardcode 0/0 even when these were present (Bug 7-residual).
    "tokens_in": 1500,
    "tokens_out": 800,
}


def _run_task(job_id: str, document_id: str) -> dict[str, Any]:
    """Run the generate_case_digest task using .run() to bypass Celery dispatch."""
    return generate_case_digest.run(job_id, document_id)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestGenerateCaseDigest:
    """Tests for the generate_case_digest Celery task."""

    @patch("src.tasks.digest_generation_tasks.nestjs_client")
    @patch("src.tasks.digest_generation_tasks.rag_client")
    @patch("src.tasks.digest_generation_tasks.db")
    @patch("src.tasks.digest_generation_tasks.validate_derivative")
    def test_1_happy_path(
        self,
        mock_validate: MagicMock,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        """Happy path: LLM returns valid digest -> validator passes -> NestJS write -> completed."""
        from src.validators.derivative_validators import (
            DerivativeValidationResult,
            DerivativeVerdict,
        )

        mock_db.get_legal_document.return_value = FAKE_DOC
        mock_db.get_document_sections_for_digest.return_value = FAKE_SECTIONS
        mock_db.create_model_run.return_value = "model-run-001"
        mock_rag.generate_digest.return_value = FAKE_RAG_RESPONSE
        mock_validate.return_value = DerivativeValidationResult(
            verdict=DerivativeVerdict.PUBLISH,
            checks=[],
            reasons=[],
        )
        mock_nestjs.write_digest.return_value = {"digestId": "digest-001"}
        mock_nestjs.update_job_status.return_value = True

        result = _run_task("job-001", "doc-001")

        assert result["status"] == "completed"
        assert result["digest_id"] == "digest-001"
        mock_nestjs.write_digest.assert_called_once()
        # Verify job was claimed via DB then marked completed via NestJS
        mock_db.claim_derivative_job.assert_called_once_with("job-001")
        calls = mock_nestjs.update_job_status.call_args_list
        assert calls[-1].args[0] == "job-001"
        assert calls[-1].args[1] == "completed"

    @patch("src.tasks.digest_generation_tasks.nestjs_client")
    @patch("src.tasks.digest_generation_tasks.db")
    def test_2_eligibility_skip_low_confidence(
        self,
        mock_db: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        """Eligibility skip: document confidence < 0.5 -> skipped_ineligible."""
        low_conf_doc = {**FAKE_DOC, "confidence_score": 0.3}
        mock_db.get_legal_document.return_value = low_conf_doc
        mock_db.get_document_sections_for_digest.return_value = FAKE_SECTIONS
        mock_nestjs.update_job_status.return_value = True

        result = _run_task("job-001", "doc-001")

        assert result["status"] == "skipped_ineligible"
        skip_call = [
            c for c in mock_nestjs.update_job_status.call_args_list
            if c.args[1] == "skipped_ineligible"
        ]
        assert len(skip_call) == 1

    @patch("src.tasks.digest_generation_tasks.nestjs_client")
    @patch("src.tasks.digest_generation_tasks.db")
    def test_3_eligibility_skip_short_text(
        self,
        mock_db: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        """Eligibility skip: total text < 500 chars -> skipped_ineligible."""
        short_sections = [
            {
                "id": "sec-001",
                "section_type": "body",
                "plain_text": "Short text.",
                "page_start": 1,
                "page_end": 1,
                "ordering": 0,
            },
        ]
        mock_db.get_legal_document.return_value = FAKE_DOC
        mock_db.get_document_sections_for_digest.return_value = short_sections
        mock_nestjs.update_job_status.return_value = True

        result = _run_task("job-001", "doc-001")

        assert result["status"] == "skipped_ineligible"

    @patch("src.tasks.digest_generation_tasks.nestjs_client")
    @patch("src.tasks.digest_generation_tasks.rag_client")
    @patch("src.tasks.digest_generation_tasks.db")
    @patch("src.tasks.digest_generation_tasks.validate_derivative")
    def test_4_validator_quarantine(
        self,
        mock_validate: MagicMock,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        """Validator quarantine: missing IRAC fields -> job failed, no write."""
        from src.validators.derivative_validators import (
            DerivativeValidationResult,
            DerivativeVerdict,
            ValidatorCheck,
        )

        mock_db.get_legal_document.return_value = FAKE_DOC
        mock_db.get_document_sections_for_digest.return_value = FAKE_SECTIONS
        mock_rag.generate_digest.return_value = FAKE_RAG_RESPONSE
        mock_validate.return_value = DerivativeValidationResult(
            verdict=DerivativeVerdict.QUARANTINE,
            checks=[
                ValidatorCheck(
                    name="irac_fields_present",
                    passed=False,
                    reason="Missing required fields: facts, ruling",
                    severity="error",
                ),
            ],
            reasons=["Missing IRAC fields"],
        )
        mock_nestjs.update_job_status.return_value = True

        result = _run_task("job-001", "doc-001")

        assert result["status"] == "failed"
        assert result["reason"] == "validation_quarantine"
        mock_nestjs.write_digest.assert_not_called()

    @patch("src.tasks.digest_generation_tasks.nestjs_client")
    @patch("src.tasks.digest_generation_tasks.rag_client")
    @patch("src.tasks.digest_generation_tasks.db")
    @patch("src.tasks.digest_generation_tasks.validate_derivative")
    def test_5_validator_human_review(
        self,
        mock_validate: MagicMock,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        """Validator human_review: low confidence -> writes with needs_human_review."""
        from src.validators.derivative_validators import (
            DerivativeValidationResult,
            DerivativeVerdict,
            ValidatorCheck,
        )

        mock_db.get_legal_document.return_value = FAKE_DOC
        mock_db.get_document_sections_for_digest.return_value = FAKE_SECTIONS
        mock_db.create_model_run.return_value = "model-run-001"
        mock_rag.generate_digest.return_value = FAKE_RAG_RESPONSE
        mock_validate.return_value = DerivativeValidationResult(
            verdict=DerivativeVerdict.HUMAN_REVIEW,
            checks=[
                ValidatorCheck(
                    name="confidence_check",
                    passed=False,
                    reason="Self-reported confidence below threshold",
                    severity="warning",
                ),
            ],
            reasons=["Low confidence"],
        )
        mock_nestjs.write_digest.return_value = {"digestId": "digest-002"}
        mock_nestjs.update_job_status.return_value = True

        result = _run_task("job-001", "doc-001")

        assert result["status"] == "completed"
        assert result["review_status"] == "needs_human_review"
        write_call = mock_nestjs.write_digest.call_args
        assert write_call.args[0]["reviewStatus"] == "needs_human_review"

    @patch("src.tasks.digest_generation_tasks.nestjs_client")
    @patch("src.tasks.digest_generation_tasks.rag_client")
    @patch("src.tasks.digest_generation_tasks.db")
    @patch("src.tasks.digest_generation_tasks.validate_derivative")
    def test_6_missing_irac_fields_quarantine(
        self,
        mock_validate: MagicMock,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        """RAG returns response with missing IRAC fields -> validator quarantines."""
        from src.validators.derivative_validators import (
            DerivativeValidationResult,
            DerivativeVerdict,
            ValidatorCheck,
        )

        sparse_response = {
            **FAKE_RAG_RESPONSE,
            "facts": None,
            "ruling": None,
        }
        mock_db.get_legal_document.return_value = FAKE_DOC
        mock_db.get_document_sections_for_digest.return_value = FAKE_SECTIONS
        mock_rag.generate_digest.return_value = sparse_response
        mock_validate.return_value = DerivativeValidationResult(
            verdict=DerivativeVerdict.QUARANTINE,
            checks=[
                ValidatorCheck(
                    name="irac_field_facts",
                    passed=False,
                    reason="IRAC field 'facts' is missing",
                    severity="error",
                ),
            ],
            reasons=["IRAC field 'facts' is missing"],
        )
        mock_nestjs.update_job_status.return_value = True

        result = _run_task("job-001", "doc-001")

        assert result["status"] == "failed"
        assert result["reason"] == "validation_quarantine"

    @patch("src.tasks.digest_generation_tasks.nestjs_client")
    @patch("src.tasks.digest_generation_tasks.rag_client")
    @patch("src.tasks.digest_generation_tasks.db")
    def test_7_llm_timeout_max_retries_exhausted(
        self,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        """LLM timeout with retries exhausted -> job marked failed."""
        mock_db.get_legal_document.return_value = FAKE_DOC
        mock_db.get_document_sections_for_digest.return_value = FAKE_SECTIONS
        mock_rag.generate_digest.side_effect = httpx.ReadTimeout("timeout")
        mock_nestjs.update_job_status.return_value = True

        # Simulate max retries exhausted by patching the task's request context
        # When self.request.retries >= self.max_retries, the task should fail
        # without calling retry. We test this by mocking the exception handler path.
        with patch.object(
            type(generate_case_digest._get_current_object()), "max_retries",
            new_callable=lambda: property(lambda self: 0),
        ):
            result = _run_task("job-001", "doc-001")

        assert result["status"] == "failed"
        # Verify job was marked failed
        fail_calls = [
            c for c in mock_nestjs.update_job_status.call_args_list
            if len(c.args) >= 2 and c.args[1] == "failed"
        ]
        assert len(fail_calls) >= 1

    @patch("src.tasks.digest_generation_tasks.nestjs_client")
    @patch("src.tasks.digest_generation_tasks.rag_client")
    @patch("src.tasks.digest_generation_tasks.db")
    @patch("src.tasks.digest_generation_tasks.validate_derivative")
    def test_8_nestjs_write_error(
        self,
        mock_validate: MagicMock,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        """NestJS write endpoint error -> job failed."""
        from src.validators.derivative_validators import (
            DerivativeValidationResult,
            DerivativeVerdict,
        )

        mock_db.get_legal_document.return_value = FAKE_DOC
        mock_db.get_document_sections_for_digest.return_value = FAKE_SECTIONS
        mock_db.create_model_run.return_value = "model-run-001"
        mock_rag.generate_digest.return_value = FAKE_RAG_RESPONSE
        mock_validate.return_value = DerivativeValidationResult(
            verdict=DerivativeVerdict.PUBLISH, checks=[], reasons=[],
        )

        mock_response = MagicMock()
        mock_response.status_code = 500
        mock_response.text = "Internal Server Error"
        mock_nestjs.write_digest.side_effect = httpx.HTTPStatusError(
            "Server Error",
            request=MagicMock(),
            response=mock_response,
        )
        mock_nestjs.update_job_status.return_value = True

        result = _run_task("job-001", "doc-001")

        assert result["status"] == "failed"
        assert "http_error" in result["reason"]


class TestPromptBuilding:
    """Tests for prompt construction functions."""

    def test_9_sections_text_assembly(self) -> None:
        """Sections text is correctly assembled with IDs."""
        text = build_sections_text(FAKE_SECTIONS)

        assert "[Section sec-001 | body | Decision]" in text
        assert "[Section sec-002 | body | Dispositive]" in text
        assert "The accused was charged with plunder." in text

    def test_10_metadata_substitution(self) -> None:
        """User prompt has correct metadata values."""
        prompt = build_user_prompt(
            title="Republic v. Sandiganbayan",
            citation="G.R. No. 123456",
            court="Supreme Court",
            decision_date="2025-01-01",
            ponente="Justice Cruz",
            sections=FAKE_SECTIONS,
        )

        assert "Title: Republic v. Sandiganbayan" in prompt
        assert "Citation: G.R. No. 123456" in prompt
        assert "Court: Supreme Court" in prompt
        assert "Decision Date: 2025-01-01" in prompt
        assert "Ponente: Justice Cruz" in prompt
        assert "---SOURCE PASSAGES---" in prompt


class TestProvenanceBuilding:
    """Tests for provenance record construction."""

    def test_11_provenance_from_rag_provenance(self) -> None:
        """Provenance records built correctly from RAG provenance entries."""
        content = {
            "provenance": [
                {"field": "facts", "source_section_id": "sec-001", "source_document_id": "doc-001"},
                {"field": "ruling", "source_section_id": "sec-001", "source_document_id": "doc-001"},
                {"field": "dispositive", "source_section_id": "sec-002", "source_document_id": "doc-001"},
            ],
        }
        provenance = _build_provenance_records(content, "doc-001", FAKE_SECTIONS)

        assert len(provenance) == 2  # deduplicated by section_id
        assert provenance[0]["sourceDocumentId"] == "doc-001"
        assert provenance[0]["sourceSectionId"] == "sec-001"
        assert provenance[0]["provenanceType"] == "source_passage"
        assert provenance[1]["sourceSectionId"] == "sec-002"

    def test_section_usage_from_provenance(self) -> None:
        """sectionUsageJson built correctly from RAG provenance entries."""
        provenance = [
            {"field": "facts", "source_section_id": "sec-001", "source_document_id": "doc-001"},
            {"field": "ruling", "source_section_id": "sec-001", "source_document_id": "doc-001"},
            {"field": "dispositive", "source_section_id": "sec-002", "source_document_id": "doc-001"},
        ]
        usage = _build_section_usage_from_provenance(provenance)

        assert len(usage) == 2
        sec1 = next(u for u in usage if u["sectionId"] == "sec-001")
        assert set(sec1["fields"]) == {"facts", "ruling"}
        sec2 = next(u for u in usage if u["sectionId"] == "sec-002")
        assert sec2["fields"] == ["dispositive"]


class TestModelRunRecording:
    """Test that model run is properly recorded."""

    @patch("src.tasks.digest_generation_tasks.nestjs_client")
    @patch("src.tasks.digest_generation_tasks.rag_client")
    @patch("src.tasks.digest_generation_tasks.db")
    @patch("src.tasks.digest_generation_tasks.validate_derivative")
    def test_12_model_run_recorded(
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

        mock_db.get_legal_document.return_value = FAKE_DOC
        mock_db.get_document_sections_for_digest.return_value = FAKE_SECTIONS
        mock_db.create_model_run.return_value = "model-run-001"
        mock_rag.generate_digest.return_value = FAKE_RAG_RESPONSE
        mock_validate.return_value = DerivativeValidationResult(
            verdict=DerivativeVerdict.PUBLISH, checks=[], reasons=[],
        )
        mock_nestjs.write_digest.return_value = {"digestId": "digest-001"}
        mock_nestjs.update_job_status.return_value = True

        _run_task("job-001", "doc-001")

        mock_db.create_model_run.assert_called_once()
        call_kwargs = mock_db.create_model_run.call_args
        assert call_kwargs.kwargs["run_type"] == "case_digest_generation"
        assert call_kwargs.kwargs["model_name"] == "gpt-4o-mini"
        assert call_kwargs.kwargs["prompt_template_version"] == PROMPT_TEMPLATE_VERSION
        assert call_kwargs.kwargs["input_ref"] == "doc:doc-001"
        # Bug 7-residual — token usage from rag-service /digests/generate
        # (PR #76) MUST land in model_runs.tokens_in/tokens_out instead of
        # the previous hardcoded 0/0.
        assert call_kwargs.kwargs["tokens_in"] == 1500
        assert call_kwargs.kwargs["tokens_out"] == 800


class TestIntegrationDigestRAGShape:
    """Integration-style test: RAG's real response shape flows through the task."""

    @patch("src.tasks.digest_generation_tasks.nestjs_client")
    @patch("src.tasks.digest_generation_tasks.rag_client")
    @patch("src.tasks.digest_generation_tasks.db")
    def test_rag_response_completes_end_to_end(
        self,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        """RAG's real DigestGenerationResponse shape -> task completes with status: completed."""
        mock_db.get_legal_document.return_value = FAKE_DOC
        mock_db.get_document_sections_for_digest.return_value = FAKE_SECTIONS
        mock_db.create_model_run.return_value = "model-run-001"
        mock_rag.generate_digest.return_value = FAKE_RAG_RESPONSE
        mock_nestjs.write_digest.return_value = {"digestId": "digest-001"}
        mock_nestjs.update_job_status.return_value = True

        result = _run_task("job-001", "doc-001")

        assert result["status"] == "completed"
        assert result["digest_id"] == "digest-001"
        assert result["confidence_score"] == 0.85

        # Verify write payload uses correct snake_case -> camelCase mapping
        write_call = mock_nestjs.write_digest.call_args
        payload = write_call.args[0]
        assert payload["confidenceScore"] == 0.85
        assert payload["citedAuthoritiesJson"][0]["citation_text"] == "People v. Estrada, G.R. No. 164368"
        assert len(payload["sectionUsageJson"]) == 2
        assert len(payload["provenanceRecords"]) == 2


class TestFormatIssues:
    """Tests for the _format_issues helper."""

    def test_list_of_strings(self) -> None:
        result = _format_issues(["Issue 1", "Issue 2"])
        assert result == "- Issue 1\n- Issue 2"

    def test_string_passthrough(self) -> None:
        result = _format_issues("Single issue text")
        assert result == "Single issue text"

    def test_none_passthrough(self) -> None:
        result = _format_issues(None)
        assert result is None
