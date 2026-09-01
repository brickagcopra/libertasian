import {
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { JwtPayload } from '@libertasian/types';

import type { Request } from 'express';

import { CLIENT_PLATFORM_HEADER } from '../../common/config/store-availability';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MfaGuard } from '../../common/guards/mfa.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { AdminBypassAuditService } from '../../common/services/admin-bypass-audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EntitlementService } from '../subscriptions/entitlement.service';
import { UsageQuotaService } from '../subscriptions/usage-quota.service';
import { assertBarExamEntitlement } from './bar-exam-entitlement';

/**
 * Public read surface for approved bar exam ALAC answers (Phase 3b).
 *
 * Gated by FEATURE_BAR_EXAM_ANSWERS_PUBLIC. When the flag is off (default),
 * every request returns 404 — the endpoint is invisible to clients.
 *
 * Quota model: the `aiAnswers` entitlement is consumed by every *retrieval
 * attempt*, not by render. A closed accordion on the web side never costs
 * the user; opening an accordion that 404s on "answer_not_available" still
 * costs 1 because the request was made. This keeps the cost model simple
 * (one request → one consumption) and prevents probing for which questions
 * have approved answers without paying for it.
 *
 * Visibility: only rows that are BOTH `reviewStatus='approved'` AND
 * `visibility='public_editorial'` are returned. Private, pending, or
 * rejected rows all 404 — there is no other shape this endpoint can return.
 *
 * Entitlement: the model answer is the same PAID surface as the sittings
 * `BarExamsController` serves, and this controller had no entitlement check at
 * all — verified on prod as a free, non-admin caller (`previewOnly: true`,
 * `x-platform: ios`), which got a 200 with the complete `answerText`. It now
 * shares that controller's gate; see `bar-exam-entitlement.ts`.
 */
@ApiTags('Bar Exams — Public Answers')
@ApiBearerAuth()
@Controller('bar-exams/questions/:questionId/answer')
@UseGuards(JwtAuthGuard, MfaGuard, TenantGuard)
export class BarExamAnswersPublicController {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly usageQuota: UsageQuotaService,
    private readonly entitlementService: EntitlementService,
    private readonly adminBypassAudit: AdminBypassAuditService,
  ) {}

  @Get()
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @ApiOperation({
    summary:
      'Fetch the approved AI ALAC answer for a bar exam question. ' +
      'Quota-checked against the `aiAnswers` entitlement; 404 when the ' +
      'feature flag is off or no approved+public_editorial row exists.',
  })
  async get(
    @Param('questionId', ParseUUIDPipe) questionId: string,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
    @Headers(CLIENT_PLATFORM_HEADER) platformHeader?: string,
  ) {
    const flag = this.config.get<string>('FEATURE_BAR_EXAM_ANSWERS_PUBLIC');
    if (flag !== 'true') {
      throw new NotFoundException({ code: 'feature_disabled' });
    }

    // Order: flag, THEN entitlement, THEN quota.
    //
    // The flag stays first because its whole job is to make the endpoint
    // invisible while off — gating entitlement ahead of it would answer 403 to
    // a free caller and 404 to a paying one, which tells the free caller the
    // endpoint exists.
    //
    // Entitlement goes ahead of `checkAndIncrement` because that call CONSUMES
    // the `aiAnswers` quota on the retrieval attempt. Charging an account for
    // a read it is not entitled to make would be the same mistake the flag
    // check above already avoids.
    await assertBarExamEntitlement({
      entitlementService: this.entitlementService,
      adminBypassAudit: this.adminBypassAudit,
      user,
      req,
      platformHeader,
    });

    const quota = await this.usageQuota.checkAndIncrement(
      user.organizationId,
      user.sub,
      'aiAnswers',
      { isPlatformAdmin: user.isPlatformAdmin === true },
    );
    if (!quota.allowed) {
      // limit=0 means there is no aiAnswers entitlement at all — distinct
      // from "used it all up today", so the client can tell the two apart
      // via the machine-readable `code`. The user-visible string names no
      // tier and no purchase action (App Review 3.1.1). While
      // PAYWALL_ENFORCED=false this branch is unreachable: every org
      // resolves to a finite aiAnswers > 0, so exhaustion lands on the 429
      // below instead.
      if (quota.limit === 0) {
        throw new HttpException(
          {
            code: 'subscription_required',
            message: "This isn't available on this account.",
          },
          HttpStatus.PAYMENT_REQUIRED,
        );
      }
      // limit>0 but used >= limit → daily/cycle cap hit. 429 + resetsAt so
      // the client can render a countdown.
      throw new HttpException(
        {
          code: 'quota_exceeded',
          message: 'AI answer quota exceeded for this period.',
          used: quota.used,
          limit: quota.limit,
          resetsAt: quota.resetsAt,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const row = await this.prisma.barExamAnswer.findFirst({
      where: {
        barExamQuestionId: questionId,
        reviewStatus: 'approved',
        visibility: 'public_editorial',
      },
      include: {
        modelRun: {
          select: { modelName: true, promptTemplateVersion: true },
        },
        question: {
          select: { id: true, questionNumber: true, barExamSittingId: true },
        },
      },
    });

    if (!row) {
      throw new NotFoundException({ code: 'answer_not_available' });
    }

    return {
      success: true,
      data: {
        id: row.id,
        answerText: row.answerText,
        structuredAnswerJson: row.structuredAnswerJson,
        modelRun: row.modelRun
          ? {
              modelName: row.modelRun.modelName,
              promptTemplateVersion: row.modelRun.promptTemplateVersion,
            }
          : null,
        reviewedAt: row.reviewedAt,
        question: {
          id: row.question.id,
          questionNumber: row.question.questionNumber,
          sittingId: row.question.barExamSittingId,
        },
      },
    };
  }
}
