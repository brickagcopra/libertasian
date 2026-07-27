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
# THE MEASURED CORPUS (prod, 2026-07-26). Source documents average **3.4
# sections**: mcq 3.4, essay 3.4, flashcard 3.4, doctrine 4.4. Check any change
# to this file against that number, not against an intuition about long
# decisions — the difference has already produced one wrong fix.
#
# These constants come from #313, which fixed a real bug: coverage used to be
# divided by every section of the source document, so an artifact smaller than
# its source could not push the term up. But the fixture that motivated it
# assumed a 40-section decision, which is the INVERSE of this corpus. Because
# item_count * 2 (10 or more for any normal artifact) almost never binds
# against 3.4 sections, the min() denominator equals source_section_count for
# ~99.97% of rows: #313 is correct and very nearly inert here, and re-scoring
# the existing corpus under it moved 7 rows out of 29,471.
#
# What that leaves, measured: on a 3-section source coverage can only be 0,
# 1/3, 2/3 or 1, so the score can only be 0.5, 0.667, 0.833 or 1.0 and the 0.70
# bar reduces to "cite 2 of the 3 sections". Whether that is the editorial
# standard we want is an open product question, NOT something to fix by
# re-tuning these constants on a hunch — a taper attempt (#316) inverted the
# defect and pushed essay_prompt from 37% to 95.5% above the bar, because the
# terms that would receive any freed weight are themselves near-constant.
#
# The denominator is what the artifact could plausibly cite: its own item count
# times the sections an item is expected to cite. The generation prompts
# require "at least one source section ID" per item (see prompts/*.py) and the
# emitted shapes carry a list, so two is the allowance for list-valued shapes.
# doctrine_extract carries a SINGLE source_section_id per doctrine, so one.
#
# (mcq_question is scored differently in practice: one artifact is written per
# question but the score is computed once over the whole generated set and
# copied onto every row — confirmed at 100% on prod, all 14,099 MCQ source
# documents carry exactly one distinct score across their rows. An mcq row's
# stored score is a property of its batch, not of its own content.)
SECTIONS_PER_ITEM: int = 2
SECTIONS_PER_ITEM_SINGLE_REF: int = 1

# Coverage denominators.
#
# CITABLE is the live one. DOCUMENT is the pre-#313 denominator — every section
# of the source document — and exists for exactly one reason: the re-score
# script must be able to reproduce a stored score before it is allowed to
# overwrite it, and stored scores were produced by DOCUMENT. Reproducing the
# old value through the SAME extraction code is what proves the script reads a
# row correctly; a re-score that cannot reproduce the current value has no
# business writing a new one.
#
# Never score a new artifact with DOCUMENT. It is unreachable above 0.70 for
# any artifact smaller than its source, which is the bug #313 fixed.
COVERAGE_MODE_CITABLE = "citable"
COVERAGE_MODE_DOCUMENT = "document"

# Citation-mapping modes. Only essay_prompt has ever had more than one.
#
# VALIDATED is the live one: an item counts as cited when at least one of the
# IDs it carries exists in the source document. flashcard, mcq_question,
# doctrine_extract and subject_outline have always worked this way.
#
# essay_prompt did not. It counted ``bool(section["citedSectionIds"])`` — a
# non-empty list, whatever was in it — so an outline section citing a
# fabricated UUID scored exactly like one citing correctly, and the term
# measured whether the model had obeyed an output-format instruction. Measured
# on prod 2026-07-27: 39,992 of 67,515 essay citation refs (59.2%) resolved to
# no row in legal_document_sections, and none resolved to a section of any
# other document, so they were invented rather than mis-attributed. The term
# read 99.0% across the corpus regardless.
#
# PRESENCE preserves that behaviour for one caller only, for the same reason
# COVERAGE_MODE_DOCUMENT exists: rescore_derivatives must reproduce the score
# already stored on a row before it is allowed to overwrite it, and every
# stored essay score was produced under presence. A reproduction check that
# silently recomputes under the new rule proves nothing.
#
# Never score a new artifact with PRESENCE.
CITATION_MODE_VALIDATED = "validated"
CITATION_MODE_PRESENCE = "presence"


def compute_source_passage_coverage(
    *,
    cited_section_count: int,
    item_count: int,
    source_section_count: int,
    sections_per_item: int = SECTIONS_PER_ITEM,
    coverage_mode: str = COVERAGE_MODE_CITABLE,
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
    if cited_section_count <= 0 or source_section_count <= 0:
        return 0.0

    if coverage_mode == COVERAGE_MODE_DOCUMENT:
        # Reproduction only — see COVERAGE_MODE_DOCUMENT.
        return min(cited_section_count / source_section_count, 1.0)

    if item_count <= 0:
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

            NOTE: no generation task passes this argument — grep `ocr_quality`
            under src/tasks/ and you will find nothing. Every pipeline-produced
            derivative therefore scores with ocr_quality = 1.0, so this term is
            a constant 0.2 added to every artifact rather than a signal. It
            only varies if a caller supplies it, which nothing currently does.

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
    coverage_mode: str = COVERAGE_MODE_CITABLE,
    citation_mode: str = CITATION_MODE_VALIDATED,
) -> float:
    """Compute confidence score for an essay prompt derivative.

    Extracts essay-specific signals from the LLM output:
    - Source passage coverage: unique valid cited section IDs / total source
      sections
    - Citation mapping completeness: outline sections with at least one
      cited section ID **that exists in the source document** / total outline
      sections

    Args:
        content: Parsed LLM output with modelAnswer.outlineSections.
        source_sections: Source document sections (each must have an "id" key).
        ocr_quality: OCR quality of the source document. Defaults to 1.0
            for non-scan sources.
        citation_mode: ``CITATION_MODE_VALIDATED`` (the live rule, matching
            the other four types) or ``CITATION_MODE_PRESENCE`` (reproduction
            of stored scores only — see :data:`CITATION_MODE_PRESENCE`).

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
        coverage_mode=coverage_mode,
    )

    # Citation mapping completeness ratio
    outline_section_count = len(outline_sections)
    if outline_section_count > 0:
        if citation_mode == CITATION_MODE_PRESENCE:
            # Reproduction only — see CITATION_MODE_PRESENCE. Counts a
            # non-empty list whatever is in it, including invented IDs.
            sections_with_citations = sum(
                1
                for s in outline_sections
                if isinstance(s, dict) and s.get("citedSectionIds")
            )
        else:
            sections_with_citations = sum(
                1
                for s in outline_sections
                if isinstance(s, dict)
                and any(
                    sid in source_section_ids
                    for sid in (s.get("citedSectionIds") or [])
                )
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
    coverage_mode: str = COVERAGE_MODE_CITABLE,
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
        coverage_mode=coverage_mode,
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
    coverage_mode: str = COVERAGE_MODE_CITABLE,
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
        coverage_mode=coverage_mode,
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
    coverage_mode: str = COVERAGE_MODE_CITABLE,
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
        coverage_mode=coverage_mode,
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
    coverage_mode: str = COVERAGE_MODE_CITABLE,
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
        coverage_mode=coverage_mode,
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
