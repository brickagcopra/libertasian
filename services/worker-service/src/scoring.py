"""Confidence score computation for derivative artifacts.

Per CLAUDE.md: "Confidence score is computed from: source passage coverage
ratio + citation mapping completeness + OCR quality (if from scan)."

Formula:
    (source_passage_coverage * 0.5) +
    (citation_mapping_completeness * 0.3) +
    (ocr_quality * 0.2)

Clamped to [0, 1].  All functions are pure — no I/O, no side effects.
"""

from __future__ import annotations

from typing import Any

# Weight constants for confidence scoring formula (per CLAUDE.md)
SOURCE_PASSAGE_COVERAGE_WEIGHT: float = 0.5
CITATION_MAPPING_COMPLETENESS_WEIGHT: float = 0.3
OCR_QUALITY_WEIGHT: float = 0.2


def compute_derivative_confidence_score(
    *,
    source_passage_coverage: float,
    citation_mapping_completeness: float,
    ocr_quality: float = 1.0,
) -> float:
    """Compute confidence score for a derivative artifact.

    Args:
        source_passage_coverage: Ratio of source sections cited by the
            derivative to total source sections provided. Range [0, 1].
        citation_mapping_completeness: Ratio of derivative output sections
            that include at least one valid citation to total output sections.
            Range [0, 1].
        ocr_quality: OCR quality score of the source document. Defaults to
            1.0 for non-scan sources. Range [0, 1].

    Returns:
        Confidence score clamped to [0, 1], rounded to 4 decimal places.
    """
    coverage = max(0.0, min(source_passage_coverage, 1.0))
    citation = max(0.0, min(citation_mapping_completeness, 1.0))
    ocr = max(0.0, min(ocr_quality, 1.0))

    score = (
        coverage * SOURCE_PASSAGE_COVERAGE_WEIGHT
        + citation * CITATION_MAPPING_COMPLETENESS_WEIGHT
        + ocr * OCR_QUALITY_WEIGHT
    )

    return round(max(0.0, min(score, 1.0)), 4)


def compute_essay_confidence_score(
    *,
    content: dict[str, Any],
    source_sections: list[dict[str, Any]],
    ocr_quality: float = 1.0,
) -> float:
    """Compute confidence score for an essay prompt derivative.

    Extracts essay-specific signals from the LLM output:
    - Source passage coverage: unique valid cited section IDs / total source
      sections
    - Citation mapping completeness: outline sections with at least one
      citation / total outline sections

    Args:
        content: Parsed LLM output with modelAnswer.outlineSections.
        source_sections: Source document sections (each must have an "id" key).
        ocr_quality: OCR quality of the source document. Defaults to 1.0
            for non-scan sources.

    Returns:
        Confidence score clamped to [0, 1].
    """
    source_section_ids = {s["id"] for s in source_sections}
    source_section_count = len(source_section_ids)

    # Extract cited section IDs from model answer outline sections
    cited_section_ids: set[str] = set()
    outline_sections: list[dict[str, Any]] = []

    model_answer = content.get("modelAnswer")
    if isinstance(model_answer, dict):
        outline_sections = model_answer.get("outlineSections", [])
        for section in outline_sections:
            if not isinstance(section, dict):
                continue
            for sid in section.get("citedSectionIds", []):
                if sid in source_section_ids:
                    cited_section_ids.add(sid)

    # Source passage coverage ratio
    if source_section_count > 0:
        source_passage_coverage = len(cited_section_ids) / source_section_count
    else:
        source_passage_coverage = 0.0

    # Citation mapping completeness ratio
    outline_section_count = len(outline_sections)
    if outline_section_count > 0:
        sections_with_citations = sum(
            1
            for s in outline_sections
            if isinstance(s, dict) and s.get("citedSectionIds")
        )
        citation_mapping_completeness = (
            sections_with_citations / outline_section_count
        )
    else:
        citation_mapping_completeness = 0.0

    return compute_derivative_confidence_score(
        source_passage_coverage=source_passage_coverage,
        citation_mapping_completeness=citation_mapping_completeness,
        ocr_quality=ocr_quality,
    )
