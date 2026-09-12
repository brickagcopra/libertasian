"""Builder for the ``budgetLedgerEntry`` payload every generator sends.

Before this, four generators hand-rolled the entry with ad-hoc scope
strings (``mcq_generation``, ``essay_prompt_generation``, ...), two sent
none at all despite the DTO accepting one, and none of them set
``periodDay`` — so per-category daily rollups were impossible and Postgres
and Redis disagreed about what had been spent.
"""

from __future__ import annotations

import datetime
from typing import Any

from .budget_scopes import BUDGET_SCOPES
from .pricing import cost_for


def current_period_year_month() -> str:
    """Current UTC year-month, matching the Redis monthly usage key."""
    return datetime.datetime.now(tz=datetime.UTC).strftime("%Y-%m")


def current_period_day() -> str:
    """Current UTC day, matching the Redis daily usage key."""
    return datetime.datetime.now(tz=datetime.UTC).strftime("%Y-%m-%d")


def build_ledger_entry(
    *,
    scope: str,
    model_name: str,
    tokens_in: int | None,
    tokens_out: int | None,
    model_run_id: str | None = None,
) -> dict[str, Any]:
    """Build one ``budgetLedgerEntry`` payload.

    `scope` must be one of ``BUDGET_SCOPES``; the API rejects anything
    else with a 400 (``@IsIn(BUDGET_SCOPES)``), so a typo fails loudly at
    the write instead of quietly creating a category nothing can budget.
    """
    if scope not in BUDGET_SCOPES:
        raise ValueError(
            f"Unknown budget scope {scope!r}; expected one of {BUDGET_SCOPES}"
        )

    # rag-service omits token counts on some paths, so these arrive as
    # None. Coerce rather than crash: a ledger row with zero tokens is a
    # truthful "we could not price this", a missing row is a silent gap.
    counted_in = int(tokens_in or 0)
    counted_out = int(tokens_out or 0)

    return {
        "periodYearMonth": current_period_year_month(),
        "periodDay": current_period_day(),
        "scope": scope,
        "amountUsd": float(cost_for(model_name, counted_in, counted_out)),
        "tokensIn": counted_in,
        "tokensOut": counted_out,
        "modelName": model_name,
        "modelRunId": model_run_id,
    }
