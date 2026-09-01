import {
  ExecutionContext,
  ForbiddenException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import type { JwtPayload } from '@libertasian/types';

import type { Request } from 'express';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MfaGuard } from '../../common/guards/mfa.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { AdminBypassAuditService } from '../../common/services/admin-bypass-audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EntitlementService } from '../subscriptions/entitlement.service';
import { UsageQuotaService } from '../subscriptions/usage-quota.service';
import { BarExamAnswersPublicController } from './bar-exam-answers.public.controller';

const passingGuard: { canActivate: (ctx: ExecutionContext) => boolean } = {
  canActivate: jest.fn().mockReturnValue(true),
};

const USER: JwtPayload = {
  sub: '00000000-0000-0000-0000-0000000000aa',
  email: 'user@libertasian.com',
  organizationId: '00000000-0000-0000-0000-0000000000bb',
} as JwtPayload;

/** Same caller, but with any `admin:*` permission resolved by JwtStrategy. */
const ADMIN: JwtPayload = { ...USER, isPlatformAdmin: true } as JwtPayload;

const REQ = {
  method: 'GET',
  path: '/bar-exams/questions/x/answer',
} as unknown as Request;

const QUESTION_ID = '22222222-2222-2222-2222-222222222222';
const ANSWER_ID = '33333333-3333-3333-3333-333333333333';
const SITTING_ID = '44444444-4444-4444-4444-444444444444';

function fakeApprovedRow() {
  return {
    id: ANSWER_ID,
    answerText: '**Answer.** Yes.\n',
    structuredAnswerJson: {
      answer: 'Yes.',
      law: 'NCC art 1.',
      analysis: 'It applies.',
      conclusion: 'Yes, it applies.',
    },
    reviewedAt: new Date('2026-05-14T10:00:00Z'),
    modelRun: {
      modelName: 'gpt-4o-mini',
      promptTemplateVersion: 'bar_exam_alac.v1',
    },
    question: {
      id: QUESTION_ID,
      questionNumber: 1,
      barExamSittingId: SITTING_ID,
    },
  };
}

function allowedQuota() {
  return { allowed: true, used: 1, limit: 15, remaining: 14, resetsAt: '2026-05-15T00:00:00Z' };
}

