"""LIBERTASIAN Worker Service — OCR pipeline Celery tasks.

Full implementations for Phase 3 Batch 3. Each task is idempotent
(per CLAUDE.md: acks_late + reject_on_worker_lost).

Pipeline flow: quality_score → ocr_extract → classify → extract_citations
"""

import logging
import os

from celery import shared_task

from ..clients import db_client, ocr_client, s3_client

logger = logging.getLogger(__name__)


@shared_task(
    name="ocr.quality_score",
    bind=True,
    acks_late=True,
    reject_on_worker_lost=True,
    max_retries=3,
    default_retry_delay=30,
)
def quality_score_task(
    self,  # type: ignore[no-untyped-def]
    upload_id: str,
    object_key: str,
    page_number: int = 1,
) -> dict:  # type: ignore[type-arg]
    """Score the quality of an uploaded image.

    Downloads the image from S3, sends it to the OCR service quality endpoint,
    updates the database with the score, and returns the result.

    Args:
        upload_id: UUID of the UserUpload record.
        object_key: S3 object key for the image.
        page_number: Page number (1-indexed) for multi-page scans.

    Returns:
        dict with quality_score, is_acceptable, and metrics.
    """
    logger.info(
        "quality_score_task: upload=%s page=%d key=%s",
        upload_id,
        page_number,
        object_key,
    )

    try:
        # Download image from S3
        image_bytes = s3_client.download_file(object_key)
        filename = os.path.basename(object_key)

        # Call OCR service quality endpoint
        result = ocr_client.score_quality(image_bytes, filename)

        overall_score = result.get("overall_score", 0.0)
        is_acceptable = result.get("is_acceptable", False)

        # Update camera capture quality score
        db_client.update_camera_capture_quality(upload_id, overall_score)

        logger.info(
            "quality_score_task complete: upload=%s score=%.4f acceptable=%s",
            upload_id,
            overall_score,
            is_acceptable,
        )

        return {
            "upload_id": upload_id,
            "page_number": page_number,
            "quality_score": overall_score,
            "is_acceptable": is_acceptable,
            "metrics": result.get("metrics", {}),
            "recommendation": result.get("recommendation", ""),
            "status": "completed",
        }

    except Exception as exc:
        logger.error(
            "quality_score_task failed: upload=%s error=%s",
            upload_id,
            str(exc),
        )
        # Update job status on final retry
        if self.request.retries >= self.max_retries:
            db_client.update_processing_job(
                upload_id,
                "quality_check",
                "failed",
                error_message=str(exc),
            )
        raise self.retry(exc=exc)


@shared_task(
    name="ocr.extract_text",
    bind=True,
    acks_late=True,
    reject_on_worker_lost=True,
    max_retries=3,
    default_retry_delay=60,
)
def ocr_extract_task(
    self,  # type: ignore[no-untyped-def]
    upload_id: str,
    object_key: str,
    page_number: int = 1,
    language: str = "eng",
) -> dict:  # type: ignore[type-arg]
    """Run OCR text extraction on an image.

    Downloads image from S3, calls OCR service for text extraction,
    stores the extracted text back in S3, creates an OcrResult record,
    and updates the upload status.

    Args:
        upload_id: UUID of the UserUpload record.
        object_key: S3 object key for the image.
        page_number: Page number (1-indexed).
        language: Tesseract language code.

    Returns:
        dict with extracted text, confidence, word count, and S3 key for text.
    """
    logger.info(
        "ocr_extract_task: upload=%s page=%d key=%s lang=%s",
        upload_id,
        page_number,
        object_key,
        language,
    )

    try:
        # Update status to processing
        db_client.update_upload_ocr_status(upload_id, "processing")

        # Download image from S3
        image_bytes = s3_client.download_file(object_key)
        filename = os.path.basename(object_key)

        # Call OCR service for text extraction
        result = ocr_client.extract_text(image_bytes, filename, language)

        text = result.get("text", "")
        confidence = result.get("confidence", 0.0)
        word_count = result.get("word_count", 0)
        language_detected = result.get("language_detected", language)

        # Store extracted text in S3
        # Path: same directory as image, with ocr_text suffix
        base_dir = os.path.dirname(object_key)
        text_key = f"{base_dir}/ocr_text_page_{page_number}.txt"
        s3_client.upload_file(text_key, text.encode("utf-8"), "text/plain; charset=utf-8")

        # Create OcrResult record in database
        db_client.create_ocr_result(
            upload_id=upload_id,
            page_number=page_number,
            quality_score=None,  # Set separately by quality_score_task
            ocr_confidence=confidence,
            language_detected=language_detected,
            extracted_text_object_key=text_key,
            word_count=word_count,
        )

        # Update upload with OCR text location
        db_client.update_upload_classification(
            upload_id=upload_id,
            document_type="unknown",  # Will be updated by classify task
            citations_json={"citations": [], "normalized_citations": []},
            ocr_text_object_key=text_key,
        )

        db_client.update_upload_ocr_status(upload_id, "completed")

        logger.info(
            "ocr_extract_task complete: upload=%s words=%d confidence=%.4f",
            upload_id,
            word_count,
            confidence,
        )

        return {
            "upload_id": upload_id,
            "page_number": page_number,
            "text": text,
            "confidence": confidence,
            "word_count": word_count,
            "language_detected": language_detected,
            "text_object_key": text_key,
            "status": "completed",
        }

    except Exception as exc:
        logger.error(
            "ocr_extract_task failed: upload=%s error=%s",
            upload_id,
            str(exc),
        )
        if self.request.retries >= self.max_retries:
            db_client.update_upload_ocr_status(upload_id, "failed")
            db_client.update_upload_processing_status(upload_id, "failed")
            db_client.update_processing_job(
                upload_id,
                "process_camera_scan",
                "failed",
                error_message=str(exc),
            )
        raise self.retry(exc=exc)


