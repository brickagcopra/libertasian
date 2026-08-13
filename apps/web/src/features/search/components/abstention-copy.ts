/**
 * Abstention reason → user-facing copy.
 *
 * `abstentionReason` is a RAW ENUM VALUE off the wire
 * (`services/rag-service/src/core/types.py:28`): `low_relevance`,
 * `insufficient_passages`, `no_results`, `validation_failed`. It selects copy;
 * it is never rendered. Before PR #376 it was always undefined so the generic
 * fallback always won — once it started populating, the search surface printed
 * the literal word "validation_failed" at the user.
 *
 * The copy is client-owned, matching how the mobile reader's chat sheet writes
 * its own abstention string rather than echoing the server.
 */

/** Shown for an unrecognised reason, or none at all. */
export const ABSTENTION_FALLBACK =
  'The retrieved sources do not sufficiently address this question. Try rephrasing your query or broadening your search terms.';

const ABSTENTION_COPY: Record<string, string> = {
  no_results: 'No sources matched this question. Try different terms.',
  insufficient_passages: 'Too few relevant sources to answer this reliably.',
  low_relevance: "The closest sources don't address this question directly.",
  validation_failed:
    'The draft answer could not be traced back to a source, so it was withheld.',
};

/**
 * Copy for `reason`, or the generic fallback.
 *
 * Keyed by the enum string with a default so a reason added server-side
 * degrades to the fallback instead of leaking an identifier into the UI.
 */
export function abstentionCopy(reason?: string | null): string {
  if (!reason) return ABSTENTION_FALLBACK;
  return ABSTENTION_COPY[reason] ?? ABSTENTION_FALLBACK;
}
