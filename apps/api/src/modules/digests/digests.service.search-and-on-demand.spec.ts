import { NotFoundException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { Test, type TestingModule } from '@nestjs/testing';

import { PrismaService } from '../../prisma/prisma.service';
import { DigestsService } from './digests.service';

/**
 * Focused unit tests for the PR2 additions — search() and generateOnDemand().
 * Separate file from digests.service.spec.ts to avoid stepping on the
 * sprawling existing suite.
 */
describe('DigestsService — search + generateOnDemand (PR2)', () => {
  let service: DigestsService;
  let prisma: {
    digest: {
      findMany: jest.Mock;
    };
    legalDocument: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
    };
    derivativeGenerationJob: {
      findFirst: jest.Mock;
      create: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      digest: { findMany: jest.fn() },
      legalDocument: { findMany: jest.fn(), findUnique: jest.fn() },
      derivativeGenerationJob: { findFirst: jest.fn(), create: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DigestsService,
        { provide: PrismaService, useValue: prisma },
        { provide: getQueueToken('digests'), useValue: { add: jest.fn() } },
      ],
    }).compile();

    service = module.get<DigestsService>(DigestsService);
  });

  afterEach(() => jest.clearAllMocks());

  // ---- search() ----

  describe('search', () => {
    it('filters to public_editorial + approved and matches the query across title/gr/citation', async () => {
      prisma.digest.findMany.mockResolvedValue([]);
      prisma.legalDocument.findMany.mockResolvedValue([]);

      await service.search({ q: 'velasco' });

      expect(prisma.digest.findMany).toHaveBeenCalledTimes(1);
      const arg = prisma.digest.findMany.mock.calls[0]![0] as {
        where: {
          visibility: string;
          reviewStatus: string;
          OR: Array<Record<string, unknown>>;
        };
      };
      expect(arg.where.visibility).toBe('public_editorial');
      expect(arg.where.reviewStatus).toBe('approved');
      expect(arg.where.OR).toHaveLength(4);
      // First OR clause should be a title contains-insensitive.
      expect(arg.where.OR[0]).toEqual({
        title: { contains: 'velasco', mode: 'insensitive' },
      });
    });

    it('orders by updatedAt desc so freshly-approved digests surface', async () => {
      prisma.digest.findMany.mockResolvedValue([]);
      prisma.legalDocument.findMany.mockResolvedValue([]);

      await service.search({ q: 'velasco' });

      const arg = prisma.digest.findMany.mock.calls[0]![0] as {
        orderBy: unknown;
      };
      expect(arg.orderBy).toEqual([{ updatedAt: 'desc' }, { id: 'desc' }]);
    });

    it('returns hasMore + cursor when more than limit rows exist', async () => {
      const rows = Array.from({ length: 21 }).map((_, i) => ({
        id: `d-${i}`,
        title: `Digest ${i}`,
        createdAt: new Date(),
      }));
      prisma.digest.findMany.mockResolvedValue(rows);

      const result = await service.search({ q: 'v', limit: 20 });

      expect(result.results).toHaveLength(20);
      expect(result.hasMore).toBe(true);
      expect(result.cursor).toBe('d-19');
      // matchedDocuments only populated on empty-results path.
      expect(result.matchedDocuments).toEqual([]);
      expect(prisma.legalDocument.findMany).not.toHaveBeenCalled();
    });

    it('surfaces matchedDocuments only when digest results are empty AND query is non-empty', async () => {
      prisma.digest.findMany.mockResolvedValue([]);
      prisma.legalDocument.findMany.mockResolvedValue([
        { id: 'ld-1', title: 'People v. Dy', grNo: 'G.R. No. 1', citationText: 'G.R. No. 1' },
      ]);

      const result = await service.search({ q: 'dy' });

      expect(result.results).toEqual([]);
      expect(result.matchedDocuments).toHaveLength(1);
      expect(prisma.legalDocument.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5 }),
      );
    });

    it('does not fall through to legalDocument.findMany when query is empty', async () => {
      prisma.digest.findMany.mockResolvedValue([]);

      const result = await service.search({});

      expect(result.matchedDocuments).toEqual([]);
      expect(prisma.legalDocument.findMany).not.toHaveBeenCalled();
    });
  });

  // ---- generateOnDemand() ----

  describe('generateOnDemand', () => {
    it('throws NotFoundException when the legal document does not exist', async () => {
      prisma.legalDocument.findUnique.mockResolvedValue(null);

      await expect(
        service.generateOnDemand('missing-doc', 'user-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns the existing job if one is already pending/running for this user+doc (idempotent button)', async () => {
      prisma.legalDocument.findUnique.mockResolvedValue({ id: 'doc-1' });
      prisma.derivativeGenerationJob.findFirst.mockResolvedValue({
        id: 'job-existing',
        status: 'running',
      });

      const result = await service.generateOnDemand('doc-1', 'user-1');

      expect(result).toEqual({ jobId: 'job-existing', status: 'running' });
      expect(prisma.derivativeGenerationJob.create).not.toHaveBeenCalled();
    });

    it('inserts a new derivative_generation_jobs row with trigger_type=on_demand and returns 202-shaped payload', async () => {
      prisma.legalDocument.findUnique.mockResolvedValue({ id: 'doc-1' });
      prisma.derivativeGenerationJob.findFirst.mockResolvedValue(null);
      prisma.derivativeGenerationJob.create.mockResolvedValue({
        id: 'job-new',
        status: 'pending',
      });

      const result = await service.generateOnDemand('doc-1', 'user-1');

      expect(prisma.derivativeGenerationJob.create).toHaveBeenCalledWith({
        data: {
          derivativeType: 'case_digest',
          triggerType: 'on_demand',
          sourceDocumentId: 'doc-1',
          triggeredByUserId: 'user-1',
          status: 'pending',
        },
        select: { id: true, status: true },
      });
      expect(result).toEqual({ jobId: 'job-new', status: 'pending' });
    });
  });
});
