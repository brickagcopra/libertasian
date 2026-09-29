import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import { RedisService } from '../../common/services/redis.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmbeddingClientService } from './embedding-client.service';
import { OpenSearchService, type IndexDocumentPayload } from './opensearch.service';
import { PonenteDirectoryService } from './ponente-directory.service';
import { SearchService } from './search.service';
import { chunkSection } from './section-chunks';
import { SuppressedDocsService } from './suppressed-docs.service';

/**
 * `indexLegalDocument` with long sections: chunk rows instead of the section
 * row in both indices, then a sweep of every row the document no longer
 * produces — the keyword sweep right after the keyword writes, the vector
 * sweep only once every new vector has landed.
 */
describe('SearchService — section chunks', () => {
  let service: SearchService;
  let prisma: { legalDocument: { findUnique: jest.Mock } };
  let openSearch: {
    indexDocument: jest.Mock;
    bulkIndexVectorDocuments: jest.Mock;
    findKeywordIdsForDocument: jest.Mock;
    deleteKeywordIds: jest.Mock;
    findVectorIdsForDocuments: jest.Mock;
    deleteVectorIds: jest.Mock;
  };
  let embedding: { embedBatch: jest.Mock };

  const longText = 'The Court finds the petition meritorious on this ground. '
    .repeat(60)
    .trim();
  const chunks = chunkSection(longText);
  const chunkIds = chunks.map((chunk) => `sec-long:c${chunk.index}`);

  const section = (id: string, text: string | null) => ({
    id,
    sectionType: 'ruling',
    sectionLabel: null,
    plainText: text,
    pageStart: null,
    pageEnd: null,
  });

  const document = {
    id: 'doc-1',
    title: 'People v. Cruz',
    shortTitle: null,
    citationText: 'G.R. No. 12345',
    documentType: 'decision',
    court: 'Supreme Court',
    ponente: null,
    jurisdiction: 'PH',
    language: 'en',
    status: 'published',
    grNo: '12345',
    docketNo: null,
    isOfficial: true,
    isPublished: true,
    decisionDate: null,
    promulgationDate: null,
    publicationDate: null,
    createdAt: new Date('2024-01-01'),
    source: { id: 'src-1', trustLevel: 'official' },
    sections: [section('sec-short', 'S'.repeat(200)), section('sec-long', longText)],
    tagMaps: [],
  };

  /** The vector work is fire-and-forget; let its promise chain settle. */
  const settle = async () => {
    for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
  };

  const writtenKeywordRows = () =>
    openSearch.indexDocument.mock.calls.map((call) => call[0] as IndexDocumentPayload);

  beforeEach(async () => {
    prisma = { legalDocument: { findUnique: jest.fn().mockResolvedValue(document) } };
    openSearch = {
      indexDocument: jest.fn().mockResolvedValue(undefined),
      bulkIndexVectorDocuments: jest.fn(async (docs: unknown[]) => ({
        indexed: docs.length,
        errors: 0,
        failedIds: [],
      })),
      findKeywordIdsForDocument: jest.fn().mockResolvedValue({
        // What an index built before chunking holds for this document.
        ids: ['doc-1', 'sec-short', 'sec-long', 'sec-deleted'],
        incomplete: false,
      }),
      deleteKeywordIds: jest.fn(async (ids: string[]) => ({
        deleted: ids.length,
        failedIds: [],
      })),
      findVectorIdsForDocuments: jest.fn().mockResolvedValue({
        idsByDocument: new Map([['doc-1', ['doc-1', 'sec-short', 'sec-long']]]),
        incomplete: new Set(),
      }),
      deleteVectorIds: jest.fn(async (ids: string[]) => ({
        deleted: ids.length,
        failedIds: [],
      })),
    };
    embedding = {
      embedBatch: jest.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2])),
    };

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

  it('writes chunk rows for a long section instead of its one section row', async () => {
    expect(chunks.length).toBeGreaterThan(1);

    await service.indexLegalDocument('doc-1');

    const rows = writtenKeywordRows();
    // Document row unchanged: first, full text, no section fields.
    expect(rows[0]!.document_id).toBe('doc-1');
    expect(rows[0]!.plain_text).toBe(`${'S'.repeat(200)}\n\n${longText}`);
    expect(rows[0]!.section_id).toBeUndefined();
    expect(rows[0]!.chunk_index).toBeUndefined();

    const shortRows = rows.filter((row) => row.section_id === 'sec-short');
    expect(shortRows).toHaveLength(1);
    expect(shortRows[0]!.chunk_index).toBeUndefined();

    const longRows = rows.filter((row) => row.section_id === 'sec-long');
    expect(longRows).toHaveLength(chunks.length);
    longRows.forEach((row, n) => {
      expect(row).toMatchObject({
        section_id: 'sec-long',
        section_type: 'ruling',
        section_text: chunks[n]!.text,
        chunk_index: n,
        char_start: chunks[n]!.charStart,
        char_end: chunks[n]!.charEnd,
      });
    });
  });

  it('sweeps only the keyword rows the document no longer produces', async () => {
    await service.indexLegalDocument('doc-1');

    expect(openSearch.findKeywordIdsForDocument).toHaveBeenCalledWith('doc-1');
    expect(openSearch.deleteKeywordIds).toHaveBeenCalledTimes(1);
    expect(openSearch.deleteKeywordIds.mock.calls[0]![0]).toEqual(['sec-long', 'sec-deleted']);
  });

  it('does not sweep keyword rows when a keyword write fails', async () => {
    openSearch.indexDocument
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('boom'));

    await expect(service.indexLegalDocument('doc-1')).rejects.toThrow('boom');
    expect(openSearch.deleteKeywordIds).not.toHaveBeenCalled();
  });

  it('embeds each chunk and stores the whole chunk as its snippet', async () => {
    await service.indexLegalDocument('doc-1');
    await settle();

    const vectorDocs = openSearch.bulkIndexVectorDocuments.mock.calls.flatMap(
      (call) => call[0] as Record<string, unknown>[],
    );
    const longVectors = vectorDocs.filter((doc) => doc['section_id'] === 'sec-long');
    expect(longVectors).toHaveLength(chunks.length);
    longVectors.forEach((doc, n) => {
      expect(doc).toMatchObject({
        chunk_index: n,
        char_start: chunks[n]!.charStart,
        char_end: chunks[n]!.charEnd,
        text_snippet: chunks[n]!.text,
      });
    });
    const embedded = embedding.embedBatch.mock.calls.flatMap((call) => call[0] as string[]);
    for (const chunk of chunks) expect(embedded).toContain(chunk.text);
  });

  it('sweeps stale vectors only after every new vector is written', async () => {
    await service.indexLegalDocument('doc-1');
    await settle();

    expect(openSearch.deleteVectorIds).toHaveBeenCalledTimes(1);
    expect(openSearch.deleteVectorIds.mock.calls[0]![0]).toEqual(['sec-long']);
    const lastWrite = Math.max(
      ...openSearch.bulkIndexVectorDocuments.mock.invocationCallOrder,
    );
    expect(openSearch.deleteVectorIds.mock.invocationCallOrder[0]).toBeGreaterThan(lastWrite);
    // The chunk ids themselves are never candidates for deletion.
    for (const id of chunkIds) {
      expect(openSearch.deleteVectorIds.mock.calls[0]![0]).not.toContain(id);
    }
  });

  it('keeps the old vectors when any new vector fails to write', async () => {
    openSearch.bulkIndexVectorDocuments.mockResolvedValueOnce({
      indexed: 0,
      errors: 1,
      failedIds: ['sec-long:c0'],
      firstErrorReason: 'mapper_parsing_exception',
    });

    await service.indexLegalDocument('doc-1');
    await settle();

    expect(openSearch.deleteVectorIds).not.toHaveBeenCalled();
  });

  it('keeps the old vectors when the embedding service is down', async () => {
    embedding.embedBatch.mockResolvedValue(null);

    await service.indexLegalDocument('doc-1');
    await settle();

    expect(openSearch.deleteVectorIds).not.toHaveBeenCalled();
  });
});
