"""Passage formatting utilities — consolidated from duplicated implementations."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ..core.schemas import Passage


def format_passages(passages: list[Passage]) -> str:
    """Format retrieved passages into a context string with source anchors.

    Output format per passage::

        [SOURCE {document_id}§{section_id}] {title} | {citation_text} | {court} | {date}
        {text}

    Passages are separated by ``---``.
    """
    if not passages:
        return "(No source passages available.)"

    parts: list[str] = []
    for p in passages:
        header = f"[SOURCE {p.document_id}"
        if p.section_id:
            header += f"§{p.section_id}"
        header += f"] {p.title}"
        if p.citation_text:
            header += f" | {p.citation_text}"
        if p.court:
            header += f" | {p.court}"
        if p.decision_date:
            header += f" | {p.decision_date}"

        parts.append(f"{header}\n{p.text}")

    return "\n\n---\n\n".join(parts)


def format_passages_compact(passages: list[Passage]) -> str:
    """Compact format for token-constrained contexts. Omits metadata fields."""
    if not passages:
        return "(No source passages available.)"

    parts: list[str] = []
    for p in passages:
        source_ref = f"[{p.document_id}"
        if p.section_id:
            source_ref += f"§{p.section_id}"
        source_ref += "]"
        parts.append(f"{source_ref} {p.text}")

    return "\n---\n".join(parts)


def format_multi_doc_passages(
    passages_by_doc: dict[str, list[Passage]],
    empty_message: str = "(No documents available.)",
) -> str:
    """Format passages from multiple documents into labeled context blocks.

    Used by comparisons, contradictions, timelines, hearing_prep for
    multi-document analysis prompts.

    Output format::

        === DOCUMENT {doc_id} | {title} | {citation} | {court} | {date} ===
        [SOURCE {doc_id}§{section_id}] ({section_type})
        {text}

        ---

        === DOCUMENT {doc_id2} | ... ===
        ...
    """
    if not passages_by_doc:
        return empty_message

    parts: list[str] = []
    for doc_id, passages in passages_by_doc.items():
        if not passages:
            parts.append(f"=== DOCUMENT {doc_id} ===\n(No passages available)")
            continue

        first = passages[0]
        header = f"=== DOCUMENT {doc_id} | {first.title}"
        if first.citation_text:
            header += f" | {first.citation_text}"
        if first.court:
            header += f" | {first.court}"
        if first.decision_date:
            header += f" | {first.decision_date}"
        header += " ==="

        passage_parts: list[str] = []
        for p in passages:
            anchor = f"[SOURCE {doc_id}"
            if p.section_id:
                anchor += f"§{p.section_id}"
            anchor += "]"

            label = anchor
            if p.document_type:
                label += f" ({p.document_type})"

            passage_parts.append(f"{label}\n{p.text}")

        parts.append(header + "\n" + "\n\n".join(passage_parts))

    return "\n\n---\n\n".join(parts)
