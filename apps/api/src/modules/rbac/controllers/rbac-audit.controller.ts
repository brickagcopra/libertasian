import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Prisma } from '@prisma/client';

import {
  JwtAuthGuard,
  MfaGuard,
  TenantGuard,
  PermissionsGuard,
  SubscriptionGuard,
} from '../../../common/guards';
import { RequiredPermissions } from '../../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { PrismaService } from '../../../prisma/prisma.service';
import { ListAuditLogsQueryDto } from '../dto';

interface AuthUser {
  sub: string;
  organizationId: string;
}

@ApiTags('RBAC — Audit Logs')
@Controller('rbac/audit-logs')
@UseGuards(JwtAuthGuard, MfaGuard, TenantGuard, PermissionsGuard, SubscriptionGuard)
export class RbacAuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequiredPermissions('audit-logs:read')
  @ApiOperation({ summary: 'List RBAC audit logs (paginated, filtered)' })
  async listAuditLogs(
    @CurrentUser() user: AuthUser,
    @Query() query: ListAuditLogsQueryDto,
  ) {
    const limit = query.limit ?? 20;

    const where: Prisma.AuditLogWhereInput = {
      organizationId: user.organizationId,
      entityType: { in: ['member_role', 'role_definition'] },
    };

    if (query.action?.length) {
      where.action = { in: query.action };
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
        actorName: log.actor?.fullName ?? null,
        metadata: log.metadataJson,
        createdAt: log.createdAt.toISOString(),
      })),
      meta: { hasNext, nextCursor },
    };
  }
}
