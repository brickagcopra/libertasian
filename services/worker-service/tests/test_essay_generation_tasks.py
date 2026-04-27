"""Tests for essay prompt generation Celery task (PR 5.2).

10 tests covering:
1. Happy path — valid essay -> NestJS write called -> job completed
2. Eligibility skip -> skipped_ineligible
3. Validator quarantine -> job failed, no write
4. Validator human_review -> writes with needs_human_review
5. LLM returns invalid JSON -> job failed
6. LLM abstains -> no write
7. Bar exam sitting source — includes barExamSittingId in write payload
8. Prompt building — correct metadata substitution
9. ALAC headings in generated model answer
10. Model run recorded
"""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import MagicMock, patch

import httpx
import pytest

from src.prompts.essay_generation_v1 import (
    PROMPT_TEMPLATE_VERSION,
    build_sections_text,
    build_user_prompt,
)
from src.tasks.essay_generation_tasks import (
    _build_provenance_records,
    generate_essay_prompt,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

FAKE_DOC: dict[str, Any] = {
    "id": "doc-001",
    "title": "Republic v. Sandiganbayan",
    "document_type": "case",
    "citation_text": "G.R. No. 123456",
    "court": "Supreme Court",
    "decision_date": "2025-01-01",
    "subject": "Criminal Law",
    "is_official": True,
}

FAKE_SECTIONS: list[dict[str, Any]] = [
    {
        "id": "sec-001",
        "section_type": "body",
        "section_label": "Decision",
        "plain_text": (
            "The doctrine of command responsibility applies to civilian officials "
            "who hold positions of authority in the government. This principle requires "
            "that officials exercising effective control over subordinates may be held "
            "liable for the acts of those subordinates. " * 5  # ~200 chars * 5 = ~1000
        ),
        "page_start": 1,
        "page_end": 5,
    },
    {
        "id": "sec-002",
        "section_type": "body",
        "section_label": "Dispositive",
        "plain_text": "WHEREFORE, the petition is GRANTED. The decision is affirmed.",
        "page_start": 5,
        "page_end": 6,
    },
]

# 60-word prompt text
VALID_PROMPT = (
    "Atty. Santos is a government official who oversees a department of twenty employees. "
    "One of his subordinates, Mr. Cruz, committed an act of corruption by accepting a bribe "
    "from a contractor. Atty. Santos was aware of the corrupt activities but failed to take "
    "any action to prevent or punish the subordinate. Discuss the legal liability of Atty. Santos "
    "under the doctrine of command responsibility."
)

FAKE_LLM_CONTENT: dict[str, Any] = {
    "promptText": VALID_PROMPT,
    "suggestedTimeMinutes": 30,
    "modelAnswer": {
        "outlineSections": [
            {
                "heading": "Answer",
                "paragraphs": ["Atty. Santos may be held liable under command responsibility."],
                "citedSectionIds": ["sec-001"],
            },
            {
                "heading": "Law",
                "paragraphs": ["The doctrine applies to civilian officials."],
                "citedSectionIds": ["sec-001", "sec-002"],
            },
            {
                "heading": "Application",
                "paragraphs": ["Atty. Santos had effective control and failed to act."],
                "citedSectionIds": ["sec-001"],
            },
            {
                "heading": "Conclusion",
                "paragraphs": ["Therefore, Atty. Santos is liable."],
                "citedSectionIds": ["sec-001"],
            },
        ],
    },
    "rubric": {
        "totalPoints": 100,
        "criteria": [
            {"name": "Issue ID", "maxPoints": 20, "description": "Identifies the issue"},
            {"name": "Knowledge", "maxPoints": 30, "description": "Shows legal knowledge"},
            {"name": "Analysis", "maxPoints": 35, "description": "Applies law to facts"},
            {"name": "Conclusion", "maxPoints": 15, "description": "Clear conclusion"},
        ],
    },
    "abstain": False,
    "abstainReason": None,
}

FAKE_RAG_RESPONSE: dict[str, Any] = {
    "content": FAKE_LLM_CONTENT,
    "model_name": "gpt-4o-mini",
    "tokens_in": 1500,
    "tokens_out": 800,
}


def _run_task(job_id: str, document_id: str, **kwargs: Any) -> dict[str, Any]:
    """Run the Celery task synchronously, bypassing Celery dispatch."""
    return generate_essay_prompt.run(job_id, document_id, **kwargs)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestEssayGenerationTask:
    """Tests for the generate_essay_prompt Celery task."""

    @patch("src.tasks.essay_generation_tasks.nestjs_client")
    @patch("src.tasks.essay_generation_tasks.rag_client")
    @patch("src.tasks.essay_generation_tasks.db")
    @patch("src.tasks.essay_generation_tasks.validate_derivative")
    def test_1_happy_path(
        self,
        mock_validate: MagicMock,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        """Happy path — valid essay -> NestJS write called -> job completed."""
        from src.validators.derivative_validators import (
            DerivativeValidationResult,
            DerivativeVerdict,
        )

        mock_db.get_legal_document.return_value = FAKE_DOC
        mock_db.get_document_sections_for_digest.return_value = FAKE_SECTIONS
        mock_db.create_model_run.return_value = "model-run-001"
        mock_rag.generate_completion.return_value = FAKE_RAG_RESPONSE
        mock_validate.return_value = DerivativeValidationResult(
            verdict=DerivativeVerdict.PUBLISH, checks=[], reasons=[],
        )
        mock_nestjs.write_essay.return_value = {
            "artifactId": "art-001",
            "essayPromptId": "essay-001",
        }
        mock_nestjs.update_job_status.return_value = True

        result = _run_task("job-001", "doc-001")

        assert result["status"] == "completed"
        assert result["artifact_id"] == "art-001"
        assert result["essay_prompt_id"] == "essay-001"
        mock_nestjs.write_essay.assert_called_once()

        # Confidence score must be computed, not hardcoded to 0
        write_call = mock_nestjs.write_essay.call_args
        assert write_call.args[0]["confidenceScore"] > 0.0

        # Bug 10 — budget_ledger.amount_usd must be the computed USD cost
        # for the model+tokens, not the hardcoded 0.0 the task used to ship.
        # gpt-4o-mini @ 1500 in + 800 out → (1500*0.150 + 800*0.600) / 1M
        # = 0.000705 USD.
        ledger_entry = write_call.args[0]["budgetLedgerEntry"]
        assert ledger_entry["amountUsd"] == pytest.approx(0.000705, rel=1e-6)
        assert ledger_entry["modelName"] == "gpt-4o-mini"
        assert ledger_entry["tokensIn"] == 1500
        assert ledger_entry["tokensOut"] == 800

    @patch("src.tasks.essay_generation_tasks.nestjs_client")
    @patch("src.tasks.essay_generation_tasks.db")
    def test_2_eligibility_skip(
        self,
        mock_db: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        """Eligibility skip -> skipped_ineligible."""
        mock_db.get_legal_document.return_value = {
            **FAKE_DOC,
            "confidence_score": 0.2,  # Below 0.5 threshold
        }
        mock_db.get_document_sections_for_digest.return_value = FAKE_SECTIONS
        mock_nestjs.update_job_status.return_value = True

        result = _run_task("job-001", "doc-001")

        assert result["status"] == "skipped_ineligible"
        assert "confidence" in result["reason"].lower()

    @patch("src.tasks.essay_generation_tasks.nestjs_client")
    @patch("src.tasks.essay_generation_tasks.rag_client")
    @patch("src.tasks.essay_generation_tasks.db")
    @patch("src.tasks.essay_generation_tasks.validate_derivative")
    def test_3_validator_quarantine(
        self,
        mock_validate: MagicMock,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        """Validator quarantine -> job failed, no write."""
        from src.validators.derivative_validators import (
            DerivativeValidationResult,
            DerivativeVerdict,
            ValidatorCheck,
        )

        mock_db.get_legal_document.return_value = FAKE_DOC
        mock_db.get_document_sections_for_digest.return_value = FAKE_SECTIONS
        mock_rag.generate_completion.return_value = FAKE_RAG_RESPONSE
        mock_validate.return_value = DerivativeValidationResult(
            verdict=DerivativeVerdict.QUARANTINE,
            checks=[
                ValidatorCheck(
                    name="abstain_flag",
                    passed=False,
                    reason="Empty prompt text",
                    severity="error",
                ),
            ],
            reasons=["Empty prompt text"],
        )
        mock_nestjs.update_job_status.return_value = True

        result = _run_task("job-001", "doc-001")

        assert result["status"] == "failed"
        assert result["reason"] == "validation_quarantine"
        mock_nestjs.write_essay.assert_not_called()

    @patch("src.tasks.essay_generation_tasks.nestjs_client")
    @patch("src.tasks.essay_generation_tasks.rag_client")
    @patch("src.tasks.essay_generation_tasks.db")
    @patch("src.tasks.essay_generation_tasks.validate_derivative")
    def test_4_validator_human_review(
        self,
        mock_validate: MagicMock,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        """Validator human_review -> writes with needs_human_review."""
        from src.validators.derivative_validators import (
            DerivativeValidationResult,
            DerivativeVerdict,
            ValidatorCheck,
        )

        mock_db.get_legal_document.return_value = FAKE_DOC
        mock_db.get_document_sections_for_digest.return_value = FAKE_SECTIONS
        mock_db.create_model_run.return_value = "model-run-001"
        mock_rag.generate_completion.return_value = FAKE_RAG_RESPONSE
        mock_validate.return_value = DerivativeValidationResult(
            verdict=DerivativeVerdict.HUMAN_REVIEW,
            checks=[
                ValidatorCheck(
                    name="prompt_length",
                    passed=False,
                    reason="Prompt too short",
                    severity="warning",
                ),
            ],
            reasons=["Prompt too short"],
        )
        mock_nestjs.write_essay.return_value = {
            "artifactId": "art-002",
            "essayPromptId": "essay-002",
        }
        mock_nestjs.update_job_status.return_value = True

        result = _run_task("job-001", "doc-001")

        assert result["status"] == "completed"
        assert result["review_status"] == "needs_human_review"
        write_call = mock_nestjs.write_essay.call_args
        assert write_call.args[0]["reviewStatus"] == "needs_human_review"

    @patch("src.tasks.essay_generation_tasks.nestjs_client")
    @patch("src.tasks.essay_generation_tasks.rag_client")
    @patch("src.tasks.essay_generation_tasks.db")
    def test_5_invalid_json(
        self,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        """LLM returns invalid JSON -> job failed."""
        mock_db.get_legal_document.return_value = FAKE_DOC
        mock_db.get_document_sections_for_digest.return_value = FAKE_SECTIONS
        mock_rag.generate_completion.return_value = {
            **FAKE_RAG_RESPONSE,
            "content": "This is not valid JSON {broken",
        }
        mock_nestjs.update_job_status.return_value = True

        result = _run_task("job-001", "doc-001")

        assert result["status"] == "failed"
        assert result["reason"] == "invalid_json"

    @patch("src.tasks.essay_generation_tasks.nestjs_client")
    @patch("src.tasks.essay_generation_tasks.rag_client")
    @patch("src.tasks.essay_generation_tasks.db")
    def test_6_llm_abstains(
        self,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        """LLM abstains -> no write."""
        mock_db.get_legal_document.return_value = FAKE_DOC
        mock_db.get_document_sections_for_digest.return_value = FAKE_SECTIONS
        mock_rag.generate_completion.return_value = {
            **FAKE_RAG_RESPONSE,
            "content": {
                "abstain": True,
                "abstainReason": "Insufficient material for essay",
            },
        }
        mock_nestjs.update_job_status.return_value = True

        result = _run_task("job-001", "doc-001")

        assert result["status"] == "failed"
        assert result["reason"] == "abstained"
        mock_nestjs.write_essay.assert_not_called()

    @patch("src.tasks.essay_generation_tasks.nestjs_client")
    @patch("src.tasks.essay_generation_tasks.rag_client")
    @patch("src.tasks.essay_generation_tasks.db")
    @patch("src.tasks.essay_generation_tasks.validate_derivative")
    def test_7_bar_exam_sitting_source(
        self,
        mock_validate: MagicMock,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        """Bar exam sitting source — includes barExamSittingId in write payload."""
        from src.validators.derivative_validators import (
            DerivativeValidationResult,
            DerivativeVerdict,
        )

        mock_db.get_legal_document.return_value = FAKE_DOC
        mock_db.get_document_sections_for_digest.return_value = FAKE_SECTIONS
        mock_db.create_model_run.return_value = "model-run-001"
        mock_rag.generate_completion.return_value = FAKE_RAG_RESPONSE
        mock_validate.return_value = DerivativeValidationResult(
            verdict=DerivativeVerdict.PUBLISH, checks=[], reasons=[],
        )
        mock_nestjs.write_essay.return_value = {
            "artifactId": "art-003",
            "essayPromptId": "essay-003",
        }
        mock_nestjs.update_job_status.return_value = True

        result = _run_task(
            "job-001", "doc-001",
            source_type="bar_exam_sitting",
            bar_exam_sitting_id="sitting-001",
        )

        assert result["status"] == "completed"
        write_call = mock_nestjs.write_essay.call_args
        assert write_call.args[0]["barExamSittingId"] == "sitting-001"


class TestPromptBuilding:
    """Tests for prompt construction functions."""

    def test_8_metadata_substitution(self) -> None:
        """User prompt has correct metadata values."""
        prompt = build_user_prompt(
            title="Republic v. Sandiganbayan",
            citation="G.R. No. 123456",
            court="Supreme Court",
            decision_date="2025-01-01",
            subject="Criminal Law",
            source_type="decision",
            sections=FAKE_SECTIONS,
            audience="student",
        )

        assert "Title: Republic v. Sandiganbayan" in prompt
        assert "Citation: G.R. No. 123456" in prompt
        assert "Court: Supreme Court" in prompt
        assert "Decision Date: 2025-01-01" in prompt
        assert "Subject: Criminal Law" in prompt
        assert "Source Type: decision" in prompt
        assert "Target audience: student" in prompt
        assert "---SOURCE PASSAGES---" in prompt

    def test_9_alac_headings_in_prompt(self) -> None:
        """ALAC headings explicitly mentioned in system prompt."""
        from src.prompts.essay_generation_v1 import ESSAY_GENERATION_SYSTEM_PROMPT

        assert "ALAC format" in ESSAY_GENERATION_SYSTEM_PROMPT
        assert "Answer" in ESSAY_GENERATION_SYSTEM_PROMPT
        assert "Law" in ESSAY_GENERATION_SYSTEM_PROMPT
        assert "Application" in ESSAY_GENERATION_SYSTEM_PROMPT
        assert "Conclusion" in ESSAY_GENERATION_SYSTEM_PROMPT


class TestProvenanceBuilding:
    """Tests for provenance record construction."""

    def test_provenance_from_model_answer(self) -> None:
        """Provenance records built correctly from model answer citedSectionIds."""
        content = {
            "modelAnswer": {
                "outlineSections": [
                    {"heading": "Answer", "citedSectionIds": ["sec-001"]},
                    {"heading": "Law", "citedSectionIds": ["sec-001", "sec-002"]},
                    {"heading": "Application", "citedSectionIds": ["sec-001"]},
                    {"heading": "Conclusion", "citedSectionIds": ["sec-001"]},
                ],
            },
        }
        provenance = _build_provenance_records(content, "doc-001", FAKE_SECTIONS)

        assert len(provenance) == 2  # sec-001 and sec-002, deduplicated
        section_ids = {p["sourceSectionId"] for p in provenance}
        assert "sec-001" in section_ids
        assert "sec-002" in section_ids
        assert all(p["sourceDocumentId"] == "doc-001" for p in provenance)
        assert all(p["provenanceType"] == "source_passage" for p in provenance)


class TestModelRunRecording:
    """Test that model run is properly recorded."""

    @patch("src.tasks.essay_generation_tasks.nestjs_client")
    @patch("src.tasks.essay_generation_tasks.rag_client")
    @patch("src.tasks.essay_generation_tasks.db")
    @patch("src.tasks.essay_generation_tasks.validate_derivative")
    def test_10_model_run_recorded(
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
        mock_rag.generate_completion.return_value = FAKE_RAG_RESPONSE
        mock_validate.return_value = DerivativeValidationResult(
            verdict=DerivativeVerdict.PUBLISH, checks=[], reasons=[],
        )
        mock_nestjs.write_essay.return_value = {
            "artifactId": "art-001",
            "essayPromptId": "essay-001",
        }
        mock_nestjs.update_job_status.return_value = True

        _run_task("job-001", "doc-001")

        mock_db.create_model_run.assert_called_once()
        call_kwargs = mock_db.create_model_run.call_args
        assert call_kwargs.kwargs["run_type"] == "essay_prompt_generation"
        assert call_kwargs.kwargs["model_name"] == "gpt-4o-mini"
        assert call_kwargs.kwargs["prompt_template_version"] == PROMPT_TEMPLATE_VERSION
        assert call_kwargs.kwargs["input_ref"] == "doc:doc-001"
        assert call_kwargs.kwargs["confidence"] > 0.0  # computed, not hardcoded
