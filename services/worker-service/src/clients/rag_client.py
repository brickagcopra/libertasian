"""LIBERTASIAN Worker Service — RAG service HTTP client.

Uses httpx (synchronous) since Celery tasks are sync.
Per CLAUDE.md: NestJS is the single gateway for clients, but
internal services can call each other over internal HTTP.
"""

import logging
from typing import Any

import httpx

from ..config import settings

logger = logging.getLogger(__name__)


def _internal_headers() -> dict[str, str]:
    """Return auth headers for internal service-to-service calls."""
    return {"X-Internal-Api-Key": settings.internal_api_key}


def extract_doctrines(
    document_id: str,
    strategy: str = "auto",
    document_text: str | None = None,
    sections: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Call RAG service to extract doctrines from a document.

    Args:
        document_id: UUID of the legal document.
        strategy: Extraction strategy ('auto', 'full_text', 'sections_only').
        document_text: Optional pre-fetched full text.
        sections: Optional pre-fetched sections list.

    Returns:
        Dict with doctrines list, strategy_used, model_name, prompt_template_version.
    """
    url = f"{settings.rag_service_url}/doctrines/extract"
    payload: dict[str, Any] = {
        "document_id": document_id,
        "strategy": strategy,
    }
    if document_text is not None:
        payload["document_text"] = document_text
    if sections is not None:
        payload["sections"] = sections

    with httpx.Client(timeout=settings.rag_request_timeout) as client:
        response = client.post(url, json=payload, headers=_internal_headers())
        response.raise_for_status()
        return response.json()


def generate_digest(
    document_id: str,
    sections: list[dict[str, Any]],
    document_type: str = "case",
) -> dict[str, Any]:
    """Call RAG service to generate a structured DFIR+ digest.

    Args:
        document_id: UUID of the legal document.
        sections: Document sections with id, section_type, section_label, plain_text, etc.
        document_type: Type of document (case, statute, rule, issuance).

    Returns:
        Dict with DFIR+ fields, provenance, confidence_score, model_name, etc.
    """
    url = f"{settings.rag_service_url}/digests/generate"
    payload: dict[str, Any] = {
        "document_id": document_id,
        "sections": sections,
        "document_type": document_type,
    }

    with httpx.Client(timeout=settings.rag_request_timeout) as client:
        response = client.post(url, json=payload, headers=_internal_headers())
        response.raise_for_status()
        return response.json()


def resolve_citations(
    document_id: str,
    citations: list[dict[str, Any]],
) -> dict[str, Any]:
    """Call RAG service to resolve unresolved citations.

    Args:
        document_id: UUID of the document whose citations to resolve.
        citations: List of citation dicts with id, citation_text, normalized_citation, etc.

    Returns:
        Dict with resolution results.
    """
    url = f"{settings.rag_service_url}/citations/resolve"
    payload = {
        "document_id": document_id,
        "citations": citations,
    }

    with httpx.Client(timeout=settings.rag_request_timeout) as client:
        response = client.post(url, json=payload, headers=_internal_headers())
        response.raise_for_status()
        return response.json()


def retrieve_passages(
    query: str,
    top_k: int = 8,
    filter_terms: dict[str, Any] | None = None,
    question_id: str | None = None,
) -> list[dict[str, Any]]:
    """Retrieve BM25 passages from rag-service for prompt grounding.

    Returns a list of ``{id, section_id, document_id, title, text, score}``
    dicts suitable for the bar exam ALAC prompt builder. ``Passage.title`` can
    be empty for sections, so we fall back to ``citation_text`` and then a
    generic ``"Source"`` label so the prompt always has something to attribute
    each passage to.

    ``section_id``, ``document_id`` and ``score`` are preserved rather than
    flattened away, and each carries its weight:

    * ``section_id`` is the only id a generated citation can be checked
      against — it is what ``legal_document_sections.id`` holds. Discarding it
      (as this function did until 2026-08-05) left ``id``, the OpenSearch hit
      id, as the sole identifier in the prompt, so a model that cited
      faithfully still produced ids that could not be resolved against the
      corpus. Note it is nullable: measured on prod 2026-08-05, 71-85% of
      retrieved passages carry one, and a passage without one is simply not
      citable.
    * ``document_id`` is what distinct-authority breadth is measured over —
      three sections of one statute is a narrower answer than three
      authorities, and only this field can tell them apart.
    * ``score`` is raw, uncalibrated BM25. It is deliberately NOT part of the
      confidence score (see ``scoring.compute_bar_exam_answer_confidence``);
      it is carried so the dry-run script can report its spread and a future
      relevance-floor term can be evaluated against real numbers instead of
      assumed into existence.

    Any HTTP / network failure is swallowed and logged at WARNING; callers
    treat ``[]`` as a soft retrieval failure and fall back to priors-only
    generation. ``question_id`` is purely for log context.
    """
    url = f"{settings.rag_service_url}/passages/retrieve"
    payload: dict[str, Any] = {"query": query, "top_k": top_k}
    if filter_terms is not None:
        payload["filter_terms"] = filter_terms

    try:
        with httpx.Client(timeout=settings.rag_request_timeout) as client:
            response = client.post(url, json=payload, headers=_internal_headers())
            response.raise_for_status()
            data = response.json()
    except Exception as exc:  # noqa: BLE001 — retrieval is best-effort
        logger.warning(
            "rag_client.retrieve_passages failed (question_id=%s): %s",
            question_id,
            exc,
        )
        return []

    passages = data.get("passages", []) if isinstance(data, dict) else []
    flattened: list[dict[str, Any]] = []
    for p in passages:
        if not isinstance(p, dict):
            continue
        title = p.get("title") or p.get("citation_text") or "Source"
        section_id = p.get("section_id")
        flattened.append(
            {
                "id": p.get("id", ""),
                "section_id": str(section_id) if section_id else None,
                "document_id": p.get("document_id", "") or "",
                "title": title,
                "text": p.get("text", ""),
                "score": float(p.get("score", 0.0) or 0.0),
            }
        )
    return flattened


def generate_completion(
    system_prompt: str,
    user_prompt: str,
    temperature: float = 0,
) -> dict[str, Any]:
    """Call RAG service generic completion endpoint for structured output.

    Args:
        system_prompt: System prompt with instructions.
        user_prompt: User prompt with document content.
        temperature: LLM temperature (0 for deterministic classification).

    Returns:
        Dict with content (str or dict), model_name, tokens_in, tokens_out.
    """
    url = f"{settings.rag_service_url}/completions/generate"
    payload: dict[str, Any] = {
        "system_prompt": system_prompt,
        "user_prompt": user_prompt,
        "temperature": temperature,
        "response_format": "json",
    }

    with httpx.Client(timeout=settings.rag_request_timeout) as client:
        response = client.post(url, json=payload, headers=_internal_headers())
        response.raise_for_status()
        return response.json()
