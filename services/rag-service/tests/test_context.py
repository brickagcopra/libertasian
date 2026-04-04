"""Tests for src.core.context — token estimation and context packing."""

from __future__ import annotations

import pytest

from src.core.context import estimate_tokens, pack_context
from src.core.schemas import Passage


class TestEstimateTokens:
    """estimate_tokens — character-based token approximation (4 chars ≈ 1 token)."""

    def test_empty_string(self):
        assert estimate_tokens("") == 0

    def test_short_string(self):
        # "Hello" = 5 chars → 5 // 4 = 1 token
        assert estimate_tokens("Hello") == 1

    def test_longer_string(self):
        # 100 chars → 25 tokens
        text = "a" * 100
        assert estimate_tokens(text) == 25

    def test_exact_multiple(self):
        # 40 chars → 10 tokens
        text = "x" * 40
        assert estimate_tokens(text) == 10

    def test_three_chars(self):
        # 3 chars → 0 (integer division)
        assert estimate_tokens("abc") == 0

    def test_realistic_sentence(self):
        text = "The Supreme Court held that the petitioner failed to prove negligence."
        expected = len(text) // 4
        assert estimate_tokens(text) == expected


class TestPackContext:
    """pack_context — greedy packing of passages within token budget."""

    def test_empty_passages(self, make_passage):
        result = pack_context([], token_budget=4096)
        assert result.passages_included == 0
        assert result.passages_total == 0
        assert result.token_budget == 4096

    def test_single_passage_fits(self, make_passage):
        p = make_passage(text="Short passage text.")
        result = pack_context([p], token_budget=4096)
        assert result.passages_included == 1
        assert result.passages_total == 1
        assert result.estimated_tokens > 0
        assert result.estimated_tokens <= result.token_budget

    def test_multiple_passages_fit(self, make_passage):
        passages = [make_passage(text=f"Passage {i} text.") for i in range(3)]
        result = pack_context(passages, token_budget=4096)
        assert result.passages_included == 3
        assert result.passages_total == 3

    def test_budget_truncation(self, make_passage):
        # Create passages that are large enough to exceed a small budget
        passages = [make_passage(text="x" * 200) for _ in range(10)]
        result = pack_context(passages, token_budget=50)
        assert result.passages_included < result.passages_total
        assert result.estimated_tokens <= result.token_budget

    def test_formatted_context_contains_source_anchors(self, make_passage):
        p = make_passage(
            document_id="doc-uuid-1",
            title="Test Case",
            text="The court ruled in favor of petitioner.",
        )
        result = pack_context([p], token_budget=4096)
        assert "[SOURCE doc-uuid-1" in result.formatted_context
        assert "Test Case" in result.formatted_context

    def test_section_id_in_header(self, make_passage):
        p = make_passage(
            document_id="doc-uuid-2",
            section_id="sec-001",
            text="Section content here.",
        )
        result = pack_context([p], token_budget=4096)
        assert "§sec-001" in result.formatted_context

    def test_context_bundle_fields(self, make_passage):
        passages = [make_passage() for _ in range(2)]
        result = pack_context(passages, token_budget=2048)
        assert hasattr(result, "formatted_context")
        assert hasattr(result, "passages_included")
        assert hasattr(result, "passages_total")
        assert hasattr(result, "estimated_tokens")
        assert hasattr(result, "token_budget")
        assert result.token_budget == 2048
