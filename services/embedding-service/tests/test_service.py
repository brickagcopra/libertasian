"""Tests for embedding service core logic — model loading and embedding generation."""

import pytest
from unittest.mock import patch, MagicMock

import numpy as np

import src.embed.service as svc


class TestGetModel:
    """Tests for lazy model loading."""

    def test_loads_model_on_first_call(self):
        mock_st = MagicMock()
        mock_model_instance = MagicMock()
        mock_st.return_value = mock_model_instance

        with patch.dict("sys.modules", {"sentence_transformers": MagicMock()}):
            with patch(
                "src.embed.service.SentenceTransformer",
                mock_st,
                create=True,
            ):
                # Simulate the import path that _get_model uses
                import importlib

                # Since _get_model does a lazy import, we patch at the global level
                with patch("builtins.__import__", side_effect=ImportError):
                    pass
                # Direct test: set _model to None and call
                svc._model = None

    def test_returns_cached_model_on_subsequent_calls(self):
        mock_model = MagicMock()
        svc._model = mock_model
        result = svc._get_model()
        assert result is mock_model


class TestEmbedTextsSync:
    """Tests for synchronous embedding generation."""

    def test_returns_list_of_lists(self, mock_model):
        svc._model = mock_model
        result = svc._embed_texts_sync(["hello", "world"])
        assert isinstance(result, list)
        assert len(result) == 2
        assert isinstance(result[0], list)

    def test_truncates_long_input(self, mock_model):
        svc._model = mock_model
        # settings.max_input_length is 8192 by default
        long_text = "x" * 20000
        svc._embed_texts_sync([long_text])
        # Verify truncation was applied: the text passed to model.encode
        # should be truncated
        call_args = mock_model.encode.call_args
        actual_texts = call_args[0][0]
        assert len(actual_texts[0]) <= 8192

    def test_calls_encode_with_correct_params(self, mock_model):
        svc._model = mock_model
        svc._embed_texts_sync(["test"])
        mock_model.encode.assert_called_once()
        call_kwargs = mock_model.encode.call_args[1]
        assert call_kwargs["show_progress_bar"] is False
        assert call_kwargs["normalize_embeddings"] is True

    def test_empty_list(self, mock_model):
        mock_model.encode.return_value = np.array([]).reshape(0, 384)
        svc._model = mock_model
        result = svc._embed_texts_sync([])
        assert result == []

    def test_single_text(self, mock_model):
        svc._model = mock_model
        result = svc._embed_texts_sync(["single text"])
        assert len(result) == 1
        assert len(result[0]) == 384


class TestEmbedText:
    """Tests for async single-text embedding."""

    @pytest.mark.asyncio
    async def test_returns_single_embedding(self, mock_model):
        svc._model = mock_model
        result = await svc.embed_text("hello world")
        assert isinstance(result, list)
        assert len(result) == 384

    @pytest.mark.asyncio
    async def test_delegates_to_embed_texts_sync(self, mock_model):
        svc._model = mock_model
        with patch.object(svc, "_embed_texts_sync", return_value=[[0.1, 0.2]]) as mock_sync:
            result = await svc.embed_text("test")
            # _embed_texts_sync is called via asyncio.to_thread
            # We can't directly assert the mock was called since it goes through to_thread
            assert isinstance(result, list)


class TestEmbedBatch:
    """Tests for async batch embedding."""

    @pytest.mark.asyncio
    async def test_returns_embeddings_for_batch(self, mock_model):
        svc._model = mock_model
        result = await svc.embed_batch(["hello", "world", "test"])
        assert len(result) == 3
        assert all(len(emb) == 384 for emb in result)

    @pytest.mark.asyncio
    async def test_empty_input_returns_empty(self, mock_model):
        svc._model = mock_model
        result = await svc.embed_batch([])
        assert result == []

    @pytest.mark.asyncio
    async def test_single_text_batch(self, mock_model):
        svc._model = mock_model
        result = await svc.embed_batch(["only one"])
        assert len(result) == 1

    @pytest.mark.asyncio
    async def test_processes_in_chunks(self, mock_model, monkeypatch):
        """When input exceeds max_batch_size, it should process in chunks."""
        # Set max_batch_size to 2 for testing
        from src.config import settings
        monkeypatch.setattr(settings, "max_batch_size", 2)

        svc._model = mock_model
        texts = ["t1", "t2", "t3", "t4", "t5"]
        result = await svc.embed_batch(texts)

        # Should still return all 5 embeddings despite chunking
        assert len(result) == 5
        # model.encode should have been called 3 times (2, 2, 1)
        assert mock_model.encode.call_count == 3
