/**
 * Pure citation/docket normalisation helpers shared by the index writer and
 * the query builders. Kept dependency-free so they can be unit-tested without
 * a Nest testing module and reused from the Python-side ingestion docs.
 */

/**
 * Mirror of the `citation_normalizer` OpenSearch normalizer
 * (lowercase + strip `.`, spaces and `,`). Apply this to *query* input so the
 * value matches what the analyzer produced at index time.
 *
 * `"G.R. No. 246999"` → `"grno246999"`
 */
export function normalizeCitationKey(value: string | null | undefined): string {
  if (!value) return '';
  return value.toLowerCase().replace(/[.,\s]/g, '');
}

/**
 * Derive the `gr_no_digits` index field: the digits-and-hyphens-only form of a
 * docket/G.R. number. This is what makes a bare-number lookup (`246999`) an
 * exact `term` match instead of a fuzzy text match.
 *
 * Rules:
 *  - Strip every character that is not a digit or a hyphen.
 *  - Collapse runs of hyphens and trim leading/trailing hyphens, so prefixes
 *    like `A.M. No. ` do not leak a leading `-` into the key.
 *  - Return `undefined` when nothing usable remains (callers omit the field
 *    rather than indexing an empty keyword).
 *
 * Examples:
 *   `G.R. No. 246999`      → `246999`
 *   `G.R. Nos. 205528-29`  → `205528-29`
 *   `A.M. No. SCC-15-21-P` → `15-21`
 *   `UDK-16915`            → `16915`
 */
export function deriveGrNoDigits(
  grNo: string | null | undefined,
): string | undefined {
  if (!grNo) return undefined;
  const digits = grNo
    .replace(/[^\d-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return digits.length > 0 ? digits : undefined;
}
