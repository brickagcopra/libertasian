"""Tests for MCQ generation Celery task (PR 5.1C).

10 tests covering:
1. Happy path — LLM returns 5 valid MCQs -> 5 artifacts written
2. Partial pass — 3 of 5 pass validation -> 3 written, 2 in errorJson
3. All fail validation -> job failed, nothing written
4. Eligibility skip -> skipped_ineligible
5. LLM returns invalid JSON -> job failed
6. LLM abstains -> no write
7. Prompt building — correct metadata substitution
8. Prompt building — sections truncated to ~800 words each
9. Budget ledger entry included in write call
10. Model run recorded
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from src.tasks.mcq_generation_tasks import (
    PROMPT_TEMPLATE_VERSION,
    _build_passing_question_entries,
    _build_failed_question_entries,
    generate_mcq_questions,
)
from src.validators.derivative_validators import (
    DerivativeValidationResult,
    DerivativeVerdict,
    ValidatorCheck,
)
from src.validators.derivative_validators.mcq_question_validator import (
    McqQuestionValidationResult,
)

# ---------------------------------------------------------------------------
# Fixtures & Helpers
# ---------------------------------------------------------------------------

SECTION_TEXT = (
    "The doctrine of command responsibility applies to civilian officials "
    "who hold positions of authority in the government. This principle requires "
    "that officials exercising effective control over subordinates may be held "
    "liable for the acts of those subordinates when they fail to prevent or punish "
    "such acts. The standard applies regardless of whether the superior directly "
    "ordered the illegal act. The Court further held that the duty of diligence "
    "extends to all branches of the executive department and applies with equal "
    "force to both military and civilian chains of command in the Philippines."
)

FAKE_DOC: dict[str, Any] = {
    "id": "doc-001",
    "title": "Republic v. Sandiganbayan",
    "short_title": "Republic v. Sandiganbayan",
    "document_type": "case",
    "citation_text": "G.R. No. 123456, January 1, 2025",
    "court": "Supreme Court",
    "ponente": "Justice Cruz",
    "decision_date": "2025-01-01",
    "is_official": True,
    "subject": "Criminal Law",
}

FAKE_SECTIONS: list[dict[str, Any]] = [
    {
        "id": "sec-001",
        "section_type": "body",
        "section_label": "Decision",
        "plain_text": SECTION_TEXT,
        "page_start": 1,
        "page_end": 5,
        "ordering": 0,
    },
    {
        "id": "sec-002",
        "section_type": "body",
        "section_label": "Dispositive",
        "plain_text": "WHEREFORE, the petition is GRANTED. The decision is affirmed.",
        "page_start": 5,
        "page_end": 6,
        "ordering": 1,
    },
]

VALID_STEM = (
    "Under the doctrine of command responsibility as applied in Philippine "
    "jurisprudence, which of the following statements correctly describes "
    "the scope of liability of civilian officials exercising effective control?"
)

VALID_OPTIONS = [
    {"label": "A", "text": "Liability attaches only to military commanders.", "isCorrect": False, "rationale": "Wrong."},
    {"label": "B", "text": "Officials with effective control may be held liable.", "isCorrect": True, "rationale": "Correct."},
    {"label": "C", "text": "Only when the superior directly ordered the act.", "isCorrect": False, "rationale": "Wrong."},
    {"label": "D", "text": "Only the President can be held liable.", "isCorrect": False, "rationale": "Wrong."},
]

VALID_EXPLANATION = (
    "The doctrine holds civilian officials liable when they exercise effective "
    "control over subordinates. A direct order is not required."
)


def _make_question(index: int = 0) -> dict[str, Any]:
    return {
        "questionStem": VALID_STEM,
        "options": [dict(o) for o in VALID_OPTIONS],
        "explanation": VALID_EXPLANATION,
        "supportingSectionIds": ["sec-001"],
        "difficultySelfReport": "medium",
    }


VALID_LLM_CONTENT: dict[str, Any] = {
    "questions": [_make_question(i) for i in range(5)],
    "abstain": False,
    "abstainReason": None,
}

FAKE_LLM_RESPONSE: dict[str, Any] = {
    "content": VALID_LLM_CONTENT,
    "model_name": "gpt-4o-mini",
    "tokens_in": 2000,
    "tokens_out": 1500,
}


def _run_task(
    job_id: str,
    document_id: str,
    question_count: int = 5,
    difficulty: str = "medium",
) -> dict[str, Any]:
    """Run generate_mcq_questions using .run() to bypass Celery dispatch."""
    return generate_mcq_questions.run(job_id, document_id, question_count, difficulty)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestGenerateMcqQuestions:
    """Tests for the generate_mcq_questions Celery task."""

    @patch("src.tasks.mcq_generation_tasks.nestjs_client")
    @patch("src.tasks.mcq_generation_tasks.rag_client")
    @patch("src.tasks.mcq_generation_tasks.db")
    @patch("src.tasks.mcq_generation_tasks.validate_derivative")
    def test_1_happy_path_5_valid_mcqs(
        self,
        mock_validate: MagicMock,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        """Happy path: LLM returns 5 valid MCQs -> 5 artifacts written."""
        mock_db.get_legal_document.return_value = FAKE_DOC
        mock_db.get_document_sections_for_digest.return_value = FAKE_SECTIONS
        mock_db.create_model_run.return_value = "model-run-001"
        mock_rag.generate_completion.return_value = FAKE_LLM_RESPONSE

        # Simulate validator populating per-question results
        def side_effect_validate(**kwargs):
            content = kwargs["content"]
            per_results = [
                McqQuestionValidationResult(
                    index=i, passed=True, verdict="publish", checks=[], reasons=[],
                )
                for i in range(5)
            ]
            content["_per_question_results"] = per_results
            return DerivativeValidationResult(
                verdict=DerivativeVerdict.PUBLISH, checks=[], reasons=[],
            )

        mock_validate.side_effect = side_effect_validate
        mock_nestjs.write_mcq_batch.return_value = {
            "artifactIds": [f"artifact-{i}" for i in range(5)],
            "questionIds": [f"question-{i}" for i in range(5)],
        }
        mock_nestjs.update_job_status.return_value = True

        result = _run_task("job-001", "doc-001")

        assert result["status"] == "completed"
        assert len(result["artifact_ids"]) == 5
        assert len(result["question_ids"]) == 5
        assert result["passed_count"] == 5
        assert result["failed_count"] == 0
        mock_nestjs.write_mcq_batch.assert_called_once()
        # Verify the write payload has 5 questions
        write_call = mock_nestjs.write_mcq_batch.call_args
        assert len(write_call.args[0]["questions"]) == 5

    @patch("src.tasks.mcq_generation_tasks.nestjs_client")
    @patch("src.tasks.mcq_generation_tasks.rag_client")
    @patch("src.tasks.mcq_generation_tasks.db")
    @patch("src.tasks.mcq_generation_tasks.validate_derivative")
    def test_2_partial_pass_3_of_5(
        self,
        mock_validate: MagicMock,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        """Partial pass: 3 of 5 pass validation -> 3 written, 2 in errorJson."""
        mock_db.get_legal_document.return_value = FAKE_DOC
        mock_db.get_document_sections_for_digest.return_value = FAKE_SECTIONS
        mock_db.create_model_run.return_value = "model-run-001"
        mock_rag.generate_completion.return_value = FAKE_LLM_RESPONSE

        def side_effect_validate(**kwargs):
            content = kwargs["content"]
            per_results = [
                McqQuestionValidationResult(
                    index=0, passed=True, verdict="publish", checks=[], reasons=[],
                ),
                McqQuestionValidationResult(
                    index=1, passed=True, verdict="publish", checks=[], reasons=[],
                ),
                McqQuestionValidationResult(
                    index=2, passed=True, verdict="publish", checks=[], reasons=[],
                ),
                McqQuestionValidationResult(
                    index=3, passed=False, verdict="quarantine",
                    checks=[ValidatorCheck(name="q3_explanation", passed=False, reason="Explanation missing", severity="error")],
                    reasons=["Explanation missing"],
                ),
                McqQuestionValidationResult(
                    index=4, passed=False, verdict="quarantine",
                    checks=[ValidatorCheck(name="q4_option_count", passed=False, reason="Options: 3", severity="error")],
                    reasons=["Options: 3"],
                ),
            ]
            content["_per_question_results"] = per_results
            return DerivativeValidationResult(
                verdict=DerivativeVerdict.HUMAN_REVIEW,
                checks=[ValidatorCheck(name="q3_explanation", passed=False, reason="Explanation missing", severity="warning")],
                reasons=["Explanation missing"],
            )

        mock_validate.side_effect = side_effect_validate
        mock_nestjs.write_mcq_batch.return_value = {
            "artifactIds": ["a1", "a2", "a3"],
            "questionIds": ["q1", "q2", "q3"],
        }
        mock_nestjs.update_job_status.return_value = True

        result = _run_task("job-001", "doc-001")

        assert result["status"] == "completed"
        assert result["passed_count"] == 3
        assert result["failed_count"] == 2
        write_call = mock_nestjs.write_mcq_batch.call_args
        assert len(write_call.args[0]["questions"]) == 3

    @patch("src.tasks.mcq_generation_tasks.nestjs_client")
    @patch("src.tasks.mcq_generation_tasks.rag_client")
    @patch("src.tasks.mcq_generation_tasks.db")
    @patch("src.tasks.mcq_generation_tasks.validate_derivative")
    def test_3_all_fail_validation(
        self,
        mock_validate: MagicMock,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        """All fail validation -> job failed, nothing written."""
        mock_db.get_legal_document.return_value = FAKE_DOC
        mock_db.get_document_sections_for_digest.return_value = FAKE_SECTIONS
        mock_rag.generate_completion.return_value = FAKE_LLM_RESPONSE

        def side_effect_validate(**kwargs):
            content = kwargs["content"]
            per_results = [
                McqQuestionValidationResult(
                    index=i, passed=False, verdict="quarantine",
                    checks=[], reasons=["Failed"],
                )
                for i in range(5)
            ]
            content["_per_question_results"] = per_results
            return DerivativeValidationResult(
                verdict=DerivativeVerdict.QUARANTINE,
                checks=[ValidatorCheck(name="all_fail", passed=False, reason="All questions failed", severity="error")],
                reasons=["All questions failed"],
            )

        mock_validate.side_effect = side_effect_validate
        mock_nestjs.update_job_status.return_value = True

        result = _run_task("job-001", "doc-001")

        assert result["status"] == "failed"
        assert result["reason"] == "validation_quarantine"
        mock_nestjs.write_mcq_batch.assert_not_called()

    @patch("src.tasks.mcq_generation_tasks.nestjs_client")
    @patch("src.tasks.mcq_generation_tasks.db")
    def test_4_eligibility_skip(
        self,
        mock_db: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        """Eligibility skip: low confidence -> skipped_ineligible."""
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

    @patch("src.tasks.mcq_generation_tasks.nestjs_client")
    @patch("src.tasks.mcq_generation_tasks.rag_client")
    @patch("src.tasks.mcq_generation_tasks.db")
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
            **FAKE_LLM_RESPONSE,
            "content": "This is not JSON {broken",
        }
        mock_nestjs.update_job_status.return_value = True

        result = _run_task("job-001", "doc-001")

        assert result["status"] == "failed"
        assert result["reason"] == "invalid_json"

    @patch("src.tasks.mcq_generation_tasks.nestjs_client")
    @patch("src.tasks.mcq_generation_tasks.rag_client")
    @patch("src.tasks.mcq_generation_tasks.db")
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
            **FAKE_LLM_RESPONSE,
            "content": {
                "questions": [],
                "abstain": True,
                "abstainReason": "Insufficient doctrinal content",
            },
        }
        mock_nestjs.update_job_status.return_value = True

        result = _run_task("job-001", "doc-001")

        assert result["status"] == "failed"
        assert result["reason"] == "abstained"
        mock_nestjs.write_mcq_batch.assert_not_called()

    def test_7_prompt_building_metadata(self) -> None:
        """Prompt building: correct metadata substitution."""
        from src.prompts.mcq_generation_v1 import build_user_prompt

        prompt = build_user_prompt(
            title="Republic v. Sandiganbayan",
            citation="G.R. No. 123456",
            court="Supreme Court",
            decision_date="2025-01-01",
            subject="Criminal Law",
            sections=FAKE_SECTIONS,
            question_count=5,
            difficulty="hard",
        )

        assert "Republic v. Sandiganbayan" in prompt
        assert "G.R. No. 123456" in prompt
        assert "Supreme Court" in prompt
        assert "2025-01-01" in prompt
        assert "Criminal Law" in prompt
        assert "5 multiple-choice questions" in prompt
        assert "hard difficulty" in prompt

    def test_8_prompt_building_section_truncation(self) -> None:
        """Prompt building: sections truncated to ~800 words each."""
        from src.prompts.mcq_generation_v1 import build_sections_text, MAX_SECTION_WORDS

        long_section = {
            "id": "sec-long",
            "section_type": "body",
            "section_label": "Long Section",
            "plain_text": "word " * 1000,
        }

        text = build_sections_text([long_section])

        # Should be truncated to ~MAX_SECTION_WORDS words
        assert "[truncated]" in text
        # Count words after the header line
        lines = text.split("\n", 1)
        body_words = lines[1].split()
        # +1 for [truncated] marker
        assert len(body_words) <= MAX_SECTION_WORDS + 1

    @patch("src.tasks.mcq_generation_tasks.nestjs_client")
    @patch("src.tasks.mcq_generation_tasks.rag_client")
    @patch("src.tasks.mcq_generation_tasks.db")
    @patch("src.tasks.mcq_generation_tasks.validate_derivative")
    def test_9_budget_ledger_included(
        self,
        mock_validate: MagicMock,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        """Budget ledger entry included in write call."""
        mock_db.get_legal_document.return_value = FAKE_DOC
        mock_db.get_document_sections_for_digest.return_value = FAKE_SECTIONS
        mock_db.create_model_run.return_value = "model-run-001"
        mock_rag.generate_completion.return_value = FAKE_LLM_RESPONSE

        def side_effect_validate(**kwargs):
            content = kwargs["content"]
            per_results = [
                McqQuestionValidationResult(
                    index=i, passed=True, verdict="publish", checks=[], reasons=[],
                )
                for i in range(5)
            ]
            content["_per_question_results"] = per_results
            return DerivativeValidationResult(
                verdict=DerivativeVerdict.PUBLISH, checks=[], reasons=[],
            )

        mock_validate.side_effect = side_effect_validate
        mock_nestjs.write_mcq_batch.return_value = {
            "artifactIds": ["a1"], "questionIds": ["q1"],
        }
        mock_nestjs.update_job_status.return_value = True

        _run_task("job-001", "doc-001")

        write_call = mock_nestjs.write_mcq_batch.call_args
        payload = write_call.args[0]
        assert "budgetLedgerEntry" in payload
        assert payload["budgetLedgerEntry"]["scope"] == "mcq_generation"
        assert payload["budgetLedgerEntry"]["tokensIn"] == 2000
        assert payload["budgetLedgerEntry"]["tokensOut"] == 1500
        assert payload["budgetLedgerEntry"]["modelName"] == "gpt-4o-mini"

    @patch("src.tasks.mcq_generation_tasks.nestjs_client")
    @patch("src.tasks.mcq_generation_tasks.rag_client")
    @patch("src.tasks.mcq_generation_tasks.db")
    @patch("src.tasks.mcq_generation_tasks.validate_derivative")
    def test_10_model_run_recorded(
        self,
        mock_validate: MagicMock,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        """Model run recorded with correct parameters."""
        mock_db.get_legal_document.return_value = FAKE_DOC
        mock_db.get_document_sections_for_digest.return_value = FAKE_SECTIONS
        mock_db.create_model_run.return_value = "model-run-001"
        mock_rag.generate_completion.return_value = FAKE_LLM_RESPONSE

        def side_effect_validate(**kwargs):
            content = kwargs["content"]
            per_results = [
                McqQuestionValidationResult(
                    index=i, passed=True, verdict="publish", checks=[], reasons=[],
                )
                for i in range(5)
            ]
            content["_per_question_results"] = per_results
            return DerivativeValidationResult(
                verdict=DerivativeVerdict.PUBLISH, checks=[], reasons=[],
            )

        mock_validate.side_effect = side_effect_validate
        mock_nestjs.write_mcq_batch.return_value = {
            "artifactIds": ["a1"], "questionIds": ["q1"],
        }
        mock_nestjs.update_job_status.return_value = True

        _run_task("job-001", "doc-001")

        # Confidence is computed from real signals, with the short-source
        # taper applied: this fixture has 2 sections, so coverage carries only
        # 0.15 and the freed weight sits on citation mapping (0.51) and OCR
        # (0.34) — see resolve_weights().
        # coverage 1/2 + 5/5 questions cited + ocr 1.0
        # -> 0.5*0.15 + 1.0*0.51 + 1.0*0.34 = 0.925
        mock_db.create_model_run.assert_called_once_with(
            run_type="mcq_generation",
            model_name="gpt-4o-mini",
            prompt_template_version=PROMPT_TEMPLATE_VERSION,
            input_ref="doc:doc-001",
            output_ref="job:job-001",
            confidence=0.925,
            tokens_in=2000,
            tokens_out=1500,
            latency_ms=pytest.approx(0, abs=5000),  # timing varies
        )


class TestBuildPassingQuestionEntriesUuidFilter:
    """Guards NestJS from LLM stubs like "1"/"bogus" in supportingSectionIds."""

    _VALID_UUID = "00000000-0000-0000-0000-000000000030"

    def _make_per_question_result(self) -> McqQuestionValidationResult:
        return McqQuestionValidationResult(
            index=0, passed=True, verdict="publish", checks=[], reasons=[],
        )

    def test_mixed_ids_only_valid_uuid_survives(self) -> None:
        questions = [
            {
                "questionStem": VALID_STEM,
                "options": [dict(o) for o in VALID_OPTIONS],
                "explanation": VALID_EXPLANATION,
                "difficultySelfReport": "medium",
                "supportingSectionIds": ["1", self._VALID_UUID, "bogus"],
            },
        ]
        source_section_ids = {self._VALID_UUID}
        entries = _build_passing_question_entries(
            questions, [self._make_per_question_result()], source_section_ids,
        )
        assert len(entries) == 1
        assert entries[0]["supportingSectionIds"] == [self._VALID_UUID]

    def test_uuid_not_in_source_sections_dropped(self) -> None:
        other_uuid = "00000000-0000-0000-0000-0000000000ff"
        questions = [
            {
                "questionStem": VALID_STEM,
                "options": [dict(o) for o in VALID_OPTIONS],
                "explanation": VALID_EXPLANATION,
                "difficultySelfReport": "medium",
                "supportingSectionIds": [other_uuid, self._VALID_UUID],
            },
        ]
        source_section_ids = {self._VALID_UUID}
        entries = _build_passing_question_entries(
            questions, [self._make_per_question_result()], source_section_ids,
        )
        assert entries[0]["supportingSectionIds"] == [self._VALID_UUID]

    def test_non_string_entries_are_dropped(self) -> None:
        questions = [
            {
                "questionStem": VALID_STEM,
                "options": [dict(o) for o in VALID_OPTIONS],
                "explanation": VALID_EXPLANATION,
                "difficultySelfReport": "medium",
                "supportingSectionIds": [None, 42, self._VALID_UUID],
            },
        ]
        source_section_ids = {self._VALID_UUID}
        entries = _build_passing_question_entries(
            questions, [self._make_per_question_result()], source_section_ids,
        )
        assert entries[0]["supportingSectionIds"] == [self._VALID_UUID]
