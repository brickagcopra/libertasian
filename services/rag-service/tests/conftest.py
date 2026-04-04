"""Shared fixtures for RAG service tests."""

from __future__ import annotations

from typing import Any

import pytest

from src.core.schemas import CitationRef, Passage
from src.core.types import AbstentionReason


@pytest.fixture()
def make_passage():
    """Factory fixture that creates Passage objects with sensible defaults."""

    _counter = 0

    def _factory(**overrides: Any) -> Passage:
        nonlocal _counter
        _counter += 1
        defaults: dict[str, Any] = {
            "id": f"hit-{_counter}",
            "document_id": f"doc-{_counter:04d}",
            "section_id": None,
            "title": f"Test Document {_counter}",
            "citation_text": f"G.R. No. {100000 + _counter}",
            "text": f"This is the passage text for document {_counter}.",
            "court": "Supreme Court",
            "decision_date": "2024-01-15",
            "document_type": "case",
            "source_authority_level": "official",
            "score": 0.85,
            "bm25_score": 0.6,
            "knn_score": 0.9,
            "rerank_score": None,
        }
        defaults.update(overrides)
        return Passage(**defaults)

    return _factory


@pytest.fixture()
def make_citation_ref():
    """Factory fixture that creates CitationRef objects with sensible defaults."""

    _counter = 0

    def _factory(**overrides: Any) -> CitationRef:
        nonlocal _counter
        _counter += 1
        defaults: dict[str, Any] = {
            "source_id": f"doc-{_counter:04d}",
            "section_id": None,
            "text": f"Cited passage text {_counter}",
            "valid": False,
        }
        defaults.update(overrides)
        return CitationRef(**defaults)

    return _factory


@pytest.fixture(autouse=True)
def _patch_settings(monkeypatch: pytest.MonkeyPatch):
    """Set deterministic abstention thresholds for all tests."""
    from src.config import settings

    monkeypatch.setattr(settings, "abstention_min_passages", 3)
    monkeypatch.setattr(settings, "abstention_score_threshold", 0.01)
