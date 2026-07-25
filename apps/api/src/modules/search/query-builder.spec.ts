import {
  DEFAULT_RANKING_WEIGHTS,
  buildCitationQueryBody,
  buildKeywordQueryBody,
  buildSuggestionQueryBody,
} from './query-builder';
import { classifyQuery } from './query-intent';

const PONENTES = new Set(['HERNANDO', 'LOPEZ']);
const intentFor = (query: string) =>
  classifyQuery(query, { ponenteAllowList: PONENTES, currentYear: 2026 });

const bodyFor = (query: string, overrides = {}) =>
  buildKeywordQueryBody({
    intent: intentFor(query),
    from: 0,
    size: 20,
    ...overrides,
  });

/** Every clause anywhere in a DSL object, flattened. */
function walk(node: unknown, out: Record<string, unknown>[] = []) {
  if (Array.isArray(node)) {
    node.forEach((child) => walk(child, out));
  } else if (node !== null && typeof node === 'object') {
    out.push(node as Record<string, unknown>);
    Object.values(node as Record<string, unknown>).forEach((child) => walk(child, out));
  }
  return out;
}

/** JSON paths whose value mentions fuzziness, paired with the fields they cover. */
function fuzzyFieldSets(body: unknown): string[][] {
  return walk(body)
    .filter((node) => 'fuzziness' in node || 'multi_match' in node)
    .flatMap((node) => {
      const mm = (node['multi_match'] ?? node) as Record<string, unknown>;
      if (!('fuzziness' in mm)) return [];
      const fields = mm['fields'];
      return Array.isArray(fields) ? [fields.map(String)] : [];
    });
}

describe('buildKeywordQueryBody — fuzziness discipline', () => {
  // The v1 regression: `fuzziness: 'AUTO'` over plain_text matched 4,040 of
  // 4,040 published docs for "estafa" (476 exact) and answered "Hernando" with
  // Fernando cases.
  it('never applies fuzziness to any citation or docket field', () => {
    for (const query of [
      'G.R. No. 246999',
      '246999',
      'A.M. No. P-15-3290',
      'RA 8353',
      'People v. Balbarez',
      'estafa',
    ]) {
      for (const fields of fuzzyFieldSets(bodyFor(query))) {
        for (const field of fields) {
          expect(field).not.toMatch(/^gr_no/);
          expect(field).not.toMatch(/^citation_text/);
          expect(field).not.toMatch(/^docket_no/);
        }
      }
    }
  });

  it('pins prefix_length to 2 so Hernando cannot match Fernando', () => {
    const fuzzy = walk(bodyFor('Hernando')).find(
      (node) => 'fuzziness' in node && 'prefix_length' in node,
    );
    expect(fuzzy?.['prefix_length']).toBe(2);
    expect(fuzzy?.['max_expansions']).toBe(20);
    expect(fuzzy?.['minimum_should_match']).toBe('75%');
  });

  it('keeps the fuzzy clause at boost 0.3 so it can never outrank an exact hit', () => {
    const fuzzy = walk(bodyFor('estafa')).find((node) => 'fuzziness' in node);
    expect(fuzzy?.['boost']).toBe(0.3);
  });

  it('gives the exact non-fuzzy clause operator:and across the precise fields', () => {
    const exact = walk(bodyFor('estafa')).find(
      (node) => node['type'] === 'best_fields' && !('fuzziness' in node),
    );
    expect(exact?.['operator']).toBe('and');
    expect(exact?.['fields']).toEqual([
      'title^5',
      'citation_text^6',
      'ponente.text^3',
      'docket_no^4',
      'short_title^2',
    ]);
  });
});

