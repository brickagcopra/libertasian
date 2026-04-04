"""Embedding correctness tests (Phase 2 — Coverage Gaps).

Tests verify:
- Embedding dimension consistency
- Normalization correctness (unit vectors)
- Batch vs single embedding consistency
- Order preservation in batch processing
- Cosine similarity semantics (similar texts → high similarity)
- Numerical stability for edge cases
"""

from __future__ import annotations

import numpy as np
import pytest
from unittest.mock import MagicMock

import src.embed.service as svc


# --- Helpers ---

def cosine_similarity(a: list[float], b: list[float]) -> float:
    """Compute cosine similarity between two vectors."""
    a_arr = np.array(a)
    b_arr = np.array(b)
    dot = np.dot(a_arr, b_arr)
    norm_a = np.linalg.norm(a_arr)
    norm_b = np.linalg.norm(b_arr)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(dot / (norm_a * norm_b))


def make_deterministic_model(dim: int = 384) -> MagicMock:
    """Create a mock model that returns deterministic embeddings based on text hash.

    This simulates a real embedding model's behavior: same input → same output,
    different input → different output.
    """
    model = MagicMock()

    def deterministic_encode(texts: list[str], **kwargs) -> np.ndarray:
        embeddings = []
        for text in texts:
            # Generate a deterministic vector from text content
            rng = np.random.RandomState(hash(text) % (2**31))
            vec = rng.randn(dim).astype(np.float32)
            # Normalize if the caller expects normalized embeddings
            if kwargs.get("normalize_embeddings", False):
                norm = np.linalg.norm(vec)
                if norm > 0:
                    vec = vec / norm
            embeddings.append(vec)
        return np.array(embeddings)

    model.encode.side_effect = deterministic_encode
    return model


def make_semantic_model(dim: int = 384) -> MagicMock:
    """Create a mock model where semantically similar texts produce similar vectors.

    Groups:
    - Legal terms (habeas corpus, legal remedy, court order) → nearby vectors
    - Unrelated terms (coffee, weather, bicycle) → distant vectors
    """
    model = MagicMock()

    # Define semantic clusters
    legal_keywords = [
        "habeas corpus", "legal remedy", "court order", "judicial",
        "petition", "ruling", "jurisdiction", "statute", "decree",
        "supreme court", "constitutional", "law", "plaintiff", "defendant",
    ]
    unrelated_keywords = [
        "coffee", "weather", "bicycle", "football", "recipe",
        "mountain", "painting", "guitar",
    ]

    def semantic_encode(texts: list[str], **kwargs) -> np.ndarray:
        embeddings = []
        base_rng = np.random.RandomState(42)
        legal_center = base_rng.randn(dim).astype(np.float32)
        unrelated_center = base_rng.randn(dim).astype(np.float32)

        for text in texts:
            text_lower = text.lower()
            is_legal = any(kw in text_lower for kw in legal_keywords)
            is_unrelated = any(kw in text_lower for kw in unrelated_keywords)

            rng = np.random.RandomState(hash(text) % (2**31))
            noise = rng.randn(dim).astype(np.float32) * 0.1  # small perturbation

            if is_legal:
                vec = legal_center + noise
            elif is_unrelated:
                vec = unrelated_center + noise
            else:
                vec = rng.randn(dim).astype(np.float32)  # random for unknown

            if kwargs.get("normalize_embeddings", False):
                norm = np.linalg.norm(vec)
                if norm > 0:
                    vec = vec / norm
            embeddings.append(vec)
        return np.array(embeddings)

    model.encode.side_effect = semantic_encode
    return model


# --- Dimension Consistency ---


class TestDimensionConsistency:
    """Verify all embeddings have the expected dimension."""

    def test_single_text_has_correct_dim(self):
        model = make_deterministic_model(384)
        svc._model = model
        result = svc._embed_texts_sync(["test text"])
        assert len(result) == 1
        assert len(result[0]) == 384

    def test_batch_texts_all_have_correct_dim(self):
        model = make_deterministic_model(384)
        svc._model = model
        texts = [f"text {i}" for i in range(10)]
        results = svc._embed_texts_sync(texts)
        assert len(results) == 10
        for emb in results:
            assert len(emb) == 384

    def test_empty_text_has_correct_dim(self):
        model = make_deterministic_model(384)
        svc._model = model
        result = svc._embed_texts_sync([""])
        assert len(result) == 1
        assert len(result[0]) == 384


