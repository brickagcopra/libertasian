import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';

import { PrismaService } from '../../prisma/prisma.service';
import { UsageQuotaService } from '../subscriptions/usage-quota.service';
import { MemosService } from './memos.service';

describe('MemosService', () => {
  let service: MemosService;
  let prisma: {
    legalMemo: { create: jest.Mock; findUnique: jest.Mock; findMany: jest.Mock; update: jest.Mock; delete: jest.Mock };
    matter: { findFirst: jest.Mock };
    forTenant: jest.Mock;
  };
  let usageQuota: { checkAndIncrement: jest.Mock };
  let queue: { add: jest.Mock };

  const userId = 'user-1';
  const organizationId = 'org-1';
  const now = new Date();

  const mockMemo = {
    id: 'memo-1',
    organizationId,
    userId,
    query: 'Constructive dismissal standards',
    memoType: 'legal_research',
    matterId: null,
    status: 'pending',
    structuredOutput: null,
    citationsJson: null,
    confidenceScore: null,
    jobId: null,
    modelRunId: null,
    createdAt: now,
    updatedAt: now,
    matter: null,
  };

  beforeEach(async () => {
    prisma = {
      legalMemo: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
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
        MemosService,
        { provide: PrismaService, useValue: prisma },
        { provide: UsageQuotaService, useValue: usageQuota },
        { provide: getQueueToken('memos'), useValue: queue },
      ],
    }).compile();

    service = module.get(MemosService);
  });

  describe('triggerGeneration', () => {
    const dto = { query: 'Constructive dismissal standards', memoType: 'legal_research' };

    it('should create memo and enqueue job', async () => {
      usageQuota.checkAndIncrement.mockResolvedValue({ allowed: true });
      prisma.legalMemo.create.mockResolvedValue(mockMemo);
      queue.add.mockResolvedValue({ id: 'job-1' });
      prisma.legalMemo.update.mockResolvedValue({ ...mockMemo, jobId: 'job-1' });

      const result = await service.triggerGeneration(dto as never, userId, organizationId);

      expect(result).toEqual(mockMemo);
      expect(usageQuota.checkAndIncrement).toHaveBeenCalledWith(
        organizationId, userId, 'memoDraftingPerMonth', { isPlatformAdmin: false },
      );
      expect(queue.add).toHaveBeenCalledWith(
        'generate-memo',
        expect.objectContaining({ memoId: 'memo-1', query: dto.query }),
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

    it('should validate matter if provided', async () => {
      usageQuota.checkAndIncrement.mockResolvedValue({ allowed: true });
      prisma.matter.findFirst.mockResolvedValue(null);

      await expect(
        service.triggerGeneration({ ...dto, matterId: 'matter-1' } as never, userId, organizationId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should trim query text', async () => {
      usageQuota.checkAndIncrement.mockResolvedValue({ allowed: true });
      prisma.legalMemo.create.mockResolvedValue(mockMemo);
      queue.add.mockResolvedValue({ id: 'job-1' });
      prisma.legalMemo.update.mockResolvedValue(mockMemo);

      await service.triggerGeneration(
        { query: '  padded query  ', memoType: 'legal_research' } as never,
        userId,
        organizationId,
      );

      expect(prisma.legalMemo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ query: 'padded query' }),
        }),
      );
    });
  });

  describe('list', () => {
    it('should return paginated results', async () => {
      prisma.legalMemo.findMany.mockResolvedValue([mockMemo]);

      const result = await service.list(userId, organizationId, {} as never);

      expect(result.items).toHaveLength(1);
      expect(result.meta.hasNext).toBe(false);
      expect(result.meta.limit).toBe(20);
    });

    it('should detect hasNext', async () => {
      const items = Array.from({ length: 21 }, (_, i) => ({ ...mockMemo, id: `memo-${i}` }));
      prisma.legalMemo.findMany.mockResolvedValue(items);

      const result = await service.list(userId, organizationId, {} as never);

      expect(result.items).toHaveLength(20);
      expect(result.meta.hasNext).toBe(true);
    });

    it('should apply memoType, status, matterId filters', async () => {
      prisma.legalMemo.findMany.mockResolvedValue([]);

      await service.list(userId, organizationId, {
        memoType: 'legal_research',
        status: 'completed',
        matterId: 'matter-1',
      } as never);

      expect(prisma.legalMemo.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            memoType: 'legal_research',
            status: 'completed',
            matterId: 'matter-1',
          }),
        }),
      );
    });
  });

  describe('findById', () => {
    it('should return memo when authorized', async () => {
      prisma.legalMemo.findUnique.mockResolvedValue(mockMemo);
      const result = await service.findById('memo-1', userId, organizationId);
      expect(result).toEqual(mockMemo);
    });

    it('should throw NotFoundException', async () => {
      prisma.legalMemo.findUnique.mockResolvedValue(null);
      await expect(service.findById('x', userId, organizationId)).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException for wrong org', async () => {
      prisma.legalMemo.findUnique.mockResolvedValue({ ...mockMemo, organizationId: 'org-2' });
      await expect(service.findById('memo-1', userId, organizationId)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('delete', () => {
    it('should delete when authorized', async () => {
      prisma.legalMemo.findUnique.mockResolvedValue(mockMemo);
      prisma.legalMemo.delete.mockResolvedValue(mockMemo);

      await service.delete('memo-1', userId, organizationId);
      expect(prisma.legalMemo.delete).toHaveBeenCalledWith({ where: { id: 'memo-1' } });
    });

    it('should throw NotFoundException', async () => {
      prisma.legalMemo.findUnique.mockResolvedValue(null);
      await expect(service.delete('x', userId, organizationId)).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException for wrong user', async () => {
      prisma.legalMemo.findUnique.mockResolvedValue({ ...mockMemo, userId: 'other' });
      await expect(service.delete('memo-1', userId, organizationId)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('updateFromGeneration', () => {
    it('should update status, output, citations, confidence, modelRunId', async () => {
      const output = { heading: 'Constructive Dismissal', body: 'Analysis...' };
      const citations = [{ id: 'doc-1', text: 'cited passage' }];
      prisma.legalMemo.update.mockResolvedValue({
        ...mockMemo,
        status: 'completed',
        structuredOutput: output,
        citationsJson: citations,
        confidenceScore: 0.88,
      });

      await service.updateFromGeneration('memo-1', {
        status: 'completed',
        structuredOutput: output,
        citationsJson: citations,
        confidenceScore: 0.88,
        modelRunId: 'run-1',
      });

      expect(prisma.legalMemo.update).toHaveBeenCalledWith({
        where: { id: 'memo-1' },
        data: expect.objectContaining({
          status: 'completed',
          structuredOutput: output,
          citationsJson: citations,
          confidenceScore: 0.88,
          modelRunId: 'run-1',
        }),
      });
    });

    it('should update status only', async () => {
      prisma.legalMemo.update.mockResolvedValue({ ...mockMemo, status: 'failed' });
      await service.updateFromGeneration('memo-1', { status: 'failed' });
      expect(prisma.legalMemo.update).toHaveBeenCalledWith({
        where: { id: 'memo-1' },
        data: { status: 'failed' },
      });
    });
  });

  describe('getStatus', () => {
    it('should return lightweight status with confidenceScore', async () => {
      prisma.legalMemo.findUnique.mockResolvedValue({
        id: 'memo-1', status: 'completed', organizationId, userId,
        confidenceScore: 0.9, createdAt: now, updatedAt: now,
      });

      const result = await service.getStatus('memo-1', userId, organizationId);

      expect(result).toEqual({
        id: 'memo-1', status: 'completed', confidenceScore: 0.9,
        createdAt: now, updatedAt: now,
      });
    });

    it('should throw NotFoundException', async () => {
      prisma.legalMemo.findUnique.mockResolvedValue(null);
      await expect(service.getStatus('x', userId, organizationId)).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException for wrong org', async () => {
      prisma.legalMemo.findUnique.mockResolvedValue({
        id: 'memo-1', status: 'pending', organizationId: 'org-2', userId,
        confidenceScore: null, createdAt: now, updatedAt: now,
      });
      await expect(service.getStatus('memo-1', userId, organizationId)).rejects.toThrow(ForbiddenException);
    });
  });
});
