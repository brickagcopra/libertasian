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
from ..clients import nestjs_client
from ..fetchers.base import CloudflareBlockedError
from ..fetchers.lawphil_bar import LawphilBarFetcher
from ..parsers.lawphil_bar_html import (
    ParsedBarPage,
    ParsedBarQuestion,
    parse_page,
)
from .bar_exam_subjects import (
    ALL_YEAR_SLUGS,
    TAXONOMY_VERSION,
    archive_url_for,
    get_subject_meta,
)

logger = logging.getLogger(__name__)

# Stable parser version tag persisted in extracted_json so re-runs can
# detect when the parser changed and we should re-parse on top.
#
# v2 adds the ordered-list (2015) format. Under v1 the five 2015 sittings
# stored four "questions" each that were the exam instructions, because a
# page whose numerals are drawn by ``<ol type="I">`` has no Roman text
# markers and fell through to the numbered parser.
PARSER_VERSION = "lawphil-bar-v2"

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
        5. Reuse the sitting's existing ``legal_documents`` row when it has
           one, or create one; add a ``legal_document_versions`` row either
           way, and write one ``legal_document_sections`` row per question.
        6. Upsert the ``bar_exam_sittings`` row + ``bar_exam_questions``.
        7. Mark the document published immediately (LawPhil bar Q pages
           are static official content; no review queue).

    Re-ingest safety, all of it learned from prod:

    * **Documents are reused, not re-created.** This task used to call
      ``create_legal_document`` unconditionally, so every re-parse published
      another copy of the same page: prod holds 105 bar-exam documents for
      97 distinct external_ids. The sitting's ``source_document_id`` is now
      the document, and a re-run adds a version row to it.
    * **Sections are replaced only if nothing points at them.** Citations,
      doctrine extracts, bookmarks, annotations, provenance records,
      flashcards, reviewer pack items and derivative artifacts can all
      reference a section. If any do, the run stops with
      ``sections_referenced`` and writes nothing further — re-parsing a page
      is not worth silently cutting a digest loose from its provenance.
    * **A changed question drops its PENDING answer only.** An AI answer is
      an answer to the text it was generated from; when that text changes
      the answer is stale. Pending drafts are deleted so they regenerate.
      An approved or rejected answer is a human decision and is left alone,
      reported as ``reviewed_answer_on_changed_question`` for an editor to
      resolve.
    * **Questions that vanish from a parse are never deleted.** A parser
      regression that finds 4 items on a 22-item page must not be able to
      delete 18 questions (and their answers) on its way through. They are
      logged and reported instead.

    Returns a telemetry dict with sitting_id, document_id, parsed/expected
    counts, and what the run did about existing answers.
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

    page: ParsedBarPage = parse_page(content.html)
    questions = page.questions
    if page.expected_items is not None and len(questions) != page.expected_items:
        # Not fatal: the page's own count and the parse disagreeing is exactly
        # what the audit script exists to surface, and refusing to ingest
        # would leave the sitting on its older, worse parse.
        logger.warning(
            "bar_exam.ingest_sitting parsed %d questions but %s declares %d "
            "items (year=%d slug=%s)",
            len(questions),
            url,
            page.expected_items,
            year,
            subject_slug,
        )
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
    existing_document_id = (
        str(existing["source_document_id"])
        if existing and existing.get("source_document_id")
        else None
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

    extracted_json = {
        "year": year,
        "subject_slug": subject_slug,
        "subject_label": meta.label,
        "subject_study_code": meta.study_code,
        "subject_bar_admin_code": meta.admin_code,
        "part": meta.part,
        "source_url": url,
        "questions_parsed": len(questions),
        "expected_items": page.expected_items,
        "page_format": page.page_format,
        "parser_version": PARSER_VERSION,
    }

    if existing_document_id is not None:
        # Anything referencing a section makes the replacement unsafe. Checked
        # before the version row is written so an aborted run leaves no trace
        # in the document's history either.
        references = db.count_section_references(existing_document_id)
        if references:
            logger.warning(
                "bar_exam.ingest_sitting aborting re-ingest of %s: sections "
                "referenced by %s",
                url,
                references,
            )
            db.create_audit_log(
                action="bar_exam.sitting_ingest_aborted",
                entity_type="bar_exam_sitting",
                entity_id=str(existing["id"]),
                actor_type="system",
                metadata={
                    "year": year,
                    "subject_slug": subject_slug,
                    "document_id": existing_document_id,
                    "reason": "sections_referenced",
                    "section_references": references,
                    "questions_parsed": len(questions),
                    "expected_items": page.expected_items,
                    "url": url,
                    "parser_version": PARSER_VERSION,
                },
            )
            return {
                "status": "sections_referenced",
                "year": year,
                "subject_slug": subject_slug,
                "sitting_id": str(existing["id"]),
                "document_id": existing_document_id,
                "section_references": references,
                "questions_parsed": len(questions),
                "expected_items": page.expected_items,
                "url": url,
            }

        document_id = existing_document_id
        db.create_legal_document_version(
            legal_document_id=document_id,
            snapshot_hash=checksum,
            raw_file_object_key=None,
            normalized_text_object_key=None,
            html_object_key=None,
            extracted_json=extracted_json,
            parser_version=PARSER_VERSION,
        )
        db.replace_legal_document_sections(document_id, sections_payload)
    else:
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
            extracted_json=extracted_json,
            parser_version=PARSER_VERSION,
        )
        db.create_legal_document_sections(document_id, sections_payload)

    db.publish_legal_document_immediately(document_id)

    if existing:
        sitting_id = str(existing["id"])
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

    answer_effects = _handle_changed_questions(sitting_id, questions)

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

    # Keep OpenSearch in step with what we just wrote. `replace=True` only
    # for the reuse path, because that is the path that deleted section rows:
    # `indexLegalDocument` upserts the sections a document has now and has no
    # way to remove entries for sections that no longer exist, which is how
    # prod ended up with the 2015 criminal paper searchable under its
    # instruction text. A brand-new document has nothing stale to clear.
    #
    # Best-effort by design: the questions are already committed, and a search
    # index that lags is a worse outcome to cause than to report. `indexed`
    # says which happened, in the telemetry and in the audit row.
    indexed = _index_document(document_id, replace=existing_document_id is not None)

    telemetry = {
        "year": year,
        "subject_slug": subject_slug,
        "document_id": document_id,
        "document_reused": existing_document_id is not None,
        "indexed": indexed,
        "questions_parsed": len(questions),
        "questions_written": written,
        "expected_items": page.expected_items,
        "page_format": page.page_format,
        "url": url,
        "parser_version": PARSER_VERSION,
        **answer_effects,
    }

    db.create_audit_log(
        action="bar_exam.sitting_ingested",
        entity_type="bar_exam_sitting",
        entity_id=sitting_id,
        actor_type="system",
        metadata=telemetry,
    )

    return {
        "status": "completed",
        "sitting_id": sitting_id,
        **telemetry,
    }


