import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

import {
  OpenSearchService,
  CASE_DIGESTS_INDEX,
  DERIVATIVES_INDEX,
  KEYWORD_INDEX,
  KEYWORD_INDEX_PHYSICAL,
  VECTOR_INDEX,
  USER_UPLOADS_INDEX,
  sanitizeDerivativeSource,
} from './opensearch.service';

// Mock @opensearch-project/opensearch
const mockClient = {
  info: jest.fn(),
  index: jest.fn(),
  bulk: jest.fn(),
  search: jest.fn(),
  delete: jest.fn(),
  deleteByQuery: jest.fn(),
  mget: jest.fn(),
  count: jest.fn(),
  reindex: jest.fn(),
  indices: {
    exists: jest.fn(),
    existsAlias: jest.fn(),
    getAlias: jest.fn(),
    putAlias: jest.fn(),
    updateAliases: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
    refresh: jest.fn(),
    putSettings: jest.fn(),
  },
};

jest.mock('@opensearch-project/opensearch', () => ({
  Client: jest.fn().mockImplementation(() => mockClient),
}));

describe('OpenSearchService', () => {
  let service: OpenSearchService;
  let autoEnsureIndexes: string;

  beforeEach(async () => {
    jest.clearAllMocks();
    autoEnsureIndexes = 'true';

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OpenSearchService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: unknown) => {
              if (key === 'OPENSEARCH_URL') return 'http://localhost:9200';
              if (key === 'SEARCH_AUTO_ENSURE_INDEXES') return autoEnsureIndexes;
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
    it('creates the *_v2 physical index and aliases it when nothing exists', async () => {
      mockClient.indices.existsAlias.mockResolvedValue({ body: false });
      mockClient.indices.exists.mockResolvedValue({ body: false });
      mockClient.indices.create.mockResolvedValue({});
      mockClient.indices.putAlias.mockResolvedValue({});

      const result = await service.ensureIndexes();

      // Five: C2 added the derivatives index and the case-digests corpus added
      // its own — boot bootstrap walks the same topology the rebuild job does.
      expect(result.created).toEqual([
        KEYWORD_INDEX,
        VECTOR_INDEX,
        USER_UPLOADS_INDEX,
        DERIVATIVES_INDEX,
        CASE_DIGESTS_INDEX,
      ]);
      expect(mockClient.indices.create).toHaveBeenCalledWith(
        expect.objectContaining({ index: KEYWORD_INDEX_PHYSICAL }),
      );
      expect(mockClient.indices.putAlias).toHaveBeenCalledWith(
        expect.objectContaining({
          index: KEYWORD_INDEX_PHYSICAL,
          name: KEYWORD_INDEX,
        }),
      );
    });

    it('leaves an existing alias completely alone', async () => {
      mockClient.indices.existsAlias.mockResolvedValue({ body: true });

      const result = await service.ensureIndexes();

      expect(result.existing).toHaveLength(5);
      expect(mockClient.indices.create).not.toHaveBeenCalled();
      expect(mockClient.indices.putAlias).not.toHaveBeenCalled();
    });

    it('refuses to touch a concrete index squatting on an alias name', async () => {
      // This is production today: `legal_documents_keyword` is a real index
      // auto-created with dynamic mappings. Only the rebuild job may replace it.
      mockClient.indices.existsAlias.mockResolvedValue({ body: false });
      mockClient.indices.exists.mockResolvedValue({ body: true });

      const result = await service.ensureIndexes();

      expect(result.needsRebuild).toEqual([
        KEYWORD_INDEX,
        VECTOR_INDEX,
        USER_UPLOADS_INDEX,
        DERIVATIVES_INDEX,
        CASE_DIGESTS_INDEX,
      ]);
      expect(mockClient.indices.create).not.toHaveBeenCalled();
      expect(mockClient.indices.delete).not.toHaveBeenCalled();
      expect(mockClient.indices.updateAliases).not.toHaveBeenCalled();
    });
  });

  // ---- boot resilience ----

  describe('onModuleInit index bootstrap', () => {
    it('does not crash boot when ensureIndexes throws', async () => {
      mockClient.info.mockResolvedValue({
        body: { version: { distribution: 'opensearch', number: '2.11.0' } },
      });
      mockClient.indices.existsAlias.mockRejectedValue(
        new Error('cluster_block_exception'),
      );

      await expect(service.onModuleInit()).resolves.not.toThrow();
    });

    it('skips the bootstrap when SEARCH_AUTO_ENSURE_INDEXES=false', async () => {
      mockClient.info.mockResolvedValue({
        body: { version: { distribution: 'opensearch', number: '2.11.0' } },
      });
      autoEnsureIndexes = 'false';

      await service.onModuleInit();

      expect(mockClient.indices.existsAlias).not.toHaveBeenCalled();
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

    it('derives court_key from the display court and keeps both', async () => {
      mockClient.index.mockResolvedValue({});

      await service.indexDocument({
        document_id: 'doc-1',
        title: 'People v. Santos',
        document_type: 'decision',
        court: 'Supreme Court',
        status: 'published',
        is_official: true,
        is_published: true,
        created_at: '2024-01-01',
      });

      const body = mockClient.index.mock.calls[0]![0]!.body as Record<string, unknown>;
      // `court` stays the display literal for the reader; `court_key` is what
      // filters match. Losing either one is a regression.
      expect(body['court']).toBe('Supreme Court');
      expect(body['court_key']).toBe('supreme_court');
    });

    it('omits court_key entirely when the document has no court', async () => {
      mockClient.index.mockResolvedValue({});

      await service.indexDocument({
        document_id: 'doc-1',
        title: 'Republic Act No. 386',
        document_type: 'republic_act',
        status: 'published',
        is_official: true,
        is_published: true,
        created_at: '2024-01-01',
      });

      const body = mockClient.index.mock.calls[0]![0]!.body as Record<string, unknown>;
      expect(body).not.toHaveProperty('court_key');
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

  // ---- bulkIndexDerivatives ----

  describe('bulkIndexDerivatives', () => {
    const derivative = (overrides: Record<string, unknown> = {}) => ({
      derivative_id: 'der-1',
      derivative_type: 'case_digest',
      title: 'Digest',
      body_text: 'Body',
      visibility: 'public_editorial',
      is_published: true,
      created_at: '2026-04-20T00:00:00.000Z',
      ...overrides,
    });

    /** The document half of the `_bulk` NDJSON body (odd indices are actions). */
    const writtenDoc = (): Record<string, unknown> => {
      const [{ body }] = mockClient.bulk.mock.calls[0] as [
        { body: Record<string, unknown>[] },
      ];
      return body[1]!;
    };

    it('returns zero and skips the round-trip for an empty array', async () => {
      const result = await service.bulkIndexDerivatives([], 'derivative_artifacts_v3');
      expect(result).toEqual({ indexed: 0 });
      expect(mockClient.bulk).not.toHaveBeenCalled();
    });

    it('indexes by derivative_id into the supplied target', async () => {
      mockClient.bulk.mockResolvedValue({ body: { errors: false, items: [] } });

      const result = await service.bulkIndexDerivatives(
        [derivative()],
        'derivative_artifacts_v3',
      );

      expect(result).toEqual({ indexed: 1 });
      const [{ body }] = mockClient.bulk.mock.calls[0] as [
        { body: Record<string, unknown>[] },
      ];
      expect(body[0]).toEqual({
        index: { _index: 'derivative_artifacts_v3', _id: 'der-1' },
      });
    });

    // The behavioural difference from bulkIndexDocuments, and the reason this
    // is a separate method: a rejected item means the documents no longer match
    // the strict mapping — which is how a regressed extractor emitting an MCQ
    // answer key would surface. Counting it would demote the control to a log.
    it('THROWS on a per-item failure rather than counting it as an error', async () => {
      mockClient.bulk.mockResolvedValue({
        body: {
          errors: true,
          items: [
            { index: { error: null } },
            {
              index: {
                error: {
                  type: 'strict_dynamic_mapping_exception',
                  reason: 'mapping set to strict, dynamic introduction of [rationale]',
                },
              },
            },
          ],
        },
      });

      await expect(
        service.bulkIndexDerivatives(
          [derivative(), derivative({ derivative_id: 'der-2' })],
          'derivative_artifacts_v3',
        ),
      ).rejects.toThrow(/rejected 1 of 2 derivative\(s\)/);
    });

    it('surfaces the rejection reason so the cause is diagnosable', async () => {
      mockClient.bulk.mockResolvedValue({
        body: {
          errors: true,
          items: [{ index: { error: { type: 'strict_dynamic_mapping_exception' } } }],
        },
      });

      await expect(
        service.bulkIndexDerivatives([derivative()], 'derivative_artifacts_v3'),
      ).rejects.toThrow(/strict_dynamic_mapping_exception/);
    });

    describe('organization_id omission', () => {
      beforeEach(() => {
        mockClient.bulk.mockResolvedValue({ body: { errors: false, items: [] } });
      });

      it('writes organization_id when it is a non-empty string', async () => {
        await service.bulkIndexDerivatives(
          [derivative({ organization_id: 'org-a' })],
          'derivative_artifacts_v3',
        );
        expect(writtenDoc()['organization_id']).toBe('org-a');
      });

      it.each([
        ['undefined', undefined],
        ['an empty string', ''],
      ])('strips organization_id when it is %s', async (_label, value) => {
        await service.bulkIndexDerivatives(
          [derivative({ organization_id: value })],
          'derivative_artifacts_v3',
        );
        // Absent, not null: `exists` is true for any present non-null value,
        // so an empty string would flip the row out of the public branch.
        expect(
          Object.prototype.hasOwnProperty.call(writtenDoc(), 'organization_id'),
        ).toBe(false);
      });
    });
  });

  describe('searchDerivatives', () => {
    const hit = (source: Record<string, unknown>) => ({
      body: {
        hits: {
          total: { value: 1 },
          max_score: 1.5,
          hits: [{ _id: 'der-1', _score: 1.5, _source: source }],
        },
        timed_out: false,
      },
    });

    const VISIBILITY_FILTER = { bool: { should: [], minimum_should_match: 1 } };

    it('queries the derivatives alias, not the keyword index', async () => {
      mockClient.search.mockResolvedValue(hit({ derivative_id: 'der-1' }));

      await service.searchDerivatives({
        query: 'estafa',
        visibilityFilter: VISIBILITY_FILTER,
      });

      const [args] = mockClient.search.mock.calls[0] as [{ index: string }];
      expect(args.index).toBe(DERIVATIVES_INDEX);
    });

    it('passes the visibility filter straight into the query', async () => {
      mockClient.search.mockResolvedValue(hit({ derivative_id: 'der-1' }));

      await service.searchDerivatives({
        query: 'estafa',
        visibilityFilter: VISIBILITY_FILTER,
      });

      const [args] = mockClient.search.mock.calls[0] as [
        { body: Record<string, unknown> },
      ];
      const bool = (args.body['query'] as Record<string, unknown>)['bool'] as Record<
        string,
        unknown
      >;
      expect(bool['filter']).toEqual([VISIBILITY_FILTER]);
    });

    it('strips MCQ answer-key fields from every returned _source', async () => {
      // Third layer of defence. Unreachable via the rebuild job — the extractor
      // never emits these and the strict mapping has no field for them — so this
      // covers a hand-written document, a restored snapshot, or a future mapping
      // change.
      mockClient.search.mockResolvedValue(
        hit({
          derivative_id: 'mcq-1',
          derivative_type: 'mcq_question',
          title: 'MCQ',
          body_text: 'Stem and options',
          rationale: 'LEAKED',
          isCorrect: true,
          is_correct: true,
          explanation: 'ALSO LEAKED',
        }),
      );

      const result = await service.searchDerivatives({
        query: 'exclusionary',
        visibilityFilter: VISIBILITY_FILTER,
      });

      const source = result.items[0]!.source;
      for (const forbidden of ['rationale', 'isCorrect', 'is_correct', 'explanation']) {
        expect(Object.prototype.hasOwnProperty.call(source, forbidden)).toBe(false);
      }
      // The legitimate fields survive.
      expect(source['title']).toBe('MCQ');
      expect(source['body_text']).toBe('Stem and options');
    });

    it('is a no-op for a document the rebuild job actually writes', async () => {
      // Pins the claim in sanitizeDerivativeSource's comment: for real documents
      // this layer changes nothing, so it cannot mask a extraction regression.
      const realistic = {
        derivative_id: 'der-1',
        derivative_type: 'mcq_question',
        title: 'MCQ on the exclusionary rule',
        body_text: 'Under what doctrine is evidence excluded?',
        visibility: 'public_editorial',
        is_published: true,
        created_at: '2026-04-20T00:00:00.000Z',
      };
      expect(sanitizeDerivativeSource(realistic)).toEqual(realistic);
    });

    it('reports timed_out so the caller can warn about partial results', async () => {
      mockClient.search.mockResolvedValue({
        body: {
          hits: { total: { value: 0 }, max_score: null, hits: [] },
          timed_out: true,
        },
      });

      const result = await service.searchDerivatives({
        query: 'estafa',
        visibilityFilter: VISIBILITY_FILTER,
      });
      expect(result.timedOut).toBe(true);
    });
  });

  describe('setRefreshInterval', () => {
    it('puts the interval on the named index', async () => {
      mockClient.indices.putSettings.mockResolvedValue({ body: {} });
      await service.setRefreshInterval('derivative_artifacts_v3', '30s');
      expect(mockClient.indices.putSettings).toHaveBeenCalledWith({
        index: 'derivative_artifacts_v3',
        body: { index: { refresh_interval: '30s' } },
      });
    });
  });

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

    it('should add must_not.terms when excludeDocumentIds is provided', async () => {
      mockClient.search.mockResolvedValue({
        body: {
          hits: { total: { value: 0 }, max_score: null, hits: [] },
          timed_out: false,
        },
      });

      await service.searchKeyword({
        query: 'test',
        excludeDocumentIds: ['suppressed-1', 'suppressed-2'],
      });

      expect(mockClient.search).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            query: expect.objectContaining({
              bool: expect.objectContaining({
                must_not: expect.arrayContaining([
                  { terms: { document_id: ['suppressed-1', 'suppressed-2'] } },
                ]),
              }),
            }),
          }),
        }),
      );
    });

    it('should NOT add must_not when excludeDocumentIds is empty', async () => {
      mockClient.search.mockResolvedValue({
        body: {
          hits: { total: { value: 0 }, max_score: null, hits: [] },
          timed_out: false,
        },
      });

      await service.searchKeyword({ query: 'test', excludeDocumentIds: [] });

      const call = mockClient.search.mock.calls[0]![0] as {
        body: { query: { bool: Record<string, unknown> } };
      };
      expect(call.body.query.bool['must_not']).toBeUndefined();
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
    const vectorDoc = (id: string, sectionId?: string) => ({
      document_id: id,
      ...(sectionId ? { section_id: sectionId } : {}),
      document_type: 'case',
      is_official: true,
      is_published: true,
      embedding_vector: [0.1],
      text_snippet: 'snippet',
      title: 'Test',
    });

    it('should return zeros for empty array', async () => {
      const result = await service.bulkIndexVectorDocuments([]);
      expect(result).toEqual({ indexed: 0, errors: 0, failedIds: [] });
    });

    it('should bulk index vector documents', async () => {
      mockClient.bulk.mockResolvedValue({
        body: { errors: false, items: [] },
      });

      const result = await service.bulkIndexVectorDocuments([vectorDoc('doc-1')]);

      expect(result).toEqual({ indexed: 1, errors: 0, failedIds: [] });
    });

    // The backfill records a per-document outcome, so an aggregate error count
    // is not enough — it has to know WHICH chunk was rejected.
    it('names the rejected ids and the first reason', async () => {
      mockClient.bulk.mockResolvedValue({
        body: {
          errors: true,
          items: [
            { index: { _id: 'sec-1' } },
            {
              index: {
                _id: 'sec-2',
                error: { type: 'mapper_parsing_exception', reason: 'bad vector width' },
              },
            },
          ],
        },
      });

      const result = await service.bulkIndexVectorDocuments([
        vectorDoc('doc-1', 'sec-1'),
        vectorDoc('doc-1', 'sec-2'),
      ]);

      expect(result.indexed).toBe(1);
      expect(result.errors).toBe(1);
      expect(result.failedIds).toEqual(['sec-2']);
      expect(result.firstErrorReason).toBe('bad vector width');
    });
  });

  // ---- findExistingVectorIds ----

  describe('findExistingVectorIds', () => {
    it('returns only the ids the index reports as found', async () => {
      mockClient.mget = jest.fn().mockResolvedValue({
        body: {
          docs: [
            { _id: 'sec-1', found: true },
            { _id: 'sec-2', found: false },
            { _id: 'doc-1', found: true },
          ],
        },
      });

      const found = await service.findExistingVectorIds(['sec-1', 'sec-2', 'doc-1']);

      expect([...found].sort()).toEqual(['doc-1', 'sec-1']);
      expect(mockClient.mget).toHaveBeenCalledWith(
        expect.objectContaining({ _source: false }),
      );
    });

    it('short-circuits on an empty id list', async () => {
      mockClient.mget = jest.fn();
      const found = await service.findExistingVectorIds([]);
      expect(found.size).toBe(0);
      expect(mockClient.mget).not.toHaveBeenCalled();
    });

    it('chunks large id lists rather than sending one enormous mget', async () => {
      mockClient.mget = jest.fn().mockResolvedValue({ body: { docs: [] } });
      const ids = Array.from({ length: 2_500 }, (_, i) => `id-${i}`);

      await service.findExistingVectorIds(ids);

      expect(mockClient.mget).toHaveBeenCalledTimes(3);
    });

    // Reporting "nothing exists" on a transport error would make a gap
    // enumeration claim the whole corpus is missing and re-embed hours of work.
    it('propagates a transport error instead of reporting an empty index', async () => {
      mockClient.mget = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      await expect(service.findExistingVectorIds(['sec-1'])).rejects.toThrow(
        'ECONNREFUSED',
      );
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

    it('matches either court form so copied-forward vectors are still filterable', async () => {
      mockClient.search.mockResolvedValue({
        body: { hits: { hits: [] }, timed_out: false },
      });

      await service.searchVector({ vector: [0.1], filters: { court: 'supreme_court' } });

      const body = mockClient.search.mock.calls[0]![0]!.body as Record<string, unknown>;
      const knn = (body['query'] as Record<string, Record<string, unknown>>)['knn']!;
      const must = (
        (knn['filter'] as Record<string, Record<string, unknown>>)['bool'] as Record<
          string,
          unknown
        >
      )['must'] as Record<string, unknown>[];

      expect(must).toContainEqual({
        bool: {
          should: [
            { term: { court_key: 'supreme_court' } },
            { term: { court: 'Supreme Court' } },
          ],
          minimum_should_match: 1,
        },
      });
    });

    it('should throw on vector search error', async () => {
      mockClient.search.mockRejectedValue(new Error('Vector search failed'));

      await expect(
        service.searchVector({ vector: [0.1] }),
      ).rejects.toThrow('Vector search failed');
    });

    it('should add must_not.terms when excludeDocumentIds is provided', async () => {
      mockClient.search.mockResolvedValue({
        body: { hits: { hits: [] }, timed_out: false },
      });

      await service.searchVector({
        vector: [0.1],
        excludeDocumentIds: ['suppressed-1'],
      });

      expect(mockClient.search).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            query: expect.objectContaining({
              knn: expect.objectContaining({
                filter: expect.objectContaining({
                  bool: expect.objectContaining({
                    must_not: expect.arrayContaining([
                      { terms: { document_id: ['suppressed-1'] } },
                    ]),
                  }),
                }),
              }),
            }),
          }),
        }),
      );
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

  // ---- reindexInto ----

  describe('reindexInto', () => {
    // Ground truth from the Phase A production run: `_reindex` answered
    // `created: 0` for a copy that moved all 12,196 embeddings. Anything
    // derived from that number is unusable as a verification signal.
    it('measures both sides instead of believing the _reindex response', async () => {
      mockClient.reindex.mockResolvedValue({ body: { created: 0 } });
      mockClient.indices.refresh.mockResolvedValue({});
      mockClient.count
        .mockResolvedValueOnce({ body: { count: 12_196 } })
        .mockResolvedValueOnce({ body: { count: 12_196 } });

      const result = await service.reindexInto('src', 'dest');

      expect(result).toEqual({
        reportedCreated: 0,
        sourceCount: 12_196,
        destCount: 12_196,
      });
      // The count is the verification, so it does not ride on the reindex
      // call's own refresh flag.
      expect(mockClient.indices.refresh).toHaveBeenCalledWith({ index: 'dest' });
    });

    it('throws when the response carries per-document failures', async () => {
      mockClient.reindex.mockResolvedValue({
        body: { created: 5, failures: [{ id: 'doc-1', cause: 'mapper_parsing_exception' }] },
      });

      await expect(service.reindexInto('src', 'dest')).rejects.toThrow(
        /1 document failure/,
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
