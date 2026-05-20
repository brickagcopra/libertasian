import {
  ForbiddenException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';

import { PrismaService } from '../../prisma/prisma.service';
import { UsageQuotaService } from '../subscriptions/usage-quota.service';
import { ContradictionsService } from './contradictions.service';

describe('ContradictionsService', () => {
  let service: ContradictionsService;
  let prisma: {
    contradictionReport: { create: jest.Mock; findUnique: jest.Mock; findMany: jest.Mock; update: jest.Mock; delete: jest.Mock };
    legalDocument: { findMany: jest.Mock };
  };
  let usageQuota: { checkAndIncrement: jest.Mock };
  let queue: { add: jest.Mock };

  const userId = 'user-1';
  const organizationId = 'org-1';
  const now = new Date();

  const mockReport = {
    id: 'report-1',
    organizationId,
    userId,
    documentIds: ['doc-1', 'doc-2'],
    scope: 'selected',
    topic: null,
    status: 'pending',
    resultJson: null,
    jobId: null,
    createdAt: now,
    updatedAt: now,
  };

  beforeEach(async () => {
    prisma = {
      contradictionReport: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      legalDocument: {
        findMany: jest.fn(),
      },
    };

    usageQuota = { checkAndIncrement: jest.fn() };
    queue = { add: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContradictionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: UsageQuotaService, useValue: usageQuota },
        { provide: getQueueToken('contradictions'), useValue: queue },
      ],
    }).compile();

    service = module.get(ContradictionsService);
  });

  describe('triggerGeneration', () => {
    const dto = { documentIds: ['doc-1', 'doc-2'], scope: 'selected' };

    it('should create report and enqueue job', async () => {
      usageQuota.checkAndIncrement.mockResolvedValue({ allowed: true });
      prisma.legalDocument.findMany.mockResolvedValue([{ id: 'doc-1' }, { id: 'doc-2' }]);
      prisma.contradictionReport.create.mockResolvedValue(mockReport);
      queue.add.mockResolvedValue({ id: 'job-1' });
      prisma.contradictionReport.update.mockResolvedValue({ ...mockReport, jobId: 'job-1' });

      const result = await service.triggerGeneration(dto as never, userId, organizationId);

      expect(result).toEqual(mockReport);
      expect(usageQuota.checkAndIncrement).toHaveBeenCalledWith(
        organizationId, userId, 'contradictionDetectionPerMonth', { isPlatformAdmin: false },
      );
      expect(queue.add).toHaveBeenCalledWith(
        'generate-contradiction-report',
        expect.objectContaining({ reportId: 'report-1' }),
        expect.objectContaining({ attempts: 2 }),
      );
    });

    it('should throw ForbiddenException when quota exceeded', async () => {
      usageQuota.checkAndIncrement.mockResolvedValue({
        allowed: false, used: 3, limit: 3, resetsAt: '2026-04-01',
      });
      await expect(
        service.triggerGeneration(dto as never, userId, organizationId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException when topic_based scope without topic', async () => {
      usageQuota.checkAndIncrement.mockResolvedValue({ allowed: true });

      await expect(
        service.triggerGeneration(
          { documentIds: ['doc-1'], scope: 'topic_based' } as never,
          userId,
          organizationId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when some documents not found', async () => {
      usageQuota.checkAndIncrement.mockResolvedValue({ allowed: true });
      prisma.legalDocument.findMany.mockResolvedValue([{ id: 'doc-1' }]);

      await expect(
        service.triggerGeneration(dto as never, userId, organizationId),
      ).rejects.toThrow(BadRequestException);
    });

    it('should accept topic_based scope with topic', async () => {
      usageQuota.checkAndIncrement.mockResolvedValue({ allowed: true });
      prisma.legalDocument.findMany.mockResolvedValue([{ id: 'doc-1' }]);
      prisma.contradictionReport.create.mockResolvedValue({
        ...mockReport,
        scope: 'topic_based',
        topic: 'Property Law',
      });
      queue.add.mockResolvedValue({ id: 'job-1' });
      prisma.contradictionReport.update.mockResolvedValue(mockReport);

      await service.triggerGeneration(
        { documentIds: ['doc-1'], scope: 'topic_based', topic: 'Property Law' } as never,
        userId,
        organizationId,
      );

      expect(prisma.contradictionReport.create).toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('should return paginated results', async () => {
      prisma.contradictionReport.findMany.mockResolvedValue([mockReport]);
      const result = await service.list(userId, organizationId, {} as never);
      expect(result.items).toHaveLength(1);
      expect(result.meta.hasNext).toBe(false);
    });

    it('should apply status and scope filters', async () => {
      prisma.contradictionReport.findMany.mockResolvedValue([]);
      await service.list(userId, organizationId, { status: 'completed', scope: 'selected' } as never);
      expect(prisma.contradictionReport.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'completed', scope: 'selected' }),
        }),
      );
    });
  });

  describe('findById', () => {
    it('should return report when authorized', async () => {
      prisma.contradictionReport.findUnique.mockResolvedValue(mockReport);
      const result = await service.findById('report-1', userId, organizationId);
      expect(result).toEqual(mockReport);
    });

    it('should throw NotFoundException', async () => {
      prisma.contradictionReport.findUnique.mockResolvedValue(null);
      await expect(service.findById('x', userId, organizationId)).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException for wrong user', async () => {
      prisma.contradictionReport.findUnique.mockResolvedValue({ ...mockReport, userId: 'other' });
      await expect(service.findById('report-1', userId, organizationId)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('delete', () => {
    it('should delete when authorized', async () => {
      prisma.contradictionReport.findUnique.mockResolvedValue(mockReport);
      prisma.contradictionReport.delete.mockResolvedValue(mockReport);
      await service.delete('report-1', userId, organizationId);
      expect(prisma.contradictionReport.delete).toHaveBeenCalledWith({ where: { id: 'report-1' } });
    });

    it('should throw NotFoundException', async () => {
      prisma.contradictionReport.findUnique.mockResolvedValue(null);
      await expect(service.delete('x', userId, organizationId)).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException', async () => {
      prisma.contradictionReport.findUnique.mockResolvedValue({ ...mockReport, organizationId: 'org-2' });
      await expect(service.delete('report-1', userId, organizationId)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getStatus', () => {
    it('should return lightweight status', async () => {
      prisma.contradictionReport.findUnique.mockResolvedValue({
        id: 'report-1', status: 'completed', organizationId, userId,
        createdAt: now, updatedAt: now,
      });
      const result = await service.getStatus('report-1', userId, organizationId);
      expect(result).toEqual({ id: 'report-1', status: 'completed', createdAt: now, updatedAt: now });
    });

    it('should throw NotFoundException', async () => {
      prisma.contradictionReport.findUnique.mockResolvedValue(null);
      await expect(service.getStatus('x', userId, organizationId)).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException', async () => {
      prisma.contradictionReport.findUnique.mockResolvedValue({
        id: 'report-1', status: 'pending', organizationId: 'org-2', userId,
        createdAt: now, updatedAt: now,
      });
      await expect(service.getStatus('report-1', userId, organizationId)).rejects.toThrow(ForbiddenException);
    });
  });
});
