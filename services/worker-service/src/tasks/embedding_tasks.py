"""LIBERTASIAN Worker Service — Embedding generation Celery tasks.

Phase 4: Generate document-level embeddings for kNN vector search.
Each task is idempotent (acks_late + reject_on_worker_lost).

Pipeline: fetch_sections -> prepare_texts -> call_embedding_service -> save_to_db
"""

import json
import logging
from typing import Any

from celery import shared_task

from ..clients import db_client, embedding_client

logger = logging.getLogger(__name__)

# Max characters per text chunk sent to embedding service (32768 limit)
MAX_TEXT_LENGTH = 30000


def _prepare_section_texts(
    sections: list[dict[str, Any]],
) -> list[tuple[str, str]]:
    """Prepare (section_id, text) pairs from document sections.

    Filters out empty sections and truncates to MAX_TEXT_LENGTH.
    Returns list of (section_id, truncated_text) tuples.
    """
    pairs: list[tuple[str, str]] = []
    for section in sections:
        text = (section.get("plain_text") or "").strip()
        if not text:
            continue
        if len(text) > MAX_TEXT_LENGTH:
            text = text[:MAX_TEXT_LENGTH]
        pairs.append((section["id"], text))
    return pairs


@shared_task(
    name="embedding.generate_document_embeddings",
    bind=True,
    acks_late=True,
    reject_on_worker_lost=True,
    max_retries=3,
    default_retry_delay=60,
)
def generate_document_embeddings_task(
    self: Any,
    document_id: str,
    backfill_batch_id: str | None = None,
) -> dict[str, Any]:
    """Generate and store embeddings for all sections of a legal document.

    Idempotent: skips sections that already have embeddings.

    1. Fetches document sections from DB
    2. Filters out sections that already have embeddings
    3. Calls embedding service in batch
    4. Stores embedding metadata + vector in the embeddings table
    5. Logs model run for auditing

    Args:
        document_id: UUID of the LegalDocument.
        backfill_batch_id: When set, per-call cost is added to the batch's
            ``budget_consumed_usd``. Local embedding models return
            ``Decimal("0")`` from ``pricing.cost_for`` so this is a no-op
            today, but it future-proofs the cost path for hosted models.

    Returns:
        dict with embedding generation results.
    """
    logger.info(
        "generate_document_embeddings_task: document=%s",
        document_id,
    )

    try:
        # Check if embedding service is available
        if not embedding_client.is_available():
            logger.warning(
                "Embedding service unavailable — skipping document %s",
                document_id,
            )
            return {
                "document_id": document_id,
                "status": "skipped",
                "reason": "embedding_service_unavailable",
            }

        # Fetch document sections
        sections = db_client.get_document_sections(document_id)
        if not sections:
            logger.info(
                "No sections found for document %s — skipping embedding",
                document_id,
            )
            return {
                "document_id": document_id,
                "status": "skipped",
                "reason": "no_sections",
            }

        # Prepare section texts
        section_pairs = _prepare_section_texts(sections)
        if not section_pairs:
            logger.info(
                "No non-empty sections for document %s — skipping embedding",
                document_id,
            )
            return {
                "document_id": document_id,
                "status": "skipped",
                "reason": "empty_sections",
            }

        section_ids = [sid for sid, _ in section_pairs]

        # Idempotent: skip sections that already have embeddings
        existing = db_client.get_existing_embedding_ids("section", section_ids)
        new_pairs = [(sid, text) for sid, text in section_pairs if sid not in existing]

        if not new_pairs:
            logger.info(
                "All %d sections for document %s already have embeddings — skipping",
                len(section_pairs),
                document_id,
            )
            return {
                "document_id": document_id,
                "status": "skipped",
                "reason": "already_embedded",
                "existing_count": len(existing),
            }

        # Call embedding service in batch
        texts = [text for _, text in new_pairs]
        result = embedding_client.generate_embeddings_batch(texts)

        embeddings = result["embeddings"]
        model_name = result["model_name"]

        if len(embeddings) != len(new_pairs):
            raise ValueError(
                f"Embedding count mismatch: expected {len(new_pairs)}, "
                f"got {len(embeddings)}"
            )

        # Store embeddings in DB
        records = []
        for (section_id, _), embedding_vector in zip(new_pairs, embeddings):
            records.append({
                "entity_type": "section",
                "entity_id": section_id,
                "embedding_model": model_name,
                "vector_ref": json.dumps(embedding_vector),
            })

        embedding_ids = db_client.create_embeddings_batch(records)

        # Log model run for auditing (per CLAUDE.md: pin model versions)
        db_client.create_model_run(
            run_type="embedding_generation",
            model_name=model_name,
            prompt_template_version="n/a",
            input_ref=f"document:{document_id}",
            output_ref=json.dumps({"embedding_ids": embedding_ids}),
            confidence=None,
        )

        # Per-batch cost telemetry. Local embedding models return $0 from
        # cost_for so this is a no-op today; it's wired up so a future
        # switch to a hosted embedding endpoint starts billing the right
        # batch automatically. Embedding service responses don't expose
        # token counts, so we charge zero tokens — relevant once a hosted
        # model with priced inputs is in play.
        if backfill_batch_id:
            try:
                from ..clients import backfill_db_client as backfill_db
                from ..pricing import cost_for

                cost = cost_for(model_name, 0, 0)
                if cost > 0:
                    backfill_db.update_batch_counters(
                        backfill_batch_id,
                        budget_consumed_usd=cost,
                    )
            except Exception:
                logger.exception(
                    "Failed to update backfill batch %s budget_consumed_usd "
                    "(non-blocking)",
                    backfill_batch_id,
                )

        logger.info(
            "generate_document_embeddings_task complete: document=%s "
            "new=%d skipped=%d total_sections=%d",
            document_id,
            len(embedding_ids),
            len(existing),
            len(section_pairs),
        )

        return {
            "document_id": document_id,
            "embeddings_created": len(embedding_ids),
            "sections_skipped": len(existing),
            "total_sections": len(section_pairs),
            "model_name": model_name,
            "status": "completed",
        }

    except Exception as exc:
        logger.error(
            "generate_document_embeddings_task failed: document=%s error=%s",
            document_id,
            str(exc),
        )
        if self.request.retries >= self.max_retries:
            logger.error(
                "generate_document_embeddings_task giving up after %d retries: "
                "document=%s",
                self.max_retries,
                document_id,
            )
        raise self.retry(exc=exc)