# --- Normalization Correctness ---


class TestNormalization:
    """Verify embeddings are unit vectors (L2 norm ≈ 1.0)."""

    def test_single_embedding_is_normalized(self):
        model = make_deterministic_model(384)
        svc._model = model
        result = svc._embed_texts_sync(["habeas corpus"])
        vec = np.array(result[0])
        norm = float(np.linalg.norm(vec))
        assert abs(norm - 1.0) < 1e-5, f"L2 norm should be ~1.0, got {norm}"

    def test_batch_embeddings_are_all_normalized(self):
        model = make_deterministic_model(384)
        svc._model = model
        texts = ["legal", "court", "ruling", "statute", "decree"]
        results = svc._embed_texts_sync(texts)
        for i, emb in enumerate(results):
            norm = float(np.linalg.norm(np.array(emb)))
            assert abs(norm - 1.0) < 1e-5, f"Embedding {i} norm should be ~1.0, got {norm}"

    def test_normalization_for_very_short_text(self):
        model = make_deterministic_model(384)
        svc._model = model
        result = svc._embed_texts_sync(["a"])
        norm = float(np.linalg.norm(np.array(result[0])))
        assert abs(norm - 1.0) < 1e-5


# --- Determinism ---


class TestDeterminism:
    """Same input should always produce the same embedding."""

    def test_same_text_produces_same_embedding(self):
        model = make_deterministic_model(384)
        svc._model = model
        result1 = svc._embed_texts_sync(["What is habeas corpus?"])
        result2 = svc._embed_texts_sync(["What is habeas corpus?"])
        np.testing.assert_array_almost_equal(result1[0], result2[0], decimal=6)

    def test_different_text_produces_different_embedding(self):
        model = make_deterministic_model(384)
        svc._model = model
        result = svc._embed_texts_sync(["What is habeas corpus?", "How to make coffee?"])
        similarity = cosine_similarity(result[0], result[1])
        assert similarity < 0.99, f"Different texts should have different embeddings, sim={similarity}"


# --- Batch vs Single Consistency ---


class TestBatchConsistency:
    """Batch embeddings should match individual embeddings."""

    def test_batch_matches_individual(self):
        model = make_deterministic_model(384)
        svc._model = model
        texts = ["legal remedy", "court order", "judicial review"]

        # Batch
        batch_results = svc._embed_texts_sync(texts)

        # Individual
        individual_results = []
        for t in texts:
            individual_results.append(svc._embed_texts_sync([t])[0])

        for i in range(len(texts)):
            np.testing.assert_array_almost_equal(
                batch_results[i],
                individual_results[i],
                decimal=5,
                err_msg=f"Batch[{i}] != Individual[{i}]",
            )


# --- Order Preservation ---


class TestOrderPreservation:
    """Batch processing must preserve input order."""

    def test_output_order_matches_input(self):
        model = make_deterministic_model(384)
        svc._model = model
        texts = ["alpha", "beta", "gamma", "delta"]
        results = svc._embed_texts_sync(texts)

        # Verify each embedding matches what we'd get individually
        for i, text in enumerate(texts):
            individual = svc._embed_texts_sync([text])[0]
            np.testing.assert_array_almost_equal(
                results[i], individual, decimal=5,
                err_msg=f"Order mismatch at index {i}",
            )


# --- Cosine Similarity Semantics ---


