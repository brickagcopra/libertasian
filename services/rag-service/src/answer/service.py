"""Answer service — full RAG pipeline orchestration.

Pipeline stages:
1. Intent classification (rule-based, <1ms)
2. Hybrid retrieval (BM25 + kNN + RRF fusion)
3. Cross-encoder reranking (with fallback)
4. Token-budget context packing
5. Abstention check
6. LLM generation (non-streaming or SSE)
7. Citation validation (NON-OPTIONAL)
8. Confidence scoring
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from typing import Any

from ..config import settings
from ..core.abstention import check_abstention, generate_abstention_response
from ..core.context import pack_context
from ..core.generation import generate_completion, get_model_info, stream_completion
from ..core.intent import classify_intent
from ..core.reranking import rerank_passages
from ..core.retrieval import hybrid_retrieve
from ..core.schemas import Passage
from ..core.types import AbstentionReason, ConfidenceLevel
from ..core.validation import validate_citations
from ..shared.scoring import compute_confidence
from .prompts import (
    PROMPT_VERSION,
    STREAMING_SYSTEM_PROMPT,
    SYSTEM_PROMPT,
    USER_PROMPT_TEMPLATE,
    USER_PROMPT_TEMPLATE_WITH_HISTORY,
    format_history,
)
from .schemas import AnswerChunk, AnswerRequest, AnswerResponse, AnswerSource

logger = logging.getLogger(__name__)


def _retrieval_filters(request: AnswerRequest) -> dict[str, Any] | None:
    """Translate the request's document scope into retrieval filter terms.

    ``history`` is deliberately absent here. Conversation context changes how an
    answer is written, never which passages are eligible to ground it — folding
    earlier turns into the retrieval query would let a long conversation drift
    the evidence set away from the question actually being asked.
    """
    if request.document_id is None:
        return None
    return {"document_id": request.document_id}


def _min_passages(request: AnswerRequest) -> int:
    """The passage-count floor appropriate to this request's retrieval scope.

    Scoped retrieval draws from one document, so the count reflects that
    document's length rather than how well corroborated the answer is. The
    corpus-wide floor of 3 silently hard-abstains on every short document.
    """
    if request.document_id is None:
        return settings.abstention_min_passages
    return settings.abstention_min_passages_scoped


def _build_user_prompt(request: AnswerRequest, context: str, query: str) -> str:
    """Render the user prompt, including prior turns only when there are any."""
    history_block = format_history(request.history)
    if not history_block:
        return USER_PROMPT_TEMPLATE.format(context=context, query=query)
    return USER_PROMPT_TEMPLATE_WITH_HISTORY.format(
        history=history_block,
        context=context,
        query=query,
    )


async def generate_answer(request: AnswerRequest) -> AnswerResponse:
    """Execute the full RAG pipeline and return a validated answer.

    This is the non-streaming path used by POST /answer.
    """
    query = request.query.strip()
    model_info = get_model_info()

    # 1. Intent classification
    intent = classify_intent(query)
    logger.info("Query intent: %s, query_length: %d", intent.value, len(query))

    # 2. Hybrid retrieval, narrowed to one document when the caller asked for it
    search_result = await hybrid_retrieve(
        query,
        intent,
        top_k=30,
        filter_terms=_retrieval_filters(request),
    )

    # 3. Reranking
    reranked = await rerank_passages(
        query,
        search_result.passages,
        top_k=request.max_passages,
    )

    # 4. Abstention check
    scoped = request.document_id is not None
    abstention_reason = check_abstention(reranked, min_passages=_min_passages(request))
    if abstention_reason is not None:
        abstention_text = generate_abstention_response(abstention_reason, query, scoped=scoped)
        return AnswerResponse(
            answer=abstention_text,
            query=query,
            intent=intent,
            confidence=0.0,
            confidence_level=ConfidenceLevel.LOW,
            abstained=True,
            abstention_reason=abstention_reason,
            model_name=model_info["model_name"],
            prompt_template_version=PROMPT_VERSION,
            passages_used=0,
            passages_available=len(search_result.passages),
        )

    # 5. Context packing
    context_bundle = pack_context(reranked, token_budget=settings.answer_context_tokens)

    # 6. LLM generation
    user_prompt = _build_user_prompt(request, context_bundle.formatted_context, query)
    generated_text = await generate_completion(
        system_prompt=SYSTEM_PROMPT,
        user_prompt=user_prompt,
        max_tokens=settings.answer_max_tokens,
    )

    # 7. Citation validation (NON-OPTIONAL)
    validation = await validate_citations(generated_text, reranked)

    # If validation finds invalid citations, log but still return
    # (with reduced confidence) rather than failing completely
    if not validation.is_valid:
        logger.warning(
            "Citation validation issues: %d invalid, %d unsupported claims",
            len(validation.invalid_citations),
            len(validation.unsupported_claims),
        )

    # Scoped answers must be grounded in the document, not merely produced from
    # it. Lowering the count floor above removed the check that a short document
    # could not answer at all; this replaces it with a check on whether the
    # answer actually cited the document. Zero valid citations from a
    # single-document pool means the model wrote unsupported prose, which is
    # precisely what a reader asking "what does THIS say" must never receive.
    #
    # Scoped-only on purpose: corpus-wide search keeps returning a low-confidence
    # answer with zero valid citations, as it does today. Widening this would
    # change behaviour well outside the surface being fixed.
    if scoped and validation.valid_count == 0:
        logger.info("Abstaining: scoped answer produced no valid citations")
        return AnswerResponse(
            answer=generate_abstention_response(
                AbstentionReason.VALIDATION_FAILED, query, scoped=True
            ),
            query=query,
            intent=intent,
            confidence=0.0,
            confidence_level=ConfidenceLevel.LOW,
            abstained=True,
            abstention_reason=AbstentionReason.VALIDATION_FAILED,
            model_name=model_info["model_name"],
            prompt_template_version=PROMPT_VERSION,
            passages_used=context_bundle.passages_included,
            passages_available=context_bundle.passages_total,
        )

    # 8. Confidence scoring
    confidence = compute_confidence(
        cited_refs=validation.valid_citations,
        source_passages=reranked,
        valid_citation_count=validation.valid_count,
    )

    confidence_level = _confidence_to_level(confidence)

    # Build sources list
    sources: list[AnswerSource] = []
    if request.include_sources:
        sources = [_passage_to_source(p) for p in reranked]

    return AnswerResponse(
        answer=generated_text,
        query=query,
        intent=intent,
        confidence=confidence,
        confidence_level=confidence_level,
        citations=validation.valid_citations,
        sources=sources,
        abstained=False,
        abstention_reason=None,
        model_name=model_info["model_name"],
        prompt_template_version=PROMPT_VERSION,
        passages_used=context_bundle.passages_included,
        passages_available=context_bundle.passages_total,
    )


async def stream_answer(request: AnswerRequest) -> AsyncIterator[AnswerChunk]:
    """Execute the RAG pipeline with SSE streaming for the generation step.

    Yields AnswerChunk objects:
    - type="metadata": initial metadata (intent, sources) before generation starts
    - type="text": incremental text chunks during generation
    - type="done": final chunk with confidence and citation info
    - type="error": if something goes wrong
    """
    query = request.query.strip()
    model_info = get_model_info()

    try:
        # 1-4: Same as non-streaming
        intent = classify_intent(query)
        search_result = await hybrid_retrieve(
            query,
            intent,
            top_k=30,
            filter_terms=_retrieval_filters(request),
        )
        reranked = await rerank_passages(
            query,
            search_result.passages,
            top_k=request.max_passages,
        )

        # Abstention check
        scoped = request.document_id is not None
        abstention_reason = check_abstention(reranked, min_passages=_min_passages(request))
        if abstention_reason is not None:
            abstention_text = generate_abstention_response(
                abstention_reason, query, scoped=scoped
            )
            yield AnswerChunk(
                type="metadata",
                metadata={
                    "intent": intent.value,
                    "abstained": True,
                    "abstention_reason": abstention_reason.value,
                },
            )
            yield AnswerChunk(type="text", content=abstention_text)
            yield AnswerChunk(type="done")
            return

        # Context packing
        context_bundle = pack_context(reranked, token_budget=settings.answer_context_tokens)

        # Emit metadata chunk before streaming starts
        sources = [_passage_to_source(p).model_dump() for p in reranked]
        yield AnswerChunk(
            type="metadata",
            metadata={
                "intent": intent.value,
                "passages_used": context_bundle.passages_included,
                "passages_available": context_bundle.passages_total,
                "sources": sources,
            },
        )

        # 5. Stream generation
        user_prompt = _build_user_prompt(request, context_bundle.formatted_context, query)

        full_text = ""
        async for chunk in stream_completion(
            system_prompt=STREAMING_SYSTEM_PROMPT,
            user_prompt=user_prompt,
            max_tokens=settings.answer_max_tokens,
        ):
            full_text += chunk
            yield AnswerChunk(type="text", content=chunk)

        # 6. Post-generation validation
        validation = await validate_citations(full_text, reranked)
        confidence = compute_confidence(
            cited_refs=validation.valid_citations,
            source_passages=reranked,
            valid_citation_count=validation.valid_count,
        )

        # Same scoped grounding check as the non-streaming path. It can only run
        # after generation, by which point the text has already been streamed to
        # the client — so the abstention is signalled on the TERMINAL chunk and
        # the client is expected to discard the text it has, exactly as it would
        # for a pre-generation abstention. No further `text` chunk is emitted:
        # text chunks append, so one here would leave the reader holding the
        # unsupported answer with a disclaimer stapled to the end of it.
        if scoped and validation.valid_count == 0:
            logger.info("Abstaining: scoped stream produced no valid citations")
            yield AnswerChunk(
                type="done",
                metadata={
                    "abstained": True,
                    "abstention_reason": AbstentionReason.VALIDATION_FAILED.value,
                    "abstention_text": generate_abstention_response(
                        AbstentionReason.VALIDATION_FAILED, query, scoped=True
                    ),
                    "confidence": 0.0,
                    "confidence_level": ConfidenceLevel.LOW.value,
                    "valid_citations": 0,
                    "total_citations": validation.total_count,
                    "model_name": model_info["model_name"],
                    "prompt_template_version": PROMPT_VERSION,
                },
            )
            return

        yield AnswerChunk(
            type="done",
            metadata={
                "confidence": confidence,
                "confidence_level": _confidence_to_level(confidence).value,
                "valid_citations": validation.valid_count,
                "total_citations": validation.total_count,
                "model_name": model_info["model_name"],
                "prompt_template_version": PROMPT_VERSION,
            },
        )

    except Exception as exc:
        logger.exception("Error in streaming answer pipeline")
        yield AnswerChunk(
            type="error",
            content=f"An error occurred while generating the answer: {type(exc).__name__}",
        )


def _confidence_to_level(confidence: float) -> ConfidenceLevel:
    """Map numeric confidence to discrete level."""
    if confidence >= 0.7:
        return ConfidenceLevel.HIGH
    if confidence >= 0.4:
        return ConfidenceLevel.MEDIUM
    return ConfidenceLevel.LOW


def _passage_to_source(passage: Passage) -> AnswerSource:
    """Convert a Passage to an AnswerSource for the response."""
    return AnswerSource(
        document_id=passage.document_id,
        section_id=passage.section_id,
        title=passage.title,
        citation_text=passage.citation_text,
        court=passage.court,
        decision_date=passage.decision_date,
        document_type=passage.document_type,
        relevance_score=round(passage.score, 4),
    )
