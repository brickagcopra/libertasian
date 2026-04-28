import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { JwtPayload } from '@libertasian/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequiredPermissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MfaGuard } from '../../common/guards/mfa.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { AuditService } from '../audit/audit.service';
import {
  AdminPipelineOpsService,
  AutoPromoteSweepResult,
  AutoPromoteStatus,
  BackfillCitationsResult,
  BackfillMissingDerivativesResult,
  CitationsBackfillPlan,
  DEFAULT_BACKFILL_LIMIT,
  MissingDerivativesPlan,
} from './admin-pipeline-ops.service';
import {
  BACKFILL_MISSING_DERIVATIVE_TYPES,
  BackfillCitationsDto,
  BackfillMissingDerivativeType,
  BackfillMissingDerivativesDto,
} from './dto';

@ApiTags('Admin — Pipeline Ops')
@Controller('admin')
@UseGuards(JwtAuthGuard, MfaGuard, TenantGuard, PermissionsGuard)
@RequiredPermissions('admin:settings')
@ApiBearerAuth()
@Throttle({ default: { ttl: 60_000, limit: 100 } })
export class AdminPipelineOpsController {
  constructor(
    private readonly service: AdminPipelineOpsService,
    private readonly auditService: AuditService,
  ) {}

  @Get('citations/backfill/plan')
  @ApiOperation({
    summary:
      'Preview the citations backfill plan: corpus totals, docs already ' +
      'extracted, pending count, time/citation estimates, last dispatch ' +
      'metadata. Read-only; cached 60s.',
  })
  async getCitationsBackfillPlan(): Promise<{
    success: true;
    data: CitationsBackfillPlan;
  }> {
    const data = await this.service.getCitationsBackfillPlan();
    return { success: true, data };
  }

  @Post('citations/backfill')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary:
      'Dispatch citations.backfill_corpus_documents Celery task. Fire-and-forget. ' +
      'Pass {dryRun:true} to receive the plan shape without dispatching.',
  })
  async dispatchCitationsBackfill(
    @Body() dto: BackfillCitationsDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ): Promise<
    | { success: true; data: BackfillCitationsResult }
    | { success: true; dryRun: true; data: CitationsBackfillPlan }
  > {
    if (dto.dryRun === true) {
      const plan = await this.service.getCitationsBackfillPlan();
      return { success: true, dryRun: true, data: plan };
    }

    const data = await this.service.dispatchCitationsBackfill(dto.limit);

    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'admin_dispatched_citation_backfill',
      entityType: 'celery_task',
      entityId: data.taskId,
      metadata: { ip, limit: dto.limit ?? null, taskId: data.taskId },
    });

    return { success: true, data };
  }

  @Get('derivatives/backfill-missing/plan')
  @ApiOperation({
    summary:
      'Preview the missing-derivatives plan: per-type missing counts, ' +
      'cost/time estimates, last dispatch metadata. Read-only; cached 60s.',
  })
  async getMissingDerivativesPlan(): Promise<{
    success: true;
    data: MissingDerivativesPlan;
  }> {
    const data = await this.service.getMissingDerivativesPlan();
    return { success: true, data };
  }

  @Post('derivatives/backfill-missing')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Enqueue derivative_generation_jobs for legal_documents missing artifacts. ' +
      'Accepts {types?, limit?} (uniform per-type limit), {perTypeLimits: ' +
      '[{type, limit?}]} (explicit per-type), or {dryRun:true} for the plan shape.',
  })
  async backfillMissingDerivatives(
    @Body() dto: BackfillMissingDerivativesDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ): Promise<
    | { success: true; data: BackfillMissingDerivativesResult }
    | { success: true; dryRun: true; data: MissingDerivativesPlan }
  > {
    if (dto.dryRun === true) {
      const plan = await this.service.getMissingDerivativesPlan();
      return { success: true, dryRun: true, data: plan };
    }

    const perTypeLimits = resolvePerTypeLimits(dto);

    const data = await this.service.backfillMissingDerivatives(
      perTypeLimits,
      user.sub,
    );

    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'admin_dispatched_missing_derivatives_backfill',
      entityType: 'derivative_generation_job',
      entityId: 'bulk',
      metadata: {
        ip,
        types: perTypeLimits.map((p) => p.type),
        perTypeLimits: perTypeLimits.map((p) => ({
          type: p.type,
          limit: p.limit,
        })),
        // Preserved for backwards-compat with existing audit consumers
        // that read `limit` — the max across the per-type entries.
        limit: maxLimit(perTypeLimits),
        dispatchedByType: data.dispatchedByType,
        totalDispatched: data.totalDispatched,
        totalSkipped: data.totalSkipped,
      },
    });

    return { success: true, data };
  }

  @Post('auto-promote/sweep')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Manually trigger AutoPromoteService.sweepBacklog() and return its tally.',
  })
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async triggerAutoPromoteSweep(
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ): Promise<{ success: true; data: AutoPromoteSweepResult }> {
    const data = await this.service.runAutoPromoteSweep();

    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'admin_triggered_auto_promote_sweep',
      entityType: 'derivative_artifact',
      entityId: 'bulk',
      metadata: { ip, promoted: data.promoted, scanned: data.scanned },
    });

    return { success: true, data };
  }

  @Get('auto-promote/status')
  @ApiOperation({
    summary:
      'Snapshot of auto-promote sweep activity and currently-effective config.',
  })
  async getAutoPromoteStatus(): Promise<{
    success: true;
    data: AutoPromoteStatus;
  }> {
    const data = await this.service.getAutoPromoteStatus();
    return { success: true, data };
  }
}

/**
 * Normalize the three accepted POST shapes into a single ordered list of
 * per-type limits. Throws if both shapes are mixed in one body.
 */
function resolvePerTypeLimits(
  dto: BackfillMissingDerivativesDto,
): Array<{ type: BackfillMissingDerivativeType; limit: number }> {
  const hasPerType = !!dto.perTypeLimits && dto.perTypeLimits.length > 0;
  const hasUniform = !!dto.types || dto.limit !== undefined;

  if (hasPerType && hasUniform) {
    throw new BadRequestException(
      'Provide either {types, limit} or {perTypeLimits} — not both.',
    );
  }

  if (hasPerType) {
    const seen = new Set<BackfillMissingDerivativeType>();
    return dto.perTypeLimits!.map((entry) => {
      if (seen.has(entry.type)) {
        throw new BadRequestException(
          `Duplicate type '${entry.type}' in perTypeLimits.`,
        );
      }
      seen.add(entry.type);
      return {
        type: entry.type,
        limit: entry.limit ?? DEFAULT_BACKFILL_LIMIT,
      };
    });
  }

  const types = dto.types ?? [...BACKFILL_MISSING_DERIVATIVE_TYPES];
  const limit = dto.limit ?? DEFAULT_BACKFILL_LIMIT;
  return types.map((type) => ({ type, limit }));
}

function maxLimit(
  entries: ReadonlyArray<{ limit: number }>,
): number | null {
  if (entries.length === 0) return null;
  return entries.reduce((m, e) => Math.max(m, e.limit), 0);
}
