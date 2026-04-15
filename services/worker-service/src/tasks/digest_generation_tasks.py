"""Case digest generation — LLM call + validation + write to NestJS.

PR 3.2: Celery task that generates IRAC-format case digests using the
case_digest.v1 prompt template. Results are validated by CaseDigestValidator
and written to the digests table via NestJS internal endpoint (no dual-write
to derivative_artifacts).

Per CLAUDE.md:
- Celery tasks must be idempotent (acks_late + reject_on_worker_lost)
- Pin model versions in model_runs for audit
- Confidence < 0.7 and source is official -> pending_review
- Confidence < 0.7 and source is not official -> needs_human_review
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any

import httpx
from celery import shared_task

from ..clients import ingestion_db_client as db
from ..clients import nestjs_client
from ..clients import rag_client
from ..config import settings
from ..prompts.case_digest_v1 import (
    CASE_DIGEST_SYSTEM_PROMPT,
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

# Document types eligible for case digest generation
CASE_DOCUMENT_TYPES = {"case", "decision", "resolution", "en_banc"}

# Confidence threshold for auto-approval (official sources only)
CONFIDENCE_THRESHOLD = 0.7


@shared_task(
    bind=True,
    name="derivatives.generate_case_digest",
    acks_late=True,
    reject_on_worker_lost=True,
    max_retries=2,
    retry_backoff=True,
    retry_backoff_max=300,
)
def generate_case_digest(
    self: Any,
    job_id: str,
    document_id: str,
) -> dict[str, Any]:
    """Generate a case digest for a single legal document.

    Steps:
    1. Update job status -> running
    2. Check eligibility (confidence + text length)
    3. Load source document + sections from DB
    4. Build prompt context (case_digest.v1)
    5. Call LLM via RAG service
    6. Parse JSON output
    7. Run CaseDigestValidator
    8. Write result to NestJS internal endpoint (digests table)
    9. Update job status -> completed/failed
    """
    logger.info(
        "generate_case_digest: job_id=%s document_id=%s",
        job_id,
        document_id,
    )

    # Step 1: Idempotency guard — claim job atomically
    if not db.claim_derivative_job(job_id):
        logger.info("Job %s already claimed or in terminal state, skipping", job_id)
        return {"job_id": job_id, "status": "already_claimed"}

    try:
        # Step 3: Load source document
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

        # Step 2: Check eligibility
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
            decision_date=doc.get("decision_date"),
            ponente=doc.get("ponente"),
            sections=sections_with_text,
        )

        # Step 5: Call LLM
        start_time = time.monotonic()
        llm_response = rag_client.generate_digest(
            document_id=document_id,
            sections=sections_with_text,
            document_type=doc.get("document_type", "case"),
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

        # Step 7: Validate with CaseDigestValidator
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
            derivative_type="case_digest",
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
        confidence = content.get("confidenceSelfReport", 0.0)
        is_official = doc.get("is_official", False)

        if validation_result.verdict == DerivativeVerdict.HUMAN_REVIEW:
            review_status = "needs_human_review"
        elif confidence >= CONFIDENCE_THRESHOLD and is_official:
            review_status = "pending_review"
        else:
            review_status = "needs_human_review"

        # Step 9: Record model run
        model_run_id = db.create_model_run(
            run_type="case_digest_generation",
            model_name=model_name,
            prompt_template_version=PROMPT_TEMPLATE_VERSION,
            input_ref=f"doc:{document_id}",
            output_ref=f"job:{job_id}",
            confidence=confidence,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            latency_ms=latency_ms,
        )

        # Build provenance records from sectionUsage
        provenance_records = _build_provenance_records(
            content, document_id, sections_with_text,
        )

        # Build NestJS write payload
        doc_title = doc.get("short_title") or doc.get("title") or "Untitled"
        write_payload: dict[str, Any] = {
            "legalDocumentId": document_id,
            "title": f"Digest: {doc_title}",
            "sourceOrigin": "ai_generated",
            "facts": content.get("facts"),
            "issues": _format_issues(content.get("issues")),
            "ruling": content.get("ruling"),
            "doctrine": content.get("doctrine"),
            "dispositive": content.get("dispositive"),
            "summary": content.get("summary"),
            "petitionerArguments": content.get("petitionerArguments"),
            "respondentArguments": content.get("respondentArguments"),
            "citedAuthoritiesJson": content.get("citedAuthorities", []),
            "confidenceScore": confidence,
            "reviewStatus": review_status,
            "visibility": "private",
            "validatorVerdict": validation_result.verdict.value,
            "validatorReasonsJson": {
                "checks": [
                    {"name": c.name, "passed": c.passed, "reason": c.reason, "severity": c.severity}
                    for c in validation_result.checks
                ],
            },
            "modelRunId": model_run_id,
            "promptTemplateVersion": PROMPT_TEMPLATE_VERSION,
            "derivativeGenerationJobId": job_id,
            "sectionUsageJson": content.get("sectionUsage", []),
            "provenanceRecords": provenance_records,
        }

        # Write to NestJS
        result = nestjs_client.write_digest(write_payload)
        digest_id = result.get("digestId")

        # Update job -> completed
        nestjs_client.update_job_status(
            job_id, "completed",
            promptTemplateVersion=PROMPT_TEMPLATE_VERSION,
            modelName=model_name,
            tokensIn=tokens_in,
            tokensOut=tokens_out,
        )

        logger.info(
            "Completed digest generation: job=%s digest=%s confidence=%.2f status=%s",
            job_id,
            digest_id,
            confidence,
            review_status,
        )

        return {
            "status": "completed",
            "digest_id": digest_id,
            "confidence_score": confidence,
            "review_status": review_status,
            "validator_verdict": validation_result.verdict.value,
        }

    except httpx.HTTPStatusError as exc:
        logger.error(
            "HTTP error in generate_case_digest: job=%s status=%d body=%s",
            job_id,
            exc.response.status_code,
            exc.response.text[:500],
        )
        _fail_job(job_id, f"HTTP error: {exc.response.status_code}")
        return {"status": "failed", "reason": f"http_error_{exc.response.status_code}"}

    except Exception as exc:
        logger.error(
            "generate_case_digest failed: job=%s error=%s",
            job_id,
            str(exc),
        )
        if self.request.retries < self.max_retries:
            # Don't update job status yet — let retry handle it
            raise self.retry(exc=exc)

        _fail_job(job_id, f"Max retries exceeded: {exc}")
        return {"status": "failed", "reason": str(exc)}


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
    """Build provenance records from LLM sectionUsage output."""
    section_usage = content.get("sectionUsage", [])
    section_ids = {s["id"] for s in sections}
    provenance: list[dict[str, Any]] = []
    seen: set[str] = set()

    for usage in section_usage:
        if not isinstance(usage, dict):
            continue
        section_id = usage.get("sectionId")
        if not section_id or section_id not in section_ids:
            continue
        if section_id in seen:
            continue
        seen.add(section_id)
        provenance.append({
            "sourceDocumentId": document_id,
            "sourceSectionId": section_id,
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


def _format_issues(issues: Any) -> str | None:
    """Format issues field — may be a list of strings or a single string."""
    if issues is None:
        return None
    if isinstance(issues, list):
        return "\n".join(f"- {issue}" for issue in issues if isinstance(issue, str))
    if isinstance(issues, str):
        return issues
    return str(issues)
