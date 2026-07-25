import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../../prisma/prisma.service';
import {
  KEYWORD_INDEX,
  KEYWORD_INDEX_PHYSICAL,
  USER_UPLOADS_INDEX,
  VECTOR_INDEX,
} from './index-mappings';
import {
  INDEX_REBUILD_QUEUE,
  IndexRebuildService,
  type IndexRebuildProgress,
} from './index-rebuild.service';
import { OpenSearchService } from './opensearch.service';

/**
 * Ordered log of every side-effecting OpenSearch call the rebuild makes. The
 * safety property under test is a statement about this sequence: no destructive
 * call may appear before a successful verification.
 */
type CallLog = string[];

interface OpenSearchMock {
  embeddingDimension: number;
  indexExists: jest.Mock;
  aliasExists: jest.Mock;
  resolveAliasTargets: jest.Mock;
  createPhysicalIndex: jest.Mock;
  bulkIndexDocuments: jest.Mock;
  reindexInto: jest.Mock;
  refreshIndex: jest.Mock;
  countIndex: jest.Mock;
  swapAlias: jest.Mock;
  deleteIndex: jest.Mock;
}

function buildDocument(id: string) {
  return {
    id,
    title: `People v. Subject ${id}`,
    shortTitle: null,
    citationText: 'G.R. No. 246999',
    documentType: 'decision',
    court: 'supreme_court',
    ponente: 'HERNANDO',
    jurisdiction: 'PH',
    language: 'en',
    status: 'published',
    grNo: 'G.R. No. 246999',
    docketNo: null,
    isOfficial: true,
    isPublished: true,
    decisionDate: new Date('2026-01-21T00:00:00.000Z'),
    promulgationDate: null,
    publicationDate: null,
    createdAt: new Date('2026-01-22T00:00:00.000Z'),
    source: { id: 'source-1', trustLevel: 'official' },
    sections: [
      { id: `${id}-s1`, sectionType: 'facts', plainText: 'Facts of the case.' },
      { id: `${id}-s2`, sectionType: 'ruling', plainText: null },
    ],
    tagMaps: [{ tag: { code: 'criminal_law', tagType: 'bar_subject' } }],
  };
}

