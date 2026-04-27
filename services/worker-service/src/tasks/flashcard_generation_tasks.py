"""Flashcard generation — LLM-based flashcard generation from legal documents.

PR 5.3: Celery task that generates spaced-repetition flashcards from
Philippine legal documents. Flashcards write to BOTH:
  1. The existing Flashcard + FlashcardSet tables via NestJS
     POST /internal/derivatives/write-flashcards (user-authored study path).
  2. A DerivativeArtifact row via NestJS POST /internal/derivatives/write
     so the Quimbee Library (which reads from derivative_artifacts) can
     surface bulk-generated flashcards.

Per CLAUDE.md:
- Celery tasks must be idempotent (acks_late + reject_on_worker_lost)
- Pin model versions in model_runs for audit
"""

from __future__ import annotations

import datetime
import hashlib
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
from ..pricing import cost_for
from ..prompts.flashcard_generation_v1 import (
    FLASHCARD_GENERATION_SYSTEM_PROMPT,
    PROMPT_TEMPLATE_VERSION,
    build_user_prompt,
)
from ..scoring import compute_flashcard_confidence_score
from ..validators.derivative_validators import (
    DerivativeVerdict,
    LegalDocumentSectionSnapshot,
    LegalDocumentSnapshot,
    validate_derivative,
)
from ..validators.derivative_validators.eligibility import check_eligibility

logger = logging.getLogger(__name__)

# The seeded admin system user owns the admin organization. Flashcard jobs
# triggered by this user (admin bulk-gen) are meant to surface in the
# Library via a DerivativeArtifact row only — the FlashcardSet/Flashcard
# tables are for user-authored study decks. Writing a set on behalf of the
# admin user pollutes those tables and requires an organization_id the
# admin path doesn't carry.
_ADMIN_SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000002"


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
    backfill_batch_id: str | None = None,
) -> dict[str, Any]:
    """Generate flashcards from a legal document.

    Writes to BOTH FlashcardSet/Flashcard (study path) and
    DerivativeArtifact (Library path). Both writes must succeed or the
    job fails.

    Steps:
    1. Update job status -> running
    2. Load document + sections
    3. Check eligibility
    4. Build prompt
    5. Call LLM (temperature=0.2)
    6. Parse JSON
    7. Run FlashcardValidator
    8. Record model run
    9. Write via NestJS POST /internal/derivatives/write-flashcards
       (creates FlashcardSet + Flashcards)
    10. Write via NestJS POST /internal/derivatives/write
        (creates DerivativeArtifact for Library visibility)
    11. Update job status
    """
    logger.info(
        "generate_flashcards: job_id=%s document_id=%s card_count=%d card_style=%s",
        job_id,
        document_id,
        card_count,
        card_style,
    )

    # Step 1: Idempotency guard — claim job atomically
    if not db.claim_derivative_job(job_id):
        logger.info("Job %s already claimed or in terminal state, skipping", job_id)
        return {"job_id": job_id, "status": "already_claimed"}

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

        # Determine review status from validator verdict
        if validation_result.verdict == DerivativeVerdict.HUMAN_REVIEW:
            review_status = "needs_human_review"
        else:
            review_status = "draft"

        # Compute confidence score from source coverage + citation mapping
        confidence_score = compute_flashcard_confidence_score(
            content=content,
            source_sections=sections_with_text,
        )

        # Step 8: Record model run
        model_run_id = db.create_model_run(
            run_type="flashcard_generation",
            model_name=model_name,
            prompt_template_version=PROMPT_TEMPLATE_VERSION,
            input_ref=f"doc:{document_id}",
            output_ref=f"job:{job_id}",
            confidence=confidence_score,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            latency_ms=latency_ms,
        )

        # Step 9: Write to FlashcardSet + Flashcard (user-authored study path)
        #
        # The admin bulk-gen path (user_id is missing or is the admin system
        # user) has no study deck target — FlashcardSet is tenant-scoped
        # (NOT NULL user_id + organization_id) and is meant for decks users
        # author themselves. For admin bulk-gen, skip the FlashcardSet write
        # and let step 10's derivative_artifact write carry the Library row.
        cards = content.get("cards", [])
        set_id: str | None = None
        card_ids: list[str] = []
        is_admin_bulk = (
            not user_id or user_id == _ADMIN_SYSTEM_USER_ID
        )

        if is_admin_bulk:
            logger.info(
                "Skipping FlashcardSet write for admin-bulk flashcard job %s "
                "(user_id=%s) — derivative_artifact row covers Library visibility",
                job_id, user_id,
            )
        else:
            # Real user-triggered path: both fields are required by the
            # FlashcardSet schema. Derive organization_id from the user's
            # membership when the dispatcher didn't pass one.
            if not organization_id:
                organization_id = _resolve_primary_organization_id(user_id)
            if not organization_id:
                _fail_job(
                    job_id,
                    f"user {user_id} has no organization membership; "
                    f"cannot write FlashcardSet",
                )
                return {
                    "status": "failed",
                    "reason": "no_organization_for_user",
                }

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
                    "amountUsd": float(cost_for(model_name, tokens_in, tokens_out)),
                    "tokensIn": tokens_in,
                    "tokensOut": tokens_out,
                    "modelName": model_name,
                    "modelRunId": model_run_id,
                },
            }

            result = nestjs_client.write_flashcards(write_payload)
            set_id = result.get("setId")
            card_ids = result.get("cardIds", [])

        # Step 10: Write DerivativeArtifact so the Library surfaces this
        # bulk-generated set. Failure here fails the whole job — the
        # FlashcardSet write above already succeeded but the Library
        # expects a matching derivative_artifact row.
        content_disclaimer_id = db.get_content_disclaimer_id("ai_digest")
        source_section_id_set = {s["id"] for s in sections_with_text}
        derivative_cards, cited_section_ids = _build_derivative_cards(
            cards, source_section_id_set,
        )
        derivative_content_json: dict[str, Any] = {
            "cards": derivative_cards,
            "style": card_style,
            "cardCount": len(derivative_cards),
            "generatedAt": datetime.datetime.now(
                tz=datetime.timezone.utc,
            ).isoformat(),
        }
        provenance_records = _build_provenance_records(
            document_id, cited_section_ids, sections_with_text,
        )
        derivative_payload: dict[str, Any] = {
            "derivativeType": "flashcard",
            "sourceDocumentId": document_id,
            "derivativeGenerationJobId": job_id,
            "organizationId": organization_id,
            "title": f"Flashcards: {doc.get('title', document_id)[:80]}",
            "contentJson": derivative_content_json,
            "contentHash": _compute_content_hash(derivative_content_json),
            "contentRights": "ai_generated_derivative",
            "contentDisclaimerId": content_disclaimer_id,
            "visibility": "private",
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
        }
        derivative_result = nestjs_client.write_derivative(derivative_payload)
        artifact_id = derivative_result.get("artifactId")

        # Step 11: Update job -> completed
        nestjs_client.update_job_status(
            job_id, "completed",
            promptTemplateVersion=PROMPT_TEMPLATE_VERSION,
            modelName=model_name,
            tokensIn=tokens_in,
            tokensOut=tokens_out,
        )

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
                    "from flashcard task (non-blocking)",
                    backfill_batch_id,
                )

        logger.info(
            "Completed flashcard generation: job=%s set=%s cards=%d artifact=%s",
            job_id,
            set_id,
            len(card_ids),
            artifact_id,
        )

        return {
            "status": "completed",
            "set_id": set_id,
            "card_ids": card_ids,
            "card_count": len(card_ids),
            "artifact_id": artifact_id,
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


def _resolve_primary_organization_id(user_id: str) -> str | None:
    """Return any organization_id the user belongs to, or None.

    Used only on the user-triggered path where FlashcardSet needs the
    tenant scope. Admin-bulk jobs skip the FlashcardSet write entirely
    and never reach this helper.
    """
    from ..clients.db_client import get_connection

    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """SELECT organization_id
               FROM organization_members
               WHERE user_id = %s AND status = 'active'
               ORDER BY created_at ASC
               LIMIT 1""",
            (user_id,),
        )
        row = cur.fetchone()
        if not row:
            return None
        return str(row[0])


