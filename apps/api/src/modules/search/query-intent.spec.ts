import { classifyQuery } from './query-intent';

const PONENTES = new Set(['HERNANDO', 'LOPEZ', 'GAERLAN', 'CAGUIOA']);
const OPTS = { ponenteAllowList: PONENTES, currentYear: 2026 };

describe('classifyQuery — citations', () => {
  it.each([
    ['G.R. No. 246999', '246999'],
    ['G.R. No. 246999', '246999'],
    ['GR 246999', '246999'],
    ['g.r. no. 246999', '246999'],
    ['G.R. Nos. 205528-29', '205528-29'],
    ['G.R. No. L-12345', '12345'],
  ])('classifies %s as a citation with digits %s', (query, digits) => {
    const intent = classifyQuery(query, OPTS);
    expect(intent.kind).toBe('citation');
    expect(intent.citation?.digits).toBe(digits);
    expect(intent.citation?.bare).toBe(false);
  });

  it.each([
    ['A.M. No. P-15-3290', '15-3290'],
    ['A.C. No. 12345', '12345'],
    ['UDK-16915', '16915'],
    ['B.M. No. 2012', '2012'],
  ])('classifies docket %s as a citation with digits %s', (query, digits) => {
    const intent = classifyQuery(query, OPTS);
    expect(intent.kind).toBe('citation');
    expect(intent.citation?.digits).toBe(digits);
  });

  it.each(['246999', '24699', '20552'])(
    'treats the bare 5-6 digit number %s as a docket, never a date',
    (query) => {
      const intent = classifyQuery(query, OPTS);
      expect(intent.kind).toBe('citation');
      expect(intent.citation).toEqual({ raw: query, digits: query, bare: true });
    },
  );
});

describe('classifyQuery — the bare 4-digit disambiguation', () => {
  // The rule: a bare 4-digit number inside 1900..currentYear is a DATE only
  // when it is the entire query. Anything else makes it a docket number.
  it.each(['1998', '2019', '1900', '2026'])(
    'reads the lone token %s as a year',
    (query) => {
      const intent = classifyQuery(query, OPTS);
      expect(intent.kind).toBe('date');
      expect(intent.dateOnly).toBe(true);
      expect(intent.dateRange?.granularity).toBe('year');
    },
  );

  it.each(['1899', '2027', '3000'])(
    'reads the implausible-year token %s as a docket number',
    (query) => {
      const intent = classifyQuery(query, OPTS);
      expect(intent.kind).toBe('citation');
      expect(intent.citation?.bare).toBe(true);
    },
  );

  it('reads a 4-digit number inside a G.R. citation as a docket, not a year', () => {
    const intent = classifyQuery('G.R. No. 1998', OPTS);
    expect(intent.kind).toBe('citation');
    expect(intent.citation?.digits).toBe('1998');
  });

  it('reads a 4-digit year alongside a month name as a date', () => {
    const intent = classifyQuery('January 1998', OPTS);
    expect(intent.kind).toBe('date');
    expect(intent.dateRange?.granularity).toBe('month');
  });

  it('does not treat a year buried in a topical query as date-only', () => {
    const intent = classifyQuery('estafa 2019', OPTS);
    expect(intent.dateOnly).toBe(false);
    expect(intent.kind).not.toBe('date');
  });
});

describe('classifyQuery — statutes and rules', () => {
  it.each([
    ['RA 8353', '8353'],
    ['R.A. No. 8353', '8353'],
    ['Republic Act No. 8353', '8353'],
    ['PD 1529', '1529'],
    ['EO 292', '292'],
    ['BP 22', '22'],
  ])('classifies %s as a statute reference', (query, digits) => {
    const intent = classifyQuery(query, OPTS);
    expect(intent.kind).toBe('statute');
    expect(intent.citation?.digits).toBe(digits);
  });

  it.each(['Rule 65', 'Art. 315', 'Article 36', 'Section 5', 'Sec. 5'])(
    'classifies %s as a statute/rule reference',
    (query) => {
      expect(classifyQuery(query, OPTS).kind).toBe('statute');
    },
  );
});