describe('BarExamAnswersPublicController', () => {
  let controller: BarExamAnswersPublicController;
  let prisma: { barExamAnswer: { findFirst: jest.Mock } };
  let usageQuota: { checkAndIncrement: jest.Mock };
  let config: { get: jest.Mock };
  let resolveEffectiveEntitlements: jest.Mock;
  let recordBypass: jest.Mock;

  async function build(flag: 'true' | 'false' | undefined) {
    prisma = { barExamAnswer: { findFirst: jest.fn() } };
    usageQuota = { checkAndIncrement: jest.fn().mockResolvedValue(allowedQuota()) };
    config = { get: jest.fn().mockImplementation((key: string) => (key === 'FEATURE_BAR_EXAM_ANSWERS_PUBLIC' ? flag : undefined)) };
    // Default: an entitled org, so every pre-existing assertion below
    // exercises the same path it always did.
    resolveEffectiveEntitlements = jest.fn().mockResolvedValue({ previewOnly: false });
    recordBypass = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BarExamAnswersPublicController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: UsageQuotaService, useValue: usageQuota },
        { provide: ConfigService, useValue: config },
        {
          provide: EntitlementService,
          useValue: { resolveEffectiveEntitlements },
        },
        { provide: AdminBypassAuditService, useValue: { record: recordBypass } },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(passingGuard)
      .overrideGuard(MfaGuard)
      .useValue(passingGuard)
      .overrideGuard(TenantGuard)
      .useValue(passingGuard)
      .compile();

    controller = module.get<BarExamAnswersPublicController>(BarExamAnswersPublicController);
  }

  describe('feature flag', () => {
    it('returns 404 when flag is off (undefined)', async () => {
      await build(undefined);

      await expect(controller.get(QUESTION_ID, USER, REQ, 'ios')).rejects.toBeInstanceOf(NotFoundException);
      // Quota MUST NOT be consumed when the flag is off — otherwise dark
      // launches would silently bill users for a feature they can't use.
      expect(usageQuota.checkAndIncrement).not.toHaveBeenCalled();
      expect(prisma.barExamAnswer.findFirst).not.toHaveBeenCalled();
    });

    it('returns 404 when flag is explicitly "false"', async () => {
      await build('false');
      await expect(controller.get(QUESTION_ID, USER, REQ, 'ios')).rejects.toBeInstanceOf(NotFoundException);
      expect(usageQuota.checkAndIncrement).not.toHaveBeenCalled();
    });
  });

  describe('not-found behavior (flag on)', () => {
    it('returns 404 with code "answer_not_available" when no approved row exists', async () => {
      await build('true');
      prisma.barExamAnswer.findFirst.mockResolvedValue(null);

      await expect(controller.get(QUESTION_ID, USER, REQ, 'ios')).rejects.toMatchObject({
        response: { code: 'answer_not_available' },
        status: HttpStatus.NOT_FOUND,
      });
      // Quota IS consumed even when the row is missing — the retrieval
      // attempt happened, so the user pays for it.
      expect(usageQuota.checkAndIncrement).toHaveBeenCalledWith(
        USER.organizationId,
        USER.sub,
        'aiAnswers',
        { isPlatformAdmin: false },
      );
    });

    it('returns 404 when the row is approved but visibility is still private', async () => {
      await build('true');
      // findFirst uses BOTH reviewStatus AND visibility in the WHERE clause,
      // so a private-but-approved row never matches and findFirst returns null.
      prisma.barExamAnswer.findFirst.mockResolvedValue(null);

      await expect(controller.get(QUESTION_ID, USER, REQ, 'ios')).rejects.toBeInstanceOf(NotFoundException);

      const where = prisma.barExamAnswer.findFirst.mock.calls[0][0].where;
      expect(where).toEqual({
        barExamQuestionId: QUESTION_ID,
        reviewStatus: 'approved',
        visibility: 'public_editorial',
      });
    });
  });

  describe('quota gate', () => {
    it('returns 402 with code "subscription_required" when limit=0 (no plan)', async () => {
      await build('true');
      usageQuota.checkAndIncrement.mockResolvedValue({
        allowed: false,
        used: 0,
        limit: 0,
        remaining: 0,
        resetsAt: '',
      });

      await expect(controller.get(QUESTION_ID, USER, REQ, 'ios')).rejects.toMatchObject({
        status: HttpStatus.PAYMENT_REQUIRED,
        response: { code: 'subscription_required' },
      });
      expect(prisma.barExamAnswer.findFirst).not.toHaveBeenCalled();
    });

    it('returns 429 with code "quota_exceeded" + resetsAt when daily cap hit', async () => {
      await build('true');
      usageQuota.checkAndIncrement.mockResolvedValue({
        allowed: false,
        used: 15,
        limit: 15,
        remaining: 0,
        resetsAt: '2026-05-15T00:00:00Z',
      });

      await expect(controller.get(QUESTION_ID, USER, REQ, 'ios')).rejects.toMatchObject({
        status: HttpStatus.TOO_MANY_REQUESTS,
        response: {
          code: 'quota_exceeded',
          used: 15,
          limit: 15,
          resetsAt: '2026-05-15T00:00:00Z',
        },
      });
      expect(prisma.barExamAnswer.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('happy path', () => {
    it('returns 200 with the approved row shape when quota allowed and row exists', async () => {
      await build('true');
      prisma.barExamAnswer.findFirst.mockResolvedValue(fakeApprovedRow());

      const result = await controller.get(QUESTION_ID, USER, REQ, 'ios');

      expect(result).toEqual({
        success: true,
        data: {
          id: ANSWER_ID,
          answerText: '**Answer.** Yes.\n',
          structuredAnswerJson: {
            answer: 'Yes.',
            law: 'NCC art 1.',
            analysis: 'It applies.',
            conclusion: 'Yes, it applies.',
          },
          modelRun: {
            modelName: 'gpt-4o-mini',
            promptTemplateVersion: 'bar_exam_alac.v1',
          },
          reviewedAt: new Date('2026-05-14T10:00:00Z'),
          question: {
            id: QUESTION_ID,
            questionNumber: 1,
            sittingId: SITTING_ID,
          },
        },
      });
      expect(usageQuota.checkAndIncrement).toHaveBeenCalledWith(
        USER.organizationId,
        USER.sub,
        'aiAnswers',
        { isPlatformAdmin: false },
      );
    });
  });
  /**
   * The model answer is the same PAID surface as the sittings, and this
   * controller had no entitlement check at all. Verified on prod as a free,
   * non-admin caller (`previewOnly: true`, `x-platform: ios`): 200 with the
   * complete `answerText`.
   */
  describe('entitlement gate', () => {
    it('serves the answer to an entitled caller', async () => {
      await build('true');
      prisma.barExamAnswer.findFirst.mockResolvedValue(fakeApprovedRow());

      const result = await controller.get(QUESTION_ID, USER, REQ, 'ios');

      expect(result.data.answerText).toBe(fakeApprovedRow().answerText);
      expect(resolveEffectiveEntitlements).toHaveBeenCalledWith(
        USER.organizationId,
        'ios',
      );
    });

    it('refuses a previewOnly caller with 403, NOT 402', async () => {
      // 402 `subscription_required` is the status App Review reads as a
      // paywall. Note this endpoint DOES answer 402 further down, for an
      // exhausted `aiAnswers` entitlement — that is a different question from
      // "may this account read the paid surface at all", and this refusal must
      // not borrow its status.
      await build('true');
      resolveEffectiveEntitlements.mockResolvedValue({ previewOnly: true });

      await expect(
        controller.get(QUESTION_ID, USER, REQ, 'ios'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        controller.get(QUESTION_ID, USER, REQ, 'ios'),
      ).rejects.toMatchObject({
        status: HttpStatus.FORBIDDEN,
        response: { code: 'not_available_on_this_account' },
      });
    });

    it('refuses before consuming quota or reading the answer', async () => {
      // `checkAndIncrement` bills the retrieval ATTEMPT, so an unentitled
      // caller must never reach it.
      await build('true');
      resolveEffectiveEntitlements.mockResolvedValue({ previewOnly: true });

      await expect(
        controller.get(QUESTION_ID, USER, REQ, 'ios'),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(usageQuota.checkAndIncrement).not.toHaveBeenCalled();
      expect(prisma.barExamAnswer.findFirst).not.toHaveBeenCalled();
    });

    it('still 404s when the flag is off, whatever the entitlement', async () => {
      // The flag check stays FIRST: a 403 to a free caller and a 404 to a
      // paying one would tell the free caller the endpoint exists.
      await build(undefined);
      resolveEffectiveEntitlements.mockResolvedValue({ previewOnly: true });

      await expect(
        controller.get(QUESTION_ID, USER, REQ, 'ios'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(resolveEffectiveEntitlements).not.toHaveBeenCalled();
    });

    it('serves a platform admin on a free org, and audits the bypass', async () => {
      await build('true');
      resolveEffectiveEntitlements.mockResolvedValue({ previewOnly: true });
      prisma.barExamAnswer.findFirst.mockResolvedValue(fakeApprovedRow());

      const result = await controller.get(QUESTION_ID, ADMIN, REQ, 'ios');

      expect(result.data.answerText).toBe(fakeApprovedRow().answerText);
      // Short-circuits: the org's entitlements are never consulted.
      expect(resolveEffectiveEntitlements).not.toHaveBeenCalled();
      expect(recordBypass).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: ADMIN.sub,
          organizationId: ADMIN.organizationId,
        }),
      );
    });

    it('stays unenforced with no x-platform header (web, and builds before 26)', async () => {
      // `parseClientPlatform(undefined)` is null, and a null platform cannot
      // buy, so `resolveEffectiveEntitlements` answers unenforced — the same
      // rule as `isPaywallEnforcedForRequest`. Gating a shipped binary with no
      // purchase surface is what got build 23 rejected.
      await build('true');
      prisma.barExamAnswer.findFirst.mockResolvedValue(fakeApprovedRow());

      const result = await controller.get(QUESTION_ID, USER, REQ);

      expect(result.data.answerText).toBe(fakeApprovedRow().answerText);
      expect(resolveEffectiveEntitlements).toHaveBeenCalledWith(
        USER.organizationId,
        null,
      );
    });
  });
});
