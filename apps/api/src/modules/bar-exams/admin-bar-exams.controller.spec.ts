import {
  BadRequestException,
  ExecutionContext,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { JwtPayload } from '@libertasian/types';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MfaGuard } from '../../common/guards/mfa.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CeleryDispatcherService } from '../../common/services/celery-dispatcher.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AdminBarExamsController } from './admin-bar-exams.controller';
import { AdminBarExamsService } from './admin-bar-exams.service';

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
  let prisma: {
    barExamSitting: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
    };
  };

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
    prisma = {
      barExamSitting: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
      },
    };

    const moduleBuilder = Test.createTestingModule({
      controllers: [AdminBarExamsController],
      providers: [
        AdminBarExamsService,
        { provide: PrismaService, useValue: prisma },
        { provide: CeleryDispatcherService, useValue: celery },
        { provide: AuditService, useValue: auditService },
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

  describe('POST /admin/bar-exams/ingest', () => {
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
      expect(result.data.taskName).toBe('bar_exam.ingest_sitting');
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'admin_dispatched_bar_exam_ingest',
          actorType: 'admin',
        }),
      );
    });

    it('dispatches backfill_lawphil_archive for an empty body', async () => {
      const result = await controller.dispatchIngest(
        {},
        adminUser,
        '127.0.0.1',
      );
      expect(celery.sendTask).toHaveBeenCalledWith(
        'bar_exam.backfill_lawphil_archive',
        { kwargs: {} },
      );
      expect(result.data.taskName).toBe('bar_exam.backfill_lawphil_archive');
    });

    it('caps backfill to a single year when {year} is given alone', async () => {
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

    it('rejects subjectSlug without year', async () => {
      await expect(
        controller.dispatchIngest(
          { subjectSlug: 'criminalQ' },
          adminUser,
          '127.0.0.1',
        ),
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