def _current_period_year_month() -> str:
    """Return current year-month string for budget ledger."""
    return datetime.datetime.now(tz=datetime.timezone.utc).strftime("%Y-%m")


def _compute_content_hash(content_json: dict[str, Any]) -> str:
    """Return a stable sha256 hash of the derivative contentJson.

    WriteDerivativeDto on the API side marks contentHash @IsNotEmpty(),
    so the worker must send a non-empty string. We canonicalise the JSON
    (sorted keys, compact separators) so identical content produces the
    same hash across retries — useful for dedupe + audit.
    """
    canonical = json.dumps(
        content_json, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
    )
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return f"sha256:{digest}"


def _build_derivative_cards(
    cards: list[dict[str, Any]],
    source_section_ids: set[str],
) -> tuple[list[dict[str, Any]], set[str]]:
    """Shape LLM cards for the derivative_artifact contentJson.

    Mirrors PR #63 MCQ pattern: drop non-UUID / unknown
    ``supportingSectionIds`` so the provenance records we build from
    them pass the NestJS @IsUUID() check.

    Returns (card_entries, unique_cited_section_ids).
    """
    entries: list[dict[str, Any]] = []
    cited: set[str] = set()
    for c in cards:
        if not isinstance(c, dict):
            continue
        raw_sids = c.get("supportingSectionIds", []) or []
        filtered_sids: list[str] = []
        for sid in raw_sids:
            if not isinstance(sid, str):
                continue
            try:
                uuid.UUID(sid)
            except (ValueError, AttributeError, TypeError):
                continue
            if sid not in source_section_ids:
                continue
            filtered_sids.append(sid)
            cited.add(sid)
        entries.append({
            "front": c.get("front", ""),
            "back": c.get("back", ""),
            "mnemonicHint": c.get("mnemonicHint"),
            "tags": c.get("tags", []) or [],
            "supportingSectionIds": filtered_sids,
        })
    return entries, cited


def _build_provenance_records(
    document_id: str,
    cited_section_ids: set[str],
    source_sections: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Build provenance records for the derivative_artifact write.

    NestJS requires ≥1 provenance record. If the LLM didn't cite any
    valid section, fall back to the first source section so the write
    still satisfies the invariant (mirrors outline's fallback).
    """
    provenance: list[dict[str, Any]] = [
        {
            "sourceDocumentId": document_id,
            "sourceSectionId": sid,
            "provenanceType": "source_passage",
        }
        for sid in cited_section_ids
    ]
    if not provenance and source_sections:
        provenance.append({
            "sourceDocumentId": document_id,
            "sourceSectionId": source_sections[0]["id"],
            "provenanceType": "source_passage",
        })
    return provenance
