"""LIBERTASIAN Worker Service — NestJS API client.

HTTP client for calling internal NestJS endpoints from the worker service.
Per CLAUDE.md: NestJS is the single gateway. Python services call NestJS
over internal HTTP for operations like OpenSearch indexing.
"""

from __future__ import annotations

import logging
import random
import time
from typing import Any

import httpx

from ..config import settings

logger = logging.getLogger(__name__)

# Longest we will honour from a Retry-After header. The header is server-
# supplied; without a cap a bogus value parks a Celery worker for hours.
MAX_RETRY_AFTER_SEC = 60.0


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


def _is_retryable_status(status_code: int) -> bool:
    """429 and 5xx are transient. Every other 4xx is a caller bug.

    401 means the shared secret is wrong and 404 means the document is not
    there — retrying either just multiplies the same failure.
    """
    return status_code == 429 or status_code >= 500


def _retry_after_seconds(response: httpx.Response) -> float | None:
    """Delay requested by the server, in seconds, or None.

    Only the delta-seconds form of Retry-After is honoured; that is what the
    NestJS throttler emits. An HTTP-date, a negative value or junk falls back
    to the caller's own backoff rather than being guessed at.
    """
    raw = response.headers.get("Retry-After")
    if raw is None:
        return None
    try:
        seconds = float(raw.strip())
    except (TypeError, ValueError):
        return None
    if seconds < 0:
        return None
    return min(seconds, MAX_RETRY_AFTER_SEC)


def _backoff_delay(attempt: int) -> float:
    """Exponential backoff with full jitter for ``attempt`` (1-based).

    Jitter matters more than the mean delay here: a bulk publish run fails a
    whole burst of calls at once, and an unjittered backoff marches them back
    into the gateway in lockstep.
    """
    base = settings.opensearch_index_retry_base_delay
    return random.uniform(0.0, base * (2 ** (attempt - 1)))


def trigger_opensearch_index(document_id: str) -> bool:
    """Call NestJS internal endpoint to index a document in OpenSearch.

    Retries up to ``settings.opensearch_index_max_attempts`` times on 429,
    5xx, timeouts and connection errors, with jittered exponential backoff
    (``settings.opensearch_index_retry_base_delay``) and honouring
    ``Retry-After`` when the server sends one. 401 and 404 are not retried.

    Returns True if indexing was triggered successfully, False after every
    attempt has been spent. Non-blocking to the publish flow — failures are
    logged but not raised. The final status code (or transport error) is
    logged: before this, a 429 and a 500 were indistinguishable after the
    fact, which is why the #322 backfill's 5,220 failures needed a prod
    query to diagnose.
    """
    url = f"{settings.nestjs_api_url}/search/internal/index/{document_id}"
    attempts = max(1, settings.opensearch_index_max_attempts)
    last_outcome = "no attempt made"

    for attempt in range(1, attempts + 1):
        delay: float | None = None
        try:
            with httpx.Client(timeout=30) as client:
                response = client.post(
                    url,
                    headers={"X-Internal-Api-Key": settings.internal_api_key},
                )

            if response.status_code in (200, 201):
                if attempt > 1:
                    logger.info(
                        "Triggered OpenSearch indexing for document %s on "
                        "attempt %d/%d",
                        document_id, attempt, attempts,
                    )
                else:
                    logger.info(
                        "Triggered OpenSearch indexing for document %s",
                        document_id,
                    )
                return True

            last_outcome = f"HTTP {response.status_code}"
            if not _is_retryable_status(response.status_code):
                logger.warning(
                    "OpenSearch index trigger returned %d for document %s "
                    "(not retryable): %s",
                    response.status_code,
                    document_id,
                    response.text[:200],
                )
                return False

            delay = _retry_after_seconds(response)

        except httpx.TransportError as exc:
            # TransportError is the retryable branch of httpx's tree: it covers
            # TimeoutException, ConnectError/ReadError and ProtocolError. Its
            # siblings under RequestError (DecodingError, TooManyRedirects) are
            # not transient and fall through to the catch-all below.
            last_outcome = f"{type(exc).__name__}: {exc}"
        except Exception:
            logger.exception(
                "Failed to trigger OpenSearch indexing for document %s",
                document_id,
            )
            return False

        if attempt >= attempts:
            break

        sleep_for = delay if delay is not None else _backoff_delay(attempt)
        logger.warning(
            "OpenSearch index trigger for document %s failed (%s), attempt "
            "%d/%d — retrying in %.2fs",
            document_id, last_outcome, attempt, attempts, sleep_for,
        )
        if sleep_for > 0:
            time.sleep(sleep_for)

    logger.error(
        "OpenSearch index trigger for document %s gave up after %d attempts; "
        "last outcome: %s. The document is published in PostgreSQL but not "
        "searchable — recover it with "
        "src.scripts.reindex_failed_publishes.",
        document_id, attempts, last_outcome,
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
