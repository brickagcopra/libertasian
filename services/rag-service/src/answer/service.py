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
from ..core.clients import embed_query
from ..core.context import pack_context
from ..core.generation import generate_completion, get_model_info, stream_completion
from ..core.intent import classify_intent
from ..core.reranking import rerank_passages
from ..core.retrieval import hybrid_retrieve
from ..core.schemas import Passage, RerankOutcome, SearchResult
from ..core.types import AbstentionReason, ConfidenceLevel
from ..core.validation import validate_citations
from ..shared.scoring import compute_confidence
from .prompts import (
    INSUFFICIENT_SOURCES_SENTINEL,
    PROMPT_VERSION,
    STREAMING_SYSTEM_PROMPT,
    SYSTEM_PROMPT,
    USER_PROMPT_TEMPLATE,
    USER_PROMPT_TEMPLATE_WITH_HISTORY,
    format_history,
)
from .schemas import AnswerChunk, AnswerRequest, AnswerResponse, AnswerSource

logger = logging.getLogger(__name__)

# Characters a model may wrap or terminate the sentinel line with. Stripped
# before comparison so `**INSUFFICIENT_SOURCES**` or a trailing full stop still
# reads as a refusal rather than as an answer.
_SENTINEL_DECORATION = ".!?…\"'*`_ \t"

# What the sentinel means, in AbstentionReason terms.
#
# NOT ``NO_RESULTS``: that copy reads "I was unable to find any relevant legal
# documents matching your query", which is simply false here — retrieval found
# passages (8 of them on the prod queries that triggered this), cleared the
# count floor, and was packed into the prompt. The model then judged those
# passages irrelevant to the question. ``LOW_RELEVANCE`` says exactly that
# ("The documents I found do not appear to be sufficiently relevant..."), and
# its scoped variant is equally accurate. ``NO_RESULTS`` stays for the case it
# describes: retrieval genuinely returning nothing.
_SENTINEL_ABSTENTION_REASON = AbstentionReason.LOW_RELEVANCE

# How much of the stream to hold back before the first `text` chunk is emitted.
# The sentinel is 20 characters, so a window wider than it — bounded by the
# first newline — is enough to recognise it in full while costing at most one
# short chunk of perceived latency. The alternative, streaming the sentinel and
# retracting it, shows the reader a raw token.
_SENTINEL_PROBE_CHARS = 40


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


