"""Tests for pricing.cost_for — per-call LLM USD cost telemetry.

Covers:
1. Known model price tables (Anthropic + arithmetic).
2. Local embedding models return $0.
3. Unknown model name returns $0 and logs WARN once per process.
"""

from __future__ import annotations

import logging
from decimal import Decimal

import pytest

from src import pricing

# ─── Known models ────────────────────────────────────────────────────────


class TestCostForKnownModels:
    def test_haiku_4_5_price_arithmetic(self) -> None:
        """1M in + 1M out on claude-haiku-4-5 → $1.00 + $5.00 = $6.00."""
        cost = pricing.cost_for("claude-haiku-4-5", 1_000_000, 1_000_000)

        assert cost == Decimal("6.00")
        # Decimal — not a binary float — so callers can sum without drift.
        assert isinstance(cost, Decimal)

    def test_sonnet_4_6_price_arithmetic(self) -> None:
        """1M in + 1M out on claude-sonnet-4-6 → $3.00 + $15.00 = $18.00."""
        cost = pricing.cost_for("claude-sonnet-4-6", 1_000_000, 1_000_000)
        assert cost == Decimal("18.00")

    def test_opus_4_7_price_arithmetic(self) -> None:
        """1M in + 1M out on claude-opus-4-7 → $15.00 + $75.00 = $90.00."""
        cost = pricing.cost_for("claude-opus-4-7", 1_000_000, 1_000_000)
        assert cost == Decimal("90.00")

    def test_partial_token_counts_scale_linearly(self) -> None:
        """500 in + 1000 out on haiku → 0.0005 + 0.005 = 0.0055."""
        cost = pricing.cost_for("claude-haiku-4-5", 500, 1000)
        assert cost == Decimal("0.0055")

    def test_gpt_4o_mini_price_arithmetic(self) -> None:
        """1M in + 1M out on gpt-4o-mini → $0.150 + $0.600 = $0.750.

        Bug 10 — derivative-generation tasks (essay/mcq/outline/flashcard)
        default to gpt-4o-mini. Without this entry every budget_ledger row
        for those scopes silently records amount_usd=0.
        """
        cost = pricing.cost_for("gpt-4o-mini", 1_000_000, 1_000_000)
        assert cost == Decimal("0.750")

    def test_gpt_4o_mini_realistic_essay_call(self) -> None:
        """1500 in + 800 out on gpt-4o-mini → (225 + 480) / 1M = 0.000705."""
        cost = pricing.cost_for("gpt-4o-mini", 1500, 800)
        assert cost == Decimal("0.000705")

    def test_gpt_4o_price_arithmetic(self) -> None:
        """1M in + 1M out on gpt-4o → $2.50 + $10.00 = $12.50."""
        cost = pricing.cost_for("gpt-4o", 1_000_000, 1_000_000)
        assert cost == Decimal("12.500")


# ─── Local embeddings ────────────────────────────────────────────────────


class TestCostForLocalEmbedding:
    def test_bge_m3_returns_zero(self) -> None:
        """Local bge-m3 model is free at the edge — no per-call cost."""
        assert pricing.cost_for("bge-m3", 1000, 1000) == Decimal("0")

    def test_bge_small_with_org_prefix_returns_zero(self) -> None:
        """``BAAI/bge-small-en-v1.5`` (org-prefixed) is recognized as local."""
        assert pricing.cost_for(
            "BAAI/bge-small-en-v1.5", 1000, 1000,
        ) == Decimal("0")

    def test_e5_returns_zero(self) -> None:
        """``intfloat/e5-large-v2`` is free."""
        assert pricing.cost_for(
            "intfloat/e5-large-v2", 1000, 1000,
        ) == Decimal("0")


# ─── Unknown models ──────────────────────────────────────────────────────


class TestCostForUnknownLogsOnce:
    def test_unknown_returns_zero_and_warns_once(
        self,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        """Unknown model returns $0 and logs WARN exactly once per process.

        The warn-once gate prevents log spam if a rolled-out model name
        sneaks into the call graph before the price table is updated.
        """
        # Reset the per-process gate so this test is independent of earlier
        # tests that may have warmed it.
        pricing._warned_models.discard("future-claude-99")

        with caplog.at_level(logging.WARNING, logger="src.pricing"):
            cost1 = pricing.cost_for("future-claude-99", 1000, 1000)
            cost2 = pricing.cost_for("future-claude-99", 2000, 2000)

        assert cost1 == Decimal("0")
        assert cost2 == Decimal("0")

        warns = [
            r for r in caplog.records
            if r.levelno == logging.WARNING
            and "future-claude-99" in r.getMessage()
        ]
        assert len(warns) == 1, (
            f"expected exactly one WARN for unknown model, got {len(warns)}"
        )
