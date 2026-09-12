/**
 * Per-million-token list prices, USD.
 *
 * Mirrors `MODEL_PRICING` in
 * `services/rag-service/src/core/generation.py`, which is where the Redis
 * usage counters are priced. The API needs its own copy to price the
 * `budget_ledger` rows it writes directly (AI answers), and the two must
 * agree or Postgres and Redis will report different spend for the same
 * call. CI-locks are not possible across the language boundary, so the
 * table is small and deliberately kept in one shape.
 */
const MODEL_PRICING: Readonly<Record<string, { input: number; output: number }>> =
  {
    'gpt-4o-mini': { input: 0.15, output: 0.6 },
    'gpt-4o': { input: 2.5, output: 10.0 },
    'gpt-4.1-mini': { input: 0.4, output: 1.6 },
    'gpt-4.1-nano': { input: 0.1, output: 0.4 },
  };

/**
 * Cost in USD for one call. An unknown model prices at 0 — the same
 * behaviour as the rag-service table, so a newly-introduced model shows
 * as untracked spend rather than a fabricated number.
 */
export function costForUsd(
  modelName: string | null | undefined,
  tokensIn: number,
  tokensOut: number,
): number {
  const price = modelName ? MODEL_PRICING[modelName] : undefined;
  if (!price) return 0;
  return (tokensIn * price.input + tokensOut * price.output) / 1_000_000;
}

export { MODEL_PRICING };
