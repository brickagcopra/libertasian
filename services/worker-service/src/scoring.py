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

# Sections one generated item can be expected to ground itself in.
#
# These exist because source_passage_coverage used to be divided by EVERY
# section of the source document, which made the term unreachable for any
# artifact smaller than its source: a 5-card deck over a 40-section decision
# can cite a handful of sections at most, so coverage was structurally under
# 0.25 and the score could not clear the 0.70 auto-approval bar however well
# grounded the deck was. Measured on prod 2026-07-26, the per-type maxima were
# flashcard 0.692, essay_prompt 0.688, doctrine_extract 0.667 and
# subject_outline 0.655 — every one of them exactly 0.5 + coverage * 0.5, i.e.
# citation mapping and OCR were already perfect and coverage alone held them
# under the bar. mcq_question cleared it only because a 20-30 question set
# cites enough distinct sections to reach 40% of a document.
#
# The denominator is now what the artifact could plausibly cite: its own item
# count times the sections an item is expected to cite. The generation prompts
# require "at least one source section ID" per item (see prompts/*.py) and the
# emitted shapes carry a list, so two is the allowance for list-valued shapes.
# doctrine_extract carries a SINGLE source_section_id per doctrine, so one.
#
# This keeps the CLAUDE.md weights (0.5 / 0.3 / 0.2) and still fails a badly
# grounded artifact: an item count of N with only N/5 distinct valid citations
# scores 0.1 coverage, which lands at 0.55 and stays out of auto-approval.
SECTIONS_PER_ITEM: int = 2
SECTIONS_PER_ITEM_SINGLE_REF: int = 1


def compute_source_passage_coverage(
    *,
    cited_section_count: int,
    item_count: int,
    source_section_count: int,
    sections_per_item: int = SECTIONS_PER_ITEM,
) -> float:
    """Fraction of the sections this artifact could cite that it did cite.

    The denominator is ``min(source_section_count, item_count *
    sections_per_item)`` — the document cannot offer more sections than it
    has, and the artifact cannot cite more than its items allow.

    Args:
        cited_section_count: Distinct valid source section IDs the artifact
            cites. Must already be filtered to IDs that exist in the source.
        item_count: Number of generated items (cards, questions, doctrines,
            outline nodes). Zero means nothing was generated.
        source_section_count: Sections available in the source document.
        sections_per_item: Sections one item is expected to cite. Use
            ``SECTIONS_PER_ITEM_SINGLE_REF`` for shapes carrying one ID.

    Returns:
        Ratio in [0, 1]. Zero when nothing was generated, nothing was cited,
        or the source had no sections.
    """
    if cited_section_count <= 0 or item_count <= 0 or source_section_count <= 0:
        return 0.0

    citable = min(source_section_count, item_count * max(sections_per_item, 1))
    if citable <= 0:
        return 0.0

    return min(cited_section_count / citable, 1.0)


def compute_derivative_confidence_score(
    *,
    source_passage_coverage: float,
    citation_mapping_completeness: float,
    ocr_quality: float = 1.0,
) -> float:
    """Compute confidence score for a derivative artifact.

    Args:
        source_passage_coverage: Ratio of the sections the derivative could
            plausibly cite that it did cite — see
            :func:`compute_source_passage_coverage`. NOT cited-over-every-
            section-in-the-document, which no artifact smaller than its source
            can push toward 1.0. Range [0, 1].
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
    source_passage_coverage = compute_source_passage_coverage(
        cited_section_count=len(cited_section_ids),
        item_count=len(outline_sections),
        source_section_count=source_section_count,
    )

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

    source_passage_coverage = compute_source_passage_coverage(
        cited_section_count=len(cited_section_ids),
        item_count=len(questions),
        source_section_count=source_section_count,
    )

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

    # One source_section_id per doctrine, so one section per item — not two.
    source_passage_coverage = compute_source_passage_coverage(
        cited_section_count=len(cited_section_ids),
        item_count=len(doctrines),
        source_section_count=source_section_count,
        sections_per_item=SECTIONS_PER_ITEM_SINGLE_REF,
    )

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

    source_passage_coverage = compute_source_passage_coverage(
        cited_section_count=len(cited_section_ids),
        item_count=len(cards),
        source_section_count=source_section_count,
    )

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

    # Every walked node (top-level section or subSection) is an item.
    source_passage_coverage = compute_source_passage_coverage(
        cited_section_count=len(cited_section_ids),
        item_count=total_sections,
        source_section_count=source_section_count,
    )

    if total_sections > 0:
        citation_mapping_completeness = sections_with_citations / total_sections
    else:
        citation_mapping_completeness = 0.0

    return compute_derivative_confidence_score(
        source_passage_coverage=source_passage_coverage,
        citation_mapping_completeness=citation_mapping_completeness,
        ocr_quality=ocr_quality,
    )
