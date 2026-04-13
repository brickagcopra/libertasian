import { Test, TestingModule } from '@nestjs/testing';
import { Logger, ServiceUnavailableException } from '@nestjs/common';

import { SearchService } from './search.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/services/redis.service';
import { OpenSearchService, type SearchResultItem } from './opensearch.service';
import { EmbeddingClientService } from './embedding-client.service';
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
};

type MockEmbeddingClientService = {
  embed: jest.Mock;
  embedBatch: jest.Mock;
};

describe('SearchService', () => {
  let service: SearchService;
  let prismaService: MockPrismaService;
  let redisService: MockRedisService;
  let openSearchService: MockOpenSearchService;
  let embeddingClientService: MockEmbeddingClientService;

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
      ],
    }).compile();

    service = module.get<SearchService>(SearchService);
    prismaService = module.get(PrismaService) as unknown as MockPrismaService;
    redisService = module.get(RedisService) as unknown as MockRedisService;
    openSearchService = module.get(OpenSearchService) as unknown as MockOpenSearchService;
    embeddingClientService = module.get(EmbeddingClientService) as unknown as MockEmbeddingClientService;

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

    // E3b: any other OpenSearch failure should throw 503 with a
    // generic message (no upstream details leaked).
    it('should throw ServiceUnavailableException on generic OpenSearch error (E3b)', async () => {
      redisService.get.mockResolvedValue(null);
      openSearchService.searchKeyword.mockRejectedValue(new Error('connection refused'));
      embeddingClientService.embed.mockResolvedValue(null);

      await expect(service.search(searchDto)).rejects.toThrow(ServiceUnavailableException);
      await expect(service.search(searchDto)).rejects.toThrow('Search temporarily unavailable');
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
});
