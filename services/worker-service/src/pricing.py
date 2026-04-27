"""LLM cost telemetry for the backfill engine.

Maps a model name + token usage to a USD cost using a hardcoded price table.
Used by downstream LLM-incurring tasks (subject classification, embeddings)
to bump the per-batch ``budget_consumed_usd`` counter so budget ceilings
actually halt over-budget batches.

Independent of the global Redis monthly budget rail
(``llm:usage:{YYYY-MM}.estimated_cost_usd``); per-batch and global telemetry
each live on their own counter and are summed by their own enforcer.
"""

from __future__ import annotations

import logging
from decimal import Decimal

logger = logging.getLogger(__name__)


# USD cost per 1M tokens, broken out by direction. Update when a provider
# publishes new pricing or when we add a new model to the worker's call
# graph. Numbers verified against the public pricing pages on 2026-04-27 —
# confirm before adding new entries (silent zeros are worse than missing
# entries because the warn-once gate hides them).
_PRICE_PER_MTOK: dict[str, tuple[Decimal, Decimal]] = {
    # Anthropic
    "claude-haiku-4-5": (Decimal("1.00"), Decimal("5.00")),
    "claude-sonnet-4-6": (Decimal("3.00"), Decimal("15.00")),
    "claude-opus-4-7": (Decimal("15.00"), Decimal("75.00")),
    # OpenAI — derivative-generation tasks (essay/mcq/outline/flashcard)
    # default to gpt-4o-mini. Without these entries every budget_ledger row
    # for those scopes silently records amount_usd=0 (Bug 10 root cause —
    # 2324 prod rows on Stage 3 batch ebb8780b through 2026-04-27).
    "gpt-4o-mini": (Decimal("0.150"), Decimal("0.600")),
    "gpt-4o": (Decimal("2.500"), Decimal("10.000")),
}

# Local-only embedding models. Free at the edge — no per-call cost. We
# still recognize them so unknown-model warnings stay quiet for them.
_FREE_EMBEDDING_PREFIXES: tuple[str, ...] = (
    "bge-",
    "e5-",
    "text-embedding-bge-",
)

_PER_MILLION = Decimal("1000000")

# One WARN per process per unknown model name. Avoids log spam when a
# rolled-out model name doesn't match the table — operators see it once
# and can update the table.
_warned_models: set[str] = set()


def _is_local_embedding(model_name: str) -> bool:
    """Return True for locally-hosted embedding models (no per-call cost).

    We match on a small set of known prefixes so we don't have to enumerate
    every BAAI/intfloat checkpoint. ``BAAI/bge-small-en-v1.5`` and
    ``intfloat/e5-large-v2`` both resolve to the trailing model token here.
    """
    last_segment = model_name.rsplit("/", 1)[-1].lower()
    return any(last_segment.startswith(prefix) for prefix in _FREE_EMBEDDING_PREFIXES)


def cost_for(
    model_name: str,
    tokens_in: int,
    tokens_out: int,
) -> Decimal:
    """Compute the USD cost of one model call.

    Args:
        model_name: Model identifier as recorded in ``model_runs.model_name``.
        tokens_in: Input/prompt tokens billed.
        tokens_out: Output/completion tokens billed.

    Returns:
        Cost as a Decimal in USD. Returns ``Decimal("0")`` for local
        embedding models and for unrecognized model names (with a one-shot
        WARN per process).
    """
    if _is_local_embedding(model_name):
        return Decimal("0")

    prices = _PRICE_PER_MTOK.get(model_name)
    if prices is None:
        if model_name not in _warned_models:
            _warned_models.add(model_name)
            logger.warning(
                "pricing.cost_for: unknown model_name=%r — returning $0. "
                "Add it to _PRICE_PER_MTOK in services/worker-service/src/"
                "pricing.py to start metering.",
                model_name,
            )
        return Decimal("0")

    in_price, out_price = prices
    in_cost = (Decimal(int(tokens_in)) * in_price) / _PER_MILLION
    out_cost = (Decimal(int(tokens_out)) * out_price) / _PER_MILLION
    return in_cost + out_cost
