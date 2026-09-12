"""CI-lock: the Python budget-scope mirror must match the TypeScript source.

``apps/api/src/common/constants/budget-scopes.ts`` is the single source of
truth. The worker cannot import it, so the list is duplicated — and a
duplicate that drifts is worse than no duplicate at all: the API rejects
an unknown scope with a 400, so a worker sending a stale name would fail
every write for that category.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from src.budget_ledger import build_ledger_entry
from src.budget_scopes import BUDGET_SCOPES, is_budget_scope

_TS_SOURCE = (
    Path(__file__).resolve().parents[3]
    / "apps"
    / "api"
    / "src"
    / "common"
    / "constants"
    / "budget-scopes.ts"
)


def _scopes_from_typescript() -> list[str]:
    text = _TS_SOURCE.read_text(encoding="utf-8")
    block = re.search(
        r"export const BUDGET_SCOPES = \[(.*?)\] as const;", text, re.S
    )
    assert block, "BUDGET_SCOPES array not found in budget-scopes.ts"
    return re.findall(r"'([a-z_]+)'", block.group(1))


@pytest.mark.skipif(
    not _TS_SOURCE.exists(),
    reason="API source not present (service checked out alone)",
)
def test_python_mirror_matches_typescript_source() -> None:
    assert list(BUDGET_SCOPES) == _scopes_from_typescript()


def test_is_budget_scope() -> None:
    assert is_budget_scope("case_digest")
    # The pre-canonical name every generator used to send.
    assert not is_budget_scope("mcq_generation")
    assert not is_budget_scope(None)
    assert not is_budget_scope(42)


class TestBuildLedgerEntry:
    def test_rejects_a_scope_outside_the_list(self) -> None:
        with pytest.raises(ValueError, match="Unknown budget scope"):
            build_ledger_entry(
                scope="mcq_generation",
                model_name="gpt-4o-mini",
                tokens_in=100,
                tokens_out=50,
            )

    def test_carries_period_day_for_daily_rollups(self) -> None:
        entry = build_ledger_entry(
            scope="flashcard",
            model_name="gpt-4o-mini",
            tokens_in=1000,
            tokens_out=500,
            model_run_id="run-1",
        )
        assert re.fullmatch(r"\d{4}-\d{2}", entry["periodYearMonth"])
        assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", entry["periodDay"])
        assert entry["periodDay"].startswith(entry["periodYearMonth"])
        assert entry["scope"] == "flashcard"
        assert entry["modelRunId"] == "run-1"

    def test_prices_the_call(self) -> None:
        entry = build_ledger_entry(
            scope="case_digest",
            model_name="gpt-4o-mini",
            tokens_in=1_000_000,
            tokens_out=0,
        )
        # gpt-4o-mini input is $0.15 per 1M tokens.
        assert entry["amountUsd"] == pytest.approx(0.15)

    def test_missing_token_counts_become_zero(self) -> None:
        # rag-service omits token counts on some paths. A zero-token row is
        # a truthful "could not price this"; a crash would lose the row.
        entry = build_ledger_entry(
            scope="subject_classification",
            model_name="gpt-4o-mini",
            tokens_in=None,
            tokens_out=None,
        )
        assert entry["tokensIn"] == 0
        assert entry["tokensOut"] == 0
        assert entry["amountUsd"] == 0.0
