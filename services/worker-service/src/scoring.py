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


def compute_mcq_confidence_score(
    *,
    content: dict[str, Any],
    source_sections: list[dict[str, Any]],
    ocr_quality: float = 1.0,
) -> float:
    """Compute confidence score for an MCQ derivative.

    Extracts MCQ-specific signals from the LLM output:
    - Source passage coverage: unique valid cited section IDs across all
      questions / total source sections.
    - Citation mapping completeness: questions with at least one valid
      supportingSectionId / total questions.

    The MCQ prompt emits ``supportingSectionIds`` (not ``citedSectionIds``)
    on each question — see prompts/mcq_generation_v1.py.

    Args:
        content: Parsed LLM output with a ``questions`` list.
        source_sections: Source document sections (each must have an "id" key).
        ocr_quality: OCR quality of the source document. Defaults to 1.0
            for non-scan sources.

    Returns:
        Confidence score clamped to [0, 1].
    """
    source_section_ids = {s["id"] for s in source_sections}
    source_section_count = len(source_section_ids)

    cited_section_ids: set[str] = set()
    questions = content.get("questions", [])
    if not isinstance(questions, list):
        questions = []

    for question in questions:
        if not isinstance(question, dict):
            continue
        for sid in question.get("supportingSectionIds", []) or []:
            if sid in source_section_ids:
                cited_section_ids.add(sid)

    if source_section_count > 0:
        source_passage_coverage = len(cited_section_ids) / source_section_count
    else:
        source_passage_coverage = 0.0

    question_count = len(questions)
    if question_count > 0:
        questions_with_citations = sum(
            1
            for q in questions
            if isinstance(q, dict)
            and any(
                sid in source_section_ids
                for sid in (q.get("supportingSectionIds", []) or [])
            )
        )
        citation_mapping_completeness = questions_with_citations / question_count
    else:
        citation_mapping_completeness = 0.0

    return compute_derivative_confidence_score(
        source_passage_coverage=source_passage_coverage,
        citation_mapping_completeness=citation_mapping_completeness,
        ocr_quality=ocr_quality,
    )


def compute_doctrine_confidence_score(
    *,
    content: dict[str, Any],
    source_sections: list[dict[str, Any]],
    ocr_quality: float = 1.0,
) -> float:
    """Compute confidence score for a doctrine-extract derivative.

    Extracts doctrine-specific signals from the RAG output:
    - Source passage coverage: unique valid ``source_section_id`` values
      across all doctrines / total source sections.
    - Citation mapping completeness: doctrines whose ``source_section_id``
      matches a source section / total doctrines.

    The RAG doctrine endpoint returns snake_case keys — each doctrine
    carries a single ``source_section_id`` (not a list). See
    tasks/doctrine_generation_tasks.py._build_provenance_records.

    Args:
        content: Parsed RAG output with a ``doctrines`` list.
        source_sections: Source document sections (each must have an "id" key).
        ocr_quality: OCR quality of the source document. Defaults to 1.0
            for non-scan sources.

    Returns:
        Confidence score clamped to [0, 1].
    """
    source_section_ids = {s["id"] for s in source_sections}
    source_section_count = len(source_section_ids)

    cited_section_ids: set[str] = set()
    doctrines = content.get("doctrines", [])
    if not isinstance(doctrines, list):
        doctrines = []

    for doctrine in doctrines:
        if not isinstance(doctrine, dict):
            continue
        sid = doctrine.get("source_section_id")
        if sid and sid in source_section_ids:
            cited_section_ids.add(sid)

    if source_section_count > 0:
        source_passage_coverage = len(cited_section_ids) / source_section_count
    else:
        source_passage_coverage = 0.0

    doctrine_count = len(doctrines)
    if doctrine_count > 0:
        doctrines_with_valid_citation = sum(
            1
            for d in doctrines
            if isinstance(d, dict)
            and d.get("source_section_id") in source_section_ids
        )
        citation_mapping_completeness = (
            doctrines_with_valid_citation / doctrine_count
        )
    else:
        citation_mapping_completeness = 0.0

    return compute_derivative_confidence_score(
        source_passage_coverage=source_passage_coverage,
        citation_mapping_completeness=citation_mapping_completeness,
        ocr_quality=ocr_quality,
    )


