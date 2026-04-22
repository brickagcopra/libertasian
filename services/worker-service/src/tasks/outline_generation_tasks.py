"""Subject outline generation — LLM-based study outline from multiple documents.

PR 5.3: Celery task that generates structured bar review study outlines from
multiple Philippine legal documents. Unlike single-document derivatives, this
task loads MULTIPLE source documents by subject classification, then synthesises
them into a hierarchical outline. Results write to DerivativeArtifact with
derivativeType='subject_outline' and contentJson containing the outline structure.

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
from ..prompts.subject_outline_generation_v1 import (
    PROMPT_TEMPLATE_VERSION,
    SUBJECT_OUTLINE_GENERATION_SYSTEM_PROMPT,
    build_user_prompt,
)
from ..scoring import compute_outline_confidence_score
from ..validators.derivative_validators import (
    DerivativeVerdict,
    LegalDocumentSectionSnapshot,
    LegalDocumentSnapshot,
    validate_derivative,
)

logger = logging.getLogger(__name__)

# Max sections per document to include in the prompt
MAX_SECTIONS_PER_DOC = 3


@shared_task(
    bind=True,
    name="derivatives.generate_subject_outline",
    acks_late=True,
    reject_on_worker_lost=True,
    max_retries=2,
    retry_backoff=True,
    retry_backoff_max=300,
)
def generate_subject_outline(
    self: Any,
    job_id: str,
    document_id: str | None = None,
    subject_code: str | None = None,
    topic_code: str | None = None,
    document_ids: list[str] | None = None,
    max_documents: int = 10,
) -> dict[str, Any]:
    """Generate a subject outline from source documents.

    Callers may dispatch this in one of two modes:
    - **Per-document (default for bulk-gen)**: pass ``document_id``. The task
      resolves the document's *primary* subject from
      ``document_subject_assignments`` and generates an outline from that
      single document.
    - **Cross-subject**: pass ``subject_code`` (optionally ``topic_code``)
      and/or an explicit ``document_ids`` list. The task synthesises an
      outline across up to ``max_documents`` documents classified under
      the subject/topic.

    If neither ``document_id`` nor ``subject_code``/``document_ids`` is
    supplied the job is failed early.

    Steps:
    1. Update job status -> running
    2. Resolve subject + topic info (from arg or from the single doc's
       primary subject assignment)
    3. Load source documents (from document_ids or by subject classification)
    4. Load sections for each document (first 3 sections, truncated)
    5. Build prompt with all documents' sections
    6. Call LLM (temperature=0)
    7. Parse JSON
    8. Run SubjectOutlineValidator
    9. Record model run
    10. Write DerivativeArtifact via existing POST /internal/derivatives/write
    11. Update job status
    """
    logger.info(
        "generate_subject_outline: job_id=%s doc_id=%s subject=%s topic=%s doc_ids=%s",
        job_id,
        document_id,
        subject_code,
        topic_code,
        document_ids,
    )

    # Step 1: Idempotency guard — claim job atomically
    if not db.claim_derivative_job(job_id):
        logger.info("Job %s already claimed or in terminal state, skipping", job_id)
        return {"job_id": job_id, "status": "already_claimed"}

    try:
        # Per-doc dispatch: fold document_id into document_ids + resolve
        # subject_code from the document's primary subject assignment.
        if document_id and not document_ids:
            document_ids = [document_id]
            if not subject_code:
                resolved = _resolve_primary_subject(document_id)
                if not resolved:
                    _fail_job(
                        job_id,
                        f"Document {document_id} has no primary subject assignment",
                    )
                    return {
                        "status": "failed",
                        "reason": "no_primary_subject_assignment",
                    }
                subject_code, topic_code = resolved

        if not subject_code and not document_ids:
            _fail_job(
                job_id,
                "generate_subject_outline requires document_id or subject_code/document_ids",
            )
            return {"status": "failed", "reason": "missing_dispatch_args"}

        # Resolve content disclaimer ID at task start
        content_disclaimer_id = db.get_content_disclaimer_id("ai_digest")

        # Step 2: Load subject + topic info
        subject_name = (subject_code or "").replace("_", " ").title()
        topic_name = topic_code.replace("_", " ").title() if topic_code else None

        # Step 3: Load source documents
        if document_ids:
            doc_ids = document_ids[:max_documents]
        else:
            doc_ids = _get_document_ids_by_subject(subject_code, topic_code, max_documents)

        if not doc_ids:
            _fail_job(job_id, f"No documents found for subject {subject_code}")
            return {"status": "failed", "reason": "no_documents"}

        # Step 4: Load documents + sections
        documents_with_sections: list[tuple[dict[str, Any], list[dict[str, Any]]]] = []
        all_section_snapshots: list[LegalDocumentSectionSnapshot] = []

        for doc_id in doc_ids:
            doc = db.get_legal_document(doc_id)
            if not doc:
                logger.warning("Document %s not found, skipping", doc_id)
                continue

            sections = db.get_document_sections_for_digest(doc_id)
            # Filter to sections with text, limit per doc
            sections_with_text = [
                s for s in sections
                if s.get("plain_text") and s["plain_text"].strip()
            ][:MAX_SECTIONS_PER_DOC]

            if not sections_with_text:
                logger.warning("Document %s has no text sections, skipping", doc_id)
                continue

            documents_with_sections.append((doc, sections_with_text))
            for s in sections_with_text:
                all_section_snapshots.append(
                    LegalDocumentSectionSnapshot(
                        id=s["id"],
                        section_type=s.get("section_type", "body"),
                        plain_text=s.get("plain_text", ""),
                        page_start=s.get("page_start"),
                        page_end=s.get("page_end"),
                    )
                )

        if not documents_with_sections:
            _fail_job(job_id, "No usable documents with text sections")
            return {"status": "failed", "reason": "no_usable_documents"}

        # Step 5: Build prompt
        user_prompt = build_user_prompt(
            subject_name=subject_name,
            topic_name=topic_name,
            documents_with_sections=documents_with_sections,
        )

        # Step 6: Call LLM (temperature=0 for deterministic outline)
        start_time = time.monotonic()
        llm_response = rag_client.generate_completion(
            system_prompt=SUBJECT_OUTLINE_GENERATION_SYSTEM_PROMPT,
            user_prompt=user_prompt,
            temperature=0,
        )
        latency_ms = int((time.monotonic() - start_time) * 1000)

        model_name = llm_response.get("model_name", "unknown")
        tokens_in = llm_response.get("tokens_in", 0)
        tokens_out = llm_response.get("tokens_out", 0)

        # Step 7: Parse JSON output
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

        # Step 8: Validate with SubjectOutlineValidator
        # Use the first document as the "source document" for the validator
        first_doc = documents_with_sections[0][0]
        source_doc_snapshot = LegalDocumentSnapshot(
            id=first_doc.get("id", ""),
            title=first_doc.get("title", ""),
            document_type=first_doc.get("document_type", "case"),
            citation_text=first_doc.get("citation_text"),
            court=first_doc.get("court"),
            decision_date=str(first_doc.get("decision_date")) if first_doc.get("decision_date") else None,
            confidence_score=first_doc.get("confidence_score"),
        )

        validation_result = validate_derivative(
            derivative_type="subject_outline",
            content=content,
            source_document=source_doc_snapshot,
            source_sections=all_section_snapshots,
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

        # Determine review status
        if validation_result.verdict == DerivativeVerdict.HUMAN_REVIEW:
            review_status = "needs_human_review"
        else:
            review_status = "draft"

        # Compute confidence score from source coverage + citation mapping.
        # Flatten (doc, sections) tuples into a single list of section dicts
        # the scorer expects (each with an ``id`` key).
        flattened_sections: list[dict[str, Any]] = []
        for _doc, _secs in documents_with_sections:
            flattened_sections.extend(_secs)
        confidence_score = compute_outline_confidence_score(
            content=content,
            source_sections=flattened_sections,
        )

        # Step 9: Record model run
        primary_doc_id = first_doc.get("id", "")
        model_run_id = db.create_model_run(
            run_type="subject_outline_generation",
            model_name=model_name,
            prompt_template_version=PROMPT_TEMPLATE_VERSION,
            input_ref=f"subject:{subject_code}",
            output_ref=f"job:{job_id}",
            confidence=confidence_score,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            latency_ms=latency_ms,
        )

        # Step 10: Build provenance records from all cited section IDs
        provenance_records = _build_provenance_records(
            content, documents_with_sections,
        )

        # Write to NestJS via existing generic write endpoint
        write_payload: dict[str, Any] = {
            "derivativeType": "subject_outline",
            "sourceDocumentId": primary_doc_id,
            "derivativeGenerationJobId": job_id,
            "title": f"Subject Outline: {subject_name}" + (f" — {topic_name}" if topic_name else ""),
            "contentJson": content,
            "contentHash": "",
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
            "provenanceRecords": provenance_records,
            "budgetLedgerEntry": {
                "periodYearMonth": _current_period_year_month(),
                "scope": "subject_outline_generation",
                "amountUsd": 0.0,
                "tokensIn": tokens_in,
                "tokensOut": tokens_out,
                "modelName": model_name,
                "modelRunId": model_run_id,
            },
        }

        result = nestjs_client.write_derivative(write_payload)
        artifact_id = result.get("artifactId")

        # Update job -> completed
        nestjs_client.update_job_status(
            job_id, "completed",
            promptTemplateVersion=PROMPT_TEMPLATE_VERSION,
            modelName=model_name,
            tokensIn=tokens_in,
            tokensOut=tokens_out,
        )

        logger.info(
            "Completed subject outline generation: job=%s artifact=%s status=%s docs=%d",
            job_id,
            artifact_id,
            review_status,
            len(documents_with_sections),
        )

        return {
            "status": "completed",
            "artifact_id": artifact_id,
            "review_status": review_status,
            "validator_verdict": validation_result.verdict.value,
            "document_count": len(documents_with_sections),
        }

    except httpx.HTTPStatusError as exc:
        logger.error(
            "HTTP error in generate_subject_outline: job=%s status=%d body=%s",
            job_id,
            exc.response.status_code,
            exc.response.text[:500],
        )
        _fail_job(job_id, f"HTTP error: {exc.response.status_code}")
        return {"status": "failed", "reason": f"http_error_{exc.response.status_code}"}

    except Exception as exc:
        logger.error(
            "generate_subject_outline failed: job=%s error=%s",
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


def _resolve_primary_subject(
    document_id: str,
) -> tuple[str, str | None] | None:
    """Return the (subject_code, topic_code | None) for the document's
    primary subject assignment in taxonomy ``study_8``, or ``None`` if
    the document has no primary assignment.
    """
    from ..clients.db_client import get_connection

    import psycopg2.extras

    with get_connection() as conn, \
            conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT s.code AS subject_code, st.code AS topic_code
               FROM document_subject_assignments dsa
               JOIN subjects s ON s.id = dsa.subject_id
               LEFT JOIN subject_topics st ON st.id = dsa.subject_topic_id
               WHERE dsa.legal_document_id = %s
                 AND dsa.is_primary = true
                 AND s.taxonomy_version = 'study_8'
               LIMIT 1""",
            (document_id,),
        )
        row = cur.fetchone()
        if not row:
            return None
        return row["subject_code"], row["topic_code"]


