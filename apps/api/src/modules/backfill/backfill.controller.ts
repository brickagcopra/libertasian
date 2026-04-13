import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { JwtPayload } from '@libertasian/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequiredPermissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditService } from '../audit/audit.service';
import { BackfillService } from './backfill.service';
import {
  CreateBackfillBatchDto,
  ListBackfillBatchesDto,
  HaltBackfillDto,
  KillInflightDto,
  ExtendBudgetDto,
} from './dto';

@Controller('admin/backfill/batches')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequiredPermissions('admin:settings')
export class BackfillController {
  constructor(
    private readonly backfillService: BackfillService,
    private readonly auditService: AuditService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createBatch(
    @Body() dto: CreateBackfillBatchDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const batch = await this.backfillService.create(dto, user.sub);

    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'backfill.create',
      entityType: 'backfill_batch',
      entityId: batch.id,
      metadata: {
        name: batch.name,
        sourceId: batch.sourceId,
        yearRange: `${batch.yearStart}-${batch.yearEnd}`,
        startImmediately: dto.startImmediately ?? false,
      },
    });

    return { success: true, data: batch };
  }

  @Get()
  async findAll(@Query() dto: ListBackfillBatchesDto) {
    const result = await this.backfillService.findAll(dto);
    return { success: true, data: result.data, meta: { total: result.total } };
  }

  @Get(':id')
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    const batch = await this.backfillService.findOne(id);
    return { success: true, data: batch };
  }

  @Post(':id/start')
  @HttpCode(HttpStatus.OK)
  async start(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const batch = await this.backfillService.start(id);

    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'backfill.start',
      entityType: 'backfill_batch',
      entityId: batch.id,
    });

    return { success: true, data: batch };
  }

  @Post(':id/pause')
  @HttpCode(HttpStatus.OK)
  async pause(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const batch = await this.backfillService.pause(id);

    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'backfill.pause',
      entityType: 'backfill_batch',
      entityId: batch.id,
    });

    return { success: true, data: batch };
  }

  @Post(':id/resume')
  @HttpCode(HttpStatus.OK)
  async resume(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const batch = await this.backfillService.resume(id);

    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'backfill.resume',
      entityType: 'backfill_batch',
      entityId: batch.id,
    });

    return { success: true, data: batch };
  }

  @Post(':id/halt')
  @HttpCode(HttpStatus.OK)
  async halt(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: HaltBackfillDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const batch = await this.backfillService.halt(id, dto);

    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'backfill.halt',
      entityType: 'backfill_batch',
      entityId: batch.id,
      metadata: { reason: dto.reason },
    });

    return { success: true, data: batch };
  }

  @Post(':id/kill-inflight')
  @HttpCode(HttpStatus.OK)
  async killInflight(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: KillInflightDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const batch = await this.backfillService.killInflight(id, dto);

    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'backfill.kill_inflight',
      entityType: 'backfill_batch',
      entityId: batch.id,
      metadata: { reason: dto.reason },
    });

    return { success: true, data: batch };
  }

  @Patch(':id/budget')
  async extendBudget(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ExtendBudgetDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const batch = await this.backfillService.extendBudget(id, dto);

    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'backfill.extend_budget',
      entityType: 'backfill_batch',
      entityId: batch.id,
      metadata: {
        newCeilingUsd: dto.newCeilingUsd,
        reason: dto.reason,
      },
    });

    return { success: true, data: batch };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.backfillService.remove(id);

    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'user',
      action: 'backfill.delete',
      entityType: 'backfill_batch',
      entityId: id,
    });

    return { success: true };
  }
}
