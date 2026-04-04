"""LIBERTASIAN Worker Service — NestJS API client.

HTTP client for calling internal NestJS endpoints from the worker service.
Per CLAUDE.md: NestJS is the single gateway. Python services call NestJS
over internal HTTP for operations like OpenSearch indexing.
"""

from __future__ import annotations

import logging

import httpx

from ..config import settings

logger = logging.getLogger(__name__)


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