def _index_document(document_id: str, replace: bool) -> bool:
    """Trigger OpenSearch indexing. Never raises into the ingest.

    ``trigger_opensearch_index`` already swallows HTTP failures and returns
    False; this wrapper exists for the layer below that — a misconfigured API
    URL or an unexpected client error should not undo an ingest that has
    already committed its questions.
    """
    try:
        indexed = nestjs_client.trigger_opensearch_index(
            document_id,
            replace=replace,
        )
    except Exception:
        logger.exception(
            "bar_exam.ingest_sitting: OpenSearch index trigger raised for "
            "document %s",
            document_id,
        )
        return False
    if not indexed:
        logger.warning(
            "bar_exam.ingest_sitting: OpenSearch indexing failed for document "
            "%s (replace=%s) — questions are written, search is stale",
            document_id,
            replace,
        )
    return indexed


def _handle_changed_questions(
    sitting_id: str,
    questions: list[ParsedBarQuestion],
) -> dict[str, Any]:
    """Deal with existing questions before the upsert overwrites their text.

    Three separate concerns, all about not destroying work:

    1. A question whose text is about to change carries an AI answer written
       against the OLD text. If that answer is still ``pending`` it is
       deleted, so the regeneration job picks the question up again.
    2. If instead an editor approved or rejected it, the answer stays — a
       human decision outranks a re-parse — and the question id is reported
       as ``reviewed_answer_on_changed_question`` so someone can look.
    3. Questions the new parse does not cover are left in place. Deleting
       them would let a parser regression (the 22 → 4 one this branch fixes,
       run the other way) take out the questions and answers it failed to
       find.

    Returns the telemetry fragment describing all three.
    """
    existing_rows = db.get_bar_exam_questions_for_sitting(sitting_id)
    if not existing_rows:
        return {
            "questions_changed": 0,
            "pending_answers_deleted": [],
            "reviewed_answer_on_changed_question": [],
            "questions_missing_from_parse": [],
        }

    parsed_by_number = {q.question_number: q.question_text for q in questions}
    changed_ids: list[str] = []
    for row in existing_rows:
        number = int(row["question_number"])
        new_text = parsed_by_number.get(number)
        if new_text is not None and new_text != row["question_text"]:
            changed_ids.append(str(row["id"]))

    missing = sorted(
        int(row["question_number"])
        for row in existing_rows
        if int(row["question_number"]) not in parsed_by_number
    )
    if missing:
        logger.warning(
            "bar_exam.ingest_sitting: sitting %s has %d question(s) the new "
            "parse does not cover (%s) — keeping them",
            sitting_id,
            len(missing),
            missing,
        )

    states = db.get_bar_exam_answer_states(changed_ids)
    pending = [
        qid for qid, state in states.items()
        if str(state.get("review_status")) == "pending"
    ]
    reviewed = sorted(
        qid for qid, state in states.items()
        if str(state.get("review_status")) != "pending"
    )
    deleted = db.delete_pending_bar_exam_answers(pending) if pending else []
    if reviewed:
        logger.warning(
            "bar_exam.ingest_sitting: sitting %s changed the text of %d "
            "question(s) carrying a reviewed answer: %s",
            sitting_id,
            len(reviewed),
            reviewed,
        )

    return {
        "questions_changed": len(changed_ids),
        "pending_answers_deleted": sorted(deleted),
        "reviewed_answer_on_changed_question": reviewed,
        "questions_missing_from_parse": missing,
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
