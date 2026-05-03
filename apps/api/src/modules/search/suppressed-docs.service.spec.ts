import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/services/redis.service';
import {
  SUPPRESSED_DOCS_KEY,
  SUPPRESSED_DOCS_POPULATED_KEY,
  SuppressedDocsService,
} from './suppressed-docs.service';

describe('SuppressedDocsService', () => {
  let service: SuppressedDocsService;
  let prisma: {
    documentSimilarity: { findMany: jest.Mock };
  };
  let pipeline: {
    del: jest.Mock;
    sadd: jest.Mock;
    expire: jest.Mock;
    set: jest.Mock;
    exec: jest.Mock;
  };
  let client: {
    get: jest.Mock;
    del: jest.Mock;
    smembers: jest.Mock;
    scard: jest.Mock;
    multi: jest.Mock;
  };

  const stubDuplicate = (
    aId: string,
    bId: string,
    canonicalId: string | null,
  ) => ({ documentAId: aId, documentBId: bId, canonicalDocumentId: canonicalId });

  const stubVersion = (
    aId: string,
    aVersion: number,
    bId: string,
    bVersion: number,
  ) => ({
    documentA: { id: aId, versionNo: aVersion },
    documentB: { id: bId, versionNo: bVersion },
  });

  /**
   * Wire prisma.documentSimilarity.findMany so that the duplicate-rule call
   * (similarityType={in: [...]}) returns `dupes` and the version-rule call
   * (similarityType='version_update') returns `versions`. Anything else → [].
   */
  const stubPrismaResults = (
    dupes: ReturnType<typeof stubDuplicate>[],
    versions: ReturnType<typeof stubVersion>[],
  ) => {
    prisma.documentSimilarity.findMany.mockImplementation(
      ({
        where,
      }: {
        where: { similarityType: string | { in?: string[] } };
      }) => {
        if (typeof where.similarityType === 'object' && where.similarityType.in) {
          return Promise.resolve(dupes);
        }
        if (where.similarityType === 'version_update') {
          return Promise.resolve(versions);
        }
        return Promise.resolve([]);
      },
    );
  };

  beforeEach(async () => {
    pipeline = {
      del: jest.fn().mockReturnThis(),
      sadd: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    };
    client = {
      get: jest.fn().mockResolvedValue(null),
      del: jest.fn().mockResolvedValue(1),
      smembers: jest.fn().mockResolvedValue([]),
      scard: jest.fn().mockResolvedValue(0),
      multi: jest.fn().mockReturnValue(pipeline),
    };

    prisma = {
      documentSimilarity: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SuppressedDocsService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: RedisService,
          useValue: { getClient: () => client },
        },
      ],
    }).compile();

    service = module.get<SuppressedDocsService>(SuppressedDocsService);

    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
  });

  afterEach(() => jest.clearAllMocks());

  describe('getSuppressedDocIds — cache miss (sentinel absent)', () => {
    beforeEach(() => {
      client.get.mockResolvedValue(null); // sentinel missing → miss
    });

    it('queries Postgres, applies the three-rule policy, and caches the result', async () => {
      stubPrismaResults(
        [
          stubDuplicate('doc-A', 'doc-B', 'doc-A'), // suppresses doc-B
          stubDuplicate('doc-C', 'doc-D', 'doc-D'), // suppresses doc-C
        ],
        [
          stubVersion('doc-old', 1, 'doc-new', 2), // suppresses doc-old
          stubVersion('doc-x', 3, 'doc-y', 2), // suppresses doc-y
        ],
      );

      const result = await service.getSuppressedDocIds();

      expect(result).toBeInstanceOf(Set);
      expect(Array.from(result).sort()).toEqual([
        'doc-B',
        'doc-C',
        'doc-old',
        'doc-y',
      ]);
      expect(prisma.documentSimilarity.findMany).toHaveBeenCalledTimes(2);

      // Pipeline: DEL set → SADD members → EXPIRE set → SET sentinel
      expect(pipeline.del).toHaveBeenCalledWith(SUPPRESSED_DOCS_KEY);
      expect(pipeline.sadd).toHaveBeenCalledWith(
        SUPPRESSED_DOCS_KEY,
        ...Array.from(result),
      );
      expect(pipeline.expire).toHaveBeenCalledWith(SUPPRESSED_DOCS_KEY, 3600);
      expect(pipeline.set).toHaveBeenCalledWith(
        SUPPRESSED_DOCS_POPULATED_KEY,
        '1',
        'EX',
        3600,
      );
      expect(pipeline.exec).toHaveBeenCalledTimes(1);
    });

    it('writes the sentinel even when the Postgres result is empty (no SADD)', async () => {
      stubPrismaResults([], []);

      const result = await service.getSuppressedDocIds();

      expect(result.size).toBe(0);
      expect(pipeline.sadd).not.toHaveBeenCalled();
      expect(pipeline.set).toHaveBeenCalledWith(
        SUPPRESSED_DOCS_POPULATED_KEY,
        '1',
        'EX',
        3600,
      );
    });

    it('skips title-only similarities (the WHERE clause excludes them)', async () => {
      // Prisma is only invoked with similarityType in (exact|mirror) or
      // similarityType='version_update'. Title rows never reach the result.
      stubPrismaResults([], []);

      const result = await service.getSuppressedDocIds();

      expect(result.size).toBe(0);
    });
  });

  describe('getSuppressedDocIds — cache hit (sentinel present)', () => {
    beforeEach(() => {
      client.get.mockResolvedValue('1'); // sentinel present
    });

    it('returns the cached set without hitting Postgres', async () => {
      client.scard.mockResolvedValue(2);
      client.smembers.mockResolvedValue(['doc-1', 'doc-2']);

      const result = await service.getSuppressedDocIds();

      expect(result).toEqual(new Set(['doc-1', 'doc-2']));
      expect(prisma.documentSimilarity.findMany).not.toHaveBeenCalled();
      expect(pipeline.exec).not.toHaveBeenCalled();
    });

    it('returns an empty Set without hitting Postgres when the cached set is empty', async () => {
      client.scard.mockResolvedValue(0);

      const result = await service.getSuppressedDocIds();

      expect(result).toEqual(new Set());
      expect(client.smembers).not.toHaveBeenCalled();
      expect(prisma.documentSimilarity.findMany).not.toHaveBeenCalled();
    });

    it('skips the must_not.terms inline cap and returns empty Set when oversized', async () => {
      client.scard.mockResolvedValue(10_000);

      const result = await service.getSuppressedDocIds();

      expect(result).toEqual(new Set());
      expect(client.smembers).not.toHaveBeenCalled();
    });
  });

  describe('getSuppressedDocIds — defensive paths', () => {
    it('returns empty Set when Postgres throws (search must not 500)', async () => {
      client.get.mockResolvedValue(null);
      prisma.documentSimilarity.findMany.mockRejectedValue(
        new Error('connection refused'),
      );

      const result = await service.getSuppressedDocIds();

      expect(result).toEqual(new Set());
      expect(pipeline.exec).not.toHaveBeenCalled();
    });

    it('falls through to Postgres when Redis read throws', async () => {
      client.get.mockRejectedValue(new Error('ECONNREFUSED'));
      stubPrismaResults([stubDuplicate('a', 'b', 'a')], []);

      const result = await service.getSuppressedDocIds();

      expect(result).toEqual(new Set(['b']));
      expect(prisma.documentSimilarity.findMany).toHaveBeenCalledTimes(2);
    });

    it('returns the Postgres result when Redis write throws (degraded but correct)', async () => {
      client.get.mockResolvedValue(null);
      pipeline.exec.mockRejectedValue(new Error('Redis down'));
      stubPrismaResults([stubDuplicate('a', 'b', 'a')], []);

      const result = await service.getSuppressedDocIds();

      expect(result).toEqual(new Set(['b']));
    });
  });

  describe('refresh', () => {
    it('deletes both keys then re-populates from Postgres', async () => {
      // First sentinel read returns null because we just DEL'd.
      client.get.mockResolvedValue(null);
      stubPrismaResults([stubDuplicate('a', 'b', 'a')], []);

      const result = await service.refresh();

      expect(client.del).toHaveBeenCalledWith(
        SUPPRESSED_DOCS_KEY,
        SUPPRESSED_DOCS_POPULATED_KEY,
      );
      expect(prisma.documentSimilarity.findMany).toHaveBeenCalledTimes(2);
      expect(pipeline.set).toHaveBeenCalledWith(
        SUPPRESSED_DOCS_POPULATED_KEY,
        '1',
        'EX',
        3600,
      );
      expect(result).toEqual({ count: 1 });
    });

    it('still re-populates from Postgres when DEL fails (Redis down)', async () => {
      client.del.mockRejectedValue(new Error('Redis down'));
      client.get.mockRejectedValue(new Error('Redis down'));
      stubPrismaResults([stubDuplicate('a', 'b', 'a')], []);

      const result = await service.refresh();

      expect(result).toEqual({ count: 1 });
    });
  });

  describe('getCount', () => {
    it('returns the cardinality of the populated set', async () => {
      client.get.mockResolvedValue('1');
      client.scard.mockResolvedValue(42);
      client.smembers.mockResolvedValue(
        Array.from({ length: 42 }, (_, i) => `doc-${i}`),
      );

      await expect(service.getCount()).resolves.toBe(42);
    });

    it('returns 0 when both Redis and Postgres are unreachable', async () => {
      client.get.mockRejectedValue(new Error('Redis down'));
      prisma.documentSimilarity.findMany.mockRejectedValue(
        new Error('Postgres down'),
      );

      await expect(service.getCount()).resolves.toBe(0);
    });
  });
});
