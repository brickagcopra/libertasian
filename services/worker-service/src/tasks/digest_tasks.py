"""LIBERTASIAN Worker Service — Auto-digest generation Celery task.

Generates structured DFIR+ digests during the ingestion pipeline.
Each task is idempotent (acks_late + reject_on_worker_lost).

Per CLAUDE.md:
- Confidence < 0.7 -> needs_human_review
- Confidence >= 0.7 AND source is official -> ai_generated
- Digests from user scans: visibility = 'private' always
- Pin model versions in model_runs for audit
"""

import json
import logging
from typing import Any

from celery import shared_task

from ..clients import ingestion_db_client as db
from ..clients import rag_client
from ..clients.db_client import SchemaIntegrityError

logger = logging.getLogger(__name__)

# Document types eligible for case digest generation
CASE_DOCUMENT_TYPES = {"case", "decision", "resolution", "en_banc"}

# Confidence threshold per CLAUDE.md
CONFIDENCE_THRESHOLD = 0.7


@shared_task(
    name="ingestion.generate_digest",
    bind=True,
    acks_late=True,
    reject_on_worker_lost=True,
    max_retries=2,
    retry_backoff=True,
    retry_backoff_max=300,
    retry_jitter=True,
)
def generate_ingestion_digest(
    self: Any,
    document_id: str,
    backfill_batch_id: str | None = None,
) -> dict[str, Any]:
    """Auto-generate a structured DFIR+ digest for a newly ingested document.

    Flow:
    1. Fetch document metadata + sections from DB
    2. Skip non-case documents (statutes, rules don't need case digests)
    3. Call RAG service POST /digests/generate with sections
    4. Create Digest row in DB
    5. Create ProvenanceRecord rows
    6. Create ModelRun audit record
    7. Return digest_id and confidence

    This task is fire-and-forget. Failure does NOT block document
    ingestion or publishing.
    """
    logger.info(
        "generate_ingestion_digest: document_id=%s",
        document_id,
    )

    try:
        # Step 1: Fetch document metadata
        doc = db.get_document_metadata_for_digest(document_id)
        if not doc:
            logger.warning(
                "Document %s not found for digest generation", document_id,
            )
            return {
                "document_id": document_id,
                "status": "skipped",
                "reason": "document_not_found",
            }

        # Step 2: Skip non-case documents
        doc_type = doc.get("document_type", "")
        if doc_type not in CASE_DOCUMENT_TYPES:
            logger.info(
                "Skipping digest for non-case document %s (type=%s)",
                document_id,
                doc_type,
            )
            return {
                "document_id": document_id,
                "status": "skipped",
                "reason": f"non_case_document_type:{doc_type}",
            }

        # Fetch sections
        sections = db.get_document_sections_for_digest(document_id)
        if not sections:
            logger.warning(
                "No sections found for document %s", document_id,
            )
            return {
                "document_id": document_id,
                "status": "skipped",
                "reason": "no_sections",
            }

        # Filter to sections with actual text
        sections_with_text = [
            {
                "id": s["id"],
                "section_type": s["section_type"],
                "section_label": s.get("section_label"),
                "plain_text": s["plain_text"],
                "page_start": s.get("page_start"),
                "page_end": s.get("page_end"),
            }
            for s in sections
            if s.get("plain_text") and s["plain_text"].strip()
        ]

        if not sections_with_text:
            logger.warning(
                "No sections with text for document %s", document_id,
            )
            return {
                "document_id": document_id,
                "status": "skipped",
                "reason": "no_text_sections",
            }

        # Step 3: Call RAG service
        rag_response = rag_client.generate_digest(
            document_id=document_id,
            sections=sections_with_text,
            document_type=doc_type,
        )

        confidence = rag_response.get("confidence_score", 0.0)
        model_name = rag_response.get("model_name", "unknown")
        prompt_version = rag_response.get("prompt_template_version", "unknown")
        tokens_in = int(rag_response.get("tokens_in", 0) or 0)
        tokens_out = int(rag_response.get("tokens_out", 0) or 0)

        # Step 4: Determine review status per CLAUDE.md
        review_status = (
            "ai_generated" if confidence >= CONFIDENCE_THRESHOLD
            else "needs_human_review"
        )

        # Build digest title
        doc_title = doc.get("short_title") or doc.get("title") or "Untitled"
        digest_title = f"Digest: {doc_title}"

        # Build cited authorities JSON
        cited_authorities = rag_response.get("cited_authorities", [])
        cited_authorities_json = json.dumps(cited_authorities)

        # Create digest row
        digest_id = db.create_digest(
            document_id=document_id,
            title=digest_title,
            source_origin="official_pipeline",
            digest_type="case_digest",
            summary=rag_response.get("summary"),
            facts=rag_response.get("facts"),
            petitioner_arguments=rag_response.get("petitioner_arguments"),
            respondent_arguments=rag_response.get("respondent_arguments"),
            issues=rag_response.get("issues"),
            ruling=rag_response.get("ruling"),
            doctrine=rag_response.get("doctrine"),
            dispositive=rag_response.get("dispositive"),
            cited_authorities_json=cited_authorities_json,
            confidence_score=confidence,
            review_status=review_status,
            visibility="public_editorial",
        )

        # Step 5: Create provenance records
        provenance_entries = rag_response.get("provenance", [])
        if provenance_entries:
            provenance_records = [
                {
                    "entity_type": "digest",
                    "entity_id": digest_id,
                    "source_document_id": p.get(
                        "source_document_id", document_id,
                    ),
                    "source_section_id": p.get("source_section_id"),
                    "provenance_type": p.get("field", "generated"),
                }
                for p in provenance_entries
                if isinstance(p, dict) and p.get("source_section_id")
            ]
            db.create_provenance_records(provenance_records)

        # Step 6: Create model run audit record per CLAUDE.md.
        # tokens_in/tokens_out come from the rag-service response (PR #76)
        # — passing them here so model_runs is no longer NULL for
        # digest_generation rows (Bug 7-residual).
        db.create_model_run(
            run_type="digest_generation",
            model_name=model_name,
            prompt_template_version=prompt_version,
            input_ref=f"digest:{digest_id}:doc:{document_id}",
            output_ref=f"digest:{digest_id}:output",
            confidence=confidence,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
        )

        # Per-batch cost telemetry. Wrap in try/except so a stale or
        # deleted batch row never blocks the digest write — billing is
        # advisory; the canonical record is the model_run row above. Uses
        # an atomic ``UPDATE ... SET col = COALESCE(col, 0) + ?::numeric``
        # in update_batch_counters, which Postgres serializes per row, so
        # concurrent completion hooks from the same batch don't lose
        # increments under contention.
        if backfill_batch_id:
            try:
                from ..clients import backfill_db_client as backfill_db
                from ..pricing import cost_for

                cost = cost_for(model_name, tokens_in, tokens_out)
                if cost > 0:
                    backfill_db.update_batch_counters(
                        backfill_batch_id,
                        budget_consumed_usd=cost,
                    )
            except Exception:
                logger.exception(
                    "Failed to update backfill batch %s budget_consumed_usd "
                    "from digest task (non-blocking)",
                    backfill_batch_id,
                )

        # Step 7: Audit log
        db.create_audit_log(
            action="digest.auto_generated",
            entity_type="digest",
            entity_id=digest_id,
            metadata={
                "document_id": document_id,
                "confidence_score": confidence,
                "review_status": review_status,
                "model_name": model_name,
                "source": "ingestion_pipeline",
            },
        )

        logger.info(
            "Auto-generated digest %s for document %s "
            "(confidence=%.2f, status=%s)",
            digest_id,
            document_id,
            confidence,
            review_status,
        )

        return {
            "document_id": document_id,
            "digest_id": digest_id,
            "confidence_score": confidence,
            "review_status": review_status,
            "status": "completed",
        }

    except SchemaIntegrityError:
        # Schema-level bugs (missing tables/columns from raw SQL) MUST surface
        # to DLQ — swallowing them is what hid the PascalCase regression that
        # silently degraded 1421 documents in April 2026. Re-raise without
        # going through Celery retry; this is not a transient failure.
        logger.exception(
            "generate_ingestion_digest hit a SchemaIntegrityError on "
            "document=%s — failing loudly to DLQ",
            document_id,
        )
        raise
    except Exception as exc:
        logger.error(
            "generate_ingestion_digest failed: document=%s error=%s",
            document_id,
            str(exc),
        )
        if self.request.retries >= self.max_retries:
            logger.error(
                "generate_ingestion_digest giving up after %d retries: "
                "document=%s (non-blocking, document ingestion continues)",
                self.max_retries,
                document_id,
            )
            # Don't route to DLQ — digest failure is non-blocking
            return {
                "document_id": document_id,
                "status": "failed",
                "error": str(exc),
            }
        raise self.retry(exc=exc)
