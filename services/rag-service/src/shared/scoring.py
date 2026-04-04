"""Confidence scoring utilities for RAG pipeline outputs.

Per CLAUDE.md: score = source coverage + citation mapping + quality factor.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ..core.schemas import CitationRef, Passage


def compute_confidence(
    cited_refs: list[CitationRef],
    source_passages: list[Passage],
    valid_citation_count: int,
) -> float:
    """Compute a 0.0–1.0 confidence score for generated output.

    Factors:
    - Source coverage: ratio of passages that were cited vs total available
    - Citation validity: ratio of valid citations vs total cited
    - Passage availability: at least 5 passages for full score

    Returns:
        Confidence score rounded to 2 decimal places.
    """
    total_citations = len(cited_refs)
    total_passages = len(source_passages)

    # Source coverage: what fraction of available passages were cited
    cited_doc_ids = {c.source_id for c in cited_refs}
    passage_doc_ids = {p.document_id for p in source_passages}
    if passage_doc_ids:
        source_coverage = len(cited_doc_ids & passage_doc_ids) / len(passage_doc_ids)
    else:
        source_coverage = 0.0

    # Citation validity: what fraction of citations point to real documents
    if total_citations > 0:
        citation_validity = valid_citation_count / total_citations
    else:
        citation_validity = 0.0

    # Passage availability: at least 5 for full score
    passage_factor = min(total_passages / 5, 1.0) if total_passages > 0 else 0.0

    confidence = source_coverage * 0.3 + citation_validity * 0.4 + passage_factor * 0.3
    return round(max(0.0, min(1.0, confidence)), 2)
