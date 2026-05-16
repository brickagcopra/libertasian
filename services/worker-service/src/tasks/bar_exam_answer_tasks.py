"""Bar exam ALAC answer generation — Phase 3a.

Admin-triggered Celery task that produces an AI-generated ALAC (Answer,
Law, Analysis, Conclusion) answer for each given past bar exam question
and writes the row to ``bar_exam_answers`` with ``review_status='pending'``
so an admin can vet it before it goes public.

Cost protection:
  - Hard cap MAX_QUESTIONS_PER_DISPATCH (defense in depth — the API
    enforces the same cap at request time).
  - Idempotency: skip if a row with the same (question_id, answer_type)
    already exists. Re-dispatch is a no-op for already-generated answers.
  - NO Celery Beat entry — admin trigger only.

This task is the simplest possible flow: LLM call → parse → write. It does
NOT go through the NestJS internal-derivative endpoints used by
essay/digest generation because there is no multi-table provenance to
record — a bar_exam_answers row is self-contained.
"""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Any

from celery import shared_task

from ..clients import ingestion_db_client as db
from ..clients import rag_client
from ..prompts.bar_exam_alac_v1 import (
    BAR_EXAM_ALAC_SYSTEM_PROMPT,
    PROMPT_TEMPLATE_VERSION,
    PROMPT_TEMPLATE_VERSION_V2,
    build_user_prompt,
    parse_alac_response,
    render_answer_markdown,
)

logger = logging.getLogger(__name__)

# Hard cap on questions per admin dispatch — LLM cost protection. The NestJS
# admin controller enforces the same cap at request time; this is defense in
# depth so a manually-crafted Celery message can't bypass it either.
MAX_QUESTIONS_PER_DISPATCH = 50

# Retrieval toggle + size. Default-on so deployments pick up grounding without
# a config flip; set ``BAR_EXAM_RAG_ENABLED=false`` to fall straight back to
# priors-only generation if retrieval misbehaves.
BAR_EXAM_RAG_ENABLED: bool = (
    os.getenv("BAR_EXAM_RAG_ENABLED", "true").lower() == "true"
)


def _resolve_top_k() -> int:
    raw = os.getenv("BAR_EXAM_RAG_TOP_K", "8")
    try:
        value = int(raw)
    except ValueError:
        return 8
    return max(1, min(20, value))


BAR_EXAM_RAG_TOP_K: int = _resolve_top_k()


@shared_task(
    bind=True,
    name="bar_exam.generate_answers_for_questions",
    acks_late=True,
    reject_on_worker_lost=True,
    max_retries=2,
    retry_backoff=True,
    retry_backoff_max=300,
)
def generate_answers_for_questions(
    self: Any,
    question_ids: list[str],
    force_regenerate: bool = False,
) -> dict[str, Any]:
    """Generate ALAC answers for the given question IDs.

    Returns a summary dict the dispatcher can log:
        {
          "requested": int,
          "skipped_existing": int,
          "generated": int,
          "failed": int,
          "results": [{question_id, status, ...}, ...],
        }
    ``status`` is one of: ``generated``, ``skipped_existing``,
    ``question_not_found``, ``llm_invalid_json``, ``llm_malformed``,
    ``llm_abstained``, ``error``.
    """
    if not question_ids:
        return {
            "requested": 0,
            "skipped_existing": 0,
            "generated": 0,
            "failed": 0,
            "results": [],
        }

    capped_ids = question_ids[:MAX_QUESTIONS_PER_DISPATCH]
    truncated = len(question_ids) - len(capped_ids)
    if truncated > 0:
        logger.warning(
            "generate_answers_for_questions: requested %d, truncated to %d "
            "(MAX_QUESTIONS_PER_DISPATCH=%d)",
            len(question_ids),
            len(capped_ids),
            MAX_QUESTIONS_PER_DISPATCH,
        )

    skipped = 0
    generated = 0
    failed = 0
    results: list[dict[str, Any]] = []

    for question_id in capped_ids:
        result = _generate_one(question_id, force_regenerate=force_regenerate)
        results.append(result)
        status = result["status"]
        if status == "generated":
            generated += 1
        elif status == "skipped_existing":
            skipped += 1
        else:
            failed += 1

    return {
        "requested": len(question_ids),
        "capped": len(capped_ids),
        "skipped_existing": skipped,
        "generated": generated,
        "failed": failed,
        "results": results,
    }


