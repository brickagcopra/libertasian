"""Cost telemetry maintenance — backfill ``budget_ledger.amount_usd`` for
rows that recorded tokens but no USD cost.

The ``budget_ledger`` row is written from the four user-facing generation
tasks (essay, mcq, outline, flashcard) inside the same NestJS transaction
that writes the derivative artifact. Until 2026-04-27 those tasks hardcoded
``amountUsd: 0.0`` while still passing real ``tokensIn`` / ``tokensOut``,
so the ledger ended up with 2324 prod rows that look like free LLM calls.

This module exposes a one-shot Celery task to recompute ``amount_usd`` from
``tokens_in`` / ``tokens_out`` × the per-model price table in
``services/worker-service/src/pricing.py``. Idempotent — re-running on a
healed ledger is a no-op (rows with non-zero amount or missing tokens are
skipped). Operators dispatch it once after deploy:

    >>> from src.tasks.cost_tasks import recompute_ledger_amounts
    >>> recompute_ledger_amounts.delay()

Per CLAUDE.md the worker must not write schema changes, but ``UPDATE`` on a
column the worker already owns the data for is in scope. Going through a
NestJS endpoint for 2324 row-by-row updates would be 2324 round-trips —
batching the UPDATE in psycopg keeps the recompute under a minute.
"""

from __future__ import annotations

import logging
from decimal import Decimal
from typing import Any

from celery import shared_task

from ..clients.db_client import get_connection
from ..pricing import cost_for

logger = logging.getLogger(__name__)


@shared_task(
    name="cost.recompute_ledger_amounts",
    bind=True,
    acks_late=True,
    reject_on_worker_lost=True,
    max_retries=0,
)
def recompute_ledger_amounts(
    self: Any,
    batch_size: int = 1000,
) -> dict[str, int]:
    """Recompute ``budget_ledger.amount_usd`` for rows where it is zero.

    Streams rows in batches of ``batch_size`` and updates each row's
    ``amount_usd`` from ``cost_for(model_name, tokens_in, tokens_out)``.

    Skip rules (idempotent re-runs):
    - ``amount_usd != 0`` — already healed; never overwrite.
    - ``tokens_in <= 0 AND tokens_out <= 0`` — no token data to bill against.
    - ``model_name IS NULL`` — pricing table is keyed on model name.
    - ``cost_for(...) == 0`` — model is local (free) or unknown
      (pricing.cost_for already WARNs once per process for unknown models).

    Returns:
        Counts: ``{"scanned": int, "updated": int, "skipped_no_tokens": int,
        "skipped_no_model": int, "skipped_zero_cost": int}``.
    """
    scanned = 0
    updated = 0
    skipped_no_tokens = 0
    skipped_no_model = 0
    skipped_zero_cost = 0

    last_id: str | None = None
    while True:
        with get_connection() as conn, conn.cursor() as cur:
            # Keyset pagination on ``id`` so re-entry under high write
            # volume can't double-process rows. Filter on amount_usd=0 so
            # rows healed in this loop are skipped on subsequent batches.
            if last_id is None:
                cur.execute(
                    """SELECT id, model_name, tokens_in, tokens_out
                       FROM budget_ledger
                       WHERE amount_usd = 0
                       ORDER BY id
                       LIMIT %s""",
                    (batch_size,),
                )
            else:
                cur.execute(
                    """SELECT id, model_name, tokens_in, tokens_out
                       FROM budget_ledger
                       WHERE amount_usd = 0
                         AND id > %s
                       ORDER BY id
                       LIMIT %s""",
                    (last_id, batch_size),
                )
            rows = cur.fetchall()

            if not rows:
                break

            updates: list[tuple[Decimal, str]] = []
            for row in rows:
                row_id, model_name, tokens_in, tokens_out = row
                scanned += 1
                last_id = str(row_id)

                tokens_in = int(tokens_in or 0)
                tokens_out = int(tokens_out or 0)

                if tokens_in <= 0 and tokens_out <= 0:
                    skipped_no_tokens += 1
                    continue
                if not model_name:
                    skipped_no_model += 1
                    continue

                cost = cost_for(model_name, tokens_in, tokens_out)
                if cost <= Decimal("0"):
                    skipped_zero_cost += 1
                    continue

                updates.append((cost, str(row_id)))

            if updates:
                # ``executemany`` ships one round-trip per UPDATE in
                # psycopg2, but per-statement batching is fine at 1000-row
                # increments (the recompute is one-shot).
                cur.executemany(
                    "UPDATE budget_ledger SET amount_usd = %s WHERE id = %s",
                    updates,
                )
                updated += len(updates)

    result = {
        "scanned": scanned,
        "updated": updated,
        "skipped_no_tokens": skipped_no_tokens,
        "skipped_no_model": skipped_no_model,
        "skipped_zero_cost": skipped_zero_cost,
    }
    logger.info("cost.recompute_ledger_amounts complete: %s", result)
    return result
