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
import { TimelinesService } from './timelines.service';

describe('TimelinesService', () => {
  let service: TimelinesService;
  let prisma: Record<string, Record<string, jest.Mock>>;
  let usageQuota: { checkAndIncrement: jest.Mock };
  let queue: { add: jest.Mock };

  const userId = 'user-1';
  const organizationId = 'org-1';
  const now = new Date();

  const mockTimeline = {
    id: 'tl-1',
    organizationId,
    userId,
    title: 'Reyes v. Santos Timeline',
    documentIds: ['doc-1', 'doc-2'],
    matterId: null,
    status: 'pending',
    timelineJson: null,
    jobId: null,
    modelRunId: null,
    createdAt: now,
    updatedAt: now,
    matter: null,
  };

  beforeEach(async () => {
    prisma = {
      caseTimeline: {
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
    };

    usageQuota = { checkAndIncrement: jest.fn() };
    queue = { add: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TimelinesService,
        { provide: PrismaService, useValue: prisma },
        { provide: UsageQuotaService, useValue: usageQuota },
        { provide: getQueueToken('timelines'), useValue: queue },
      ],
    }).compile();

    service = module.get(TimelinesService);
  });

  describe('triggerGeneration', () => {
    const dto = {
      title: 'Reyes v. Santos Timeline',
      documentIds: ['doc-1', 'doc-2'],
    };

    it('should create timeline and enqueue job', async () => {
      usageQuota.checkAndIncrement.mockResolvedValue({ allowed: true });
      prisma.legalDocument.findMany.mockResolvedValue([
        { id: 'doc-1', title: 'D1', citationText: 'G1' },
        { id: 'doc-2', title: 'D2', citationText: 'G2' },
      ]);
      prisma.caseTimeline.create.mockResolvedValue(mockTimeline);
      queue.add.mockResolvedValue({ id: 'job-1' });
      prisma.caseTimeline.update.mockResolvedValue({ ...mockTimeline, jobId: 'job-1' });

      const result = await service.triggerGeneration(dto as never, userId, organizationId);

      expect(result).toEqual(mockTimeline);
      expect(usageQuota.checkAndIncrement).toHaveBeenCalledWith(
        organizationId, userId, 'timelineGenerationPerMonth',
      );
      expect(queue.add).toHaveBeenCalledWith(
        'generate-timeline',
        expect.objectContaining({ timelineId: 'tl-1', title: dto.title }),
        expect.objectContaining({ attempts: 2 }),
      );
    });

    it('should throw ForbiddenException when quota exceeded', async () => {
      usageQuota.checkAndIncrement.mockResolvedValue({
        allowed: false, used: 5, limit: 5, resetsAt: '2026-04-01',
      });
      await expect(
        service.triggerGeneration(dto as never, userId, organizationId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException when documents not found', async () => {
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

      await expect(
        service.triggerGeneration({ ...dto, matterId: 'matter-1' } as never, userId, organizationId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('list', () => {
    it('should return paginated results', async () => {
      prisma.caseTimeline.findMany.mockResolvedValue([mockTimeline]);
      const result = await service.list(userId, organizationId, {} as never);
      expect(result.items).toHaveLength(1);
      expect(result.meta.hasNext).toBe(false);
    });

    it('should apply status and matterId filters', async () => {
      prisma.caseTimeline.findMany.mockResolvedValue([]);
      await service.list(userId, organizationId, { status: 'completed', matterId: 'm-1' } as never);
      expect(prisma.caseTimeline.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'completed', matterId: 'm-1' }),
        }),
      );
    });

    it('should handle cursor pagination', async () => {
      prisma.caseTimeline.findMany.mockResolvedValue([]);
      await service.list(userId, organizationId, { cursor: 'tl-5', limit: 10 } as never);
      expect(prisma.caseTimeline.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 11,
          skip: 1,
          cursor: { id: 'tl-5' },
        }),
      );
    });
  });

  describe('findById', () => {
    it('should return timeline when authorized', async () => {
      prisma.caseTimeline.findUnique.mockResolvedValue(mockTimeline);
      expect(await service.findById('tl-1', userId, organizationId)).toEqual(mockTimeline);
    });

    it('should throw NotFoundException', async () => {
      prisma.caseTimeline.findUnique.mockResolvedValue(null);
      await expect(service.findById('x', userId, organizationId)).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException for wrong org', async () => {
      prisma.caseTimeline.findUnique.mockResolvedValue({ ...mockTimeline, organizationId: 'org-2' });
      await expect(service.findById('tl-1', userId, organizationId)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('delete', () => {
    it('should delete when authorized', async () => {
      prisma.caseTimeline.findUnique.mockResolvedValue(mockTimeline);
      prisma.caseTimeline.delete.mockResolvedValue(mockTimeline);
      await service.delete('tl-1', userId, organizationId);
      expect(prisma.caseTimeline.delete).toHaveBeenCalledWith({ where: { id: 'tl-1' } });
    });

    it('should throw NotFoundException', async () => {
      prisma.caseTimeline.findUnique.mockResolvedValue(null);
      await expect(service.delete('x', userId, organizationId)).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException for wrong user', async () => {
      prisma.caseTimeline.findUnique.mockResolvedValue({ ...mockTimeline, userId: 'other' });
      await expect(service.delete('tl-1', userId, organizationId)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('updateFromGeneration', () => {
    it('should update status and timelineJson', async () => {
      const timelineJson = { events: [{ date: '2024-01-01', description: 'Filing' }] };
      prisma.caseTimeline.update.mockResolvedValue({
        ...mockTimeline, status: 'completed', timelineJson,
      });

      await service.updateFromGeneration('tl-1', {
        status: 'completed',
        timelineJson,
        modelRunId: 'run-1',
      });

      expect(prisma.caseTimeline.update).toHaveBeenCalledWith({
        where: { id: 'tl-1' },
        data: { status: 'completed', timelineJson, modelRunId: 'run-1' },
      });
    });

    it('should update status only', async () => {
      prisma.caseTimeline.update.mockResolvedValue({ ...mockTimeline, status: 'failed' });
      await service.updateFromGeneration('tl-1', { status: 'failed' });
      expect(prisma.caseTimeline.update).toHaveBeenCalledWith({
        where: { id: 'tl-1' },
        data: { status: 'failed' },
      });
    });
  });

  describe('getStatus', () => {
    it('should return lightweight status', async () => {
      prisma.caseTimeline.findUnique.mockResolvedValue({
        id: 'tl-1', status: 'completed', organizationId, userId,
        createdAt: now, updatedAt: now,
      });
      const result = await service.getStatus('tl-1', userId, organizationId);
      expect(result).toEqual({ id: 'tl-1', status: 'completed', createdAt: now, updatedAt: now });
    });

    it('should throw NotFoundException', async () => {
      prisma.caseTimeline.findUnique.mockResolvedValue(null);
      await expect(service.getStatus('x', userId, organizationId)).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException', async () => {
      prisma.caseTimeline.findUnique.mockResolvedValue({
        id: 'tl-1', status: 'pending', organizationId: 'org-2', userId,
        createdAt: now, updatedAt: now,
      });
      await expect(service.getStatus('tl-1', userId, organizationId)).rejects.toThrow(ForbiddenException);
    });
  });
});
