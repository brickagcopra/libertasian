import {
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
import { AdminBarExamsService, DispatchedTask } from './admin-bar-exams.service';
import { IngestBarExamDto } from './dto';

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

  @Post('ingest')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiOperation({
    summary:
      'Dispatch bar_exam.ingest_sitting (single sitting) OR ' +
      'bar_exam.backfill_lawphil_archive (year window or full archive).',
  })
  async dispatchIngest(
    @Body() dto: IngestBarExamDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
  ): Promise<{ success: true; data: DispatchedTask }> {
    const data = await this.service.dispatchIngest({
      year: dto.year,
      subjectSlug: dto.subjectSlug,
      limit: dto.limit,
    });

    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'admin_dispatched_bar_exam_ingest',
      entityType: 'celery_task',
      entityId: data.taskId,
      metadata: {
        ip,
        taskName: data.taskName,
        year: dto.year ?? null,
        subjectSlug: dto.subjectSlug ?? null,
        limit: dto.limit ?? null,
      },
    });

    return { success: true, data };
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
