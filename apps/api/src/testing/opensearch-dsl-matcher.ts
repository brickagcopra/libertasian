/**
 * Minimal evaluator for the subset of the OpenSearch query DSL this codebase
 * generates. TEST SUPPORT ONLY — nothing in production may depend on it.
 *
 * Why it exists: the authorization property that matters is "a row owned by org
 * A is never returned to a caller in org B". That is a statement about
 * MATCHING, so it should be tested by matching. A shape assertion ("the filter
 * contains a must_not exists clause") passes just as happily when the clause
 * sits in the wrong branch, or when a second branch quietly widens what the
 * first one restricted.
 *
 * The one semantic that carries the whole design is `exists`: OpenSearch reports
 * true for a field that is PRESENT, including when its value is an empty string.
 * That is why the derivative indexer omits `organization_id` rather than writing
 * `''`, and modelling it faithfully here is what makes the sentinel tests real.
 *
 * Unsupported clause types THROW rather than defaulting to true or false. A
 * silent default would let a filter change slip through as a false pass — the
 * one failure mode a security test must not have.
 */

export type MatchableDoc = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The single [field, value] pair of a leaf clause such as `{ term: {...} }`. */
function singleEntry(value: unknown): [string, unknown] {
  if (!isRecord(value)) throw new Error('Expected an object clause');
  const entries = Object.entries(value);
  if (entries.length !== 1) {
    throw new Error(`Expected exactly one field, got ${entries.length}`);
  }
  return entries[0]!;
}

function asClauseList(value: unknown): unknown[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/** Evaluate a query DSL clause against a plain document. */
export function matchesQuery(clause: unknown, doc: MatchableDoc): boolean {
  if (!isRecord(clause)) throw new Error('Unsupported clause');

  if ('bool' in clause) {
    const bool = clause['bool'];
    if (!isRecord(bool)) throw new Error('Malformed bool clause');

    const must = asClauseList(bool['must']);
    const filter = asClauseList(bool['filter']);
    const mustNot = asClauseList(bool['must_not']);
    const should = asClauseList(bool['should']);

    // `filter` is boolean-identical to `must` here; only scoring differs, and
    // this matcher does not score.
    if (!must.every((sub) => matchesQuery(sub, doc))) return false;
    if (!filter.every((sub) => matchesQuery(sub, doc))) return false;
    if (mustNot.some((sub) => matchesQuery(sub, doc))) return false;

    if (should.length > 0) {
      const raw = bool['minimum_should_match'];
      const minimum = typeof raw === 'number' ? raw : 1;
      if (should.filter((sub) => matchesQuery(sub, doc)).length < minimum) return false;
    }
    return true;
  }

  if ('term' in clause) {
    const [field, expected] = singleEntry(clause['term']);
    return doc[field] === expected;
  }

  if ('terms' in clause) {
    const [field, expected] = singleEntry(clause['terms']);
    return Array.isArray(expected) && expected.includes(doc[field]);
  }

  if ('exists' in clause) {
    const exists = clause['exists'];
    if (!isRecord(exists) || typeof exists['field'] !== 'string') {
      throw new Error('Malformed exists clause');
    }
    const field = exists['field'];
    // Present and non-null. An empty string IS present — this is the semantic
    // the omit-organization_id rule depends on.
    return field in doc && doc[field] !== null && doc[field] !== undefined;
  }

  // `multi_match` and friends are relevance clauses, not authorization ones.
  // Deliberately unsupported: a test that needs to reason about them is asking
  // this helper the wrong question.
  throw new Error(`Unsupported clause: ${Object.keys(clause).join(', ')}`);
}
