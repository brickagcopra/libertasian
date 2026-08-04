import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/services/redis.service';
import { EmbeddingClientService } from './embedding-client.service';
import { OpenSearchService } from './opensearch.service';
import { PonenteDirectoryService } from './ponente-directory.service';
import { SearchService } from './search.service';
import { SuppressedDocsService } from './suppressed-docs.service';
import { buildCaseDigestQueryBody } from './query-builder';
import { SearchQueryDto } from './dto';

/**
 * The case-digests corpus.
 *
 * All 16,995 rows of the `digests` table were in NO index: `derivative_artifacts`
 * holds zero `case_digest` rows, so the derivatives index never covered them, and
 * the only text search over digests (`GET /digests/search`) is
 * `title ILIKE '%q%'` against titles shaped `"Digest: <CASE CAPTION>"` — which
 * returns 0 for `estafa`, `negligence`, `rape` and `bigamy`.
 *
 * The authorization model here differs from the derivatives corpus and the
 * difference is the point. Derivatives are multi-tenant, so every query must
 * carry a visibility filter. Case digests are single-tenant BY CONSTRUCTION: the
 * indexer writes only `visibility = 'public_editorial'` rows and the mapping has
 * no field for a tenant identifier. The boundary is therefore enforced once, at
 * write time, instead of at every call site.
 */

const DOCUMENT_HIT = {
  id: 'doc-1',
  score: 3.2,
  source: { document_id: 'doc-1', title: 'People v. Santos' },
};

const CASE_DIGEST_HIT = {
  id: 'dig-1',
  score: 1.8,
  source: {
    digest_id: 'dig-1',
    digest_type: 'case_digest',
    title: 'Digest: PEOPLE v. SANTOS',
    doctrine: 'Estafa requires abuse of confidence and resulting damage.',
    visibility: 'public_editorial',
    review_status: 'needs_human_review',
  },
  highlights: { doctrine: ['<mark>Estafa</mark> requires'] },
};

