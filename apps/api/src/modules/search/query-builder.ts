/**
 * OpenSearch query DSL builders. Pure functions over plain objects so the whole
 * ranking model is snapshot-testable without a live cluster.
 *
 * The v1 builder was a single `multi_match` with `fuzziness: 'AUTO'` across
 * `plain_text`. Measured on prod that matched 4,040 of 4,040 published
 * documents for `estafa` (476 exact) and answered `Hernando` with *Fernando*
 * cases. The model here is tiered instead: exact and phrase clauses carry the
 * score, fuzzy is a low-boost recall backstop that can never outrank them, and
 * citation fields are never fuzzed at all.
 */

import { COURT_LABELS, type CourtValue } from '@libertasian/types';

import { normalizeCitationKey } from './citation-utils';
import type { QueryIntent } from './query-intent';

/**
 * Court filter clause for the VECTOR index.
 *
 * The keyword index is rebuilt from PostgreSQL, so every one of its documents
 * carries `court_key`. The vector index is *copied* forward by the rebuild job
 * instead (embeddings are too expensive to regenerate), so its existing
 * documents only ever have the raw display `court` — a `court_key` term filter
 * against them matches nothing, which would silently drop the kNN arm of every
 * court-filtered hybrid search.
 *
 * So match either form. New vector writes carry `court_key`; copied-forward
 * ones are reached through the display literal.
 */
export function buildVectorCourtClause(courtKey: string): Record<string, unknown> {
  const display = COURT_LABELS[courtKey as CourtValue];
  return {
    bool: {
      should: [
        { term: { court_key: courtKey } },
        ...(display ? [{ term: { court: display } }] : []),
      ],
      minimum_should_match: 1,
    },
  };
}

/**
 * The only visibility value a derivative may carry to be world-readable.
 * Mirrors `derivative_artifacts.visibility` (private | public_editorial | unlisted).
 */
export const PUBLIC_DERIVATIVE_VISIBILITY = 'public_editorial';

/**
 * Visibility values a member of the OWNING organization may see.
 *
 * This is an allowlist, and that is the point: it is enumerated in a `terms`
 * clause, so a row carrying a value that is not on this list — a typo, a value
 * from a future migration, anything unrecognised — matches no branch and is
 * excluded. Nothing is passed through by default. Widening access is an edit
 * to this array, which is a reviewable act.
 */
export const ORG_SCOPED_DERIVATIVE_VISIBILITIES: readonly string[] = [
  'private',
  'unlisted',
  'public_editorial',
];

/**
 * The authenticated principal, reduced to the single claim this filter may use.
 *
 * `organizationId` MUST come from verified JWT claims (`JwtPayload`). It must
 * never be read from a request body, query string, or header — a client-supplied
 * organization id turns this filter into an org-enumeration primitive.
 */
export interface DerivativeSearchPrincipal {
  organizationId: string;
}

/**
 * Authorization filter for derivative search. Every derivative query MUST be
 * wrapped in this — it is the tenant-isolation boundary for the derivatives
 * index (CLAUDE.md: "Cross-tenant data access is a critical vulnerability").
 *
 * Two explicit branches, no implicit fallthrough:
 *
 *  - **public** — `visibility = public_editorial` AND `organization_id` does not
 *    exist on the document. The `must_not exists` half is not redundant: an
 *    org-owned row marked `public_editorial` is still that org's row, and
 *    without this clause it would leak to the whole internet. This is also why
 *    the indexer must OMIT `organization_id` rather than write `''` — `exists`
 *    is false only for an absent field, so a sentinel value would flip every
 *    null-org row out of the public branch.
 *  - **org-scoped** — the public branch OR (`organization_id` = the caller's own
 *    org AND visibility on the allowlist above).
 *
 * A caller with no principal, or a principal with no usable organization id,
 * gets the public branch and nothing else. That case is written out explicitly
 * below rather than falling out of a missing `else`.
 */
export function buildDerivativeVisibilityFilter(
  user: DerivativeSearchPrincipal | null,
): Record<string, unknown> {
  const publicClause = {
    bool: {
      must: [{ term: { visibility: PUBLIC_DERIVATIVE_VISIBILITY } }],
      must_not: [{ exists: { field: 'organization_id' } }],
    },
  };
  const publicOnly = { bool: { should: [publicClause], minimum_should_match: 1 } };

  // Branch 1 — unauthenticated.
  if (user === null) return publicOnly;

  // Branch 1 (cont.) — authenticated but without a usable org claim. Explicit:
  // a malformed principal is treated as the public, never as a wildcard.
  const organizationId = user.organizationId;
  if (typeof organizationId !== 'string' || organizationId.length === 0) {
    return publicOnly;
  }

  // Branch 2 — authenticated, scoped to the caller's own organization only.
  const ownOrgClause = {
    bool: {
      must: [
        { term: { organization_id: organizationId } },
        { terms: { visibility: [...ORG_SCOPED_DERIVATIVE_VISIBILITIES] } },
      ],
    },
  };

  return {
    bool: { should: [publicClause, ownOrgClause], minimum_should_match: 1 },
  };
}

