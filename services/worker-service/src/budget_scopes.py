"""Categories AI spend is budgeted and accounted against.

Mirror of ``apps/api/src/common/constants/budget-scopes.ts``. The worker
cannot import TypeScript, so this list is duplicated and CI-locked by
``tests/test_budget_scopes.py``.

Every LLM call the worker makes must carry one of these as its ``scope``:
it selects which per-category cap rag-service enforces, which Redis usage
counters are incremented, and which row the spend lands on in
``budget_ledger``.
"""

from __future__ import annotations

from typing import Final

BUDGET_SCOPES: Final[tuple[str, ...]] = (
    "case_digest",
    "doctrine_extract",
    "mcq_question",
    "essay_prompt",
    "flashcard",
    "subject_outline",
    "subject_classification",
    "bar_exam_answer",
    "ai_answer",
)

# Named constants so a task references a symbol rather than retyping the
# string — the ad-hoc literals in worker payloads are exactly what let
# four of these categories drift out of the ledger entirely.
SCOPE_CASE_DIGEST: Final[str] = "case_digest"
SCOPE_DOCTRINE_EXTRACT: Final[str] = "doctrine_extract"
SCOPE_MCQ_QUESTION: Final[str] = "mcq_question"
SCOPE_ESSAY_PROMPT: Final[str] = "essay_prompt"
SCOPE_FLASHCARD: Final[str] = "flashcard"
SCOPE_SUBJECT_OUTLINE: Final[str] = "subject_outline"
SCOPE_SUBJECT_CLASSIFICATION: Final[str] = "subject_classification"
SCOPE_BAR_EXAM_ANSWER: Final[str] = "bar_exam_answer"
SCOPE_AI_ANSWER: Final[str] = "ai_answer"


def is_budget_scope(value: object) -> bool:
    """True when ``value`` is one of the known budget scopes."""
    return isinstance(value, str) and value in BUDGET_SCOPES
