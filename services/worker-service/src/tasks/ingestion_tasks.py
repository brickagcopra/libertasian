"""LIBERTASIAN Worker Service — Ingestion pipeline Celery tasks.

Four tasks implementing the full ingestion pipeline:
1. poll_pending_ingestion_jobs — periodic poller (Celery Beat)
2. run_ingestion_job — orchestrator per job
3. process_ingestion_candidate — per-document processor
4. chain_post_ingestion — optional follow-up (doctrine/citation extraction)

Per CLAUDE.md:
- New documents: status='draft', truthfulnessStatus='needs_review', isPublished=false
- Updated documents create new legal_document_versions rows (NEVER overwrite)
- Celery tasks: idempotent (acks_late + reject_on_worker_lost)
- Rate limiting: 2-second delay between requests to same source domain
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from celery import shared_task

from ..clients import ingestion_db_client as db
from ..clients import nestjs_client, s3_client
from ..clients.db_client import SchemaIntegrityError
from ..config import settings
from ..fetchers.base import CloudflareBlockedError
from ..fetchers.registry import get_fetcher
from ..classifiers.dedup_classifier import DedupClassifier, DedupTier
from ..normalizers.text_normalizer import (
    compute_content_checksum,
    compute_similarity_key,
    normalize_citation,
    normalize_gr_no,
    normalize_whitespace,
)
from ..parsers.html_parser import extract_sections, parse_legal_document
from ..parsers.metadata_extractor import extract_metadata
from ..validators.truthfulness_validator import Verdict, validate_document

logger = logging.getLogger(__name__)

PARSER_VERSION = "ingestion-v0.1"


# ─── Task 1: Periodic Poller ─────────────────────────────────────────────


@shared_task(
    bind=True,
    name="ingestion.poll_pending_jobs",
    acks_late=True,
    reject_on_worker_lost=True,
    max_retries=0,
)
def poll_pending_ingestion_jobs(self: Any) -> dict[str, Any]:
    """Poll for pending ingestion jobs and dispatch workers.

    Runs every 60 seconds via Celery Beat. Reads pending jobs from DB
    and dispatches run_ingestion_job for each.
    """
    jobs = db.get_pending_ingestion_jobs(limit=5)

    if not jobs:
        logger.debug("No pending ingestion jobs found")
        return {"dispatched": 0, "status": "ok"}

    dispatched = 0
    for job in jobs:
        job_id = job["id"]
        logger.info("Dispatching ingestion job %s", job_id)
        run_ingestion_job.delay(job_id=job_id)
        dispatched += 1

    logger.info("Dispatched %d ingestion jobs", dispatched)
    return {"dispatched": dispatched, "status": "ok"}


# ─── Task 2: Job Orchestrator ────────────────────────────────────────────


@shared_task(
    bind=True,
    name="ingestion.run_job",
    acks_late=True,
    reject_on_worker_lost=True,
    max_retries=3,
    retry_backoff=True,
    retry_backoff_max=600,
    retry_jitter=True,
)
def run_ingestion_job(self: Any, job_id: str) -> dict[str, Any]:
    """Orchestrate a single ingestion job.

    1. Claims the job (status='running')
    2. Loads Source + SourceEndpoint config
    3. Looks up fetcher from registry by parser_type
    4. Calls fetcher.discover() to find candidate docs
    5. Creates IngestionCandidate rows (with dedup check)
    6. Dispatches process_ingestion_candidate for each new candidate
    7. Updates job counters and status
    """
    # Step 1: Claim the job atomically
    if not db.claim_ingestion_job(job_id):
        return {"job_id": job_id, "status": "already_claimed"}

    errors: list[dict[str, Any]] = []
    records_found = 0
    records_created = 0
    records_updated = 0

    try:
        # Step 2: Load source config
        job_info = _get_job_info(job_id)
        if not job_info:
            db.fail_ingestion_job(job_id, [{"error": "Job not found after claim"}])
            return {"job_id": job_id, "status": "error", "error": "job_not_found"}

        source_id = job_info["source_id"]
        endpoint_id = job_info.get("source_endpoint_id")

        source = db.get_source_with_endpoints(source_id)
        if not source:
            db.fail_ingestion_job(job_id, [{"error": f"Source {source_id} not found"}])
            return {"job_id": job_id, "status": "error", "error": "source_not_found"}

        if not source.get("enabled"):
            db.fail_ingestion_job(job_id, [{"error": "Source is disabled"}])
            return {"job_id": job_id, "status": "error", "error": "source_disabled"}

        endpoints = source.get("endpoints", [])
        if not endpoints:
            db.fail_ingestion_job(job_id, [{"error": "No active endpoints for source"}])
            return {"job_id": job_id, "status": "error", "error": "no_endpoints"}

        # If a specific endpoint was requested, filter to just that one
        if endpoint_id:
            endpoints = [e for e in endpoints if e["id"] == endpoint_id]
            if not endpoints:
                db.fail_ingestion_job(
                    job_id, [{"error": f"Endpoint {endpoint_id} not found or inactive"}]
                )
                return {"job_id": job_id, "status": "error", "error": "endpoint_not_found"}

        # Step 3-6: Process each endpoint
        for endpoint in endpoints:
            try:
                result = _process_endpoint(
                    source_id=source_id,
                    endpoint=endpoint,
                )
                records_found += result["found"]
                records_created += result["created"]
                records_updated += result["updated"]
                if result.get("errors"):
                    errors.extend(result["errors"])

                # Update endpoint fetch timestamps
                db.update_source_endpoint_fetch_time(
                    endpoint["id"],
                    success=not result.get("errors"),
                )
            except Exception as exc:
                logger.exception(
                    "Error processing endpoint %s for job %s",
                    endpoint["id"],
                    job_id,
                )
                errors.append({
                    "endpoint_id": endpoint["id"],
                    "error": str(exc),
                })

        # Step 7: Complete the job
        db.complete_ingestion_job(
            job_id=job_id,
            records_found=records_found,
            records_created=records_created,
            records_updated=records_updated,
        )

        logger.info(
            "Ingestion job %s completed: found=%d created=%d updated=%d errors=%d",
            job_id,
            records_found,
            records_created,
            records_updated,
            len(errors),
        )

        return {
            "job_id": job_id,
            "status": "completed",
            "records_found": records_found,
            "records_created": records_created,
            "records_updated": records_updated,
            "error_count": len(errors),
        }

    except Exception as exc:
        logger.exception("Ingestion job %s failed", job_id)
        errors.append({"error": str(exc)})
        db.fail_ingestion_job(job_id, errors)

        # Route to DLQ if max retries exhausted
        if self.request.retries >= self.max_retries:
            from .dlq_tasks import handle_dead_letter

            handle_dead_letter.delay(
                task_name="ingestion.run_job",
                task_args={"job_id": job_id},
                error_message=str(exc),
                retry_count=self.request.retries,
            )
            return {"job_id": job_id, "status": "dead_letter"}

        raise self.retry(exc=exc) from exc


def _get_job_info(job_id: str) -> dict[str, Any] | None:
    """Fetch a single ingestion job by ID (any status)."""
    import psycopg2.extras

    from ..clients.db_client import get_connection

    with get_connection() as conn, \
            conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT id, source_id, source_endpoint_id, job_type, status
               FROM ingestion_jobs
               WHERE id = %s""",
            (job_id,),
        )
        row = cur.fetchone()
        return dict(row) if row else None


