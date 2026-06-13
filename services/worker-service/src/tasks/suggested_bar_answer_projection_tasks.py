"""Suggested bar answer projection — Library derivative (Phase 3b).

Admin-triggered Celery task that PROJECTS already-approved
``bar_exam_answers`` rows into ``suggested_bar_answer`` derivative
artifacts so they surface in the public Library hub.

This task does NOT call an LLM. Every approved answer was already
generated, vetted, and approved upstream (see ``bar_exam_answer_tasks``);
here we only re-shape the stored answer into the renderer contract and
persist it through the generic NestJS derivative writer. Because the
content is already approved upstream, the projected artifact is written
straight to ``reviewStatus='approved'`` + ``visibility='public_editorial'``.

Idempotency:
  - The content hash is deterministic from (bar year + subject study code
    + question text). Before writing, we check
    ``derivative_artifact_exists_by_content_hash`` and skip on a hit, so a
    re-run never duplicates an artifact.

Resilience:
  - Each per-answer projection is wrapped in try/except. One bad row logs
    and is counted as ``failed`` without aborting the batch.

Renderer contract (apps/web .../suggested-bar-answer-renderer.tsx) reads
``content.{questionText, suggestedAnswer, examSubject, barYear,
annotations, sourceAttribution}``.
"""

from __future__ import annotations

import hashlib
import logging
from typing import Any

from celery import shared_task

from ..clients import ingestion_db_client as db
from ..clients import nestjs_client

logger = logging.getLogger(__name__)

DERIVATIVE_TYPE = "suggested_bar_answer"
CONTENT_DISCLAIMER_CLASS = "ai_suggested_bar_answer"
CONTENT_RIGHTS = "ai_generated_derivative"

# Human-readable subject labels keyed by the study_8 ``subject_study_code``
# carried on each bar exam sitting. Falls back to a title-cased slug for any
# code not listed, so an unmapped subject still renders a sensible chip.
_SUBJECT_LABELS: dict[str, str] = {
    "political_law": "Political Law and International Law",
    "labor_law": "Labor Law and Social Legislation",
    "civil_law": "Civil Law",
    "taxation": "Taxation Law",
    "mercantile_law": "Mercantile Law",
    "criminal_law": "Criminal Law",
    "remedial_law": "Remedial Law",
    "legal_ethics": "Legal Ethics and Practical Exercises",
}


def _subject_label(subject_study_code: str | None) -> str:
    """Map a study_8 subject code to a display label for the renderer."""
    if not subject_study_code:
        return "Bar Examination"
    mapped = _SUBJECT_LABELS.get(subject_study_code)
    if mapped:
        return mapped
    return subject_study_code.replace("_", " ").title()


def _content_hash(
    bar_year: Any,
    subject_study_code: str | None,
    question_text: str,
) -> str:
    """Deterministic sha256 over (barYear | subject | questionText).

    Stable across re-runs so the idempotency check can recognise an
    already-projected answer. Whitespace in the question is collapsed so
    a trivial upstream re-parse (e.g. a stray trailing space) does not
    produce a different hash.
    """
    normalized_question = " ".join((question_text or "").split())
    basis = f"{bar_year}|{subject_study_code or ''}|{normalized_question}"
    return hashlib.sha256(basis.encode("utf-8")).hexdigest()


def _build_content_json(answer: dict[str, Any]) -> dict[str, Any]:
    """Re-shape an approved bar answer row into the renderer contract."""
    subject_label = _subject_label(answer.get("subject_study_code"))
    bar_year = answer.get("sitting_year")

    attribution_bits = []
    if bar_year:
        attribution_bits.append(f"{bar_year} Philippine Bar Examinations")
    if subject_label:
        attribution_bits.append(subject_label)
    source_attribution = " — ".join(attribution_bits) or "Philippine Bar Examinations"

    return {
        "questionText": (answer.get("question_text") or "").strip(),
        "suggestedAnswer": (answer.get("answer_text") or "").strip(),
        "examSubject": subject_label,
        "barYear": bar_year,
        "annotations": [],
        "sourceAttribution": source_attribution,
    }


def _title_for(answer: dict[str, Any], subject_label: str) -> str:
    """Build a concise, human-readable artifact title."""
    bar_year = answer.get("sitting_year")
    question = (answer.get("question_text") or "").strip()
    excerpt = question[:60].rstrip()
    if len(question) > 60:
        excerpt += "…"
    prefix = f"Suggested Bar Answer — {bar_year} {subject_label}".strip()
    return f"{prefix}: {excerpt}" if excerpt else prefix


