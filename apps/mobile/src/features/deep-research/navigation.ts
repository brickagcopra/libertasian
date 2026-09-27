import type { Href } from 'expo-router';

/** Mirrors `DeepResearchStreamDto` (question 3..2000 chars, trimmed). */
export const MIN_QUESTION_LENGTH = 3;
export const MAX_QUESTION_LENGTH = 2000;

/** Route id meaning "start a new run from the `q` param". Never a UUID. */
export const NEW_RUN_ID = 'new';

/** A one-shot token: each tap on "Research" is exactly one run. */
export function makeRunToken(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** The Deep Research home, optionally with the composer pre-filled. */
export function researchHref(prefill?: string | null): Href {
  const q = prefill?.trim();
  return q ? { pathname: '/research', params: { q } } : '/research';
}

/** Start a new run for `question` (the run view streams it). */
export function newRunHref(question: string): Href {
  return {
    pathname: '/research/[id]',
    params: { id: NEW_RUN_ID, q: question.trim(), t: makeRunToken() },
  };
}

/** Open a past run. */
export function runHref(id: string): Href {
  return { pathname: '/research/[id]', params: { id } };
}

/**
 * "Open in reader" for a citation: the document, the section to land on and
 * the verbatim quote to mark (`highlight`, the same name the web reader uses).
 * Empty values are left out so the reader only sees params it can act on.
 */
export function readerHref(
  documentId: string,
  sectionId?: string | null,
  quote?: string | null,
): Href {
  const params: { id: string; section?: string; highlight?: string } = { id: documentId };
  if (sectionId) params.section = sectionId;
  const q = quote?.trim();
  if (q) params.highlight = q;
  return { pathname: '/reader/[id]', params };
}
