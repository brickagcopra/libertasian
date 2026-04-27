"""LIBERTASIAN Worker Service — Doctrine extraction Celery tasks.

Phase 5 Batch 7. Each task is idempotent (acks_late + reject_on_worker_lost).

Pipeline: fetch_document_data -> call_rag_extract -> save_doctrines_to_db
"""

import json
import logging

from celery import shared_task

from ..clients import db_client, rag_client

logger = logging.getLogger(__name__)


@shared_task(
    name="doctrine.extract",
    bind=True,
    acks_late=True,
    reject_on_worker_lost=True,
    max_retries=3,
    default_retry_delay=60,
)
def extract_doctrines_task(
    self,  # type: ignore[no-untyped-def]
    document_id: str,
    strategy: str = "auto",
    backfill_batch_id: str | None = None,
) -> dict:  # type: ignore[type-arg]
    """Extract doctrines from a legal document via RAG service.

    Fetches document sections from DB, calls the RAG service for
    LLM-based doctrine extraction, and saves the results back to DB.

    Args:
        document_id: UUID of the LegalDocument.
        strategy: Extraction strategy ('auto', 'full_text', 'sections_only').

    Returns:
        dict with extraction results.
    """
    logger.info(
        "extract_doctrines_task: document=%s strategy=%s",
        document_id,
        strategy,
    )

    try:
        # Fetch document sections from database
        sections = db_client.get_document_sections(document_id)

        sections_data = None
        document_text = None

        if sections and strategy != "full_text":
            sections_data = [
                {
                    "id": s["id"],
                    "section_type": s["section_type"],
                    "plain_text": s["plain_text"],
                }
                for s in sections
                if s.get("plain_text")
            ]

        if not sections_data or strategy == "full_text":
            # Concatenate all section texts as full document text
            document_text = "\n\n".join(
                s.get("plain_text", "") for s in sections if s.get("plain_text")
            )

        # Call RAG service for extraction
        result = rag_client.extract_doctrines(
            document_id=document_id,
            strategy=strategy,
            document_text=document_text,
            sections=sections_data,
        )

        doctrines = result.get("doctrines", [])
        model_name = result.get("model_name", "unknown")
        prompt_version = result.get("prompt_template_version", "unknown")
        tokens_in = int(result.get("tokens_in", 0) or 0)
        tokens_out = int(result.get("tokens_out", 0) or 0)

        # Save each extracted doctrine to the database
        doctrine_ids = []
        for d in doctrines:
            confidence = d.get("confidence", 0.5)
            # Per CLAUDE.md: confidence < 0.7 -> needs_human_review
            review_status = (
                "ai_generated" if confidence >= 0.7 else "needs_human_review"
            )

            doctrine_id = db_client.create_doctrine_extract(
                legal_document_id=document_id,
                text=d.get("text", ""),
                normalized_text=d.get("normalized_text"),
                doctrine_type=d.get("doctrine_type", "other"),
                source_section_id=d.get("source_section_id"),
                confidence=confidence,
                review_status=review_status,
            )
            doctrine_ids.append(doctrine_id)

        # Log the model run for auditing (per CLAUDE.md: pin model versions)
        db_client.create_model_run(
            run_type="doctrine_extract",
            model_name=model_name,
            prompt_template_version=prompt_version,
            input_ref=f"document:{document_id}",
            output_ref=json.dumps({"doctrine_ids": doctrine_ids}),
            confidence=None,
        )

        # Per-batch cost telemetry. Same atomic-increment pattern used
        # by classify_document_subjects + generate_document_embeddings_task
        # — see digest_tasks.generate_ingestion_digest for the rationale.
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
                    "from doctrine task (non-blocking)",
                    backfill_batch_id,
                )

        logger.info(
            "extract_doctrines_task complete: document=%s doctrines=%d",
            document_id,
            len(doctrine_ids),
        )

        return {
            "document_id": document_id,
            "doctrines_extracted": len(doctrine_ids),
            "doctrine_ids": doctrine_ids,
            "model_name": model_name,
            "strategy_used": result.get("strategy_used", strategy),
            "status": "completed",
        }

    except Exception as exc:
        logger.error(
            "extract_doctrines_task failed: document=%s error=%s",
            document_id,
            str(exc),
        )
        if self.request.retries >= self.max_retries:
            logger.error(
                "extract_doctrines_task giving up after %d retries: document=%s",
                self.max_retries,
                document_id,
            )
        raise self.retry(exc=exc)
