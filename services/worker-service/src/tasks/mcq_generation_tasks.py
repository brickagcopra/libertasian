"""MCQ generation — LLM-based multiple-choice question generation with validation.

PR 5.1: Celery task that generates bar-review-quality MCQs from Philippine
legal documents. Results are validated per-question by McqQuestionValidator
and written as individual DerivativeArtifact + McqQuestion + McqOptions
via the NestJS internal endpoint (POST /internal/derivatives/write-mcq-batch).

KEY DIFFERENCE from digest/doctrine: MCQ produces MULTIPLE artifacts per LLM
call. Each passing question becomes its own DerivativeArtifact + McqQuestion
+ McqOptions. Failing questions are recorded in the job's errorJson but not
persisted.

Per CLAUDE.md:
- Celery tasks must be idempotent (acks_late + reject_on_worker_lost)
- Pin model versions in model_runs for audit
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from typing import Any

import httpx
from celery import shared_task

from ..clients import ingestion_db_client as db
from ..clients import nestjs_client
from ..clients import rag_client
from ..prompts.mcq_generation_v1 import (
    MCQ_GENERATION_SYSTEM_PROMPT,
    PROMPT_TEMPLATE_VERSION,
    build_user_prompt,
)
from ..scoring import compute_mcq_confidence_score
from ..validators.derivative_validators import (
    DerivativeVerdict,
    LegalDocumentSectionSnapshot,
    LegalDocumentSnapshot,
    validate_derivative,
)
from ..validators.derivative_validators.eligibility import check_eligibility
from ..validators.derivative_validators.mcq_question_validator import (
    McqQuestionValidationResult,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Celery task
# ---------------------------------------------------------------------------


@shared_task(
    bind=True,
    name="derivatives.generate_mcq",
    acks_late=True,
    reject_on_worker_lost=True,
    max_retries=2,
    retry_backoff=True,
    retry_backoff_max=300,
)
def generate_mcq_questions(
    self: Any,
    job_id: str,
    document_id: str,
    question_count: int = 5,
    difficulty: str = "medium",
) -> dict[str, Any]:
    """Generate MCQ questions for a legal document.

    KEY DIFFERENCE from digest/doctrine: MCQ produces MULTIPLE artifacts.
    Each passing question becomes its own DerivativeArtifact + McqQuestion
    + McqOptions. Failing questions are recorded in the job's errorJson
    but not persisted.

    Steps:
    1. Update job status -> running
    2. Load source document + sections
    3. Check eligibility
    4. Build prompt
    5. Call LLM (temperature=0.2 for MCQ to get some variety)
    6. Parse JSON
    7. Run McqQuestionValidator (per-question validation)
    8. For each passing question: write via NestJS internal endpoint
    9. Update job status with counts
    """
    logger.info(
        "generate_mcq_questions: job_id=%s document_id=%s count=%d difficulty=%s",
        job_id,
        document_id,
        question_count,
        difficulty,
    )

    # Step 1: Idempotency guard — claim job atomically
    if not db.claim_derivative_job(job_id):
        logger.info("Job %s already claimed or in terminal state, skipping", job_id)
        return {"job_id": job_id, "status": "already_claimed"}

    try:
        # Resolve content disclaimer ID at task start
        content_disclaimer_id = db.get_content_disclaimer_id("ai_mcq")

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
            sections=sections_with_text,
            question_count=question_count,
            difficulty=difficulty,
        )

        # Step 5: Call LLM (temperature=0.2 for some variety in MCQs)
        start_time = time.monotonic()
        llm_response = rag_client.generate_completion(
            system_prompt=MCQ_GENERATION_SYSTEM_PROMPT,
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

        # Step 7: Validate with McqQuestionValidator
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
            derivative_type="mcq_question",
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
        confidence_score = compute_mcq_confidence_score(
            content=content,
            source_sections=sections_with_text,
        )

        # Step 9: Record model run
        model_run_id = db.create_model_run(
            run_type="mcq_generation",
            model_name=model_name,
            prompt_template_version=PROMPT_TEMPLATE_VERSION,
            input_ref=f"doc:{document_id}",
            output_ref=f"job:{job_id}",
            confidence=confidence_score,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            latency_ms=latency_ms,
        )

        # Build passing question entries from per-question results
        per_question_results: list[McqQuestionValidationResult] = content.get(
            "_per_question_results", [],
        )
        questions = content.get("questions", [])

        source_section_id_set = {s["id"] for s in sections_with_text}
        passing_questions = _build_passing_question_entries(
            questions, per_question_results, source_section_id_set,
        )
        failed_questions = _build_failed_question_entries(
            questions, per_question_results,
        )

        if not passing_questions:
            _fail_job(job_id, "No questions passed validation", model_name=model_name)
            return {
                "status": "failed",
                "reason": "all_questions_failed",
                "failed_questions": failed_questions,
            }

        # Build NestJS write payload
        write_payload: dict[str, Any] = {
            "sourceDocumentId": document_id,
            "contentJson": {
                k: v for k, v in content.items()
                if k != "_per_question_results"
            },
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
            "questions": passing_questions,
            "budgetLedgerEntry": {
                "periodYearMonth": _current_period_year_month(),
                "scope": "mcq_generation",
                "amountUsd": 0.0,
                "tokensIn": tokens_in,
                "tokensOut": tokens_out,
                "modelName": model_name,
                "modelRunId": model_run_id,
            },
        }

        # Write to NestJS
        result = nestjs_client.write_mcq_batch(write_payload)
        artifact_ids = result.get("artifactIds", [])
        question_ids = result.get("questionIds", [])

        # Build error json for failed questions
        error_json: dict[str, Any] | None = None
        if failed_questions:
            error_json = {"failedQuestions": failed_questions}

        # Update job -> completed
        update_kwargs: dict[str, Any] = {
            "promptTemplateVersion": PROMPT_TEMPLATE_VERSION,
            "modelName": model_name,
            "tokensIn": tokens_in,
            "tokensOut": tokens_out,
        }
        if error_json:
            update_kwargs["errorJson"] = error_json

        nestjs_client.update_job_status(job_id, "completed", **update_kwargs)

        logger.info(
            "Completed MCQ generation: job=%s artifacts=%d questions=%d failed=%d status=%s",
            job_id,
            len(artifact_ids),
            len(question_ids),
            len(failed_questions),
            review_status,
        )

        return {
            "status": "completed",
            "artifact_ids": artifact_ids,
            "question_ids": question_ids,
            "passed_count": len(passing_questions),
            "failed_count": len(failed_questions),
            "review_status": review_status,
            "validator_verdict": validation_result.verdict.value,
        }

    except httpx.HTTPStatusError as exc:
        logger.error(
            "HTTP error in generate_mcq_questions: job=%s status=%d body=%s",
            job_id,
            exc.response.status_code,
            exc.response.text[:500],
        )
        _fail_job(job_id, f"HTTP error: {exc.response.status_code}")
        return {"status": "failed", "reason": f"http_error_{exc.response.status_code}"}

    except Exception as exc:
        logger.error(
            "generate_mcq_questions failed: job=%s error=%s",
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


def _build_passing_question_entries(
    questions: list[dict[str, Any]],
    per_question_results: list[McqQuestionValidationResult],
    source_section_ids: set[str] | None = None,
) -> list[dict[str, Any]]:
    """Build question entries for questions that passed validation.

    If ``source_section_ids`` is provided, ``supportingSectionIds`` on
    each question is filtered to only keep strings that (a) parse as
    UUIDs and (b) exist in the source section set. This guards NestJS
    from LLM stubs like ``"1"`` / ``"bogus"`` that would otherwise
    trigger a 400 on the write endpoint.
    """
    entries: list[dict[str, Any]] = []
    for pqr in per_question_results:
        if not pqr.passed:
            continue
        if pqr.index >= len(questions):
            continue
        q = questions[pqr.index]
        # Map option fields: label, text, isCorrect, rationale
        options = []
        for o in q.get("options", []):
            options.append({
                "label": o.get("label", ""),
                "text": o.get("text", ""),
                "isCorrect": o.get("isCorrect", False),
                "rationale": o.get("rationale", ""),
            })
        raw_sids = q.get("supportingSectionIds", []) or []
        filtered_sids: list[str] = []
        for sid in raw_sids:
            if not isinstance(sid, str):
                continue
            try:
                uuid.UUID(sid)
            except (ValueError, AttributeError, TypeError):
                continue
            if source_section_ids is not None and sid not in source_section_ids:
                continue
            filtered_sids.append(sid)
        entries.append({
            "questionStem": q.get("questionStem", ""),
            "explanation": q.get("explanation", ""),
            "difficulty": q.get("difficultySelfReport", "medium"),
            "questionFormat": "single_best",
            "options": options,
            "supportingSectionIds": filtered_sids,
        })
    return entries


def _build_failed_question_entries(
    questions: list[dict[str, Any]],
    per_question_results: list[McqQuestionValidationResult],
) -> list[dict[str, Any]]:
    """Build entries for failed questions (for errorJson recording)."""
    entries: list[dict[str, Any]] = []
    for pqr in per_question_results:
        if pqr.passed:
            continue
        stem = ""
        if pqr.index < len(questions):
            stem = questions[pqr.index].get("questionStem", "")[:100]
        entries.append({
            "index": pqr.index,
            "verdict": pqr.verdict,
            "reasons": pqr.reasons,
            "stem_preview": stem,
        })
    return entries


def _current_period_year_month() -> str:
    """Return current year-month string for budget ledger."""
    import datetime

    return datetime.datetime.now(tz=datetime.timezone.utc).strftime("%Y-%m")
