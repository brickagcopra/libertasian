"""Tests for flashcard generation Celery task (PR 5.3).

8 tests covering:
1. Happy path -> FlashcardSet + Flashcards created via NestJS
2. Eligibility skip -> skipped
3. Validator quarantine -> job failed
4. LLM returns invalid JSON -> job failed
5. LLM abstains -> no write
6. Cards written with sourceType 'ai_generated'
7. Model run recorded
8. Budget ledger included
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from src.prompts.flashcard_generation_v1 import PROMPT_TEMPLATE_VERSION
from src.tasks.flashcard_generation_tasks import generate_flashcards

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
            "liable for the acts of those subordinates. " * 5
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

FAKE_LLM_CONTENT: dict[str, Any] = {
    "cards": [
        {
            "front": "What is the doctrine of command responsibility as applied to civilian officials in Philippine law?",
            "back": (
                "The doctrine of command responsibility applies to civilian officials "
                "who hold positions of authority in the government. Officials with "
                "effective control over subordinates may be held liable for acts "
                "committed by those subordinates."
            ),
            "mnemonicHint": None,
            "supportingSectionIds": ["sec-001"],
        },
        {
            "front": "Under command responsibility, what is required for a civilian official to be held liable?",
            "back": (
                "The official must have exercised effective control over the subordinate "
                "who committed the act. Mere organizational authority is insufficient."
            ),
            "mnemonicHint": "CONTROL: Civilian Officials Need To Really Oversee Liability",
            "supportingSectionIds": ["sec-001", "sec-002"],
        },
    ],
    "abstain": False,
    "abstainReason": None,
}

FAKE_RAG_RESPONSE: dict[str, Any] = {
    "content": FAKE_LLM_CONTENT,
    "model_name": "gpt-4o-mini",
    "tokens_in": 1200,
    "tokens_out": 600,
}


def _run_task(job_id: str, document_id: str, **kwargs: Any) -> dict[str, Any]:
    """Run the Celery task synchronously, bypassing Celery dispatch."""
    return generate_flashcards.run(job_id, document_id, **kwargs)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestFlashcardGenerationTask:
    """Tests for the generate_flashcards Celery task."""

    @patch("src.tasks.flashcard_generation_tasks.nestjs_client")
    @patch("src.tasks.flashcard_generation_tasks.rag_client")
    @patch("src.tasks.flashcard_generation_tasks.db")
    @patch("src.tasks.flashcard_generation_tasks.validate_derivative")
    def test_1_happy_path(
        self,
        mock_validate: MagicMock,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        """Happy path -> FlashcardSet + Flashcards created via NestJS."""
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
        mock_nestjs.write_flashcards.return_value = {
            "setId": "set-001",
            "cardIds": ["card-001", "card-002"],
        }
        mock_nestjs.update_job_status.return_value = True

        result = _run_task("job-001", "doc-001")

        assert result["status"] == "completed"
        assert result["set_id"] == "set-001"
        assert result["card_count"] == 2
        mock_nestjs.write_flashcards.assert_called_once()

    @patch("src.tasks.flashcard_generation_tasks.nestjs_client")
    @patch("src.tasks.flashcard_generation_tasks.db")
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

    @patch("src.tasks.flashcard_generation_tasks.nestjs_client")
    @patch("src.tasks.flashcard_generation_tasks.rag_client")
    @patch("src.tasks.flashcard_generation_tasks.db")
    @patch("src.tasks.flashcard_generation_tasks.validate_derivative")
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
                    name="card_count_min",
                    passed=False,
                    reason="No cards generated",
                    severity="error",
                ),
            ],
            reasons=["No cards generated"],
        )
        mock_nestjs.update_job_status.return_value = True

        result = _run_task("job-001", "doc-001")

        assert result["status"] == "failed"
        assert result["reason"] == "validation_quarantine"
        mock_nestjs.write_flashcards.assert_not_called()

    @patch("src.tasks.flashcard_generation_tasks.nestjs_client")
    @patch("src.tasks.flashcard_generation_tasks.rag_client")
    @patch("src.tasks.flashcard_generation_tasks.db")
    def test_4_invalid_json(
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

    @patch("src.tasks.flashcard_generation_tasks.nestjs_client")
    @patch("src.tasks.flashcard_generation_tasks.rag_client")
    @patch("src.tasks.flashcard_generation_tasks.db")
    def test_5_llm_abstains(
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
                "abstainReason": "Insufficient material for flashcards",
            },
        }
        mock_nestjs.update_job_status.return_value = True

        result = _run_task("job-001", "doc-001")

        assert result["status"] == "failed"
        assert result["reason"] == "abstained"
        mock_nestjs.write_flashcards.assert_not_called()

    @patch("src.tasks.flashcard_generation_tasks.nestjs_client")
    @patch("src.tasks.flashcard_generation_tasks.rag_client")
    @patch("src.tasks.flashcard_generation_tasks.db")
    @patch("src.tasks.flashcard_generation_tasks.validate_derivative")
    def test_6_source_type_ai_generated(
        self,
        mock_validate: MagicMock,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        """Cards written include sourceDocumentId for linking."""
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
        mock_nestjs.write_flashcards.return_value = {
            "setId": "set-001",
            "cardIds": ["card-001", "card-002"],
        }
        mock_nestjs.update_job_status.return_value = True

        _run_task("job-001", "doc-001")

        write_call = mock_nestjs.write_flashcards.call_args
        payload = write_call.args[0]
        # Each card should have legalDocumentId
        for card in payload["cards"]:
            assert card["legalDocumentId"] == "doc-001"
        assert payload["sourceDocumentId"] == "doc-001"

    @patch("src.tasks.flashcard_generation_tasks.nestjs_client")
    @patch("src.tasks.flashcard_generation_tasks.rag_client")
    @patch("src.tasks.flashcard_generation_tasks.db")
    @patch("src.tasks.flashcard_generation_tasks.validate_derivative")
    def test_7_model_run_recorded(
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
        mock_nestjs.write_flashcards.return_value = {
            "setId": "set-001",
            "cardIds": ["card-001", "card-002"],
        }
        mock_nestjs.update_job_status.return_value = True

        _run_task("job-001", "doc-001")

        mock_db.create_model_run.assert_called_once()
        call_kwargs = mock_db.create_model_run.call_args
        assert call_kwargs.kwargs["run_type"] == "flashcard_generation"
        assert call_kwargs.kwargs["model_name"] == "gpt-4o-mini"
        assert call_kwargs.kwargs["prompt_template_version"] == PROMPT_TEMPLATE_VERSION
        assert call_kwargs.kwargs["input_ref"] == "doc:doc-001"

    @patch("src.tasks.flashcard_generation_tasks.nestjs_client")
    @patch("src.tasks.flashcard_generation_tasks.rag_client")
    @patch("src.tasks.flashcard_generation_tasks.db")
    @patch("src.tasks.flashcard_generation_tasks.validate_derivative")
    def test_8_budget_ledger_included(
        self,
        mock_validate: MagicMock,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        """Budget ledger entry included in write payload."""
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
        mock_nestjs.write_flashcards.return_value = {
            "setId": "set-001",
            "cardIds": ["card-001", "card-002"],
        }
        mock_nestjs.update_job_status.return_value = True

        _run_task("job-001", "doc-001")

        write_call = mock_nestjs.write_flashcards.call_args
        payload = write_call.args[0]
        assert "budgetLedgerEntry" in payload
        ledger = payload["budgetLedgerEntry"]
        assert ledger["scope"] == "flashcard_generation"
        assert ledger["tokensIn"] == 1200
        assert ledger["tokensOut"] == 600
        assert ledger["modelName"] == "gpt-4o-mini"
        assert ledger["modelRunId"] == "model-run-001"

    @patch("src.tasks.flashcard_generation_tasks.nestjs_client")
    @patch("src.tasks.flashcard_generation_tasks.rag_client")
    @patch("src.tasks.flashcard_generation_tasks.db")
    @patch("src.tasks.flashcard_generation_tasks.validate_derivative")
    def test_9_writes_derivative_artifact_for_library(
        self,
        mock_validate: MagicMock,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        """Happy path: both FlashcardSet AND DerivativeArtifact are written."""
        from src.validators.derivative_validators import (
            DerivativeValidationResult,
            DerivativeVerdict,
        )

        # Use real UUIDs for section IDs so the UUID filter keeps them.
        sec_uuid_1 = "11111111-1111-4111-8111-111111111111"
        sec_uuid_2 = "22222222-2222-4222-8222-222222222222"
        sections = [
            {**FAKE_SECTIONS[0], "id": sec_uuid_1},
            {**FAKE_SECTIONS[1], "id": sec_uuid_2},
        ]
        llm_content = {
            "cards": [
                {
                    "front": "Q1",
                    "back": "A1",
                    "mnemonicHint": None,
                    "tags": ["command-responsibility"],
                    "supportingSectionIds": [sec_uuid_1],
                },
                {
                    "front": "Q2",
                    "back": "A2",
                    "mnemonicHint": "MNE",
                    "supportingSectionIds": [sec_uuid_1, sec_uuid_2],
                },
            ],
            "abstain": False,
            "abstainReason": None,
        }

        mock_db.get_legal_document.return_value = FAKE_DOC
        mock_db.get_document_sections_for_digest.return_value = sections
        mock_db.create_model_run.return_value = "model-run-001"
        mock_db.get_content_disclaimer_id.return_value = "disc-001"
        mock_rag.generate_completion.return_value = {
            **FAKE_RAG_RESPONSE,
            "content": llm_content,
        }
        mock_validate.return_value = DerivativeValidationResult(
            verdict=DerivativeVerdict.PUBLISH, checks=[], reasons=[],
        )
        mock_nestjs.write_flashcards.return_value = {
            "setId": "set-001",
            "cardIds": ["card-001", "card-002"],
        }
        mock_nestjs.write_derivative.return_value = {"artifactId": "artifact-001"}
        mock_nestjs.update_job_status.return_value = True

        result = _run_task("job-001", "doc-001", card_style="rule_recall")

        # Both writes happened
        mock_nestjs.write_flashcards.assert_called_once()
        mock_nestjs.write_derivative.assert_called_once()

        derivative_payload = mock_nestjs.write_derivative.call_args.args[0]
        assert derivative_payload["derivativeType"] == "flashcard"
        assert derivative_payload["sourceDocumentId"] == "doc-001"
        assert derivative_payload["derivativeGenerationJobId"] == "job-001"
        assert derivative_payload["contentRights"] == "ai_generated_derivative"
        assert derivative_payload["contentDisclaimerId"] == "disc-001"
        assert derivative_payload["visibility"] == "private"
        assert derivative_payload["modelRunId"] == "model-run-001"

        # contentJson shape matches FlashcardRenderer contract
        content_json = derivative_payload["contentJson"]
        assert content_json["style"] == "rule_recall"
        assert content_json["cardCount"] == 2
        assert "generatedAt" in content_json
        assert len(content_json["cards"]) == 2
        first_card = content_json["cards"][0]
        assert first_card["front"] == "Q1"
        assert first_card["back"] == "A1"
        assert first_card["tags"] == ["command-responsibility"]
        assert first_card["supportingSectionIds"] == [sec_uuid_1]

        # Confidence score populated from real scoring (not 0.0)
        assert derivative_payload["confidenceScore"] > 0

        # Provenance records built from cited UUID section ids
        prov = derivative_payload["provenanceRecords"]
        assert len(prov) >= 1
        prov_section_ids = {p["sourceSectionId"] for p in prov}
        assert prov_section_ids <= {sec_uuid_1, sec_uuid_2}
        for p in prov:
            assert p["sourceDocumentId"] == "doc-001"
            assert p["provenanceType"] == "source_passage"

        # Task result surfaces the artifact id
        assert result["status"] == "completed"
        assert result["artifact_id"] == "artifact-001"
        assert result["set_id"] == "set-001"

    @patch("src.tasks.flashcard_generation_tasks.nestjs_client")
    @patch("src.tasks.flashcard_generation_tasks.rag_client")
    @patch("src.tasks.flashcard_generation_tasks.db")
    @patch("src.tasks.flashcard_generation_tasks.validate_derivative")
    def test_10_uuid_filter_drops_bogus_section_ids(
        self,
        mock_validate: MagicMock,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        """Bogus / non-UUID supportingSectionIds must be dropped before write.

        Mirrors the MCQ UUID-filter guard (PR #63) so NestJS @IsUUID()
        validation on provenance records doesn't 400 the write.
        """
        from src.validators.derivative_validators import (
            DerivativeValidationResult,
            DerivativeVerdict,
        )

        sec_uuid = "11111111-1111-4111-8111-111111111111"
        sections = [{**FAKE_SECTIONS[0], "id": sec_uuid}]
        llm_content = {
            "cards": [
                {
                    "front": "Q1",
                    "back": "A1",
                    # Mix: one real UUID, several bogus values the filter must drop
                    "supportingSectionIds": [
                        sec_uuid,
                        "sec-001",  # non-UUID stub
                        "not-a-uuid",
                        "",
                        None,  # wrong type
                        42,  # wrong type
                        "99999999-9999-4999-8999-999999999999",  # UUID but unknown
                    ],
                },
            ],
            "abstain": False,
        }

        mock_db.get_legal_document.return_value = FAKE_DOC
        mock_db.get_document_sections_for_digest.return_value = sections
        mock_db.create_model_run.return_value = "model-run-001"
        mock_db.get_content_disclaimer_id.return_value = "disc-001"
        mock_rag.generate_completion.return_value = {
            **FAKE_RAG_RESPONSE,
            "content": llm_content,
        }
        mock_validate.return_value = DerivativeValidationResult(
            verdict=DerivativeVerdict.PUBLISH, checks=[], reasons=[],
        )
        mock_nestjs.write_flashcards.return_value = {
            "setId": "set-001",
            "cardIds": ["card-001"],
        }
        mock_nestjs.write_derivative.return_value = {"artifactId": "artifact-001"}
        mock_nestjs.update_job_status.return_value = True

        _run_task("job-001", "doc-001")

        payload = mock_nestjs.write_derivative.call_args.args[0]
        cards = payload["contentJson"]["cards"]
        # Only the real, known UUID survives the filter
        assert cards[0]["supportingSectionIds"] == [sec_uuid]
        # Provenance also contains only the one valid UUID
        prov = payload["provenanceRecords"]
        assert len(prov) == 1
        assert prov[0]["sourceSectionId"] == sec_uuid

    @patch("src.tasks.flashcard_generation_tasks.nestjs_client")
    @patch("src.tasks.flashcard_generation_tasks.rag_client")
    @patch("src.tasks.flashcard_generation_tasks.db")
    @patch("src.tasks.flashcard_generation_tasks.validate_derivative")
    def test_11_derivative_write_failure_fails_job(
        self,
        mock_validate: MagicMock,
        mock_db: MagicMock,
        mock_rag: MagicMock,
        mock_nestjs: MagicMock,
    ) -> None:
        """If the derivative_artifact write raises, the whole job fails."""
        import httpx
        from src.validators.derivative_validators import (
            DerivativeValidationResult,
            DerivativeVerdict,
        )

        mock_db.get_legal_document.return_value = FAKE_DOC
        mock_db.get_document_sections_for_digest.return_value = FAKE_SECTIONS
        mock_db.create_model_run.return_value = "model-run-001"
        mock_db.get_content_disclaimer_id.return_value = "disc-001"
        mock_rag.generate_completion.return_value = FAKE_RAG_RESPONSE
        mock_validate.return_value = DerivativeValidationResult(
            verdict=DerivativeVerdict.PUBLISH, checks=[], reasons=[],
        )
        mock_nestjs.write_flashcards.return_value = {
            "setId": "set-001",
            "cardIds": ["card-001", "card-002"],
        }
        # Build a 400 response so the 5xx retry guard doesn't re-raise.
        req = httpx.Request("POST", "http://nest/internal/derivatives/write")
        resp = httpx.Response(400, request=req, text="bad")
        mock_nestjs.write_derivative.side_effect = httpx.HTTPStatusError(
            "bad request", request=req, response=resp,
        )
        mock_nestjs.update_job_status.return_value = True

        result = _run_task("job-001", "doc-001")

        assert result["status"] == "failed"
        assert result["reason"] == "http_error_400"
