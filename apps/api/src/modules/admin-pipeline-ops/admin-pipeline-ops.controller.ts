import {
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
} from './admin-pipeline-ops.service';
import {
  BACKFILL_MISSING_DERIVATIVE_TYPES,
  BackfillCitationsDto,
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

  @Post('citations/backfill')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary:
      'Dispatch citations.backfill_corpus_documents Celery task. Fire-and-forget.',
  })
  async dispatchCitationsBackfill(
    @Body() dto: BackfillCitationsDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ): Promise<{ success: true; data: BackfillCitationsResult }> {
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

  @Post('derivatives/backfill-missing')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Enqueue derivative_generation_jobs for legal_documents missing artifacts of the requested types.',
  })
  async backfillMissingDerivatives(
    @Body() dto: BackfillMissingDerivativesDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ): Promise<{ success: true; data: BackfillMissingDerivativesResult }> {
    const types = dto.types ?? [...BACKFILL_MISSING_DERIVATIVE_TYPES];
    const limit = dto.limit ?? 200;

    const data = await this.service.backfillMissingDerivatives(
      types,
      limit,
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
        types,
        limit,
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
