"""Tests for ingestion pipeline Celery tasks.

All external dependencies are mocked:
- Database client (ingestion_db_client)
- S3 client
- NestJS client
- Fetcher registry

Tests verify task orchestration, deduplication, error handling,
retry logic, and DLQ routing.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock, patch, call

import pytest

from .conftest import make_uuid


# ─── Poll Pending Jobs ──────────────────────────────────────────────────


class TestPollPendingJobs:
    """Tests for the periodic poller task."""

    def test_no_pending_jobs_returns_zero(
        self,
        mock_ingestion_db: MagicMock,
    ) -> None:
        from src.tasks.ingestion_tasks import poll_pending_ingestion_jobs

        mock_ingestion_db.get_pending_ingestion_jobs.return_value = []

        result = poll_pending_ingestion_jobs()
        assert result["dispatched"] == 0
        assert result["status"] == "ok"

    def test_dispatches_jobs_for_pending(
        self,
        mock_ingestion_db: MagicMock,
    ) -> None:
        from src.tasks.ingestion_tasks import poll_pending_ingestion_jobs

        job1_id = make_uuid()
        job2_id = make_uuid()
        mock_ingestion_db.get_pending_ingestion_jobs.return_value = [
            {"id": job1_id},
            {"id": job2_id},
        ]

        with patch("src.tasks.ingestion_tasks.run_ingestion_job") as mock_run:
            mock_run.delay = MagicMock()
            result = poll_pending_ingestion_jobs()

        assert result["dispatched"] == 2
        assert mock_run.delay.call_count == 2

    def test_limits_to_five_jobs(
        self,
        mock_ingestion_db: MagicMock,
    ) -> None:
        from src.tasks.ingestion_tasks import poll_pending_ingestion_jobs

        poll_pending_ingestion_jobs()
        mock_ingestion_db.get_pending_ingestion_jobs.assert_called_once_with(limit=5)


# ─── Run Ingestion Job ──────────────────────────────────────────────────


class TestRunIngestionJob:
    """Tests for the job orchestrator task."""

    def test_already_claimed_job_returns_early(
        self,
        mock_ingestion_db: MagicMock,
        job_id: str,
    ) -> None:
        from src.tasks.ingestion_tasks import run_ingestion_job

        mock_ingestion_db.claim_ingestion_job.return_value = False

        result = run_ingestion_job(job_id=job_id)
        assert result["status"] == "already_claimed"

    def test_missing_source_fails_job(
        self,
        mock_ingestion_db: MagicMock,
        job_id: str,
    ) -> None:
        from src.tasks.ingestion_tasks import run_ingestion_job

        mock_ingestion_db.claim_ingestion_job.return_value = True
        mock_ingestion_db.get_source_with_endpoints.return_value = None

        with patch("src.tasks.ingestion_tasks._get_job_info") as mock_info:
            mock_info.return_value = {
                "id": job_id,
                "source_id": make_uuid(),
                "source_endpoint_id": None,
                "job_type": "crawl",
                "status": "running",
            }
            result = run_ingestion_job(job_id=job_id)

        assert result["status"] == "error"
        assert result["error"] == "source_not_found"
        mock_ingestion_db.fail_ingestion_job.assert_called_once()

    def test_disabled_source_fails_job(
        self,
        mock_ingestion_db: MagicMock,
        job_id: str,
        source_id: str,
    ) -> None:
        from src.tasks.ingestion_tasks import run_ingestion_job

        mock_ingestion_db.claim_ingestion_job.return_value = True
        mock_ingestion_db.get_source_with_endpoints.return_value = {
            "id": source_id,
            "enabled": False,
            "endpoints": [],
        }

        with patch("src.tasks.ingestion_tasks._get_job_info") as mock_info:
            mock_info.return_value = {
                "id": job_id,
                "source_id": source_id,
                "source_endpoint_id": None,
                "job_type": "crawl",
                "status": "running",
            }
            result = run_ingestion_job(job_id=job_id)

        assert result["status"] == "error"
        assert result["error"] == "source_disabled"

    def test_no_endpoints_fails_job(
        self,
        mock_ingestion_db: MagicMock,
        job_id: str,
        source_id: str,
    ) -> None:
        from src.tasks.ingestion_tasks import run_ingestion_job

        mock_ingestion_db.claim_ingestion_job.return_value = True
        mock_ingestion_db.get_source_with_endpoints.return_value = {
            "id": source_id,
            "enabled": True,
            "endpoints": [],
        }

        with patch("src.tasks.ingestion_tasks._get_job_info") as mock_info:
            mock_info.return_value = {
                "id": job_id,
                "source_id": source_id,
                "source_endpoint_id": None,
                "job_type": "crawl",
                "status": "running",
            }
            result = run_ingestion_job(job_id=job_id)

        assert result["status"] == "error"
        assert result["error"] == "no_endpoints"

    def test_successful_job_completes(
        self,
        mock_ingestion_db: MagicMock,
        job_id: str,
        source_id: str,
        sample_source: dict[str, Any],
    ) -> None:
        from src.tasks.ingestion_tasks import run_ingestion_job

        mock_ingestion_db.claim_ingestion_job.return_value = True
        mock_ingestion_db.get_source_with_endpoints.return_value = sample_source

        with patch("src.tasks.ingestion_tasks._get_job_info") as mock_info, \
             patch("src.tasks.ingestion_tasks._process_endpoint") as mock_proc:
            mock_info.return_value = {
                "id": job_id,
                "source_id": source_id,
                "source_endpoint_id": None,
                "job_type": "crawl",
                "status": "running",
            }
            mock_proc.return_value = {
                "found": 3,
                "created": 2,
                "updated": 1,
                "errors": [],
            }

            result = run_ingestion_job(job_id=job_id)

        assert result["status"] == "completed"
        assert result["records_found"] == 3
        assert result["records_created"] == 2
        assert result["records_updated"] == 1
        mock_ingestion_db.complete_ingestion_job.assert_called_once()

    def test_cloudflare_blocked_endpoint_completes_with_structured_error(
        self,
        mock_ingestion_db: MagicMock,
        job_id: str,
        source_id: str,
        sample_source: dict[str, Any],
    ) -> None:
        """A Cloudflare-blocked endpoint must not fail the job.

        Regression test for Issue 2: officialgazette.gov.ph and congress.gov.ph
        sit behind Cloudflare Turnstile. The fetcher raises CloudflareBlockedError;
        the pipeline must swallow it into errors_json and still complete the job.
        """
        from src.fetchers.base import CloudflareBlockedError
        from src.tasks.ingestion_tasks import _process_endpoint

        endpoint = sample_source["endpoints"][0]

        mock_fetcher = MagicMock()
        mock_fetcher.discover.side_effect = CloudflareBlockedError(
            endpoint_url=endpoint["endpoint_url"],
            status_code=403,
            cf_type="managed_challenge",
        )

        with patch("src.tasks.ingestion_tasks.get_fetcher", return_value=mock_fetcher):
            result = _process_endpoint(source_id=source_id, endpoint=endpoint)

        assert result["found"] == 0
        assert result["created"] == 0
        assert result["updated"] == 0
        assert len(result["errors"]) == 1

        err = result["errors"][0]
        assert err["type"] == "cloudflare_blocked"
        assert err["endpoint_id"] == endpoint["id"]
        assert err["endpoint_url"] == endpoint["endpoint_url"]
        assert err["parser_type"] == endpoint["parser_type"]
        assert err["status_code"] == 403
        assert err["cf_type"] == "managed_challenge"
        assert "detected_at" in err
        assert "message" in err


# ─── Process Ingestion Candidate ─────────────────────────────────────────


class TestProcessIngestionCandidate:
    """Tests for the per-document processor task."""

    def test_duplicate_checksum_returns_duplicate(
        self,
        mock_ingestion_db: MagicMock,
        mock_s3_client: MagicMock,
        candidate_id: str,
        source_id: str,
    ) -> None:
        from src.tasks.ingestion_tasks import process_ingestion_candidate

        existing_doc_id = make_uuid()
        mock_ingestion_db.find_document_by_checksum.return_value = {
            "id": existing_doc_id,
        }

        with patch("src.tasks.ingestion_tasks.get_fetcher") as mock_fetcher_fn:
            mock_fetcher = MagicMock()
            mock_fetcher.fetch_content.return_value = MagicMock(
                html="<html><body>Test content</body></html>",
            )
            mock_fetcher_fn.return_value = mock_fetcher

            result = process_ingestion_candidate(
                candidate_id=candidate_id,
                source_id=source_id,
                url="https://example.com/case/123",
                parser_type="supreme_court_elibrary",
            )

        assert result["status"] == "duplicate"
        assert result["matched_document_id"] == existing_doc_id
        mock_ingestion_db.update_candidate_status.assert_called_with(
            candidate_id, "duplicate",
        )

    def test_no_fetcher_rejects_candidate(
        self,
        mock_ingestion_db: MagicMock,
        candidate_id: str,
        source_id: str,
    ) -> None:
        from src.tasks.ingestion_tasks import process_ingestion_candidate

        with patch("src.tasks.ingestion_tasks.get_fetcher") as mock_fetcher_fn:
            mock_fetcher_fn.return_value = None

            result = process_ingestion_candidate(
                candidate_id=candidate_id,
                source_id=source_id,
                url="https://example.com/case/123",
                parser_type="unknown_parser",
            )

        assert result["status"] == "error"
        mock_ingestion_db.update_candidate_status.assert_called_with(
            candidate_id, "rejected",
        )

    def test_new_document_creates_records(
        self,
        mock_ingestion_db: MagicMock,
        mock_s3_client: MagicMock,
        candidate_id: str,
        source_id: str,
    ) -> None:
        from src.tasks.ingestion_tasks import process_ingestion_candidate

        new_doc_id = make_uuid()
        new_version_id = make_uuid()
        mock_ingestion_db.find_document_by_checksum.return_value = None
        mock_ingestion_db.find_document_by_gr_no.return_value = None
        mock_ingestion_db.create_legal_document.return_value = new_doc_id
        mock_ingestion_db.create_legal_document_version.return_value = new_version_id

        with patch("src.tasks.ingestion_tasks.get_fetcher") as mock_fetcher_fn, \
             patch("src.tasks.ingestion_tasks.parse_legal_document") as mock_parse, \
             patch("src.tasks.ingestion_tasks.extract_sections") as mock_sections, \
             patch("src.tasks.ingestion_tasks.extract_metadata") as mock_meta, \
             patch("src.tasks.ingestion_tasks.chain_post_ingestion") as mock_chain:
            mock_fetcher = MagicMock()
            mock_fetcher.fetch_content.return_value = MagicMock(
                html="<html><body>Case decision text</body></html>",
            )
            mock_fetcher_fn.return_value = mock_fetcher
            mock_parse.return_value = "Case decision text"
            mock_sections.return_value = [
                {"section_type": "body", "plain_text": "Case decision text"},
            ]
            mock_meta.return_value = {
                "title": "Test Case",
                "gr_no": "G.R. No. 999999",
                "court": "Supreme Court",
            }
            mock_chain.delay = MagicMock()

            result = process_ingestion_candidate(
                candidate_id=candidate_id,
                source_id=source_id,
                url="https://example.com/case/999",
                parser_type="supreme_court_elibrary",
            )

        assert result["status"] == "accepted"
        assert result["document_id"] == new_doc_id
        mock_ingestion_db.create_legal_document.assert_called_once()
        mock_ingestion_db.create_legal_document_version.assert_called_once()
        mock_s3_client.upload_file.assert_called()
        mock_ingestion_db.update_candidate_status.assert_called_with(
            candidate_id, "accepted",
        )
        mock_chain.delay.assert_called_once()


# ─── Validate and Publish ────────────────────────────────────────────────


class TestValidateAndPublish:
    """Tests for the validation and auto-publish task."""

    def test_document_not_found_returns_not_found(
        self,
        mock_ingestion_db: MagicMock,
        document_id: str,
    ) -> None:
        from src.tasks.ingestion_tasks import validate_and_publish

        mock_ingestion_db.get_document_for_validation.return_value = None

        result = validate_and_publish(document_id=document_id)
        assert result["status"] == "not_found"

    def test_already_verified_skips(
        self,
        mock_ingestion_db: MagicMock,
        document_id: str,
    ) -> None:
        from src.tasks.ingestion_tasks import validate_and_publish

        mock_ingestion_db.get_document_for_validation.return_value = {
            "id": document_id,
            "truthfulness_status": "verified",
        }

        result = validate_and_publish(document_id=document_id)
        assert result["status"] == "skipped"
        assert result["reason"] == "already_verified"

    def test_already_quarantined_skips(
        self,
        mock_ingestion_db: MagicMock,
        document_id: str,
    ) -> None:
        from src.tasks.ingestion_tasks import validate_and_publish

        mock_ingestion_db.get_document_for_validation.return_value = {
            "id": document_id,
            "truthfulness_status": "quarantined",
        }

        result = validate_and_publish(document_id=document_id)
        assert result["status"] == "skipped"

    def test_auto_publish_on_high_trust(
        self,
        mock_ingestion_db: MagicMock,
        mock_nestjs_client: MagicMock,
        document_id: str,
        source_id: str,
    ) -> None:
        from src.tasks.ingestion_tasks import validate_and_publish

        mock_ingestion_db.get_document_for_validation.return_value = {
            "id": document_id,
            "source_id": source_id,
            "title": "Test Case",
            "document_type": "case",
            "court": "Supreme Court",
            "decision_date": "2024-01-15",
            "gr_no": "G.R. No. 123456",
            "status": "draft",
            "truthfulness_status": "needs_review",
            "is_published": False,
        }
        mock_ingestion_db.get_source_for_validation.return_value = {
            "trust_level": "high",
        }
        mock_ingestion_db.get_document_sections_for_validation.return_value = [
            {"id": make_uuid()},
        ]
        mock_ingestion_db.get_editorial_flags_for_document.return_value = []
        mock_ingestion_db.get_citation_counts.return_value = {
            "total": 0,
            "resolved": 0,
        }

        result = validate_and_publish(document_id=document_id)

        assert result["status"] == "publish"
        mock_ingestion_db.publish_document.assert_called_once_with(document_id)
        mock_nestjs_client.trigger_opensearch_index.assert_called_once_with(
            document_id,
        )
        mock_ingestion_db.create_audit_log.assert_called_once()

    def test_quarantine_on_low_ocr(
        self,
        mock_ingestion_db: MagicMock,
        document_id: str,
        source_id: str,
    ) -> None:
        from src.tasks.ingestion_tasks import validate_and_publish

        mock_ingestion_db.get_document_for_validation.return_value = {
            "id": document_id,
            "source_id": source_id,
            "title": None,
            "document_type": "case",
            "court": None,
            "decision_date": None,
            "gr_no": None,
            "status": "draft",
            "truthfulness_status": "needs_review",
            "is_published": False,
        }
        mock_ingestion_db.get_source_for_validation.return_value = {
            "trust_level": "low",
        }
        mock_ingestion_db.get_document_sections_for_validation.return_value = []
        mock_ingestion_db.get_editorial_flags_for_document.return_value = []
        mock_ingestion_db.get_citation_counts.return_value = {
            "total": 0,
            "resolved": 0,
        }

        result = validate_and_publish(document_id=document_id)

        assert result["status"] == "quarantine"
        mock_ingestion_db.quarantine_document.assert_called_once_with(document_id)


# ─── Post-Ingestion Chain ───────────────────────────────────────────────


class TestChainPostIngestion:
    """Tests for the post-ingestion chain task."""

    def test_dispatches_follow_up_tasks(
        self,
        document_id: str,
    ) -> None:
        from src.tasks.ingestion_tasks import chain_post_ingestion

        with patch("src.tasks.ingestion_tasks.validate_and_publish") as mock_val, \
             patch("src.tasks.citation_tasks.resolve_citations_task") as mock_cit, \
             patch("src.tasks.doctrine_tasks.extract_doctrines_task") as mock_doc, \
             patch("src.tasks.digest_tasks.generate_ingestion_digest") as mock_digest, \
             patch("src.tasks.categorization_tasks.categorize_document_task") as mock_cat, \
             patch("src.tasks.classification_generation_tasks.classify_document_subjects") as mock_classify, \
             patch("src.tasks.embedding_tasks.generate_document_embeddings_task") as mock_embed:
            mock_val.apply_async = MagicMock()
            mock_cit.delay = MagicMock()
            mock_doc.delay = MagicMock()
            mock_digest.delay = MagicMock()
            mock_cat.delay = MagicMock()
            mock_classify.delay = MagicMock()
            mock_embed.delay = MagicMock()

            result = chain_post_ingestion(document_id=document_id)

        assert result["status"] == "dispatched"
        mock_doc.delay.assert_called_once()
        mock_cit.delay.assert_called_once()
        mock_digest.delay.assert_called_once()
        mock_cat.delay.assert_called_once()
        mock_classify.delay.assert_called_once_with(
            document_id=document_id,
            backfill_batch_id=None,
        )
        mock_embed.delay.assert_called_once_with(
            document_id=document_id,
            backfill_batch_id=None,
        )
        mock_val.apply_async.assert_called_once()


# ─── Date Parsing Helper ────────────────────────────────────────────────


class TestParseDateHelper:
    """Tests for the _parse_date helper function."""

    def test_iso_format(self) -> None:
        from src.tasks.ingestion_tasks import _parse_date

        assert _parse_date("2024-01-15") == "2024-01-15"

    def test_long_format(self) -> None:
        from src.tasks.ingestion_tasks import _parse_date

        assert _parse_date("January 15, 2024") == "2024-01-15"

    def test_none_returns_none(self) -> None:
        from src.tasks.ingestion_tasks import _parse_date

        assert _parse_date(None) is None

    def test_unparseable_returns_none(self) -> None:
        from src.tasks.ingestion_tasks import _parse_date

        assert _parse_date("not-a-date") is None

    def test_us_slash_format(self) -> None:
        from src.tasks.ingestion_tasks import _parse_date

        assert _parse_date("01/15/2024") == "2024-01-15"
