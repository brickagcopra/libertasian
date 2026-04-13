"""Tests for doctrine extraction generation Celery task (PR 4.3B).

12 tests covering:
1. Happy path — LLM returns valid doctrines -> validator passes -> NestJS write called
2. Eligibility skip — low confidence -> skipped
3. Validator quarantine — missing verbatim text -> job failed
4. Validator quarantine — invalid doctrine type -> job failed
5. Validator human_review — > 5 doctrines -> writes with needs_human_review
6. Validator human_review — verbatim not found in source -> human_review
7. Validator human_review — > 3 related links -> human_review
8. LLM returns invalid JSON -> job failed
9. Abstain -> no write
10. Verbatim match — exact substring found -> passes
11. Verbatim match — slight whitespace difference -> passes (normalized)
12. Verbatim match — completely different text -> fails
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from src.tasks.doctrine_generation_tasks import (
    PROMPT_TEMPLATE_VERSION,
    _build_doctrine_entries,
    _build_provenance_records,
    generate_doctrine_extract,
)
from src.validators.derivative_validators import (
    DerivativeValidationResult,
    DerivativeVerdict,
    ValidatorCheck,
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
    "confidence_score": 0.9,
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

VALID_DOCTRINE_TEXT = (
    "The doctrine of command responsibility applies to civilian officials "
    "who hold positions of authority in the government requiring that officials "
    "exercising effective control over subordinates may be held liable for the acts."
)

VALID_VERBATIM = (
    "The doctrine of command responsibility applies to civilian officials "
    "who hold positions of authority in the government"
)

VALID_LLM_CONTENT: dict[str, Any] = {
    "doctrines": [
        {
            "text": VALID_DOCTRINE_TEXT,
            "verbatimSourceText": VALID_VERBATIM,
            "sectionId": "sec-001",
            "doctrineType": "rule",
            "relatedDoctrines": [],
        },
    ],
    "abstain": False,
    "abstainReason": None,
}

FAKE_LLM_RESPONSE: dict[str, Any] = {
    "content": VALID_LLM_CONTENT,
    "model_name": "gpt-4o-mini",
    "tokens_in": 1500,
    "tokens_out": 800,
}


def _run_task(job_id: str, document_id: str) -> dict[str, Any]:
    """Run generate_doctrine_extract using .run() to bypass Celery dispatch."""
    return generate_doctrine_extract.run(job_id, document_id)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestGenerateDoctrineExtract:
    """Tests for the generate_doctrine_extract Celery task."""

    @patch("src.tasks.doctrine_generation_tasks.nestjs_client")
    @patch("src.tasks.doctrine_generation_tasks.rag_client")
    @patch("src.tasks.doctrine_generation_tasks.db")
    @patch("src.tasks.doctrine_generation_tasks.validate_derivative")
    def test_1_happy_path(
        self,
        mock_validate: MagicMock,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        """Happy path: LLM returns valid doctrines -> validator passes -> NestJS write -> completed."""
        mock_db.get_legal_document.return_value = FAKE_DOC
        mock_db.get_document_sections_for_digest.return_value = FAKE_SECTIONS
        mock_db.create_model_run.return_value = "model-run-001"
        mock_rag.generate_completion.return_value = FAKE_LLM_RESPONSE
        mock_validate.return_value = DerivativeValidationResult(
            verdict=DerivativeVerdict.PUBLISH,
            checks=[],
            reasons=[],
        )
        mock_nestjs.write_doctrines.return_value = {
            "artifactId": "artifact-001",
            "doctrineIds": ["doctrine-001"],
        }
        mock_nestjs.update_job_status.return_value = True

        result = _run_task("job-001", "doc-001")

        assert result["status"] == "completed"
        assert result["artifact_id"] == "artifact-001"
        assert result["doctrine_ids"] == ["doctrine-001"]
        mock_nestjs.write_doctrines.assert_called_once()
        # Verify job was marked running then completed
        calls = mock_nestjs.update_job_status.call_args_list
        assert calls[0].args == ("job-001", "running")
        assert calls[-1].args[0] == "job-001"
        assert calls[-1].args[1] == "completed"

    @patch("src.tasks.doctrine_generation_tasks.nestjs_client")
    @patch("src.tasks.doctrine_generation_tasks.db")
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

    @patch("src.tasks.doctrine_generation_tasks.nestjs_client")
    @patch("src.tasks.doctrine_generation_tasks.rag_client")
    @patch("src.tasks.doctrine_generation_tasks.db")
    @patch("src.tasks.doctrine_generation_tasks.validate_derivative")
    def test_3_validator_quarantine_missing_verbatim(
        self,
        mock_validate: MagicMock,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        """Validator quarantine: missing verbatim text -> job failed, no write."""
        mock_db.get_legal_document.return_value = FAKE_DOC
        mock_db.get_document_sections_for_digest.return_value = FAKE_SECTIONS
        mock_rag.generate_completion.return_value = FAKE_LLM_RESPONSE
        mock_validate.return_value = DerivativeValidationResult(
            verdict=DerivativeVerdict.QUARANTINE,
            checks=[
                ValidatorCheck(
                    name="doctrine_0_verbatim_present",
                    passed=False,
                    reason="Missing verbatimSourceText",
                    severity="error",
                ),
            ],
            reasons=["Missing verbatimSourceText"],
        )
        mock_nestjs.update_job_status.return_value = True

        result = _run_task("job-001", "doc-001")

        assert result["status"] == "failed"
        assert result["reason"] == "validation_quarantine"
        mock_nestjs.write_doctrines.assert_not_called()

    @patch("src.tasks.doctrine_generation_tasks.nestjs_client")
    @patch("src.tasks.doctrine_generation_tasks.rag_client")
    @patch("src.tasks.doctrine_generation_tasks.db")
    @patch("src.tasks.doctrine_generation_tasks.validate_derivative")
    def test_4_validator_quarantine_invalid_type(
        self,
        mock_validate: MagicMock,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        """Validator quarantine: invalid doctrine type -> job failed."""
        mock_db.get_legal_document.return_value = FAKE_DOC
        mock_db.get_document_sections_for_digest.return_value = FAKE_SECTIONS
        mock_rag.generate_completion.return_value = FAKE_LLM_RESPONSE
        mock_validate.return_value = DerivativeValidationResult(
            verdict=DerivativeVerdict.QUARANTINE,
            checks=[
                ValidatorCheck(
                    name="doctrine_0_type",
                    passed=False,
                    reason="Doctrine type 'invalid' not in allow-list",
                    severity="error",
                ),
            ],
            reasons=["Invalid doctrine type"],
        )
        mock_nestjs.update_job_status.return_value = True

        result = _run_task("job-001", "doc-001")

        assert result["status"] == "failed"
        assert result["reason"] == "validation_quarantine"
        mock_nestjs.write_doctrines.assert_not_called()

    @patch("src.tasks.doctrine_generation_tasks.nestjs_client")
    @patch("src.tasks.doctrine_generation_tasks.rag_client")
    @patch("src.tasks.doctrine_generation_tasks.db")
    @patch("src.tasks.doctrine_generation_tasks.validate_derivative")
    def test_5_validator_human_review_over_5_doctrines(
        self,
        mock_validate: MagicMock,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        """Validator human_review: > 5 doctrines -> writes with needs_human_review."""
        mock_db.get_legal_document.return_value = FAKE_DOC
        mock_db.get_document_sections_for_digest.return_value = FAKE_SECTIONS
        mock_db.create_model_run.return_value = "model-run-001"
        mock_rag.generate_completion.return_value = FAKE_LLM_RESPONSE
        mock_validate.return_value = DerivativeValidationResult(
            verdict=DerivativeVerdict.HUMAN_REVIEW,
            checks=[
                ValidatorCheck(
                    name="fanout_cap",
                    passed=False,
                    reason="Doctrine count 6 (max 5)",
                    severity="warning",
                ),
            ],
            reasons=["Doctrine count 6 (max 5)"],
        )
        mock_nestjs.write_doctrines.return_value = {
            "artifactId": "artifact-001",
            "doctrineIds": ["doctrine-001"],
        }
        mock_nestjs.update_job_status.return_value = True

        result = _run_task("job-001", "doc-001")

        assert result["status"] == "completed"
        assert result["review_status"] == "needs_human_review"
        write_call = mock_nestjs.write_doctrines.call_args
        assert write_call.args[0]["reviewStatus"] == "needs_human_review"

    @patch("src.tasks.doctrine_generation_tasks.nestjs_client")
    @patch("src.tasks.doctrine_generation_tasks.rag_client")
    @patch("src.tasks.doctrine_generation_tasks.db")
    @patch("src.tasks.doctrine_generation_tasks.validate_derivative")
    def test_6_validator_human_review_verbatim_not_found(
        self,
        mock_validate: MagicMock,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        """Validator human_review: verbatim not found in source -> human_review."""
        mock_db.get_legal_document.return_value = FAKE_DOC
        mock_db.get_document_sections_for_digest.return_value = FAKE_SECTIONS
        mock_db.create_model_run.return_value = "model-run-001"
        mock_rag.generate_completion.return_value = FAKE_LLM_RESPONSE
        mock_validate.return_value = DerivativeValidationResult(
            verdict=DerivativeVerdict.HUMAN_REVIEW,
            checks=[
                ValidatorCheck(
                    name="doctrine_0_verbatim_match",
                    passed=False,
                    reason="Verbatim text NOT found in source sections",
                    severity="warning",
                ),
            ],
            reasons=["Verbatim text NOT found"],
        )
        mock_nestjs.write_doctrines.return_value = {
            "artifactId": "artifact-001",
            "doctrineIds": ["doctrine-001"],
        }
        mock_nestjs.update_job_status.return_value = True

        result = _run_task("job-001", "doc-001")

        assert result["status"] == "completed"
        assert result["review_status"] == "needs_human_review"

    @patch("src.tasks.doctrine_generation_tasks.nestjs_client")
    @patch("src.tasks.doctrine_generation_tasks.rag_client")
    @patch("src.tasks.doctrine_generation_tasks.db")
    @patch("src.tasks.doctrine_generation_tasks.validate_derivative")
    def test_7_validator_human_review_over_3_related(
        self,
        mock_validate: MagicMock,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        """Validator human_review: > 3 related links -> human_review."""
        mock_db.get_legal_document.return_value = FAKE_DOC
        mock_db.get_document_sections_for_digest.return_value = FAKE_SECTIONS
        mock_db.create_model_run.return_value = "model-run-001"
        mock_rag.generate_completion.return_value = FAKE_LLM_RESPONSE
        mock_validate.return_value = DerivativeValidationResult(
            verdict=DerivativeVerdict.HUMAN_REVIEW,
            checks=[
                ValidatorCheck(
                    name="doctrine_0_related_cap",
                    passed=False,
                    reason="Related links 4 (max 3)",
                    severity="warning",
                ),
            ],
            reasons=["Related links 4 (max 3)"],
        )
        mock_nestjs.write_doctrines.return_value = {
            "artifactId": "artifact-001",
            "doctrineIds": ["doctrine-001"],
        }
        mock_nestjs.update_job_status.return_value = True

        result = _run_task("job-001", "doc-001")

        assert result["status"] == "completed"
        assert result["review_status"] == "needs_human_review"

    @patch("src.tasks.doctrine_generation_tasks.nestjs_client")
    @patch("src.tasks.doctrine_generation_tasks.rag_client")
    @patch("src.tasks.doctrine_generation_tasks.db")
    def test_8_invalid_json(
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

    @patch("src.tasks.doctrine_generation_tasks.nestjs_client")
    @patch("src.tasks.doctrine_generation_tasks.rag_client")
    @patch("src.tasks.doctrine_generation_tasks.db")
    def test_9_abstain_no_write(
        self,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        """Abstain -> no write, job failed."""
        mock_db.get_legal_document.return_value = FAKE_DOC
        mock_db.get_document_sections_for_digest.return_value = FAKE_SECTIONS
        mock_rag.generate_completion.return_value = {
            **FAKE_LLM_RESPONSE,
            "content": {
                "doctrines": [],
                "abstain": True,
                "abstainReason": "No doctrinal holdings",
            },
        }
        mock_nestjs.update_job_status.return_value = True

        result = _run_task("job-001", "doc-001")

        assert result["status"] == "failed"
        assert result["reason"] == "abstained"
        mock_nestjs.write_doctrines.assert_not_called()


class TestVerbatimMatching:
    """Tests for verbatim text matching in the validator (exercised via the full validator)."""

    def test_10_exact_substring_found(self) -> None:
        """Verbatim match: exact substring found -> passes."""
        from src.validators.derivative_validators.doctrine_extract_validator import (
            _check_verbatim_match,
            _normalize_whitespace,
        )

        section_texts = {"sec-001": _normalize_whitespace(SECTION_TEXT)}

        # Exact substring of source text
        verbatim = "The doctrine of command responsibility applies to civilian officials"
        assert _check_verbatim_match(verbatim, section_texts) is True

    def test_11_whitespace_normalized(self) -> None:
        """Verbatim match: slight whitespace difference -> passes (normalized)."""
        from src.validators.derivative_validators.doctrine_extract_validator import (
            _check_verbatim_match,
            _normalize_whitespace,
        )

        section_texts = {"sec-001": _normalize_whitespace(SECTION_TEXT)}

        # Whitespace differences that normalize away
        verbatim = "The  doctrine  of  command  responsibility  applies  to  civilian  officials"
        assert _check_verbatim_match(verbatim, section_texts) is True

    def test_12_completely_different_fails(self) -> None:
        """Verbatim match: completely different text -> fails."""
        from src.validators.derivative_validators.doctrine_extract_validator import (
            _check_verbatim_match,
            _normalize_whitespace,
        )

        section_texts = {"sec-001": _normalize_whitespace(SECTION_TEXT)}

        # Completely unrelated text
        verbatim = "This text has absolutely nothing to do with the source document"
        assert _check_verbatim_match(verbatim, section_texts) is False


class TestHelperFunctions:
    """Tests for helper functions."""

    def test_build_provenance_records(self) -> None:
        """Provenance records built from doctrine sectionIds."""
        content = {
            "doctrines": [
                {"sectionId": "sec-001"},
                {"sectionId": "sec-002"},
            ],
        }
        provenance = _build_provenance_records(content, "doc-001", FAKE_SECTIONS)

        assert len(provenance) == 2
        assert provenance[0]["sourceDocumentId"] == "doc-001"
        assert provenance[0]["sourceSectionId"] == "sec-001"
        assert provenance[0]["provenanceType"] == "source_passage"

    def test_build_doctrine_entries(self) -> None:
        """Doctrine entries built correctly."""
        entries = _build_doctrine_entries(VALID_LLM_CONTENT)

        assert len(entries) == 1
        assert entries[0]["text"] == VALID_DOCTRINE_TEXT
        assert entries[0]["doctrineType"] == "rule"
        assert entries[0]["sectionId"] == "sec-001"
