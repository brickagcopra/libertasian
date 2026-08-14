"""Conftest for reranker service tests — shared fixtures."""

import inspect
from typing import Any
from unittest.mock import MagicMock

import numpy as np
import pytest


def _predict_signature(
    inputs: Any,
    batch_size: int = 32,
    show_progress_bar: bool = False,
    activation_fn: Any = None,
) -> Any:  # pragma: no cover - never called, exists to carry a signature
    """Stand-in for `CrossEncoder.predict`'s real signature.

    `_identity_activation_kwarg` inspects the callable to choose between the
    v3 and v4 spellings of the activation kwarg. A bare MagicMock reports
    `(*args, **kwargs)`, so it would match neither and the test would assert
    against a stub that silently differs from the real model.
    """


@pytest.fixture
def mock_model() -> Any:
    """A CrossEncoder stub returning raw logits, as identity activation does.

    Deliberately returns values OUTSIDE 0-1, including negatives: that is what
    bge-reranker-base actually emits, and it is the reason the service applies
    a sigmoid. A stub that returned 0-1 would let a missing sigmoid pass.
    """
    model = MagicMock()
    model.predict = MagicMock(
        side_effect=lambda pairs, **kwargs: np.array(
            [float(len(t)) - 12.0 for _, t in pairs], dtype=np.float32
        )
    )
    model.predict.__signature__ = inspect.signature(_predict_signature)
    return model


@pytest.fixture(autouse=True)
def reset_model_singleton() -> Any:
    """Reset the global _model singleton before each test."""
    import src.rerank.service as svc

    svc._model = None
    yield
    svc._model = None


@pytest.fixture
def no_auth(monkeypatch: pytest.MonkeyPatch) -> Any:
    """Run with auth disabled (the dev-mode escape hatch)."""
    from src.config import settings

    monkeypatch.setattr(settings, "internal_api_key", "")
    yield


@pytest.fixture
def with_auth(monkeypatch: pytest.MonkeyPatch) -> str:
    """Run with an internal API key configured, as production does."""
    from src.config import settings

    key = "test-internal-key"
    monkeypatch.setattr(settings, "internal_api_key", key)
    return key
