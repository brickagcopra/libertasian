import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

import { OpenSearchService, KEYWORD_INDEX, VECTOR_INDEX, USER_UPLOADS_INDEX } from './opensearch.service';

// Mock @opensearch-project/opensearch
const mockClient = {
  info: jest.fn(),
  index: jest.fn(),
  bulk: jest.fn(),
  search: jest.fn(),
  delete: jest.fn(),
  deleteByQuery: jest.fn(),
  indices: {
    exists: jest.fn(),
    create: jest.fn(),
  },
};

jest.mock('@opensearch-project/opensearch', () => ({
  Client: jest.fn().mockImplementation(() => mockClient),
}));

describe('OpenSearchService', () => {
  let service: OpenSearchService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OpenSearchService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: string) => {
              if (key === 'OPENSEARCH_URL') return 'http://localhost:9200';
              return defaultValue;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<OpenSearchService>(OpenSearchService);
  });

  // ---- onModuleInit ----

  describe('onModuleInit', () => {
    it('should log connection info on success', async () => {
      mockClient.info.mockResolvedValue({
        body: { version: { distribution: 'opensearch', number: '2.11.0' } },
      });

      await expect(service.onModuleInit()).resolves.not.toThrow();
    });

    it('should warn when OpenSearch is unavailable', async () => {
      mockClient.info.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(service.onModuleInit()).resolves.not.toThrow();
    });
  });

  // ---- ensureIndexes ----

  describe('ensureIndexes', () => {
    it('should create indexes that do not exist', async () => {
      mockClient.indices.exists.mockResolvedValue({ body: false });
      mockClient.indices.create.mockResolvedValue({});

      await service.ensureIndexes();

      expect(mockClient.indices.exists).toHaveBeenCalledTimes(3);
      expect(mockClient.indices.create).toHaveBeenCalledTimes(3);
    });

    it('should skip creating indexes that already exist', async () => {
      mockClient.indices.exists.mockResolvedValue({ body: true });

      await service.ensureIndexes();

      expect(mockClient.indices.create).not.toHaveBeenCalled();
    });
  });

  // ---- indexDocument ----

  describe('indexDocument', () => {
    it('should index document using section_id if available', async () => {
      mockClient.index.mockResolvedValue({});

      await service.indexDocument({
        document_id: 'doc-1',
        section_id: 'sec-1',
        title: 'People v. Santos',
        document_type: 'case',
        status: 'published',
        is_official: true,
        is_published: true,
        created_at: '2024-01-01',
      });

      expect(mockClient.index).toHaveBeenCalledWith(
        expect.objectContaining({
          index: KEYWORD_INDEX,
          id: 'sec-1',
          refresh: 'false',
        }),
      );
    });

    it('should fall back to document_id when no section_id', async () => {
      mockClient.index.mockResolvedValue({});

      await service.indexDocument({
        document_id: 'doc-1',
        title: 'People v. Santos',
        document_type: 'case',
        status: 'published',
        is_official: true,
        is_published: true,
        created_at: '2024-01-01',
      });

      expect(mockClient.index).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'doc-1' }),
      );
    });

    it('should throw on indexing error', async () => {
      mockClient.index.mockRejectedValue(new Error('Index error'));

      await expect(
        service.indexDocument({
          document_id: 'doc-1',
          title: 'Test',
          document_type: 'case',
          status: 'published',
          is_official: true,
          is_published: true,
          created_at: '2024-01-01',
        }),
      ).rejects.toThrow('Index error');
    });
  });

  // ---- bulkIndexDocuments ----

  describe('bulkIndexDocuments', () => {
    it('should return zeros for empty array', async () => {
      const result = await service.bulkIndexDocuments([]);
      expect(result).toEqual({ indexed: 0, errors: 0 });
      expect(mockClient.bulk).not.toHaveBeenCalled();
    });

    it('should bulk index documents', async () => {
      mockClient.bulk.mockResolvedValue({
        body: { errors: false, items: [] },
      });

      const docs = [
        {
          document_id: 'doc-1',
          title: 'Case 1',
          document_type: 'case',
          status: 'published',
          is_official: true,
          is_published: true,
          created_at: '2024-01-01',
        },
        {
          document_id: 'doc-2',
          title: 'Case 2',
          document_type: 'case',
          status: 'published',
          is_official: true,
          is_published: true,
          created_at: '2024-01-01',
        },
      ];

      const result = await service.bulkIndexDocuments(docs);
      expect(result).toEqual({ indexed: 2, errors: 0 });
    });

    it('should report errors in bulk index', async () => {
      mockClient.bulk.mockResolvedValue({
        body: {
          errors: true,
          items: [
            { index: { error: null } },
            { index: { error: 'mapping error' } },
          ],
        },
      });

      const docs = [
        {
          document_id: 'doc-1',
          title: 'Case 1',
          document_type: 'case',
          status: 'published',
          is_official: true,
          is_published: true,
          created_at: '2024-01-01',
        },
        {
          document_id: 'doc-2',
          title: 'Case 2',
          document_type: 'case',
          status: 'published',
          is_official: true,
          is_published: true,
          created_at: '2024-01-01',
        },
      ];

      const result = await service.bulkIndexDocuments(docs);
      expect(result).toEqual({ indexed: 1, errors: 1 });
    });
  });

  // ---- removeDocument ----

  describe('removeDocument', () => {
    it('should delete by query on document_id', async () => {
      mockClient.deleteByQuery.mockResolvedValue({});

      await service.removeDocument('doc-1');

      expect(mockClient.deleteByQuery).toHaveBeenCalledWith({
        index: KEYWORD_INDEX,
        body: { query: { term: { document_id: 'doc-1' } } },
      });
    });
  });

  // ---- searchKeyword ----

  describe('searchKeyword', () => {
    it('should search with query and return formatted results', async () => {
      mockClient.search.mockResolvedValue({
        body: {
          hits: {
            total: { value: 1 },
            max_score: 5.5,
            hits: [
              {
                _id: 'doc-1',
                _score: 5.5,
                _source: { title: 'People v. Santos', document_type: 'case' },
                highlight: { title: ['People v. <mark>Santos</mark>'] },
              },
            ],
          },
          timed_out: false,
        },
      });

      const result = await service.searchKeyword({ query: 'Santos' });

      expect(result.total).toBe(1);
      expect(result.maxScore).toBe(5.5);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.id).toBe('doc-1');
      expect(result.items[0]!.highlights).toHaveProperty('title');
      expect(result.timedOut).toBe(false);
    });

    it('should apply document type filter', async () => {
      mockClient.search.mockResolvedValue({
        body: {
          hits: { total: { value: 0 }, max_score: null, hits: [] },
          timed_out: false,
        },
      });

      await service.searchKeyword({
        query: 'test',
        filters: { documentType: 'statute' },
      });

      expect(mockClient.search).toHaveBeenCalledWith(
        expect.objectContaining({
          index: KEYWORD_INDEX,
          body: expect.objectContaining({
            query: expect.objectContaining({
              bool: expect.objectContaining({
                filter: expect.arrayContaining([
                  { term: { document_type: 'statute' } },
                ]),
              }),
            }),
          }),
        }),
      );
    });

    it('should apply date range filter', async () => {
      mockClient.search.mockResolvedValue({
        body: {
          hits: { total: { value: 0 }, max_score: null, hits: [] },
          timed_out: false,
        },
      });

      await service.searchKeyword({
        query: 'test',
        filters: { dateFrom: '2020-01-01', dateTo: '2024-12-31' },
      });

      expect(mockClient.search).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            query: expect.objectContaining({
              bool: expect.objectContaining({
                filter: expect.arrayContaining([
                  { range: { decision_date: { gte: '2020-01-01', lte: '2024-12-31' } } },
                ]),
              }),
            }),
          }),
        }),
      );
    });

    it('should throw on search error', async () => {
      mockClient.search.mockRejectedValue(new Error('Search failed'));

      await expect(
        service.searchKeyword({ query: 'test' }),
      ).rejects.toThrow('Search failed');
    });
  });

  // ---- searchExactCitation ----

  describe('searchExactCitation', () => {
    it('should search for exact citation matches', async () => {
      mockClient.search.mockResolvedValue({
        body: {
          hits: {
            total: { value: 1 },
            hits: [
              {
                _id: 'doc-1',
                _score: 10.0,
                _source: { gr_no: '123456', title: 'Case' },
              },
            ],
          },
        },
      });

      const result = await service.searchExactCitation('123456');

      expect(result.total).toBe(1);
      expect(result.items[0]!.id).toBe('doc-1');
    });
  });

  // ---- searchSuggestions ----

  describe('searchSuggestions', () => {
    it('should return suggestion items', async () => {
      mockClient.search.mockResolvedValue({
        body: {
          hits: {
            hits: [
              {
                _id: 'doc-1',
                _score: 3.0,
                _source: { document_id: 'doc-1', title: 'People v. Santos' },
              },
            ],
          },
        },
      });

      const result = await service.searchSuggestions('People');

      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe('doc-1');
    });

    it('should return empty array on error', async () => {
      mockClient.search.mockRejectedValue(new Error('Search failed'));

      const result = await service.searchSuggestions('test');
      expect(result).toEqual([]);
    });
  });

  // ---- indexVectorDocument ----

  describe('indexVectorDocument', () => {
    it('should index into vector index', async () => {
      mockClient.index.mockResolvedValue({});

      await service.indexVectorDocument({
        document_id: 'doc-1',
        document_type: 'case',
        is_official: true,
        is_published: true,
        embedding_vector: new Array(1024).fill(0.1),
        text_snippet: 'test snippet',
        title: 'Test Case',
      });

      expect(mockClient.index).toHaveBeenCalledWith(
        expect.objectContaining({
          index: VECTOR_INDEX,
          id: 'doc-1',
        }),
      );
    });
  });

  // ---- bulkIndexVectorDocuments ----

  describe('bulkIndexVectorDocuments', () => {
    it('should return zeros for empty array', async () => {
      const result = await service.bulkIndexVectorDocuments([]);
      expect(result).toEqual({ indexed: 0, errors: 0 });
    });

    it('should bulk index vector documents', async () => {
      mockClient.bulk.mockResolvedValue({
        body: { errors: false, items: [] },
      });

      const result = await service.bulkIndexVectorDocuments([
        {
          document_id: 'doc-1',
          document_type: 'case',
          is_official: true,
          is_published: true,
          embedding_vector: [0.1],
          text_snippet: 'snippet',
          title: 'Test',
        },
      ]);

      expect(result).toEqual({ indexed: 1, errors: 0 });
    });
  });

  // ---- searchVector ----

  describe('searchVector', () => {
    it('should perform kNN search', async () => {
      mockClient.search.mockResolvedValue({
        body: {
          hits: {
            hits: [
              {
                _id: 'doc-1',
                _score: 0.95,
                _source: { title: 'Similar Case', document_type: 'case' },
              },
            ],
          },
          timed_out: false,
        },
      });

      const result = await service.searchVector({
        vector: new Array(1024).fill(0.1),
        k: 10,
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.score).toBe(0.95);
      expect(result.timedOut).toBe(false);
    });

    it('should apply filters to kNN search', async () => {
      mockClient.search.mockResolvedValue({
        body: {
          hits: { hits: [] },
          timed_out: false,
        },
      });

      await service.searchVector({
        vector: [0.1],
        filters: { documentType: 'case', publishedOnly: true },
      });

      expect(mockClient.search).toHaveBeenCalledWith(
        expect.objectContaining({
          index: VECTOR_INDEX,
          body: expect.objectContaining({
            query: expect.objectContaining({
              knn: expect.objectContaining({
                filter: expect.objectContaining({
                  bool: expect.objectContaining({
                    must: expect.arrayContaining([
                      { term: { document_type: 'case' } },
                      { term: { is_published: true } },
                    ]),
                  }),
                }),
              }),
            }),
          }),
        }),
      );
    });

    it('should throw on vector search error', async () => {
      mockClient.search.mockRejectedValue(new Error('Vector search failed'));

      await expect(
        service.searchVector({ vector: [0.1] }),
      ).rejects.toThrow('Vector search failed');
    });
  });

  // ---- removeDocumentFromAllIndexes ----

  describe('removeDocumentFromAllIndexes', () => {
    it('should remove from both keyword and vector indexes', async () => {
      mockClient.deleteByQuery.mockResolvedValue({});

      await service.removeDocumentFromAllIndexes('doc-1');

      expect(mockClient.deleteByQuery).toHaveBeenCalledTimes(2);
      expect(mockClient.deleteByQuery).toHaveBeenCalledWith(
        expect.objectContaining({ index: KEYWORD_INDEX }),
      );
      expect(mockClient.deleteByQuery).toHaveBeenCalledWith(
        expect.objectContaining({ index: VECTOR_INDEX }),
      );
    });
  });

  // ---- User Uploads Index ----

  describe('indexUserUpload', () => {
    it('should index user upload with upload_id', async () => {
      mockClient.index.mockResolvedValue({});

      await service.indexUserUpload({
        upload_id: 'up-1',
        organization_id: 'org-1',
        user_id: 'user-1',
        ocr_text: 'Scanned text',
        upload_type: 'camera_scan',
        privacy_level: 'private',
        created_at: '2024-01-01T00:00:00Z',
      });

      expect(mockClient.index).toHaveBeenCalledWith(
        expect.objectContaining({
          index: USER_UPLOADS_INDEX,
          id: 'up-1',
        }),
      );
    });
  });

  describe('removeUserUpload', () => {
    it('should delete user upload by id', async () => {
      mockClient.delete.mockResolvedValue({});

      await service.removeUserUpload('up-1');

      expect(mockClient.delete).toHaveBeenCalledWith({
        index: USER_UPLOADS_INDEX,
        id: 'up-1',
      });
    });

    it('should not throw on delete error', async () => {
      mockClient.delete.mockRejectedValue(new Error('Not found'));

      await expect(service.removeUserUpload('up-x')).resolves.not.toThrow();
    });
  });

  describe('searchUserUploads', () => {
    it('should search with mandatory organization_id filter', async () => {
      mockClient.search.mockResolvedValue({
        body: {
          hits: {
            total: { value: 1 },
            max_score: 3.0,
            hits: [
              {
                _id: 'up-1',
                _score: 3.0,
                _source: { upload_id: 'up-1', ocr_text: 'contract text' },
                highlight: { ocr_text: ['<mark>contract</mark> text'] },
              },
            ],
          },
          timed_out: false,
        },
      });

      const result = await service.searchUserUploads({
        query: 'contract',
        organizationId: 'org-1',
      });

      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);

      // Verify tenant isolation — organization_id is always in filter
      expect(mockClient.search).toHaveBeenCalledWith(
        expect.objectContaining({
          index: USER_UPLOADS_INDEX,
          body: expect.objectContaining({
            query: expect.objectContaining({
              bool: expect.objectContaining({
                filter: expect.arrayContaining([
                  { term: { organization_id: 'org-1' } },
                ]),
              }),
            }),
          }),
        }),
      );
    });

    it('should apply document type filter', async () => {
      mockClient.search.mockResolvedValue({
        body: {
          hits: { total: { value: 0 }, max_score: null, hits: [] },
          timed_out: false,
        },
      });

      await service.searchUserUploads({
        query: 'test',
        organizationId: 'org-1',
        filters: { documentType: 'contract' },
      });

      expect(mockClient.search).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            query: expect.objectContaining({
              bool: expect.objectContaining({
                filter: expect.arrayContaining([
                  { term: { classified_document_type: 'contract' } },
                ]),
              }),
            }),
          }),
        }),
      );
    });
  });

  // ---- getClient ----

  describe('getClient', () => {
    it('should return the underlying OpenSearch client', () => {
      const client = service.getClient();
      expect(client).toBeDefined();
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });
});
