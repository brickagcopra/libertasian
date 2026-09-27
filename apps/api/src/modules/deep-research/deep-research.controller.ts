import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Ip,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { JwtPayload } from '@libertasian/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequiredSubscription } from '../../common/decorators/subscription.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MfaGuard } from '../../common/guards/mfa.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { AuditService } from '../audit/audit.service';
import { UsageQuotaService } from '../subscriptions/usage-quota.service';
import { DEEP_RESEARCH_QUOTA, DeepResearchService } from './deep-research.service';
import { DeepResearchStreamDto, ListDeepResearchQueryDto } from './dto';

/** Client-visible refusal copy: names no tier, price or purchase action. */
const NOT_AVAILABLE_MESSAGE = "This isn't available on this account.";

/** Whole seconds from now until an ISO instant, at least 1. */
export function secondsUntil(iso: string, now = Date.now()): number {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return 3600;
  return Math.max(1, Math.ceil((at - now) / 1000));
}

/**
 * Deep Research — multi-query, verified legal research answers.
 *
 * Paid plans only, metered monthly (`deepResearchPerMonth`). The order of the
 * refusals on POST is load-bearing:
 *
 *   1. SubscriptionGuard: below 'edu' while the paywall is enforced → 402
 *      `subscription_required` (opt-in via `paymentRequired`). A free account
 *      stops HERE, before any quota counter is read — which is why the free
 *      plan's 0 is safe (see `getDefaultEntitlements('free')`).
 *   2. checkAndIncrement: exhausted → 429 `quota_exceeded` + Retry-After.
 *   3. Only then are SSE headers flushed; everything after is an SSE `error`.
 */
@ApiTags('Deep Research')
@Controller('deep-research')
@UseGuards(JwtAuthGuard, MfaGuard, TenantGuard, RolesGuard)
@ApiBearerAuth()
export class DeepResearchController {
  private readonly logger = new Logger(DeepResearchController.name);

  constructor(
    private readonly deepResearch: DeepResearchService,
    private readonly usageQuota: UsageQuotaService,
    private readonly auditService: AuditService,
  ) {}

  @Post('stream')
  // An SSE stream is 200, not the @Post default 201 — see ai-answers.controller.
  @HttpCode(200)
  @UseGuards(SubscriptionGuard)
  @RequiredSubscription('edu', { paymentRequired: true })
  // Abuse backstop on top of the monthly quota: a paid user cannot fire a
  // burst of the most expensive call we make.
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  @ApiOperation({ summary: 'Run Deep Research and stream progress + result via SSE' })
  async stream(
    @Body() dto: DeepResearchStreamDto,
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
    @Ip() ip: string,
  ): Promise<void> {
    const isPlatformAdmin = user.isPlatformAdmin === true;

    const quota = await this.usageQuota.checkAndIncrement(
      user.organizationId,
      user.sub,
      DEEP_RESEARCH_QUOTA,
      { isPlatformAdmin },
    );
    if (!quota.allowed) {
      if (quota.limit === 0) {
        // Only reachable for an org whose plan grants 0 but which passed the
        // tier gate (e.g. a stored override of 0). Same refusal as the guard.
        throw new HttpException(
          {
            success: false,
            error: 'subscription_required',
            code: 'subscription_required',
            message: NOT_AVAILABLE_MESSAGE,
          },
          HttpStatus.PAYMENT_REQUIRED,
        );
      }
      throw new HttpException(
        {
          success: false,
          error: 'quota_exceeded',
          code: 'quota_exceeded',
          message: 'Monthly Deep Research quota exceeded.',
          resetAt: quota.resetsAt,
          currentUsage: quota.used,
          limit: quota.limit,
          // HttpExceptionFilter turns this into the Retry-After header.
          retryAfter: secondsUntil(quota.resetsAt),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const startedAt = Date.now();
    let run: { id: string };
    try {
      run = await this.deepResearch.createRun(user.organizationId, user.sub, dto.question);
    } catch (err) {
      await this.usageQuota.refund(user.organizationId, user.sub, DEEP_RESEARCH_QUOTA, {
        isPlatformAdmin,
      });
      throw err;
    }

    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'deep_research.create',
      entityType: 'deep_research_run',
      entityId: run.id,
      // PII-safe: the question itself is never logged, only its length.
      metadata: {
        ip,
        questionLength: dto.question.length,
        modelOverride: dto.modelOverride ?? null,
      },
    });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // The client may leave mid-run. Stop WRITING, keep READING: the relay
    // runs to completion so the run is persisted (and refunded if needed).
    let clientGone = false;
    res.on('close', () => {
      clientGone = true;
    });
    const write = (frame: string) => {
      if (clientGone || res.writableEnded || res.destroyed) return;
      res.write(frame);
    };

    try {
      await this.deepResearch.relay({
        runId: run.id,
        organizationId: user.organizationId,
        userId: user.sub,
        isPlatformAdmin,
        dto,
        startedAt,
        write,
      });
    } catch (err) {
      // relay() does not throw by design; this is a last-resort guard.
      this.logger.error(`Deep research relay crashed: ${(err as Error).message}`);
      await this.deepResearch.markFailed(user.organizationId, run.id);
    } finally {
      if (!res.writableEnded) res.end();
    }
  }

  @Get()
  @ApiOperation({ summary: "List the caller's Deep Research runs (cursor pagination)" })
  async list(@Query() query: ListDeepResearchQueryDto, @CurrentUser() user: JwtPayload) {
    const result = await this.deepResearch.list(user.organizationId, user.sub, query);
    return { success: true, data: result.items, meta: result.meta };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one of the caller’s Deep Research runs' })
  async findById(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    const run = await this.deepResearch.findById(user.organizationId, user.sub, id);
    return { success: true, data: run };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete one of the caller’s Deep Research runs' })
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ) {
    await this.deepResearch.delete(user.organizationId, user.sub, id);
    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'deep_research.delete',
      entityType: 'deep_research_run',
      entityId: id,
      metadata: { ip },
    });
    return { success: true, data: { message: 'Deep research run deleted' } };
  }
}
