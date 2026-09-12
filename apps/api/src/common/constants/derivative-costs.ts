/**
 * Measured average cost per derivative-generation call, in USD.
 *
 * Source: 30 days of `model_runs` rows priced at the gpt-4o-mini rate
 * ($0.15 / 1M input tokens, $0.60 / 1M output tokens), measured on
 * prod 2026-09-12. These replace the hand-written estimates that
 * preceded them, which were 30–57x high and made every operator
 * preview ("this will cost $4") unusable as a decision signal.
 *
 * Re-measure and update the date above whenever the model or the
 * prompt templates change materially.
 */
export const DERIVATIVE_COST_PER_CALL_USD: Readonly<Record<string, number>> = {
  case_digest: 0.0017,
  mcq_question: 0.0017,
  doctrine_extract: 0.0013,
  essay_prompt: 0.0011,
  flashcard: 0.0009,
  subject_classification: 0.0005,
  // `subject_outline` has no 30d sample of its own: it dispatches per
  // subject rather than per document and packs several documents into a
  // single call, so it cannot be priced from the per-document types
  // above. Estimated at 2x the most expensive measured type until a
  // real sample exists.
  subject_outline: 0.0034,
};

/**
 * Fallback for a type absent from the table above. Set to the most
 * expensive measured per-document type so an unknown type over-
 * estimates rather than under-estimates.
 */
export const DEFAULT_DERIVATIVE_COST_USD = 0.0017;

/** Measured cost for one call of `derivativeType`, with fallback. */
export function derivativeCostPerCall(derivativeType: string): number {
  return (
    DERIVATIVE_COST_PER_CALL_USD[derivativeType] ?? DEFAULT_DERIVATIVE_COST_USD
  );
}
