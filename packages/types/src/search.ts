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

/**
 * Coarse filter groups for compact UIs (the mobile filter chip row), in display
 * order. Each group expands to the concrete `document_type` values it covers, so
 * a chip filters on everything in its class instead of on one abstract label.
 *
 * This exists because mobile used to send the legacy class values (`case`,
 * `statute`, `article`, `outline`) directly. The DTO accepts them — they are
 * still in `DOCUMENT_TYPE_VALUES` — but production holds ZERO rows of any of
 * them, so every chip except "All" silently emptied the results list.
 *
 * An empty `types` array means "no `documentType` filter at all"; clients MUST
 * omit the key rather than send `[]`.
 */
export const DOCUMENT_TYPE_GROUPS: readonly {
  label: string;
  types: readonly DocumentTypeValue[];
}[] = [
  { label: 'All', types: [] },
  { label: 'Decisions', types: ['decision'] },
  {
    label: 'Statutes',
    types: [
      'codal',
      'constitution',
      'republic_act',
      'commonwealth_act',
      'batas_pambansa',
      'presidential_decree',
      'executive_order',
      'proclamation',
      'administrative_order',
    ],
  },
  {
    label: 'Rules',
    types: [
      'rules_of_court',
      'rule',
      'resolution',
      'administrative_matter',
      'administrative_case',
    ],
  },
  { label: 'Bar Q&A', types: ['bar_exam_questions'] },
] as const;

/**
 * Every accepted `court` filter value, in snake_case.
 *
 * These are *keys*, not the strings PostgreSQL stores. `legal_documents.court`
 * holds display text ("Supreme Court", "Court of Appeals", …), which is what the
 * reader UI renders — so the search index carries BOTH: `court` (the raw display
 * literal) and `court_key` (this normalized form, derived at index time by
 * `normalizeCourtKey`). Filters run against `court_key`.
 *
 * The same drift that broke the Document Type dropdown broke this one: the UI
 * sent `supreme_court` while the index held `Supreme Court`, so every
 * court-filtered search returned zero results with no error. Ordered by
 * production row count.
 */
export const COURT_VALUES = [
  'supreme_court',
  'court_of_appeals',
  'regional_trial_court',
  'sandiganbayan',
  'court_of_tax_appeals',
] as const;

export type CourtValue = (typeof COURT_VALUES)[number];

/**
 * Display labels, which MUST be byte-identical to the strings stored in
 * `legal_documents.court` — `normalizeCourtKey(COURT_LABELS[v]) === v` is
 * asserted by a unit test, and that round-trip is the only thing keeping the
 * dropdown and the corpus from drifting apart again.
 */
export const COURT_LABELS: Record<CourtValue, string> = {
  supreme_court: 'Supreme Court',
  court_of_appeals: 'Court of Appeals',
  regional_trial_court: 'Regional Trial Court',
  sandiganbayan: 'Sandiganbayan',
  court_of_tax_appeals: 'Court of Tax Appeals',
};

/** The courts offered in the filter dropdown, in display order. */
export const COURT_FILTER_OPTIONS: readonly CourtValue[] = COURT_VALUES;

/**
 * Derive the `court_key` index field from a raw court string: lowercase, with
 * every run of non-alphanumeric characters collapsed to a single underscore.
 *
 * Applied to BOTH sides so they cannot disagree — at index time to
 * `legal_documents.court`, and at query time to whatever the client sent. That
 * makes the filter accept the display form ("Supreme Court") and the key form
 * (`supreme_court`) interchangeably.
 *
 *   `"Supreme Court"`       → `supreme_court`
 *   `"Court of Tax Appeals"` → `court_of_tax_appeals`
 *   `null` / `""`            → `undefined`
 */
export function normalizeCourtKey(
  court: string | null | undefined,
): string | undefined {
  if (!court) return undefined;
  const key = court
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return key.length > 0 ? key : undefined;
}
