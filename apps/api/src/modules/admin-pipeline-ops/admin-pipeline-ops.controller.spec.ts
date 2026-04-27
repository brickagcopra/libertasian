import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { JwtPayload } from '@libertasian/types';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MfaGuard } from '../../common/guards/mfa.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CeleryDispatcherService } from '../../common/services/celery-dispatcher.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AutoPromoteService } from '../internal/auto-promote.service';
import { AdminPipelineOpsController } from './admin-pipeline-ops.controller';
import { AdminPipelineOpsService } from './admin-pipeline-ops.service';

const passingGuard = { canActivate: jest.fn().mockReturnValue(true) };

describe('AdminPipelineOpsController', () => {
  let controller: AdminPipelineOpsController;
  let celery: jest.Mocked<CeleryDispatcherService>;
  let auditService: jest.Mocked<AuditService>;
  let autoPromote: jest.Mocked<AutoPromoteService>;
  let prisma: {
    derivativeArtifact: {
      findMany: jest.Mock;
      count: jest.Mock;
    };
    derivativeGenerationJob: {
      findMany: jest.Mock;
      create: jest.Mock;
    };
    legalDocument: { findMany: jest.Mock };
    auditLog: { findFirst: jest.Mock; count: jest.Mock };
  };

  const adminUser: JwtPayload = {
    sub: '00000000-0000-0000-0000-0000000000aa',
    email: 'admin@libertasian.com',
    organizationId: '00000000-0000-0000-0000-0000000000bb',
  } as JwtPayload;
  const ip = '127.0.0.1';

  beforeEach(async () => {
    celery = {
      sendTask: jest.fn().mockResolvedValue('task-id-mock'),
    } as unknown as jest.Mocked<CeleryDispatcherService>;

    auditService = {
      log: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<AuditService>;

    autoPromote = {
      sweepBacklog: jest.fn().mockResolvedValue({ promoted: 3, scanned: 12 }),
    } as unknown as jest.Mocked<AutoPromoteService>;

    prisma = {
      derivativeArtifact: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      derivativeGenerationJob: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({ id: `job-${data.sourceDocumentId}`, ...data }),
        ),
      },
      legalDocument: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      auditLog: {
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
      },
    };

    const config = {
      get: jest.fn((key: string, fallback: unknown) => {
        if (key === 'AUTO_PROMOTE_CONFIDENCE_THRESHOLD') return 0.8;
        if (key === 'AUTO_PROMOTE_EXCLUDED_TYPES') return 'mcq_question,subject_outline';
        return fallback;
      }),
    } as unknown as ConfigService;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminPipelineOpsController],
      providers: [
        AdminPipelineOpsService,
        { provide: PrismaService, useValue: prisma },
        { provide: CeleryDispatcherService, useValue: celery },
        { provide: AuditService, useValue: auditService },
        { provide: AutoPromoteService, useValue: autoPromote },
        { provide: ConfigService, useValue: config },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(passingGuard)
      .overrideGuard(MfaGuard)
      .useValue(passingGuard)
      .overrideGuard(TenantGuard)
      .useValue(passingGuard)
      .overrideGuard(PermissionsGuard)
      .useValue(passingGuard)
      .compile();

    controller = module.get(AdminPipelineOpsController);
  });

  it('compiles with all auth/mfa/tenant/permissions guards mocked', () => {
    expect(controller).toBeDefined();
  });

  describe('POST /admin/citations/backfill', () => {
    it('dispatches the citations Celery task with optional limit and writes audit', async () => {
      const result = await controller.dispatchCitationsBackfill(
        { limit: 250 },
        adminUser,
        ip,
      );

      expect(celery.sendTask).toHaveBeenCalledWith(
        'citations.backfill_corpus_documents',
        { kwargs: { limit: 250 } },
      );
      expect(result.success).toBe(true);
      expect(result.data).toEqual(
        expect.objectContaining({
          taskId: 'task-id-mock',
          dispatchedAt: expect.any(String),
          limit: 250,
        }),
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: adminUser.sub,
          actorType: 'admin',
          action: 'admin_dispatched_citation_backfill',
          entityType: 'celery_task',
          entityId: 'task-id-mock',
          metadata: expect.objectContaining({ ip, limit: 250, taskId: 'task-id-mock' }),
        }),
      );
    });

    it('omits the limit kwarg when none is supplied', async () => {
      await controller.dispatchCitationsBackfill({}, adminUser, ip);

      expect(celery.sendTask).toHaveBeenCalledWith(
        'citations.backfill_corpus_documents',
        { kwargs: {} },
      );
    });
  });

  describe('POST /admin/derivatives/backfill-missing', () => {
    it('skips docs that already have an artifact and enqueues only missing ones', async () => {
      // 4 candidate docs, 2 already have an artifact for essay_prompt.
      prisma.legalDocument.findMany.mockResolvedValue([
        { id: 'doc-1' },
        { id: 'doc-2' },
        { id: 'doc-3' },
        { id: 'doc-4' },
      ]);
      prisma.derivativeArtifact.findMany.mockImplementation(({ where }) => {
        if (where.derivativeType === 'essay_prompt') {
          return Promise.resolve([
            { sourceDocumentId: 'doc-1' },
            { sourceDocumentId: 'doc-3' },
          ]);
        }
        return Promise.resolve([]);
      });

      const result = await controller.backfillMissingDerivatives(
        { types: ['essay_prompt'], limit: 4 },
        adminUser,
        ip,
      );

      expect(result.data.totalDispatched).toBe(2);
      expect(result.data.totalSkipped).toBe(2);
      expect(result.data.dispatchedByType['essay_prompt']).toBe(2);

      // create called only for the two missing docs
      expect(prisma.derivativeGenerationJob.create).toHaveBeenCalledTimes(2);
      const createdDocIds = prisma.derivativeGenerationJob.create.mock.calls.map(
        (c) => (c[0] as { data: { sourceDocumentId: string } }).data.sourceDocumentId,
      );
      expect(createdDocIds.sort()).toEqual(['doc-2', 'doc-4']);

      // each created row carries the new trigger_type and pending status
      const firstCall = prisma.derivativeGenerationJob.create.mock.calls[0][0];
      expect(firstCall.data.triggerType).toBe('auto_ingest_backfill');
      expect(firstCall.data.status).toBe('pending');
      expect(firstCall.data.derivativeType).toBe('essay_prompt');
      expect(firstCall.data.triggeredByUserId).toBe(adminUser.sub);

      // dispatcher kicked once for the whole batch
      expect(celery.sendTask).toHaveBeenCalledWith('derivatives.poll_pending_jobs');

      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'admin_dispatched_missing_derivatives_backfill',
          entityType: 'derivative_generation_job',
          metadata: expect.objectContaining({
            ip,
            types: ['essay_prompt'],
            limit: 4,
            totalDispatched: 2,
            totalSkipped: 2,
          }),
        }),
      );
    });

    it('defaults to all three types when types is omitted', async () => {
      const result = await controller.backfillMissingDerivatives({}, adminUser, ip);

      // No documents in the test fixture → totalDispatched 0, but dispatchedByType
      // initialised for all three default types.
      expect(Object.keys(result.data.dispatchedByType).sort()).toEqual([
        'essay_prompt',
        'flashcard',
        'mcq_question',
      ]);
      // Poll task NOT kicked when nothing was enqueued.
      expect(celery.sendTask).not.toHaveBeenCalled();
    });
  });

  describe('POST /admin/auto-promote/sweep', () => {
    it('delegates to AutoPromoteService.sweepBacklog and writes audit with tally', async () => {
      const result = await controller.triggerAutoPromoteSweep(adminUser, ip);

      expect(autoPromote.sweepBacklog).toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        data: { promoted: 3, scanned: 12 },
      });
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'admin_triggered_auto_promote_sweep',
          entityType: 'derivative_artifact',
          metadata: expect.objectContaining({ ip, promoted: 3, scanned: 12 }),
        }),
      );
    });
  });

  describe('GET /admin/auto-promote/status', () => {
    it('returns config + counts and reads lastPromoted from manual sweep metadata', async () => {
      prisma.auditLog.findFirst.mockImplementation(({ where }) => {
        if (where.action === 'admin_triggered_auto_promote_sweep') {
          return Promise.resolve({
            createdAt: new Date('2026-04-26T10:00:00.000Z'),
            metadataJson: { promoted: 5, scanned: 20 },
          });
        }
        if (where.action === 'derivative_auto_promoted') {
          return Promise.resolve({
            createdAt: new Date('2026-04-27T01:00:00.000Z'),
          });
        }
        return Promise.resolve(null);
      });
      prisma.auditLog.count.mockImplementation(({ where }) => {
        if (where.createdAt) return Promise.resolve(17);
        return Promise.resolve(220);
      });

      const result = await controller.getAutoPromoteStatus();

      expect(result.success).toBe(true);
      // lastSweepAt is the more recent of the two timestamps.
      expect(result.data.lastSweepAt).toBe('2026-04-27T01:00:00.000Z');
      expect(result.data.lastPromoted).toBe(5);
      expect(result.data.last24hPromoted).toBe(17);
      expect(result.data.totalPromoted).toBe(220);
      expect(result.data.configThreshold).toBe(0.8);
      expect(result.data.configExcludedTypes).toEqual([
        'mcq_question',
        'subject_outline',
      ]);
    });
  });
});