def compute_flashcard_confidence_score(
    *,
    content: dict[str, Any],
    source_sections: list[dict[str, Any]],
    ocr_quality: float = 1.0,
) -> float:
    """Compute confidence score for a flashcard derivative.

    Extracts flashcard-specific signals from the LLM output:
    - Source passage coverage: unique valid cited section IDs across all
      cards / total source sections.
    - Citation mapping completeness: cards with at least one valid
      supportingSectionId / total cards.

    The flashcard prompt emits ``supportingSectionIds`` on each card —
    see prompts/flashcard_generation_v1.py. Mirrors the MCQ pattern.

    Args:
        content: Parsed LLM output with a ``cards`` list.
        source_sections: Source document sections (each must have an "id" key).
        ocr_quality: OCR quality of the source document. Defaults to 1.0
            for non-scan sources.

    Returns:
        Confidence score clamped to [0, 1].
    """
    source_section_ids = {s["id"] for s in source_sections}
    source_section_count = len(source_section_ids)

    cited_section_ids: set[str] = set()
    cards = content.get("cards", [])
    if not isinstance(cards, list):
        cards = []

    for card in cards:
        if not isinstance(card, dict):
            continue
        for sid in card.get("supportingSectionIds", []) or []:
            if sid in source_section_ids:
                cited_section_ids.add(sid)

    if source_section_count > 0:
        source_passage_coverage = len(cited_section_ids) / source_section_count
    else:
        source_passage_coverage = 0.0

    card_count = len(cards)
    if card_count > 0:
        cards_with_citations = sum(
            1
            for c in cards
            if isinstance(c, dict)
            and any(
                sid in source_section_ids
                for sid in (c.get("supportingSectionIds", []) or [])
            )
        )
        citation_mapping_completeness = cards_with_citations / card_count
    else:
        citation_mapping_completeness = 0.0

    return compute_derivative_confidence_score(
        source_passage_coverage=source_passage_coverage,
        citation_mapping_completeness=citation_mapping_completeness,
        ocr_quality=ocr_quality,
    )


def compute_outline_confidence_score(
    *,
    content: dict[str, Any],
    source_sections: list[dict[str, Any]],
    ocr_quality: float = 1.0,
) -> float:
    """Compute confidence score for a subject-outline derivative.

    Extracts outline-specific signals from the LLM output:
    - Source passage coverage: unique valid cited section IDs collected
      across outline sections and their nested ``subSections`` / total
      source sections.
    - Citation mapping completeness: outline sections + subsections with
      at least one valid citation / total sections counted.

    The outline prompt emits ``content["sections"][i]`` with optional
    ``subSections[j]`` — both levels carry ``citedSectionIds``. See
    prompts/subject_outline_generation_v1.py.

    Args:
        content: Parsed LLM output with a ``sections`` list.
        source_sections: Source document sections (each must have an "id" key).
        ocr_quality: OCR quality of the source document. Defaults to 1.0
            for non-scan sources.

    Returns:
        Confidence score clamped to [0, 1].
    """
    source_section_ids = {s["id"] for s in source_sections}
    source_section_count = len(source_section_ids)

    cited_section_ids: set[str] = set()
    total_sections = 0
    sections_with_citations = 0

    def _walk(node: dict[str, Any]) -> None:
        nonlocal total_sections, sections_with_citations
        if not isinstance(node, dict):
            return
        total_sections += 1
        has_valid = False
        for sid in node.get("citedSectionIds", []) or []:
            if sid in source_section_ids:
                cited_section_ids.add(sid)
                has_valid = True
        if has_valid:
            sections_with_citations += 1
        for sub in node.get("subSections", []) or []:
            _walk(sub)

    sections = content.get("sections", [])
    if isinstance(sections, list):
        for section in sections:
            _walk(section)

    if source_section_count > 0:
        source_passage_coverage = len(cited_section_ids) / source_section_count
    else:
        source_passage_coverage = 0.0

    if total_sections > 0:
        citation_mapping_completeness = sections_with_citations / total_sections
    else:
        citation_mapping_completeness = 0.0

    return compute_derivative_confidence_score(
        source_passage_coverage=source_passage_coverage,
        citation_mapping_completeness=citation_mapping_completeness,
        ocr_quality=ocr_quality,
    )
