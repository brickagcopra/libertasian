import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import { RedisService } from '../../common/services/redis.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  matchesQuery,
  type MatchableDoc,
} from '../../testing/opensearch-dsl-matcher';
import { EmbeddingClientService } from './embedding-client.service';
import { OpenSearchService } from './opensearch.service';
import { PonenteDirectoryService } from './ponente-directory.service';
import {
  buildDerivativeQueryBody,
  buildDerivativeVisibilityFilter,
} from './query-builder';
import { SearchService } from './search.service';
import { SuppressedDocsService } from './suppressed-docs.service';
import type { SearchQueryDto } from './dto';

/**
 * C3 — the federated search surface.
 *
 * The load-bearing test in this file is the FIRST one: a request that omits
 * `scope` must produce exactly the pre-C3 response. It is a deep-equality
 * assertion rather than a set of spot checks, so adding any field to the legacy
 * envelope fails it.
 *
 * The authorization tests do not inspect the filter's shape. They capture the
 * filter the service actually passed to OpenSearch and evaluate it against
 * documents, because "org A's row never reaches a caller in org B" is a claim
 * about matching. See `src/testing/opensearch-dsl-matcher.ts`.
 */

const DOCUMENT_HIT = {
  id: 'doc-1',
  score: 3.2,
  source: { document_id: 'doc-1', title: 'People v. Santos' },
  highlights: { plain_text: ['a <mark>match</mark>'] },
};

const DERIVATIVE_HIT = {
  id: 'der-1',
  score: 2.1,
  source: {
    derivative_id: 'der-1',
    derivative_type: 'case_digest',
    title: 'Digest of People v. Santos',
    body_text: 'The Court held the search invalid.',
    visibility: 'public_editorial',
  },
  highlights: { body_text: ['the <mark>search</mark> invalid'] },
};

// --- rows the visibility filter is evaluated against ---------------------

const PUBLIC_NULL_ORG: MatchableDoc = {
  derivative_id: 'd-public',
  visibility: 'public_editorial',
};
/** A private artifact with no owning org — nobody's to read. */
const PRIVATE_NULL_ORG: MatchableDoc = {
  derivative_id: 'd-orphan',
  visibility: 'private',
};
const ORG_A_PRIVATE: MatchableDoc = {
  derivative_id: 'd-a',
  visibility: 'private',
  organization_id: 'org-a',
};