export interface RankingWeights {
  officialBoost: number;
  trustOfficial: number;
  trustSemiOfficial: number;
  trustEditorial: number;
  recencyScaleDays: number;
  recencyDecay: number;
  recencyWeight: number;
}

export const DEFAULT_RANKING_WEIGHTS: RankingWeights = {
  officialBoost: 1.2,
  trustOfficial: 1.3,
  trustSemiOfficial: 1.15,
  trustEditorial: 1.0,
  // Deliberately mild: landmark Philippine cases are decades old, so a steep
  // recency curve would bury exactly the authorities users search for.
  recencyScaleDays: 3650,
  recencyDecay: 0.6,
  recencyWeight: 1.1,
};

export interface KeywordQueryFilters {
  documentType?: string | string[];
  court?: string;
  ponente?: string;
  sourceId?: string;
  grNo?: string;
  dateFrom?: string;
  dateTo?: string;
  publishedOnly?: boolean;
}

export interface BuildKeywordQueryOptions {
  intent: QueryIntent;
  filters?: KeywordQueryFilters;
  excludeDocumentIds?: string[];
  from: number;
  size: number;
  weights?: RankingWeights;
  /** Enables `collapse` + the cardinality agg. Off for the legacy path. */
  collapseByDocument?: boolean;
}

type Clause = Record<string, unknown>;

const HIGHLIGHT = {
  fields: {
    plain_text: { fragment_size: 200, number_of_fragments: 3 },
    section_text: { fragment_size: 200, number_of_fragments: 3 },
    title: {},
  },
  pre_tags: ['<mark>'],
  post_tags: ['</mark>'],
};

/**
 * The scoring clauses. Ordered by how much precision each contributes.
 *
 * Boost budget, highest first:
 *   50  exact `gr_no_digits` term        — the user typed a docket number
 *   40  exact `citation_text.raw` / `docket_no.raw`
 *   12  `citation_text` phrase
 *   10  `title` phrase (slop 2)
 *    8  exact `ponente` term
 *    1  non-fuzzy `best_fields` across the precise fields
 *  0.3  fuzzy `most_fields` across the body text — recall backstop ONLY
 */
function buildScoringClauses(intent: QueryIntent): Clause[] {
  const query = intent.cleanedQuery;
  const should: Clause[] = [];

  // --- exact citation clauses (never fuzzed) ---
  if (intent.citation) {
    if (intent.citation.digits) {
      should.push({
        term: { gr_no_digits: { value: intent.citation.digits, boost: 50 } },
      });
    }
    const normalized = normalizeCitationKey(intent.citation.raw);
    if (normalized.length > 0) {
      should.push({ term: { 'citation_text.raw': { value: normalized, boost: 40 } } });
      should.push({ term: { 'docket_no.raw': { value: normalized, boost: 40 } } });
      should.push({ term: { 'gr_no.raw': { value: normalized, boost: 40 } } });
    }
  }

  // --- explicit quoted phrases must match as phrases ---
  for (const phrase of intent.exactPhrases) {
    should.push({ match_phrase: { title: { query: phrase, boost: 10, slop: 2 } } });
    should.push({ match_phrase: { plain_text: { query: phrase, boost: 6 } } });
    should.push({ match_phrase: { section_text: { query: phrase, boost: 6 } } });
  }

  // --- ponente ---
  if (intent.personName) {
    should.push({ term: { ponente: { value: intent.personName, boost: 8 } } });
    should.push({
      match: { 'ponente.text': { query: intent.personName, boost: 6 } },
    });
  }

  if (query.length === 0) return should;

  // --- phrase clauses ---
  should.push({ match_phrase: { title: { query, boost: 10, slop: 2 } } });
  should.push({ match_phrase: { citation_text: { query, boost: 12 } } });

  // --- precise, NON-FUZZY, all-terms-required ---
  should.push({
    multi_match: {
      query,
      type: 'best_fields',
      operator: 'and',
      fields: [
        'title^5',
        'citation_text^6',
        'ponente.text^3',
        'docket_no^4',
        'short_title^2',
      ],
    },
  });

  // --- fuzzy recall backstop ---
  // prefix_length: 2 is what stops `Hernando` matching `Fernando`; boost 0.3
  // guarantees a fuzzy hit can never outrank an exact one.
  should.push({
    multi_match: {
      query,
      type: 'most_fields',
      fields: ['title^2', 'plain_text', 'section_text'],
      fuzziness: 'AUTO',
      prefix_length: 2,
      max_expansions: 20,
      minimum_should_match: '75%',
      boost: 0.3,
    },
  });

  return should;
}

