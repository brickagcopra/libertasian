"""LIBERTASIAN Worker Service — Citation resolution Celery tasks.

Phase 5 Batch 7. Each task is idempotent (acks_late + reject_on_worker_lost).

Pipeline: fetch_unresolved_citations -> call_rag_resolve -> update_citations_in_db
"""

import logging

from celery import shared_task

from ..clients import db_client, rag_client

logger = logging.getLogger(__name__)


@shared_task(
    name="citation.resolve_for_document",
    bind=True,
    acks_late=True,
    reject_on_worker_lost=True,
    max_retries=3,
    default_retry_delay=60,
)
def resolve_citations_task(
    self,  # type: ignore[no-untyped-def]
    document_id: str,
) -> dict:  # type: ignore[type-arg]
    """Resolve unresolved citations for a legal document.

    Fetches all unresolved citations (toDocumentId IS NULL) for the document,
    sends them to the RAG service for resolution, and updates the database.

    Args:
        document_id: UUID of the LegalDocument whose citations to resolve.

    Returns:
        dict with resolution results.
    """
    logger.info("resolve_citations_task: document=%s", document_id)

    try:
        # Fetch unresolved citations from database
        citations = db_client.get_unresolved_citations(document_id)

        if not citations:
            logger.info(
                "resolve_citations_task: no unresolved citations for document=%s",
                document_id,
            )
            return {
                "document_id": document_id,
                "total_citations": 0,
                "resolved_count": 0,
                "status": "completed",
            }

        # Format citations for RAG service
        citations_payload = [
            {
                "id": c["id"],
                "citation_text": c["citation_text"],
                "normalized_citation": c.get("normalized_citation"),
                "citation_type": c.get("citation_type"),
                "from_document_id": c["from_document_id"],
            }
            for c in citations
        ]

        # Call RAG service for resolution
        result = rag_client.resolve_citations(
            document_id=document_id,
            citations=citations_payload,
        )

        resolved_results = result.get("results", [])
        resolved_count = 0

        # Update each resolved citation in the database
        for r in resolved_results:
            if r.get("resolved") and r.get("to_document_id"):
                db_client.update_citation_resolution(
                    citation_id=r["citation_id"],
                    to_document_id=r["to_document_id"],
                    confidence=r.get("confidence", 0.0),
                    resolver_method=r.get("resolver_method", "auto"),
                )
                resolved_count += 1

        logger.info(
            "resolve_citations_task complete: document=%s total=%d resolved=%d",
            document_id,
            len(citations),
            resolved_count,
        )

        return {
            "document_id": document_id,
            "total_citations": len(citations),
            "resolved_count": resolved_count,
            "unresolved_count": len(citations) - resolved_count,
            "status": "completed",
        }

    except Exception as exc:
        logger.error(
            "resolve_citations_task failed: document=%s error=%s",
            document_id,
            str(exc),
        )
        if self.request.retries >= self.max_retries:
            logger.error(
                "resolve_citations_task giving up after %d retries: document=%s",
                self.max_retries,
                document_id,
            )
        raise self.retry(exc=exc)
