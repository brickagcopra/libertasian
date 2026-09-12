/**
 * Mirror of `apps/api/src/common/constants/budget-scopes.ts`.
 *
 * The web app cannot import from the API package, so the list is
 * duplicated and CI-locked by `budget-scopes.test.ts`, which reads the
 * TypeScript source directly. Keep the two in the same order.
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

export function budgetScopeLabel(scope: string): string {
  return (BUDGET_SCOPE_LABELS as Record<string, string>)[scope] ?? scope;
}
