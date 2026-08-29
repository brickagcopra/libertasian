import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { SearchService } from './search.service';
import {
  FREE_DOCUMENT_TYPES,
  isFreeDocumentType,
} from '../documents/documents.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/services/redis.service';
import { OpenSearchService, type SearchResultItem } from './opensearch.service';
import { EmbeddingClientService } from './embedding-client.service';
import { SuppressedDocsService } from './suppressed-docs.service';
import { PonenteDirectoryService } from './ponente-directory.service';
import { SearchQueryDto } from './dto';

type MockPrismaService = {
  legalDocument: {
    findUnique: jest.Mock;
    findMany: jest.Mock;
  };
};

type MockRedisService = {
  get: jest.Mock;
  set: jest.Mock;
  getClient: jest.Mock;
};

type MockOpenSearchService = {
  searchKeyword: jest.Mock;
  searchVector: jest.Mock;
  searchExactCitation: jest.Mock;
  searchSuggestions: jest.Mock;
  indexDocument: jest.Mock;
  ensureIndexes: jest.Mock;
  bulkIndexVectorDocuments: jest.Mock;
  removeDocumentFromAllIndexes: jest.Mock;
  bulkIndexDocuments: jest.Mock;
  getZeroResultQueries?: jest.Mock;
};

type MockEmbeddingClientService = {
  embed: jest.Mock;
  embedBatch: jest.Mock;
};

type MockSuppressedDocsService = {
  getSuppressedDocIds: jest.Mock;
  refresh: jest.Mock;
  getCount: jest.Mock;
};

