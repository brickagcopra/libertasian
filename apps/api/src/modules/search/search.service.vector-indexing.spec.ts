import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import { RedisService } from '../../common/services/redis.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmbeddingClientService } from './embedding-client.service';
import { OpenSearchService } from './opensearch.service';
import { PonenteDirectoryService } from './ponente-directory.service';
import { SearchService } from './search.service';
import { SuppressedDocsService } from './suppressed-docs.service';

/**
 * The LIVE vector-indexing path.
 *
 * On 2026-09-02 the vector index held 16,182 chunks against the keyword
 * index's 90,008 and nothing anywhere had noticed, because
 * `indexLegalDocument` handed vector failures to `.catch(warn)` and a null
 * `embedBatch` to a bare `continue`. These tests are about the counters that
 * make that path answerable — a silent failure is the bug, not the failure.
 */
describe('SearchService — live vector indexing', () => {
  let service: SearchService;
  let prisma: { legalDocument: { findUnique: jest.Mock } };
  let openSearch: {
    indexDocument: jest.Mock;
    bulkIndexVectorDocuments: jest.Mock;
  };
  let embedding: { embedBatch: jest.Mock };

  const section = (id: string, text: string | null) => ({
    id,
    sectionType: 'body',
    sectionLabel: null,
    plainText: text,
    pageStart: null,
    pageEnd: null,
  });

  const document = (sections: ReturnType<typeof section>[]) => ({
    id: 'doc-1',
    title: 'Republic Act No. 386',
    shortTitle: null,
    citationText: 'R.A. No. 386',
    documentType: 'republic_act',
    court: null,
    ponente: null,
    jurisdiction: 'PH',
    language: 'en',
    status: 'published',
    grNo: null,
    docketNo: null,
    isOfficial: true,
    isPublished: true,
    decisionDate: null,
    promulgationDate: null,
    publicationDate: null,
    createdAt: new Date('2024-01-01'),
    source: { id: 'src-1', trustLevel: 'official' },
    sections,
    tagMaps: [],
  });

  /** The vector work is fire-and-forget; let its promise chain settle. */
  const settle = () => new Promise((resolve) => setImmediate(resolve));

  beforeEach(async () => {
    prisma = { legalDocument: { findUnique: jest.fn() } };
    openSearch = {
      indexDocument: jest.fn().mockResolvedValue(undefined),
      bulkIndexVectorDocuments: jest
        .fn()
        .mockResolvedValue({ indexed: 0, errors: 0, failedIds: [] }),
    };
    embedding = { embedBatch: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: RedisService,
          useValue: { get: jest.fn(), set: jest.fn(), getClient: jest.fn(() => ({})) },
        },
        { provide: OpenSearchService, useValue: openSearch },
        { provide: EmbeddingClientService, useValue: embedding },
        {
          provide: SuppressedDocsService,
          useValue: { getSuppressedDocIds: jest.fn(), refresh: jest.fn(), getCount: jest.fn() },
        },
        {
          provide: PonenteDirectoryService,
          useValue: { getPonenteNames: jest.fn(), invalidate: jest.fn() },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn((_k: string, d?: unknown) => d) },
        },
      ],
    }).compile();

    service = module.get(SearchService);
    jest.spyOn(service['logger'], 'log').mockImplementation(() => undefined);
    jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
  });

  it('starts with a clean slate', () => {
    expect(service.getVectorIndexStats()).toMatchObject({
      documentsAttempted: 0,
      documentsSucceeded: 0,
      documentsFailed: 0,
      chunksIndexed: 0,
      chunksFailed: 0,
      embeddingBatchFailures: 0,
      lastFailureReason: null,
    });
  });

  it('counts a clean indexing pass', async () => {
    prisma.legalDocument.findUnique.mockResolvedValue(
      document([section('sec-a', 'A'.repeat(80))]),
    );
    embedding.embedBatch.mockResolvedValue([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
    openSearch.bulkIndexVectorDocuments.mockResolvedValue({
      indexed: 2,
      errors: 0,
      failedIds: [],
    });

    await service.indexLegalDocument('doc-1');
    await settle();

    expect(service.getVectorIndexStats()).toMatchObject({
      documentsAttempted: 1,
      documentsSucceeded: 1,
      documentsFailed: 0,
      chunksIndexed: 2,
      chunksFailed: 0,
    });
  });

  // This is the exact failure that hid the 81% gap: `embedBatch` returned null
  // and the loop did `continue`, so the document reported as indexed.
  it('counts an embedding-service outage instead of silently continuing', async () => {
    prisma.legalDocument.findUnique.mockResolvedValue(
      document([section('sec-a', 'A'.repeat(80))]),
    );
    embedding.embedBatch.mockResolvedValue(null);

    await service.indexLegalDocument('doc-1');
    await settle();

    const stats = service.getVectorIndexStats();
    expect(stats.embeddingBatchFailures).toBe(1);
    expect(stats.documentsFailed).toBe(1);
    expect(stats.documentsSucceeded).toBe(0);
    expect(stats.chunksFailed).toBe(2); // doc-level + section
    expect(stats.chunksIndexed).toBe(0);
    expect(stats.lastFailureDocumentId).toBe('doc-1');
    expect(stats.lastFailureReason).toContain('embedding service');
    expect(stats.lastFailureAt).not.toBeNull();
  });

  it('counts chunks OpenSearch rejected', async () => {
    prisma.legalDocument.findUnique.mockResolvedValue(
      document([section('sec-a', 'A'.repeat(80))]),
    );
    embedding.embedBatch.mockResolvedValue([
      [0.1],
      [0.2],
    ]);
    openSearch.bulkIndexVectorDocuments.mockResolvedValue({
      indexed: 1,
      errors: 1,
      failedIds: ['sec-a'],
      firstErrorReason: 'mapper_parsing_exception',
    });

    await service.indexLegalDocument('doc-1');
    await settle();

    const stats = service.getVectorIndexStats();
    expect(stats.chunksIndexed).toBe(1);
    expect(stats.chunksFailed).toBe(1);
    expect(stats.documentsFailed).toBe(1);
    expect(stats.lastFailureReason).toContain('mapper_parsing_exception');
  });

  it('counts an unhandled throw from the vector path', async () => {
    prisma.legalDocument.findUnique.mockResolvedValue(
      document([section('sec-a', 'A'.repeat(80))]),
    );
    embedding.embedBatch.mockRejectedValue(new Error('socket hang up'));

    await service.indexLegalDocument('doc-1');
    await settle();

    const stats = service.getVectorIndexStats();
    expect(stats.documentsFailed).toBe(1);
    expect(stats.lastFailureReason).toContain('socket hang up');
  });

  it('keeps the keyword index working when the vector path fails', async () => {
    prisma.legalDocument.findUnique.mockResolvedValue(
      document([section('sec-a', 'A'.repeat(80))]),
    );
    embedding.embedBatch.mockResolvedValue(null);

    await service.indexLegalDocument('doc-1');
    await settle();

    // Vector indexing stays best-effort: a slow embedding service must never
    // stop a document reaching keyword search. It just must not do so quietly.
    expect(openSearch.indexDocument).toHaveBeenCalledTimes(2);
  });

  it('does not attempt a document with nothing embeddable', async () => {
    prisma.legalDocument.findUnique.mockResolvedValue(
      document([section('sec-a', null)]),
    );

    await service.indexLegalDocument('doc-1');
    await settle();

    expect(embedding.embedBatch).not.toHaveBeenCalled();
    expect(service.getVectorIndexStats().documentsAttempted).toBe(0);
  });

  it('returns a copy so a caller cannot mutate the counters', () => {
    const stats = service.getVectorIndexStats() as { documentsFailed: number };
    stats.documentsFailed = 999;
    expect(service.getVectorIndexStats().documentsFailed).toBe(0);
  });
});
