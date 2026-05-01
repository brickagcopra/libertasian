import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/services/redis.service';
import {
  SUPPRESSED_DOCS_KEY,
  SuppressedDocsService,
} from './suppressed-docs.service';

describe('SuppressedDocsService', () => {
  let service: SuppressedDocsService;
  let prisma: {
    documentSimilarity: { findMany: jest.Mock };
  };
  let client: {
    del: jest.Mock;
    sadd: jest.Mock;
    expire: jest.Mock;
    smembers: jest.Mock;
    scard: jest.Mock;
  };

  beforeEach(async () => {
    client = {
      del: jest.fn().mockResolvedValue(1),
      sadd: jest.fn().mockResolvedValue(0),
      expire: jest.fn().mockResolvedValue(1),
      smembers: jest.fn().mockResolvedValue([]),
      scard: jest.fn().mockResolvedValue(0),
    };

    prisma = {
      documentSimilarity: { findMany: jest.fn() },
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

  describe('refresh', () => {
    it('suppresses non-canonical docs from exact_duplicate / mirror_duplicate', async () => {
      prisma.documentSimilarity.findMany.mockImplementation(
        ({ where }: { where: { similarityType: { in?: string[] } } }) => {
          if (where.similarityType.in) {
            return Promise.resolve([
              {
                documentAId: 'doc-A',
                documentBId: 'doc-B',
                canonicalDocumentId: 'doc-A',
              },
              {
                documentAId: 'doc-C',
                documentBId: 'doc-D',
                canonicalDocumentId: 'doc-D',
              },
            ]);
          }
          return Promise.resolve([]);
        },
      );

      const result = await service.refresh();

      expect(result.count).toBe(2);
      expect(client.sadd).toHaveBeenCalledTimes(1);
      const [key, ...ids] = client.sadd.mock.calls[0]! as [string, ...string[]];
      expect(key).toBe(SUPPRESSED_DOCS_KEY);
      expect(ids.sort()).toEqual(['doc-B', 'doc-C']);
    });

    it('suppresses the older version on version_update', async () => {
      prisma.documentSimilarity.findMany.mockImplementation(
        ({ where }: { where: { similarityType: string | { in?: string[] } } }) => {
          if (typeof where.similarityType === 'string' && where.similarityType === 'version_update') {
            return Promise.resolve([
              {
                documentA: { id: 'doc-old', versionNo: 1 },
                documentB: { id: 'doc-new', versionNo: 2 },
              },
              {
                documentA: { id: 'doc-x', versionNo: 3 },
                documentB: { id: 'doc-y', versionNo: 2 },
              },
            ]);
          }
          return Promise.resolve([]);
        },
      );

      const result = await service.refresh();

      // doc-old (lower v) and doc-y (lower v) get suppressed
      expect(result.count).toBe(2);
      const ids = client.sadd.mock.calls[0]!.slice(1) as string[];
      expect(ids.sort()).toEqual(['doc-old', 'doc-y']);
    });

    it('does NOT suppress anything for similarity_type=title', async () => {
      // findMany is only called with 'exact_duplicate'/'mirror_duplicate' or
      // 'version_update'; title rows are excluded by the WHERE clause.
      prisma.documentSimilarity.findMany.mockResolvedValue([]);

      const result = await service.refresh();

      expect(result.count).toBe(0);
      expect(client.sadd).not.toHaveBeenCalled();
    });

    it('clears the existing set before writing the new one', async () => {
      prisma.documentSimilarity.findMany.mockResolvedValue([]);

      await service.refresh();

      expect(client.del).toHaveBeenCalledWith(SUPPRESSED_DOCS_KEY);
    });
  });

  describe('getSuppressedIds', () => {
    it('returns the set members when the set is non-empty', async () => {
      client.scard.mockResolvedValue(2);
      client.smembers.mockResolvedValue(['doc-1', 'doc-2']);

      const ids = await service.getSuppressedIds();

      expect(ids).toEqual(['doc-1', 'doc-2']);
    });

    it('returns [] (no filter) when the set is empty', async () => {
      client.scard.mockResolvedValue(0);

      const ids = await service.getSuppressedIds();

      expect(ids).toEqual([]);
      expect(client.smembers).not.toHaveBeenCalled();
    });

    it('returns [] (no filter) when Redis throws — search must NOT 500', async () => {
      client.scard.mockRejectedValue(new Error('ECONNREFUSED'));

      const ids = await service.getSuppressedIds();

      expect(ids).toEqual([]);
    });
  });

  describe('getCount', () => {
    it('returns the cardinality of the set', async () => {
      client.scard.mockResolvedValue(42);

      await expect(service.getCount()).resolves.toBe(42);
    });

    it('returns 0 when Redis is unreachable', async () => {
      client.scard.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(service.getCount()).resolves.toBe(0);
    });
  });
});
