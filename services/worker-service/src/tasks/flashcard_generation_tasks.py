"""Flashcard generation — LLM-based flashcard generation from legal documents.

PR 5.3: Celery task that generates spaced-repetition flashcards from
Philippine legal documents. Unlike other derivative types, flashcards
write to the EXISTING Flashcard + FlashcardSet tables (NOT DerivativeArtifact)
via a dedicated NestJS internal endpoint (POST /internal/derivatives/write-flashcards).

Per CLAUDE.md:
- Celery tasks must be idempotent (acks_late + reject_on_worker_lost)
- Pin model versions in model_runs for audit
"""

from __future__ import annotations

import datetime
import json
import logging
import time
from typing import Any

import httpx
from celery import shared_task

from ..clients import ingestion_db_client as db
from ..clients import nestjs_client
from ..clients import rag_client
from ..prompts.flashcard_generation_v1 import (
    FLASHCARD_GENERATION_SYSTEM_PROMPT,
    PROMPT_TEMPLATE_VERSION,
    build_user_prompt,
)
from ..validators.derivative_validators import (
    DerivativeVerdict,
    LegalDocumentSectionSnapshot,
    LegalDocumentSnapshot,
    validate_derivative,
)
from ..validators.derivative_validators.eligibility import check_eligibility

logger = logging.getLogger(__name__)