def _is_insufficient_sentinel(text: str) -> bool:
    """True when the model answered with the INSUFFICIENT_SOURCES marker.

    Matched against the FIRST LINE rather than the whole response, so a model
    that disobeys "and nothing else" and staples an explanation underneath the
    marker still abstains — the marker is the signal, the prose after it is the
    behaviour we removed. Comparison is case-insensitive with surrounding
    punctuation and emphasis stripped, because a stray full stop or a pair of
    asterisks must not turn a refusal back into a confident-looking answer.
    """
    first_line = text.strip().split("\n", 1)[0]
    return first_line.strip(_SENTINEL_DECORATION).upper() == INSUFFICIENT_SOURCES_SENTINEL


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

    # 2. Hybrid retrieval, narrowed to one document when the caller asked for it.
    # The embedding is computed once per request and handed to both retrieval
    # legs; `None` is a supported value that runs BM25-only.
    embedding = await embed_query(query)
    search_result = await hybrid_retrieve(
        query,
        intent,
        top_k=30,
        embedding=embedding,
        filter_terms=_retrieval_filters(request),
    )

    # 3. Reranking. `degraded_legs` says whether the cross-encoder actually
    # ran; RRF order is a fallback, not an equivalent.
    rerank_outcome = await rerank_passages(
        query,
        search_result.passages,
        top_k=request.max_passages,
    )
    reranked = rerank_outcome.passages
    degraded_legs = _merge_degraded_legs(search_result, rerank_outcome)

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
            degraded=bool(degraded_legs),
            degraded_legs=degraded_legs,
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

    # 7. Explicit non-answer check, before validation — a sentinel response has
    # nothing to validate, and scoring it would produce a confidence number for
    # a refusal.
    if _is_insufficient_sentinel(generated_text):
        logger.info("Abstaining: model emitted the INSUFFICIENT_SOURCES sentinel")
        return AnswerResponse(
            answer=generate_abstention_response(
                _SENTINEL_ABSTENTION_REASON, query, scoped=scoped
            ),
            query=query,
            intent=intent,
            confidence=0.0,
            confidence_level=ConfidenceLevel.LOW,
            abstained=True,
            abstention_reason=_SENTINEL_ABSTENTION_REASON,
            model_name=model_info["model_name"],
            prompt_template_version=PROMPT_VERSION,
            passages_used=context_bundle.passages_included,
            passages_available=context_bundle.passages_total,
            degraded=bool(degraded_legs),
            degraded_legs=degraded_legs,
        )

    # 8. Citation validation (NON-OPTIONAL)
    validation = await validate_citations(generated_text, reranked)

    # If validation finds invalid citations, log but still return
    # (with reduced confidence) rather than failing completely
    if not validation.is_valid:
        logger.warning(
            "Citation validation issues: %d invalid, %d unsupported claims",
            len(validation.invalid_citations),
            len(validation.unsupported_claims),
        )

    # An answer must be grounded in the passages, not merely produced from them.
    # Zero valid citations means the model wrote prose no source backs — for a
    # scoped reader asking "what does THIS say", and equally for a corpus-wide
    # question, where prod returned exactly that with `abstained: false` and a
    # confidence badge on it. The check was scoped-only when it was introduced
    # to contain the blast radius; measurement on live traffic showed the
    # corpus-wide case is where it matters most, so it now applies to both.
    if validation.valid_count == 0:
        logger.info(
            "Abstaining: answer produced no valid citations (scoped=%s)", scoped
        )
        return AnswerResponse(
            answer=generate_abstention_response(
                AbstentionReason.VALIDATION_FAILED, query, scoped=scoped
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
            degraded=bool(degraded_legs),
            degraded_legs=degraded_legs,
        )

    # 9. Confidence scoring
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
        degraded=bool(degraded_legs),
        degraded_legs=degraded_legs,
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
        embedding = await embed_query(query)
        search_result = await hybrid_retrieve(
            query,
            intent,
            top_k=30,
            embedding=embedding,
            filter_terms=_retrieval_filters(request),
        )
        rerank_outcome = await rerank_passages(
            query,
            search_result.passages,
            top_k=request.max_passages,
        )
        reranked = rerank_outcome.passages
        degraded_legs = _merge_degraded_legs(search_result, rerank_outcome)

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
                    "degraded": bool(degraded_legs),
                    "degraded_legs": degraded_legs,
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
                "degraded": bool(degraded_legs),
                "degraded_legs": degraded_legs,
            },
        )

        # 5. Stream generation
        user_prompt = _build_user_prompt(request, context_bundle.formatted_context, query)

        # The first `_SENTINEL_PROBE_CHARS` (or the first line, whichever comes
        # first) are withheld so an INSUFFICIENT_SOURCES response is recognised
        # before any of it reaches the client. Text chunks append on both
        # clients, so streaming the sentinel and retracting it would flash a raw
        # token at the reader; holding one short chunk back costs nothing
        # visible. Once the gate opens every subsequent chunk passes straight
        # through, so streaming behaviour past the first line is unchanged.
        full_text = ""
        pending = ""
        gate_open = False
        sentinel_seen = False

        async for chunk in stream_completion(
            system_prompt=STREAMING_SYSTEM_PROMPT,
            user_prompt=user_prompt,
            max_tokens=settings.answer_max_tokens,
        ):
            full_text += chunk
            if gate_open:
                yield AnswerChunk(type="text", content=chunk)
                continue

            pending += chunk
            if "\n" not in pending and len(pending) < _SENTINEL_PROBE_CHARS:
                continue

            if _is_insufficient_sentinel(pending):
                sentinel_seen = True
                break

            gate_open = True
            yield AnswerChunk(type="text", content=pending)
            pending = ""

        # A response shorter than the probe window never opened the gate — which
        # is exactly the shape of a bare sentinel (20 characters, no newline).
        if not sentinel_seen and not gate_open:
            if _is_insufficient_sentinel(pending):
                sentinel_seen = True
            elif pending:
                yield AnswerChunk(type="text", content=pending)

        if sentinel_seen:
            logger.info("Abstaining: stream emitted the INSUFFICIENT_SOURCES sentinel")
            yield AnswerChunk(
                type="done",
                metadata={
                    "abstained": True,
                    "abstention_reason": _SENTINEL_ABSTENTION_REASON.value,
                    "abstention_text": generate_abstention_response(
                        _SENTINEL_ABSTENTION_REASON, query, scoped=scoped
                    ),
                    "confidence": 0.0,
                    "confidence_level": ConfidenceLevel.LOW.value,
                    "valid_citations": 0,
                    "total_citations": 0,
                    "model_name": model_info["model_name"],
                    "prompt_template_version": PROMPT_VERSION,
                },
            )
            return

        # 6. Post-generation validation
        validation = await validate_citations(full_text, reranked)
        confidence = compute_confidence(
            cited_refs=validation.valid_citations,
            source_passages=reranked,
            valid_citation_count=validation.valid_count,
        )

        # Same grounding check as the non-streaming path, and like it, no longer
        # scoped-only. It can only run after generation, by which point the text
        # has already been streamed to the client — so the abstention is
        # signalled on the TERMINAL chunk and the client is expected to discard
        # the text it has, exactly as it would for a pre-generation abstention.
        # No further `text` chunk is emitted: text chunks append, so one here
        # would leave the reader holding the unsupported answer with a
        # disclaimer stapled to the end of it.
        if validation.valid_count == 0:
            logger.info(
                "Abstaining: stream produced no valid citations (scoped=%s)", scoped
            )
            yield AnswerChunk(
                type="done",
                metadata={
                    "abstained": True,
                    "abstention_reason": AbstentionReason.VALIDATION_FAILED.value,
                    "abstention_text": generate_abstention_response(
                        AbstentionReason.VALIDATION_FAILED, query, scoped=scoped
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


def _merge_degraded_legs(
    search_result: SearchResult, rerank_outcome: RerankOutcome
) -> list[str]:
    """Collect every leg that did not contribute, retrieval and reranking alike.

    Both stages already report their own degradation; the answer response is the
    first place a caller can see them together, which is the only place the
    distinction between "no good passages exist" and "half the pipeline was
    down" is actually actionable.
    """
    return [*search_result.degraded_legs, *rerank_outcome.degraded_legs]


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
        # Real cross-encoder scores span 0.98 down to 7e-4, so `relevance_score`'s
        # 4dp rounding would flatten the whole bottom of that range to 0.0 and
        # make the threshold un-fittable from the very traffic it is fit against.
        rerank_score=(
            round(passage.rerank_score, 6) if passage.rerank_score is not None else None
        ),
    )
