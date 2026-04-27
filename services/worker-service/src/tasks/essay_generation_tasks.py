"""Essay prompt generation — LLM-based essay question + ALAC model answer generation.

PR 5.2: Celery task that generates bar-review-quality essay questions with
ALAC-format (Answer/Law/Application/Conclusion) model answers from Philippine
legal documents. Results are validated by EssayPromptValidator and written as
DerivativeArtifact + EssayPrompt via the NestJS internal endpoint
(POST /internal/derivatives/write-essay).

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
from ..clients import nestjs_client, rag_client
from ..pricing import cost_for
from ..prompts.essay_generation_v1 import (
    ESSAY_GENERATION_SYSTEM_PROMPT,
    PROMPT_TEMPLATE_VERSION,
    build_user_prompt,
)
from ..scoring import compute_essay_confidence_score
from ..validators.derivative_validators import (
    DerivativeVerdict,
    LegalDocumentSectionSnapshot,
    LegalDocumentSnapshot,
    validate_derivative,
)
from ..validators.derivative_validators.eligibility import check_eligibility

logger = logging.getLogger(__name__)

# Confidence threshold for auto-approval (from §4.4)
CONFIDENCE_THRESHOLD = 0.7


# ---------------------------------------------------------------------------
# Celery task
# ---------------------------------------------------------------------------


@shared_task(
    bind=True,
    name="derivatives.generate_essay_prompt",
    acks_late=True,
    reject_on_worker_lost=True,
    max_retries=2,
    retry_backoff=True,
    retry_backoff_max=300,
)
def generate_essay_prompt(
    self: Any,
    job_id: str,
    document_id: str,
    source_type: str = "decision",
    bar_exam_sitting_id: str | None = None,
    audience: str = "student",
    backfill_batch_id: str | None = None,
) -> dict[str, Any]:
    """Generate an essay prompt with ALAC model answer.

    Steps:
    1. Update job status -> running
    2. Load source document + sections
    3. Check eligibility
    4. Build prompt
    5. Call LLM (temperature=0.2)
    6. Parse JSON
    7. Run EssayPromptValidator
    8. Record model run
    9. Write via NestJS internal endpoint
    10. Update job status
    """
    logger.info(
        "generate_essay_prompt: job_id=%s document_id=%s source_type=%s",
        job_id,
        document_id,
        source_type,
    )

    # Step 1: Idempotency guard — claim job atomically
    if not db.claim_derivative_job(job_id):
        logger.info("Job %s already claimed or in terminal state, skipping", job_id)
        return {"job_id": job_id, "status": "already_claimed"}

    try:
        # Resolve content disclaimer ID at task start
        content_disclaimer_id = db.get_content_disclaimer_id("ai_essay_model_answer")

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
            court=doc.get("court"),
            decision_date=str(doc.get("decision_date")) if doc.get("decision_date") else None,
            subject=doc.get("subject"),
            source_type=source_type,
            sections=sections_with_text,
            audience=audience,
        )

        # Step 5: Call LLM (temperature=0.2)
        start_time = time.monotonic()
        llm_response = rag_client.generate_completion(
            system_prompt=ESSAY_GENERATION_SYSTEM_PROMPT,
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

        # Step 7: Validate with EssayPromptValidator
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
            derivative_type="essay_prompt",
            content=content,
            source_document=source_doc_snapshot,
            source_sections=section_snapshots,
        )

        # Step 8: Determine action based on verdict
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

        # Determine review status
        if validation_result.verdict == DerivativeVerdict.HUMAN_REVIEW:
            review_status = "needs_human_review"
        else:
            review_status = "draft"

        # Compute confidence score from source coverage + citation mapping
        confidence_score = compute_essay_confidence_score(
            content=content,
            source_sections=sections_with_text,
        )

        # Step 9: Record model run
        model_run_id = db.create_model_run(
            run_type="essay_prompt_generation",
            model_name=model_name,
            prompt_template_version=PROMPT_TEMPLATE_VERSION,
            input_ref=f"doc:{document_id}",
            output_ref=f"job:{job_id}",
            confidence=confidence_score,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            latency_ms=latency_ms,
        )

        # Build provenance records from model answer cited sections
        provenance_records = _build_provenance_records(
            content, document_id, sections_with_text,
        )

        # Build NestJS write payload
        write_payload: dict[str, Any] = {
            "sourceDocumentId": document_id,
            "promptText": content.get("promptText", ""),
            "suggestedTimeMinutes": content.get("suggestedTimeMinutes"),
            "modelAnswerJson": content.get("modelAnswer"),
            "rubricJson": content.get("rubric"),
            "barExamSittingId": bar_exam_sitting_id,
            "contentJson": content,
            "contentRights": "ai_generated_derivative",
            "contentDisclaimerId": content_disclaimer_id,
            "reviewStatus": review_status,
            "validatorVerdict": validation_result.verdict.value,
            "validatorReasonsJson": {
                "checks": [
                    {
                        "name": c.name,
                        "passed": c.passed,
                        "reason": c.reason,
                        "severity": c.severity,
                    }
                    for c in validation_result.checks
                ],
            },
            "confidenceScore": confidence_score,
            "modelRunId": model_run_id,
            "derivativeGenerationJobId": job_id,
            "provenanceRecords": provenance_records,
            "budgetLedgerEntry": {
                "periodYearMonth": _current_period_year_month(),
                "scope": "essay_prompt_generation",
                "amountUsd": float(cost_for(model_name, tokens_in, tokens_out)),
                "tokensIn": tokens_in,
                "tokensOut": tokens_out,
                "modelName": model_name,
                "modelRunId": model_run_id,
            },
        }

        # Step 10: Write to NestJS
        result = nestjs_client.write_essay(write_payload)
        artifact_id = result.get("artifactId")
        essay_prompt_id = result.get("essayPromptId")

        # Update job -> completed
        nestjs_client.update_job_status(
            job_id, "completed",
            promptTemplateVersion=PROMPT_TEMPLATE_VERSION,
            modelName=model_name,
            tokensIn=tokens_in,
            tokensOut=tokens_out,
        )

        # Per-batch cost telemetry. Same atomic-increment pattern used by
        # doctrine/digest tasks — see doctrine_tasks.extract_doctrines_task
        # for the rationale (cost-attribution to backfill batch's
        # budget_consumed_usd counter).
        if backfill_batch_id:
            try:
                from ..clients import backfill_db_client as backfill_db

                cost = cost_for(model_name, tokens_in, tokens_out)
                if cost > 0:
                    backfill_db.update_batch_counters(
                        backfill_batch_id,
                        budget_consumed_usd=cost,
                    )
            except Exception:
                logger.exception(
                    "Failed to update backfill batch %s budget_consumed_usd "
                    "from essay task (non-blocking)",
                    backfill_batch_id,
                )

        logger.info(
            "Completed essay prompt generation: job=%s artifact=%s essay=%s status=%s",
            job_id,
            artifact_id,
            essay_prompt_id,
            review_status,
        )

        return {
            "status": "completed",
            "artifact_id": artifact_id,
            "essay_prompt_id": essay_prompt_id,
            "review_status": review_status,
            "validator_verdict": validation_result.verdict.value,
        }

    except httpx.HTTPStatusError as exc:
        logger.error(
            "HTTP error in generate_essay_prompt: job=%s status=%d body=%s",
            job_id,
            exc.response.status_code,
            exc.response.text[:500],
        )
        _fail_job(job_id, f"HTTP error: {exc.response.status_code}")
        return {"status": "failed", "reason": f"http_error_{exc.response.status_code}"}

    except Exception as exc:
        logger.error(
            "generate_essay_prompt failed: job=%s error=%s",
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


def _build_provenance_records(
    content: dict[str, Any],
    document_id: str,
    sections: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Build provenance records from model answer cited section IDs."""
    section_ids = {s["id"] for s in sections}
    provenance: list[dict[str, Any]] = []
    seen: set[str] = set()

    # Collect all citedSectionIds from model answer outline sections
    model_answer = content.get("modelAnswer")
    if model_answer:
        for outline_section in model_answer.get("outlineSections", []):
            for sid in outline_section.get("citedSectionIds", []):
                if sid and sid in section_ids and sid not in seen:
                    seen.add(sid)
                    provenance.append({
                        "sourceDocumentId": document_id,
                        "sourceSectionId": sid,
                        "provenanceType": "source_passage",
                    })

    # Ensure at least one provenance record
    if not provenance and sections:
        provenance.append({
            "sourceDocumentId": document_id,
            "sourceSectionId": sections[0]["id"],
            "provenanceType": "source_passage",
        })

    return provenance


def _current_period_year_month() -> str:
    """Return current year-month string for budget ledger."""
    return datetime.datetime.now(tz=datetime.UTC).strftime("%Y-%m")