def _process_endpoint(
    source_id: str,
    endpoint: dict[str, Any],
) -> dict[str, Any]:
    """Process a single source endpoint: discover and create candidates.

    Returns dict with keys: found, created, updated, errors.
    """
    parser_type = endpoint["parser_type"]
    endpoint_url = endpoint["endpoint_url"]
    last_fetched_at = endpoint.get("last_fetched_at")

    # Convert datetime to string if needed
    last_fetched_str = str(last_fetched_at) if last_fetched_at else None

    fetcher = get_fetcher(parser_type)
    if not fetcher:
        return {
            "found": 0,
            "created": 0,
            "updated": 0,
            "errors": [{"error": f"No fetcher for parser_type={parser_type}"}],
        }

    # Discover candidate documents. CloudflareBlockedError is expected for
    # sources gated behind Turnstile (officialgazette.gov.ph, congress.gov.ph);
    # we record it as a structured telemetry entry and return cleanly so the
    # parent job still completes (not fails). Other exceptions propagate and
    # are handled by the caller.
    try:
        candidates = fetcher.discover(endpoint_url, last_fetched_str)
    except CloudflareBlockedError as cf_exc:
        logger.warning(
            "Cloudflare block on endpoint %s (parser=%s): %s",
            endpoint["id"],
            parser_type,
            cf_exc,
        )
        return {
            "found": 0,
            "created": 0,
            "updated": 0,
            "errors": [{
                "type": "cloudflare_blocked",
                "endpoint_id": endpoint["id"],
                "endpoint_url": cf_exc.endpoint_url,
                "parser_type": parser_type,
                "status_code": cf_exc.status_code,
                "cf_type": cf_exc.cf_type,
                "detected_at": datetime.now(UTC).isoformat(),
                "message": str(cf_exc),
            }],
        }

    result: dict[str, Any] = {
        "found": len(candidates),
        "created": 0,
        "updated": 0,
        "errors": [],
    }

    for candidate in candidates:
        try:
            # Compute similarity key for dedup
            sim_key = compute_similarity_key(
                title=candidate.title,
                citation=candidate.gr_no,
                date=candidate.decision_date,
            )

            # Check for existing candidate (dedup)
            existing = db.find_candidate_by_similarity_key(source_id, sim_key)
            if existing:
                logger.debug(
                    "Skipping duplicate candidate: %s (existing=%s)",
                    candidate.url,
                    existing["id"],
                )
                continue

            # Create new candidate
            candidate_id = db.create_ingestion_candidate(
                source_id=source_id,
                detected_url=candidate.url,
                detected_title=candidate.title,
                detected_document_type=candidate.document_type,
                similarity_key=sim_key,
            )

            # Dispatch processing task
            process_ingestion_candidate.delay(
                candidate_id=candidate_id,
                source_id=source_id,
                url=candidate.url,
                parser_type=parser_type,
                candidate_metadata={
                    "title": candidate.title,
                    "gr_no": candidate.gr_no,
                    "document_type": candidate.document_type,
                    "decision_date": candidate.decision_date,
                    "ponente": candidate.ponente,
                    "court": candidate.court,
                },
            )

            result["created"] += 1

        except Exception as exc:
            logger.exception(
                "Error creating candidate for %s",
                candidate.url,
            )
            result["errors"].append({
                "url": candidate.url,
                "error": str(exc),
            })

    return result