describe('IndexRebuildService', () => {
  let service: IndexRebuildService;
  let calls: CallLog;
  let openSearch: OpenSearchMock;
  let prisma: { legalDocument: { count: jest.Mock; findMany: jest.Mock } };
  let queue: { add: jest.Mock; getJob: jest.Mock };
  let verifiedCount: number;
  let pushedCount: number;

  beforeEach(async () => {
    calls = [];
    verifiedCount = 2; // 1 doc payload + 1 section payload
    pushedCount = 2;

    openSearch = {
      embeddingDimension: 384,
      indexExists: jest.fn(async () => false),
      aliasExists: jest.fn(async () => false),
      resolveAliasTargets: jest.fn(async () => []),
      createPhysicalIndex: jest.fn(async (name: string) => {
        calls.push(`create:${name}`);
      }),
      bulkIndexDocuments: jest.fn(async (docs: unknown[], target: string) => {
        calls.push(`bulk:${target}:${docs.length}`);
        return { indexed: pushedCount, errors: 0 };
      }),
      reindexInto: jest.fn(async (source: string, dest: string) => {
        calls.push(`reindex:${source}->${dest}`);
        return 0;
      }),
      refreshIndex: jest.fn(async (name: string) => {
        calls.push(`refresh:${name}`);
      }),
      countIndex: jest.fn(async (name: string) => {
        calls.push(`count:${name}`);
        return verifiedCount;
      }),
      swapAlias: jest.fn(async (options: { alias: string; target: string; removeConcreteIndex?: boolean }) => {
        calls.push(
          `swap:${options.alias}->${options.target}${
            options.removeConcreteIndex ? ':removeConcrete' : ''
          }`,
        );
      }),
      deleteIndex: jest.fn(async (name: string) => {
        calls.push(`delete:${name}`);
      }),
    };

    prisma = {
      legalDocument: {
        count: jest.fn(async () => 1),
        findMany: jest
          .fn()
          .mockResolvedValueOnce([buildDocument('doc-1')])
          .mockResolvedValue([]),
      },
    };

    queue = { add: jest.fn(), getJob: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IndexRebuildService,
        { provide: PrismaService, useValue: prisma },
        { provide: OpenSearchService, useValue: openSearch },
        { provide: getQueueToken(INDEX_REBUILD_QUEUE), useValue: queue },
        {
          provide: ConfigService,
          useValue: { get: jest.fn((_key: string, fallback?: unknown) => fallback) },
        },
      ],
    }).compile();

    service = module.get(IndexRebuildService);
  });

  const run = async (dryRun = false) => {
    const progress: IndexRebuildProgress[] = [];
    const result = await service.runRebuild(
      { triggeredByUserId: 'user-1', organizationId: 'org-1', dryRun },
      async (p) => {
        progress.push(p);
      },
    );
    return { result, progress };
  };

  describe('ordering safety', () => {
    it('never swaps or deletes before a successful verification', async () => {
      const { result } = await run();

      const verifyAt = calls.indexOf(`count:${KEYWORD_INDEX_PHYSICAL}`);
      const firstDestructive = calls.findIndex(
        (call) => call.startsWith('swap:') || call.startsWith('delete:'),
      );

      expect(verifyAt).toBeGreaterThanOrEqual(0);
      expect(firstDestructive).toBeGreaterThan(verifyAt);
      expect(result.aliasSwapped).toBe(true);
    });

    it('creates → reindexes → refreshes → verifies → swaps, in that order', async () => {
      await run();

      expect(calls).toEqual([
        `create:${KEYWORD_INDEX_PHYSICAL}`,
        `create:${VECTOR_INDEX}_v2`,
        `create:${USER_UPLOADS_INDEX}_v2`,
        `bulk:${KEYWORD_INDEX_PHYSICAL}:2`,
        `refresh:${KEYWORD_INDEX_PHYSICAL}`,
        `count:${KEYWORD_INDEX_PHYSICAL}`,
        `swap:${KEYWORD_INDEX}->${KEYWORD_INDEX_PHYSICAL}`,
        `swap:${VECTOR_INDEX}->${VECTOR_INDEX}_v2`,
        `swap:${USER_UPLOADS_INDEX}->${USER_UPLOADS_INDEX}_v2`,
      ]);
    });

    it('aborts without deleting anything when the count check fails', async () => {
      verifiedCount = 0;

      await expect(run()).rejects.toThrow(/aborted before alias swap/);

      expect(calls.some((call) => call.startsWith('swap:'))).toBe(false);
      expect(calls.some((call) => call.startsWith('delete:'))).toBe(false);
      expect(openSearch.swapAlias).not.toHaveBeenCalled();
    });

    it('aborts when PostgreSQL yields no documents at all', async () => {
      prisma.legalDocument.findMany.mockReset();
      prisma.legalDocument.findMany.mockResolvedValue([]);
      verifiedCount = 0;

      await expect(run()).rejects.toThrow(/aborted before alias swap/);
      expect(openSearch.swapAlias).not.toHaveBeenCalled();
    });

    // The self-referential trap: a bulk pass that silently drops most payloads
    // leaves `pushed` and `verifiedCount` agreeing at a low number, so the
    // round-trip check passes. Only the source-derived floor catches it.
    it('aborts when far fewer entries are pushed than there are source documents', async () => {
      prisma.legalDocument.count.mockResolvedValue(17_135);
      pushedCount = 12; // bulk silently dropped the rest
      verifiedCount = 12; // ...and OpenSearch faithfully reports the same

      await expect(run()).rejects.toThrow(
        /only 12 entries were indexed for 17135 PostgreSQL documents/,
      );

      expect(calls.some((call) => call.startsWith('swap:'))).toBe(false);
      expect(openSearch.swapAlias).not.toHaveBeenCalled();
    });

    it('accepts a run where every document contributed at least one entry', async () => {
      prisma.legalDocument.count.mockResolvedValue(1);
      pushedCount = 2; // 1 doc-level entry + 1 section entry
      verifiedCount = 2;

      const { result } = await run();

      expect(result.aliasSwapped).toBe(true);
    });

    it('tolerates a shortfall inside the 1% window', async () => {
      prisma.legalDocument.count.mockResolvedValue(1);
      pushedCount = 1000;
      verifiedCount = 995;

      const { result } = await run();

      expect(result.aliasSwapped).toBe(true);
      expect(result.verifiedCount).toBe(995);
    });

    it('rejects a shortfall outside the 1% window', async () => {
      pushedCount = 1000;
      verifiedCount = 980;

      await expect(run()).rejects.toThrow(/aborted before alias swap/);
    });
  });

  describe('alias swap', () => {
    it('deletes the legacy concrete index in the same updateAliases call', async () => {
      // Production state: `legal_documents_keyword` exists as a real index and
      // is NOT an alias, so it must be removed atomically with the alias add.
      openSearch.indexExists.mockImplementation(async (name: string) =>
        [KEYWORD_INDEX, VECTOR_INDEX, USER_UPLOADS_INDEX].includes(name),
      );
      openSearch.aliasExists.mockResolvedValue(false);

      await run();

      expect(openSearch.swapAlias).toHaveBeenCalledWith({
        alias: KEYWORD_INDEX,
        target: KEYWORD_INDEX_PHYSICAL,
        removeConcreteIndex: true,
      });
      expect(openSearch.deleteIndex).not.toHaveBeenCalled();
    });

    it('detaches the previous physical index when the alias already exists', async () => {
      openSearch.aliasExists.mockImplementation(async (name: string) =>
        name === KEYWORD_INDEX,
      );
      openSearch.resolveAliasTargets.mockImplementation(async (name: string) =>
        name === KEYWORD_INDEX ? [`${KEYWORD_INDEX}_v1`] : [],
      );

      await run();

      expect(openSearch.swapAlias).toHaveBeenCalledWith({
        alias: KEYWORD_INDEX,
        target: KEYWORD_INDEX_PHYSICAL,
        detachFrom: [`${KEYWORD_INDEX}_v1`],
      });
    });

    it('allocates a suffixed name when the preferred physical index is taken', async () => {
      openSearch.indexExists.mockImplementation(async (name: string) =>
        name === KEYWORD_INDEX_PHYSICAL,
      );

      const { result } = await run();

      expect(result.keywordTarget).toBe(`${KEYWORD_INDEX_PHYSICAL}_r1`);
    });
  });

  describe('dry run', () => {
    it('builds and verifies but leaves every alias untouched', async () => {
      const { result } = await run(true);

      expect(result.aliasSwapped).toBe(false);
      expect(openSearch.swapAlias).not.toHaveBeenCalled();
      expect(calls).toContain(`count:${KEYWORD_INDEX_PHYSICAL}`);
    });
  });

  describe('vector index handling', () => {
    it('copies the existing vector index instead of re-embedding', async () => {
      openSearch.indexExists.mockImplementation(async (name: string) =>
        name === VECTOR_INDEX,
      );

      await run();

      expect(openSearch.reindexInto).toHaveBeenCalledWith(
        VECTOR_INDEX,
        `${VECTOR_INDEX}_v2`,
      );
    });

    it('does not fail the rebuild when the vector copy errors', async () => {
      openSearch.indexExists.mockImplementation(async (name: string) =>
        name === VECTOR_INDEX,
      );
      openSearch.reindexInto.mockRejectedValue(new Error('knn plugin missing'));

      const { result } = await run();

      expect(result.aliasSwapped).toBe(true);
    });
  });

  describe('rollbackAlias', () => {
    it('rejects an alias outside the known topology', async () => {
      await expect(service.rollbackAlias('some_other_index', 'x_v1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects a target that does not exist', async () => {
      openSearch.indexExists.mockResolvedValue(false);
      await expect(
        service.rollbackAlias(KEYWORD_INDEX, `${KEYWORD_INDEX}_v1`),
      ).rejects.toThrow(/does not exist/);
    });

    it('rejects a target that is itself an alias', async () => {
      openSearch.indexExists.mockResolvedValue(true);
      openSearch.aliasExists.mockResolvedValue(true);
      await expect(
        service.rollbackAlias(KEYWORD_INDEX, `${KEYWORD_INDEX}_v1`),
      ).rejects.toThrow(/is an alias, not a physical index/);
    });

    it('repoints the alias and reports the previous target', async () => {
      openSearch.indexExists.mockResolvedValue(true);
      openSearch.aliasExists.mockResolvedValue(false);
      openSearch.resolveAliasTargets.mockResolvedValue([KEYWORD_INDEX_PHYSICAL]);

      const result = await service.rollbackAlias(KEYWORD_INDEX, `${KEYWORD_INDEX}_v1`);

      expect(result.previousTargets).toEqual([KEYWORD_INDEX_PHYSICAL]);
      expect(openSearch.swapAlias).toHaveBeenCalledWith({
        alias: KEYWORD_INDEX,
        target: `${KEYWORD_INDEX}_v1`,
        detachFrom: [KEYWORD_INDEX_PHYSICAL],
      });
    });
  });

  describe('enqueueRebuild', () => {
    it('returns the BullMQ job id', async () => {
      queue.add.mockResolvedValue({ id: 'job-42' });

      await expect(
        service.enqueueRebuild({
          triggeredByUserId: 'u',
          organizationId: 'o',
          dryRun: false,
        }),
      ).resolves.toEqual({ jobId: 'job-42' });
    });

    it('throws when BullMQ returns a job without an id', async () => {
      queue.add.mockResolvedValue({});

      await expect(
        service.enqueueRebuild({
          triggeredByUserId: 'u',
          organizationId: 'o',
          dryRun: false,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
