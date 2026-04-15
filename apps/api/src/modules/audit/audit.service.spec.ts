import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from './audit.service';

describe('AuditService', () => {
  let service: AuditService;
  let prisma: jest.Mocked<PrismaService>;

  const VALID_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  const VALID_UUID_2 = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
  const VALID_ORG_UUID = 'c3d4e5f6-a7b8-9012-cdef-123456789012';

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
        organizationId: VALID_ORG_UUID,
        actorUserId: VALID_UUID,
        actorType: 'user',
        action: 'create',
        entityType: 'Matter',
        entityId: VALID_UUID_2,
        metadata: { title: 'Test Matter' },
      });

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          organizationId: VALID_ORG_UUID,
          actorUserId: VALID_UUID,
          actorType: 'user',
          action: 'create',
          entityType: 'Matter',
          entityId: VALID_UUID_2,
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
        entityId: VALID_UUID,
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
          entityId: VALID_UUID,
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
        entityId: VALID_UUID,
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

    // --- Non-UUID coercion tests ---

    it('should move non-UUID entityId into metadata.entity_key', async () => {
      (prisma.auditLog.create as jest.Mock).mockResolvedValue({ id: 'log-6' });

      await service.log({
        actorUserId: VALID_UUID,
        actorType: 'admin',
        action: 'ai_settings.update',
        entityType: 'ai_settings',
        entityId: 'rag.model_name',
        metadata: { oldValue: 'v1', newValue: 'v2' },
      });

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          organizationId: undefined,
          actorUserId: VALID_UUID,
          actorType: 'admin',
          action: 'ai_settings.update',
          entityType: 'ai_settings',
          entityId: undefined,
          metadataJson: {
            entity_key: 'rag.model_name',
            oldValue: 'v1',
            newValue: 'v2',
          },
        },
      });
    });

    it('should move non-UUID actorUserId into metadata.actor_label and set actorType to system', async () => {
      (prisma.auditLog.create as jest.Mock).mockResolvedValue({ id: 'log-7' });

      await service.log({
        actorUserId: 'system',
        actorType: 'system',
        action: 'source_health.automated_recompute',
        entityType: 'source',
        entityId: 'all',
      });

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          organizationId: undefined,
          actorUserId: undefined,
          actorType: 'system',
          action: 'source_health.automated_recompute',
          entityType: 'source',
          entityId: undefined,
          metadataJson: {
            actor_label: 'system',
            entity_key: 'all',
          },
        },
      });
    });

    it('should keep valid UUID entityId and actorUserId unchanged', async () => {
      (prisma.auditLog.create as jest.Mock).mockResolvedValue({ id: 'log-8' });

      await service.log({
        actorUserId: VALID_UUID,
        actorType: 'user',
        action: 'update',
        entityType: 'Matter',
        entityId: VALID_UUID_2,
      });

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorUserId: VALID_UUID,
          entityId: VALID_UUID_2,
        }),
      });
    });

    it('should coerce non-UUID actorUserId with admin actorType to system', async () => {
      (prisma.auditLog.create as jest.Mock).mockResolvedValue({ id: 'log-9' });

      await service.log({
        actorUserId: 'cron-scheduler',
        actorType: 'admin',
        action: 'scheduled_task',
        entityType: 'Job',
      });

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorUserId: undefined,
          actorType: 'system',
          metadataJson: expect.objectContaining({
            actor_label: 'cron-scheduler',
          }),
        }),
      });
    });

    it('should preserve existing metadata when coercing non-UUID values', async () => {
      (prisma.auditLog.create as jest.Mock).mockResolvedValue({ id: 'log-10' });

      await service.log({
        actorType: 'admin',
        action: 'derivatives_admin.update_settings',
        entityType: 'ai_settings',
        entityId: 'derivative_generation',
        metadata: { enabled: true, typesEnabled: ['digest', 'summary'] },
      });

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          entityId: undefined,
          metadataJson: {
            entity_key: 'derivative_generation',
            enabled: true,
            typesEnabled: ['digest', 'summary'],
          },
        }),
      });
    });
  });
});
