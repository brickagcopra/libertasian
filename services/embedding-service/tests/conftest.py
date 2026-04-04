"""Conftest for embedding service tests — shared fixtures."""

import pytest
from unittest.mock import MagicMock, patch

import numpy as np


@pytest.fixture
def mock_model():
    """Create a mock SentenceTransformer model."""
    model = MagicMock()
    # model.encode returns numpy array of shape (n, dim)
    model.encode.side_effect = lambda texts, **kwargs: np.random.rand(
        len(texts), 384
    ).astype(np.float32)
    return model


@pytest.fixture(autouse=True)
def reset_model_singleton():
    """Reset the global _model singleton before each test."""
    import src.embed.service as svc

    svc._model = None
    yield
    svc._model = None


@pytest.fixture
def mock_settings(monkeypatch):
    """Override embedding service settings for tests."""
    monkeypatch.setenv("EMBEDDING_MODEL_NAME", "test-model")
    monkeypatch.setenv("EMBEDDING_EMBEDDING_DIM", "384")
    monkeypatch.setenv("EMBEDDING_MAX_BATCH_SIZE", "4")
    monkeypatch.setenv("EMBEDDING_DEVICE", "cpu")
    monkeypatch.setenv("EMBEDDING_MAX_INPUT_LENGTH", "100")
