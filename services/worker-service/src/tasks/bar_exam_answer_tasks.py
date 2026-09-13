"""Bar exam ALAC answer generation — Phase 3a.

Admin-triggered Celery task that produces an AI-generated ALAC (Answer,
Law, Analysis, Conclusion) answer for each given past bar exam question
and writes the row to ``bar_exam_answers`` with ``review_status='pending'``
so an admin can vet it before it goes public.

Two entry points:

``generate_answers_for_questions(question_ids)``
    The original direct task: generate for an explicit list, no bookkeeping.

``run_answer_generation_job(job_id)``
    The queued path (Phase 3b). Claims up to ``CHUNK_SIZE`` queued items of a
    ``bar_exam_answer_generation_jobs`` row, runs them, records each outcome on
    its item row, and re-enqueues itself while queued items remain. Chunking is
    not an optimisation — Redis's ``visibility_timeout`` defaults to 1h, so a
    single task covering all 1,375 unanswered questions would be redelivered
    underneath itself and generate everything twice.

Cost protection:
  - Idempotency: skip if a row with the same (question_id, answer_type)
    already exists. Re-dispatch is a no-op for already-generated answers.
  - Budget: a ``BudgetExceededError`` from rag-service pauses the job
    (``paused_budget``) with the current item returned to ``queued``, instead
    of burning through every remaining item marking it failed.
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

from ..budget_ledger import build_ledger_entry
from ..budget_scopes import SCOPE_BAR_EXAM_ANSWER
from ..clients import ingestion_db_client as db
from ..clients import nestjs_client, rag_client
from ..clients.rag_client import BudgetExceededError
from ..prompts.bar_exam_alac_v1 import (
    BAR_EXAM_ALAC_SYSTEM_PROMPT,
    PROMPT_TEMPLATE_VERSION,
    build_user_prompt,
    parse_alac_response,
    render_answer_markdown,
)
from ..prompts.bar_exam_alac_v2 import (
    BAR_EXAM_ALAC_V2_SYSTEM_PROMPT,
    filter_cited_section_ids,
)
from ..prompts.bar_exam_alac_v2 import (
    PROMPT_TEMPLATE_VERSION as PROMPT_TEMPLATE_VERSION_V2,
)
from ..prompts.bar_exam_alac_v2 import (
    build_user_prompt as build_user_prompt_v2,
)
from ..prompts.bar_exam_alac_v2 import (
    parse_alac_response as parse_alac_response_v2,
)
from ..prompts.bar_exam_alac_v2 import (
    render_answer_markdown as render_answer_markdown_v2,
)
from ..prompts.bar_exam_alac_v3 import BAR_EXAM_ALAC_V3_SYSTEM_PROMPT
from ..prompts.bar_exam_alac_v3 import (
    PROMPT_TEMPLATE_VERSION as PROMPT_TEMPLATE_VERSION_V3,
)
from ..prompts.bar_exam_alac_v3 import (
    build_user_prompt as build_user_prompt_v3,
)
from ..scoring_bar_exam import BREADTH_TARGET, score_from_passages

logger = logging.getLogger(__name__)

# How many items one chunk of ``run_answer_generation_job`` claims before it
# re-enqueues itself. Sized so a chunk finishes far inside Redis's 1h
# visibility_timeout even at the slow end of LLM latency.
CHUNK_SIZE = 20

# An item claimed by a worker that then died stays 'running' forever and the
# job can never finish. Anything older than this at the start of a chunk goes
# back to 'queued'.
STALE_RUNNING_MINUTES = 15

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

# Which grounded prompt template runs when retrieval returns passages.
# Priors-only generation is unaffected — with no passages there is no closed
# list to cite from, so it stays v1 whatever this says.
#
# Default "v2" on purpose: deploying the v3 template must change nothing until
# someone flips the flag. A generation job is running on prod, and a prompt
# swap arriving with a deploy would silently split that job's output across
# two templates mid-run.
SUPPORTED_GROUNDED_PROMPT_VERSIONS = ("v2", "v3")
DEFAULT_GROUNDED_PROMPT_VERSION = "v2"


def _resolve_prompt_version() -> str:
    raw = os.getenv("BAR_EXAM_PROMPT_VERSION", DEFAULT_GROUNDED_PROMPT_VERSION)
    value = (raw or "").strip().lower()
    if value in SUPPORTED_GROUNDED_PROMPT_VERSIONS:
        return value
    logger.warning(
        "bar_exam_answer: BAR_EXAM_PROMPT_VERSION=%r is not one of %s — "
        "falling back to %s",
        raw,
        SUPPORTED_GROUNDED_PROMPT_VERSIONS,
        DEFAULT_GROUNDED_PROMPT_VERSION,
    )
    return DEFAULT_GROUNDED_PROMPT_VERSION


BAR_EXAM_PROMPT_VERSION: str = _resolve_prompt_version()


def _grounded_template() -> tuple[str, str, Any]:
    """``(prompt_template_version, system_prompt, build_user_prompt)``.

    Read through the module global rather than the environment so the value is
    resolved (and its warning logged) once at import, and so a test can select
    a template by patching one name.

    The version returned here is the one written to ``model_runs``: whatever
    ran is what gets recorded, because a stored template version that does not
    match the prompt that produced the row makes every later comparison
    between templates meaningless.
    """
    if BAR_EXAM_PROMPT_VERSION == "v3":
        return (
            PROMPT_TEMPLATE_VERSION_V3,
            BAR_EXAM_ALAC_V3_SYSTEM_PROMPT,
            build_user_prompt_v3,
        )
    return (
        PROMPT_TEMPLATE_VERSION_V2,
        BAR_EXAM_ALAC_V2_SYSTEM_PROMPT,
        build_user_prompt_v2,
    )


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

    There is no cap on ``question_ids``. The cap used to be 50 at both this
    task and the API, which meant re-dispatching the same filter re-picked the
    same already-answered 50 and generation could never get past them. Bounded
    work now comes from the job/item chunking in
    ``run_answer_generation_job``, not from silently dropping the tail of a
    request.
    """
    if not question_ids:
        return {
            "requested": 0,
            "skipped_existing": 0,
            "generated": 0,
            "failed": 0,
            "results": [],
        }

    skipped = 0
    generated = 0
    failed = 0
    results: list[dict[str, Any]] = []

    for question_id in question_ids:
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

        # The grounded path (v2 or v3, per BAR_EXAM_PROMPT_VERSION) prints a
        # closed list of citable section ids and demands citedSectionIds back.
        # It is selected only when retrieval actually returned something,
        # because with no passages the closed list is empty and the whole
        # contract is vacuous — a priors-only answer is still a v1 answer, and
        # the stored prompt_template_version stays an honest record of which
        # one ran. v2 and v3 share parse/filter/render, so everything below
        # this block is version-independent.
        use_grounded = used_rag

        if use_grounded:
            prompt_version, system_prompt, build_prompt = _grounded_template()
        else:
            prompt_version = PROMPT_TEMPLATE_VERSION
            system_prompt = BAR_EXAM_ALAC_SYSTEM_PROMPT
            build_prompt = build_user_prompt

        user_prompt = build_prompt(
            question_text=question["question_text"],
            subject_code=question.get("subject_study_code"),
            sitting_year=int(question["sitting_year"]),
            source_passages=source_passages,
        )

        start = time.monotonic()
        llm_response = rag_client.generate_completion(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            temperature=0.2,
            scope=SCOPE_BAR_EXAM_ANSWER,
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

        parse = parse_alac_response_v2 if use_grounded else parse_alac_response
        structured = parse(content)
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

        # Filter cited ids BEFORE anything reads them — scoring, the stored
        # structured answer and the rendered markdown all run off `structured`.
        # An id survives only if it was in the retrieved set AND resolves to a
        # real legal_document_sections row; the two checks answer different
        # questions ("was the model shown this?" and "does it exist?") and a
        # stale index makes them disagree.
        emitted_ids: list[str] = []
        confidence = None
        dropped_ids = 0
        if use_grounded:
            emitted_ids = list(structured.get("citedSectionIds") or [])
            retrieved_ids = {
                str(p["section_id"])
                for p in (source_passages or [])
                if p.get("section_id")
            }
            resolved = db.resolve_section_ids(retrieved_ids & set(emitted_ids))
            structured, _kept, dropped_ids = filter_cited_section_ids(
                structured,
                set(resolved),
            )
            if dropped_ids:
                logger.warning(
                    "bar_exam_answer: dropped %d unresolvable citedSectionIds "
                    "(kept %d) for question %s",
                    dropped_ids,
                    _kept,
                    question_id,
                )

            scored = score_from_passages(
                emitted_section_ids=emitted_ids,
                valid_section_ids=list(structured.get("citedSectionIds") or []),
                passages=source_passages or [],
            )
            confidence = scored.score

            # Persist the COUNTS behind the score. Without them the breadth
            # denominator is unrecoverable after the fact — the retrieved
            # passage set is not stored anywhere — and a report that
            # reconstructs it from surviving citations can only ever produce a
            # LOWER bound, which would misclassify rows downward and hide the
            # very effect the denominator breakout exists to show (0.70 asks
            # for two clean authorities at denominator 3 but only one at
            # denominator 2).
            #
            # Counts only: no BM25 scores, no document ids, no passage text.
            # `structured_answer_json` is served verbatim to the public
            # endpoint (bar-exam-answers.public.controller.ts:126), so
            # everything added here is something a reader may see. Six
            # integers describing how well-sourced the answer is are fair for
            # a reader to see; the retrieval internals that produced them are
            # not, and are not here.
            structured["grounding"] = {
                "emittedIds": scored.emitted_id_count,
                "validIds": scored.valid_id_count,
                "fabricatedIds": scored.fabricated_id_count,
                "citedDocuments": scored.cited_document_count,
                "availableDocuments": scored.available_document_count,
                "breadthDenominator": min(
                    BREADTH_TARGET, scored.available_document_count
                ),
            }
            logger.info(
                "bar_exam_answer: question %s scored %.4f "
                "(resolution=%.4f breadth=%.4f valid=%d/%d docs=%d/%d)",
                question_id,
                scored.score,
                scored.citation_resolution,
                scored.authority_breadth,
                scored.valid_id_count,
                scored.emitted_id_count,
                scored.cited_document_count,
                scored.available_document_count,
            )

        render = (
            render_answer_markdown_v2 if use_grounded else render_answer_markdown
        )
        answer_text = render(structured)

        # A priors-only (v1) row stores confidence NULL rather than 0.0. The
        # two are different claims: NULL means "this row was never scored on
        # the grounded terms", 0.0 means "it was scored and grounded nothing".
        # PR 3's auto-approve must never treat an unscored row as a low-scoring
        # one, so the distinction is kept at the column level.
        model_run_id = db.create_model_run(
            run_type="bar_exam_answer_generation",
            model_name=model_name,
            prompt_template_version=prompt_version,
            input_ref=f"bar_exam_question:{question_id}",
            output_ref=None,
            confidence=confidence,
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
            confidence=confidence,
            review_status="pending",
            visibility="private",
        )

        # Bar-exam answers persist straight to Postgres, so there is no
        # artifact write for the ledger entry to ride along with. Posting
        # it separately is what stops this category's spend from existing
        # only in Redis. Non-blocking: a generated answer must not be lost
        # because the accounting call failed.
        try:
            nestjs_client.write_budget_ledger(
                build_ledger_entry(
                    scope=SCOPE_BAR_EXAM_ANSWER,
                    model_name=model_name,
                    tokens_in=tokens_in,
                    tokens_out=tokens_out,
                    model_run_id=model_run_id,
                )
            )
        except Exception:
            logger.exception(
                "bar_exam_answer: failed to write budget ledger for question %s",
                question_id,
            )

        return {
            "question_id": question_id,
            "status": "generated",
            "answer_id": answer_id,
            "model_run_id": model_run_id,
            "confidence": confidence,
            "cited_section_ids": list(structured.get("citedSectionIds") or []),
            "dropped_section_ids": dropped_ids,
        }

    except BudgetExceededError:
        # Not a per-question failure — the ceiling is global (or per-scope)
        # and the next question would hit it too. Propagate so the caller can
        # pause the whole run; swallowing it here is how a budget stop turns
        # into 1,375 rows marked "failed".
        raise

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


# ─── Phase 3b: queued, chunked, visible generation ────────────────────────

#: Item statuses that count as a per-question failure.
_FAILURE_STATUSES = frozenset(
    {
        "question_not_found",
        "llm_invalid_json",
        "llm_malformed",
        "llm_abstained",
        "error",
    },
)


def _item_outcome(result: dict[str, Any]) -> dict[str, Any]:
    """Map a ``_generate_one`` result onto an item-row update.

    Two kinds of success are kept apart on purpose: ``generated`` is a
    grounded (v2) answer carrying a confidence, ``generated_ungrounded`` is
    the priors-only (v1) fallback taken when retrieval returned nothing.
    Collapsing them would hide the ungrounded share of a run behind a green
    progress bar — and an ungrounded row is exactly the one an editor most
    needs to look at.
    """
    status = result.get("status")

    if status == "generated":
        confidence = result.get("confidence")
        return {
            "status": "generated" if confidence is not None else "generated_ungrounded",
            "answer_id": result.get("answer_id"),
            "confidence": confidence,
        }

    if status == "skipped_existing":
        return {"status": "skipped_existing"}

    if status in _FAILURE_STATUSES:
        # `reason` is the abstention reason; `error` the exception message.
        # Both are model/driver text, so they are truncated and never carry a
        # traceback — this string is rendered in the admin UI.
        message = result.get("error") or result.get("reason")
        return {
            "status": "failed",
            "error_code": str(status),
            "error_message": str(message)[:500] if message else None,
        }

    # Unknown status — record it rather than silently counting it a success.
    return {
        "status": "failed",
        "error_code": "unknown_status",
        "error_message": str(status)[:500],
    }


def _finalize_job(job_id: str) -> str:
    """Close a job whose queue is empty, and report the status chosen."""
    counts = db.count_bar_exam_generation_items_by_status(job_id)
    failed = counts.get("failed", 0)
    status = "completed_with_failures" if failed else "completed"
    db.set_bar_exam_generation_job_status(job_id, status, finished=True)
    logger.info(
        "bar_exam generation job %s finished as %s (%s)",
        job_id,
        status,
        counts,
    )
    return status


@shared_task(
    bind=True,
    name="bar_exam.run_answer_generation_job",
    acks_late=True,
    reject_on_worker_lost=True,
    max_retries=2,
    retry_backoff=True,
    retry_backoff_max=300,
)
def run_answer_generation_job(self: Any, job_id: str) -> dict[str, Any]:
    """Run one chunk of a generation job, then re-enqueue if work remains.

    Chunking is a correctness requirement, not a tuning knob: with
    ``acks_late=True`` and Redis's default 1h ``visibility_timeout``, a single
    task covering 1,375 questions would be redelivered to a second worker
    while the first was still running it, and every answer would be generated
    twice.

    The job status is re-read before every item so a cancel lands within one
    question rather than one chunk, and a ``BudgetExceededError`` pauses the
    job with the current item returned to ``queued`` — resumable, not failed.

    Idempotent by construction: each item is claimed with ``FOR UPDATE SKIP
    LOCKED``, and ``_generate_one`` still skips questions that already have an
    ``ai_generated`` row, so a redelivered chunk cannot double-write.
    """
    job = db.get_bar_exam_generation_job(job_id)
    if job is None:
        logger.warning("bar_exam generation job %s not found", job_id)
        return {"job_id": job_id, "status": "job_not_found"}

    if job["status"] in db.BAR_EXAM_JOB_TERMINAL_STATUSES:
        logger.info(
            "bar_exam generation job %s already %s — nothing to do",
            job_id,
            job["status"],
        )
        return {"job_id": job_id, "status": str(job["status"]), "processed": 0}

    # Set by the API when the dispatch asked to replace answers that are
    # still pending review. `_generate_one`'s delete is restricted to
    # `review_status = 'pending'`, so an approved or rejected answer survives
    # this flag no matter what the job row says.
    filters = job.get("filters_json")
    force_regenerate = bool(
        isinstance(filters, dict) and filters.get("regeneratePending"),
    )

    db.reset_stale_bar_exam_generation_items(job_id, STALE_RUNNING_MINUTES)
    db.mark_bar_exam_generation_job_running(job_id)

    claimed = db.claim_bar_exam_generation_items(job_id, CHUNK_SIZE)
    if not claimed:
        return {
            "job_id": job_id,
            "status": _finalize_job(job_id),
            "processed": 0,
        }

    processed = 0
    outcomes: dict[str, int] = {}
    pending_items = [str(item["id"]) for item in claimed]

    for item in claimed:
        item_id = str(item["id"])
        question_id = str(item["question_id"])

        # Re-read before every item: a cancel pressed mid-chunk should stop
        # the next LLM call, not merely the next chunk.
        current_status = db.get_bar_exam_generation_job_status(job_id)
        if current_status == "cancelled":
            released = db.release_bar_exam_generation_items(pending_items)
            logger.info(
                "bar_exam generation job %s cancelled — released %d claimed "
                "item(s)",
                job_id,
                released,
            )
            return {
                "job_id": job_id,
                "status": "cancelled",
                "processed": processed,
                "outcomes": outcomes,
            }

        try:
            result = _generate_one(question_id, force_regenerate=force_regenerate)
        except BudgetExceededError as exc:
            db.release_bar_exam_generation_items(pending_items)
            db.set_bar_exam_generation_job_status(job_id, "paused_budget")
            logger.warning(
                "bar_exam generation job %s paused — LLM budget exceeded "
                "(scope=%s period=%s)",
                job_id,
                getattr(exc, "scope", None) or "global",
                getattr(exc, "period", None),
            )
            return {
                "job_id": job_id,
                "status": "paused_budget",
                "processed": processed,
                "outcomes": outcomes,
            }

        outcome = _item_outcome(result)
        db.finish_bar_exam_generation_item(
            item_id,
            status=outcome["status"],
            error_code=outcome.get("error_code"),
            error_message=outcome.get("error_message"),
            answer_id=outcome.get("answer_id"),
            confidence=outcome.get("confidence"),
        )
        pending_items.remove(item_id)
        processed += 1
        outcomes[outcome["status"]] = outcomes.get(outcome["status"], 0) + 1

    remaining = db.count_bar_exam_generation_items_by_status(job_id).get(
        "queued",
        0,
    )
    if remaining > 0:
        run_answer_generation_job.apply_async(kwargs={"job_id": job_id})
        return {
            "job_id": job_id,
            "status": "running",
            "processed": processed,
            "remaining": remaining,
            "outcomes": outcomes,
        }

    return {
        "job_id": job_id,
        "status": _finalize_job(job_id),
        "processed": processed,
        "remaining": 0,
        "outcomes": outcomes,
    }
