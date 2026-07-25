/**
 * Search-facing shared constants.
 *
 * These live in `@libertasian/types` because the API DTO and the web filter UI
 * MUST agree on them. They drifted before: the web Document Type dropdown
 * offered `supreme_court_decision`, `court_of_appeals_decision`,
 * `administrative_circular` and `resolution`, none of which the API's `@IsIn`
 * list accepted, so selecting any of them returned HTTP 400 — while `decision`,
 * the value 16,990 of 17,135 rows actually carry, was missing from both.
 */

/**
 * Every accepted `documentType` filter value.
 *
 * The list mixes two namespaces on purpose:
 *  - concrete `legal_documents.document_type` values as they exist in the
 *    database (`decision`, `codal`, `republic_act`, …)
 *  - legacy abstract "class" values kept for back-compat with saved searches
 *    and existing clients (`case`, `statute`, `article`, `outline`)
 *
 * Reconciling the two namespaces is tracked separately; removing a value from
 * this list is a breaking change for any persisted filter that uses it.
 */
export const DOCUMENT_TYPE_VALUES = [
  // Concrete document_type values, ordered by production row count.
  'decision',
  'bar_exam_questions',
  'rules_of_court',
  'administrative_matter',
  'administrative_case',
  'codal',
  'presidential_decree',
  'executive_order',
  'constitution',
  'republic_act',
  'commonwealth_act',
  'batas_pambansa',
  'proclamation',
  'administrative_order',
  'rule',
  'resolution',
  // Legacy abstract classes.
  'statute',
  'article',
  'outline',
  'case',
] as const;

export type DocumentTypeValue = (typeof DOCUMENT_TYPE_VALUES)[number];

/** Human labels for the filter UI. Keyed by every value above. */
export const DOCUMENT_TYPE_LABELS: Record<DocumentTypeValue, string> = {
  decision: 'Decision',
  bar_exam_questions: 'Bar Exam Questions',
  rules_of_court: 'Rules of Court',
  administrative_matter: 'Administrative Matter',
  administrative_case: 'Administrative Case',
  codal: 'Codal',
  presidential_decree: 'Presidential Decree',
  executive_order: 'Executive Order',
  constitution: 'Constitution',
  republic_act: 'Republic Act',
  commonwealth_act: 'Commonwealth Act',
  batas_pambansa: 'Batas Pambansa',
  proclamation: 'Proclamation',
  administrative_order: 'Administrative Order',
  rule: 'Rule',
  resolution: 'Resolution',
  statute: 'Statute',
  article: 'Article',
  outline: 'Outline',
  case: 'Case',
};

/**
 * The subset worth showing in a filter dropdown, in display order. Everything
 * in `DOCUMENT_TYPE_VALUES` is still *accepted* by the API — this only controls
 * what the UI offers, so legacy class values do not clutter the list.
 */
export const DOCUMENT_TYPE_FILTER_OPTIONS: readonly DocumentTypeValue[] = [
  'decision',
  'constitution',
  'codal',
  'republic_act',
  'commonwealth_act',
  'batas_pambansa',
  'presidential_decree',
  'executive_order',
  'proclamation',
  'administrative_order',
  'administrative_matter',
  'administrative_case',
  'rules_of_court',
  'rule',
  'resolution',
  'bar_exam_questions',
] as const;
