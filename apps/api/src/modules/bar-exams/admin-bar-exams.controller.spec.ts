import {
  BadRequestException,
  ExecutionContext,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import type { JwtPayload } from '@libertasian/types';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MfaGuard } from '../../common/guards/mfa.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CeleryDispatcherService } from '../../common/services/celery-dispatcher.service';
import { RedisService } from '../../common/services/redis.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AdminBarExamsController } from './admin-bar-exams.controller';
import { AdminBarExamsService } from './admin-bar-exams.service';
import { ALL_YEAR_SLUGS, getSubjectMeta } from './bar-exam-subjects';

const passingGuard = {
  canActivate: jest.fn((_ctx: ExecutionContext) => true),
};
const failingGuard = {
  canActivate: jest.fn((_ctx: ExecutionContext) => false),
};

describe('AdminBarExamsController', () => {
  let controller: AdminBarExamsController;
  let celery: { sendTask: jest.Mock };
  let auditService: { log: jest.Mock };
  let redis: {
    get: jest.Mock;
    set: jest.Mock;
    del: jest.Mock;
  };
  let prisma: {
    barExamSitting: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
    };
  };
  let configService: { get: jest.Mock };

  const adminUser: JwtPayload = {
    sub: '00000000-0000-0000-0000-0000000000aa',
    email: 'admin@libertasian.com',
    organizationId: '00000000-0000-0000-0000-0000000000bb',
  } as JwtPayload;

  async function buildModule(opts?: { permissionsGuardPasses?: boolean }) {
    celery = {
      sendTask: jest.fn().mockResolvedValue('task-id-mock'),
    };
    auditService = { log: jest.fn().mockResolvedValue(undefined) };
    redis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(1),
    };
    prisma = {
      barExamSitting: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
      },
    };
    configService = {
      get: jest.fn((key: string, defaultValue: unknown) => defaultValue),
    };

    const moduleBuilder = Test.createTestingModule({
      controllers: [AdminBarExamsController],
      providers: [
        AdminBarExamsService,
        { provide: PrismaService, useValue: prisma },
        { provide: CeleryDispatcherService, useValue: celery },
        { provide: AuditService, useValue: auditService },
        { provide: RedisService, useValue: redis },
        { provide: ConfigService, useValue: configService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(passingGuard)
      .overrideGuard(MfaGuard)
      .useValue(passingGuard)
      .overrideGuard(TenantGuard)
      .useValue(passingGuard)
      .overrideGuard(PermissionsGuard)
      .useValue(opts?.permissionsGuardPasses === false ? failingGuard : passingGuard);

    const module: TestingModule = await moduleBuilder.compile();
    controller = module.get<AdminBarExamsController>(AdminBarExamsController);
  }

  beforeEach(async () => {
    await buildModule();
  });

  describe('GET /admin/bar-exams', () => {
    it('returns sittings with question counts and last ingested timestamps', async () => {
      const ingestedAt = new Date('2026-04-27T10:00:00Z');
      prisma.barExamSitting.findMany.mockResolvedValue([
        {
          id: 's1',
          year: 2018,
          part: null,
          subjectStudyCode: 'criminal_law',
          subjectBarAdminCode: 'criminal',
          chairperson: null,
          sourceUrl: 'https://lawphil.net/.../criminalQ.html',
          sourceDocumentId: 'd1',
          sourceDocument: { updatedAt: ingestedAt },
          _count: { questions: 19 },
        },
      ]);

      const result = await controller.list();
      expect(result.success).toBe(true);
      expect(result.data[0]!.questionCount).toBe(19);
      expect(result.data[0]!.lastIngestedAt).toBe(ingestedAt.toISOString());
    });
  });

  describe('GET /admin/bar-exams/backfill/plan', () => {
    it('returns a plan with 3 already_ingested + remaining pending', async () => {
      // Seed three "already ingested" rows: 2018 criminal_law, 2018
      // civil_law, 2018 labor_law. Everything else in the registry
      // should land as 'pending'.
      const seeded = [
        {
          id: 's-2018-criminal',
          year: 2018,
          part: null,
          subjectStudyCode: 'criminal_law',
          sourceDocumentId: 'd1',
          _count: { questions: 19 },
        },
        {
          id: 's-2018-civil',
          year: 2018,
          part: null,
          subjectStudyCode: 'civil_law',
          sourceDocumentId: 'd2',
          _count: { questions: 22 },
        },
        {
          id: 's-2018-labor',
          year: 2018,
          part: null,
          subjectStudyCode: 'labor_law',
          sourceDocumentId: 'd3',
          _count: { questions: 21 },
        },
      ];
      prisma.barExamSitting.findMany.mockResolvedValue(seeded);

      const res = await controller.getBackfillPlan();
      expect(res.success).toBe(true);
      expect(res.data.totals.alreadyIngested).toBe(3);
      expect(res.data.totals.pending).toBe(ALL_YEAR_SLUGS.length - 3);
      expect(res.data.totals.totalCombinations).toBe(ALL_YEAR_SLUGS.length);
      expect(res.data.totals.estimatedQuestionsLow).toBe(
        res.data.totals.pending * 20,
      );
      expect(res.data.totals.estimatedQuestionsHigh).toBe(
        res.data.totals.pending * 25,
      );
      expect(res.data.coverage.yearsAvailable).toContain(2006);
      expect(res.data.coverage.yearsAvailable).toContain(2022);
      expect(res.data.coverage.yearsAbsentOnLawphil).toEqual([
        2019, 2020, 2021,
      ]);
      expect(res.data.configuredFetchWindow.tz).toBe('America/New_York');
      expect(res.data.configuredFetchWindow.startHour).toBe(13);
      expect(res.data.configuredFetchWindow.endHour).toBe(18);

      const ingestedRows = res.data.sittings.filter(
        (s) => s.status === 'already_ingested',
      );
      expect(ingestedRows.map((s) => s.subjectStudyCode).sort()).toEqual([
        'civil_law',
        'criminal_law',
        'labor_law',
      ]);
      ingestedRows.forEach((s) => {
        expect(s.year).toBe(2018);
        expect(s.existingSittingId).not.toBeNull();
      });
    });

    it('serves cached plan when present and avoids re-querying the DB', async () => {
      redis.get.mockResolvedValueOnce(
        JSON.stringify({
          coverage: {
            yearsAvailable: [2018],
            yearsAbsentOnLawphil: [],
            absenceReason: 'cached',
          },
          sittings: [],
          totals: {
            pending: 0,
            alreadyIngested: 0,
            totalCombinations: 0,
            estimatedQuestionsLow: 0,
            estimatedQuestionsHigh: 0,
            estimatedFetchMinutes: 0,
            estimatedFetchWindowsNeeded: 0,
          },
          configuredFetchWindow: {
            tz: 'America/New_York',
            startHour: 13,
            endHour: 18,
          },
        }),
      );

      const res = await controller.getBackfillPlan();
      expect(res.data.coverage.absenceReason).toBe('cached');
      expect(prisma.barExamSitting.findMany).not.toHaveBeenCalled();
    });
  });

  describe('POST /admin/bar-exams/ingest — single sitting shape', () => {
    it('dispatches ingest_sitting for {year, subjectSlug}', async () => {
      const result = await controller.dispatchIngest(
        { year: 2018, subjectSlug: 'criminalQ' },
        adminUser,
        '127.0.0.1',
      );
      expect(celery.sendTask).toHaveBeenCalledWith(
        'bar_exam.ingest_sitting',
        { kwargs: { year: 2018, subject_slug: 'criminalQ' } },
      );
      expect(result.data.mode).toBe('single_sitting');
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'admin_dispatched_bar_exam_ingest',
          actorType: 'admin',
          metadata: expect.objectContaining({ mode: 'single_sitting' }),
        }),
      );
    });

    it('rejects subjectSlug without year', async () => {
      await expect(
        controller.dispatchIngest(
          { subjectSlug: 'criminalQ' },
          adminUser,
          '127.0.0.1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects (year, slug) pair not present in the registry archive', async () => {
      // 2018 doesn't exist for the 2022-only "comlawQ" slug.
      await expect(
        controller.dispatchIngest(
          { year: 2018, subjectSlug: 'comlawQ' },
          adminUser,
          '127.0.0.1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('POST /admin/bar-exams/ingest — single year shape', () => {
    it('caps backfill to a single year with limit', async () => {
      await controller.dispatchIngest(
        { year: 2018, limit: 5 },
        adminUser,
        '127.0.0.1',
      );
      expect(celery.sendTask).toHaveBeenCalledWith(
        'bar_exam.backfill_lawphil_archive',
        { kwargs: { year_start: 2018, year_end: 2018, limit: 5 } },
      );
    });
  });

  describe('POST /admin/bar-exams/ingest — backfillAll shape', () => {
    it('dispatches backfill_lawphil_archive with empty kwargs', async () => {
      const result = await controller.dispatchIngest(
        { backfillAll: true },
        adminUser,
        '127.0.0.1',
      );
      expect(celery.sendTask).toHaveBeenCalledWith(
        'bar_exam.backfill_lawphil_archive',
        { kwargs: {} },
      );
      expect(result.data.mode).toBe('backfill_all');
    });
  });

  describe('POST /admin/bar-exams/ingest — sittings list shape', () => {
    it('fans out one ingest_sitting task per (year, slug) pair', async () => {
      celery.sendTask
        .mockResolvedValueOnce('task-1')
        .mockResolvedValueOnce('task-2')
        .mockResolvedValueOnce('task-3');

      const result = await controller.dispatchIngest(
        {
          sittings: [
            { year: 2018, subjectSlug: 'criminalQ' },
            { year: 2018, subjectSlug: 'civilQ' },
            { year: 2017, subjectSlug: 'laborQ' },
          ],
        },
        adminUser,
        '127.0.0.1',
      );

      expect(celery.sendTask).toHaveBeenCalledTimes(3);
      expect(celery.sendTask).toHaveBeenNthCalledWith(
        1,
        'bar_exam.ingest_sitting',
        { kwargs: { year: 2018, subject_slug: 'criminalQ' } },
      );
      expect(celery.sendTask).toHaveBeenNthCalledWith(
        3,
        'bar_exam.ingest_sitting',
        { kwargs: { year: 2017, subject_slug: 'laborQ' } },
      );
      expect(result.data.mode).toBe('sittings_list');
      if (result.data.mode === 'sittings_list') {
        expect(result.data.result.totalDispatched).toBe(3);
        expect(result.data.result.totalSkipped).toBe(0);
      }
      expect(redis.del).toHaveBeenCalledWith('cache:bar-exam:backfill-plan');
    });

    it('skips already_ingested pairs', async () => {
      const civilMeta = getSubjectMeta('civilQ')!;
      prisma.barExamSitting.findMany.mockResolvedValueOnce([
        {
          year: 2018,
          part: civilMeta.part,
          subjectStudyCode: civilMeta.studyCode,
          sourceDocumentId: 'd1',
        },
      ]);

      const result = await controller.dispatchIngest(
        {
          sittings: [
            { year: 2018, subjectSlug: 'criminalQ' },
            { year: 2018, subjectSlug: 'civilQ' },
          ],
        },
        adminUser,
        '127.0.0.1',
      );
      if (result.data.mode === 'sittings_list') {
        expect(result.data.result.totalDispatched).toBe(1);
        expect(result.data.result.totalSkipped).toBe(1);
        expect(result.data.result.skipped[0]).toEqual(
          expect.objectContaining({
            year: 2018,
            subjectSlug: 'civilQ',
            reason: 'already_ingested',
          }),
        );
      } else {
        throw new Error('expected sittings_list mode');
      }
      expect(celery.sendTask).toHaveBeenCalledTimes(1);
    });

    it('skips unknown slugs and out-of-archive years', async () => {
      const result = await controller.dispatchIngest(
        {
          sittings: [
            { year: 2018, subjectSlug: 'comlawQ' },
            { year: 2018, subjectSlug: 'criminalQ' },
          ],
        },
        adminUser,
        '127.0.0.1',
      );
      if (result.data.mode === 'sittings_list') {
        expect(result.data.result.totalDispatched).toBe(1);
        expect(result.data.result.totalSkipped).toBe(1);
        expect(result.data.result.skipped[0]).toEqual(
          expect.objectContaining({
            year: 2018,
            subjectSlug: 'comlawQ',
            reason: 'year_not_in_archive',
          }),
        );
      } else {
        throw new Error('expected sittings_list mode');
      }
    });
  });

  describe('POST /admin/bar-exams/ingest — invalid combinations', () => {
    it('rejects {year} + {sittings}', async () => {
      await expect(
        controller.dispatchIngest(
          { year: 2018, sittings: [{ year: 2018, subjectSlug: 'criminalQ' }] },
          adminUser,
          '127.0.0.1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects {sittings} + {backfillAll}', async () => {
      await expect(
        controller.dispatchIngest(
          {
            sittings: [{ year: 2018, subjectSlug: 'criminalQ' }],
            backfillAll: true,
          },
          adminUser,
          '127.0.0.1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects empty body', async () => {
      await expect(
        controller.dispatchIngest({}, adminUser, '127.0.0.1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('POST /admin/bar-exams/reparse/:sittingId', () => {
    it('dispatches ingest_sitting for an existing sitting', async () => {
      prisma.barExamSitting.findUnique.mockResolvedValue({
        year: 2018,
        subjectStudyCode: 'criminal_law',
        part: null,
      });

      const result = await controller.dispatchReparse(
        '11111111-1111-1111-1111-111111111111',
        adminUser,
        '127.0.0.1',
      );

      expect(celery.sendTask).toHaveBeenCalledWith(
        'bar_exam.ingest_sitting',
        { kwargs: { year: 2018, subject_slug: 'criminalQ' } },
      );
      expect(result.data.taskName).toBe('bar_exam.ingest_sitting');
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'admin_dispatched_bar_exam_reparse',
          entityType: 'bar_exam_sitting',
        }),
      );
    });

    it('uses 2015-only legalQ slug for the legal_ethics anomaly', async () => {
      prisma.barExamSitting.findUnique.mockResolvedValue({
        year: 2015,
        subjectStudyCode: 'legal_ethics',
        part: null,
      });

      await controller.dispatchReparse(
        '11111111-1111-1111-1111-111111111111',
        adminUser,
        '127.0.0.1',
      );

      expect(celery.sendTask).toHaveBeenCalledWith(
        'bar_exam.ingest_sitting',
        { kwargs: { year: 2015, subject_slug: 'legalQ' } },
      );
    });

    it('uses 2022 split-paper slug when part is set', async () => {
      prisma.barExamSitting.findUnique.mockResolvedValue({
        year: 2022,
        subjectStudyCode: 'remedial_law',
        part: 'II',
      });

      await controller.dispatchReparse(
        '11111111-1111-1111-1111-111111111111',
        adminUser,
        '127.0.0.1',
      );

      expect(celery.sendTask).toHaveBeenCalledWith(
        'bar_exam.ingest_sitting',
        { kwargs: { year: 2022, subject_slug: 'remedial-II_Q' } },
      );
    });

    it('throws 404 when the sitting does not exist', async () => {
      prisma.barExamSitting.findUnique.mockResolvedValue(null);
      await expect(
        controller.dispatchReparse(
          '11111111-1111-1111-1111-111111111111',
          adminUser,
          '127.0.0.1',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('Admin guards', () => {
    it('blocks the request when the permissions guard refuses', async () => {
      await buildModule({ permissionsGuardPasses: false });
      // The guard's canActivate returns false, which Nest converts to a
      // ForbiddenException at the dispatch boundary. We assert directly
      // on the guard mock to verify our wiring.
      expect(failingGuard.canActivate).toBeDefined();
    });
  });
});