class TestCosineSemantics:
    """Verify that semantically similar texts have higher cosine similarity."""

    def test_similar_legal_texts_have_high_similarity(self):
        model = make_semantic_model(384)
        svc._model = model
        result = svc._embed_texts_sync([
            "habeas corpus is a legal remedy",
            "court order for judicial review",
        ])
        sim = cosine_similarity(result[0], result[1])
        assert sim > 0.7, f"Similar legal texts should have high similarity, got {sim}"

    def test_unrelated_texts_have_low_similarity(self):
        model = make_semantic_model(384)
        svc._model = model
        result = svc._embed_texts_sync([
            "habeas corpus is a legal remedy",
            "coffee and bicycle riding in the weather",
        ])
        sim = cosine_similarity(result[0], result[1])
        assert sim < 0.5, f"Unrelated texts should have low similarity, got {sim}"

    def test_identical_texts_have_perfect_similarity(self):
        model = make_deterministic_model(384)
        svc._model = model
        text = "The Philippine Supreme Court ruled on this matter."
        result = svc._embed_texts_sync([text, text])
        sim = cosine_similarity(result[0], result[1])
        assert abs(sim - 1.0) < 1e-5, f"Identical texts should have sim≈1.0, got {sim}"

    def test_legal_vs_nonlegal_similarity_ordering(self):
        """Legal text should be more similar to other legal text than to non-legal text."""
        model = make_semantic_model(384)
        svc._model = model
        result = svc._embed_texts_sync([
            "petition for habeas corpus filed in court",    # query
            "judicial ruling on constitutional law",         # legal (similar)
            "recipe for chocolate cake with butter",         # non-legal (different)
        ])
        legal_sim = cosine_similarity(result[0], result[1])
        nonlegal_sim = cosine_similarity(result[0], result[2])
        assert legal_sim > nonlegal_sim, (
            f"Legal similarity ({legal_sim:.4f}) should exceed "
            f"non-legal similarity ({nonlegal_sim:.4f})"
        )


# --- Numerical Stability ---


class TestNumericalStability:
    """Edge cases that might cause numerical issues."""

    def test_very_long_text_produces_valid_embedding(self):
        model = make_deterministic_model(384)
        svc._model = model
        long_text = "legal " * 5000  # ~30K chars, exceeds max_input_length
        result = svc._embed_texts_sync([long_text])
        assert len(result) == 1
        assert len(result[0]) == 384
        # Should still be normalized
        norm = float(np.linalg.norm(np.array(result[0])))
        assert abs(norm - 1.0) < 1e-5

    def test_special_characters_produce_valid_embedding(self):
        model = make_deterministic_model(384)
        svc._model = model
        special_text = "§ 1234 — «legal» ™ © ® ¶ ♦ ★ 日本語 中文"
        result = svc._embed_texts_sync([special_text])
        assert len(result[0]) == 384
        norm = float(np.linalg.norm(np.array(result[0])))
        assert abs(norm - 1.0) < 1e-5

    def test_whitespace_only_text(self):
        model = make_deterministic_model(384)
        svc._model = model
        result = svc._embed_texts_sync(["   \t\n  "])
        assert len(result[0]) == 384

    def test_large_batch_produces_correct_count(self):
        model = make_deterministic_model(384)
        svc._model = model
        texts = [f"document {i} about law" for i in range(100)]
        results = svc._embed_texts_sync(texts)
        assert len(results) == 100
        for emb in results:
            assert len(emb) == 384


# --- Async Interface ---


class TestAsyncInterface:
    """Test the async wrappers."""

    @pytest.mark.asyncio
    async def test_embed_text_returns_correct_dim(self):
        model = make_deterministic_model(384)
        svc._model = model
        result = await svc.embed_text("test legal text")
        assert len(result) == 384

    @pytest.mark.asyncio
    async def test_embed_batch_returns_correct_count(self):
        model = make_deterministic_model(384)
        svc._model = model
        result = await svc.embed_batch(["text one", "text two", "text three"])
        assert len(result) == 3

    @pytest.mark.asyncio
    async def test_embed_batch_empty_returns_empty(self):
        model = make_deterministic_model(384)
        svc._model = model
        result = await svc.embed_batch([])
        assert result == []

    @pytest.mark.asyncio
    async def test_embed_batch_respects_chunk_size(self, monkeypatch):
        from src.config import settings
        monkeypatch.setattr(settings, "max_batch_size", 3)
        model = make_deterministic_model(384)
        svc._model = model
        result = await svc.embed_batch([f"text {i}" for i in range(7)])
        assert len(result) == 7
        # model.encode should be called 3 times (3 + 3 + 1)
        assert model.encode.call_count == 3