describe('case digest search corpus', () => {
  let service: SearchService;
  let openSearch: {
    searchKeyword: jest.Mock;
    searchVector: jest.Mock;
    searchDerivatives: jest.Mock;
    searchCaseDigests: jest.Mock;
    searchSuggestions: jest.Mock;
    searchExactCitation: jest.Mock;
    indexDocument: jest.Mock;
    ensureIndexes: jest.Mock;
    bulkIndexDocuments: jest.Mock;
    bulkIndexVectorDocuments: jest.Mock;
    removeDocumentFromAllIndexes: jest.Mock;
  };

  const dto = (overrides: Partial<SearchQueryDto> = {}): SearchQueryDto =>
    ({ query: 'estafa', ...overrides }) as SearchQueryDto;

  beforeEach(async () => {
    openSearch = {
      searchKeyword: jest.fn().mockResolvedValue({
        items: [DOCUMENT_HIT],
        total: 1,
        approximateTotal: false,
        maxScore: 3.2,
        timedOut: false,
      }),
      searchVector: jest
        .fn()
        .mockResolvedValue({ items: [], total: 0, maxScore: null, timedOut: false }),
      searchDerivatives: jest.fn().mockResolvedValue({
        items: [],
        total: 0,
        approximateTotal: false,
        maxScore: null,
        timedOut: false,
      }),
      searchCaseDigests: jest.fn().mockResolvedValue({
        items: [CASE_DIGEST_HIT],
        total: 1,
        approximateTotal: false,
        maxScore: 1.8,
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchService,
        { provide: OpenSearchService, useValue: openSearch },
        {
          provide: PrismaService,
          useValue: { legalDocument: { findUnique: jest.fn(), findMany: jest.fn() } },
        },
        {
          provide: RedisService,
          useValue: {
            get: jest.fn().mockResolvedValue(null),
            set: jest.fn().mockResolvedValue(undefined),
            getClient: jest.fn(() => ({
              zadd: jest.fn().mockResolvedValue(1),
              expire: jest.fn().mockResolvedValue(1),
              zrevrange: jest.fn().mockResolvedValue([]),
            })),
          },
        },
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
          provide: ConfigService,
          useValue: { get: jest.fn((_key: string, fallback?: unknown) => fallback) },
        },
        {
          provide: PonenteDirectoryService,
          useValue: {
            getPonenteNames: jest.fn().mockResolvedValue(new Set<string>()),
            invalidate: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(SearchService);
  });

  // --- scope routing -------------------------------------------------------

  describe('scope routing', () => {
    it("scope='digests' queries the case-digests index only", async () => {
      const response = await service.search(dto({ scope: 'digests' }), null);

      expect(openSearch.searchCaseDigests).toHaveBeenCalledTimes(1);
      expect(openSearch.searchDerivatives).not.toHaveBeenCalled();
      expect(response.items.map((item) => (item as { kind: string }).kind)).toEqual([
        'digest',
      ]);
    });

    it("scope='documents' does not touch the digest index", async () => {
      await service.search(dto({ scope: 'documents' }), null);
      expect(openSearch.searchCaseDigests).not.toHaveBeenCalled();
    });

    it("scope='derivatives' does not touch the digest index", async () => {
      await service.search(dto({ scope: 'derivatives' }), null);
      expect(openSearch.searchCaseDigests).not.toHaveBeenCalled();
    });

    // Concatenation order is part of the contract: documents, derivatives,
    // then digests. The lists are not globally ranked — BM25 scores from
    // indices with different mappings and term statistics are not comparable.
    it("scope='all' appends digests after documents and derivatives", async () => {
      openSearch.searchDerivatives.mockResolvedValue({
        items: [{ id: 'der-1', score: 2.1, source: { derivative_id: 'der-1' } }],
        total: 1,
        approximateTotal: false,
        maxScore: 2.1,
        timedOut: false,
      });

      const response = await service.search(dto({ scope: 'all' }), null);

      expect(response.items.map((item) => (item as { kind: string }).kind)).toEqual([
        'document',
        'derivative',
        'digest',
      ]);
    });

    it('populates meta.counts.digests', async () => {
      openSearch.searchCaseDigests.mockResolvedValue({
        items: [CASE_DIGEST_HIT],
        total: 3_359,
        approximateTotal: false,
        maxScore: 1.8,
        timedOut: false,
      });

      const response = await service.search(dto({ scope: 'digests' }), null);
      const meta = response.meta as unknown as {
        counts: { documents: number; derivatives: number; digests: number };
        scope: string;
      };

      expect(meta.scope).toBe('digests');
      expect(meta.counts.digests).toBe(3_359);
      expect(response.meta.total).toBe(3_359);
    });

    // The legacy contract: an omitted `scope` must return the byte-for-byte
    // pre-C3 array shape, with no `kind` key and no federated meta.
    it('an omitted scope never queries digests and adds no kind key', async () => {
      const response = await service.search(dto(), null);

      expect(openSearch.searchCaseDigests).not.toHaveBeenCalled();
      for (const item of response.items) {
        expect(item).not.toHaveProperty('kind');
      }
      expect(response.meta).not.toHaveProperty('scope');
      expect(response.meta).not.toHaveProperty('counts');
    });
  });

  // --- per-corpus limit semantics -----------------------------------------

  describe('paging', () => {
    it('passes the per-corpus limit and offset through unchanged', async () => {
      await service.search(dto({ scope: 'digests', limit: 20, page: 2 }), null);

      const [args] = openSearch.searchCaseDigests.mock.calls[0] as [
        Record<string, unknown>,
      ];
      expect(args['size']).toBe(20);
      expect(args['from']).toBe(40);
      expect(args['query']).toBe('estafa');
    });
  });

  // --- degradation ---------------------------------------------------------

  describe('degradation', () => {
    // The digests index does not exist until the rebuild job has run once on
    // prod, so this is the state the very first deploy is in.
    it('names a missing digest index specifically and still returns documents', async () => {
      openSearch.searchCaseDigests.mockRejectedValue({
        meta: { body: { error: { type: 'index_not_found_exception' } } },
      });

      const response = await service.search(dto({ scope: 'all' }), null);
      const meta = response.meta as unknown as { warnings: string[] };

      expect(response.items.map((item) => (item as { kind: string }).kind)).toEqual([
        'document',
      ]);
      expect(meta.warnings.some((w) => /not available/.test(w))).toBe(true);
    });

    it('a digests-only request that fails returns an empty list, not a 5xx', async () => {
      openSearch.searchCaseDigests.mockRejectedValue(new Error('boom'));

      const response = await service.search(dto({ scope: 'digests' }), null);
      expect(response.items).toEqual([]);
      expect(response.meta.total).toBe(0);
    });

    it('surfaces a digest timeout as a partial-results warning', async () => {
      openSearch.searchCaseDigests.mockResolvedValue({
        items: [CASE_DIGEST_HIT],
        total: 1,
        approximateTotal: false,
        maxScore: 1.8,
        timedOut: true,
      });

      const response = await service.search(dto({ scope: 'digests' }), null);
      const meta = response.meta as unknown as { warnings: string[]; timedOut: boolean };
      expect(meta.timedOut).toBe(true);
      expect(meta.warnings[0]).toMatch(/partial/i);
    });

    it('does not abstain when the digest arm found hits', async () => {
      openSearch.searchKeyword.mockResolvedValue({
        items: [],
        total: 0,
        approximateTotal: false,
        maxScore: null,
        timedOut: false,
      });

      const response = await service.search(dto({ scope: 'all' }), null);
      expect(response.meta.abstained).toBe(false);
    });
  });

  // --- the query body ------------------------------------------------------

  describe('buildCaseDigestQueryBody', () => {
    const body = () => buildCaseDigestQueryBody({ query: 'estafa' });

    // BM25 only. The index carries no knn_vector field — not embedding the
    // corpus was a deliberate cost decision — so a kNN clause would match
    // nothing at all.
    it('contains no kNN, embedding or script_score clause', () => {
      const serialized = JSON.stringify(body());
      expect(serialized).not.toContain('knn');
      expect(serialized).not.toContain('embedding');
      expect(serialized).not.toContain('script_score');
    });

    // The prose fields are the whole reason this index exists: a title-only
    // search is what `title ILIKE '%q%'` already was.
    it('searches the prose fields, not just the title', () => {
      const query = body()['query'] as Record<string, Record<string, unknown>>;
      const must = query['bool']!['must'] as Record<string, Record<string, unknown>>[];
      const fields = must[0]!['multi_match']!['fields'] as string[];

      expect(fields).toContain('title^3');
      for (const field of ['doctrine^2', 'ruling^2', 'summary^1.5', 'issues', 'facts']) {
        expect(fields).toContain(field);
      }
    });

    it('highlights only fields the mapping declares', () => {
      const highlight = body()['highlight'] as Record<string, Record<string, unknown>>;
      const fields = Object.keys(highlight['fields']!);
      expect(fields).toEqual(['title', 'summary', 'doctrine', 'ruling', 'issues', 'facts']);
    });

    it('caps the query at 5s like every other arm', () => {
      expect(body()['timeout']).toBe('5s');
    });

    it('defaults paging and honours explicit paging', () => {
      expect(body()['from']).toBe(0);
      expect(body()['size']).toBe(20);

      const paged = buildCaseDigestQueryBody({ query: 'estafa', from: 40, size: 10 });
      expect(paged['from']).toBe(40);
      expect(paged['size']).toBe(10);
    });

    // Nothing to filter down to: the index holds only public_editorial rows and
    // has no tenant field. A filter clause here would imply a boundary this
    // index does not have — the real one is enforced at write time.
    it('carries no visibility or tenant filter clause', () => {
      const query = body()['query'] as Record<string, Record<string, unknown>>;
      expect(query['bool']!['filter']).toBeUndefined();
      const serialized = JSON.stringify(body());
      expect(serialized).not.toContain('organization_id');
      expect(serialized).not.toContain('user_id');
    });
  });
});