# ─── Backfill Completion Hook ────────────────────────────────────────────


def _fire_backfill_completion_hook(
    candidate_metadata: dict[str, Any],
    outcome_status: str,
) -> None:
    """Finalize a backfill-triggered candidate on terminal outcome.

    Decrements the Redis ``backfill:inflight:{batch_id}`` counter so the
    next tick can dispatch new work, and increments the appropriate
    ``backfill_batches`` counter based on the outcome. Safe to call for
    non-backfill triggers — returns immediately unless ``trigger`` is set
    to ``"backfill"``.
    """
    if candidate_metadata.get("trigger") != "backfill":
        return
    batch_id = candidate_metadata.get("backfill_batch_id")
    if not batch_id:
        return

    import redis as _redis

    from ..clients import backfill_db_client as backfill_db

    try:
        redis_client = _redis.Redis.from_url(
            settings.redis_url, decode_responses=True,
        )
        redis_client.decr(f"backfill:inflight:{batch_id}")

        if outcome_status == "accepted":
            backfill_db.update_batch_counters(
                batch_id, documents_created=1, candidates_processed=1,
            )
        elif outcome_status == "version_update":
            backfill_db.update_batch_counters(
                batch_id, documents_updated=1, candidates_processed=1,
            )
        elif outcome_status == "duplicate":
            backfill_db.update_batch_counters(
                batch_id, candidates_skipped=1, candidates_processed=1,
            )
        else:
            # "failed" and "dead_letter"
            backfill_db.update_batch_counters(
                batch_id, candidates_failed=1, candidates_processed=1,
            )
    except Exception:
        logger.exception(
            "Failed to update backfill batch %s counters (outcome=%s)",
            batch_id, outcome_status,
        )


# ─── Task 3: Per-Document Processor ──────────────────────────────────────


