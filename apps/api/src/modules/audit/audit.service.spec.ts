import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from './audit.service';

describe('AuditService', () => {
  let service: AuditService;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        {
          provide: PrismaService,
          useValue: {
            auditLog: {
              create: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<AuditService>(AuditService);
    prisma = module.get(PrismaService);
  });

  describe('log', () => {
    it('should create an audit log entry with all fields', async () => {
      (prisma.auditLog.create as jest.Mock).mockResolvedValue({ id: 'log-1' });

      await service.log({
        organizationId: 'org-1',
        actorUserId: 'user-1',
        actorType: 'user',
        action: 'create',
        entityType: 'Matter',
        entityId: 'matter-1',
        metadata: { title: 'Test Matter' },
      });

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          organizationId: 'org-1',
          actorUserId: 'user-1',
          actorType: 'user',
          action: 'create',
          entityType: 'Matter',
          entityId: 'matter-1',
          metadataJson: { title: 'Test Matter' },
        },
      });
    });

    it('should create log entry with minimal required fields', async () => {
      (prisma.auditLog.create as jest.Mock).mockResolvedValue({ id: 'log-2' });

      await service.log({
        actorType: 'system',
        action: 'ingestion.completed',
        entityType: 'LegalDocument',
      });

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          organizationId: undefined,
          actorUserId: undefined,
          actorType: 'system',
          action: 'ingestion.completed',
          entityType: 'LegalDocument',
          entityId: undefined,
          metadataJson: {},
        },
      });
    });

    it('should default metadata to empty object when not provided', async () => {
      (prisma.auditLog.create as jest.Mock).mockResolvedValue({ id: 'log-3' });

      await service.log({
        actorType: 'admin',
        action: 'approve',
        entityType: 'Digest',
        entityId: 'digest-1',
      });

      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            metadataJson: {},
          }),
        }),
      );
    });

    it('should never throw when Prisma create fails', async () => {
      (prisma.auditLog.create as jest.Mock).mockRejectedValue(
        new Error('DB connection lost'),
      );

      // Per CLAUDE.md: audit logging must never break primary operations
      await expect(
        service.log({
          actorType: 'user',
          action: 'delete',
          entityType: 'Note',
          entityId: 'note-1',
        }),
      ).resolves.toBeUndefined();
    });

    it('should handle all actor types', async () => {
      (prisma.auditLog.create as jest.Mock).mockResolvedValue({ id: 'log-4' });

      for (const actorType of ['user', 'admin', 'system'] as const) {
        await service.log({
          actorType,
          action: 'test',
          entityType: 'Test',
        });
      }

      expect(prisma.auditLog.create).toHaveBeenCalledTimes(3);
    });

    it('should handle complex metadata objects', async () => {
      (prisma.auditLog.create as jest.Mock).mockResolvedValue({ id: 'log-5' });

      const metadata = {
        previousStatus: 'draft',
        newStatus: 'published',
        changedFields: ['title', 'content'],
        reviewScore: 0.85,
      };

      await service.log({
        actorType: 'admin',
        action: 'publish',
        entityType: 'LegalDocument',
        entityId: 'doc-1',
        metadata,
      });

      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            metadataJson: metadata,
          }),
        }),
      );
    });
  });
});
