import {
  COURT_FILTER_OPTIONS,
  COURT_LABELS,
  COURT_VALUES,
  normalizeCourtKey,
  type CourtValue,
} from '@libertasian/types';

/**
 * These assertions are the drift guard for the court filter.
 *
 * The bug they pin: `legal_documents.court` stores display text, the dropdown
 * sent snake_case, and the index filtered on the display field — so every
 * court-filtered search returned 0 results with no error anywhere. The fix only
 * holds as long as `COURT_LABELS` keeps matching what PostgreSQL actually
 * stores, because that is what `normalizeCourtKey` runs over at index time.
 */
describe('normalizeCourtKey', () => {
  it('round-trips every display label back to its key', () => {
    for (const value of COURT_VALUES) {
      expect(normalizeCourtKey(COURT_LABELS[value])).toBe(value);
    }
  });

  it('is idempotent — normalising a key returns the same key', () => {
    for (const value of COURT_VALUES) {
      expect(normalizeCourtKey(value)).toBe(value);
    }
  });

  it.each([
    ['Supreme Court', 'supreme_court'],
    ['  Supreme Court  ', 'supreme_court'],
    ['SUPREME COURT', 'supreme_court'],
    ['Court of Tax Appeals', 'court_of_tax_appeals'],
    ['Regional Trial Court', 'regional_trial_court'],
    ['Court of Appeals — Cebu', 'court_of_appeals_cebu'],
  ])('normalises %j to %j', (input, expected) => {
    expect(normalizeCourtKey(input)).toBe(expected);
  });

  it.each([null, undefined, '', '   ', '---'])(
    'returns undefined for %j so the field is omitted rather than indexed empty',
    (input) => {
      expect(normalizeCourtKey(input)).toBeUndefined();
    },
  );
});

describe('court filter constants', () => {
  // Production counts at the time of writing: Supreme Court 7,443 /
  // Court of Appeals 4,923 / Regional Trial Court 2,831 / Sandiganbayan 196 /
  // Court of Tax Appeals 82. RTC was missing from the dropdown entirely.
  it('offers every court that exists in the corpus', () => {
    expect(COURT_FILTER_OPTIONS).toEqual(
      expect.arrayContaining<CourtValue>([
        'supreme_court',
        'court_of_appeals',
        'regional_trial_court',
        'sandiganbayan',
        'court_of_tax_appeals',
      ]),
    );
  });

  it('labels every accepted value', () => {
    for (const value of COURT_VALUES) {
      expect(COURT_LABELS[value]).toBeTruthy();
    }
  });
});