describe('buildKeywordQueryBody — intent-derived clauses', () => {
  it('adds a boost-50 exact term on gr_no_digits for a bare docket number', () => {
    const clauses = walk(bodyFor('246999'));
    expect(clauses).toContainEqual({
      term: { gr_no_digits: { value: '246999', boost: 50 } },
    });
  });

  it('adds normalized boost-40 terms on the .raw citation fields', () => {
    const clauses = walk(bodyFor('G.R. No. 246999'));
    expect(clauses).toContainEqual({
      term: { 'citation_text.raw': { value: 'grno246999', boost: 40 } },
    });
    expect(clauses).toContainEqual({
      term: { 'docket_no.raw': { value: 'grno246999', boost: 40 } },
    });
  });

  // Review note: A.M. dockets carry no digits in their alphabetic prefix, so
  // the bare-number key is weaker for them. Confirm they route through
  // docket_no.raw rather than relying on gr_no_digits alone.
  it('routes an A.M. docket through docket_no.raw, not just gr_no_digits', () => {
    const clauses = walk(bodyFor('A.M. No. SCC-15-21-P'));
    const normalized = 'amnoscc-15-21-p';
    expect(clauses).toContainEqual({
      term: { 'docket_no.raw': { value: normalized, boost: 40 } },
    });
    expect(clauses).toContainEqual({
      term: { 'gr_no.raw': { value: normalized, boost: 40 } },
    });
  });

  it('adds a boost-8 term on ponente for a recognised name', () => {
    const clauses = walk(bodyFor('Hernando'));
    expect(clauses).toContainEqual({
      term: { ponente: { value: 'HERNANDO', boost: 8 } },
    });
  });

  it('adds match_phrase clauses for every quoted span', () => {
    const clauses = walk(bodyFor('"psychological incapacity"'));
    expect(clauses).toContainEqual({
      match_phrase: { title: { query: 'psychological incapacity', boost: 10, slop: 2 } },
    });
  });
});

describe('buildKeywordQueryBody — dates', () => {
  it('turns a date-only query into a hard range filter sorted by date desc', () => {
    const body = bodyFor('2026-01-21');
    const bool = walk(body).find((node) => 'filter' in node && 'must' in node);
    expect(bool?.['filter']).toContainEqual({
      range: {
        decision_date: {
          gte: '2026-01-21T00:00:00.000Z',
          lt: '2026-01-22T00:00:00.000Z',
        },
      },
    });
    expect(body['sort']).toEqual([{ decision_date: { order: 'desc' } }, '_score']);
  });

  it('turns a date inside a topical query into an additive boost, not a filter', () => {
    const body = bodyFor('estafa January 2019');
    const clauses = walk(body);

    const boostRange = clauses.find(
      (node) =>
        'range' in node &&
        typeof node['range'] === 'object' &&
        'boost' in
          ((node['range'] as Record<string, Record<string, unknown>>)['decision_date'] ??
            {}),
    );
    expect(boostRange).toBeDefined();
    expect(body['sort']).toBeUndefined();
  });
});

describe('buildKeywordQueryBody — collapse, total and pagination', () => {
  it('collapses by document_id with a best_section inner hit', () => {
    const body = bodyFor('estafa');
    expect(body['collapse']).toEqual({
      field: 'document_id',
      inner_hits: {
        name: 'best_section',
        size: 1,
        highlight: expect.any(Object),
        _source: ['section_id', 'section_type'],
      },
    });
  });

  it('adds the cardinality agg that becomes meta.total', () => {
    expect(bodyFor('estafa')['aggs']).toEqual({
      total_docs: {
        cardinality: { field: 'document_id', precision_threshold: 4000 },
      },
    });
  });

  it('passes from/size straight through so deep pages address the collapsed set', () => {
    const body = bodyFor('estafa', { from: 60, size: 20 });
    expect(body['from']).toBe(60);
    expect(body['size']).toBe(20);
  });

  it('omits collapse and aggs when collapsing is disabled', () => {
    const body = bodyFor('estafa', { collapseByDocument: false });
    expect(body['collapse']).toBeUndefined();
    expect(body['aggs']).toBeUndefined();
  });
});

describe('buildKeywordQueryBody — filters', () => {
  it('emits a terms clause for a multi-select document type', () => {
    const body = bodyFor('estafa', {
      filters: { documentType: ['decision', 'codal'] },
    });
    const bool = walk(body).find((node) => 'filter' in node);
    expect(bool?.['filter']).toContainEqual({
      terms: { document_type: ['decision', 'codal'] },
    });
  });

  it('keeps the existing status gate — drafts stay out unless narrowed', () => {
    const bool = walk(bodyFor('estafa')).find((node) => 'filter' in node);
    expect(bool?.['filter']).toContainEqual({
      terms: { status: ['published', 'indexed'] },
    });
  });

  it('emits the dedup suppression must_not only when IDs are supplied', () => {
    const withIds = walk(bodyFor('estafa', { excludeDocumentIds: ['a', 'b'] }));
    expect(withIds).toContainEqual({ terms: { document_id: ['a', 'b'] } });

    const withoutIds = walk(bodyFor('estafa', { excludeDocumentIds: [] }));
    expect(withoutIds.some((node) => 'must_not' in node)).toBe(false);
  });
});

