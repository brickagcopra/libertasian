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
    $queryRaw: jest.Mock;
  };

  /**
   * Eligible documents, per derivative type, as the NOT EXISTS query
   * would return them (already filtered, oldest first).
   */
  let eligibleDocs: Record<string, Array<{ id: string }>>;
  /** Corpus-wide gap per derivative type, as the COUNT query returns it. */
  let missingCounts: Record<string, number>;

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
      // Both derivative-gap queries are raw SQL now: Prisma's `notIn` /
      // Set-diff versions could not express an anti-join without shipping
      // every artifact id through the driver. Dispatch the mock on the SQL
      // text the tagged template produces.
      $queryRaw: jest.fn(
        (strings: TemplateStringsArray, ...values: unknown[]) => {
          const sql = strings.join('?');
          const derivativeType = values[0] as string;

          if (sql.includes('COUNT(*)')) {
            return Promise.resolve([
              { missing: BigInt(missingCounts[derivativeType] ?? 0) },
            ]);
          }

          const limit = values[3] as number;
          const docs = eligibleDocs[derivativeType] ?? [];
          return Promise.resolve(docs.slice(0, limit));
        },
      ),
    };

    eligibleDocs = {};
    missingCounts = {};

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
    it('enqueues exactly the documents the eligibility query returns', async () => {
      // doc-1 and doc-3 already have an essay_prompt artifact, so the
      // NOT EXISTS query never returns them.
      eligibleDocs['essay_prompt'] = [{ id: 'doc-2' }, { id: 'doc-4' }];

      const result = await controller.backfillMissingDerivatives(
        { types: ['essay_prompt'], limit: 4 },
        adminUser,
        ip,
      );

      expect('dryRun' in result).toBe(false);
      if (!('dryRun' in result)) {
        expect(result.data.totalDispatched).toBe(2);
        // Fewer rows came back than the limit, so the gap is drained.
        expect(result.data.totalRemaining).toBe(0);
        expect(result.data.remainingByType['essay_prompt']).toBe(0);
        expect(result.data.dispatchedByType['essay_prompt']).toBe(2);
      }

      // The old newest-N scan is gone: no Prisma document scan at all.
      expect(prisma.legalDocument.findMany).not.toHaveBeenCalled();

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
            totalRemaining: 0,
          }),
        }),
      );
    });

    it('selects eligible docs across the whole corpus, oldest first', async () => {
      // The regression: with the newest 200 already covered, the old
      // implementation reported "Enqueued 0 / Skipped 600" forever and the
      // older backlog was unreachable. The query must not have a scan
      // window at all, and it must drain oldest-first.
      eligibleDocs['essay_prompt'] = [{ id: 'old-doc' }];

      await controller.backfillMissingDerivatives(
        { types: ['essay_prompt'], limit: 200 },
        adminUser,
        ip,
      );

      const call = prisma.$queryRaw.mock.calls.find((c) =>
        (c[0] as TemplateStringsArray).join('?').includes('SELECT ld.id'),
      );
      expect(call).toBeDefined();
      const sql = (call![0] as TemplateStringsArray).join('?');
      expect(sql).toContain('ORDER BY ld.created_at ASC');
      expect(sql).toContain('FROM derivative_artifacts da');
      expect(sql).toContain('FROM derivative_generation_jobs j');
      expect(sql).not.toContain('NOT IN');
      // type, type, in-flight statuses, limit
      expect(call![1]).toBe('essay_prompt');
      expect(call![3]).toEqual([
        'pending',
        'dispatched',
        'running',
        'validating',
      ]);
      expect(call![4]).toBe(200);
    });

    it('reports what is still missing when the run fills its limit', async () => {
      prisma.legalDocument.count.mockResolvedValue(50_000);
      eligibleDocs['flashcard'] = [{ id: 'a' }, { id: 'b' }];
      missingCounts['flashcard'] = 4_312;

      const result = await controller.backfillMissingDerivatives(
        { types: ['flashcard'], limit: 2 },
        adminUser,
        ip,
      );

      if (!('dryRun' in result)) {
        expect(result.data.totalDispatched).toBe(2);
        // Not a scan-window artefact: this is the real corpus-wide gap
        // left for the next run.
        expect(result.data.remainingByType['flashcard']).toBe(4_312);
        expect(result.data.totalRemaining).toBe(4_312);
      }
    });

    it('drops the plan cache after a dispatch so the preview is not stale', async () => {
      eligibleDocs['mcq_question'] = [{ id: 'doc-9' }];

      await controller.backfillMissingDerivatives(
        { types: ['mcq_question'], limit: 10 },
        adminUser,
        ip,
      );

      expect(redis.del).toHaveBeenCalledWith(
        'cache:admin:missing-derivatives-plan',
      );
    });

    it('leaves the plan cache alone when nothing was dispatched', async () => {
      await controller.backfillMissingDerivatives(
        { types: ['mcq_question'], limit: 10 },
        adminUser,
        ip,
      );

      expect(redis.del).not.toHaveBeenCalled();
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
      eligibleDocs['essay_prompt'] = Array.from({ length: 20 }, (_, i) => ({
        id: `essay-doc-${i}`,
      }));
      eligibleDocs['mcq_question'] = Array.from({ length: 20 }, (_, i) => ({
        id: `mcq-doc-${i}`,
      }));

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

      // Each per-type entry runs its own eligibility query with its own
      // LIMIT — the last bound parameter of the SELECT.
      const selectCalls = prisma.$queryRaw.mock.calls.filter((c) =>
        (c[0] as TemplateStringsArray).join('?').includes('SELECT ld.id'),
      );
      expect(selectCalls.length).toBe(2);
      expect(selectCalls[0]![1]).toBe('essay_prompt');
      expect(selectCalls[0]![4]).toBe(5);
      expect(selectCalls[1]![1]).toBe('mcq_question');
      expect(selectCalls[1]![4]).toBe(2);

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
      missingCounts['essay_prompt'] = 40;
      missingCounts['mcq_question'] = 40;
      missingCounts['flashcard'] = 40;

      const result = await controller.backfillMissingDerivatives(
        { dryRun: true },
        adminUser,
        ip,
      );

      expect('dryRun' in result && result.dryRun).toBe(true);
      if ('dryRun' in result) {
        expect(result.data.totals.totalMissing).toBe(120); // 40 × 3 types
        expect(result.data.perType).toHaveLength(3);
        // Per-call cost is now the measured per-type figure (30d of
        // model_runs, prod 2026-09-12) rather than one flat constant, so
        // the plan preview and the Generate panel quote the same number.
        const expectedCost: Record<string, number> = {
          essay_prompt: 0.0011,
          mcq_question: 0.0017,
          flashcard: 0.0009,
        };
        for (const row of result.data.perType) {
          expect(row.missingCount).toBe(40);
          expect(row.costPerCallUsd).toBeCloseTo(expectedCost[row.type]!, 6);
          expect(row.estimatedCostUsd).toBeCloseTo(
            40 * expectedCost[row.type]!,
            6,
          );
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
      // 5 of the 20 docs already have an essay_prompt artifact; the other
      // two types have none.
      missingCounts['essay_prompt'] = 15;
      missingCounts['mcq_question'] = 20;
      missingCounts['flashcard'] = 20;
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
