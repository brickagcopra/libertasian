"""Confidence scoring for bar exam ALAC answers.

Separate from ``scoring.py`` on purpose. That module scores derivative
artifacts against a *source document* — coverage is measured over the sections
of the one document an artifact was generated from. A bar exam answer has no
source document: it is generated from a retrieved passage set drawn from the
whole corpus, so every denominator in that formula is undefined here, and
importing its shape would import assumptions that do not hold.

WHAT THE TERMS MEASURE, AND WHY THEY ARE THE ONES LEFT
======================================================

Measured on prod 2026-08-05 with the #356 fix simulated — 48 real questions,
6 per subject, all 8 subjects, through the live ``retrieve_by_query`` path:

* **48/48 returned the full 8 passages. Zero misses.**
* Average top BM25 score ranged 161-682 by subject.
* 71-85% of passages carried a ``section_id``.

That measurement kills two obvious terms before they are written:

* ``min(1, passages_retrieved / top_k)`` is a **constant 1.0** on every row.
  It is the ``ocr_quality`` failure CLAUDE.md documents — a term that adds a
  flat amount to everything and discriminates between nothing.
* "share of the 8 retrieved passages that were cited" has a **constant
  denominator**, because ``top_k`` is pinned at 8 and always fills. Scores
  would quantize to eighths and an answer citing 2 sources would cap at 0.25,
  making the 0.70 bar unreachable by construction. That is the PR #313
  denominator bug, and CLAUDE.md is explicit that an unreachable gate is an
  outage rather than a quality control.

So the discriminating signal has to come from the **answer** side, where the
variance actually is. Two terms, equally weighted:

``citation_resolution`` (0.5)
    Of the section ids the model emitted, the share that survive filtering —
    present in the retrieved set AND resolving to a real
    ``legal_document_sections`` row. This is the term CLAUDE.md endorses
    ("A citation only counts if the section ID resolves") and the one that
    punishes fabrication. Denominator is what the model claimed, which varies
    per answer. An answer that emitted nothing scores 0 here, so a
    priors-only answer cannot climb.

``authority_breadth`` (0.5)
    Distinct **documents** covered by the surviving ids, over
    ``min(BREADTH_TARGET, distinct documents available in the retrieved
    set)``. Documents, not sections: three sections of one statute is a
    narrower answer than a provision plus a leading case, and only the
    document id can tell those apart. The denominator is capped by what
    retrieval actually offered, so the term is always reachable — an answer
    that cites every authority it was given scores 1.0 even when it was given
    one.

WHAT IS DELIBERATELY NOT IN THE FORMULA
=======================================

* **No constant term.** Every term can be 0 and every term can be 1.
* **No raw BM25.** ``Passage.score`` has real spread (161-682 by subject) but
  it is uncalibrated and correlates with query length, so a threshold over it
  would encode question phrasing as answer quality. Normalizing it needs data
  that does not exist yet; the dry-run script reports its distribution so the
  decision can be made on numbers rather than on this comment.
* **No relevance-floor passage count.** Counting passages above a score floor
  could restore discrimination on the retrieval side, but whether it does is
  an empirical question. The dry-run script emits candidate-floor counts as
  diagnostics; it is not a term until those numbers say it earns one.

WHAT 0.70 MEANS UNDER THIS FORMULA
==================================

Stated plainly, the way CLAUDE.md states it for digests ("cite 2 of the 3
sections"): with equal weights and a breadth target of 3, **0.70 is roughly
"cite at least two distinct grounded authorities and fabricate nothing"**.

    2 valid ids of 2 emitted, spanning 2 documents  -> 0.833  (passes)
    3 valid ids of 3 emitted, spanning 3 documents  -> 1.000  (passes)
    1 valid id  of 1 emitted, spanning 1 document   -> 0.667  (fails)
    2 valid ids of 4 emitted, spanning 2 documents  -> 0.583  (fails)
    0 ids emitted (priors-only)                     -> 0.000  (fails)

These weights were NOT tuned to produce any particular pass rate — no pilot
had run when they were written, and doing so would be fitting the gate to the
corpus rather than to an editorial standard. The pilot decides whether the
standard is right, and per CLAUDE.md the response to a disappointing
distribution is to fix what the terms measure, not to move the bar.
"""

from __future__ import annotations

from typing import NamedTuple

# Equal weights: fabrication and narrowness are different failures and neither
# is secondary. A fluent answer citing one real section is as unpublishable as
# a broad answer citing three invented ones.
CITATION_RESOLUTION_WEIGHT: float = 0.5
AUTHORITY_BREADTH_WEIGHT: float = 0.5

