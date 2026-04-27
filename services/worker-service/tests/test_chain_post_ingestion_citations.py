"""chain_post_ingestion must dispatch citation EXTRACTION before
RESOLUTION. Without extraction, resolve_citations_task has no rows
to act on (the bug this PR fixes).
"""

from __future__ import annotations

import uuid
from unittest.mock import MagicMock, patch


def test_extract_dispatched_before_resolve() -> None:
    from src.tasks.ingestion_tasks import chain_post_ingestion

    document_id = str(uuid.uuid4())

    with patch("src.tasks.citation_tasks.extract_citations_for_document") as mock_extract, \
         patch("src.tasks.citation_tasks.resolve_citations_task") as mock_resolve, \
         patch("src.tasks.doctrine_tasks.extract_doctrines_task"), \
         patch("src.tasks.digest_tasks.generate_ingestion_digest"), \
         patch("src.tasks.categorization_tasks.categorize_document_task"), \
         patch("src.tasks.classification_generation_tasks.classify_document_subjects"), \
         patch("src.tasks.embedding_tasks.generate_document_embeddings_task"):

        mock_extract.delay = MagicMock()
        mock_resolve.delay = MagicMock()

        chain_post_ingestion(document_id=document_id)

        mock_extract.delay.assert_called_once_with(legal_document_id=document_id)
        mock_resolve.delay.assert_called_once_with(document_id=document_id)
