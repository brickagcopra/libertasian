"""LIBERTASIAN Worker Service — HTTP client for the Python OCR service.

Celery tasks call these functions to invoke the OCR service endpoints
for quality scoring, text extraction, classification, and citation extraction.
"""

import logging
from typing import Any

import httpx

from ..config import settings

logger = logging.getLogger(__name__)


def score_quality(image_bytes: bytes, filename: str = "image.jpg") -> dict[str, Any]:
    """Call the OCR service quality scoring endpoint.

    Args:
        image_bytes: Raw image file bytes.
        filename: Original filename for MIME detection.

    Returns:
        Quality score response dict with overall_score, metrics, etc.
    """
    url = f"{settings.ocr_service_url}/quality/score"
    files = {"file": (filename, image_bytes)}

    with httpx.Client(timeout=settings.quality_request_timeout) as client:
        response = client.post(url, files=files)
        response.raise_for_status()
        result: dict[str, Any] = response.json()
        return result


def extract_text(
    image_bytes: bytes,
    filename: str = "image.jpg",
    language: str = "eng",
) -> dict[str, Any]:
    """Call the OCR service text extraction endpoint.

    Args:
        image_bytes: Raw image file bytes.
        filename: Original filename for MIME detection.
        language: Tesseract language code.

    Returns:
        OCR response dict with text, confidence, word_count, language_detected.
    """
    url = f"{settings.ocr_service_url}/ocr/extract"
    files = {"file": (filename, image_bytes)}
    data = {"language": language}

    with httpx.Client(timeout=settings.ocr_request_timeout) as client:
        response = client.post(url, files=files, data=data)
        response.raise_for_status()
        result: dict[str, Any] = response.json()
        return result


def classify_document(text: str) -> dict[str, Any]:
    """Call the OCR service document classification endpoint.

    Args:
        text: OCR-extracted text.

    Returns:
        Classification result dict with document_type and confidence.
    """
    url = f"{settings.ocr_service_url}/classify"

    with httpx.Client(timeout=settings.classify_request_timeout) as client:
        response = client.post(url, json={"text": text})
        response.raise_for_status()
        result: dict[str, Any] = response.json()
        return result


def extract_citations(text: str) -> dict[str, Any]:
    """Call the OCR service citation extraction endpoint.

    Args:
        text: OCR-extracted text.

    Returns:
        Citation result dict with citations and normalized_citations lists.
    """
    url = f"{settings.ocr_service_url}/citations/extract"

    with httpx.Client(timeout=settings.citation_request_timeout) as client:
        response = client.post(url, json={"text": text})
        response.raise_for_status()
        result: dict[str, Any] = response.json()
        return result