@shared_task(
    bind=True,
    name="derivatives.generate_flashcards",
    acks_late=True,
    reject_on_worker_lost=True,
    max_retries=2,
    retry_backoff=True,
    retry_backoff_max=300,
)
def generate_flashcards(
    self: Any,
    job_id: str,
    document_id: str,
    card_count: int = 5,
    card_style: str = "rule_recall",
    organization_id: str | None = None,
    user_id: str | None = None,
) -> dict[str, Any]:
    """Generate flashcards from a legal document.

    Unlike other derivative types, flashcards write to the EXISTING
    Flashcard + FlashcardSet tables, NOT DerivativeArtifact.

    Steps:
    1. Update job status -> running
    2. Load document + sections
    3. Check eligibility
    4. Build prompt
    5. Call LLM (temperature=0.2)
    6. Parse JSON
    7. Run FlashcardValidator
    8. Record model run
    9. Write via NestJS internal endpoint (creates FlashcardSet + Flashcards)
    10. Update job status
    """
    logger.info(
        "generate_flashcards: job_id=%s document_id=%s card_count=%d card_style=%s",
        job_id,
        document_id,
        card_count,
        card_style,
    )

    # Step 1: Update job -> running
    nestjs_client.update_job_status(job_id, "running")

    try:
        # Step 2: Load source document
        doc = db.get_legal_document(document_id)
        if not doc:
            _fail_job(job_id, f"Document {document_id} not found")
            return {"status": "failed", "reason": "document_not_found"}

        # Load sections
        sections = db.get_document_sections_for_digest(document_id)
        if not sections:
            _fail_job(job_id, f"No sections for document {document_id}")
            return {"status": "failed", "reason": "no_sections"}

        # Filter to sections with text
        sections_with_text = [
            s for s in sections
            if s.get("plain_text") and s["plain_text"].strip()
        ]
        if not sections_with_text:
            _fail_job(job_id, "No sections with text content")
            return {"status": "failed", "reason": "no_text_sections"}

        # Step 3: Check eligibility
        total_text_length = sum(
            len(s.get("plain_text", "")) for s in sections_with_text
        )
        eligibility = check_eligibility(
            confidence_score=doc.get("confidence_score"),
            total_plain_text_length=total_text_length,
        )
        if not eligibility.eligible:
            nestjs_client.update_job_status(
                job_id, "skipped_ineligible",
                errorJson={"reason": eligibility.skip_reason},
            )
            return {
                "status": "skipped_ineligible",
                "reason": eligibility.skip_reason,
            }

        # Step 4: Build prompt
        user_prompt = build_user_prompt(
            title=doc.get("title", ""),
            citation=doc.get("citation_text"),
            subject=doc.get("subject"),
            source_type=doc.get("document_type", "decision"),
            sections=sections_with_text,
            card_count=card_count,
            card_style=card_style,
        )

        # Step 5: Call LLM (temperature=0.2)
        start_time = time.monotonic()
        llm_response = rag_client.generate_completion(
            system_prompt=FLASHCARD_GENERATION_SYSTEM_PROMPT,
            user_prompt=user_prompt,
            temperature=0.2,
        )
        latency_ms = int((time.monotonic() - start_time) * 1000)

        model_name = llm_response.get("model_name", "unknown")
        tokens_in = llm_response.get("tokens_in", 0)
        tokens_out = llm_response.get("tokens_out", 0)

        # Step 6: Parse JSON output
        raw_content = llm_response.get("content")
        if isinstance(raw_content, str):
            try:
                content = json.loads(raw_content)
            except json.JSONDecodeError:
                _fail_job(job_id, "LLM returned invalid JSON", model_name=model_name)
                return {"status": "failed", "reason": "invalid_json"}
        elif isinstance(raw_content, dict):
            content = raw_content
        else:
            _fail_job(job_id, "LLM returned unexpected content type", model_name=model_name)
            return {"status": "failed", "reason": "unexpected_content_type"}

        # Check for abstention
        if content.get("abstain"):
            _fail_job(
                job_id,
                f"LLM abstained: {content.get('abstainReason', 'unknown')}",
                model_name=model_name,
            )
            return {"status": "failed", "reason": "abstained"}

        # Step 7: Validate with FlashcardValidator
        source_doc_snapshot = LegalDocumentSnapshot(
            id=document_id,
            title=doc.get("title", ""),
            document_type=doc.get("document_type", "case"),
            citation_text=doc.get("citation_text"),
            court=doc.get("court"),
            decision_date=str(doc.get("decision_date")) if doc.get("decision_date") else None,
            confidence_score=doc.get("confidence_score"),
        )
        section_snapshots = [
            LegalDocumentSectionSnapshot(
                id=s["id"],
                section_type=s.get("section_type", "body"),
                plain_text=s.get("plain_text", ""),
                page_start=s.get("page_start"),
                page_end=s.get("page_end"),
            )
            for s in sections_with_text
        ]

        validation_result = validate_derivative(
            derivative_type="flashcard",
            content=content,
            source_document=source_doc_snapshot,
            source_sections=section_snapshots,
        )

        if validation_result.verdict == DerivativeVerdict.QUARANTINE:
            _fail_job(
                job_id,
                f"Validation quarantine: {validation_result.reasons}",
                model_name=model_name,
            )
            return {
                "status": "failed",
                "reason": "validation_quarantine",
                "checks": [
                    {"name": c.name, "passed": c.passed, "reason": c.reason}
                    for c in validation_result.checks
                ],
            }

        # Step 8: Record model run
        model_run_id = db.create_model_run(
            run_type="flashcard_generation",
            model_name=model_name,
            prompt_template_version=PROMPT_TEMPLATE_VERSION,
            input_ref=f"doc:{document_id}",
            output_ref=f"job:{job_id}",
            confidence=0.0,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            latency_ms=latency_ms,
        )

        # Step 9: Write via NestJS internal endpoint
        cards = content.get("cards", [])
        write_payload: dict[str, Any] = {
            "title": f"Flashcards: {doc.get('title', document_id)[:80]}",
            "description": f"AI-generated flashcards from {doc.get('citation_text', document_id)}",
            "barSubject": doc.get("subject"),
            "visibility": "private",
            "organizationId": organization_id,
            "userId": user_id,
            "sourceDocumentId": document_id,
            "cards": [
                {
                    "front": c.get("front", ""),
                    "back": c.get("back", ""),
                    "mnemonicHint": c.get("mnemonicHint"),
                    "legalDocumentId": document_id,
                    "sectionId": c.get("supportingSectionIds", [None])[0] if c.get("supportingSectionIds") else None,
                }
                for c in cards
            ],
            "derivativeGenerationJobId": job_id,
            "modelRunId": model_run_id,
            "budgetLedgerEntry": {
                "periodYearMonth": _current_period_year_month(),
                "scope": "flashcard_generation",
                "amountUsd": 0.0,
                "tokensIn": tokens_in,
                "tokensOut": tokens_out,
                "modelName": model_name,
                "modelRunId": model_run_id,
            },
        }

        result = nestjs_client.write_flashcards(write_payload)
        set_id = result.get("setId")
        card_ids = result.get("cardIds", [])

        # Step 10: Update job -> completed
        nestjs_client.update_job_status(
            job_id, "completed",
            promptTemplateVersion=PROMPT_TEMPLATE_VERSION,
            modelName=model_name,
            tokensIn=tokens_in,
            tokensOut=tokens_out,
        )

        logger.info(
            "Completed flashcard generation: job=%s set=%s cards=%d",
            job_id,
            set_id,
            len(card_ids),
        )

        return {
            "status": "completed",
            "set_id": set_id,
            "card_ids": card_ids,
            "card_count": len(card_ids),
            "validator_verdict": validation_result.verdict.value,
        }

    except httpx.HTTPStatusError as exc:
        logger.error(
            "HTTP error in generate_flashcards: job=%s status=%d body=%s",
            job_id,
            exc.response.status_code,
            exc.response.text[:500],
        )
        _fail_job(job_id, f"HTTP error: {exc.response.status_code}")
        return {"status": "failed", "reason": f"http_error_{exc.response.status_code}"}

    except Exception as exc:
        logger.error(
            "generate_flashcards failed: job=%s error=%s",
            job_id,
            str(exc),
        )
        if self.request.retries < self.max_retries:
            raise self.retry(exc=exc)

        _fail_job(job_id, f"Max retries exceeded: {exc}")
        return {"status": "failed", "reason": str(exc)}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _fail_job(
    job_id: str,
    error_message: str,
    model_name: str | None = None,
) -> None:
    """Update job status to failed with error details."""
    kwargs: dict[str, Any] = {
        "errorJson": {"message": error_message},
    }
    if model_name:
        kwargs["modelName"] = model_name
    nestjs_client.update_job_status(job_id, "failed", **kwargs)


def _current_period_year_month() -> str:
    """Return current year-month string for budget ledger."""
    return datetime.datetime.now(tz=datetime.timezone.utc).strftime("%Y-%m")
