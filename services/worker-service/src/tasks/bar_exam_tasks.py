"""LIBERTASIAN Worker Service — Past bar examination ingestion tasks.

Two Celery tasks:

  - ``bar_exam.ingest_sitting(year, subject_slug)`` — fetch + parse one
    LawPhil bar exam page, materialize a ``legal_document``, sections,
    a ``bar_exam_sitting``, and the per-question rows.
  - ``bar_exam.backfill_lawphil_archive(year_start, year_end, limit)`` —
    enumerate every (year, slug) combination in the registry and
    dispatch a per-sitting ingest task for any combination not already
    present in ``bar_exam_sittings``.

Both honor the ``backfill.fetch_window`` gate (PR #87): when the
current moment is outside the configured window, the task records the
fact and returns early — the next Celery Beat tick will retry once
the window opens.
"""

from __future__ import annotations

import hashlib
import logging
from typing import Any

from celery import shared_task

from ..backfill.fetch_window import is_in_fetch_window
from ..clients import ingestion_db_client as db
from ..fetchers.base import CloudflareBlockedError
from ..fetchers.lawphil_bar import LawphilBarFetcher
from ..parsers.lawphil_bar_html import parse as parse_bar_questions
from .bar_exam_subjects import (
    ALL_YEAR_SLUGS,
    TAXONOMY_VERSION,
    archive_url_for,
    get_subject_meta,
)

logger = logging.getLogger(__name__)

# Stable parser version tag persisted in extracted_json so re-runs can
# detect when the parser changed and we should re-parse on top.
PARSER_VERSION = "lawphil-bar-v1"

# LawPhil's domain — used to look up the canonical sources row.
LAWPHIL_DOMAIN = "lawphil.net"


@shared_task(
    name="bar_exam.ingest_sitting",
    bind=True,
    acks_late=True,
    reject_on_worker_lost=True,
    max_retries=3,
    default_retry_delay=120,
)
def ingest_sitting(
    self: Any,
    year: int,
    subject_slug: str,
) -> dict[str, Any]:
    """Fetch + parse one LawPhil bar exam page and materialize all rows.

    Pipeline:
        1. Fetch window check → no-op out-of-window.
        2. Resolve subject metadata from the registry.
        3. Look up the LawPhil sources row.
        4. Fetch the HTML via ``LawphilBarFetcher`` (polite delay enforced
           by the shared base fetcher).
        5. Create a ``legal_documents`` row (or reuse one if the sitting
           already has one), plus ``legal_document_versions`` and a
           ``legal_document_sections`` row per question.
        6. Upsert the ``bar_exam_sittings`` row + ``bar_exam_questions``.
        7. Mark the document published immediately (LawPhil bar Q pages
           are static official content; no review queue).

    Returns a telemetry dict with sitting_id, document_id, and
    questions_parsed counts.
    """
    if not is_in_fetch_window():
        logger.info(
            "bar_exam.ingest_sitting skipped: outside fetch window "
            "year=%d slug=%s",
            year, subject_slug,
        )
        return {
            "year": year,
            "subject_slug": subject_slug,
            "status": "skipped",
            "reason": "outside_fetch_window",
        }

    meta = get_subject_meta(subject_slug)
    if meta is None:
        logger.error(
            "bar_exam.ingest_sitting unknown subject_slug=%s", subject_slug,
        )
        return {
            "year": year,
            "subject_slug": subject_slug,
            "status": "error",
            "reason": f"unknown_subject_slug:{subject_slug}",
        }

    source = db.find_source_by_domain(LAWPHIL_DOMAIN)
    if source is None:
        logger.error(
            "bar_exam.ingest_sitting cannot find LawPhil source row",
        )
        return {
            "year": year,
            "subject_slug": subject_slug,
            "status": "error",
            "reason": "lawphil_source_missing",
        }

    source_id = source["id"]
    url = archive_url_for(year, subject_slug)

    fetcher = LawphilBarFetcher()
    try:
        content = fetcher.fetch_content(url)
    except CloudflareBlockedError as cf_exc:
        logger.warning(
            "bar_exam.ingest_sitting Cloudflare block on %s: %s",
            url, cf_exc,
        )
        return {
            "year": year,
            "subject_slug": subject_slug,
            "status": "blocked",
            "reason": "cloudflare_challenge",
            "url": url,
        }
    except Exception as exc:
        logger.exception(
            "bar_exam.ingest_sitting fetch failed for %s", url,
        )
        raise self.retry(exc=exc) from exc

    questions = parse_bar_questions(content.html)
    if not questions:
        logger.warning(
            "bar_exam.ingest_sitting parsed 0 questions for %s "
            "(parser returned empty)", url,
        )
        return {
            "year": year,
            "subject_slug": subject_slug,
            "status": "no_questions",
            "url": url,
        }

    # Document title is intentionally human-readable so it surfaces in
    # the corpus list as "2018 Bar Examinations — Civil Law" — not a
    # generic LawPhil filename.
    title = f"{year} Bar Examinations — {meta.label}"
    short_title = f"{year} Bar — {meta.label}"
    raw_html_bytes = content.html.encode("utf-8", errors="replace")
    checksum = hashlib.sha256(raw_html_bytes).hexdigest()

    # Reuse-or-create the sitting row keyed on (year, part, subject_study_code).
    existing = db.find_bar_exam_sitting(
        year=year, part=meta.part, subject_study_code=meta.study_code,
    )

    document_id = db.create_legal_document(
        source_id=source_id,
        title=title,
        document_type="bar_exam_questions",
        canonical_url=url,
        external_id=f"lawphil-bar-{year}-{subject_slug}",
        citation_text=short_title,
        is_official=True,
    )

    db.create_legal_document_version(
        legal_document_id=document_id,
        snapshot_hash=checksum,
        raw_file_object_key=None,
        normalized_text_object_key=None,
        html_object_key=None,
        extracted_json={
            "year": year,
            "subject_slug": subject_slug,
            "subject_label": meta.label,
            "subject_study_code": meta.study_code,
            "subject_bar_admin_code": meta.admin_code,
            "part": meta.part,
            "source_url": url,
            "questions_parsed": len(questions),
            "parser_version": PARSER_VERSION,
        },
        parser_version=PARSER_VERSION,
    )

    # One section per question so the citation extractor (PR #84) can
    # operate on each question's text independently. Bar exam answers
    # quote SC decisions / codals frequently.
    sections_payload = [
        {
            "section_type": "bar_exam_question",
            "section_label": f"Question {q.question_number}",
            "ordering": q.question_number,
            "plain_text": q.question_text,
            "html_text": None,
        }
        for q in questions
    ]
    db.create_legal_document_sections(document_id, sections_payload)
    db.publish_legal_document_immediately(document_id)

    if existing:
        sitting_id = existing["id"]
        db.update_bar_exam_sitting_source_doc(
            sitting_id=sitting_id,
            source_document_id=document_id,
            source_url=url,
            chairperson=existing.get("chairperson"),
        )
    else:
        sitting_id = db.create_bar_exam_sitting(
            year=year,
            part=meta.part,
            subject_study_code=meta.study_code,
            subject_bar_admin_code=meta.admin_code,
            source_document_id=document_id,
            source_url=url,
            taxonomy_version=TAXONOMY_VERSION,
            chairperson=None,
        )

    questions_payload = [
        {
            "question_number": q.question_number,
            "question_text": q.question_text,
            "sub_parts_count": q.sub_parts_count,
            "source_section_anchor": q.source_section_anchor,
        }
        for q in questions
    ]
    written = db.upsert_bar_exam_questions(
        sitting_id=sitting_id,
        questions=questions_payload,
        source_url=url,
    )

    db.create_audit_log(
        action="bar_exam.sitting_ingested",
        entity_type="bar_exam_sitting",
        entity_id=sitting_id,
        actor_type="system",
        metadata={
            "year": year,
            "subject_slug": subject_slug,
            "document_id": document_id,
            "questions_parsed": len(questions),
            "questions_written": written,
            "url": url,
            "parser_version": PARSER_VERSION,
        },
    )

    return {
        "status": "completed",
        "year": year,
        "subject_slug": subject_slug,
        "sitting_id": sitting_id,
        "document_id": document_id,
        "questions_parsed": len(questions),
        "questions_written": written,
        "url": url,
    }