describe('classifyQuery — dates', () => {
  it('parses an ISO date to a single-day range', () => {
    const intent = classifyQuery('2026-01-21', OPTS);
    expect(intent.kind).toBe('date');
    expect(intent.dateRange).toEqual({
      gte: '2026-01-21T00:00:00.000Z',
      lt: '2026-01-22T00:00:00.000Z',
      granularity: 'day',
    });
  });

  it.each(['January 21, 2026', 'Jan 21 2026', 'jan. 21, 2026'])(
    'parses the long form %s to the same single-day range',
    (query) => {
      const intent = classifyQuery(query, OPTS);
      expect(intent.kind).toBe('date');
      expect(intent.dateRange?.gte).toBe('2026-01-21T00:00:00.000Z');
      expect(intent.dateRange?.granularity).toBe('day');
    },
  );

  it('parses a month-year to a month range', () => {
    const intent = classifyQuery('Jan 2026', OPTS);
    expect(intent.dateRange).toEqual({
      gte: '2026-01-01T00:00:00.000Z',
      lt: '2026-02-01T00:00:00.000Z',
      granularity: 'month',
    });
  });

  it('rejects an impossible calendar date rather than inventing a range', () => {
    const intent = classifyQuery('2026-02-31', OPTS);
    expect(intent.kind).not.toBe('date');
    expect(intent.dateRange).toBeUndefined();
  });
});

describe('classifyQuery — people', () => {
  it.each(['Hernando', 'HERNANDO', 'hernando'])(
    'classifies the known ponente %s as a person',
    (query) => {
      const intent = classifyQuery(query, OPTS);
      expect(intent.kind).toBe('person');
      expect(intent.personName).toBe('HERNANDO');
    },
  );

  it.each(['J. Lopez', 'Justice Lopez', 'Hon. Lopez'])(
    'classifies the titled form %s as a person',
    (query) => {
      expect(classifyQuery(query, OPTS).personName).toBe('LOPEZ');
    },
  );

  it('recognises a titled name even when it is not in the allow-list', () => {
    const intent = classifyQuery('Justice Marbury', { currentYear: 2026 });
    expect(intent.kind).toBe('person');
    expect(intent.personName).toBe('MARBURY');
  });

  // Without the allow-list guard every one-word query becomes a "person" and
  // gets a spurious ponente boost.
  it.each(['estafa', 'certiorari', 'mandamus'])(
    'does not treat the topical term %s as a person',
    (query) => {
      expect(classifyQuery(query, OPTS).kind).not.toBe('person');
    },
  );

  it('fails open to no person match when the allow-list is unavailable', () => {
    const intent = classifyQuery('Hernando', { currentYear: 2026 });
    expect(intent.kind).toBe('general');
    expect(intent.personName).toBeUndefined();
  });
});

describe('classifyQuery — party cases and phrases', () => {
  it.each([
    'People of the Philippines v. Marvin Balbarez',
    'People of the Philippines vs. Marvin Balbarez',
    'People of the Philippines vs Marvin Balbarez',
    'Republic versus Molina',
  ])('classifies %s as a party case', (query) => {
    expect(classifyQuery(query, OPTS).kind).toBe('party_case');
  });

  it('extracts quoted spans as exact phrases', () => {
    const intent = classifyQuery('"psychological incapacity" nullity', OPTS);
    expect(intent.kind).toBe('phrase');
    expect(intent.exactPhrases).toEqual(['psychological incapacity']);
    expect(intent.cleanedQuery).toBe('psychological incapacity nullity');
  });

  it('extracts multiple quoted spans in order', () => {
    const intent = classifyQuery('"grave abuse" and "excess of jurisdiction"', OPTS);
    expect(intent.exactPhrases).toEqual(['grave abuse', 'excess of jurisdiction']);
  });

  it('ignores an unterminated quote', () => {
    const intent = classifyQuery('"psychological incapacity', OPTS);
    expect(intent.exactPhrases).toEqual([]);
  });
});

describe('classifyQuery — general and edge cases', () => {
  it.each(['estafa', 'psychological incapacity', 'grave abuse of discretion'])(
    'falls through to general for the topical query %s',
    (query) => {
      expect(classifyQuery(query, OPTS).kind).toBe('general');
    },
  );

  it.each(['', '   ', '\t\n'])('handles the empty query %j safely', (query) => {
    const intent = classifyQuery(query, OPTS);
    expect(intent.kind).toBe('general');
    expect(intent.cleanedQuery).toBe('');
  });

  it('collapses whitespace without altering the words', () => {
    expect(classifyQuery('  people   v.   santos  ', OPTS).cleanedQuery).toBe(
      'people v. santos',
    );
  });
});