# Distinct authorities a full-credit answer is expected to ground itself in.
# Three is the ALAC shape: a controlling provision, a leading case, and room
# for one more without demanding the model cite everything it was handed. It
# is a TARGET, not a corpus measurement — the denominator is capped by what
# retrieval actually returned, so it can never make the score unreachable.
BREADTH_TARGET: int = 3


class BarExamConfidence(NamedTuple):
    """A score plus the terms that produced it.

    The components travel with the score because a bare float cannot be
    argued with. The dry-run script reports them per row, and a distribution
    that clusters at one value is a statement about the term, not the corpus.
    """

    score: float
    citation_resolution: float
    authority_breadth: float
    emitted_id_count: int
    valid_id_count: int
    cited_document_count: int
    available_document_count: int

    @property
    def fabricated_id_count(self) -> int:
        """Ids the model emitted that no retrieved, resolvable section backs."""
        return max(0, self.emitted_id_count - self.valid_id_count)


def compute_bar_exam_answer_confidence(
    *,
    emitted_id_count: int,
    valid_id_count: int,
    cited_document_count: int,
    available_document_count: int,
    breadth_target: int = BREADTH_TARGET,
) -> BarExamConfidence:
    """Score one bar exam answer in [0, 1].

    Args:
        emitted_id_count: Ids in ``citedSectionIds`` as the model returned
            them, after normalization but BEFORE filtering. Zero for a
            priors-only answer.
        valid_id_count: How many of those survived filtering — in the
            retrieved passage set AND resolving to a real
            ``legal_document_sections`` row. Must be <= emitted_id_count;
            it is clamped rather than trusted.
        cited_document_count: Distinct ``legal_documents`` the surviving ids
            belong to.
        available_document_count: Distinct ``legal_documents`` represented in
            the retrieved passage set. Zero when retrieval returned nothing.
        breadth_target: Distinct authorities wanted for full credit.

    Returns:
        A ``BarExamConfidence``. Every input at zero yields a score of 0.0 —
        a priors-only answer scores the floor, never the ceiling.
    """
    emitted = max(0, emitted_id_count)
    valid = max(0, min(valid_id_count, emitted))
    available_docs = max(0, available_document_count)
    cited_docs = max(0, cited_document_count)

    # Nothing claimed means nothing to verify. This is the priors-only case
    # and it must not be rewarded for having made no checkable assertion.
    citation_resolution = (valid / emitted) if emitted > 0 else 0.0

    # Capped by what retrieval actually offered, so "cited everything
    # available" is full credit even when only one authority was available.
    breadth_denominator = min(max(1, breadth_target), available_docs)
    if breadth_denominator <= 0 or valid == 0:
        authority_breadth = 0.0
    else:
        authority_breadth = min(1.0, cited_docs / breadth_denominator)

    score = (
        citation_resolution * CITATION_RESOLUTION_WEIGHT
        + authority_breadth * AUTHORITY_BREADTH_WEIGHT
    )

    return BarExamConfidence(
        score=round(max(0.0, min(1.0, score)), 4),
        citation_resolution=round(citation_resolution, 4),
        authority_breadth=round(authority_breadth, 4),
        emitted_id_count=emitted,
        valid_id_count=valid,
        cited_document_count=cited_docs,
        available_document_count=available_docs,
    )


def score_from_passages(
    *,
    emitted_section_ids: list[str],
    valid_section_ids: list[str],
    passages: list[dict[str, object]],
) -> BarExamConfidence:
    """Convenience wrapper: derive the document counts from the passage set.

    ``valid_section_ids`` must already be filtered — in the retrieved set and
    resolved against ``legal_document_sections``. This function does not
    validate ids; it only counts what the caller has already established, so
    that "which ids are real" has exactly one implementation and it is the one
    that runs before the write.
    """
    valid = set(valid_section_ids)
    documents_by_section: dict[str, str] = {}
    available_documents: set[str] = set()

    for passage in passages or []:
        document_id = str(passage.get("document_id") or "")
        section_id = passage.get("section_id")
        if document_id:
            available_documents.add(document_id)
        if section_id and document_id:
            documents_by_section[str(section_id)] = document_id

    cited_documents = {
        documents_by_section[sid] for sid in valid if sid in documents_by_section
    }

    return compute_bar_exam_answer_confidence(
        emitted_id_count=len(emitted_section_ids),
        valid_id_count=len(valid),
        cited_document_count=len(cited_documents),
        available_document_count=len(available_documents),
    )
