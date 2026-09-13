import {
  BadRequestException,
  ConflictException,
  ExecutionContext,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import type { JwtPayload } from '@libertasian/types';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MfaGuard } from '../../common/guards/mfa.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CeleryDispatcherService } from '../../common/services/celery-dispatcher.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AdminBarExamAnswersController } from './admin-bar-exam-answers.controller';
import { AdminBarExamAnswersService } from './admin-bar-exam-answers.service';
import { BulkRejectBarExamAnswersDto } from './dto';

/** The global pipe from main.ts, so DTO-level rejections are tested for real. */
const globalPipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: false },
});

const passingGuard: { canActivate: (ctx: ExecutionContext) => boolean } = {
  canActivate: jest.fn().mockReturnValue(true),
};
const failingGuard: { canActivate: (ctx: ExecutionContext) => boolean } = {
  canActivate: jest.fn().mockReturnValue(false),
};

const ADMIN_USER: JwtPayload = {
  sub: '00000000-0000-0000-0000-0000000000aa',
  email: 'admin@libertasian.com',
  organizationId: '00000000-0000-0000-0000-0000000000bb',
} as JwtPayload;

// Structurally valid v4 UUIDs — version nibble 4, variant nibble 8. The DTOs
// are validated with @IsUUID('all'), which rejects the lazier 1111-…-1111
// shape, so fixtures that a real request could not carry would make the
// pipe-level tests below meaningless.
const ANSWER_ID = '11111111-1111-4111-8111-111111111111';
const QUESTION_ID = '22222222-2222-4222-8222-222222222222';
const JOB_ID = '66666666-6666-4666-8666-666666666666';

function fakeAnswerRow(
  overrides: Partial<{
    id: string;
    reviewStatus: string;
    visibility: string;
    reviewedAt: Date | null;
  }> = {},
) {
  return {
    id: overrides.id ?? ANSWER_ID,
    barExamQuestionId: QUESTION_ID,
    answerType: 'ai_generated',
    answerText: '**Answer.** Yes.\n',
    structuredAnswerJson: {
      answer: 'Yes.',
      law: 'NCC art 1.',
      analysis: 'It applies.',
      conclusion: 'Yes, it applies.',
    },
    modelRunId: 'run-1',
    confidence: 0.8,
    reviewStatus: overrides.reviewStatus ?? 'pending',
    visibility: overrides.visibility ?? 'private',
    reviewedByUserId: null,
    reviewedAt: overrides.reviewedAt ?? null,
    createdAt: new Date('2026-05-11T10:00:00Z'),
    updatedAt: new Date('2026-05-11T10:00:00Z'),
    question: {
      id: QUESTION_ID,
      questionNumber: 1,
      questionText: 'Discuss the doctrine of res ipsa loquitur with reference to Philippine jurisprudence.',
      barExamSitting: { year: 2018, subjectStudyCode: 'civil_law' },
    },
    modelRun: {
      id: 'run-1',
      modelName: 'gpt-4o-mini',
      promptTemplateVersion: 'bar_exam_alac.v1',
    },
  };
}

function fakeQuestionRow(
  id: string,
  year = 2018,
  subject = 'civil_law',
  answers: Array<{ reviewStatus: string }> = [],
) {
  return { id, barExamSitting: { year, subjectStudyCode: subject }, answers };
}

function fakeJobRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: JOB_ID,
    status: 'running',
    total: 3,
    onlyMissing: true,
    filtersJson: { year: 2018 },
    triggeredByUserId: ADMIN_USER.sub,
    createdAt: new Date('2026-09-13T10:00:00Z'),
    startedAt: new Date('2026-09-13T10:00:05Z'),
    finishedAt: null,
    ...overrides,
  };
}