def _get_document_ids_by_subject(
    subject_code: str,
    topic_code: str | None,
    limit: int,
) -> list[str]:
    """Query published document IDs classified under the given subject/topic.

    Uses ingestion_db_client's connection to query document_subject_assignments.
    """
    from ..clients.db_client import get_connection

    import psycopg2.extras

    with get_connection() as conn, \
            conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        if topic_code:
            cur.execute(
                """SELECT dsa.legal_document_id
                   FROM document_subject_assignments dsa
                   JOIN subjects s ON s.id = dsa.subject_id
                   LEFT JOIN subject_topics st ON st.id = dsa.subject_topic_id
                   WHERE s.code = %s AND st.code = %s
                   AND s.taxonomy_version = 'study_8'
                   ORDER BY dsa.confidence DESC
                   LIMIT %s""",
                (subject_code, topic_code, limit),
            )
        else:
            cur.execute(
                """SELECT dsa.legal_document_id
                   FROM document_subject_assignments dsa
                   JOIN subjects s ON s.id = dsa.subject_id
                   WHERE s.code = %s
                   AND s.taxonomy_version = 'study_8'
                   ORDER BY dsa.confidence DESC
                   LIMIT %s""",
                (subject_code, limit),
            )
        return [row["legal_document_id"] for row in cur.fetchall()]