describe('buildKeywordQueryBody — function_score', () => {
  it('encodes official > semi_official > editorial as multiplicative weights', () => {
    const fs = walk(bodyFor('estafa')).find((node) => 'function_score' in node);
    const functions = (fs?.['function_score'] as Record<string, unknown>)[
      'functions'
    ] as Record<string, unknown>[];

    const weightFor = (trust: string) =>
      functions.find(
        (fn) =>
          JSON.stringify(fn['filter']) ===
          JSON.stringify({ term: { source_trust_level: trust } }),
      )?.['weight'];

    expect(weightFor('official')).toBe(DEFAULT_RANKING_WEIGHTS.trustOfficial);
    expect(weightFor('semi_official')).toBe(DEFAULT_RANKING_WEIGHTS.trustSemiOfficial);
    expect(weightFor('editorial')).toBe(DEFAULT_RANKING_WEIGHTS.trustEditorial);
    expect(weightFor('official')).toBeGreaterThan(weightFor('editorial') as number);
  });

  it('applies a deliberately mild recency decay — landmark cases are old', () => {
    const fs = walk(bodyFor('estafa')).find((node) => 'function_score' in node);
    const functions = (fs?.['function_score'] as Record<string, unknown>)[
      'functions'
    ] as Record<string, unknown>[];
    const gauss = functions.find((fn) => 'gauss' in fn);

    expect(gauss?.['gauss']).toEqual({
      decision_date: { origin: 'now', scale: '3650d', decay: 0.6 },
    });
  });

  it('honours env-tuned weights', () => {
    const body = buildKeywordQueryBody({
      intent: intentFor('estafa'),
      from: 0,
      size: 20,
      weights: { ...DEFAULT_RANKING_WEIGHTS, recencyScaleDays: 365 },
    });
    const gauss = walk(body).find((node) => 'gauss' in node);
    expect(
      (gauss?.['gauss'] as Record<string, Record<string, unknown>>)['decision_date']![
        'scale'
      ],
    ).toBe('365d');
  });
});

describe('DSL snapshots per intent kind', () => {
  it.each([
    ['citation', 'G.R. No. 246999'],
    ['bare docket', '246999'],
    ['statute', 'RA 8353'],
    ['date', '2026-01-21'],
    ['person', 'Hernando'],
    ['party_case', 'People of the Philippines vs. Marvin Balbarez'],
    ['phrase', '"psychological incapacity"'],
    ['general', 'estafa'],
  ])('matches the %s snapshot', (_label, query) => {
    expect(bodyFor(query)).toMatchSnapshot();
  });
});

describe('buildCitationQueryBody', () => {
  it('uses only exact terms on normalized keyword fields', () => {
    const body = buildCitationQueryBody('G.R. No. 246999', '246999');
    const clauses = walk(body);

    expect(clauses).toContainEqual({
      term: { gr_no_digits: { value: '246999', boost: 12 } },
    });
    expect(clauses).toContainEqual({
      term: { 'citation_text.raw': { value: 'grno246999', boost: 10 } },
    });
    expect(clauses.some((node) => 'fuzziness' in node)).toBe(false);
    expect(clauses.some((node) => 'match_phrase' in node)).toBe(false);
  });

  it('omits the digits clause when no digits could be derived', () => {
    const clauses = walk(buildCitationQueryBody('Republic Act', undefined));
    expect(clauses.some((node) => 'gr_no_digits' in node)).toBe(false);
  });
});

describe('buildSuggestionQueryBody', () => {
  it('queries the search_as_you_type shingles with bool_prefix', () => {
    const clauses = walk(buildSuggestionQueryBody('People v', 10));
    const boolPrefix = clauses.find((node) => node['type'] === 'bool_prefix');
    expect(boolPrefix?.['fields']).toEqual([
      'title.suggest',
      'title.suggest._2gram',
      'title.suggest._3gram',
    ]);
  });

  it('prefixes gr_no_digits when the user is typing a number', () => {
    const clauses = walk(buildSuggestionQueryBody('2469', 10));
    expect(clauses).toContainEqual({
      prefix: { gr_no_digits: { value: '2469', boost: 8 } },
    });
  });

  it('restricts to published content, collapses per document and caps at 10', () => {
    const body = buildSuggestionQueryBody('People', 50);
    expect(body['size']).toBe(10);
    expect(body['timeout']).toBe('3s');
    expect(body['collapse']).toEqual({ field: 'document_id' });
    const bool = walk(body).find((node) => 'filter' in node);
    expect(bool?.['filter']).toEqual([{ term: { is_published: true } }]);
  });
});
