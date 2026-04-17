"""LIBERTASIAN Worker Service — NestJS API client.

HTTP client for calling internal NestJS endpoints from the worker service.
Per CLAUDE.md: NestJS is the single gateway. Python services call NestJS
over internal HTTP for operations like OpenSearch indexing.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from ..config import settings

logger = logging.getLogger(__name__)


def _strip_none(obj: Any) -> Any:
    """Recursively strip None values from dicts.

    NestJS @IsOptional() accepts missing keys but rejects JSON null.
    Python's None serializes to null, so we remove those keys entirely.
    """
    if isinstance(obj, dict):
        return {k: _strip_none(v) for k, v in obj.items() if v is not None}
    if isinstance(obj, list):
        return [_strip_none(item) for item in obj]
    return obj


_INTERNAL_HEADERS = {
    "X-Internal-Auth": settings.internal_api_key,
    "Content-Type": "application/json",
}


def trigger_opensearch_index(document_id: str) -> bool:
    """Call NestJS internal endpoint to index a document in OpenSearch.

    Returns True if indexing was triggered successfully, False otherwise.
    Non-blocking to the publish flow — failures are logged but not raised.
    """
    url = f"{settings.nestjs_api_url}/search/internal/index/{document_id}"

    try:
        with httpx.Client(timeout=30) as client:
            response = client.post(
                url,
                headers={"X-Internal-Api-Key": settings.internal_api_key},
            )

        if response.status_code == 200 or response.status_code == 201:
            logger.info(
                "Triggered OpenSearch indexing for document %s", document_id,
            )
            return True

        logger.warning(
            "OpenSearch index trigger returned %d for document %s: %s",
            response.status_code,
            document_id,
            response.text[:200],
        )
        return False

    except Exception:
        logger.exception(
            "Failed to trigger OpenSearch indexing for document %s",
            document_id,
        )
        return False


def update_job_status(
    job_id: str,
    status: str,
    **kwargs: Any,
) -> bool:
    """Update a DerivativeGenerationJob status via NestJS internal endpoint.

    Additional kwargs are passed as body fields (promptTemplateVersion,
    modelName, tokensIn, tokensOut, estimatedCostUsd, errorJson).
    """
    url = f"{settings.nestjs_api_url}/internal/derivatives/jobs/{job_id}/status"
    payload: dict[str, Any] = {"status": status, **kwargs}

    try:
        with httpx.Client(timeout=30) as client:
            response = client.post(url, json=payload, headers=_INTERNAL_HEADERS)
            response.raise_for_status()
        logger.info("Updated job %s status=%s", job_id, status)
        return True
    except Exception:
        logger.exception("Failed to update job %s status=%s", job_id, status)
        return False


def write_digest(payload: dict[str, Any]) -> dict[str, Any]:
    """Write a digest via NestJS POST /internal/derivatives/write-digest.

    Returns the response body (expected: { digestId: string }).
    Raises httpx.HTTPStatusError on failure.
    """
    url = f"{settings.nestjs_api_url}/internal/derivatives/write-digest"
    payload = _strip_none(payload)

    with httpx.Client(timeout=60) as client:
        response = client.post(url, json=payload, headers=_INTERNAL_HEADERS)
        response.raise_for_status()
        return response.json()


def write_doctrines(payload: dict[str, Any]) -> dict[str, Any]:
    """Write doctrines via NestJS POST /internal/derivatives/write-doctrines.

    Returns the response body (expected: { artifactId: string, doctrineIds: string[] }).
    Raises httpx.HTTPStatusError on failure.
    """
    url = f"{settings.nestjs_api_url}/internal/derivatives/write-doctrines"
    payload = _strip_none(payload)

    with httpx.Client(timeout=60) as client:
        response = client.post(url, json=payload, headers=_INTERNAL_HEADERS)
        response.raise_for_status()
        return response.json()


def write_mcq_batch(payload: dict[str, Any]) -> dict[str, Any]:
    """Write MCQ batch via NestJS POST /internal/derivatives/write-mcq-batch.

    Returns the response body (expected: { artifactIds: string[], questionIds: string[] }).
    Raises httpx.HTTPStatusError on failure.
    """
    url = f"{settings.nestjs_api_url}/internal/derivatives/write-mcq-batch"
    payload = _strip_none(payload)

    with httpx.Client(timeout=60) as client:
        response = client.post(url, json=payload, headers=_INTERNAL_HEADERS)
        response.raise_for_status()
        return response.json()


def write_essay(payload: dict[str, Any]) -> dict[str, Any]:
    """Write essay prompt via NestJS POST /internal/derivatives/write-essay.

    Returns the response body (expected: { artifactId: string, essayPromptId: string }).
    Raises httpx.HTTPStatusError on failure.
    """
    url = f"{settings.nestjs_api_url}/internal/derivatives/write-essay"
    payload = _strip_none(payload)

    with httpx.Client(timeout=60) as client:
        response = client.post(url, json=payload, headers=_INTERNAL_HEADERS)
        response.raise_for_status()
        return response.json()


def write_derivative(payload: dict[str, Any]) -> dict[str, Any]:
    """Write a generic derivative artifact via NestJS POST /internal/derivatives/write.

    Returns the response body (expected: { artifactId: string }).
    Raises httpx.HTTPStatusError on failure.
    """
    url = f"{settings.nestjs_api_url}/internal/derivatives/write"
    payload = _strip_none(payload)

    with httpx.Client(timeout=60) as client:
        response = client.post(url, json=payload, headers=_INTERNAL_HEADERS)
        response.raise_for_status()
        return response.json()


def write_flashcards(payload: dict[str, Any]) -> dict[str, Any]:
    """Write flashcards via NestJS POST /internal/derivatives/write-flashcards.

    Returns the response body (expected: { setId: string, cardIds: string[] }).
    Raises httpx.HTTPStatusError on failure.
    """
    url = f"{settings.nestjs_api_url}/internal/derivatives/write-flashcards"
    payload = _strip_none(payload)

    with httpx.Client(timeout=60) as client:
        response = client.post(url, json=payload, headers=_INTERNAL_HEADERS)
        response.raise_for_status()
        return response.json()


def write_classification(payload: dict[str, Any]) -> dict[str, Any]:
    """Write classification via NestJS POST /internal/derivatives/write-classification.

    Returns the response body (expected: { assignmentIds: string[] }).
    Raises httpx.HTTPStatusError on failure.
    """
    url = f"{settings.nestjs_api_url}/internal/derivatives/write-classification"
    payload = _strip_none(payload)

    with httpx.Client(timeout=60) as client:
        response = client.post(url, json=payload, headers=_INTERNAL_HEADERS)
        response.raise_for_status()
        return response.json()
