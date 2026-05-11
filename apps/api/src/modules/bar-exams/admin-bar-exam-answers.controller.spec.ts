import {
  BadRequestException,
  ExecutionContext,
  NotFoundException,
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
import {
  AdminBarExamAnswersService,
  MAX_QUESTIONS_PER_DISPATCH,
} from './admin-bar-exam-answers.service';

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

const ANSWER_ID = '11111111-1111-1111-1111-111111111111';
const QUESTION_ID = '22222222-2222-2222-2222-222222222222';

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

describe('AdminBarExamAnswersController', () => {
  let controller: AdminBarExamAnswersController;
  let celery: { sendTask: jest.Mock };
  let auditService: { log: jest.Mock };
  let prisma: {
    barExamAnswer: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    barExamQuestion: {
      findMany: jest.Mock;
    };
  };

  async function buildModule(opts?: { permissionsGuardPasses?: boolean }) {
    celery = { sendTask: jest.fn().mockResolvedValue('task-id-mock') };
    auditService = { log: jest.fn().mockResolvedValue(undefined) };
    prisma = {
      barExamAnswer: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      barExamQuestion: {
        findMany: jest.fn().mockResolvedValue([]),
      },
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
    it('resolves explicit question ids and dispatches the celery task', async () => {
      const ids = [
        '33333333-3333-3333-3333-333333333333',
        '44444444-4444-4444-4444-444444444444',
      ];
      prisma.barExamQuestion.findMany.mockResolvedValue(
        ids.map((id) => ({ id })),
      );

      const result = await controller.dispatch(
        { questionIds: ids },
        ADMIN_USER,
        '127.0.0.1',
      );

      expect(prisma.barExamQuestion.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: ids } } }),
      );
      expect(celery.sendTask).toHaveBeenCalledWith(
        'bar_exam.generate_answers_for_questions',
        { kwargs: { question_ids: ids } },
      );
      expect(result.data.questionCount).toBe(2);
      expect(result.data.truncated).toBe(false);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'admin_dispatched_bar_exam_answer_generation',
          metadata: expect.objectContaining({
            questionCount: 2,
            truncated: false,
          }),
        }),
      );
    });

    it('resolves by sittingId when no explicit list is given', async () => {
      const sittingId = '55555555-5555-5555-5555-555555555555';
      prisma.barExamQuestion.findMany.mockResolvedValue([
        { id: 'q1' },
        { id: 'q2' },
        { id: 'q3' },
      ]);

      await controller.dispatch({ sittingId }, ADMIN_USER, '127.0.0.1');

      expect(prisma.barExamQuestion.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { barExamSittingId: sittingId } }),
      );
      expect(celery.sendTask).toHaveBeenCalledWith(
        'bar_exam.generate_answers_for_questions',
        { kwargs: { question_ids: ['q1', 'q2', 'q3'] } },
      );
    });

    it('resolves by year + subjectCode (nested sitting filter)', async () => {
      prisma.barExamQuestion.findMany.mockResolvedValue([{ id: 'q1' }]);

      await controller.dispatch(
        { year: 2018, subjectCode: 'criminal_law' },
        ADMIN_USER,
        '127.0.0.1',
      );

      expect(prisma.barExamQuestion.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            barExamSitting: {
              is: { year: 2018, subjectStudyCode: 'criminal_law' },
            },
          },
        }),
      );
    });

    it('caps resolved ids at 50 and flags truncation', async () => {
      // Service requests take=51 to detect overflow.
      const rows = Array.from(
        { length: MAX_QUESTIONS_PER_DISPATCH + 1 },
        (_, i) => ({ id: `q-${i}` }),
      );
      prisma.barExamQuestion.findMany.mockResolvedValue(rows);

      const result = await controller.dispatch(
        { year: 2018 },
        ADMIN_USER,
        '127.0.0.1',
      );

      expect(result.data.questionCount).toBe(MAX_QUESTIONS_PER_DISPATCH);
      expect(result.data.truncated).toBe(true);
      const sentKwargs = celery.sendTask.mock.calls[0]![1] as {
        kwargs: { question_ids: string[] };
      };
      expect(sentKwargs.kwargs.question_ids).toHaveLength(
        MAX_QUESTIONS_PER_DISPATCH,
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            truncated: true,
            questionCount: MAX_QUESTIONS_PER_DISPATCH,
          }),
        }),
      );
    });

    it('refuses to dispatch when no filters are given', async () => {
      await expect(
        controller.dispatch({}, ADMIN_USER, '127.0.0.1'),
      ).rejects.toThrow(BadRequestException);
      expect(celery.sendTask).not.toHaveBeenCalled();
      expect(auditService.log).not.toHaveBeenCalled();
    });

    it('errors when filters resolve to zero questions', async () => {
      prisma.barExamQuestion.findMany.mockResolvedValue([]);
      await expect(
        controller.dispatch({ year: 1999 }, ADMIN_USER, '127.0.0.1'),
      ).rejects.toThrow(BadRequestException);
      expect(celery.sendTask).not.toHaveBeenCalled();
    });
  });
});