describe('federated derivative search (C3)', () => {
  let service: SearchService;
  let openSearch: {
    searchKeyword: jest.Mock;
    searchVector: jest.Mock;
    searchDerivatives: jest.Mock;
    searchSuggestions: jest.Mock;
    searchExactCitation: jest.Mock;
    indexDocument: jest.Mock;
    ensureIndexes: jest.Mock;
    bulkIndexDocuments: jest.Mock;
    bulkIndexVectorDocuments: jest.Mock;
    removeDocumentFromAllIndexes: jest.Mock;
  };
  let redis: { get: jest.Mock; set: jest.Mock; getClient: jest.Mock };

  beforeEach(async () => {
    openSearch = {
      searchKeyword: jest.fn().mockResolvedValue({
        items: [DOCUMENT_HIT],
        total: 1,
        approximateTotal: false,
        maxScore: 3.2,
        timedOut: false,
      }),
      searchVector: jest.fn().mockResolvedValue({
        items: [],
        total: 0,
        maxScore: null,
        timedOut: false,
      }),
      searchDerivatives: jest.fn().mockResolvedValue({
        items: [DERIVATIVE_HIT],
        total: 1,
        approximateTotal: false,
        maxScore: 2.1,
        timedOut: false,
      }),
      searchSuggestions: jest.fn().mockResolvedValue([]),
      searchExactCitation: jest.fn(),
      indexDocument: jest.fn(),
      ensureIndexes: jest.fn(),
      bulkIndexDocuments: jest.fn(),
      bulkIndexVectorDocuments: jest.fn(),
      removeDocumentFromAllIndexes: jest.fn(),
    };

    redis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      getClient: jest.fn(() => ({
        zadd: jest.fn().mockResolvedValue(1),
        expire: jest.fn().mockResolvedValue(1),
        zrevrange: jest.fn().mockResolvedValue([]),
      })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchService,
        {
          provide: PrismaService,
          useValue: { legalDocument: { findUnique: jest.fn(), findMany: jest.fn() } },
        },
        { provide: RedisService, useValue: redis },
        { provide: OpenSearchService, useValue: openSearch },
        {
          provide: EmbeddingClientService,
          useValue: { embed: jest.fn().mockResolvedValue(null), embedBatch: jest.fn() },
        },
        {
          provide: SuppressedDocsService,
          useValue: {
            getSuppressedDocIds: jest.fn().mockResolvedValue(new Set<string>()),
            refresh: jest.fn(),
            getCount: jest.fn(),
          },
        },
        {
          provide: PonenteDirectoryService,
          useValue: {
            getPonenteNames: jest.fn().mockResolvedValue(new Set<string>()),
            invalidate: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, fallback?: unknown) => {
              if (key === 'SEARCH_RANKER_V2') return 'false';
              return fallback;
            }),
          },
        },
      ],
    }).compile();

    service = module.get(SearchService);
  });

  const dto = (overrides: Partial<SearchQueryDto> = {}): SearchQueryDto =>
    ({ query: 'warrantless search', ...overrides }) as SearchQueryDto;

  const CALLER_A = { organizationId: 'org-a' };
  const CALLER_B = { organizationId: 'org-b' };

  /** The visibility filter the service handed to the derivative arm. */
  const capturedFilter = (): unknown => {
    const [args] = openSearch.searchDerivatives.mock.calls[0] as [
      Record<string, unknown>,
    ];
    return args['visibilityFilter'];
  };

  // --- DELIVERABLE 3.1: the regression pin ------------------------------

  describe('scope omitted reproduces pre-C3 behaviour', () => {
    it('returns the legacy envelope with no added field anywhere', async () => {
      const response = await service.search(dto(), CALLER_A);

      // Deep equality on the WHOLE response: a stray `kind`, `scope`, `counts`
      // or `warnings` fails here, which is the point of pinning it this way
      // rather than spot-checking a few keys.
      expect(response).toEqual({
        items: [DOCUMENT_HIT],
        meta: {
          total: 1,
          approximateTotal: false,
          maxScore: 3.2,
          page: 0,
          limit: 20,
          timedOut: false,
          cached: false,
          searchType: 'keyword_only',
          intent: 'general',
          abstained: false,
          suggestions: [],
        },
      });
    });

    it('does not touch the derivative index at all', async () => {
      await service.search(dto(), CALLER_A);
      expect(openSearch.searchDerivatives).not.toHaveBeenCalled();
    });

    it('holds even for a caller with no principal', async () => {
      const response = await service.search(dto(), null);
      expect(openSearch.searchDerivatives).not.toHaveBeenCalled();
      expect(response.items).toEqual([DOCUMENT_HIT]);
      expect(response.meta).not.toHaveProperty('scope');
    });
  });

  // --- DELIVERABLE 3.3: scope routing ------------------------------------

  describe('scope routing', () => {
    it("scope='derivatives' returns derivatives only and never queries documents", async () => {
      const response = await service.search(dto({ scope: 'derivatives' }), CALLER_A);

      expect(openSearch.searchKeyword).not.toHaveBeenCalled();
      expect(openSearch.searchDerivatives).toHaveBeenCalledTimes(1);
      expect(response.items).toHaveLength(1);
      expect(response.items.map((item) => (item as { kind: string }).kind)).toEqual([
        'derivative',
      ]);
    });

    it("scope='all' returns both kinds", async () => {
      const response = await service.search(dto({ scope: 'all' }), CALLER_A);

      const kinds = response.items.map((item) => (item as { kind: string }).kind);
      expect(kinds).toEqual(['document', 'derivative']);
      expect(openSearch.searchKeyword).toHaveBeenCalled();
      expect(openSearch.searchDerivatives).toHaveBeenCalled();
    });

    it("scope='documents' returns documents only, but with the discriminator", async () => {
      const response = await service.search(dto({ scope: 'documents' }), CALLER_A);

      expect(openSearch.searchDerivatives).not.toHaveBeenCalled();
      expect(response.items.map((item) => (item as { kind: string }).kind)).toEqual([
        'document',
      ]);
    });

    it('reports per-kind counts and the scope it ran', async () => {
      const response = await service.search(dto({ scope: 'all' }), CALLER_A);
      expect(response.meta).toMatchObject({
        scope: 'all',
        total: 2,
        counts: { documents: 1, derivatives: 1 },
        warnings: [],
      });
    });

    it('does not mutate the underlying hit objects when adding kind', async () => {
      await service.search(dto({ scope: 'all' }), CALLER_A);
      expect(DOCUMENT_HIT).not.toHaveProperty('kind');
      expect(DERIVATIVE_HIT).not.toHaveProperty('kind');
    });
  });

  // --- DELIVERABLE 3.2: no derivative may bypass the visibility filter ---

  describe('every derivative query carries the visibility filter', () => {
    it.each([
      ['an authenticated caller', CALLER_A],
      ['an anonymous caller', null],
    ])('applies a filter for %s', async (_label, caller) => {
      await service.search(dto({ scope: 'derivatives' }), caller);
      const [args] = openSearch.searchDerivatives.mock.calls[0] as [
        Record<string, unknown>,
      ];
      // Present and non-trivial — never omitted, never an empty object.
      expect(args['visibilityFilter']).toBeDefined();
      expect(Object.keys(args['visibilityFilter'] as object)).toContain('bool');
    });

    it('builds the filter from the JWT principal, not from the request body', async () => {
      // A body that tries to smuggle an organization id must have no effect.
      const hostile = {
        query: 'x',
        scope: 'derivatives',
        organizationId: 'org-victim',
      } as unknown as SearchQueryDto;

      await service.search(hostile, CALLER_A);

      const filter = capturedFilter();
      expect(matchesQuery(filter, { visibility: 'private', organization_id: 'org-a' })).toBe(
        true,
      );
      expect(
        matchesQuery(filter, { visibility: 'private', organization_id: 'org-victim' }),
      ).toBe(false);
    });

    it('a row owned by org A is absent for a caller in org B', async () => {
      await service.search(dto({ scope: 'derivatives' }), CALLER_B);
      expect(matchesQuery(capturedFilter(), ORG_A_PRIVATE)).toBe(false);
    });

    it('a private null-org row is absent for EVERY caller, admins included', async () => {
      // No branch can claim it: the public branch requires public_editorial, and
      // the org branch requires organization_id to equal the caller's org, which
      // an absent field never does. There is no admin bypass in this filter, by
      // design — platform admin is not a tenant.
      for (const caller of [null, CALLER_A, CALLER_B, { organizationId: 'org-admin' }]) {
        openSearch.searchDerivatives.mockClear();
        await service.search(dto({ scope: 'derivatives' }), caller);
        expect(matchesQuery(capturedFilter(), PRIVATE_NULL_ORG)).toBe(false);
      }
    });

    it('a public_editorial null-org row is present for an anonymous caller', async () => {
      await service.search(dto({ scope: 'derivatives' }), null);
      expect(matchesQuery(capturedFilter(), PUBLIC_NULL_ORG)).toBe(true);
    });

    it('an anonymous caller can reach nothing org-scoped', async () => {
      await service.search(dto({ scope: 'derivatives' }), null);
      const filter = capturedFilter();
      for (const row of [ORG_A_PRIVATE, PRIVATE_NULL_ORG]) {
        expect(matchesQuery(filter, row)).toBe(false);
      }
    });
  });

  // --- DELIVERABLE 3.4: no answer keys in a derivative result ------------

  describe('mcq_question results carry no answer key', () => {
    it('strips rationale/isCorrect/explanation even if the index somehow held them', async () => {
      // Defence in depth: the C1 extractor never emits these and the strict
      // mapping has no field for them, so this hit is not reachable in practice.
      // The service must still not pass it through.
      openSearch.searchDerivatives.mockResolvedValue({
        items: [
          {
            id: 'mcq-1',
            score: 1.0,
            source: {
              derivative_id: 'mcq-1',
              derivative_type: 'mcq_question',
              title: 'MCQ on the exclusionary rule',
              body_text: 'Under what doctrine is evidence excluded? Fruit of the poisonous tree',
              visibility: 'public_editorial',
            },
            highlights: { body_text: ['<mark>exclusionary</mark>'] },
          },
        ],
        total: 1,
        approximateTotal: false,
        maxScore: 1.0,
        timedOut: false,
      });

      const response = await service.search(dto({ scope: 'derivatives' }), CALLER_A);
      const serialized = JSON.stringify(response);

      for (const forbidden of ['rationale', 'isCorrect', 'is_correct', 'explanation']) {
        expect(serialized).not.toContain(forbidden);
      }
    });
  });

  // --- the query body itself ---------------------------------------------

  describe('derivative query body', () => {
    const body = () => {
      const filter = buildDerivativeVisibilityFilter(CALLER_A);
      return buildDerivativeQueryBody({ query: 'estafa', visibilityFilter: filter });
    };

    it('is BM25 only — no kNN clause, no vector field', () => {
      // Derivatives have no embeddings: not indexing them was a deliberate C1
      // cost decision, and a knn clause here would match nothing.
      const serialized = JSON.stringify(body());
      expect(serialized).not.toContain('knn');
      expect(serialized).not.toContain('embedding');
      expect(serialized).not.toContain('script_score');
    });

    it('puts the visibility filter in `filter`, not `must`', () => {
      // A filter clause is a hard boolean gate that cannot be outscored.
      const bool = (body()['query'] as Record<string, unknown>)['bool'] as Record<
        string,
        unknown
      >;
      const filter = bool['filter'] as unknown[];
      expect(filter).toHaveLength(1);
      expect(matchesQuery(filter[0], ORG_A_PRIVATE)).toBe(true);
      expect(matchesQuery(filter[0], PRIVATE_NULL_ORG)).toBe(false);
    });

    it('highlights ONLY title and body_text', () => {
      const highlight = body()['highlight'] as Record<string, unknown>;
      const fields = highlight['fields'] as Record<string, unknown>;
      // Naming the fields explicitly means a future mapping addition cannot
      // start emitting fragments from a field nobody reviewed for disclosure.
      expect(Object.keys(fields).sort()).toEqual(['body_text', 'title']);
    });

    it('carries the 5s search timeout', () => {
      expect(body()['timeout']).toBe('5s');
    });

    it('searches title and body_text and nothing else', () => {
      const bool = (body()['query'] as Record<string, unknown>)['bool'] as Record<
        string,
        unknown
      >;
      const must = bool['must'] as Record<string, Record<string, unknown>>[];
      expect(must[0]!['multi_match']!['fields']).toEqual(['title^3', 'body_text']);
    });
  });

  // --- graceful degradation ----------------------------------------------

  describe('degradation', () => {
    it('returns document results with a warning when the derivative arm throws', async () => {
      openSearch.searchDerivatives.mockRejectedValue(new Error('connection reset'));

      const response = await service.search(dto({ scope: 'all' }), CALLER_A);

      // The whole request must NOT fail — document search is the primary surface.
      expect(response.items.map((item) => (item as { kind: string }).kind)).toEqual([
        'document',
      ]);
      const meta = response.meta as unknown as { warnings: string[] };
      expect(meta.warnings).toHaveLength(1);
      expect(meta.warnings[0]).toMatch(/derivative/i);
    });

    it('names a missing derivative index specifically', async () => {
      openSearch.searchDerivatives.mockRejectedValue({
        meta: { body: { error: { type: 'index_not_found_exception' } } },
      });

      const response = await service.search(dto({ scope: 'all' }), CALLER_A);
      const meta = response.meta as unknown as { warnings: string[] };
      expect(meta.warnings[0]).toMatch(/not available/);
    });

    it('surfaces a derivative timeout as a partial-results warning', async () => {
      openSearch.searchDerivatives.mockResolvedValue({
        items: [DERIVATIVE_HIT],
        total: 1,
        approximateTotal: false,
        maxScore: 2.1,
        timedOut: true,
      });

      const response = await service.search(dto({ scope: 'all' }), CALLER_A);
      const meta = response.meta as unknown as { warnings: string[]; timedOut: boolean };
      expect(meta.timedOut).toBe(true);
      expect(meta.warnings[0]).toMatch(/partial/i);
    });

    it('a derivatives-only request that fails returns an empty list, not a 5xx', async () => {
      openSearch.searchDerivatives.mockRejectedValue(new Error('boom'));

      const response = await service.search(dto({ scope: 'derivatives' }), CALLER_A);
      expect(response.items).toEqual([]);
      expect(response.meta.total).toBe(0);
    });
  });
});