describe('SearchService', () => {
  let service: SearchService;
  let prismaService: MockPrismaService;
  let redisService: MockRedisService;
  let openSearchService: MockOpenSearchService;
  let embeddingClientService: MockEmbeddingClientService;
  let suppressedDocsService: MockSuppressedDocsService;
  /**
   * The pre-existing suite documents v1 (legacy) behaviour: JS-side dedup,
   * over-fetch then slice. Keeping SEARCH_RANKER_V2='false' here is the
   * B8 requirement made executable — every one of these assertions is proof
   * the legacy builder still behaves exactly as it did before Phase B.
   * The v2 path has its own describe block at the bottom of this file.
   */
  let rankerV2: string;

  const mockSearchResultItem: SearchResultItem = {
    id: 'doc-1',
    score: 1.0,
    source: {
      document_id: 'doc-1',
      title: 'Sample Legal Document',
      citation_text: 'G.R. No. 123456',
      document_type: 'decision',
      court: 'Supreme Court',
    },
    highlights: {
      plain_text: ['sample <em>highlight</em>'],
    },
  };

  const mockBm25Result = {
    items: [mockSearchResultItem],
    total: 1,
    maxScore: 1.0,
    timedOut: false,
  };

  const mockKnnResult = {
    items: [
      {
        id: 'doc-2',
        score: 0.95,
        source: {
          document_id: 'doc-2',
          title: 'Another Legal Document',
        },
      },
    ],
    total: 1,
    maxScore: 0.95,
    timedOut: false,
  };

  beforeEach(async () => {
    rankerV2 = 'false';
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchService,
        {
          provide: PrismaService,
          useValue: {
            legalDocument: {
              findUnique: jest.fn(),
              findMany: jest.fn(),
            },
          },
        },
        {
          provide: RedisService,
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
            getClient: jest.fn(() => ({
              zadd: jest.fn().mockResolvedValue(1),
              expire: jest.fn().mockResolvedValue(1),
              zrevrange: jest.fn().mockResolvedValue([]),
            })),
          },
        },
        {
          provide: OpenSearchService,
          useValue: {
            searchKeyword: jest.fn(),
            searchVector: jest.fn(),
            searchExactCitation: jest.fn(),
            searchSuggestions: jest.fn(),
            indexDocument: jest.fn(),
            ensureIndexes: jest.fn(),
            bulkIndexVectorDocuments: jest.fn(),
            removeDocumentFromAllIndexes: jest.fn(),
            bulkIndexDocuments: jest.fn(),
          },
        },
        {
          provide: EmbeddingClientService,
          useValue: {
            embed: jest.fn(),
            embedBatch: jest.fn(),
          },
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
            get: jest.fn((key: string, defaultValue?: unknown) => {
              if (key === 'SEARCH_RANKER_V2') return rankerV2;
              return defaultValue;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<SearchService>(SearchService);
    prismaService = module.get(PrismaService) as unknown as MockPrismaService;
    redisService = module.get(RedisService) as unknown as MockRedisService;
    openSearchService = module.get(OpenSearchService) as unknown as MockOpenSearchService;
    embeddingClientService = module.get(EmbeddingClientService) as unknown as MockEmbeddingClientService;
    suppressedDocsService = module.get(
      SuppressedDocsService,
    ) as unknown as MockSuppressedDocsService;

    // Abstention path calls searchSuggestions; default it to an empty list so
    // every test does not have to stub it.
    openSearchService.searchSuggestions.mockResolvedValue([]);
    // The cache write is fire-and-forget (`.catch(...)`), so the mock must
    // return a promise or every non-cached path throws.
    redisService.set.mockResolvedValue(undefined);

    // Suppress logger output during tests
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('search', () => {
    const searchDto: SearchQueryDto = {
      query: 'test query',
      page: 0,
      limit: 20,
    };

    it('should return cached results when available', async () => {
      const cachedResult = {
        items: [mockSearchResultItem],
        meta: {
          total: 1,
          maxScore: 1.0,
          page: 0,
          limit: 20,
          timedOut: false,
          cached: false,
          searchType: 'hybrid',
        },
      };

      redisService.get.mockResolvedValue(JSON.stringify(cachedResult));

      const result = await service.search(searchDto);

      expect(result.items).toEqual(cachedResult.items);
      expect(result.meta.cached).toBe(true);
      expect(redisService.get).toHaveBeenCalledTimes(1);
      expect(openSearchService.searchKeyword).not.toHaveBeenCalled();
      expect(embeddingClientService.embed).not.toHaveBeenCalled();
    });

    it('should perform hybrid search and cache results when cache miss', async () => {
      redisService.get.mockResolvedValue(null);
      openSearchService.searchKeyword.mockResolvedValue(mockBm25Result);
      embeddingClientService.embed.mockResolvedValue([0.1, 0.2, 0.3]);
      openSearchService.searchVector.mockResolvedValue(mockKnnResult);
      redisService.set.mockResolvedValue(undefined);

      const result = await service.search(searchDto);

      expect(result.items).toBeDefined();
      expect(result.meta.cached).toBe(false);
      expect(result.meta.searchType).toBe('hybrid');
      expect(redisService.get).toHaveBeenCalledTimes(1);
      expect(openSearchService.searchKeyword).toHaveBeenCalledWith({
        query: 'test query',
        filters: {
          documentType: undefined,
          court: undefined,
          ponente: undefined,
          sourceId: undefined,
          grNo: undefined,
          dateFrom: undefined,
          dateTo: undefined,
          publishedOnly: undefined,
        },
        excludeDocumentIds: [],
        from: 0,
        size: 60,
      });
      expect(embeddingClientService.embed).toHaveBeenCalledWith('test query');
      expect(openSearchService.searchVector).toHaveBeenCalledWith({
        vector: [0.1, 0.2, 0.3],
        filters: {
          documentType: undefined,
          court: undefined,
          publishedOnly: undefined,
        },
        excludeDocumentIds: [],
        k: 60,
      });
      expect(redisService.set).toHaveBeenCalledWith(
        expect.stringContaining('cache:search:'),
        expect.any(String),
        300,
      );
    });

    it('should fall back to BM25-only when embedding service returns null', async () => {
      redisService.get.mockResolvedValue(null);
      openSearchService.searchKeyword.mockResolvedValue(mockBm25Result);
      embeddingClientService.embed.mockResolvedValue(null);
      redisService.set.mockResolvedValue(undefined);

      const result = await service.search(searchDto);

      expect(result.items).toEqual(mockBm25Result.items);
      expect(result.meta.searchType).toBe('keyword_only');
      expect(result.meta.cached).toBe(false);
      expect(openSearchService.searchKeyword).toHaveBeenCalledTimes(1);
      expect(embeddingClientService.embed).toHaveBeenCalledWith('test query');
      expect(openSearchService.searchVector).not.toHaveBeenCalled();
    });

    it('should fall back to BM25-only when kNN search fails', async () => {
      redisService.get.mockResolvedValue(null);
      openSearchService.searchKeyword.mockResolvedValue(mockBm25Result);
      embeddingClientService.embed.mockResolvedValue([0.1, 0.2, 0.3]);
      openSearchService.searchVector.mockRejectedValue(new Error('kNN failed'));
      redisService.set.mockResolvedValue(undefined);

      const result = await service.search(searchDto);

      expect(result.items).toEqual(mockBm25Result.items);
      expect(result.meta.searchType).toBe('keyword_only');
      expect(openSearchService.searchKeyword).toHaveBeenCalledTimes(1);
      expect(openSearchService.searchVector).toHaveBeenCalledTimes(1);
    });

    it('should apply pagination to search results', async () => {
      const manyItems: SearchResultItem[] = Array.from({ length: 100 }, (_, i) => ({
        id: `doc-${i}`,
        score: 1.0 - i * 0.01,
        source: { document_id: `doc-${i}`, title: `Document ${i}` },
      }));

      const paginatedDto: SearchQueryDto = {
        query: 'test',
        page: 2,
        limit: 10,
      };

      redisService.get.mockResolvedValue(null);
      openSearchService.searchKeyword.mockResolvedValue({
        items: manyItems,
        total: 100,
        maxScore: 1.0,
        timedOut: false,
      });
      embeddingClientService.embed.mockResolvedValue(null);
      redisService.set.mockResolvedValue(undefined);

      const result = await service.search(paginatedDto);

      expect(result.items).toHaveLength(10);
      expect((result.items[0] as SearchResultItem)?.id).toBe('doc-20');
      expect(result.meta.page).toBe(2);
      expect(result.meta.limit).toBe(10);
    });

    // E3b (security-investigation.md): index_not_found_exception from
    // OpenSearch should return an empty result envelope (not a 500).
    it('should return empty envelope on index_not_found_exception (E3b)', async () => {
      redisService.get.mockResolvedValue(null);

      const indexNotFoundError = {
        meta: {
          body: {
            error: { type: 'index_not_found_exception', reason: 'no such index [legal_keyword]' },
            status: 404,
          },
        },
        message: 'index_not_found_exception',
      };
      openSearchService.searchKeyword.mockRejectedValue(indexNotFoundError);
      embeddingClientService.embed.mockResolvedValue(null);

      const result = await service.search(searchDto);

      expect(result.items).toEqual([]);
      expect(result.meta.total).toBe(0);
      expect(result.meta.cached).toBe(false);
      expect(result.meta.searchType).toBe('keyword_only');
    });

    // The alias swap in POST /search/index/rebuild deletes the legacy concrete
    // index and adds the alias in one updateAliases call, but a request already
    // in flight can still land in the gap. That degrades to an empty envelope,
    // never a 500 — this asserts the guarantee the rebuild job relies on.
    it('degrades gracefully during the rebuild alias-swap window', async () => {
      redisService.get.mockResolvedValue(null);
      openSearchService.searchKeyword.mockRejectedValue({
        meta: {
          body: {
            error: {
              type: 'index_not_found_exception',
              reason: 'no such index [legal_documents_keyword]',
            },
            status: 404,
          },
        },
        message: 'index_not_found_exception',
      });
      embeddingClientService.embed.mockResolvedValue([0.1, 0.2, 0.3]);
      openSearchService.searchVector.mockResolvedValue({ items: [], timedOut: false });

      const result = await service.search(searchDto);

      expect(result.items).toEqual([]);
      expect(result.meta.total).toBe(0);
    });

    // E3b: any other OpenSearch failure should throw 503 with a
    // generic message (no upstream details leaked).
    it('should throw ServiceUnavailableException on generic OpenSearch error (E3b)', async () => {
      redisService.get.mockResolvedValue(null);
      openSearchService.searchKeyword.mockRejectedValue(new Error('connection refused'));
      embeddingClientService.embed.mockResolvedValue(null);

      await expect(service.search(searchDto)).rejects.toThrow(ServiceUnavailableException);
      await expect(service.search(searchDto)).rejects.toThrow('Search temporarily unavailable');
    });

    // Two sections from the same document MUST collapse into one result
    // after RRF fusion. Without dedup the user sees the same case repeated
    // (each row a different section) which was the bug.
    it('dedupes per-document so two sections of the same document collapse', async () => {
      const docId = 'shared-doc-1';
      const sectionA: SearchResultItem = {
        id: 'section-a',
        score: 0.9,
        source: { document_id: docId, title: 'Negligence Case' },
        highlights: { plain_text: ['<em>negligence</em>'] },
      };
      const sectionB: SearchResultItem = {
        id: 'section-b',
        score: 0.8,
        source: { document_id: docId, title: 'Negligence Case' },
      };

      redisService.get.mockResolvedValue(null);
      openSearchService.searchKeyword.mockResolvedValue({
        items: [sectionA, sectionB],
        total: 2,
        maxScore: 0.9,
        timedOut: false,
      });
      embeddingClientService.embed.mockResolvedValue([0.1, 0.2, 0.3]);
      openSearchService.searchVector.mockResolvedValue({
        items: [sectionB, sectionA],
        total: 2,
        maxScore: 0.85,
        timedOut: false,
      });
      redisService.set.mockResolvedValue(undefined);

      const result = await service.search(searchDto);

      expect(result.items).toHaveLength(1);
      const item = result.items[0] as SearchResultItem;
      expect(item.source['document_id']).toBe(docId);
      // The kept section is the one whose fused RRF score is higher.
      expect(['section-a', 'section-b']).toContain(item.id);
    });

    // Regression: the keyword_only fallback (embedding null) must de-dup
    // per document like the RRF path. 3 sections of one doc + 1 distinct doc
    // → 2 results, total 2.
    it('dedupes the keyword_only fallback so duplicate-document sections collapse', async () => {
      const docId = 'kw-doc-1';
      const section = (id: string): SearchResultItem => ({
        id,
        score: 1,
        source: { document_id: docId, title: 'Theft Case' },
      });
      const distinct: SearchResultItem = {
        id: 'other-section',
        score: 0.5,
        source: { document_id: 'kw-doc-2', title: 'Other Case' },
      };

      redisService.get.mockResolvedValue(null);
      redisService.set.mockResolvedValue(undefined);
      openSearchService.searchKeyword.mockResolvedValue({
        items: [section('sec-1'), section('sec-2'), section('sec-3'), distinct],
        total: 4,
        maxScore: 1,
        timedOut: false,
      });
      embeddingClientService.embed.mockResolvedValue(null); // forces keyword_only

      const result = await service.search(searchDto);

      expect(result.meta.searchType).toBe('keyword_only');
      expect(result.items).toHaveLength(2);
      expect(result.meta.total).toBe(2);
    });

    // ── Dedup suppression filter ────────────────────────────────────────
    describe('dedup filter', () => {
      it('forwards suppressed doc IDs to keyword + vector queries when flag is on (default)', async () => {
        const suppressed = ['dup-doc-2', 'dup-doc-3'];
        suppressedDocsService.getSuppressedDocIds.mockResolvedValue(
          new Set(suppressed),
        );
        redisService.get.mockResolvedValue(null);
        redisService.set.mockResolvedValue(undefined);
        openSearchService.searchKeyword.mockResolvedValue(mockBm25Result);
        embeddingClientService.embed.mockResolvedValue([0.1, 0.2, 0.3]);
        openSearchService.searchVector.mockResolvedValue(mockKnnResult);

        await service.search(searchDto);

        expect(suppressedDocsService.getSuppressedDocIds).toHaveBeenCalledTimes(1);
        expect(openSearchService.searchKeyword).toHaveBeenCalledWith(
          expect.objectContaining({ excludeDocumentIds: suppressed }),
        );
        expect(openSearchService.searchVector).toHaveBeenCalledWith(
          expect.objectContaining({ excludeDocumentIds: suppressed }),
        );
      });

      it('skips suppression list when SEARCH_DEDUP_FILTER_ENABLED=false', async () => {
        const config = service['config'] as unknown as { get: jest.Mock };
        config.get.mockImplementation(
          (key: string, defaultValue?: string) =>
            key === 'SEARCH_DEDUP_FILTER_ENABLED' ? 'false' : defaultValue,
        );
        redisService.get.mockResolvedValue(null);
        redisService.set.mockResolvedValue(undefined);
        openSearchService.searchKeyword.mockResolvedValue(mockBm25Result);
        embeddingClientService.embed.mockResolvedValue(null);

        await service.search(searchDto);

        expect(suppressedDocsService.getSuppressedDocIds).not.toHaveBeenCalled();
        expect(openSearchService.searchKeyword).toHaveBeenCalledWith(
          expect.objectContaining({ excludeDocumentIds: [] }),
        );
      });

      it('falls back to no filter when the suppressed-docs service returns an empty Set', async () => {
        // Simulates Redis cold cache / outage — service swallows error and
        // returns empty Set. Search MUST NOT 500.
        suppressedDocsService.getSuppressedDocIds.mockResolvedValue(
          new Set<string>(),
        );
        redisService.get.mockResolvedValue(null);
        redisService.set.mockResolvedValue(undefined);
        openSearchService.searchKeyword.mockResolvedValue(mockBm25Result);
        embeddingClientService.embed.mockResolvedValue(null);

        const result = await service.search(searchDto);

        expect(result.items).toEqual(mockBm25Result.items);
        expect(openSearchService.searchKeyword).toHaveBeenCalledWith(
          expect.objectContaining({ excludeDocumentIds: [] }),
        );
      });
    });
  });

  describe('searchByCitation', () => {
    it('should normalize citation and call openSearch.searchExactCitation', async () => {
      const citation = 'GR No 123456';
      const normalized = 'G.R. No. 123456';
      const mockResult = [mockSearchResultItem];

      openSearchService.searchExactCitation.mockResolvedValue(mockResult);

      const result = await service.searchByCitation(citation);

      expect(result).toEqual(mockResult);
      expect(openSearchService.searchExactCitation).toHaveBeenCalledWith(normalized);
    });

    it('should normalize various citation formats', async () => {
      const testCases = [
        { input: 'G.R. No. 123456', expected: 'G.R. No. 123456' },
        { input: 'GR 123456', expected: 'G.R. No. 123456' },
        { input: 'G.R.N. 123456', expected: 'G.R. No. 123456' },
        { input: 'GRN 123456', expected: 'G.R. No. 123456' },
        { input: '  G.R.  No.  123456  ', expected: 'G.R. No. 123456' },
      ];

      openSearchService.searchExactCitation.mockResolvedValue([]);

      for (const testCase of testCases) {
        await service.searchByCitation(testCase.input);
        expect(openSearchService.searchExactCitation).toHaveBeenCalledWith(testCase.expected);
      }
    });
  });

  describe('getSuggestions', () => {
    it('should delegate to openSearch.searchSuggestions with default limit', async () => {
      const prefix = 'test';
      const mockSuggestions = ['test1', 'test2', 'test3'];

      openSearchService.searchSuggestions.mockResolvedValue(mockSuggestions);

      const result = await service.getSuggestions(prefix);

      expect(result).toEqual(mockSuggestions);
      expect(openSearchService.searchSuggestions).toHaveBeenCalledWith(prefix, 10);
    });

    it('should delegate to openSearch.searchSuggestions with custom limit', async () => {
      const prefix = 'legal';
      const limit = 5;
      const mockSuggestions = ['legal term 1', 'legal term 2'];

      openSearchService.searchSuggestions.mockResolvedValue(mockSuggestions);

      const result = await service.getSuggestions(prefix, limit);

      expect(result).toEqual(mockSuggestions);
      expect(openSearchService.searchSuggestions).toHaveBeenCalledWith(prefix, limit);
    });
  });

  describe('indexLegalDocument', () => {
    const mockDocument = {
      id: 'doc-123',
      title: 'Sample Decision',
      shortTitle: 'Sample v. Test',
      citationText: 'G.R. No. 123456',
      documentType: 'decision',
      court: 'Supreme Court',
      ponente: 'Justice Sample',
      jurisdiction: 'Philippines',
      language: 'en',
      status: 'published',
      grNo: '123456',
      docketNo: 'ABC-2023',
      isOfficial: true,
      isPublished: true,
      decisionDate: new Date('2023-01-15'),
      promulgationDate: new Date('2023-01-20'),
      publicationDate: new Date('2023-02-01'),
      createdAt: new Date('2023-01-10'),
      source: {
        id: 'source-1',
        trustLevel: 'official',
      },
      sections: [
        {
          id: 'section-1',
          sectionType: 'facts',
          sectionLabel: 'Facts',
          plainText: 'This is the facts section with sufficient text content.',
          pageStart: 1,
          pageEnd: 2,
          ordering: 0,
        },
        {
          id: 'section-2',
          sectionType: 'ruling',
          sectionLabel: 'Ruling',
          plainText: 'This is the ruling section with the court decision details.',
          pageStart: 3,
          pageEnd: 5,
          ordering: 1,
        },
      ],
      tagMaps: [
        {
          tag: {
            code: 'civil_law',
            tagType: 'bar_subject',
          },
        },
        {
          tag: {
            code: 'contracts',
            tagType: 'topic',
          },
        },
      ],
    };

    it('should load document from Prisma and index in keyword index', async () => {
      prismaService.legalDocument.findUnique.mockResolvedValue(mockDocument);
      openSearchService.indexDocument.mockResolvedValue(undefined);
      embeddingClientService.embedBatch.mockResolvedValue(null);

      await service.indexLegalDocument('doc-123');

      expect(prismaService.legalDocument.findUnique).toHaveBeenCalledWith({
        where: { id: 'doc-123' },
        include: {
          source: { select: { id: true, trustLevel: true } },
          sections: {
            select: {
              id: true,
              sectionType: true,
              sectionLabel: true,
              plainText: true,
              pageStart: true,
              pageEnd: true,
            },
            orderBy: { ordering: 'asc' },
          },
          tagMaps: {
            include: {
              tag: { select: { code: true, tagType: true } },
            },
          },
        },
      });

      // Should index document with full text
      expect(openSearchService.indexDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          document_id: 'doc-123',
          title: 'Sample Decision',
          plain_text: expect.stringContaining('This is the facts section'),
          document_type: 'decision',
          court: 'Supreme Court',
          bar_subjects: ['civil_law'],
          topics: ['contracts'],
        }),
      );
    });

    it('should index each section separately', async () => {
      prismaService.legalDocument.findUnique.mockResolvedValue(mockDocument);
      openSearchService.indexDocument.mockResolvedValue(undefined);
      embeddingClientService.embedBatch.mockResolvedValue(null);

      await service.indexLegalDocument('doc-123');

      // Should call indexDocument once for full document + once per section
      expect(openSearchService.indexDocument).toHaveBeenCalledTimes(3);

      // Check section indexing calls
      expect(openSearchService.indexDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          section_id: 'section-1',
          section_type: 'facts',
          section_text: 'This is the facts section with sufficient text content.',
          plain_text: undefined,
        }),
      );

      expect(openSearchService.indexDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          section_id: 'section-2',
          section_type: 'ruling',
          section_text: 'This is the ruling section with the court decision details.',
          plain_text: undefined,
        }),
      );
    });

    it('should generate and index vector embeddings', async () => {
      const mockEmbeddings = [
        [0.1, 0.2, 0.3], // doc-level
        [0.4, 0.5, 0.6], // section-1
        [0.7, 0.8, 0.9], // section-2
      ];

      prismaService.legalDocument.findUnique.mockResolvedValue(mockDocument);
      openSearchService.indexDocument.mockResolvedValue(undefined);
      embeddingClientService.embedBatch.mockResolvedValue(mockEmbeddings);
      openSearchService.bulkIndexVectorDocuments.mockResolvedValue(undefined);

      await service.indexLegalDocument('doc-123');

      // Wait for async vector indexing to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(embeddingClientService.embedBatch).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.stringContaining('Sample Decision'),
          expect.stringContaining('This is the facts section'),
          expect.stringContaining('This is the ruling section'),
        ]),
      );

      expect(openSearchService.bulkIndexVectorDocuments).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            document_id: 'doc-123',
            section_id: undefined,
            embedding_vector: [0.1, 0.2, 0.3],
          }),
          expect.objectContaining({
            document_id: 'doc-123',
            section_id: 'section-1',
            embedding_vector: [0.4, 0.5, 0.6],
          }),
          expect.objectContaining({
            document_id: 'doc-123',
            section_id: 'section-2',
            embedding_vector: [0.7, 0.8, 0.9],
          }),
        ]),
      );
    });

    it('should handle document not found gracefully', async () => {
      prismaService.legalDocument.findUnique.mockResolvedValue(null);

      await service.indexLegalDocument('nonexistent-doc');

      expect(prismaService.legalDocument.findUnique).toHaveBeenCalledTimes(1);
      expect(openSearchService.indexDocument).not.toHaveBeenCalled();
    });

    it('should skip sections without plainText', async () => {
      const docWithEmptySection = {
        ...mockDocument,
        sections: [
          {
            id: 'section-1',
            sectionType: 'facts',
            sectionLabel: 'Facts',
            plainText: null,
            pageStart: 1,
            pageEnd: 2,
            ordering: 0,
          },
        ],
      };

      prismaService.legalDocument.findUnique.mockResolvedValue(docWithEmptySection);
      openSearchService.indexDocument.mockResolvedValue(undefined);
      embeddingClientService.embedBatch.mockResolvedValue(null);

      await service.indexLegalDocument('doc-123');

      // Should only index full document, not the section
      expect(openSearchService.indexDocument).toHaveBeenCalledTimes(1);
    });
  });

  describe('initializeIndexes', () => {
    it('should call openSearch.ensureIndexes', async () => {
      openSearchService.ensureIndexes.mockResolvedValue(undefined);

      const result = await service.initializeIndexes();

      expect(result).toEqual({ message: 'Indexes initialized' });
      expect(openSearchService.ensureIndexes).toHaveBeenCalledTimes(1);
    });
  });

  describe('removeFromIndex', () => {
    it('should call openSearch.removeDocumentFromAllIndexes', async () => {
      openSearchService.removeDocumentFromAllIndexes.mockResolvedValue(undefined);

      await service.removeFromIndex('doc-123');

      expect(openSearchService.removeDocumentFromAllIndexes).toHaveBeenCalledWith('doc-123');
    });
  });

  describe('bulkIndexDocuments', () => {
    it('should index multiple documents in batches', async () => {
      const documentIds = ['doc-1', 'doc-2', 'doc-3'];
      const mockDoc = {
        id: 'doc-1',
        title: 'Test Doc',
        citationText: 'G.R. No. 123',
        documentType: 'decision',
        court: 'Supreme Court',
        status: 'published',
        isOfficial: true,
        isPublished: true,
        createdAt: new Date('2023-01-01'),
        source: {
          id: 'source-1',
          trustLevel: 'official',
        },
        tagMaps: [],
      };

      prismaService.legalDocument.findMany.mockResolvedValue(
        documentIds.map((id) => ({ ...mockDoc, id })),
      );
      openSearchService.bulkIndexDocuments.mockResolvedValue({
        indexed: 3,
        errors: 0,
      });

      const result = await service.bulkIndexDocuments(documentIds);

      expect(result.indexed).toBe(3);
      expect(result.errors).toBe(0);
      expect(result.total).toBe(3);
      expect(prismaService.legalDocument.findMany).toHaveBeenCalledTimes(1);
      expect(openSearchService.bulkIndexDocuments).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * SEARCH_RANKER_V2=true — the new path. The suite above pins the flag to
   * 'false' and therefore doubles as the "legacy behaviour is unchanged"
   * proof required before this can ship.
   */
  describe('ranker v2', () => {
    const v2Dto: SearchQueryDto = { query: 'estafa', page: 0, limit: 20 };

    const collapsedResult = {
      total: 476,
      approximateTotal: true,
      maxScore: 12.5,
      items: [{ id: 'sec-1', score: 12.5, source: { document_id: 'doc-1' } }],
      timedOut: false,
    };

    beforeEach(() => {
      rankerV2 = 'true';
      redisService.get.mockResolvedValue(null);
      redisService.set.mockResolvedValue(undefined);
      embeddingClientService.embed.mockResolvedValue(null);
      openSearchService.searchKeyword.mockResolvedValue(collapsedResult);
    });

    it('classifies the query and passes the intent to the query builder', async () => {
      await service.search({ ...v2Dto, query: 'G.R. No. 246999' });

      const call = openSearchService.searchKeyword.mock.calls[0]![0] as {
        intent?: { kind: string; citation?: { digits?: string } };
      };
      expect(call.intent?.kind).toBe('citation');
      expect(call.intent?.citation?.digits).toBe('246999');
    });

    it('requests exactly one page instead of over-fetching for a JS dedup', async () => {
      await service.search({ ...v2Dto, page: 2, limit: 20 });

      expect(openSearchService.searchKeyword).toHaveBeenCalledWith(
        expect.objectContaining({ from: 40, size: 20 }),
      );
    });

    // v1 reported the length of its JS-deduped slice as `total` — for `estafa`
    // that was ~13-24 instead of 476, and page 2 came back empty.
    it('reports the cardinality total and flags it approximate', async () => {
      const result = await service.search(v2Dto);

      expect(result.meta.total).toBe(476);
      expect(result.meta.approximateTotal).toBe(true);
    });

    it('returns items on a deep page rather than an empty list', async () => {
      const result = await service.search({ ...v2Dto, page: 2, limit: 20 });
      expect(result.items).toHaveLength(1);
    });

    it('does not re-slice the collapsed page in JS', async () => {
      openSearchService.searchKeyword.mockResolvedValue({
        ...collapsedResult,
        items: Array.from({ length: 20 }, (_, i) => ({
          id: `sec-${i}`,
          score: 10 - i * 0.1,
          source: { document_id: `doc-${i}` },
        })),
      });

      const result = await service.search({ ...v2Dto, page: 1, limit: 20 });
      expect(result.items).toHaveLength(20);
    });

    it('surfaces the detected intent kind in meta', async () => {
      const result = await service.search({ ...v2Dto, query: '2026-01-21' });
      expect(result.meta.intent).toBe('date');
    });

    it('passes env-tuned ranking weights through to the builder', async () => {
      await service.search(v2Dto);
      expect(openSearchService.searchKeyword).toHaveBeenCalledWith(
        expect.objectContaining({
          weights: expect.objectContaining({ recencyScaleDays: 3650 }),
        }),
      );
    });
  });

  describe('deep pagination guard', () => {
    beforeEach(() => {
      rankerV2 = 'true';
      redisService.get.mockResolvedValue(null);
    });

    it('rejects a window past SEARCH_MAX_WINDOW with 400, not an upstream 500', async () => {
      await expect(
        service.search({ query: 'estafa', page: 100, limit: 20 }),
      ).rejects.toThrow(BadRequestException);
      expect(openSearchService.searchKeyword).not.toHaveBeenCalled();
    });

    it('allows the last page inside the window', async () => {
      openSearchService.searchKeyword.mockResolvedValue({
        total: 1000,
        approximateTotal: true,
        maxScore: 5,
        items: [],
        timedOut: false,
      });
      embeddingClientService.embed.mockResolvedValue(null);

      await expect(
        service.search({ query: 'estafa', page: 49, limit: 20 }),
      ).resolves.toBeDefined();
    });
  });

  describe('zero-result recovery', () => {
    beforeEach(() => {
      rankerV2 = 'true';
      redisService.get.mockResolvedValue(null);
      redisService.set.mockResolvedValue(undefined);
      embeddingClientService.embed.mockResolvedValue(null);
    });

    it('abstains and returns suggestions instead of fabricating results', async () => {
      openSearchService.searchKeyword.mockResolvedValue({
        total: 0,
        approximateTotal: true,
        maxScore: null,
        items: [],
        timedOut: false,
        didYouMean: 'estafa',
      });
      openSearchService.searchSuggestions.mockResolvedValue([
        { id: 's1', documentId: 'doc-1', title: 'People v. Santos' },
      ]);

      const result = await service.search({ query: 'estaffa', limit: 20 });

      expect(result.items).toEqual([]);
      expect(result.meta.abstained).toBe(true);
      expect(result.meta.didYouMean).toBe('estafa');
      expect(result.meta.suggestions).toHaveLength(1);
    });

    it('abstains when the top score is below SEARCH_MIN_SCORE', async () => {
      openSearchService.searchKeyword.mockResolvedValue({
        total: 3,
        approximateTotal: true,
        maxScore: 0.4,
        items: [{ id: 'sec-1', score: 0.4, source: { document_id: 'doc-1' } }],
        timedOut: false,
      });

      const result = await service.search({ query: 'qqqq', limit: 20 });
      expect(result.meta.abstained).toBe(true);
    });

    it('does not abstain on a confident result', async () => {
      openSearchService.searchKeyword.mockResolvedValue({
        total: 476,
        approximateTotal: true,
        maxScore: 12.5,
        items: [{ id: 'sec-1', score: 12.5, source: { document_id: 'doc-1' } }],
        timedOut: false,
      });

      const result = await service.search({ query: 'estafa', limit: 20 });
      expect(result.meta.abstained).toBe(false);
      expect(result.meta.suggestions).toEqual([]);
    });

    it('records the miss without any actor identifier', async () => {
      const zadd = jest.fn().mockResolvedValue(1);
      const expire = jest.fn().mockResolvedValue(1);
      redisService.getClient.mockReturnValue({ zadd, expire, zrevrange: jest.fn() });
      openSearchService.searchKeyword.mockResolvedValue({
        total: 0,
        approximateTotal: true,
        maxScore: null,
        items: [],
        timedOut: false,
      });

      await service.search({ query: 'no such doctrine', limit: 20 });

      expect(zadd).toHaveBeenCalledTimes(1);
      const payload = JSON.parse(zadd.mock.calls[0]![2] as string) as Record<
        string,
        unknown
      >;
      expect(payload['q']).toBe('no such doctrine');
      expect(Object.keys(payload).sort()).toEqual(['at', 'q', 'total']);
    });

    it('never lets a Redis failure break the search response', async () => {
      redisService.getClient.mockReturnValue({
        zadd: jest.fn().mockRejectedValue(new Error('redis down')),
        expire: jest.fn(),
        zrevrange: jest.fn(),
      });
      openSearchService.searchKeyword.mockResolvedValue({
        total: 0,
        approximateTotal: true,
        maxScore: null,
        items: [],
        timedOut: false,
      });

      await expect(service.search({ query: 'anything', limit: 20 })).resolves.toBeDefined();
    });
  });
  // ---- free statutory tier gating ----

  describe('free statutory tier (previewOnly gate)', () => {
    const codalItem: SearchResultItem = {
      id: 'doc-codal',
      score: 2,
      source: { document_id: 'doc-codal', title: 'Civil Code', document_type: 'codal' },
    };
    const decisionItem: SearchResultItem = {
      id: 'doc-decision',
      score: 1.5,
      source: {
        document_id: 'doc-decision',
        title: 'People v. Doe',
        document_type: 'decision',
      },
    };
    const barItem: SearchResultItem = {
      id: 'doc-bar',
      score: 1.2,
      source: {
        document_id: 'doc-bar',
        title: '2019 Bar Questions',
        document_type: 'bar_exam_questions',
      },
    };
    const CORPUS = [codalItem, decisionItem, barItem];

    /**
     * Honour the `documentType` filter the way OpenSearch does, so an
     * assertion about what came back is an assertion about the query rather
     * than about the mock.
     */
    const respectFilters = () => {
      openSearchService.searchKeyword.mockImplementation(
        (opts: { filters?: { documentType?: string | string[] } }) => {
          const dt = opts.filters?.documentType;
          const allowed = dt === undefined ? null : Array.isArray(dt) ? dt : [dt];
          const items =
            allowed === null
              ? CORPUS
              : CORPUS.filter((item) =>
                  allowed.includes(item.source['document_type'] as string),
                );
          return Promise.resolve({
            total: items.length,
            approximateTotal: false,
            maxScore: items[0]?.score ?? null,
            items,
            timedOut: false,
          });
        },
      );
      embeddingClientService.embed.mockResolvedValue(null);
    };

    const gatedTypesIn = (items: unknown[]): string[] =>
      items
        .map(
          (item) =>
            ((item as SearchResultItem).source?.['document_type'] as string) ?? '',
        )
        .filter((type) => !isFreeDocumentType(type));

    beforeEach(() => {
      respectFilters();
    });

    describe('mobile client (excludeLocked)', () => {
      it('returns zero gated documentType values', async () => {
        const result = await service.search({ query: 'code', limit: 20 }, null, {
          previewOnly: true,
          excludeLocked: true,
        });

        expect(gatedTypesIn(result.items)).toEqual([]);
        expect(result.items).toHaveLength(1);
      });

      it('narrows the OpenSearch filter to the free allowlist', async () => {
        await service.search({ query: 'code', limit: 20 }, null, {
          previewOnly: true,
          excludeLocked: true,
        });

        const call = openSearchService.searchKeyword.mock.calls[0]![0]!;
        expect(call.filters.documentType).toEqual([...FREE_DOCUMENT_TYPES]);
      });

      it('returns nothing when a gated documentType is explicitly requested', async () => {
        const result = await service.search(
          { query: 'code', limit: 20, documentType: ['decision'] },
          null,
          { previewOnly: true, excludeLocked: true },
        );

        const call = openSearchService.searchKeyword.mock.calls[0]![0]!;
        expect(call.filters.documentType).toEqual([]);
        expect(result.items).toEqual([]);
      });

      it('adds no previewMode/upgrade meta — a hidden result shows nothing', async () => {
        const result = await service.search({ query: 'code', limit: 20 }, null, {
          previewOnly: true,
          excludeLocked: true,
        });

        expect(result.meta).not.toHaveProperty('previewMode');
        expect(result.meta).not.toHaveProperty('upgradeRequired');
      });

      it('does not query the derivative or digest arms on a federated request', async () => {
        const searchDerivatives = jest.fn().mockResolvedValue({
          items: [],
          total: 0,
          timedOut: false,
        });
        const searchCaseDigests = jest.fn().mockResolvedValue({
          items: [],
          total: 0,
          timedOut: false,
        });
        Object.assign(openSearchService, { searchDerivatives, searchCaseDigests });

        const result = await service.search(
          { query: 'code', limit: 20, scope: 'all' },
          { organizationId: 'org-1' },
          { previewOnly: true, excludeLocked: true },
        );

        expect(searchDerivatives).not.toHaveBeenCalled();
        expect(searchCaseDigests).not.toHaveBeenCalled();
        expect(gatedTypesIn(result.items)).toEqual([]);
      });
    });

    describe('non-mobile client (web keeps its upgrade banner)', () => {
      it('returns locked results with previewMode/lockedCount/upgradeRequired', async () => {
        const result = await service.search({ query: 'code', limit: 20 }, null, {
          previewOnly: true,
          excludeLocked: false,
        });

        expect(result.items).toHaveLength(3);
        expect(result.meta).toMatchObject({
          previewMode: true,
          lockedCount: 2, // decision + bar_exam_questions
          upgradeRequired: true,
        });
      });

      it('leaves the documentType filter untouched', async () => {
        await service.search({ query: 'code', limit: 20 }, null, {
          previewOnly: true,
          excludeLocked: false,
        });

        const call = openSearchService.searchKeyword.mock.calls[0]![0]!;
        expect(call.filters.documentType).toBeUndefined();
      });
    });

    describe('entitled callers', () => {
      it('behaves exactly as before when no gate is passed', async () => {
        const result = await service.search({ query: 'code', limit: 20 });

        expect(result.items).toHaveLength(3);
        expect(result.meta).not.toHaveProperty('previewMode');
        const call = openSearchService.searchKeyword.mock.calls[0]![0]!;
        expect(call.filters.documentType).toBeUndefined();
      });

      it('behaves as before when previewOnly is false, even from mobile', async () => {
        const result = await service.search({ query: 'code', limit: 20 }, null, {
          previewOnly: false,
          excludeLocked: true,
        });

        expect(result.items).toHaveLength(3);
        expect(result.meta).not.toHaveProperty('previewMode');
      });
    });

    it('caches free and entitled result sets under different keys', async () => {
      await service.search({ query: 'code', limit: 20 }, null, {
        previewOnly: true,
        excludeLocked: true,
      });
      await service.search({ query: 'code', limit: 20 });

      const freeKey = redisService.set.mock.calls[0]![0] as string;
      const entitledKey = redisService.set.mock.calls[1]![0] as string;
      expect(freeKey).not.toBe(entitledKey);
    });
  });
});
