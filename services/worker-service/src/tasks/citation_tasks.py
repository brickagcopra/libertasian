"""LIBERTASIAN Worker Service — Citation extraction + resolution Celery tasks.

Pipeline:
  extract_for_document  (regex extractor → INSERT citations)
  resolve_for_document  (rag-service link → UPDATE to_document_id)
"""

import logging

from celery import shared_task

from ..citations import extract_citation_matches
from ..clients import db_client, ingestion_db_client, rag_client

logger = logging.getLogger(__name__)


@shared_task(
    name="citation.extract_for_document",
    bind=True,
    acks_late=True,
    reject_on_worker_lost=True,
    max_retries=2,
    default_retry_delay=30,
)
def extract_citations_for_document(
    self,  # noqa: ARG001
    legal_document_id: str,
) -> dict:  # type: ignore[type-arg]
    """Extract citations from a corpus document's section text and persist
    them as `citations` rows. Idempotent — re-runs hit the partial unique
    index ``uq_citations_section_normalized`` and skip dupes.
    """
    sections = ingestion_db_client.get_legal_document_sections_with_text(
        legal_document_id
    )
    if not sections:
        logger.info(
            "extract_citations_for_document: no sections for document=%s",
            legal_document_id,
        )
        return {
            "document_id": legal_document_id,
            "sections_scanned": 0,
            "rows_inserted": 0,
            "status": "completed",
        }

    rows: list[dict] = []  # type: ignore[type-arg]
    for sec in sections:
        text = sec.get("plain_text") or ""
        if not text:
            continue
        for match in extract_citation_matches(text):
            rows.append(
                {
                    "from_document_id": legal_document_id,
                    "from_section_id": sec["id"],
                    "citation_text": match.raw,
                    "citation_type": match.citation_type,
                    "normalized_citation": match.normalized,
                }
            )

    inserted = ingestion_db_client.insert_citations_ignore_dupes(rows)
    logger.info(
        "extract_citations_for_document: document=%s sections=%d candidates=%d inserted=%d",
        legal_document_id,
        len(sections),
        len(rows),
        inserted,
    )
    return {
        "document_id": legal_document_id,
        "sections_scanned": len(sections),
        "rows_inserted": inserted,
        "status": "completed",
    }


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