@shared_task(
    name="bar_exam.backfill_lawphil_archive",
    bind=True,
    acks_late=True,
    reject_on_worker_lost=True,
    max_retries=0,
)
def backfill_lawphil_archive(
    self: Any,  # noqa: ARG001
    year_start: int = 2006,
    year_end: int = 2022,
    limit: int | None = None,
) -> dict[str, Any]:
    """Enumerate the LawPhil bar archive and dispatch ingest tasks.

    Iterates ``ALL_YEAR_SLUGS`` filtered to ``[year_start, year_end]``,
    skips combinations whose ``bar_exam_sittings`` row already has a
    source_document_id, and dispatches ``bar_exam.ingest_sitting`` for
    each missing combination. ``limit`` caps the number of dispatches in
    one tick — useful when an operator wants to drip the backfill
    rather than fire 100+ tasks at once.

    Per-tick fetch-window check is intentional: out-of-window ticks
    return cleanly without dispatching, so a caller that fires this on
    a scheduler doesn't burn budget waiting for the LawPhil quiet hour.
    """
    if not is_in_fetch_window():
        logger.info(
            "bar_exam.backfill_lawphil_archive skipped: outside fetch window",
        )
        return {
            "status": "skipped",
            "reason": "outside_fetch_window",
            "dispatched": 0,
            "skipped_already_present": 0,
            "total_combinations": 0,
        }

    combinations = [
        (year, slug)
        for (year, slug) in ALL_YEAR_SLUGS
        if year_start <= year <= year_end
    ]

    dispatched = 0
    skipped = 0
    for year, slug in combinations:
        if limit is not None and dispatched >= limit:
            break
        meta = get_subject_meta(slug)
        if meta is None:
            continue

        existing = db.find_bar_exam_sitting(
            year=year, part=meta.part, subject_study_code=meta.study_code,
        )
        if existing and existing.get("source_document_id"):
            skipped += 1
            continue

        ingest_sitting.delay(year=year, subject_slug=slug)
        dispatched += 1

    logger.info(
        "bar_exam.backfill_lawphil_archive dispatched=%d skipped=%d total=%d",
        dispatched, skipped, len(combinations),
    )
    return {
        "status": "completed",
        "dispatched": dispatched,
        "skipped_already_present": skipped,
        "total_combinations": len(combinations),
        "year_start": year_start,
        "year_end": year_end,
        "limit": limit,
    }


__all__ = ["ingest_sitting", "backfill_lawphil_archive"]