@shared_task(
    name="ocr.classify_document",
    bind=True,
    acks_late=True,
    reject_on_worker_lost=True,
    max_retries=2,
    default_retry_delay=30,
)
def classify_document_task(
    self,  # type: ignore[no-untyped-def]
    upload_id: str,
    extracted_text: str,
) -> dict:  # type: ignore[type-arg]
    """Classify a document type from its OCR-extracted text.

    Calls the OCR service classification endpoint and updates the
    UserUpload record with the result.

    Non-blocking: classification failure does not fail the pipeline.

    Args:
        upload_id: UUID of the UserUpload record.
        extracted_text: Full text extracted by OCR.

    Returns:
        dict with document_type and confidence.
    """
    logger.info("classify_document_task: upload=%s text_len=%d", upload_id, len(extracted_text))

    try:
        result = ocr_client.classify_document(extracted_text)

        document_type = result.get("document_type", "unknown")
        confidence = result.get("confidence", 0.0)

        # Update upload with classification (preserve existing citations)
        db_client.update_upload_classification(
            upload_id=upload_id,
            document_type=document_type,
            citations_json={"citations": [], "normalized_citations": []},
        )

        logger.info(
            "classify_document_task complete: upload=%s type=%s confidence=%.4f",
            upload_id,
            document_type,
            confidence,
        )

        return {
            "upload_id": upload_id,
            "document_type": document_type,
            "confidence": confidence,
            "status": "completed",
        }

    except Exception as exc:
        logger.warning(
            "classify_document_task failed (non-blocking): upload=%s error=%s",
            upload_id,
            str(exc),
        )
        # Classification failure is non-blocking per pipeline design
        return {
            "upload_id": upload_id,
            "document_type": "unknown",
            "confidence": 0.0,
            "status": "failed",
            "error": str(exc),
        }


@shared_task(
    name="ocr.extract_citations",
    bind=True,
    acks_late=True,
    reject_on_worker_lost=True,
    max_retries=2,
    default_retry_delay=30,
)
def extract_citations_task(
    self,  # type: ignore[no-untyped-def]
    upload_id: str,
    extracted_text: str,
) -> dict:  # type: ignore[type-arg]
    """Extract legal citations from OCR-extracted text.

    Calls the OCR service citation extraction endpoint and updates
    the UserUpload record with the results.

    Non-blocking: citation extraction failure does not fail the pipeline.

    Args:
        upload_id: UUID of the UserUpload record.
        extracted_text: Full text extracted by OCR.

    Returns:
        dict with lists of raw and normalized citations.
    """
    logger.info("extract_citations_task: upload=%s text_len=%d", upload_id, len(extracted_text))

    try:
        result = ocr_client.extract_citations(extracted_text)

        citations = result.get("citations", [])
        normalized = result.get("normalized_citations", [])

        # Update upload with citations
        db_client.update_upload_classification(
            upload_id=upload_id,
            document_type="unknown",  # Don't overwrite existing classification
            citations_json={
                "citations": citations,
                "normalized_citations": normalized,
            },
        )

        logger.info(
            "extract_citations_task complete: upload=%s found=%d citations",
            upload_id,
            len(citations),
        )

        return {
            "upload_id": upload_id,
            "citations": citations,
            "normalized_citations": normalized,
            "status": "completed",
        }

    except Exception as exc:
        logger.warning(
            "extract_citations_task failed (non-blocking): upload=%s error=%s",
            upload_id,
            str(exc),
        )
        # Citation extraction failure is non-blocking
        return {
            "upload_id": upload_id,
            "citations": [],
            "normalized_citations": [],
            "status": "failed",
            "error": str(exc),
        }
