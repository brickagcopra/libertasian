import { ForbiddenException, BadRequestException, NotFoundException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';

import { PrismaService } from '../../prisma/prisma.service';
import { UsageQuotaService } from '../subscriptions/usage-quota.service';
import { CaseComparisonsService } from './case-comparisons.service';

describe('CaseComparisonsService', () => {
  let service: CaseComparisonsService;
  let prisma: {
    caseComparison: { create: jest.Mock; findUnique: jest.Mock; findMany: jest.Mock; update: jest.Mock; delete: jest.Mock };
    legalDocument: { findMany: jest.Mock };
    matter: { findFirst: jest.Mock };
    forTenant: jest.Mock;
  };
  let usageQuota: { checkAndIncrement: jest.Mock };
  let queue: { add: jest.Mock };

  const userId = 'user-1';
  const organizationId = 'org-1';
  const now = new Date();

  const mockComparison = {
    id: 'comp-1',
    organizationId,
    userId,
    documentIds: ['doc-1', 'doc-2'],
    comparisonType: 'side_by_side',
    matterId: null,
    status: 'pending',
    resultJson: null,
    jobId: null,
    modelRunId: null,
    createdAt: now,
    updatedAt: now,
    matter: null,
  };

  beforeEach(async () => {
    prisma = {
      caseComparison: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      legalDocument: {
        findMany: jest.fn(),
      },
      matter: {
        findFirst: jest.fn(),
      },
      forTenant: jest.fn(),
    };
    prisma.forTenant.mockReturnValue(prisma);

    usageQuota = {
      checkAndIncrement: jest.fn(),
    };

    queue = {
      add: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CaseComparisonsService,
        { provide: PrismaService, useValue: prisma },
        { provide: UsageQuotaService, useValue: usageQuota },
        { provide: getQueueToken('case-comparisons'), useValue: queue },
      ],
    }).compile();

    service = module.get(CaseComparisonsService);
  });

  describe('triggerGeneration', () => {
    const dto = {
      documentIds: ['doc-1', 'doc-2'],
      comparisonType: 'side_by_side',
    };

    it('should create comparison and enqueue job', async () => {
      usageQuota.checkAndIncrement.mockResolvedValue({ allowed: true });
      prisma.legalDocument.findMany.mockResolvedValue([
        { id: 'doc-1', title: 'Doc 1', citationText: 'GR1' },
        { id: 'doc-2', title: 'Doc 2', citationText: 'GR2' },
      ]);
      prisma.caseComparison.create.mockResolvedValue(mockComparison);
      queue.add.mockResolvedValue({ id: 'job-1' });
      prisma.caseComparison.update.mockResolvedValue({ ...mockComparison, jobId: 'job-1' });

      const result = await service.triggerGeneration(dto as never, userId, organizationId);

      expect(result).toEqual(mockComparison);
      expect(usageQuota.checkAndIncrement).toHaveBeenCalledWith(
        organizationId, userId, 'caseComparisonPerMonth',
      );
      expect(prisma.legalDocument.findMany).toHaveBeenCalledWith({
        where: { id: { in: dto.documentIds } },
        select: { id: true, title: true, citationText: true },
      });
      expect(queue.add).toHaveBeenCalledWith(
        'generate-comparison',
        expect.objectContaining({ comparisonId: 'comp-1', documentIds: dto.documentIds }),
        expect.objectContaining({ attempts: 2 }),
      );
      expect(prisma.caseComparison.update).toHaveBeenCalledWith({
        where: { id: 'comp-1' },
        data: { jobId: 'job-1' },
      });
    });

    it('should throw ForbiddenException when quota exceeded', async () => {
      usageQuota.checkAndIncrement.mockResolvedValue({
        allowed: false, used: 10, limit: 10, resetsAt: '2026-04-01',
      });

      await expect(
        service.triggerGeneration(dto as never, userId, organizationId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException when some documents not found', async () => {
      usageQuota.checkAndIncrement.mockResolvedValue({ allowed: true });
      prisma.legalDocument.findMany.mockResolvedValue([{ id: 'doc-1' }]);

      await expect(
        service.triggerGeneration(dto as never, userId, organizationId),
      ).rejects.toThrow(BadRequestException);
    });

    it('should validate matter if provided', async () => {
      usageQuota.checkAndIncrement.mockResolvedValue({ allowed: true });
      prisma.legalDocument.findMany.mockResolvedValue([
        { id: 'doc-1', title: 'D1', citationText: 'G1' },
        { id: 'doc-2', title: 'D2', citationText: 'G2' },
      ]);
      prisma.matter.findFirst.mockResolvedValue(null);

      const dtoWithMatter = { ...dto, matterId: 'matter-1' };

      await expect(
        service.triggerGeneration(dtoWithMatter as never, userId, organizationId),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.forTenant).toHaveBeenCalledWith(organizationId);
      expect(prisma.matter.findFirst).toHaveBeenCalledWith({
        where: { id: 'matter-1' },
      });
    });
  });

  describe('list', () => {
    it('should return paginated results with default limit', async () => {
      prisma.caseComparison.findMany.mockResolvedValue([mockComparison]);

      const result = await service.list(userId, organizationId, {} as never);

      expect(result.items).toHaveLength(1);
      expect(result.meta.hasNext).toBe(false);
      expect(result.meta.limit).toBe(20);
    });

    it('should detect hasNext when more results exist', async () => {
      const items = Array.from({ length: 21 }, (_, i) => ({
        ...mockComparison,
        id: `comp-${i}`,
      }));
      prisma.caseComparison.findMany.mockResolvedValue(items);

      const result = await service.list(userId, organizationId, {} as never);

      expect(result.items).toHaveLength(20);
      expect(result.meta.hasNext).toBe(true);
      expect(result.meta.nextCursor).toBe('comp-19');
    });

    it('should apply filters', async () => {
      prisma.caseComparison.findMany.mockResolvedValue([]);

      await service.list(userId, organizationId, {
        comparisonType: 'side_by_side',
        status: 'completed',
        matterId: 'matter-1',
      } as never);

      expect(prisma.caseComparison.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            comparisonType: 'side_by_side',
            status: 'completed',
            matterId: 'matter-1',
          }),
        }),
      );
    });

    it('should use cursor-based pagination', async () => {
      prisma.caseComparison.findMany.mockResolvedValue([]);

      await service.list(userId, organizationId, { cursor: 'comp-5', limit: 10 } as never);

      expect(prisma.caseComparison.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 11,
          skip: 1,
          cursor: { id: 'comp-5' },
        }),
      );
    });
  });

  describe('findById', () => {
    it('should return comparison when found and access allowed', async () => {
      prisma.caseComparison.findUnique.mockResolvedValue(mockComparison);

      const result = await service.findById('comp-1', userId, organizationId);

      expect(result).toEqual(mockComparison);
    });

    it('should throw NotFoundException when not found', async () => {
      prisma.caseComparison.findUnique.mockResolvedValue(null);

      await expect(
        service.findById('comp-999', userId, organizationId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException for wrong org', async () => {
      prisma.caseComparison.findUnique.mockResolvedValue({
        ...mockComparison,
        organizationId: 'org-2',
      });

      await expect(
        service.findById('comp-1', userId, organizationId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException for wrong user', async () => {
      prisma.caseComparison.findUnique.mockResolvedValue({
        ...mockComparison,
        userId: 'user-other',
      });

      await expect(
        service.findById('comp-1', userId, organizationId),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('delete', () => {
    it('should delete comparison when authorized', async () => {
      prisma.caseComparison.findUnique.mockResolvedValue(mockComparison);
      prisma.caseComparison.delete.mockResolvedValue(mockComparison);

      await service.delete('comp-1', userId, organizationId);

      expect(prisma.caseComparison.delete).toHaveBeenCalledWith({
        where: { id: 'comp-1' },
      });
    });

    it('should throw NotFoundException when not found', async () => {
      prisma.caseComparison.findUnique.mockResolvedValue(null);

      await expect(
        service.delete('comp-999', userId, organizationId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException for wrong user', async () => {
      prisma.caseComparison.findUnique.mockResolvedValue({
        ...mockComparison,
        userId: 'user-other',
      });

      await expect(
        service.delete('comp-1', userId, organizationId),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('updateFromGeneration', () => {
    it('should update status and result', async () => {
      const resultJson = { similarities: ['both cite doctrine X'] };
      prisma.caseComparison.update.mockResolvedValue({
        ...mockComparison,
        status: 'completed',
        resultJson,
      });

      const result = await service.updateFromGeneration('comp-1', {
        status: 'completed',
        resultJson,
        modelRunId: 'run-1',
      });

      expect(prisma.caseComparison.update).toHaveBeenCalledWith({
        where: { id: 'comp-1' },
        data: {
          status: 'completed',
          resultJson,
          modelRunId: 'run-1',
        },
      });
      expect(result.status).toBe('completed');
    });

    it('should update status only when no result provided', async () => {
      prisma.caseComparison.update.mockResolvedValue({
        ...mockComparison,
        status: 'failed',
      });

      await service.updateFromGeneration('comp-1', { status: 'failed' });

      expect(prisma.caseComparison.update).toHaveBeenCalledWith({
        where: { id: 'comp-1' },
        data: { status: 'failed' },
      });
    });
  });

  describe('getStatus', () => {
    it('should return lightweight status', async () => {
      prisma.caseComparison.findUnique.mockResolvedValue({
        id: 'comp-1',
        status: 'completed',
        organizationId,
        userId,
        createdAt: now,
        updatedAt: now,
      });

      const result = await service.getStatus('comp-1', userId, organizationId);

      expect(result).toEqual({
        id: 'comp-1',
        status: 'completed',
        createdAt: now,
        updatedAt: now,
      });
    });

    it('should throw NotFoundException when not found', async () => {
      prisma.caseComparison.findUnique.mockResolvedValue(null);

      await expect(
        service.getStatus('comp-999', userId, organizationId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException for wrong user', async () => {
      prisma.caseComparison.findUnique.mockResolvedValue({
        id: 'comp-1',
        status: 'completed',
        organizationId,
        userId: 'user-other',
        createdAt: now,
        updatedAt: now,
      });

      await expect(
        service.getStatus('comp-1', userId, organizationId),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