def _project_one(
    answer: dict[str, Any],
    disclaimer_id: str,
) -> dict[str, Any]:
    """Project a single approved answer; return a per-item result dict.

    ``status`` is one of: ``written``, ``skipped_exists``,
    ``skipped_no_source_document``, ``skipped_empty``, ``error``.
    """
    answer_id = answer.get("answer_id")
    try:
        content = _build_content_json(answer)

        if not content["questionText"] or not content["suggestedAnswer"]:
            logger.warning(
                "suggested_bar_answer: answer %s missing question/answer text "
                "— skipping",
                answer_id,
            )
            return {"answer_id": answer_id, "status": "skipped_empty"}

        # Provenance anchors back to the official LawPhil bar-question
        # document. WriteDerivativeDto requires at least one provenance
        # record with a UUID sourceDocumentId, so a sitting with no source
        # document cannot be projected.
        source_document_id = answer.get("source_document_id")
        if not source_document_id:
            logger.warning(
                "suggested_bar_answer: answer %s has no sitting "
                "source_document_id — cannot record provenance, skipping",
                answer_id,
            )
            return {
                "answer_id": answer_id,
                "status": "skipped_no_source_document",
            }

        content_hash = _content_hash(
            answer.get("sitting_year"),
            answer.get("subject_study_code"),
            content["questionText"],
        )

        if db.derivative_artifact_exists_by_content_hash(
            content_hash, DERIVATIVE_TYPE,
        ):
            return {
                "answer_id": answer_id,
                "status": "skipped_exists",
                "content_hash": content_hash,
            }

        subject_label = content["examSubject"]
        payload: dict[str, Any] = {
            "derivativeType": DERIVATIVE_TYPE,
            "sourceDocumentId": source_document_id,
            "title": _title_for(answer, subject_label),
            "contentJson": content,
            "contentHash": content_hash,
            "contentRights": CONTENT_RIGHTS,
            "contentDisclaimerId": disclaimer_id,
            # Already approved upstream — publish straight to the Library.
            "reviewStatus": "approved",
            "visibility": "public_editorial",
            "audience": "both",
            "provenanceRecords": [
                {
                    "sourceDocumentId": source_document_id,
                    "provenanceType": "source_passage",
                },
            ],
        }

        result = nestjs_client.write_derivative(payload)
        artifact_id = result.get("artifactId")
        logger.info(
            "suggested_bar_answer: projected answer %s -> artifact %s "
            "(bar %s, %s)",
            answer_id,
            artifact_id,
            answer.get("sitting_year"),
            answer.get("subject_study_code"),
        )
        return {
            "answer_id": answer_id,
            "status": "written",
            "artifact_id": artifact_id,
            "content_hash": content_hash,
        }

    except Exception as exc:  # noqa: BLE001 — keep batch alive on per-row errors
        logger.exception(
            "suggested_bar_answer: failed to project answer %s",
            answer_id,
        )
        return {
            "answer_id": answer_id,
            "status": "error",
            "error": str(exc),
        }


@shared_task(
    bind=True,
    name="suggested_bar_answer.project_approved_answers",
    acks_late=True,
    reject_on_worker_lost=True,
    max_retries=2,
    retry_backoff=True,
    retry_backoff_max=300,
)
def project_approved_bar_answers(
    self: Any,
    limit: int | None = None,
) -> dict[str, Any]:
    """Project APPROVED bar_exam_answers into suggested_bar_answer artifacts.

    ``limit`` optionally bounds how many approved answers are read in one
    dispatch (useful for incremental backfills). Returns a summary dict:

        {
          "processed": int,   # rows read + considered
          "written":   int,   # new artifacts created
          "skipped":   int,   # already projected / not projectable
          "failed":    int,   # per-row errors
          "results":   [{answer_id, status, ...}, ...],
        }
    """
    try:
        disclaimer_id = db.get_content_disclaimer_id(CONTENT_DISCLAIMER_CLASS)
    except Exception:
        logger.exception(
            "suggested_bar_answer: could not resolve content disclaimer %r "
            "— aborting projection",
            CONTENT_DISCLAIMER_CLASS,
        )
        raise

    answers = db.get_approved_bar_exam_answers(limit=limit)
    if not answers:
        logger.info("suggested_bar_answer: no approved answers to project")
        return {
            "processed": 0,
            "written": 0,
            "skipped": 0,
            "failed": 0,
            "results": [],
        }

    written = 0
    skipped = 0
    failed = 0
    results: list[dict[str, Any]] = []

    for answer in answers:
        result = _project_one(answer, disclaimer_id)
        results.append(result)
        status = result["status"]
        if status == "written":
            written += 1
        elif status.startswith("skipped"):
            skipped += 1
        else:
            failed += 1

    logger.info(
        "suggested_bar_answer: processed=%d written=%d skipped=%d failed=%d",
        len(answers),
        written,
        skipped,
        failed,
    )
    return {
        "processed": len(answers),
        "written": written,
        "skipped": skipped,
        "failed": failed,
        "results": results,
    }