@shared_task(
    bind=True,
    name="ingestion.process_candidate",
    acks_late=True,
    reject_on_worker_lost=True,
    max_retries=3,
    retry_backoff=True,
    retry_backoff_max=600,
    retry_jitter=True,
)
def process_ingestion_candidate(
    self: Any,
    candidate_id: str,
    source_id: str,
    url: str,
    parser_type: str,
    candidate_metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Process a single ingestion candidate into a legal document.

    Uses 5-tier dedup classification:
    1. Downloads raw content via fetcher
    2. Parses content and extracts metadata
    3. Runs 5-tier dedup classifier (checksum → GR cross-source → GR same-source → title)
    4. Acts on dedup tier:
       - exact_duplicate / mirror_duplicate: skip, create DocumentSimilarity
       - version_update: create new LegalDocumentVersion, create DocumentSimilarity
       - possible_duplicate: create document AND DocumentSimilarity (→ review queue)
       - new_document: proceed with normal ingestion
    5. Creates LegalDocument, LegalDocumentVersion, LegalDocumentSection rows
    6. Stores raw/normalized text in S3
    7. Fires post-ingestion chain

    Backfill completion hook: when ``candidate_metadata["trigger"] ==
    "backfill"``, the Redis inflight counter
    ``backfill:inflight:{backfill_batch_id}`` is decremented and the
    ``backfill_batches`` counters are bumped on any terminal outcome
    (success, duplicate, failed, dead_letter). Retries do NOT fire the
    hook — the counter is only decremented once the job leaves flight.
    """
    candidate_metadata = candidate_metadata or {}
    classifier = DedupClassifier()
    # ``outcome_status`` remains None while the task is still in flight
    # (including during a pending retry). It is set to the terminal
    # outcome just before each return / dead-letter return so the
    # ``finally`` block can fire the backfill completion hook exactly
    # once per enqueue-to-terminal lifecycle.
    outcome_status: str | None = None

    # Forward-only on the backfill path. Daily-crawl / on-demand candidates
    # carry a different (or no) trigger and don't bill against any batch.
    chain_backfill_batch_id: str | None = (
        candidate_metadata.get("backfill_batch_id")
        if candidate_metadata.get("trigger") == "backfill"
        else None
    )

    try:
        # Step 1: Download raw content
        fetcher = get_fetcher(parser_type)
        if not fetcher:
            db.update_candidate_status(candidate_id, "rejected")
            outcome_status = "failed"
            return {
                "candidate_id": candidate_id,
                "status": "error",
                "error": f"No fetcher for {parser_type}",
            }

        logger.info("Fetching content for candidate %s: %s", candidate_id, url)
        content = fetcher.fetch_content(url)
        raw_html_bytes = content.html.encode("utf-8")

        # Step 2: Parse content and extract metadata
        document_type = candidate_metadata.get("document_type", "decision")
        plain_text = parse_legal_document(content.html, document_type)
        sections = extract_sections(plain_text, document_type)

        extracted_meta = extract_metadata(plain_text, document_type)
        metadata = _merge_metadata(candidate_metadata, extracted_meta)

        # Normalize GR No.
        gr_no = metadata.get("gr_no")
        if gr_no:
            gr_no = normalize_gr_no(gr_no)
            import re

            gr_match = re.search(r"G\.R\. No\. \S+", gr_no)
            if gr_match:
                gr_no = gr_match.group(0)

        title = metadata.get("title") or f"Document from {url}"
        citation_text = metadata.get("citation_text")
        if citation_text:
            citation_text = normalize_citation(citation_text)
        court = metadata.get("court")

        # Step 3: Compute checksum and gather dedup data
        content_checksum = compute_content_checksum(raw_html_bytes)

        checksum_match = db.find_document_by_checksum(content_checksum)

        gr_no_same_source_match = None
        gr_no_cross_source_matches: list[dict[str, Any]] = []
        if gr_no:
            gr_no_same_source_match = db.find_document_by_gr_no(gr_no, source_id)
            gr_no_cross_source_matches = db.find_documents_by_gr_no_cross_source(
                gr_no, source_id,
            )

        title_candidates = db.find_documents_by_title_similarity(
            source_id, document_type,
        )

        # Step 4: Run 5-tier classifier
        dedup_result = classifier.classify(
            content_checksum=content_checksum,
            source_id=source_id,
            title=title,
            gr_no=gr_no,
            citation_text=citation_text,
            court=court,
            document_type=document_type,
            checksum_match=checksum_match,
            gr_no_same_source_match=gr_no_same_source_match,
            gr_no_cross_source_matches=gr_no_cross_source_matches,
            title_candidates=title_candidates,
        )

        logger.info(
            "Dedup classification for candidate %s: tier=%s confidence=%.2f matched=%s",
            candidate_id,
            dedup_result.tier.value,
            dedup_result.confidence,
            dedup_result.matched_document_id,
        )

        # Update candidate with dedup classification
        db.update_candidate_dedup_classification(
            candidate_id=candidate_id,
            dedup_classification=dedup_result.tier.value,
            dedup_confidence=dedup_result.confidence,
            matched_document_id=dedup_result.matched_document_id,
        )

        # Step 5: Act on dedup tier
        if dedup_result.should_skip_ingestion:
            # exact_duplicate or mirror_duplicate: skip ingestion
            db.update_candidate_status(candidate_id, "duplicate")

            # Create DocumentSimilarity record for tracking
            if dedup_result.matched_document_id:
                db.create_document_similarity(
                    document_a_id=dedup_result.matched_document_id,
                    document_b_id=dedup_result.matched_document_id,
                    similarity_score=dedup_result.confidence,
                    similarity_type=dedup_result.tier.value,
                    status="auto_dismissed",
                    classification_tier=dedup_result.tier.value,
                    classification_confidence=dedup_result.confidence,
                    classification_metadata=dedup_result.evidence,
                    canonical_document_id=dedup_result.matched_document_id,
                )

            # Audit log
            db.create_audit_log(
                action="document.dedup_skipped",
                entity_type="ingestion_candidate",
                entity_id=candidate_id,
                metadata={
                    "tier": dedup_result.tier.value,
                    "confidence": dedup_result.confidence,
                    "matched_document_id": dedup_result.matched_document_id,
                    "url": url,
                },
            )

            outcome_status = "duplicate"
            return {
                "candidate_id": candidate_id,
                "status": "duplicate",
                "dedup_tier": dedup_result.tier.value,
                "matched_document_id": dedup_result.matched_document_id,
            }

        if dedup_result.is_version_update:
            # version_update: create new version for existing document
            doc_id = dedup_result.matched_document_id
            if not doc_id:
                # Fallback: should not happen, but treat as new
                logger.warning(
                    "Version update tier but no matched doc for candidate %s",
                    candidate_id,
                )
                dedup_result = classifier.classify(
                    content_checksum=content_checksum,
                    source_id=source_id,
                    title=title,
                )
            else:
                logger.info(
                    "Creating new version for existing document %s (GR: %s)",
                    doc_id,
                    gr_no,
                )

                # Store in S3
                raw_object_key = f"corpus/{source_id}/{doc_id}/raw.html"
                s3_client.upload_file(
                    object_key=raw_object_key,
                    data=raw_html_bytes,
                    content_type="text/html",
                    bucket=settings.s3_bucket_corpus,
                )
                normalized_bytes = normalize_whitespace(plain_text).encode("utf-8")
                text_object_key = f"corpus/{source_id}/{doc_id}/normalized.txt"
                s3_client.upload_file(
                    object_key=text_object_key,
                    data=normalized_bytes,
                    content_type="text/plain",
                    bucket=settings.s3_bucket_corpus,
                )

                version_id = db.create_legal_document_version(
                    legal_document_id=doc_id,
                    snapshot_hash=content_checksum,
                    raw_file_object_key=raw_object_key,
                    normalized_text_object_key=text_object_key,
                    html_object_key=raw_object_key,
                    extracted_json=metadata,
                    parser_version=PARSER_VERSION,
                )

                # Create DocumentSimilarity for the version relationship
                db.create_document_similarity(
                    document_a_id=doc_id,
                    document_b_id=doc_id,
                    similarity_score=dedup_result.confidence,
                    similarity_type="version_update",
                    status="auto_dismissed",
                    classification_tier=dedup_result.tier.value,
                    classification_confidence=dedup_result.confidence,
                    classification_metadata=dedup_result.evidence,
                    canonical_document_id=doc_id,
                )

                db.update_candidate_status(candidate_id, "accepted")

                # Audit log
                db.create_audit_log(
                    action="document.version_update_detected",
                    entity_type="legal_document",
                    entity_id=doc_id,
                    metadata={
                        "candidate_id": candidate_id,
                        "version_id": version_id,
                        "gr_no": gr_no,
                        "confidence": dedup_result.confidence,
                    },
                )

                chain_post_ingestion.delay(
                    document_id=doc_id,
                    backfill_batch_id=chain_backfill_batch_id,
                )

                outcome_status = "version_update"
                return {
                    "candidate_id": candidate_id,
                    "document_id": doc_id,
                    "version_id": version_id,
                    "dedup_tier": dedup_result.tier.value,
                    "status": "version_update",
                }

        # new_document or possible_duplicate: create the document
        doc_id = db.create_legal_document(
            source_id=source_id,
            title=title,
            document_type=document_type,
            canonical_url=url,
            gr_no=gr_no,
            docket_no=metadata.get("docket_no"),
            citation_text=citation_text,
            decision_date=_parse_date(metadata.get("decision_date")),
            ponente=metadata.get("ponente"),
            court=court,
            checksum=content_checksum,
            is_official=False,
        )

        # Store in S3
        raw_object_key = f"corpus/{source_id}/{doc_id}/raw.html"
        s3_client.upload_file(
            object_key=raw_object_key,
            data=raw_html_bytes,
            content_type="text/html",
            bucket=settings.s3_bucket_corpus,
        )
        normalized_bytes = normalize_whitespace(plain_text).encode("utf-8")
        text_object_key = f"corpus/{source_id}/{doc_id}/normalized.txt"
        s3_client.upload_file(
            object_key=text_object_key,
            data=normalized_bytes,
            content_type="text/plain",
            bucket=settings.s3_bucket_corpus,
        )

        # Create version row
        version_id = db.create_legal_document_version(
            legal_document_id=doc_id,
            snapshot_hash=content_checksum,
            raw_file_object_key=raw_object_key,
            normalized_text_object_key=text_object_key,
            html_object_key=raw_object_key,
            extracted_json=metadata,
            parser_version=PARSER_VERSION,
        )

        # Create section rows
        section_ids = db.create_legal_document_sections(doc_id, sections)

        # If possible_duplicate: create DocumentSimilarity → review queue
        if dedup_result.needs_review and dedup_result.matched_document_id:
            db.create_document_similarity(
                document_a_id=dedup_result.matched_document_id,
                document_b_id=doc_id,
                similarity_score=dedup_result.confidence,
                similarity_type="title",
                status="pending",
                classification_tier=dedup_result.tier.value,
                classification_confidence=dedup_result.confidence,
                classification_metadata=dedup_result.evidence,
            )
            db.create_audit_log(
                action="document.dedup_classified",
                entity_type="legal_document",
                entity_id=doc_id,
                metadata={
                    "tier": dedup_result.tier.value,
                    "confidence": dedup_result.confidence,
                    "matched_document_id": dedup_result.matched_document_id,
                    "evidence": dedup_result.evidence,
                },
            )

        # Update candidate status
        db.update_candidate_status(candidate_id, "accepted")

        # Fire post-ingestion chain
        chain_post_ingestion.delay(
            document_id=doc_id,
            backfill_batch_id=chain_backfill_batch_id,
        )

        logger.info(
            "Processed candidate %s -> document %s (%d sections, tier=%s)",
            candidate_id,
            doc_id,
            len(section_ids),
            dedup_result.tier.value,
        )

        outcome_status = "accepted"
        return {
            "candidate_id": candidate_id,
            "document_id": doc_id,
            "version_id": version_id,
            "sections_created": len(section_ids),
            "dedup_tier": dedup_result.tier.value,
            "status": "accepted",
        }

    except Exception as exc:
        logger.exception("Failed to process candidate %s", candidate_id)
        db.update_candidate_status(candidate_id, "failed")

        # Route to DLQ if max retries exhausted
        if self.request.retries >= self.max_retries:
            from .dlq_tasks import handle_dead_letter

            handle_dead_letter.delay(
                task_name="ingestion.process_candidate",
                task_args={
                    "candidate_id": candidate_id,
                    "source_id": source_id,
                    "url": url,
                },
                error_message=str(exc),
                retry_count=self.request.retries,
            )
            outcome_status = "dead_letter"
            return {
                "candidate_id": candidate_id,
                "status": "dead_letter",
            }

        # About to re-enqueue — leave outcome_status as None so the
        # backfill hook does NOT fire (the job is still in flight).
        raise self.retry(exc=exc) from exc

    finally:
        if outcome_status is not None:
            _fire_backfill_completion_hook(candidate_metadata, outcome_status)


def _merge_metadata(
    candidate_meta: dict[str, Any],
    extracted_meta: dict[str, Any],
) -> dict[str, Any]:
    """Merge candidate metadata with extracted metadata.

    Candidate metadata (from listing page) takes precedence for fields
    it provides; extracted metadata fills in gaps.
    """
    result = dict(extracted_meta)
    for key, value in candidate_meta.items():
        if value is not None and value != "":
            result[key] = value
    return result


def _parse_date(date_str: str | None) -> str | None:
    """Try to parse a date string into ISO format for DB storage.

    Returns the date string as-is if parsing fails (DB will handle conversion).
    """
    if not date_str:
        return None

    from datetime import datetime

    # Try common formats
    formats = [
        "%B %d, %Y",  # January 15, 2024
        "%B %d %Y",  # January 15 2024
        "%d %B %Y",  # 15 January 2024
        "%Y-%m-%d",  # 2024-01-15
        "%m/%d/%Y",  # 01/15/2024
    ]

    for fmt in formats:
        try:
            dt = datetime.strptime(date_str.strip(), fmt)
            return dt.strftime("%Y-%m-%d")
        except ValueError:
            continue

    return None


# ─── Task 4: Post-Ingestion Chain ────────────────────────────────────────


@shared_task(
    bind=True,
    name="ingestion.post_ingestion_chain",
    acks_late=True,
    reject_on_worker_lost=True,
    max_retries=1,
    default_retry_delay=60,
)
def chain_post_ingestion(
    self: Any,
    document_id: str,
    backfill_batch_id: str | None = None,
) -> dict[str, Any]:
    """Fire-and-forget follow-up tasks after document ingestion.

    Chains existing tasks for citation extraction and doctrine extraction.
    Non-blocking to the main ingestion pipeline.

    ``backfill_batch_id`` is forwarded to LLM-incurring derivative tasks so
    their per-call cost can be charged to the originating backfill batch's
    ``budget_consumed_usd`` counter. ``None`` for daily-crawl / on-demand
    paths skips the per-batch metering (the global Redis budget rail still
    applies).
    """
    try:
        from .categorization_tasks import categorize_document_task
        from .citation_tasks import resolve_citations_task
        from .classification_generation_tasks import classify_document_subjects
        from .digest_tasks import generate_ingestion_digest
        from .doctrine_tasks import extract_doctrines_task
        from .embedding_tasks import generate_document_embeddings_task

        # Fire doctrine extraction (non-blocking). Forwards batch_id so
        # the LLM call's cost can be charged to the originating backfill
        # batch — without this, doctrine extraction was uncharged on
        # backfill paths and budget_consumed_usd showed $0 even on
        # batches with hundreds of LLM-bearing candidates.
        extract_doctrines_task.delay(
            document_id=document_id,
            strategy="auto",
            backfill_batch_id=backfill_batch_id,
        )

        # Fire citation resolution (non-blocking)
        resolve_citations_task.delay(document_id=document_id)

        # Fire auto-digest generation (non-blocking, skips non-case docs).
        # Forwards batch_id for the same cost-attribution reason as
        # doctrine extraction above.
        generate_ingestion_digest.delay(
            document_id=document_id,
            backfill_batch_id=backfill_batch_id,
        )

        # Fire bar subject categorization (non-blocking)
        categorize_document_task.delay(document_id=document_id)

        # Fire subject classification (non-blocking). Without this, new
        # documents wait up to 24 hours for the nightly beat batch —
        # derivatives generated in that window ship with no subject chip.
        classify_document_subjects.delay(
            document_id=document_id,
            backfill_batch_id=backfill_batch_id,
        )

        # Fire embedding generation for kNN vector search (non-blocking)
        generate_document_embeddings_task.delay(
            document_id=document_id,
            backfill_batch_id=backfill_batch_id,
        )

        # Fire validation with 60s delay to let extraction and digest tasks
        # start first. If validation runs before they complete, document
        # safely goes to human review (conservative default).
        validate_and_publish.apply_async(
            kwargs={"document_id": document_id},
            countdown=60,
        )

        logger.info("Dispatched post-ingestion tasks for document %s", document_id)
        return {"document_id": document_id, "status": "dispatched"}

    except SchemaIntegrityError:
        # Hard schema bug — surface it. Hiding this class of error is what
        # let the PascalCase identifier regression silently degrade 1421
        # documents in April 2026 before detection.
        logger.exception(
            "Post-ingestion chain hit SchemaIntegrityError for document %s — "
            "failing loudly to DLQ",
            document_id,
        )
        raise
    except Exception as exc:
        logger.warning(
            "Post-ingestion chain failed for document %s: %s (non-blocking)",
            document_id,
            exc,
        )
        # Don't retry — this is optional follow-up
        return {"document_id": document_id, "status": "failed", "error": str(exc)}


# ─── Task 5: Validate & Auto-Publish ─────────────────────────────────


@shared_task(
    bind=True,
    name="ingestion.validate_and_publish",
    acks_late=True,
    reject_on_worker_lost=True,
    max_retries=2,
    retry_backoff=True,
    retry_backoff_max=300,
    retry_jitter=True,
)
def validate_and_publish(self: Any, document_id: str) -> dict[str, Any]:
    """Validate a draft document and auto-publish, quarantine, or flag for review.

    Idempotent: skips documents already verified or quarantined.

    1. Loads document, source, sections, flags, citation counts from DB
    2. Calls truthfulness_validator.validate_document()
    3. Acts on verdict: publish / send to review / quarantine
    4. Creates audit log entry for every state change
    """
    # Load document
    doc = db.get_document_for_validation(document_id)
    if not doc:
        logger.warning("Document %s not found for validation", document_id)
        return {"document_id": document_id, "status": "not_found"}

    # Idempotent: skip if already verified or quarantined
    current_status = doc.get("truthfulness_status", "")
    if current_status in ("verified", "quarantined"):
        logger.info(
            "Skipping validation for document %s: already %s",
            document_id,
            current_status,
        )
        return {
            "document_id": document_id,
            "status": "skipped",
            "reason": f"already_{current_status}",
        }

    # Load related data
    source_id = doc.get("source_id")
    source = db.get_source_for_validation(source_id) if source_id else None
    sections = db.get_document_sections_for_validation(document_id)
    flags = db.get_editorial_flags_for_document(document_id)
    citation_counts = db.get_citation_counts(document_id)

    # Convert decision_date to string for the validator
    decision_date = doc.get("decision_date")
    decision_date_str = str(decision_date) if decision_date else None

    # Run validation
    result = validate_document(
        title=doc.get("title"),
        document_type=doc.get("document_type"),
        court=doc.get("court"),
        decision_date=decision_date_str,
        gr_no=doc.get("gr_no"),
        status=doc.get("status", "draft"),
        truthfulness_status=current_status,
        is_published=bool(doc.get("is_published")),
        source_trust_level=source.get("trust_level") if source else None,
        section_count=len(sections),
        is_from_scan=False,  # Ingested documents are never from camera scans
        ocr_confidence=None,  # No OCR for crawler-ingested docs
        open_flags=flags,
        total_citations=citation_counts["total"],
        resolved_citations=citation_counts["resolved"],
    )

    # Act on verdict
    verdict = result.verdict
    reasons_str = "; ".join(result.reasons)

    if verdict == Verdict.PUBLISH:
        db.publish_document(document_id)

        # Trigger OpenSearch indexing via NestJS internal endpoint
        indexed = nestjs_client.trigger_opensearch_index(document_id)
        if not indexed:
            logger.warning(
                "OpenSearch indexing failed for auto-published document %s "
                "(document is published in PostgreSQL but not yet searchable)",
                document_id,
            )

        db.create_audit_log(
            action="document.auto_publish",
            entity_type="legal_document",
            entity_id=document_id,
            metadata={
                "confidence_score": result.confidence_score,
                "reasons": result.reasons,
                "source": "validate_and_publish",
                "opensearch_indexed": indexed,
            },
        )
        logger.info(
            "Auto-published document %s (confidence=%.2f, indexed=%s)",
            document_id,
            result.confidence_score,
            indexed,
        )

    elif verdict == Verdict.QUARANTINE:
        db.quarantine_document(document_id)
        db.create_audit_log(
            action="document.quarantine",
            entity_type="legal_document",
            entity_id=document_id,
            metadata={
                "confidence_score": result.confidence_score,
                "reasons": result.reasons,
                "source": "validate_and_publish",
            },
        )
        logger.warning(
            "Quarantined document %s: %s", document_id, reasons_str,
        )

    else:
        # Human review — leave status as needs_review (no DB change needed)
        db.create_audit_log(
            action="document.needs_review",
            entity_type="legal_document",
            entity_id=document_id,
            metadata={
                "confidence_score": result.confidence_score,
                "reasons": result.reasons,
                "source": "validate_and_publish",
            },
        )
        logger.info(
            "Document %s sent to human review: %s", document_id, reasons_str,
        )

    return {
        "document_id": document_id,
        "status": verdict.value,
        "confidence_score": result.confidence_score,
        "reasons": result.reasons,
    }