function buildFilterClauses(
  intent: QueryIntent,
  filters: KeywordQueryFilters | undefined,
): Clause[] {
  const filter: Clause[] = [];

  if (filters?.documentType) {
    const values = Array.isArray(filters.documentType)
      ? filters.documentType
      : [filters.documentType];
    if (values.length > 0) filter.push({ terms: { document_type: values } });
  }
  // `court_key`, never `court`: the index stores the raw display literal
  // ("Supreme Court") in `court`, so a term filter on it can only ever match a
  // client that happens to send the exact display casing. See index-mappings.
  if (filters?.court) filter.push({ term: { court_key: filters.court } });
  if (filters?.ponente) filter.push({ term: { ponente: filters.ponente } });
  if (filters?.sourceId) filter.push({ term: { source_id: filters.sourceId } });
  if (filters?.grNo) filter.push({ term: { gr_no: filters.grNo } });
  if (filters?.publishedOnly) filter.push({ term: { is_published: true } });

  if (filters?.dateFrom || filters?.dateTo) {
    const range: Record<string, string> = {};
    if (filters.dateFrom) range['gte'] = filters.dateFrom;
    if (filters.dateTo) range['lte'] = filters.dateTo;
    filter.push({ range: { decision_date: range } });
  }

  // Unchanged from v1: only `published`/`indexed` rows are searchable unless
  // the caller narrows further. The draft-visibility question is still open, so
  // this deliberately keeps the existing status gate as-is.
  if (!filters?.publishedOnly) {
    filter.push({ terms: { status: ['published', 'indexed'] } });
  }

  // A date-only query is the ONE case where a detected date becomes a hard
  // filter. Anywhere else it is an additive boost (see buildDateBoost), because
  // "estafa 2019" should still return strong 2018 matches.
  if (intent.kind === 'date' && intent.dateOnly && intent.dateRange) {
    filter.push({
      range: {
        decision_date: { gte: intent.dateRange.gte, lt: intent.dateRange.lt },
      },
    });
  }

  return filter;
}

function buildDateBoost(intent: QueryIntent): Clause | null {
  if (intent.dateOnly || !intent.dateRange) return null;
  return {
    range: {
      decision_date: {
        gte: intent.dateRange.gte,
        lt: intent.dateRange.lt,
        boost: 4,
      },
    },
  };
}

/**
 * `function_score` multipliers encoding the CLAUDE.md RAG ranking rule
 * "official > semi-official > editorial > private".
 */
function buildFunctionScore(query: Clause, weights: RankingWeights): Clause {
  return {
    function_score: {
      query,
      boost_mode: 'multiply',
      score_mode: 'multiply',
      functions: [
        { filter: { term: { is_official: true } }, weight: weights.officialBoost },
        {
          filter: { term: { source_trust_level: 'official' } },
          weight: weights.trustOfficial,
        },
        {
          filter: { term: { source_trust_level: 'semi_official' } },
          weight: weights.trustSemiOfficial,
        },
        {
          filter: { term: { source_trust_level: 'editorial' } },
          weight: weights.trustEditorial,
        },
        {
          filter: { exists: { field: 'decision_date' } },
          weight: weights.recencyWeight,
          gauss: {
            decision_date: {
              origin: 'now',
              scale: `${weights.recencyScaleDays}d`,
              decay: weights.recencyDecay,
            },
          },
        },
      ],
    },
  };
}

