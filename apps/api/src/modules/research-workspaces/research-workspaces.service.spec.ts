import {
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';

import { PrismaService } from '../../prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { ResearchWorkspacesService } from './research-workspaces.service';

describe('ResearchWorkspacesService', () => {
  let service: ResearchWorkspacesService;
  let prisma: Record<string, Record<string, jest.Mock>>;
  let subscriptions: { getEntitlements: jest.Mock };
  let queue: { add: jest.Mock };

  const userId = 'user-1';
  const organizationId = 'org-1';
  const now = new Date();

  const mockWorkspace = {
    id: 'ws-1',
    organizationId,
    userId,
    title: 'Property Law Research',
    description: null,
    contextJson: { pinnedDocumentIds: [], pinnedSectionIds: [], notes: '' },
    createdAt: now,
    updatedAt: now,
    _count: { queries: 3 },
  };

  const mockQuery = {
    id: 'query-1',
    researchWorkspaceId: 'ws-1',
    query: 'What is the doctrine of last clear chance?',
    responseJson: null,
    createdAt: now,
  };

  beforeEach(async () => {
    prisma = {
      researchWorkspace: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        count: jest.fn(),
      },
      researchQuery: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
    };

    subscriptions = { getEntitlements: jest.fn() };
    queue = { add: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResearchWorkspacesService,
        { provide: PrismaService, useValue: prisma },
        { provide: SubscriptionsService, useValue: subscriptions },
        { provide: getQueueToken('research-workspaces'), useValue: queue },
      ],
    }).compile();

    service = module.get(ResearchWorkspacesService);
  });

  describe('create', () => {
    const dto = { title: 'Property Law Research' };

    it('should create workspace when under limit', async () => {
      subscriptions.getEntitlements.mockResolvedValue({ maxResearchWorkspaces: 5 });
      prisma.researchWorkspace.count.mockResolvedValue(2);
      prisma.researchWorkspace.create.mockResolvedValue(mockWorkspace);

      const result = await service.create(dto as never, userId, organizationId);

      expect(result.id).toBe('ws-1');
      expect(result.queryCount).toBe(3);
      expect(prisma.researchWorkspace.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organizationId,
            userId,
            title: dto.title,
          }),
        }),
      );
    });

    it('should throw ForbiddenException when workspace limit reached', async () => {
      subscriptions.getEntitlements.mockResolvedValue({ maxResearchWorkspaces: 3 });
      prisma.researchWorkspace.count.mockResolvedValue(3);

      await expect(
        service.create(dto as never, userId, organizationId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow unlimited workspaces when maxResearchWorkspaces is -1', async () => {
      subscriptions.getEntitlements.mockResolvedValue({ maxResearchWorkspaces: -1 });
      prisma.researchWorkspace.create.mockResolvedValue(mockWorkspace);

      const result = await service.create(dto as never, userId, organizationId);
      expect(result.id).toBe('ws-1');
      expect(prisma.researchWorkspace.count).not.toHaveBeenCalled();
    });

    it('should initialize context with pinnedDocumentIds from DTO', async () => {
      subscriptions.getEntitlements.mockResolvedValue({ maxResearchWorkspaces: 10 });
      prisma.researchWorkspace.count.mockResolvedValue(0);
      prisma.researchWorkspace.create.mockResolvedValue(mockWorkspace);

      await service.create(
        { title: 'Test', pinnedDocumentIds: ['doc-1', 'doc-2'] } as never,
        userId,
        organizationId,
      );

      expect(prisma.researchWorkspace.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            contextJson: expect.objectContaining({
              pinnedDocumentIds: ['doc-1', 'doc-2'],
            }),
          }),
        }),
      );
    });
  });

  describe('update', () => {
    it('should update title and context fields', async () => {
      prisma.researchWorkspace.findUnique.mockResolvedValue(mockWorkspace);
      prisma.researchWorkspace.update.mockResolvedValue({
        ...mockWorkspace,
        title: 'Updated Title',
        contextJson: { pinnedDocumentIds: ['doc-1'], pinnedSectionIds: [], notes: '' },
      });

      const result = await service.update(
        'ws-1',
        { title: 'Updated Title', pinnedDocumentIds: ['doc-1'] } as never,
        userId,
        organizationId,
      );

      expect(prisma.researchWorkspace.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ title: 'Updated Title' }),
        }),
      );
      expect(result.queryCount).toBe(3);
    });

    it('should throw NotFoundException for wrong workspace', async () => {
      prisma.researchWorkspace.findUnique.mockResolvedValue(null);

      await expect(
        service.update('ws-999', { title: 'X' } as never, userId, organizationId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('askQuery', () => {
    it('should create query and enqueue job with conversation context', async () => {
      prisma.researchWorkspace.findUnique.mockResolvedValue(mockWorkspace);
      prisma.researchQuery.findMany.mockResolvedValue([
        { query: 'prev query', responseJson: { answer: 'prev answer' } },
      ]);
      prisma.researchQuery.create.mockResolvedValue(mockQuery);
      queue.add.mockResolvedValue({ id: 'job-1' });

      const result = await service.askQuery(
        'ws-1',
        { query: 'What is the doctrine of last clear chance?' } as never,
        userId,
        organizationId,
      );

      expect(result).toEqual(mockQuery);
      expect(queue.add).toHaveBeenCalledWith(
        'generate-research-answer',
        expect.objectContaining({
          queryId: 'query-1',
          workspaceId: 'ws-1',
          previousQueries: [{ query: 'prev query', answer: 'prev answer' }],
        }),
        expect.objectContaining({ attempts: 2 }),
      );
    });

    it('should filter out queries without responseJson from context', async () => {
      prisma.researchWorkspace.findUnique.mockResolvedValue(mockWorkspace);
      prisma.researchQuery.findMany.mockResolvedValue([
        { query: 'q1', responseJson: { answer: 'a1' } },
        { query: 'q2', responseJson: null },
      ]);
      prisma.researchQuery.create.mockResolvedValue(mockQuery);
      queue.add.mockResolvedValue({ id: 'job-1' });

      await service.askQuery('ws-1', { query: 'test' } as never, userId, organizationId);

      expect(queue.add).toHaveBeenCalledWith(
        'generate-research-answer',
        expect.objectContaining({
          previousQueries: [{ query: 'q1', answer: 'a1' }],
        }),
        expect.anything(),
      );
    });

    it('should throw ForbiddenException for wrong user workspace', async () => {
      prisma.researchWorkspace.findUnique.mockResolvedValue({
        ...mockWorkspace,
        userId: 'other-user',
      });

      await expect(
        service.askQuery('ws-1', { query: 'test' } as never, userId, organizationId),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('list', () => {
    it('should return paginated results with queryCount', async () => {
      prisma.researchWorkspace.findMany.mockResolvedValue([mockWorkspace]);

      const result = await service.list(userId, organizationId, {} as never);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].queryCount).toBe(3);
      expect(result.meta.hasNext).toBe(false);
    });

    it('should detect hasNext', async () => {
      const items = Array.from({ length: 21 }, (_, i) => ({
        ...mockWorkspace,
        id: `ws-${i}`,
      }));
      prisma.researchWorkspace.findMany.mockResolvedValue(items);

      const result = await service.list(userId, organizationId, {} as never);

      expect(result.items).toHaveLength(20);
      expect(result.meta.hasNext).toBe(true);
    });
  });

  describe('findById', () => {
    it('should return workspace with queryCount', async () => {
      prisma.researchWorkspace.findUnique.mockResolvedValue(mockWorkspace);
      const result = await service.findById('ws-1', userId, organizationId);
      expect(result.queryCount).toBe(3);
    });

    it('should throw NotFoundException', async () => {
      prisma.researchWorkspace.findUnique.mockResolvedValue(null);
      await expect(service.findById('x', userId, organizationId)).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException for wrong org', async () => {
      prisma.researchWorkspace.findUnique.mockResolvedValue({
        ...mockWorkspace,
        organizationId: 'org-2',
      });
      await expect(service.findById('ws-1', userId, organizationId)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('listQueries', () => {
    it('should return paginated queries', async () => {
      prisma.researchWorkspace.findUnique.mockResolvedValue(mockWorkspace);
      prisma.researchQuery.findMany.mockResolvedValue([mockQuery]);

      const result = await service.listQueries('ws-1', userId, organizationId);

      expect(result.items).toHaveLength(1);
      expect(result.meta.hasNext).toBe(false);
    });

    it('should throw ForbiddenException for wrong workspace', async () => {
      prisma.researchWorkspace.findUnique.mockResolvedValue({
        ...mockWorkspace,
        userId: 'other',
      });

      await expect(
        service.listQueries('ws-1', userId, organizationId),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getQueryStatus', () => {
    it('should return completed status when responseJson exists', async () => {
      prisma.researchWorkspace.findUnique.mockResolvedValue(mockWorkspace);
      prisma.researchQuery.findUnique.mockResolvedValue({
        id: 'query-1',
        responseJson: { answer: 'The doctrine...' },
        createdAt: now,
      });

      const result = await service.getQueryStatus('query-1', 'ws-1', userId, organizationId);

      expect(result.status).toBe('completed');
    });

    it('should return pending status when responseJson is null', async () => {
      prisma.researchWorkspace.findUnique.mockResolvedValue(mockWorkspace);
      prisma.researchQuery.findUnique.mockResolvedValue({
        id: 'query-1',
        responseJson: null,
        createdAt: now,
      });

      const result = await service.getQueryStatus('query-1', 'ws-1', userId, organizationId);

      expect(result.status).toBe('pending');
    });

    it('should throw NotFoundException when query not found', async () => {
      prisma.researchWorkspace.findUnique.mockResolvedValue(mockWorkspace);
      prisma.researchQuery.findUnique.mockResolvedValue(null);

      await expect(
        service.getQueryStatus('x', 'ws-1', userId, organizationId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('delete', () => {
    it('should delete workspace', async () => {
      prisma.researchWorkspace.findUnique.mockResolvedValue(mockWorkspace);
      prisma.researchWorkspace.delete.mockResolvedValue(mockWorkspace);

      await service.delete('ws-1', userId, organizationId);

      expect(prisma.researchWorkspace.delete).toHaveBeenCalledWith({ where: { id: 'ws-1' } });
    });

    it('should throw NotFoundException', async () => {
      prisma.researchWorkspace.findUnique.mockResolvedValue(null);
      await expect(service.delete('x', userId, organizationId)).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException for wrong user', async () => {
      prisma.researchWorkspace.findUnique.mockResolvedValue({
        ...mockWorkspace,
        userId: 'other',
      });
      await expect(service.delete('ws-1', userId, organizationId)).rejects.toThrow(ForbiddenException);
    });
  });
});
