import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { JwtPayload } from '@libertasian/types';
import type { Request } from 'express';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequiredPermissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MfaGuard } from '../../common/guards/mfa.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditService } from '../audit/audit.service';
import { LifecycleEventAdminService } from './lifecycle-event-admin.service';
import { ListLifecycleEventsQueryDto, BulkRetryLifecycleEventsDto } from './dto';

@ApiTags('Admin — Subscription Lifecycle Events')
@Controller('admin/subscription-lifecycle-events')
@UseGuards(JwtAuthGuard, MfaGuard, TenantGuard, PermissionsGuard)
@ApiBearerAuth()
@Throttle({ default: { ttl: 60000, limit: 100 } })
export class LifecycleEventAdminController {
  constructor(
    private readonly adminService: LifecycleEventAdminService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List lifecycle events with filters and cursor pagination' })
  @RequiredPermissions('admin:billing')
  async listEvents(@Query() query: ListLifecycleEventsQueryDto) {
    const result = await this.adminService.listEvents({
      status: query.status,
      eventType: query.eventType,
      subscriptionId: query.subscriptionId,
      limit: query.limit,
      cursor: query.cursor,
    });
    return {
      success: true,
      data: result.data,
      nextCursor: result.nextCursor,
      hasNext: result.hasNext,
    };
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get lifecycle event summary counts by status and event type' })
  @RequiredPermissions('admin:billing')
  async getStats() {
    const stats = await this.adminService.getStats();
    return { success: true, data: stats };
  }

  @Post(':id/retry')
  @ApiOperation({ summary: 'Retry a failed or cancelled lifecycle event' })
  @RequiredPermissions('admin:billing')
  async retryEvent(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const result = await this.adminService.retryEvent(id);

    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'lifecycle_event.admin_retry',
      entityType: 'subscription_lifecycle_event',
      entityId: id,
      metadata: { ip: req.ip },
    });

    return { success: true, data: result };
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel a pending lifecycle event' })
  @RequiredPermissions('admin:billing')
  async cancelEvent(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const result = await this.adminService.cancelEvent(id);

    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'lifecycle_event.admin_cancel',
      entityType: 'subscription_lifecycle_event',
      entityId: id,
      metadata: { ip: req.ip },
    });

    return { success: true, data: result };
  }

  @Post('bulk-retry')
  @ApiOperation({ summary: 'Bulk retry all failed lifecycle events' })
  @RequiredPermissions('admin:billing')
  async bulkRetry(
    @Body() dto: BulkRetryLifecycleEventsDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const result = await this.adminService.bulkRetry(dto.eventType);

    await this.auditService.log({
      organizationId: user.organizationId,
      actorUserId: user.sub,
      actorType: 'admin',
      action: 'lifecycle_event.admin_bulk_retry',
      entityType: 'subscription_lifecycle_event',
      entityId: 'bulk',
      metadata: { eventType: dto.eventType ?? 'all', count: result.count, ip: req.ip },
    });

    return { success: true, data: result };
  }
}
