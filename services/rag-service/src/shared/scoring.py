"""Confidence scoring utilities for RAG pipeline outputs.

Per CLAUDE.md: score = source coverage + citation mapping + quality factor.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ..core.schemas import CitationRef, Passage


def _passage_coverage(
    cited_refs: list[CitationRef],
    source_passages: list[Passage],
) -> float:
    """Fraction of the supplied passages that the answer actually cited.

    The docstring on ``compute_confidence`` has always promised "ratio of
    passages that were cited vs total available", but the implementation
    compared sets of DOCUMENT ids. Retrieval routinely returns several passages
    from one document — prod returns 8 passages from a single document on a
    corpus-wide query — so a single citation covered the entire denominator and
    scored 1.0. The coverage term contributed nothing but a constant.

    A passage counts as covered when a citation names its
    ``(document_id, section_id)`` pair. Where either side lacks a section id the
    match falls back to ``document_id``, so partially-sectioned data (and the
    document-level ``[SOURCE id]`` form the model is also allowed to emit) is
    not scored as zero coverage.
    """
    if not source_passages:
        return 0.0

    cited_pairs = {(c.source_id, c.section_id) for c in cited_refs}
    cited_docs = {c.source_id for c in cited_refs}
    docs_cited_without_section = {c.source_id for c in cited_refs if c.section_id is None}

    covered = 0
    for passage in source_passages:
        if passage.section_id is None:
            if passage.document_id in cited_docs:
                covered += 1
        elif (
            (passage.document_id, passage.section_id) in cited_pairs
            or passage.document_id in docs_cited_without_section
        ):
            covered += 1

    return covered / len(source_passages)


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

    source_coverage = _passage_coverage(cited_refs, source_passages)

    # Citation validity: what fraction of citations point to real documents
    if total_citations > 0:
        citation_validity = valid_citation_count / total_citations
    else:
        citation_validity = 0.0

    # Passage availability: at least 5 for full score
    passage_factor = min(total_passages / 5, 1.0) if total_passages > 0 else 0.0

    confidence = source_coverage * 0.3 + citation_validity * 0.4 + passage_factor * 0.3
    return round(max(0.0, min(1.0, confidence)), 2)
