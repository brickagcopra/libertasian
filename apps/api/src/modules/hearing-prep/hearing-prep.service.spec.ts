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
import { HearingPrepService } from './hearing-prep.service';

describe('HearingPrepService', () => {
  let service: HearingPrepService;
  let prisma: {
    hearingPrepPack: { create: jest.Mock; findUnique: jest.Mock; findMany: jest.Mock; update: jest.Mock; delete: jest.Mock };
    legalDocument: { findMany: jest.Mock };
    matter: { findFirst: jest.Mock };
    forTenant: jest.Mock;
  };
  let usageQuota: { checkAndIncrement: jest.Mock };
  let queue: { add: jest.Mock };

  const userId = 'user-1';
  const organizationId = 'org-1';
  const now = new Date();

  const mockPack = {
    id: 'pack-1',
    organizationId,
    userId,
    topic: 'Constructive dismissal hearing',
    issue: null,
    documentIds: ['doc-1'],
    inputContext: null,
    matterId: null,
    status: 'pending',
    packJson: null,
    jobId: null,
    modelRunId: null,
    createdAt: now,
    updatedAt: now,
    matter: null,
  };

  beforeEach(async () => {
    prisma = {
      hearingPrepPack: {
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

    usageQuota = { checkAndIncrement: jest.fn() };
    queue = { add: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HearingPrepService,
        { provide: PrismaService, useValue: prisma },
        { provide: UsageQuotaService, useValue: usageQuota },
        { provide: getQueueToken('hearing-prep'), useValue: queue },
      ],
    }).compile();

    service = module.get(HearingPrepService);
  });

  describe('triggerGeneration', () => {
    const dto = { topic: 'Constructive dismissal hearing', documentIds: ['doc-1'] };

    it('should create pack and enqueue job', async () => {
      usageQuota.checkAndIncrement.mockResolvedValue({ allowed: true });
      prisma.legalDocument.findMany.mockResolvedValue([{ id: 'doc-1', title: 'D1', citationText: 'G1' }]);
      prisma.hearingPrepPack.create.mockResolvedValue(mockPack);
      queue.add.mockResolvedValue({ id: 'job-1' });
      prisma.hearingPrepPack.update.mockResolvedValue({ ...mockPack, jobId: 'job-1' });

      const result = await service.triggerGeneration(dto as never, userId, organizationId);

      expect(result).toEqual(mockPack);
      expect(usageQuota.checkAndIncrement).toHaveBeenCalledWith(
        organizationId, userId, 'hearingPrepPerMonth',
      );
      expect(queue.add).toHaveBeenCalledWith(
        'generate-hearing-prep',
        expect.objectContaining({ packId: 'pack-1', topic: dto.topic }),
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

    it('should throw BadRequestException when some documents not found', async () => {
      usageQuota.checkAndIncrement.mockResolvedValue({ allowed: true });
      prisma.legalDocument.findMany.mockResolvedValue([]);

      await expect(
        service.triggerGeneration(dto as never, userId, organizationId),
      ).rejects.toThrow(BadRequestException);
    });

    it('should skip document validation when no documentIds provided', async () => {
      usageQuota.checkAndIncrement.mockResolvedValue({ allowed: true });
      prisma.hearingPrepPack.create.mockResolvedValue(mockPack);
      queue.add.mockResolvedValue({ id: 'job-1' });
      prisma.hearingPrepPack.update.mockResolvedValue(mockPack);

      await service.triggerGeneration(
        { topic: 'Test topic' } as never,
        userId,
        organizationId,
      );

      expect(prisma.legalDocument.findMany).not.toHaveBeenCalled();
    });

    it('should validate matter if provided', async () => {
      usageQuota.checkAndIncrement.mockResolvedValue({ allowed: true });
      prisma.legalDocument.findMany.mockResolvedValue([{ id: 'doc-1', title: 'D1', citationText: 'G1' }]);
      prisma.matter.findFirst.mockResolvedValue(null);

      await expect(
        service.triggerGeneration(
          { ...dto, matterId: 'matter-1' } as never,
          userId,
          organizationId,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('list', () => {
    it('should return paginated results', async () => {
      prisma.hearingPrepPack.findMany.mockResolvedValue([mockPack]);
      const result = await service.list(userId, organizationId, {} as never);
      expect(result.items).toHaveLength(1);
      expect(result.meta.hasNext).toBe(false);
    });

    it('should apply status and matterId filters', async () => {
      prisma.hearingPrepPack.findMany.mockResolvedValue([]);
      await service.list(userId, organizationId, { status: 'completed', matterId: 'm-1' } as never);
      expect(prisma.hearingPrepPack.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'completed', matterId: 'm-1' }),
        }),
      );
    });
  });

  describe('findById', () => {
    it('should return pack when authorized', async () => {
      prisma.hearingPrepPack.findUnique.mockResolvedValue(mockPack);
      expect(await service.findById('pack-1', userId, organizationId)).toEqual(mockPack);
    });

    it('should throw NotFoundException', async () => {
      prisma.hearingPrepPack.findUnique.mockResolvedValue(null);
      await expect(service.findById('x', userId, organizationId)).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException for wrong user', async () => {
      prisma.hearingPrepPack.findUnique.mockResolvedValue({ ...mockPack, userId: 'other' });
      await expect(service.findById('pack-1', userId, organizationId)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('delete', () => {
    it('should delete when authorized', async () => {
      prisma.hearingPrepPack.findUnique.mockResolvedValue(mockPack);
      prisma.hearingPrepPack.delete.mockResolvedValue(mockPack);
      await service.delete('pack-1', userId, organizationId);
      expect(prisma.hearingPrepPack.delete).toHaveBeenCalledWith({ where: { id: 'pack-1' } });
    });

    it('should throw NotFoundException', async () => {
      prisma.hearingPrepPack.findUnique.mockResolvedValue(null);
      await expect(service.delete('x', userId, organizationId)).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException', async () => {
      prisma.hearingPrepPack.findUnique.mockResolvedValue({ ...mockPack, organizationId: 'org-2' });
      await expect(service.delete('pack-1', userId, organizationId)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('updateFromGeneration', () => {
    it('should update status and packJson', async () => {
      const packJson = { keyArguments: ['arg1'], relevantCases: [] };
      prisma.hearingPrepPack.update.mockResolvedValue({ ...mockPack, status: 'completed', packJson });

      await service.updateFromGeneration('pack-1', {
        status: 'completed',
        packJson,
        modelRunId: 'run-1',
      });

      expect(prisma.hearingPrepPack.update).toHaveBeenCalledWith({
        where: { id: 'pack-1' },
        data: { status: 'completed', packJson, modelRunId: 'run-1' },
      });
    });

    it('should update status only', async () => {
      prisma.hearingPrepPack.update.mockResolvedValue({ ...mockPack, status: 'failed' });
      await service.updateFromGeneration('pack-1', { status: 'failed' });
      expect(prisma.hearingPrepPack.update).toHaveBeenCalledWith({
        where: { id: 'pack-1' },
        data: { status: 'failed' },
      });
    });
  });

  describe('getStatus', () => {
    it('should return lightweight status', async () => {
      prisma.hearingPrepPack.findUnique.mockResolvedValue({
        id: 'pack-1', status: 'completed', organizationId, userId,
        createdAt: now, updatedAt: now,
      });
      const result = await service.getStatus('pack-1', userId, organizationId);
      expect(result).toEqual({ id: 'pack-1', status: 'completed', createdAt: now, updatedAt: now });
    });

    it('should throw NotFoundException', async () => {
      prisma.hearingPrepPack.findUnique.mockResolvedValue(null);
      await expect(service.getStatus('x', userId, organizationId)).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException', async () => {
      prisma.hearingPrepPack.findUnique.mockResolvedValue({
        id: 'pack-1', status: 'pending', organizationId, userId: 'other',
        createdAt: now, updatedAt: now,
      });
      await expect(service.getStatus('pack-1', userId, organizationId)).rejects.toThrow(ForbiddenException);
    });
  });
});
