"""Tests for embedding service Pydantic schemas."""

import pytest
from pydantic import ValidationError

from src.embed.schemas import (
    BatchEmbedRequest,
    BatchEmbedResponse,
    EmbedRequest,
    EmbedResponse,
)


class TestEmbedRequest:
    """Tests for single text embedding request schema."""

    def test_valid_request(self):
        req = EmbedRequest(text="Hello world")
        assert req.text == "Hello world"

    def test_empty_text_rejected(self):
        with pytest.raises(ValidationError):
            EmbedRequest(text="")

    def test_max_length_enforced(self):
        long_text = "x" * 32769
        with pytest.raises(ValidationError):
            EmbedRequest(text=long_text)

    def test_max_length_boundary_accepted(self):
        text = "x" * 32768
        req = EmbedRequest(text=text)
        assert len(req.text) == 32768

    def test_strict_mode_rejects_non_string(self):
        with pytest.raises(ValidationError):
            EmbedRequest(text=123)  # type: ignore[arg-type]


class TestEmbedResponse:
    """Tests for single text embedding response schema."""

    def test_valid_response(self):
        resp = EmbedResponse(
            embedding=[0.1, 0.2, 0.3],
            model_name="test-model",
            dimension=3,
        )
        assert resp.embedding == [0.1, 0.2, 0.3]
        assert resp.model_name == "test-model"
        assert resp.dimension == 3

    def test_empty_embedding_accepted(self):
        resp = EmbedResponse(embedding=[], model_name="m", dimension=0)
        assert resp.embedding == []


class TestBatchEmbedRequest:
    """Tests for batch text embedding request schema."""

    def test_valid_batch_request(self):
        req = BatchEmbedRequest(texts=["hello", "world"])
        assert len(req.texts) == 2

    def test_empty_list_rejected(self):
        with pytest.raises(ValidationError):
            BatchEmbedRequest(texts=[])

    def test_max_256_texts(self):
        texts = [f"text {i}" for i in range(257)]
        with pytest.raises(ValidationError):
            BatchEmbedRequest(texts=texts)

    def test_256_texts_accepted(self):
        texts = [f"text {i}" for i in range(256)]
        req = BatchEmbedRequest(texts=texts)
        assert len(req.texts) == 256

    def test_single_text_accepted(self):
        req = BatchEmbedRequest(texts=["hello"])
        assert len(req.texts) == 1


class TestBatchEmbedResponse:
    """Tests for batch embedding response schema."""

    def test_valid_response(self):
        resp = BatchEmbedResponse(
            embeddings=[[0.1, 0.2], [0.3, 0.4]],
            model_name="test-model",
            dimension=2,
            count=2,
        )
        assert len(resp.embeddings) == 2
        assert resp.count == 2
        assert resp.model_name == "test-model"

    def test_empty_embeddings(self):
        resp = BatchEmbedResponse(
            embeddings=[], model_name="m", dimension=0, count=0
        )
        assert resp.embeddings == []
        assert resp.count == 0