describe('AdminBarExamAnswersController', () => {
  let controller: AdminBarExamAnswersController;
  let celery: { sendTask: jest.Mock };
  let auditService: { log: jest.Mock };
  let prisma: {
    barExamAnswer: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    barExamQuestion: { findMany: jest.Mock };
    barExamAnswerGenerationJob: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    barExamAnswerGenerationItem: {
      createMany: jest.Mock;
      findMany: jest.Mock;
      groupBy: jest.Mock;
      updateMany: jest.Mock;
      count: jest.Mock;
    };
    $transaction: jest.Mock;
    $queryRaw: jest.Mock;
  };

  async function buildModule(opts?: { permissionsGuardPasses?: boolean }) {
    celery = { sendTask: jest.fn().mockResolvedValue('task-id-mock') };
    auditService = { log: jest.fn().mockResolvedValue(undefined) };
    prisma = {
      barExamAnswer: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      barExamQuestion: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      barExamAnswerGenerationJob: {
        create: jest.fn().mockResolvedValue({ id: JOB_ID }),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue(undefined),
      },
      barExamAnswerGenerationItem: {
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([]),
        groupBy: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        count: jest.fn().mockResolvedValue(0),
      },
      $transaction: jest.fn(async (arg: unknown) =>
        typeof arg === 'function'
          ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (arg as (tx: unknown) => unknown)(prisma as any)
          : Promise.all(arg as Promise<unknown>[]),
      ),
      $queryRaw: jest.fn().mockResolvedValue([]),
    };

    const moduleBuilder = Test.createTestingModule({
      controllers: [AdminBarExamAnswersController],
      providers: [
        AdminBarExamAnswersService,
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
    controller = module.get<AdminBarExamAnswersController>(
      AdminBarExamAnswersController,
    );
  }

  beforeEach(async () => {
    await buildModule();
  });

  describe('auth gate', () => {
    it('controller declares Jwt + Mfa + Tenant + Permissions guards via @UseGuards', async () => {
      // The behavioral guarantee — that an unauthenticated/unauthorized
      // request is rejected — is enforced by NestJS at the routing layer
      // when these guards return false. Stripping any one of them would
      // open a hole, so the spec pins the declaration here.
      const { AdminBarExamAnswersController } = await import(
        './admin-bar-exam-answers.controller'
      );
      const { JwtAuthGuard } = await import('../../common/guards/jwt-auth.guard');
      const { MfaGuard } = await import('../../common/guards/mfa.guard');
      const { TenantGuard } = await import('../../common/guards/tenant.guard');
      const { PermissionsGuard } = await import(
        '../../common/guards/permissions.guard'
      );

      const guards = (Reflect.getMetadata(
        GUARDS_METADATA,
        AdminBarExamAnswersController,
      ) ?? []) as unknown[];
      expect(guards).toEqual([
        JwtAuthGuard,
        MfaGuard,
        TenantGuard,
        PermissionsGuard,
      ]);
    });
  });

  describe('GET /admin/bar-exams/answers', () => {
    it('defaults to pending status, returns excerpts + pagination meta', async () => {
      prisma.barExamAnswer.findMany.mockResolvedValue([fakeAnswerRow()]);

      const result = await controller.list({});

      expect(prisma.barExamAnswer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { reviewStatus: 'pending' } }),
      );
      expect(result.success).toBe(true);
      expect(result.data.items).toHaveLength(1);
      expect(result.data.items[0]!.question.subjectStudyCode).toBe('civil_law');
      expect(result.data.items[0]!.question.sittingYear).toBe(2018);
      expect(result.data.items[0]!.question.excerpt).toMatch(/^Discuss the doctrine/);
      expect(result.data.meta.hasNext).toBe(false);
    });

    it('honors reviewStatus filter and signals hasNext when more rows exist', async () => {
      const rows = Array.from({ length: 26 }, (_, i) =>
        fakeAnswerRow({ id: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}` }),
      );
      prisma.barExamAnswer.findMany.mockResolvedValue(rows);

      const result = await controller.list({ reviewStatus: 'approved', limit: 25 });

      expect(prisma.barExamAnswer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { reviewStatus: 'approved' },
          take: 26,
        }),
      );
      expect(result.data.items).toHaveLength(25);
      expect(result.data.meta.hasNext).toBe(true);
      expect(result.data.meta.nextCursor).toBe(result.data.items[24]!.id);
    });

    it('reviewStatus="all" applies NO status filter', async () => {
      // The "All" chip used to send nothing, which the API read as the
      // default — 'pending'. "All" therefore showed only pending rows.
      prisma.barExamAnswer.findMany.mockResolvedValue([]);

      await controller.list({ reviewStatus: 'all' });

      const args = prisma.barExamAnswer.findMany.mock.calls[0]![0] as {
        where: Record<string, unknown>;
      };
      expect(args.where).not.toHaveProperty('reviewStatus');
    });

    it('filters by year, subject and minimum confidence', async () => {
      prisma.barExamAnswer.findMany.mockResolvedValue([]);

      await controller.list({
        reviewStatus: 'all',
        year: 2018,
        subjectCode: 'criminal_law',
        minConfidence: 0.7,
      });

      expect(prisma.barExamAnswer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            confidence: { gte: 0.7 },
            question: {
              is: {
                barExamSitting: {
                  is: { year: 2018, subjectStudyCode: 'criminal_law' },
                },
              },
            },
          },
        }),
      );
    });
  });

  describe('approve / reject', () => {
    it('approve transitions state, sets reviewer + reviewedAt, writes audit log', async () => {
      prisma.barExamAnswer.findUnique.mockImplementation(({ select }: any) => {
        if (select && select.reviewStatus) {
          return Promise.resolve({ reviewStatus: 'pending' });
        }
        return Promise.resolve(
          fakeAnswerRow({
            reviewStatus: 'approved',
            visibility: 'public_editorial',
            reviewedAt: new Date('2026-05-11T11:00:00Z'),
          }),
        );
      });
      prisma.barExamAnswer.update.mockResolvedValue(undefined);

      const result = await controller.approve(ANSWER_ID, ADMIN_USER, '127.0.0.1');

      expect(prisma.barExamAnswer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: ANSWER_ID },
          data: expect.objectContaining({
            reviewStatus: 'approved',
            visibility: 'public_editorial',
            reviewedByUserId: ADMIN_USER.sub,
          }),
        }),
      );
      expect(result.data.reviewStatus).toBe('approved');
      expect(result.data.visibility).toBe('public_editorial');
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'admin_approved_bar_exam_answer',
          entityType: 'bar_exam_answer',
          entityId: ANSWER_ID,
          actorUserId: ADMIN_USER.sub,
        }),
      );
    });

    it('approve is idempotent — does not re-write already-approved rows', async () => {
      prisma.barExamAnswer.findUnique.mockImplementation(({ select }: any) => {
        if (select && select.reviewStatus) {
          return Promise.resolve({ reviewStatus: 'approved' });
        }
        return Promise.resolve(
          fakeAnswerRow({
            reviewStatus: 'approved',
            visibility: 'public_editorial',
          }),
        );
      });

      await controller.approve(ANSWER_ID, ADMIN_USER, '127.0.0.1');

      expect(prisma.barExamAnswer.update).not.toHaveBeenCalled();
      // Audit log STILL fires — a "re-confirm" by an admin is itself a
      // recordable admin action.
      expect(auditService.log).toHaveBeenCalled();
    });

    it('approve throws NotFound when the answer is missing', async () => {
      prisma.barExamAnswer.findUnique.mockResolvedValue(null);
      await expect(
        controller.approve(ANSWER_ID, ADMIN_USER, '127.0.0.1'),
      ).rejects.toThrow(NotFoundException);
      expect(auditService.log).not.toHaveBeenCalled();
    });

    it('reject transitions state, keeps visibility private, audit-logs reason', async () => {
      prisma.barExamAnswer.findUnique.mockImplementation(({ select }: any) => {
        if (select && select.reviewStatus) {
          return Promise.resolve({ reviewStatus: 'pending' });
        }
        return Promise.resolve(
          fakeAnswerRow({
            reviewStatus: 'rejected',
            visibility: 'private',
            reviewedAt: new Date('2026-05-11T11:00:00Z'),
          }),
        );
      });
      prisma.barExamAnswer.update.mockResolvedValue(undefined);

      const result = await controller.reject(
        ANSWER_ID,
        { reason: 'fabricated citation' },
        ADMIN_USER,
        '127.0.0.1',
      );

      expect(prisma.barExamAnswer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            reviewStatus: 'rejected',
            visibility: 'private',
          }),
        }),
      );
      expect(result.data.reviewStatus).toBe('rejected');
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'admin_rejected_bar_exam_answer',
          metadata: expect.objectContaining({ reason: 'fabricated citation' }),
        }),
      );
    });
  });

  describe('POST /dispatch-generation', () => {
    it('excludes questions that already have an ai_generated answer', async () => {
      // Regression for the bug that made generation unable to get past 50:
      // the resolver took the first 51 questions by number and never
      // excluded answered ones, so every re-dispatch of a filter re-picked
      // the same answered rows and the worker skipped all of them.
      prisma.barExamQuestion.findMany.mockResolvedValue([
        fakeQuestionRow('q1'),
        fakeQuestionRow('q2'),
      ]);

      await controller.dispatch({ year: 2018 }, ADMIN_USER, '127.0.0.1');

      const args = prisma.barExamQuestion.findMany.mock.calls[0]![0] as {
        where: Record<string, unknown>;
        take?: number;
      };
      expect(args.where['answers']).toEqual({
        none: { answerType: 'ai_generated' },
      });
      // ...and no cap: the whole matching set is resolved.
      expect(args.take).toBeUndefined();
    });

    it('creates the job + its items in one transaction and enqueues the worker', async () => {
      prisma.barExamQuestion.findMany.mockResolvedValue([
        fakeQuestionRow('q1'),
        fakeQuestionRow('q2'),
        fakeQuestionRow('q3', 2019, 'criminal_law'),
      ]);

      const result = await controller.dispatch(
        { year: 2018 },
        ADMIN_USER,
        '127.0.0.1',
      );

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.barExamAnswerGenerationJob.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'queued',
            total: 3,
            onlyMissing: true,
            triggeredByUserId: ADMIN_USER.sub,
          }),
        }),
      );
      expect(prisma.barExamAnswerGenerationItem.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [
            { jobId: JOB_ID, questionId: 'q1' },
            { jobId: JOB_ID, questionId: 'q2' },
            { jobId: JOB_ID, questionId: 'q3' },
          ],
        }),
      );
      expect(celery.sendTask).toHaveBeenCalledWith(
        'bar_exam.run_answer_generation_job',
        { kwargs: { job_id: JOB_ID } },
      );
      expect(result.data).toEqual({ dryRun: false, jobId: JOB_ID, total: 3 });
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'admin_created_bar_exam_answer_generation_job',
          entityType: 'bar_exam_answer_generation_job',
          entityId: JOB_ID,
        }),
      );
    });

    it('dryRun counts and breaks down by year × subject, and writes nothing', async () => {
      prisma.barExamQuestion.findMany.mockResolvedValue([
        fakeQuestionRow('q1', 2018, 'civil_law'),
        fakeQuestionRow('q2', 2018, 'civil_law'),
        fakeQuestionRow('q3', 2019, 'criminal_law'),
      ]);

      const result = await controller.dispatch(
        { year: 2018, dryRun: true },
        ADMIN_USER,
        '127.0.0.1',
      );

      expect(result.data).toEqual({
        dryRun: true,
        total: 3,
        missing: 3,
        replacingPending: 0,
        byYearSubject: [
          { year: 2019, subjectCode: 'criminal_law', count: 1 },
          { year: 2018, subjectCode: 'civil_law', count: 2 },
        ],
      });
      expect(prisma.barExamAnswerGenerationJob.create).not.toHaveBeenCalled();
      expect(prisma.barExamAnswerGenerationItem.createMany).not.toHaveBeenCalled();
      expect(celery.sendTask).not.toHaveBeenCalled();
      expect(auditService.log).not.toHaveBeenCalled();
    });

    it('refuses to dispatch when no filters are given', async () => {
      await expect(
        controller.dispatch({}, ADMIN_USER, '127.0.0.1'),
      ).rejects.toThrow(BadRequestException);
      expect(celery.sendTask).not.toHaveBeenCalled();
      expect(auditService.log).not.toHaveBeenCalled();
    });

    it('allMissing=true is the explicit opt-in for an unfiltered run', async () => {
      prisma.barExamQuestion.findMany.mockResolvedValue([fakeQuestionRow('q1')]);

      await controller.dispatch({ allMissing: true }, ADMIN_USER, '127.0.0.1');

      const args = prisma.barExamQuestion.findMany.mock.calls[0]![0] as {
        where: Record<string, unknown>;
      };
      // No sitting filter, but the missing-only constraint is forced on:
      // "all missing" must never mean "all questions".
      expect(args.where).toEqual({
        answers: { none: { answerType: 'ai_generated' } },
      });
    });

    it('errors when filters resolve to zero questions', async () => {
      prisma.barExamQuestion.findMany.mockResolvedValue([]);
      await expect(
        controller.dispatch({ year: 1999 }, ADMIN_USER, '127.0.0.1'),
      ).rejects.toThrow(BadRequestException);
      expect(celery.sendTask).not.toHaveBeenCalled();
    });
  });

  describe('POST /dispatch-generation — regeneratePending', () => {
    it('targets questions with no answer OR a pending one, never approved/rejected', async () => {
      prisma.barExamQuestion.findMany.mockResolvedValue([
        fakeQuestionRow('q1'),
        fakeQuestionRow('q2', 2018, 'civil_law', [{ reviewStatus: 'pending' }]),
      ]);

      await controller.dispatch(
        { year: 2018, regeneratePending: true },
        ADMIN_USER,
        '127.0.0.1',
      );

      const args = prisma.barExamQuestion.findMany.mock.calls[0]![0] as {
        where: Record<string, unknown>;
      };
      // The OR REPLACES the onlyMissing clause rather than joining it: an
      // approved or rejected answer can match neither branch, so it can never
      // enter the item set at all.
      expect(args.where['OR']).toEqual([
        { answers: { none: { answerType: 'ai_generated' } } },
        {
          answers: {
            some: { answerType: 'ai_generated', reviewStatus: 'pending' },
          },
        },
      ]);
      expect(args.where).not.toHaveProperty('answers');
    });

    it('maxConfidence includes unscored (NULL) answers', async () => {
      prisma.barExamQuestion.findMany.mockResolvedValue([fakeQuestionRow('q1')]);

      await controller.dispatch(
        { year: 2018, regeneratePending: true, maxConfidence: 0.7 },
        ADMIN_USER,
        '127.0.0.1',
      );

      const args = prisma.barExamQuestion.findMany.mock.calls[0]![0] as {
        where: { OR: Array<Record<string, any>> };
      };
      // `confidence < 0.7` alone is NULL-excluding in SQL, which would skip
      // exactly the priors-only v1 rows most worth regenerating.
      expect(args.where.OR[1]!['answers'].some).toEqual({
        answerType: 'ai_generated',
        reviewStatus: 'pending',
        OR: [{ confidence: { lt: 0.7 } }, { confidence: null }],
      });
    });

    it('dry run counts replaced pending answers apart from missing ones', async () => {
      prisma.barExamQuestion.findMany.mockResolvedValue([
        fakeQuestionRow('q1'),
        fakeQuestionRow('q2', 2018, 'civil_law', [{ reviewStatus: 'pending' }]),
        fakeQuestionRow('q3', 2018, 'civil_law', [{ reviewStatus: 'pending' }]),
      ]);

      const result = await controller.dispatch(
        { year: 2018, regeneratePending: true, dryRun: true },
        ADMIN_USER,
        '127.0.0.1',
      );

      expect(result.data).toEqual(
        expect.objectContaining({
          dryRun: true,
          total: 3,
          missing: 1,
          replacingPending: 2,
        }),
      );
      expect(prisma.barExamAnswerGenerationJob.create).not.toHaveBeenCalled();
    });

    it('stores the flag on the job so the worker can read it back', async () => {
      prisma.barExamQuestion.findMany.mockResolvedValue([fakeQuestionRow('q1')]);

      await controller.dispatch(
        { year: 2018, regeneratePending: true, maxConfidence: 0.7 },
        ADMIN_USER,
        '127.0.0.1',
      );

      expect(prisma.barExamAnswerGenerationJob.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            filtersJson: expect.objectContaining({
              regeneratePending: true,
              maxConfidence: 0.7,
            }),
          }),
        }),
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            filters: expect.objectContaining({
              regeneratePending: true,
              maxConfidence: 0.7,
            }),
          }),
        }),
      );
    });

    it('refuses maxConfidence without regeneratePending', async () => {
      // It would otherwise be silently ignored, dispatching a different job
      // than the one the admin described.
      await expect(
        controller.dispatch(
          { year: 2018, maxConfidence: 0.7 },
          ADMIN_USER,
          '127.0.0.1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(celery.sendTask).not.toHaveBeenCalled();
    });
  });

  describe('generation jobs', () => {
    it('lists jobs with counts, progress and a stalled flag', async () => {
      const stale = new Date(Date.now() - 20 * 60 * 1000);
      prisma.barExamAnswerGenerationJob.findMany.mockResolvedValue([
        fakeJobRow({ total: 4 }),
      ]);
      prisma.barExamAnswerGenerationItem.groupBy.mockResolvedValue([
        { jobId: JOB_ID, status: 'generated', _count: { _all: 2 }, _max: { updatedAt: stale } },
        { jobId: JOB_ID, status: 'failed', _count: { _all: 1 }, _max: { updatedAt: stale } },
        { jobId: JOB_ID, status: 'queued', _count: { _all: 1 }, _max: { updatedAt: stale } },
      ]);

      const result = await controller.listJobs({});

      const job = result.data.items[0]!;
      expect(job.counts).toEqual({
        queued: 1,
        running: 0,
        generated: 2,
        generatedUngrounded: 0,
        skippedExisting: 0,
        keptExisting: 0,
        failed: 1,
      });
      expect(job.done).toBe(3);
      // running + nothing moved for 20 minutes = stalled.
      expect(job.stalled).toBe(true);
    });

    it('counts kept_existing items as done, not as failures', async () => {
      // A regeneration that ran and lost to the answer already on the row.
      // Nothing needs retrying, so a progress card that left it out of `done`
      // would show a run stuck below 100% forever.
      const now = new Date();
      prisma.barExamAnswerGenerationJob.findMany.mockResolvedValue([
        fakeJobRow({ total: 3 }),
      ]);
      prisma.barExamAnswerGenerationItem.groupBy.mockResolvedValue([
        { jobId: JOB_ID, status: 'generated', _count: { _all: 1 }, _max: { updatedAt: now } },
        { jobId: JOB_ID, status: 'kept_existing', _count: { _all: 2 }, _max: { updatedAt: now } },
      ]);

      const job = (await controller.listJobs({})).data.items[0]!;

      expect(job.counts.keptExisting).toBe(2);
      expect(job.counts.failed).toBe(0);
      expect(job.done).toBe(3);
    });

    it('job detail returns failed items joined to year / subject / question', async () => {
      prisma.barExamAnswerGenerationJob.findUnique.mockResolvedValue(fakeJobRow());
      prisma.barExamAnswerGenerationItem.groupBy.mockResolvedValue([
        {
          status: 'failed',
          _count: { _all: 1 },
          _max: { updatedAt: new Date() },
        },
      ]);
      prisma.barExamAnswerGenerationItem.findMany.mockResolvedValue([
        {
          id: 'item-1',
          questionId: QUESTION_ID,
          errorCode: 'llm_abstained',
          errorMessage: 'insufficient sources',
          attempts: 1,
          updatedAt: new Date('2026-09-13T10:30:00Z'),
          question: {
            questionNumber: 7,
            barExamSitting: { year: 2018, subjectStudyCode: 'civil_law' },
          },
        },
      ]);

      const result = await controller.getJob(JOB_ID, {});

      expect(result.data.failedItems.items[0]).toEqual(
        expect.objectContaining({
          questionNumber: 7,
          sittingYear: 2018,
          subjectStudyCode: 'civil_law',
          errorCode: 'llm_abstained',
        }),
      );
    });

    it('cancel flips the job and audit-logs it', async () => {
      prisma.barExamAnswerGenerationJob.findUnique
        .mockResolvedValueOnce({ status: 'running' })
        .mockResolvedValue(fakeJobRow({ status: 'cancelled' }));

      const result = await controller.cancelJob(JOB_ID, ADMIN_USER, '127.0.0.1');

      expect(prisma.barExamAnswerGenerationJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'cancelled' }),
        }),
      );
      expect(result.data.status).toBe('cancelled');
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'admin_cancelled_bar_exam_answer_generation_job',
        }),
      );
    });

    it('cancel refuses a job that already finished', async () => {
      prisma.barExamAnswerGenerationJob.findUnique.mockResolvedValue({
        status: 'completed',
      });
      await expect(
        controller.cancelJob(JOB_ID, ADMIN_USER, '127.0.0.1'),
      ).rejects.toThrow(ConflictException);
    });

    it('retry-failed re-queues failed items and re-enqueues the worker', async () => {
      prisma.barExamAnswerGenerationJob.findUnique
        .mockResolvedValueOnce({ status: 'completed_with_failures' })
        .mockResolvedValue(fakeJobRow({ status: 'queued' }));
      prisma.barExamAnswerGenerationItem.updateMany.mockResolvedValue({ count: 4 });
      prisma.barExamAnswerGenerationItem.count.mockResolvedValue(4);

      const result = await controller.retryFailed(JOB_ID, ADMIN_USER, '127.0.0.1');

      expect(prisma.barExamAnswerGenerationItem.updateMany).toHaveBeenCalledWith({
        where: { jobId: JOB_ID, status: 'failed' },
        data: { status: 'queued', errorCode: null, errorMessage: null },
      });
      expect(celery.sendTask).toHaveBeenCalledWith(
        'bar_exam.run_answer_generation_job',
        { kwargs: { job_id: JOB_ID } },
      );
      expect(result.data.requeued).toBe(4);
    });

    it('retry-failed resumes a budget-paused job even with no failed items', async () => {
      // A budget stop returns the item to `queued`, never to `failed`, so
      // "retry" for a paused job is purely a re-enqueue.
      prisma.barExamAnswerGenerationJob.findUnique
        .mockResolvedValueOnce({ status: 'paused_budget' })
        .mockResolvedValue(fakeJobRow({ status: 'queued' }));
      prisma.barExamAnswerGenerationItem.updateMany.mockResolvedValue({ count: 0 });
      prisma.barExamAnswerGenerationItem.count.mockResolvedValue(900);

      const result = await controller.retryFailed(JOB_ID, ADMIN_USER, '127.0.0.1');

      expect(result.data.requeued).toBe(0);
      expect(celery.sendTask).toHaveBeenCalled();
    });

    it('retry-failed refuses when nothing is left to run', async () => {
      prisma.barExamAnswerGenerationJob.findUnique.mockResolvedValueOnce({
        status: 'completed',
      });
      prisma.barExamAnswerGenerationItem.updateMany.mockResolvedValue({ count: 0 });
      prisma.barExamAnswerGenerationItem.count.mockResolvedValue(0);

      await expect(
        controller.retryFailed(JOB_ID, ADMIN_USER, '127.0.0.1'),
      ).rejects.toThrow(ConflictException);
      expect(celery.sendTask).not.toHaveBeenCalled();
    });
  });

  describe('GET /coverage', () => {
    it('returns per year × subject cells plus overall totals, BigInt-free', async () => {
      prisma.$queryRaw.mockResolvedValue([
        {
          year: 2018,
          subject_study_code: 'civil_law',
          total_questions: BigInt(10),
          missing: BigInt(4),
          pending: BigInt(3),
          pending_at_or_above_070: BigInt(2),
          approved: BigInt(2),
          rejected: BigInt(1),
          unscored: BigInt(1),
        },
        {
          year: 2019,
          subject_study_code: 'criminal_law',
          total_questions: BigInt(5),
          missing: BigInt(5),
          pending: BigInt(0),
          pending_at_or_above_070: BigInt(0),
          approved: BigInt(0),
          rejected: BigInt(0),
          unscored: BigInt(0),
        },
      ]);

      const result = await controller.coverage();

      expect(result.data.cells[0]).toEqual({
        year: 2018,
        subjectCode: 'civil_law',
        totalQuestions: 10,
        answered: 6,
        missing: 4,
        pending: 3,
        pendingAtOrAbove070: 2,
        approved: 2,
        rejected: 1,
        unscored: 1,
      });
      expect(result.data.totals).toEqual({
        totalQuestions: 15,
        answered: 6,
        missing: 9,
        pending: 3,
        pendingAtOrAbove070: 2,
        approved: 2,
        rejected: 1,
        unscored: 1,
      });
      // Serializable — the admin dashboard went blank once over a raw BigInt.
      expect(() => JSON.stringify(result.data)).not.toThrow();
    });
  });

  describe('bulk approve / reject', () => {
    const matchedRows = [
      { id: 'a1', question: { barExamSitting: { year: 2018, subjectStudyCode: 'civil_law' } } },
      { id: 'a2', question: { barExamSitting: { year: 2018, subjectStudyCode: 'civil_law' } } },
    ];

    it('id mode approves only pending rows and writes one audit entry per row', async () => {
      prisma.barExamAnswer.findMany.mockResolvedValue(matchedRows);
      prisma.barExamAnswer.updateMany.mockResolvedValue({ count: 2 });

      const result = await controller.bulkApprove(
        { ids: [ANSWER_ID, QUESTION_ID] },
        ADMIN_USER,
        '127.0.0.1',
      );

      expect(prisma.barExamAnswer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            reviewStatus: 'pending',
            id: { in: [ANSWER_ID, QUESTION_ID] },
          }),
        }),
      );
      expect(prisma.barExamAnswer.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ['a1', 'a2'] }, reviewStatus: 'pending' },
          data: expect.objectContaining({
            reviewStatus: 'approved',
            visibility: 'public_editorial',
          }),
        }),
      );
      expect(result.data.matched).toBe(2);
      expect(result.data.updated).toBe(2);
      expect(auditService.log).toHaveBeenCalledTimes(2);
      const bulkIds = auditService.log.mock.calls.map(
        (c) => (c[0] as { metadata: { bulkOperationId: string } }).metadata.bulkOperationId,
      );
      expect(new Set(bulkIds).size).toBe(1);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'admin_bulk_approved_bar_exam_answer' }),
      );
    });

    it('filter mode requires confidence >= 0.70 and excludes unscored rows', async () => {
      prisma.barExamAnswer.findMany.mockResolvedValue(matchedRows);
      prisma.barExamAnswer.updateMany.mockResolvedValue({ count: 2 });

      await controller.bulkApprove(
        { filter: { minConfidence: 0.75, year: 2018 } },
        ADMIN_USER,
        '127.0.0.1',
      );

      const args = prisma.barExamAnswer.findMany.mock.calls[0]![0] as {
        where: Record<string, unknown>;
      };
      expect(args.where['reviewStatus']).toBe('pending');
      // `gte` is NULL-excluding in SQL: an unscored (NULL) row is never a
      // low-scoring row, and must never be swept into an approval.
      expect(args.where['confidence']).toEqual({ gte: 0.75 });
      expect(args.where['question']).toEqual({
        is: { barExamSitting: { is: { year: 2018 } } },
      });
    });

    it('filter mode refuses a minConfidence below 0.70', async () => {
      await expect(
        controller.bulkApprove(
          { filter: { minConfidence: 0.5 } },
          ADMIN_USER,
          '127.0.0.1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.barExamAnswer.updateMany).not.toHaveBeenCalled();
    });

    it('refuses a request that supplies both ids and filter', async () => {
      await expect(
        controller.bulkApprove(
          { ids: [ANSWER_ID], filter: { minConfidence: 0.8 } },
          ADMIN_USER,
          '127.0.0.1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('dryRun reports the count and writes nothing', async () => {
      prisma.barExamAnswer.findMany.mockResolvedValue(matchedRows);

      const result = await controller.bulkApprove(
        { filter: { minConfidence: 0.8 }, dryRun: true },
        ADMIN_USER,
        '127.0.0.1',
      );

      expect(result.data).toEqual({
        dryRun: true,
        matched: 2,
        updated: 0,
        byYearSubject: [{ year: 2018, subjectCode: 'civil_law', count: 2 }],
        bulkOperationId: null,
      });
      expect(prisma.barExamAnswer.updateMany).not.toHaveBeenCalled();
      expect(auditService.log).not.toHaveBeenCalled();
    });

    it('bulk reject by ids keeps visibility private and skips non-pending rows', async () => {
      prisma.barExamAnswer.findMany.mockResolvedValue(matchedRows);
      prisma.barExamAnswer.updateMany.mockResolvedValue({ count: 2 });

      const result = await controller.bulkReject(
        { ids: [ANSWER_ID, QUESTION_ID] },
        ADMIN_USER,
        '127.0.0.1',
      );

      // Non-pending rows are excluded twice: once when the set is read, and
      // again in the write, so a row reviewed by someone else in between is
      // skipped rather than overwritten.
      expect(prisma.barExamAnswer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            reviewStatus: 'pending',
            id: { in: [ANSWER_ID, QUESTION_ID] },
          },
        }),
      );
      expect(prisma.barExamAnswer.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ['a1', 'a2'] }, reviewStatus: 'pending' },
          data: expect.objectContaining({
            reviewStatus: 'rejected',
            visibility: 'private',
          }),
        }),
      );
      expect(result.data.updated).toBe(2);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'admin_bulk_rejected_bar_exam_answer',
          metadata: expect.objectContaining({ mode: 'ids' }),
        }),
      );
    });

    it('bulk reject has no filter mode — a filter body is a 400', async () => {
      // Rejecting by filter would mean discarding rows nobody looked at, with
      // no equivalent of the 0.70 floor to bound it. The DTO has no `filter`
      // property, so the global pipe's forbidNonWhitelisted is what refuses
      // it — the service never gets the chance to.
      await expect(
        globalPipe.transform(
          { ids: [ANSWER_ID], filter: { minConfidence: 0.8 } },
          { type: 'body', metatype: BulkRejectBarExamAnswersDto },
        ),
      ).rejects.toThrow(BadRequestException);

      // The same body without the filter key passes validation.
      await expect(
        globalPipe.transform(
          { ids: [ANSWER_ID], dryRun: true },
          { type: 'body', metatype: BulkRejectBarExamAnswersDto },
        ),
      ).resolves.toEqual(
        expect.objectContaining({ ids: [ANSWER_ID], dryRun: true }),
      );
    });

    it('bulk reject requires at least one id', async () => {
      await expect(
        globalPipe.transform(
          { ids: [] },
          { type: 'body', metatype: BulkRejectBarExamAnswersDto },
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