def _build_provenance_records(
    content: dict[str, Any],
    documents_with_sections: list[tuple[dict[str, Any], list[dict[str, Any]]]],
) -> list[dict[str, Any]]:
    """Build provenance records from outline cited section IDs.

    Maps cited section IDs back to their source documents.
    """
    # Build a mapping from section ID -> document ID
    section_to_doc: dict[str, str] = {}
    for doc, sections in documents_with_sections:
        doc_id = doc.get("id", "")
        for s in sections:
            section_to_doc[s["id"]] = doc_id

    provenance: list[dict[str, Any]] = []
    seen: set[str] = set()

    # Collect cited section IDs from all sections + sub-sections
    for section in content.get("sections", []):
        for sid in section.get("citedSectionIds", []):
            if sid and sid not in seen and sid in section_to_doc:
                seen.add(sid)
                provenance.append({
                    "sourceDocumentId": section_to_doc[sid],
                    "sourceSectionId": sid,
                    "provenanceType": "source_passage",
                })
        for sub in section.get("subSections", []):
            for sid in sub.get("citedSectionIds", []):
                if sid and sid not in seen and sid in section_to_doc:
                    seen.add(sid)
                    provenance.append({
                        "sourceDocumentId": section_to_doc[sid],
                        "sourceSectionId": sid,
                        "provenanceType": "source_passage",
                    })

    # Ensure at least one provenance record
    if not provenance and documents_with_sections:
        first_doc, first_sections = documents_with_sections[0]
        if first_sections:
            provenance.append({
                "sourceDocumentId": first_doc.get("id", ""),
                "sourceSectionId": first_sections[0]["id"],
                "provenanceType": "source_passage",
            })

    return provenance


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