def _generate_one(
    question_id: str,
    force_regenerate: bool = False,
) -> dict[str, Any]:
    """Generate (or skip) the AI answer for a single question.

    Wrapping the per-question work in a function with broad exception
    handling means one bad question doesn't poison the whole batch — the
    surrounding loop keeps going and the result dict records what
    happened.

    ``force_regenerate`` first deletes the row IF it is still pending,
    then proceeds to the usual exists-skip / generate path. The delete
    WHERE clause restricts to ``review_status='pending'``, so approved or
    rejected rows are physically untouchable — they fall through to the
    skip path below.
    """
    try:
        if force_regenerate:
            db.delete_pending_bar_exam_answer(
                question_id,
                answer_type="ai_generated",
            )

        if db.bar_exam_answer_exists(question_id, answer_type="ai_generated"):
            return {
                "question_id": question_id,
                "status": "skipped_existing",
            }

        question = db.get_bar_exam_question_with_context(question_id)
        if question is None:
            return {
                "question_id": question_id,
                "status": "question_not_found",
            }

        source_passages: list[dict[str, Any]] | None = None
        used_rag = False
        if BAR_EXAM_RAG_ENABLED:
            try:
                retrieved = rag_client.retrieve_passages(
                    query=question["question_text"],
                    top_k=BAR_EXAM_RAG_TOP_K,
                    filter_terms=None,
                    question_id=question_id,
                )
            except Exception as exc:  # noqa: BLE001 — retrieval is best-effort
                logger.warning(
                    "bar_exam_answer: retrieval raised for question %s: %s",
                    question_id,
                    exc,
                )
                retrieved = []
            if retrieved:
                source_passages = retrieved
                used_rag = True
                logger.info(
                    "bar_exam_answer: retrieved %d passages for question %s",
                    len(retrieved),
                    question_id,
                )
            else:
                logger.warning(
                    "bar_exam_answer: retrieval returned no passages for "
                    "question %s — falling back to priors-only",
                    question_id,
                )

        prompt_version = (
            PROMPT_TEMPLATE_VERSION_V2 if used_rag else PROMPT_TEMPLATE_VERSION
        )

        user_prompt = build_user_prompt(
            question_text=question["question_text"],
            subject_code=question.get("subject_study_code"),
            sitting_year=int(question["sitting_year"]),
            source_passages=source_passages,
        )

        start = time.monotonic()
        llm_response = rag_client.generate_completion(
            system_prompt=BAR_EXAM_ALAC_SYSTEM_PROMPT,
            user_prompt=user_prompt,
            temperature=0.2,
        )
        latency_ms = int((time.monotonic() - start) * 1000)

        model_name = llm_response.get("model_name", "unknown")
        tokens_in = llm_response.get("tokens_in", 0)
        tokens_out = llm_response.get("tokens_out", 0)

        raw_content = llm_response.get("content")
        if isinstance(raw_content, str):
            try:
                content = json.loads(raw_content)
            except json.JSONDecodeError:
                logger.warning(
                    "bar_exam_answer: LLM returned non-JSON for question %s",
                    question_id,
                )
                return {
                    "question_id": question_id,
                    "status": "llm_invalid_json",
                }
        elif isinstance(raw_content, dict):
            content = raw_content
        else:
            logger.warning(
                "bar_exam_answer: LLM returned unexpected content type for "
                "question %s",
                question_id,
            )
            return {
                "question_id": question_id,
                "status": "llm_malformed",
            }

        if isinstance(content, dict) and content.get("abstain") is True:
            reason = content.get("abstainReason") or "unspecified"
            logger.info(
                "bar_exam_answer: LLM abstained on question %s (%s)",
                question_id,
                reason,
            )
            return {
                "question_id": question_id,
                "status": "llm_abstained",
                "reason": reason,
            }

        structured = parse_alac_response(content)
        if structured is None:
            logger.warning(
                "bar_exam_answer: LLM output missing required ALAC fields "
                "for question %s",
                question_id,
            )
            return {
                "question_id": question_id,
                "status": "llm_malformed",
            }

        answer_text = render_answer_markdown(structured)

        model_run_id = db.create_model_run(
            run_type="bar_exam_answer_generation",
            model_name=model_name,
            prompt_template_version=prompt_version,
            input_ref=f"bar_exam_question:{question_id}",
            output_ref=None,
            confidence=None,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            latency_ms=latency_ms,
        )

        answer_id = db.create_bar_exam_answer(
            bar_exam_question_id=question_id,
            answer_text=answer_text,
            structured_answer=structured,
            answer_type="ai_generated",
            model_run_id=model_run_id,
            review_status="pending",
            visibility="private",
        )

        return {
            "question_id": question_id,
            "status": "generated",
            "answer_id": answer_id,
            "model_run_id": model_run_id,
        }

    except Exception as exc:  # noqa: BLE001 — keep batch alive on per-question errors
        logger.exception(
            "bar_exam_answer: unexpected error for question %s",
            question_id,
        )
        return {
            "question_id": question_id,
            "status": "error",
            "error": str(exc),
        }
