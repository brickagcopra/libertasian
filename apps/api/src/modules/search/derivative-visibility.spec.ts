import {
  ORG_SCOPED_DERIVATIVE_VISIBILITIES,
  PUBLIC_DERIVATIVE_VISIBILITY,
  buildDerivativeVisibilityFilter,
} from './query-builder';

/**
 * These tests evaluate the generated query DSL against documents rather than
 * asserting its shape.
 *
 * A shape assertion ("the filter contains a must_not exists clause") passes
 * just as happily when the clause is in the wrong branch, or when a second
 * branch quietly widens what the first one restricted. The property that
 * actually matters — "a row owned by org A is never returned to a caller in
 * org B" — is a statement about matching, so it is tested by matching.
 *
 * The matcher below implements the subset of the DSL these filters emit, with
 * OpenSearch's semantics for the one operator the whole design rests on:
 * `exists` is true for a field that is PRESENT, including when its value is an
 * empty string. That is why the indexer must omit `organization_id` rather than
 * write `''`, and the sentinel test at the bottom is what pins it.
 */

type Doc = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** First [field, value] pair of a single-key leaf clause such as `{ term: {...} }`. */
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

function matches(clause: unknown, doc: Doc): boolean {
  if (!isRecord(clause)) throw new Error('Unsupported clause');

  if ('bool' in clause) {
    const bool = clause['bool'];
    if (!isRecord(bool)) throw new Error('Malformed bool clause');

    const must = asClauseList(bool['must']);
    const mustNot = asClauseList(bool['must_not']);
    const should = asClauseList(bool['should']);

    if (!must.every((sub) => matches(sub, doc))) return false;
    if (mustNot.some((sub) => matches(sub, doc))) return false;

    if (should.length > 0) {
      const raw = bool['minimum_should_match'];
      const minimum = typeof raw === 'number' ? raw : 1;
      if (should.filter((sub) => matches(sub, doc)).length < minimum) return false;
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
    // OpenSearch: present and non-null. An empty string IS present.
    return field in doc && doc[field] !== null && doc[field] !== undefined;
  }

  throw new Error(`Unsupported clause: ${Object.keys(clause).join(', ')}`);
}

// --- documents under test ------------------------------------------------

/** No `organization_id` key at all — what the indexer must produce for a null org. */
const PUBLIC_ROW: Doc = { derivative_id: 'd-public', visibility: 'public_editorial' };

const ORG_A_PRIVATE: Doc = {
  derivative_id: 'd-a-private',
  visibility: 'private',
  organization_id: 'org-a',
};
const ORG_A_UNLISTED: Doc = {
  derivative_id: 'd-a-unlisted',
  visibility: 'unlisted',
  organization_id: 'org-a',
};
const ORG_A_PUBLIC: Doc = {
  derivative_id: 'd-a-public',
  visibility: 'public_editorial',
  organization_id: 'org-a',
};
const ORG_B_PRIVATE: Doc = {
  derivative_id: 'd-b-private',
  visibility: 'private',
  organization_id: 'org-b',
};

const ALL_ORG_SCOPED_ROWS = [ORG_A_PRIVATE, ORG_A_UNLISTED, ORG_A_PUBLIC, ORG_B_PRIVATE];

const CALLER_A = { organizationId: 'org-a' };
const CALLER_B = { organizationId: 'org-b' };

describe('buildDerivativeVisibilityFilter', () => {
  describe('the matcher itself', () => {
    // If the matcher is wrong, every test below is worthless.
    it('treats a missing field as not existing and an empty string as existing', () => {
      const clause = { exists: { field: 'organization_id' } };
      expect(matches(clause, { visibility: 'x' })).toBe(false);
      expect(matches(clause, { organization_id: '' })).toBe(true);
      expect(matches(clause, { organization_id: 'org-a' })).toBe(true);
    });

    it('rejects a clause type it does not model rather than passing it', () => {
      expect(() => matches({ wildcard: { title: '*' } }, PUBLIC_ROW)).toThrow(
        /Unsupported clause/,
      );
    });
  });

  describe('unauthenticated caller', () => {
    const filter = buildDerivativeVisibilityFilter(null);

    it('matches a public row with no organization', () => {
      expect(matches(filter, PUBLIC_ROW)).toBe(true);
    });

    it('never receives ANY org-scoped row', () => {
      for (const row of ALL_ORG_SCOPED_ROWS) {
        expect(matches(filter, row)).toBe(false);
      }
    });

    it('does not receive an org-owned row even when it is marked public_editorial', () => {
      // The `must_not exists organization_id` half of the public branch. Without
      // it this row would be world-readable.
      expect(matches(filter, ORG_A_PUBLIC)).toBe(false);
    });

    it('exposes exactly one branch — there is nothing to fall through to', () => {
      const should = (filter['bool'] as Record<string, unknown>)['should'];
      expect(Array.isArray(should) && should.length).toBe(1);
    });
  });

  describe('authenticated caller', () => {
    const filter = buildDerivativeVisibilityFilter(CALLER_A);

    it('receives public rows', () => {
      expect(matches(filter, PUBLIC_ROW)).toBe(true);
    });

    it.each([
      ['private', ORG_A_PRIVATE],
      ['unlisted', ORG_A_UNLISTED],
      ['public_editorial', ORG_A_PUBLIC],
    ])('receives its own org\'s %s rows', (_visibility, row) => {
      expect(matches(filter, row)).toBe(true);
    });

    it('is NEVER returned a row owned by another organization', () => {
      expect(matches(filter, ORG_B_PRIVATE)).toBe(false);
      // And symmetrically, from the other side.
      expect(matches(buildDerivativeVisibilityFilter(CALLER_B), ORG_A_PRIVATE)).toBe(false);
      expect(matches(buildDerivativeVisibilityFilter(CALLER_B), ORG_A_UNLISTED)).toBe(false);
      expect(matches(buildDerivativeVisibilityFilter(CALLER_B), ORG_A_PUBLIC)).toBe(false);
    });

    it('exposes exactly two branches', () => {
      const should = (filter['bool'] as Record<string, unknown>)['should'];
      expect(Array.isArray(should) && should.length).toBe(2);
    });
  });

  describe('a null-org row can ONLY match the public branch', () => {
    const filter = buildDerivativeVisibilityFilter(CALLER_A);
    const branches = (filter['bool'] as Record<string, unknown>)['should'] as unknown[];
    const publicBranch = branches[0];
    const orgBranch = branches[1];

    it('matches the public branch', () => {
      expect(matches(publicBranch, PUBLIC_ROW)).toBe(true);
    });

    it('does not match the org branch — a missing org_id cannot equal an org id', () => {
      expect(matches(orgBranch, PUBLIC_ROW)).toBe(false);
    });

    it('is reachable through the public branch alone for every caller', () => {
      for (const caller of [null, CALLER_A, CALLER_B]) {
        expect(matches(buildDerivativeVisibilityFilter(caller), PUBLIC_ROW)).toBe(true);
      }
    });
  });

  describe('visibility allowlist', () => {
    it('excludes an unrecognised visibility value from the public branch', () => {
      const filter = buildDerivativeVisibilityFilter(null);
      expect(matches(filter, { visibility: 'top_secret' })).toBe(false);
      expect(matches(filter, { visibility: 'archived' })).toBe(false);
      expect(matches(filter, { visibility: '' })).toBe(false);
    });

    it('excludes an unrecognised visibility value even for the owning org', () => {
      const filter = buildDerivativeVisibilityFilter(CALLER_A);
      expect(
        matches(filter, { visibility: 'top_secret', organization_id: 'org-a' }),
      ).toBe(false);
      expect(
        matches(filter, { visibility: 'quarantined', organization_id: 'org-a' }),
      ).toBe(false);
    });

    it('enumerates the allowlist rather than negating a denylist', () => {
      // A denylist would admit any future value by default. Assert the org
      // branch really is a closed `terms` set.
      const filter = buildDerivativeVisibilityFilter(CALLER_A);
      const branches = (filter['bool'] as Record<string, unknown>)['should'] as unknown[];
      const orgBranch = branches[1];
      const must = (
        (orgBranch as Record<string, unknown>)['bool'] as Record<string, unknown>
      )['must'] as unknown[];
      const termsClause = must.find(
        (clause) => isRecord(clause) && 'terms' in clause,
      ) as Record<string, unknown>;
      expect(termsClause['terms']).toEqual({
        visibility: [...ORG_SCOPED_DERIVATIVE_VISIBILITIES],
      });
    });

    it('keeps public_editorial as the single world-readable value', () => {
      expect(PUBLIC_DERIVATIVE_VISIBILITY).toBe('public_editorial');
    });
  });

  describe('malformed principal', () => {
    // Explicitly the public branch — never a wildcard, never a crash.
    it.each([
      ['an empty organization id', { organizationId: '' }],
      ['a whitespace-free but absent claim', { organizationId: '' }],
    ])('treats %s as unauthenticated', (_label, principal) => {
      const filter = buildDerivativeVisibilityFilter(principal);
      expect(matches(filter, PUBLIC_ROW)).toBe(true);
      for (const row of ALL_ORG_SCOPED_ROWS) {
        expect(matches(filter, row)).toBe(false);
      }
    });

    it('does not let an empty org id match a row with an empty org id', () => {
      // The pathological pairing: a sentinel-written row and a malformed
      // principal must not find each other.
      const filter = buildDerivativeVisibilityFilter({ organizationId: '' });
      expect(matches(filter, { visibility: 'private', organization_id: '' })).toBe(false);
    });
  });

  describe('why the indexer must OMIT organization_id (deliverable 3)', () => {
    // These rows are what a sentinel-writing indexer would produce. They are
    // the reason `toDerivativePayload` spreads the key conditionally and
    // `bulkIndexDerivatives` strips it again.
    it('an empty-string org id makes a public row invisible to everyone', () => {
      const sentinelRow: Doc = { visibility: 'public_editorial', organization_id: '' };
      expect(matches(buildDerivativeVisibilityFilter(null), sentinelRow)).toBe(false);
      expect(matches(buildDerivativeVisibilityFilter(CALLER_A), sentinelRow)).toBe(false);
    });

    it('a literal sentinel org id is worse — it is a shared bucket', () => {
      // If two rows from different tenants both got organization_id: 'public',
      // any caller whose org happened to be 'public' would see both.
      const sentinelRow: Doc = { visibility: 'private', organization_id: 'public' };
      expect(
        matches(buildDerivativeVisibilityFilter({ organizationId: 'public' }), sentinelRow),
      ).toBe(true);
      // Which is exactly why no such value may ever be written.
      expect(matches(buildDerivativeVisibilityFilter(null), sentinelRow)).toBe(false);
    });
  });
});
