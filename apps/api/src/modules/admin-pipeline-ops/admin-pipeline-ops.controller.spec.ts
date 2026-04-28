import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import type { JwtPayload } from '@libertasian/types';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MfaGuard } from '../../common/guards/mfa.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CeleryDispatcherService } from '../../common/services/celery-dispatcher.service';
import { RedisService } from '../../common/services/redis.service';
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
  let redis: jest.Mocked<RedisService>;
  let prisma: {
    derivativeArtifact: {
      findMany: jest.Mock;
      count: jest.Mock;
    };
    derivativeGenerationJob: {
      findMany: jest.Mock;
      create: jest.Mock;
    };
    legalDocument: { findMany: jest.Mock; count: jest.Mock };
    citation: { groupBy: jest.Mock };
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

    redis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(0),
    } as unknown as jest.Mocked<RedisService>;

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
        count: jest.fn().mockResolvedValue(0),
      },
      citation: {
        groupBy: jest.fn().mockResolvedValue([]),
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
        { provide: RedisService, useValue: redis },
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
      // Narrow off the dryRun union before asserting on .data.taskId.
      expect('dryRun' in result).toBe(false);
      if (!('dryRun' in result)) {
        expect(result.data).toEqual(
          expect.objectContaining({
            taskId: 'task-id-mock',
            dispatchedAt: expect.any(String),
            limit: 250,
          }),
        );
      }
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

    it('returns the plan shape and writes no audit / dispatches no task on dryRun', async () => {
      prisma.legalDocument.count.mockResolvedValue(120);
      prisma.citation.groupBy.mockResolvedValue(
        Array.from({ length: 30 }, (_, i) => ({ fromDocumentId: `d${i}` })),
      );

      const result = await controller.dispatchCitationsBackfill(
        { dryRun: true },
        adminUser,
        ip,
      );

      expect(result.success).toBe(true);
      expect('dryRun' in result && result.dryRun).toBe(true);
      if ('dryRun' in result) {
        expect(result.data.totalCorpusDocs).toBe(120);
        expect(result.data.docsAlreadyHaveCitations).toBe(30);
        expect(result.data.docsPending).toBe(90);
        expect(result.data.estimatedNewCitationsRange.low).toBe(900);
        expect(result.data.estimatedNewCitationsRange.high).toBe(2250);
      }

      expect(celery.sendTask).not.toHaveBeenCalled();
      expect(auditService.log).not.toHaveBeenCalled();
    });
  });

  describe('GET /admin/citations/backfill/plan', () => {
    it('returns corpus + citation aggregates and last-dispatch metadata', async () => {
      prisma.legalDocument.count.mockResolvedValue(50);
      prisma.citation.groupBy.mockResolvedValue([
        { fromDocumentId: 'd1' },
        { fromDocumentId: 'd2' },
      ]);
      prisma.auditLog.findFirst.mockResolvedValue({
        createdAt: new Date('2026-04-25T08:00:00.000Z'),
        actorUserId: 'user-xyz',
      });

      const result = await controller.getCitationsBackfillPlan();

      expect(result.success).toBe(true);
      expect(result.data).toEqual(
        expect.objectContaining({
          totalCorpusDocs: 50,
          docsAlreadyHaveCitations: 2,
          docsPending: 48,
          estimatedNewCitationsRange: { low: 480, high: 1200 },
          lastBackfillAt: '2026-04-25T08:00:00.000Z',
          lastBackfillDispatchedBy: 'user-xyz',
        }),
      );
      // 60s cache write.
      expect(redis.set).toHaveBeenCalledWith(
        'cache:admin:citations-backfill-plan',
        expect.any(String),
        60,
      );
    });

    it('returns the cached plan without hitting the DB on a warm cache', async () => {
      const cachedPayload = {
        totalCorpusDocs: 9,
        docsAlreadyHaveCitations: 3,
        docsPending: 6,
        estimatedNewCitationsRange: { low: 60, high: 150 },
        estimatedMinutes: 1,
        lastBackfillAt: null,
        lastBackfillDispatchedBy: null,
      };
      redis.get.mockResolvedValue(JSON.stringify(cachedPayload));

      const result = await controller.getCitationsBackfillPlan();

      expect(result.data).toEqual(cachedPayload);
      expect(prisma.legalDocument.count).not.toHaveBeenCalled();
      expect(prisma.citation.groupBy).not.toHaveBeenCalled();
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

      expect('dryRun' in result).toBe(false);
      if (!('dryRun' in result)) {
        expect(result.data.totalDispatched).toBe(2);
        expect(result.data.totalSkipped).toBe(2);
        expect(result.data.dispatchedByType['essay_prompt']).toBe(2);
      }

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
      if (!('dryRun' in result)) {
        expect(Object.keys(result.data.dispatchedByType).sort()).toEqual([
          'essay_prompt',
          'flashcard',
          'mcq_question',
        ]);
      }
      // Poll task NOT kicked when nothing was enqueued.
      expect(celery.sendTask).not.toHaveBeenCalled();
    });

    it('accepts perTypeLimits with explicit per-type caps', async () => {
      prisma.legalDocument.findMany.mockImplementation(({ take }) =>
        Promise.resolve(
          Array.from({ length: take as number }, (_, i) => ({
            id: `doc-${i}`,
          })),
        ),
      );

      await controller.backfillMissingDerivatives(
        {
          perTypeLimits: [
            { type: 'essay_prompt', limit: 5 },
            { type: 'mcq_question', limit: 2 },
          ],
        },
        adminUser,
        ip,
      );

      // Each per-type entry should hit findMany once with its own take.
      const findManyCalls = prisma.legalDocument.findMany.mock.calls;
      expect(findManyCalls.length).toBe(2);
      expect(findManyCalls[0][0].take).toBe(5);
      expect(findManyCalls[1][0].take).toBe(2);

      // Audit metadata reflects the per-type shape.
      const auditCall = auditService.log.mock.calls[0]![0];
      expect(auditCall.metadata).toEqual(
        expect.objectContaining({
          types: ['essay_prompt', 'mcq_question'],
          perTypeLimits: [
            { type: 'essay_prompt', limit: 5 },
            { type: 'mcq_question', limit: 2 },
          ],
        }),
      );
    });

    it('rejects mixing perTypeLimits with types/limit', async () => {
      await expect(
        controller.backfillMissingDerivatives(
          {
            types: ['essay_prompt'],
            perTypeLimits: [{ type: 'mcq_question' }],
          },
          adminUser,
          ip,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.legalDocument.findMany).not.toHaveBeenCalled();
      expect(auditService.log).not.toHaveBeenCalled();
    });

    it('rejects duplicate types inside perTypeLimits', async () => {
      await expect(
        controller.backfillMissingDerivatives(
          {
            perTypeLimits: [
              { type: 'essay_prompt', limit: 10 },
              { type: 'essay_prompt', limit: 20 },
            ],
          },
          adminUser,
          ip,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('returns the plan shape and writes no audit / no rows on dryRun', async () => {
      prisma.legalDocument.count.mockResolvedValue(40);
      // No artifacts and no in-flight jobs → all 40 docs are missing for
      // every type.
      prisma.derivativeArtifact.findMany.mockResolvedValue([]);
      prisma.derivativeGenerationJob.findMany.mockResolvedValue([]);

      const result = await controller.backfillMissingDerivatives(
        { dryRun: true },
        adminUser,
        ip,
      );

      expect('dryRun' in result && result.dryRun).toBe(true);
      if ('dryRun' in result) {
        expect(result.data.totals.totalMissing).toBe(120); // 40 × 3 types
        expect(result.data.perType).toHaveLength(3);
        for (const row of result.data.perType) {
          expect(row.missingCount).toBe(40);
          expect(row.costPerCallUsd).toBeCloseTo(0.0003, 6);
          expect(row.estimatedCostUsd).toBeCloseTo(40 * 0.0003, 6);
        }
      }

      expect(prisma.derivativeGenerationJob.create).not.toHaveBeenCalled();
      expect(celery.sendTask).not.toHaveBeenCalled();
      expect(auditService.log).not.toHaveBeenCalled();
    });
  });

  describe('GET /admin/derivatives/backfill-missing/plan', () => {
    it('returns per-type missing counts and totals', async () => {
      prisma.legalDocument.count.mockResolvedValue(20);
      prisma.derivativeArtifact.findMany.mockImplementation(({ where }) => {
        if (where.derivativeType === 'essay_prompt') {
          // 5 docs already have essay_prompt artifacts.
          return Promise.resolve(
            Array.from({ length: 5 }, (_, i) => ({
              sourceDocumentId: `doc-${i}`,
            })),
          );
        }
        return Promise.resolve([]);
      });
      prisma.auditLog.findFirst.mockResolvedValue({
        createdAt: new Date('2026-04-26T11:00:00.000Z'),
        actorUserId: 'user-abc',
      });

      const result = await controller.getMissingDerivativesPlan();

      expect(result.success).toBe(true);
      const essay = result.data.perType.find((r) => r.type === 'essay_prompt');
      const mcq = result.data.perType.find((r) => r.type === 'mcq_question');
      expect(essay?.missingCount).toBe(15); // 20 - 5
      expect(mcq?.missingCount).toBe(20); // none extracted yet
      expect(result.data.totals.totalMissing).toBe(15 + 20 + 20);
      expect(result.data.totals.lastBackfillAt).toBe('2026-04-26T11:00:00.000Z');
      expect(result.data.totals.lastBackfillDispatchedBy).toBe('user-abc');
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
