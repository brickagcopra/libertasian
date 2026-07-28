import { Controller, Get, Header, Query, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Prisma } from '@prisma/client';
import type { Response } from 'express';

import {
  JwtAuthGuard,
  MfaGuard,
  TenantGuard,
  PermissionsGuard,
  SubscriptionGuard,
} from '../../common/guards';
import { RequiredPermissions } from '../../common/decorators/permissions.decorator';
import { RequiredSubscription } from '../../common/decorators/subscription.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { ListAllAuditLogsQueryDto } from './dto';

interface AuthUser {
  sub: string;
  organizationId: string;
}

/**
 * Audit log read/export endpoints.
 *
 * `auditLogs` is a team/enterprise entitlement (false on free/edu/pro in
 * plan-seed), so the whole controller carries `@RequiredSubscription('team')`.
 * SubscriptionGuard was already in the chain but inert without the decorator.
 * Platform admins bypass the tier gate by design (SubscriptionGuard).
 */
@ApiTags('Audit Logs')
@Controller('audit-logs')
@UseGuards(JwtAuthGuard, MfaGuard, TenantGuard, PermissionsGuard, SubscriptionGuard)
@RequiredSubscription('team')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequiredPermissions('audit-logs:read')
  @ApiOperation({ summary: 'List all organization audit logs (paginated, filtered)' })
  async listAuditLogs(
    @CurrentUser() user: AuthUser,
    @Query() query: ListAllAuditLogsQueryDto,
  ) {
    const limit = query.limit ?? 20;

    const where = this.buildWhereClause(user.organizationId, query);

    const logs = await this.prisma.auditLog.findMany({
      where,
      take: limit + 1,
      ...(query.cursor && { skip: 1, cursor: { id: query.cursor } }),
      orderBy: { createdAt: 'desc' },
      include: {
        actor: { select: { fullName: true, email: true } },
      },
    });

    const hasNext = logs.length > limit;
    const items = hasNext ? logs.slice(0, limit) : logs;
    const lastItem = items[items.length - 1];
    const nextCursor = hasNext && lastItem ? lastItem.id : undefined;

    return {
      success: true,
      data: items.map((log) => ({
        id: log.id,
        action: log.action,
        entityType: log.entityType,
        entityId: log.entityId,
        actorUserId: log.actorUserId,
        actorType: log.actorType,
        actorName: log.actor?.fullName ?? null,
        actorEmail: log.actor?.email ?? null,
        metadata: log.metadataJson,
        createdAt: log.createdAt.toISOString(),
      })),
      meta: { hasNext, nextCursor },
    };
  }

  @Get('export')
  @RequiredPermissions('audit-logs:read')
  @ApiOperation({ summary: 'Export audit logs as CSV' })
  @Header('Content-Type', 'text/csv')
  async exportCsv(
    @CurrentUser() user: AuthUser,
    @Query() query: ListAllAuditLogsQueryDto,
    @Res() res: Response,
  ) {
    const where = this.buildWhereClause(user.organizationId, query);

    // Stream up to 10,000 rows for export
    const logs = await this.prisma.auditLog.findMany({
      where,
      take: 10_000,
      orderBy: { createdAt: 'desc' },
      include: {
        actor: { select: { fullName: true, email: true } },
      },
    });

    const header = 'Date,Action,Entity Type,Entity ID,Actor Name,Actor Email,Actor Type,Metadata\n';
    const rows = logs.map((log) => {
      const date = log.createdAt.toISOString();
      const action = this.escapeCsv(log.action);
      const entityType = this.escapeCsv(log.entityType);
      const entityId = this.escapeCsv(log.entityId ?? '');
      const actorName = this.escapeCsv(log.actor?.fullName ?? '');
      const actorEmail = this.escapeCsv(log.actor?.email ?? '');
      const actorType = this.escapeCsv(log.actorType);
      const metadata = this.escapeCsv(JSON.stringify(log.metadataJson ?? {}));
      return `${date},${action},${entityType},${entityId},${actorName},${actorEmail},${actorType},${metadata}`;
    });

    const filename = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(header + rows.join('\n'));
  }

  @Get('entity-types')
  @RequiredPermissions('audit-logs:read')
  @ApiOperation({ summary: 'List distinct entity types in audit logs' })
  async listEntityTypes(@CurrentUser() user: AuthUser) {
    const types = await this.prisma.auditLog.findMany({
      where: { organizationId: user.organizationId },
      select: { entityType: true },
      distinct: ['entityType'],
      orderBy: { entityType: 'asc' },
    });

    return {
      success: true,
      data: types.map((t) => t.entityType),
    };
  }

  @Get('actions')
  @RequiredPermissions('audit-logs:read')
  @ApiOperation({ summary: 'List distinct actions in audit logs' })
  async listActions(@CurrentUser() user: AuthUser) {
    const actions = await this.prisma.auditLog.findMany({
      where: { organizationId: user.organizationId },
      select: { action: true },
      distinct: ['action'],
      orderBy: { action: 'asc' },
    });

    return {
      success: true,
      data: actions.map((a) => a.action),
    };
  }

  private buildWhereClause(
    organizationId: string,
    query: ListAllAuditLogsQueryDto,
  ): Prisma.AuditLogWhereInput {
    const where: Prisma.AuditLogWhereInput = { organizationId };

    if (query.action?.length) {
      where.action = { in: query.action };
    }
    if (query.entityType?.length) {
      where.entityType = { in: query.entityType };
    }
    if (query.actorUserId) {
      where.actorUserId = query.actorUserId;
    }
    if (query.dateFrom || query.dateTo) {
      const createdAt: Prisma.DateTimeFilter = {};
      if (query.dateFrom) createdAt.gte = new Date(query.dateFrom);
      if (query.dateTo) createdAt.lte = new Date(query.dateTo);
      where.createdAt = createdAt;
    }

    return where;
  }

  private escapeCsv(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
}
