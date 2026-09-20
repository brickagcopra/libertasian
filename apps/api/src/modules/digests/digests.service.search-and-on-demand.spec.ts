import { NotFoundException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, type TestingModule } from '@nestjs/testing';

import { PrismaService } from '../../prisma/prisma.service';
import { PermissionsService } from '../rbac/permissions.service';
import { DigestsService } from './digests.service';

/**
 * Focused unit tests for the PR2 additions — search() and generateOnDemand().
 * Separate file from digests.service.spec.ts to avoid stepping on the
 * sprawling existing suite.
 */
/**
 * Platform-scoped reviewer validation (PR: platform RBAC authority) resolves
 * through PermissionsService, so the service now needs it. Default: nobody is
 * platform staff — individual tests opt in.
 */
const mockPermissionsService = {
  hasPlatformPermission: jest.fn().mockResolvedValue(false),
  listPlatformMembersWithPermission: jest.fn().mockResolvedValue([]),
};

describe('DigestsService — search + generateOnDemand (PR2)', () => {
  let service: DigestsService;
  let prisma: {
    digest: {
      findMany: jest.Mock;
      count: jest.Mock;
    };
    legalDocument: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
    };
    derivativeGenerationJob: {
      findFirst: jest.Mock;
      create: jest.Mock;
    };
    subject: { findMany: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      digest: { findMany: jest.fn(), count: jest.fn().mockResolvedValue(0) },
      legalDocument: { findMany: jest.fn(), findUnique: jest.fn() },
      derivativeGenerationJob: { findFirst: jest.fn(), create: jest.fn() },
      subject: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DigestsService,
        { provide: PrismaService, useValue: prisma },
        { provide: getQueueToken('digests'), useValue: { add: jest.fn() } },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: PermissionsService, useValue: mockPermissionsService },
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

  describe('search — subject filter', () => {
    it('AND-wraps the subject filter so the needle OR survives', async () => {
      prisma.digest.findMany.mockResolvedValue([]);
      prisma.legalDocument.findMany.mockResolvedValue([]);

      await service.search({ q: 'ejusdem', subjectCode: 'civil_law' });

      const where = prisma.digest.findMany.mock.calls[0]![0]!.where;
      // The needle arms are what search IS — clobbering them with the
      // subject filter would break search outright.
      expect(where.OR).toHaveLength(4);
      expect(where.AND).toEqual([
        {
          legalDocument: {
            subjectAssignments: {
              some: {
                subject: { code: 'civil_law', taxonomyVersion: 'study_8' },
              },
            },
          },
        },
      ]);
      // The public-editorial gate is untouched.
      expect(where.visibility).toBe('public_editorial');
      expect(where.reviewStatus).toBe('approved');
    });

    it('adds no AND clause when no subject is requested', async () => {
      prisma.digest.findMany.mockResolvedValue([]);
      prisma.legalDocument.findMany.mockResolvedValue([]);

      await service.search({ q: 'ejusdem' });

      expect(prisma.digest.findMany.mock.calls[0]![0]!.where.AND).toBeUndefined();
    });

    it('filters by subject with no needle at all', async () => {
      prisma.digest.findMany.mockResolvedValue([]);

      await service.search({ subjectCode: 'labor_law' });

      const where = prisma.digest.findMany.mock.calls[0]![0]!.where;
      expect(where.OR).toBeUndefined();
      expect(where.AND).toHaveLength(1);
    });
  });

  describe('subjectsSummary', () => {
    it('counts under the digests list visibility rule, not the derivatives one', async () => {
      prisma.subject.findMany.mockResolvedValue([
        {
          id: 'subj-1',
          code: 'political_law',
          name: 'Political Law',
          taxonomyVersion: 'study_8',
        },
      ]);
      prisma.digest.count.mockResolvedValue(412);

      const result = await service.subjectsSummary();

      expect(result).toEqual([
        {
          code: 'political_law',
          name: 'Political Law',
          taxonomyVersion: 'study_8',
          count: 412,
        },
      ]);

      const where = prisma.digest.count.mock.calls[0]![0]!.where;
      // Exactly the list's rule. DerivativesService.caseDigestVisibilityWhere()
      // also accepts 'ai_generated' and would print chip counts larger than
      // the list they filter.
      expect(where.reviewStatus).toBe('approved');
      expect(where.visibility).toBe('public_editorial');
      expect(where.legalDocument).toEqual({
        subjectAssignments: { some: { subjectId: 'subj-1' } },
      });
    });

    it('reads the requested taxonomy', async () => {
      prisma.subject.findMany.mockResolvedValue([]);

      await service.subjectsSummary('bar_admin_6');

      expect(prisma.subject.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { taxonomyVersion: 'bar_admin_6' },
        }),
      );
    });
  });

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
