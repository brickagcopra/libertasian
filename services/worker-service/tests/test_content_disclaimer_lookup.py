"""Tests for content disclaimer ID lookup helper (Bug 1 fix).

Tests:
1. Returns correct UUID when DB row exists
2. Raises ValueError when no matching row exists
3. Caches result — second call does not hit DB
4. Essay task sends looked-up ID in write payload (not placeholder)
5. Doctrine task sends looked-up ID in write payload
6. MCQ task sends looked-up ID in write payload
7. Outline task sends looked-up ID in write payload
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock, call, patch

import pytest

from src.clients.ingestion_db_client import (
    _disclaimer_id_cache,
    get_content_disclaimer_id,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

REAL_ESSAY_DISCLAIMER_ID = "d0ef8498-5b69-45ea-9a24-3eb1eb73f16e"
REAL_MCQ_DISCLAIMER_ID = "5cfb8a3a-b944-4468-8a03-3437c3066121"
REAL_DIGEST_DISCLAIMER_ID = "e08adba5-f79b-48af-9aa9-074ff711010e"


@pytest.fixture(autouse=True)
def _clear_disclaimer_cache() -> None:
    """Clear the module-scope cache before each test."""
    _disclaimer_id_cache.clear()


# ---------------------------------------------------------------------------
# get_content_disclaimer_id unit tests
# ---------------------------------------------------------------------------


class TestGetContentDisclaimerId:
    """Unit tests for the disclaimer lookup helper."""

    @patch("src.clients.ingestion_db_client.get_connection")
    def test_1_returns_uuid_when_row_exists(
        self, mock_get_conn: MagicMock,
    ) -> None:
        """Returns correct UUID when DB row exists."""
        mock_cursor = MagicMock()
        mock_cursor.fetchone.return_value = (REAL_ESSAY_DISCLAIMER_ID,)
        mock_conn = MagicMock()
        mock_conn.__enter__ = MagicMock(return_value=mock_conn)
        mock_conn.__exit__ = MagicMock(return_value=False)
        mock_conn.cursor.return_value.__enter__ = MagicMock(return_value=mock_cursor)
        mock_conn.cursor.return_value.__exit__ = MagicMock(return_value=False)
        mock_get_conn.return_value = mock_conn

        result = get_content_disclaimer_id("ai_essay_model_answer")

        assert result == REAL_ESSAY_DISCLAIMER_ID
        mock_cursor.execute.assert_called_once()
        sql = mock_cursor.execute.call_args.args[0]
        assert "content_disclaimers" in sql
        assert "content_class" in sql

    @patch("src.clients.ingestion_db_client.get_connection")
    def test_2_raises_when_no_row_found(
        self, mock_get_conn: MagicMock,
    ) -> None:
        """Raises ValueError when no matching row exists."""
        mock_cursor = MagicMock()
        mock_cursor.fetchone.return_value = None
        mock_conn = MagicMock()
        mock_conn.__enter__ = MagicMock(return_value=mock_conn)
        mock_conn.__exit__ = MagicMock(return_value=False)
        mock_conn.cursor.return_value.__enter__ = MagicMock(return_value=mock_cursor)
        mock_conn.cursor.return_value.__exit__ = MagicMock(return_value=False)
        mock_get_conn.return_value = mock_conn

        with pytest.raises(ValueError, match="No active content_disclaimers row"):
            get_content_disclaimer_id("nonexistent_class")

    @patch("src.clients.ingestion_db_client.get_connection")
    def test_3_caches_result(
        self, mock_get_conn: MagicMock,
    ) -> None:
        """Second call returns cached value without hitting DB."""
        mock_cursor = MagicMock()
        mock_cursor.fetchone.return_value = (REAL_MCQ_DISCLAIMER_ID,)
        mock_conn = MagicMock()
        mock_conn.__enter__ = MagicMock(return_value=mock_conn)
        mock_conn.__exit__ = MagicMock(return_value=False)
        mock_conn.cursor.return_value.__enter__ = MagicMock(return_value=mock_cursor)
        mock_conn.cursor.return_value.__exit__ = MagicMock(return_value=False)
        mock_get_conn.return_value = mock_conn

        result1 = get_content_disclaimer_id("ai_mcq")
        result2 = get_content_disclaimer_id("ai_mcq")

        assert result1 == REAL_MCQ_DISCLAIMER_ID
        assert result2 == REAL_MCQ_DISCLAIMER_ID
        # DB was only hit once
        assert mock_cursor.execute.call_count == 1


# ---------------------------------------------------------------------------
# Task integration: verify write payloads use looked-up disclaimer ID
# ---------------------------------------------------------------------------


FAKE_DOC: dict[str, Any] = {
    "id": "doc-001",
    "title": "Republic v. Sandiganbayan",
    "short_title": "Republic v. Sandiganbayan",
    "document_type": "case",
    "citation_text": "G.R. No. 123456",
    "court": "Supreme Court",
    "ponente": "Justice Cruz",
    "decision_date": "2025-01-01",
    "subject": "Criminal Law",
    "is_official": True,
}

FAKE_SECTIONS: list[dict[str, Any]] = [
    {
        "id": "sec-001",
        "section_type": "body",
        "section_label": "Decision",
        "plain_text": "The doctrine of command responsibility " * 50,
        "page_start": 1,
        "page_end": 5,
    },
]


class TestEssayDisclaimerInPayload:
    """Verify the essay task sends the looked-up disclaimer ID."""

    @patch("src.tasks.essay_generation_tasks.nestjs_client")
    @patch("src.tasks.essay_generation_tasks.rag_client")
    @patch("src.tasks.essay_generation_tasks.db")
    @patch("src.tasks.essay_generation_tasks.validate_derivative")
    def test_4_essay_payload_uses_looked_up_id(
        self,
        mock_validate: MagicMock,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        """Essay write payload contains the looked-up disclaimer ID, not placeholder."""
        from src.validators.derivative_validators import (
            DerivativeValidationResult,
            DerivativeVerdict,
        )
        from src.tasks.essay_generation_tasks import generate_essay_prompt

        mock_db.get_content_disclaimer_id.return_value = REAL_ESSAY_DISCLAIMER_ID
        mock_db.get_legal_document.return_value = FAKE_DOC
        mock_db.get_document_sections_for_digest.return_value = FAKE_SECTIONS
        mock_db.create_model_run.return_value = "model-run-001"
        mock_rag.generate_completion.return_value = {
            "content": {
                "promptText": "Discuss liability under command responsibility." + " word" * 50,
                "suggestedTimeMinutes": 30,
                "modelAnswer": {"outlineSections": [
                    {"heading": "Answer", "paragraphs": ["Test"], "citedSectionIds": ["sec-001"]},
                    {"heading": "Law", "paragraphs": ["Test"], "citedSectionIds": ["sec-001"]},
                    {"heading": "Application", "paragraphs": ["Test"], "citedSectionIds": []},
                    {"heading": "Conclusion", "paragraphs": ["Test"], "citedSectionIds": []},
                ]},
                "rubric": {"totalPoints": 100, "criteria": [
                    {"name": "A", "maxPoints": 50, "description": "x"},
                    {"name": "B", "maxPoints": 50, "description": "y"},
                ]},
                "abstain": False,
            },
            "model_name": "gpt-4o-mini",
            "tokens_in": 100,
            "tokens_out": 200,
        }
        mock_validate.return_value = DerivativeValidationResult(
            verdict=DerivativeVerdict.PUBLISH, checks=[], reasons=[],
        )
        mock_nestjs.write_essay.return_value = {
            "artifactId": "art-001", "essayPromptId": "essay-001",
        }
        mock_nestjs.update_job_status.return_value = True

        result = generate_essay_prompt.run("job-001", "doc-001")

        assert result["status"] == "completed"
        # Verify the disclaimer lookup was called with correct content_class
        mock_db.get_content_disclaimer_id.assert_called_once_with("ai_essay_model_answer")
        # Verify the write payload has the real UUID
        write_call = mock_nestjs.write_essay.call_args
        payload = write_call.args[0]
        assert payload["contentDisclaimerId"] == REAL_ESSAY_DISCLAIMER_ID
        assert payload["contentDisclaimerId"] != "00000000-0000-0000-0000-000000000001"

    @patch("src.tasks.doctrine_generation_tasks.nestjs_client")
    @patch("src.tasks.doctrine_generation_tasks.rag_client")
    @patch("src.tasks.doctrine_generation_tasks.db")
    @patch("src.tasks.doctrine_generation_tasks.validate_derivative")
    def test_5_doctrine_payload_uses_looked_up_id(
        self,
        mock_validate: MagicMock,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        """Doctrine write payload contains the looked-up disclaimer ID."""
        from src.validators.derivative_validators import (
            DerivativeValidationResult,
            DerivativeVerdict,
        )
        from src.tasks.doctrine_generation_tasks import generate_doctrine_extract

        mock_db.get_content_disclaimer_id.return_value = REAL_DIGEST_DISCLAIMER_ID
        mock_db.get_legal_document.return_value = FAKE_DOC
        mock_db.get_document_sections_for_digest.return_value = FAKE_SECTIONS
        mock_db.create_model_run.return_value = "model-run-001"
        mock_rag.extract_doctrines.return_value = {
            "document_id": "doc-001",
            "doctrines": [{
                "text": "Command responsibility applies to civilians.",
                "normalized_text": "Command responsibility applies to civilians.",
                "doctrine_type": "ratio_decidendi",
                "source_section_id": "sec-001",
                "confidence": 0.9,
            }],
            "strategy_used": "sections_only",
            "model_name": "gpt-4o-mini",
        }
        mock_validate.return_value = DerivativeValidationResult(
            verdict=DerivativeVerdict.PUBLISH, checks=[], reasons=[],
        )
        mock_nestjs.write_doctrines.return_value = {
            "artifactId": "art-001", "doctrineIds": ["doc-001"],
        }
        mock_nestjs.update_job_status.return_value = True

        result = generate_doctrine_extract.run("job-001", "doc-001")

        assert result["status"] == "completed"
        mock_db.get_content_disclaimer_id.assert_called_once_with("ai_digest")
        write_call = mock_nestjs.write_doctrines.call_args
        payload = write_call.args[0]
        assert payload["contentDisclaimerId"] == REAL_DIGEST_DISCLAIMER_ID

    @patch("src.tasks.mcq_generation_tasks.nestjs_client")
    @patch("src.tasks.mcq_generation_tasks.rag_client")
    @patch("src.tasks.mcq_generation_tasks.db")
    @patch("src.tasks.mcq_generation_tasks.validate_derivative")
    def test_6_mcq_payload_uses_looked_up_id(
        self,
        mock_validate: MagicMock,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        """MCQ write payload contains the looked-up disclaimer ID."""
        from src.validators.derivative_validators import (
            DerivativeValidationResult,
            DerivativeVerdict,
        )
        from src.tasks.mcq_generation_tasks import generate_mcq_questions
        from src.validators.derivative_validators.mcq_question_validator import (
            McqQuestionValidationResult,
        )

        mock_db.get_content_disclaimer_id.return_value = REAL_MCQ_DISCLAIMER_ID
        mock_db.get_legal_document.return_value = FAKE_DOC
        mock_db.get_document_sections_for_digest.return_value = FAKE_SECTIONS
        mock_db.create_model_run.return_value = "model-run-001"
        mock_rag.generate_completion.return_value = {
            "content": {
                "questions": [{
                    "questionStem": "What is command responsibility?",
                    "explanation": "Test explanation",
                    "difficultySelfReport": "medium",
                    "options": [
                        {"label": "A", "text": "Correct", "isCorrect": True, "rationale": "R"},
                        {"label": "B", "text": "Wrong 1", "isCorrect": False, "rationale": "R"},
                        {"label": "C", "text": "Wrong 2", "isCorrect": False, "rationale": "R"},
                        {"label": "D", "text": "Wrong 3", "isCorrect": False, "rationale": "R"},
                    ],
                    "supportingSectionIds": ["sec-001"],
                }],
                "_per_question_results": [
                    McqQuestionValidationResult(index=0, passed=True, verdict="publish", checks=[], reasons=[]),
                ],
                "abstain": False,
            },
            "model_name": "gpt-4o-mini",
            "tokens_in": 100,
            "tokens_out": 200,
        }
        mock_validate.return_value = DerivativeValidationResult(
            verdict=DerivativeVerdict.PUBLISH, checks=[], reasons=[],
        )
        mock_nestjs.write_mcq_batch.return_value = {
            "artifactIds": ["art-001"], "questionIds": ["q-001"],
        }
        mock_nestjs.update_job_status.return_value = True

        result = generate_mcq_questions.run("job-001", "doc-001")

        assert result["status"] == "completed"
        mock_db.get_content_disclaimer_id.assert_called_once_with("ai_mcq")
        write_call = mock_nestjs.write_mcq_batch.call_args
        payload = write_call.args[0]
        assert payload["contentDisclaimerId"] == REAL_MCQ_DISCLAIMER_ID
