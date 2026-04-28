import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  ParseUUIDPipe,
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
  AdminBarExamsService,
  BackfillPlan,
  DispatchResult,
  DispatchedTask,
} from './admin-bar-exams.service';
import { IngestBarExamDto } from './dto';

type DispatchResponse =
  | { mode: 'single_sitting' | 'single_year' | 'backfill_all'; task: DispatchedTask }
  | { mode: 'sittings_list'; result: DispatchResult };

@ApiTags('Admin — Bar Exams')
@Controller('admin/bar-exams')
@UseGuards(JwtAuthGuard, MfaGuard, TenantGuard, PermissionsGuard)
@RequiredPermissions('admin:settings')
@ApiBearerAuth()
@Throttle({ default: { ttl: 60_000, limit: 60 } })
export class AdminBarExamsController {
  constructor(
    private readonly service: AdminBarExamsService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List every recorded bar exam sitting with parse status.',
  })
  async list() {
    const data = await this.service.listSittingsForAdmin();
    return { success: true, data };
  }

  @Get('backfill/plan')
  @ApiOperation({
    summary:
      'Preview the LawPhil backfill plan: which sittings would be ' +
      'fetched, which are already ingested, time-cost estimate. ' +
      'Read-only; cached 60s.',
  })
  async getBackfillPlan(): Promise<{ success: true; data: BackfillPlan }> {
    const data = await this.service.getBackfillPlan();
    return { success: true, data };
  }

  @Post('ingest')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiOperation({
    summary:
      'Dispatch bar exam ingest tasks. Accepts three shapes: single ' +
      'sitting/year ({year, subjectSlug?}), explicit list ({sittings: ' +
      '[...]}), or full archive ({backfillAll: true}).',
  })
  async dispatchIngest(
    @Body() dto: IngestBarExamDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ): Promise<{ success: true; data: DispatchResponse }> {
    const shape = pickShape(dto);

    if (shape === 'sittings_list') {
      const result = await this.service.dispatchSittingList(dto.sittings!);
      await this.auditService.log({
        organizationId: user.organizationId,
        actorUserId: user.sub,
        actorType: 'admin',
        action: 'admin_dispatched_bar_exam_ingest',
        entityType: 'celery_task_batch',
        metadata: {
          ip,
          mode: 'sittings_list',
          requested: dto.sittings!.length,
          dispatched: result.totalDispatched,
          skipped: result.totalSkipped,
          taskIds: result.dispatched.map((d) => d.taskId),
        },
      });
      return { success: true, data: { mode: 'sittings_list', result } };
    }

    if (shape === 'backfill_all') {
      const task = await this.service.dispatchBackfillAll();
      await this.auditService.log({
        organizationId: user.organizationId,
        actorUserId: user.sub,
        actorType: 'admin',
        action: 'admin_dispatched_bar_exam_ingest',
        entityType: 'celery_task',
        entityId: task.taskId,
        metadata: {
          ip,
          mode: 'backfill_all',
          taskName: task.taskName,
        },
      });
      return { success: true, data: { mode: 'backfill_all', task } };
    }

    if (shape === 'single_sitting') {
      const task = await this.service.dispatchSitting(
        dto.year!,
        dto.subjectSlug!,
      );
      await this.auditService.log({
        organizationId: user.organizationId,
        actorUserId: user.sub,
        actorType: 'admin',
        action: 'admin_dispatched_bar_exam_ingest',
        entityType: 'celery_task',
        entityId: task.taskId,
        metadata: {
          ip,
          mode: 'single_sitting',
          taskName: task.taskName,
          year: dto.year ?? null,
          subjectSlug: dto.subjectSlug ?? null,
        },
      });
      return { success: true, data: { mode: 'single_sitting', task } };
    }

    // single_year backfill
    const task = await this.service.dispatchSingleYearBackfill(
      dto.year!,
      dto.limit,
    );
    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'admin_dispatched_bar_exam_ingest',
      entityType: 'celery_task',
      entityId: task.taskId,
      metadata: {
        ip,
        mode: 'single_year',
        taskName: task.taskName,
        year: dto.year ?? null,
        limit: dto.limit ?? null,
      },
    });
    return { success: true, data: { mode: 'single_year', task } };
  }

  @Post('reparse/:sittingId')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @ApiOperation({
    summary: 'Re-dispatch ingest_sitting for an existing sitting.',
  })
  async dispatchReparse(
    @Param('sittingId', ParseUUIDPipe) sittingId: string,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ): Promise<{ success: true; data: DispatchedTask }> {
    const data = await this.service.dispatchReparse(sittingId);

    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'admin_dispatched_bar_exam_reparse',
      entityType: 'bar_exam_sitting',
      entityId: sittingId,
      metadata: {
        ip,
        taskName: data.taskName,
        sittingId,
        kwargs: data.kwargs,
      },
    });

    return { success: true, data };
  }
}

type Shape =
  | 'single_sitting'
  | 'single_year'
  | 'sittings_list'
  | 'backfill_all';

function pickShape(dto: IngestBarExamDto): Shape {
  const hasSittings = !!dto.sittings && dto.sittings.length > 0;
  const hasBackfillAll = dto.backfillAll === true;
  const hasYear = dto.year !== undefined;
  const hasSubjectSlug = !!dto.subjectSlug;

  // backfillAll is only meaningful when set to true and nothing else
  // is set; the single-shape contract forbids combining it with the
  // year/sittings shapes.
  const flags = [hasSittings, hasBackfillAll, hasYear || hasSubjectSlug];
  const setCount = flags.filter(Boolean).length;
  if (setCount > 1) {
    throw new BadRequestException(
      'Provide exactly one of: {year, subjectSlug?}, {sittings}, ' +
        '{backfillAll: true}',
    );
  }

  if (hasSittings) return 'sittings_list';
  if (hasBackfillAll) return 'backfill_all';
  if (hasSubjectSlug && !hasYear) {
    throw new BadRequestException(
      '`year` is required when `subjectSlug` is provided',
    );
  }
  if (hasSubjectSlug && hasYear) return 'single_sitting';
  if (hasYear) return 'single_year';

  throw new BadRequestException(
    'Empty body — provide one of: {year, subjectSlug?}, ' +
      '{sittings}, {backfillAll: true}',
  );
}