export function buildKeywordQueryBody(
  options: BuildKeywordQueryOptions,
): Record<string, unknown> {
  const {
    intent,
    filters,
    excludeDocumentIds,
    from,
    size,
    weights = DEFAULT_RANKING_WEIGHTS,
    collapseByDocument = true,
  } = options;

  // A date-only query has no textual intent at all. Scoring its own digits
  // against the body text is what made `2026-01-21` return A.M. numbers
  // *containing* those digits instead of the cases decided that day, so the
  // range filter below becomes the entire query.
  const dateOnlyQuery = intent.kind === 'date' && intent.dateOnly;

  const should = dateOnlyQuery ? [] : buildScoringClauses(intent);
  const dateBoost = buildDateBoost(intent);
  if (dateBoost) should.push(dateBoost);

  const bool: Clause = {
    filter: buildFilterClauses(intent, filters),
  };

  if (should.length > 0) {
    bool['should'] = should;
    bool['minimum_should_match'] = 1;
  } else {
    // Date-only queries have no textual clauses at all — the range filter is
    // the entire query and results sort by date instead of score.
    bool['must'] = [{ match_all: {} }];
  }

  if (excludeDocumentIds && excludeDocumentIds.length > 0) {
    bool['must_not'] = [{ terms: { document_id: excludeDocumentIds } }];
  }

  const body: Record<string, unknown> = {
    query: buildFunctionScore({ bool }, weights),
    highlight: HIGHLIGHT,
    from,
    size,
    timeout: '5s',
  };

  if (collapseByDocument) {
    // Native per-document collapse replaces the old JS dedup, which ran AFTER
    // pagination and so reported a fabricated `total` and returned 0 items on
    // page 2 for queries with thousands of real matches.
    body['collapse'] = {
      field: 'document_id',
      inner_hits: {
        name: 'best_section',
        size: 1,
        highlight: HIGHLIGHT,
        _source: ['section_id', 'section_type'],
      },
    };
    // `total` must count distinct documents, not raw section hits.
    body['aggs'] = {
      total_docs: {
        cardinality: { field: 'document_id', precision_threshold: 4000 },
      },
    };
  }

  if (intent.kind === 'date' && intent.dateOnly) {
    body['sort'] = [{ decision_date: { order: 'desc' } }, '_score'];
  }

  // Term suggester for "did you mean" — only meaningful for free text.
  if (
    intent.cleanedQuery.length > 0 &&
    intent.kind !== 'citation' &&
    !dateOnlyQuery
  ) {
    body['suggest'] = {
      did_you_mean: {
        text: intent.cleanedQuery,
        term: { field: 'title', size: 1, suggest_mode: 'popular', min_word_length: 4 },
      },
    };
  }

  return body;
}

/**
 * Exact citation lookup. Every clause is a `term` against a normalized keyword
 * field — no analysis, no fuzziness, no chance of a near-miss docket outscoring
 * the exact one.
 */
export function buildCitationQueryBody(
  citation: string,
  digits: string | undefined,
  size = 10,
): Record<string, unknown> {
  const normalized = normalizeCitationKey(citation);
  const should: Clause[] = [
    { term: { 'citation_text.raw': { value: normalized, boost: 10 } } },
    { term: { 'gr_no.raw': { value: normalized, boost: 10 } } },
    { term: { 'docket_no.raw': { value: normalized, boost: 10 } } },
  ];
  if (digits) {
    should.push({ term: { gr_no_digits: { value: digits, boost: 12 } } });
  }

  return {
    query: { bool: { should, minimum_should_match: 1 } },
    size,
    timeout: '5s',
  };
}

/**
 * Typeahead. `title.suggest` is a `search_as_you_type` field, so the
 * `bool_prefix` match runs against its shingled sub-fields.
 */
export function buildSuggestionQueryBody(
  prefix: string,
  limit: number,
): Record<string, unknown> {
  const normalized = normalizeCitationKey(prefix);
  const should: Clause[] = [
    {
      multi_match: {
        query: prefix,
        type: 'bool_prefix',
        fields: ['title.suggest', 'title.suggest._2gram', 'title.suggest._3gram'],
        boost: 3,
      },
    },
  ];

  if (normalized.length > 0) {
    should.push({
      prefix: { 'citation_text.raw': { value: normalized, boost: 5 } },
    });
    should.push({ prefix: { gr_no_digits: { value: normalized, boost: 6 } } });
  }

  const digitsOnly = prefix.replace(/\D/g, '');
  if (digitsOnly.length >= 3) {
    should.push({ prefix: { gr_no_digits: { value: digitsOnly, boost: 8 } } });
  }

  return {
    query: {
      bool: {
        should,
        minimum_should_match: 1,
        filter: [{ term: { is_published: true } }],
      },
    },
    _source: [
      'document_id',
      'title',
      'citation_text',
      'gr_no',
      'document_type',
      'court',
      'decision_date',
    ],
    collapse: { field: 'document_id' },
    size: Math.min(limit, 10),
    timeout: '3s',
  };
}
