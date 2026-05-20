import {
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';

import { PrismaService } from '../../prisma/prisma.service';
import { UsageQuotaService } from '../subscriptions/usage-quota.service';
import { PleadingsService } from './pleadings.service';

describe('PleadingsService', () => {
  let service: PleadingsService;
  let prisma: {
    pleading: { create: jest.Mock; findUnique: jest.Mock; findMany: jest.Mock; update: jest.Mock; delete: jest.Mock };
    pleadingTemplate: { findUnique: jest.Mock; findMany: jest.Mock };
    matter: { findFirst: jest.Mock };
    forTenant: jest.Mock;
  };
  let usageQuota: { checkAndIncrement: jest.Mock };
  let queue: { add: jest.Mock };

  const userId = 'user-1';
  const organizationId = 'org-1';
  const now = new Date();

  const mockTemplate = {
    id: 'tmpl-1',
    name: 'Motion for Reconsideration',
    slug: 'motion-for-reconsideration',
    category: 'civil',
    court: 'RTC',
    description: 'Template for filing a motion for reconsideration',
    isActive: true,
    templateJson: { sections: ['header', 'body', 'prayer'] },
    createdAt: now,
    updatedAt: now,
  };

  const mockPleading = {
    id: 'plead-1',
    organizationId,
    userId,
    templateId: 'tmpl-1',
    inputData: { caseTitle: 'Test Case' },
    matterId: null,
    status: 'pending',
    generatedOutput: null,
    citationsJson: null,
    jobId: null,
    modelRunId: null,
    createdAt: now,
    updatedAt: now,
    template: { id: 'tmpl-1', name: 'Motion for Reconsideration', slug: 'motion-for-reconsideration', category: 'civil' },
    matter: null,
  };

  beforeEach(async () => {
    prisma = {
      pleading: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      pleadingTemplate: {
        findUnique: jest.fn(),
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
        PleadingsService,
        { provide: PrismaService, useValue: prisma },
        { provide: UsageQuotaService, useValue: usageQuota },
        { provide: getQueueToken('pleadings'), useValue: queue },
      ],
    }).compile();

    service = module.get(PleadingsService);
  });

  describe('triggerGeneration', () => {
    const dto = {
      templateId: 'tmpl-1',
      inputData: { caseTitle: 'Test Case' },
    };

    it('should create pleading and enqueue job', async () => {
      usageQuota.checkAndIncrement.mockResolvedValue({ allowed: true });
      prisma.pleadingTemplate.findUnique.mockResolvedValue(mockTemplate);
      prisma.pleading.create.mockResolvedValue(mockPleading);
      queue.add.mockResolvedValue({ id: 'job-1' });
      prisma.pleading.update.mockResolvedValue({ ...mockPleading, jobId: 'job-1' });

      const result = await service.triggerGeneration(dto as never, userId, organizationId);

      expect(result).toEqual(mockPleading);
      expect(usageQuota.checkAndIncrement).toHaveBeenCalledWith(
        organizationId, userId, 'pleadingAssistancePerMonth', { isPlatformAdmin: false },
      );
      expect(queue.add).toHaveBeenCalledWith(
        'generate-pleading',
        expect.objectContaining({
          pleadingId: 'plead-1',
          templateId: 'tmpl-1',
          templateName: mockTemplate.name,
          templateCategory: mockTemplate.category,
        }),
        expect.objectContaining({ attempts: 2 }),
      );
    });

    it('should throw ForbiddenException when quota exceeded', async () => {
      usageQuota.checkAndIncrement.mockResolvedValue({
        allowed: false, used: 10, limit: 10, resetsAt: '2026-04-01',
      });
      await expect(
        service.triggerGeneration(dto as never, userId, organizationId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException when template not found', async () => {
      usageQuota.checkAndIncrement.mockResolvedValue({ allowed: true });
      prisma.pleadingTemplate.findUnique.mockResolvedValue(null);

      await expect(
        service.triggerGeneration(dto as never, userId, organizationId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when template inactive', async () => {
      usageQuota.checkAndIncrement.mockResolvedValue({ allowed: true });
      prisma.pleadingTemplate.findUnique.mockResolvedValue({ ...mockTemplate, isActive: false });

      await expect(
        service.triggerGeneration(dto as never, userId, organizationId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should validate matter if provided', async () => {
      usageQuota.checkAndIncrement.mockResolvedValue({ allowed: true });
      prisma.pleadingTemplate.findUnique.mockResolvedValue(mockTemplate);
      prisma.matter.findFirst.mockResolvedValue(null);

      await expect(
        service.triggerGeneration({ ...dto, matterId: 'matter-1' } as never, userId, organizationId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('list', () => {
    it('should return paginated results', async () => {
      prisma.pleading.findMany.mockResolvedValue([mockPleading]);
      const result = await service.list(userId, organizationId, {} as never);
      expect(result.items).toHaveLength(1);
      expect(result.meta.hasNext).toBe(false);
    });

    it('should apply category filter via template relation', async () => {
      prisma.pleading.findMany.mockResolvedValue([]);
      await service.list(userId, organizationId, { category: 'civil' } as never);
      expect(prisma.pleading.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            template: { category: 'civil' },
          }),
        }),
      );
    });

    it('should apply status and matterId filters', async () => {
      prisma.pleading.findMany.mockResolvedValue([]);
      await service.list(userId, organizationId, { status: 'completed', matterId: 'm-1' } as never);
      expect(prisma.pleading.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'completed', matterId: 'm-1' }),
        }),
      );
    });
  });

  describe('findById', () => {
    it('should return pleading when authorized', async () => {
      prisma.pleading.findUnique.mockResolvedValue(mockPleading);
      expect(await service.findById('plead-1', userId, organizationId)).toEqual(mockPleading);
    });

    it('should throw NotFoundException', async () => {
      prisma.pleading.findUnique.mockResolvedValue(null);
      await expect(service.findById('x', userId, organizationId)).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException for wrong org', async () => {
      prisma.pleading.findUnique.mockResolvedValue({ ...mockPleading, organizationId: 'org-2' });
      await expect(service.findById('plead-1', userId, organizationId)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('delete', () => {
    it('should delete when authorized', async () => {
      prisma.pleading.findUnique.mockResolvedValue(mockPleading);
      prisma.pleading.delete.mockResolvedValue(mockPleading);
      await service.delete('plead-1', userId, organizationId);
      expect(prisma.pleading.delete).toHaveBeenCalledWith({ where: { id: 'plead-1' } });
    });

    it('should throw NotFoundException', async () => {
      prisma.pleading.findUnique.mockResolvedValue(null);
      await expect(service.delete('x', userId, organizationId)).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException for wrong user', async () => {
      prisma.pleading.findUnique.mockResolvedValue({ ...mockPleading, userId: 'other' });
      await expect(service.delete('plead-1', userId, organizationId)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('updateFromGeneration', () => {
    it('should update output, citations, and modelRunId', async () => {
      const output = { heading: 'Motion', body: 'Content...' };
      const citations = [{ id: 'doc-1', text: 'passage' }];
      prisma.pleading.update.mockResolvedValue({
        ...mockPleading, status: 'completed', generatedOutput: output,
      });

      await service.updateFromGeneration('plead-1', {
        status: 'completed',
        generatedOutput: output,
        citationsJson: citations,
        modelRunId: 'run-1',
      });

      expect(prisma.pleading.update).toHaveBeenCalledWith({
        where: { id: 'plead-1' },
        data: expect.objectContaining({
          status: 'completed',
          generatedOutput: output,
          citationsJson: citations,
          modelRunId: 'run-1',
        }),
      });
    });

    it('should update status only', async () => {
      prisma.pleading.update.mockResolvedValue({ ...mockPleading, status: 'failed' });
      await service.updateFromGeneration('plead-1', { status: 'failed' });
      expect(prisma.pleading.update).toHaveBeenCalledWith({
        where: { id: 'plead-1' },
        data: { status: 'failed' },
      });
    });
  });

  describe('getStatus', () => {
    it('should return lightweight status', async () => {
      prisma.pleading.findUnique.mockResolvedValue({
        id: 'plead-1', status: 'completed', organizationId, userId,
        createdAt: now, updatedAt: now,
      });
      const result = await service.getStatus('plead-1', userId, organizationId);
      expect(result).toEqual({ id: 'plead-1', status: 'completed', createdAt: now, updatedAt: now });
    });

    it('should throw NotFoundException', async () => {
      prisma.pleading.findUnique.mockResolvedValue(null);
      await expect(service.getStatus('x', userId, organizationId)).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException', async () => {
      prisma.pleading.findUnique.mockResolvedValue({
        id: 'plead-1', status: 'pending', organizationId, userId: 'other',
        createdAt: now, updatedAt: now,
      });
      await expect(service.getStatus('plead-1', userId, organizationId)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('listTemplates', () => {
    it('should return active templates', async () => {
      prisma.pleadingTemplate.findMany.mockResolvedValue([mockTemplate]);
      const result = await service.listTemplates();
      expect(result).toHaveLength(1);
      expect(prisma.pleadingTemplate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { isActive: true },
          orderBy: [{ category: 'asc' }, { name: 'asc' }],
        }),
      );
    });

    it('should filter by category', async () => {
      prisma.pleadingTemplate.findMany.mockResolvedValue([]);
      await service.listTemplates('criminal');
      expect(prisma.pleadingTemplate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { isActive: true, category: 'criminal' },
        }),
      );
    });
  });

  describe('getTemplate', () => {
    it('should return template by ID', async () => {
      prisma.pleadingTemplate.findUnique.mockResolvedValue(mockTemplate);
      const result = await service.getTemplate('tmpl-1');
      expect(result).toEqual(mockTemplate);
    });

    it('should throw NotFoundException when not found', async () => {
      prisma.pleadingTemplate.findUnique.mockResolvedValue(null);
      await expect(service.getTemplate('x')).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when inactive', async () => {
      prisma.pleadingTemplate.findUnique.mockResolvedValue({ ...mockTemplate, isActive: false });
      await expect(service.getTemplate('tmpl-1')).rejects.toThrow(NotFoundException);
    });
  });
});
