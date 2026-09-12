/**
 * The categories AI spend is budgeted and accounted against.
 *
 * Single source of truth. Before this existed the same strings were
 * written by hand into four worker payloads and nowhere else, so nothing
 * could enumerate the categories, the admin panel could not offer them,
 * and half of them never wrote a ledger row at all.
 *
 * Mirrored — deliberately, not imported — in:
 *   - services/worker-service/src/budget_scopes.py
 *   - apps/web/src/features/admin/budget-scopes.ts
 * Each mirror is CI-locked to this list by its own test. The API cannot
 * import the web copy and the Python worker cannot import either, so a
 * shared runtime module is not an option here.
 */
export const BUDGET_SCOPES = [
  'case_digest',
  'doctrine_extract',
  'mcq_question',
  'essay_prompt',
  'flashcard',
  'subject_outline',
  'subject_classification',
  'bar_exam_answer',
  'ai_answer',
] as const;

export type BudgetScope = (typeof BUDGET_SCOPES)[number];

/** Operator-facing names for the admin budget table. */
export const BUDGET_SCOPE_LABELS: Record<BudgetScope, string> = {
  case_digest: 'Case digests',
  doctrine_extract: 'Doctrine extracts',
  mcq_question: 'MCQ questions',
  essay_prompt: 'Essay prompts',
  flashcard: 'Flashcards',
  subject_outline: 'Subject outlines',
  subject_classification: 'Subject classification',
  bar_exam_answer: 'Bar exam answers',
  ai_answer: 'AI answers',
};

export function isBudgetScope(value: unknown): value is BudgetScope {
  return (
    typeof value === 'string' &&
    (BUDGET_SCOPES as readonly string[]).includes(value)
  );
}

/**
 * Scope strings written before the canonical list existed, mapped to the
 * category they belong to.
 *
 * Four generators hand-rolled their own names (`mcq_generation`,
 * `essay_prompt_generation`, ...). Those rows are historical fact and are
 * not rewritten — there is no migration here — but the admin panel folds
 * them into the right category so one category does not show up as two.
 */
export const LEGACY_SCOPE_ALIASES: Readonly<Record<string, BudgetScope>> = {
  mcq_generation: 'mcq_question',
  essay_prompt_generation: 'essay_prompt',
  flashcard_generation: 'flashcard',
  subject_outline_generation: 'subject_outline',
};

/** Canonical category for a stored ledger scope, or the scope itself. */
export function canonicalScope(scope: string): string {
  return LEGACY_SCOPE_ALIASES[scope] ?? scope;
}
