import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

// ---- Param Types ----

export interface ListLifecycleEventsParams {
  status?: string;
  eventType?: string;
  subscriptionId?: string;
  limit?: number;
  cursor?: string;
}

// ---- Service ----

@Injectable()
export class LifecycleEventAdminService {
  private readonly logger = new Logger(LifecycleEventAdminService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * List lifecycle events with optional filters and cursor pagination.
   */
  async listEvents(params: ListLifecycleEventsParams) {
    const limit = params.limit ?? 20;

    const where: Prisma.SubscriptionLifecycleEventWhereInput = {};
    if (params.status) where.status = params.status;
    if (params.eventType) where.eventType = params.eventType;
    if (params.subscriptionId) where.subscriptionId = params.subscriptionId;

    const items = await this.prisma.subscriptionLifecycleEvent.findMany({
      where,
      take: limit + 1,
      ...(params.cursor && { skip: 1, cursor: { id: params.cursor } }),
      orderBy: { scheduledAt: 'desc' },
      include: {
        subscription: {
          select: {
            id: true,
            planCode: true,
            status: true,
            organization: { select: { id: true, name: true } },
          },
        },
      },
    });

    const hasNext = items.length > limit;
    const data = hasNext ? items.slice(0, limit) : items;
    const lastItem = data[data.length - 1];
    const nextCursor = hasNext && lastItem ? lastItem.id : null;

    return { data, nextCursor, hasNext };
  }

  /**
   * Summary counts grouped by status and event type.
   */
  async getStats() {
    const [byStatus, byEventType, pendingDueCount] = await Promise.all([
      this.prisma.subscriptionLifecycleEvent.groupBy({
        by: ['status'],
        _count: { id: true },
      }),
      this.prisma.subscriptionLifecycleEvent.groupBy({
        by: ['eventType'],
        where: { status: { in: ['pending', 'processing', 'failed'] } },
        _count: { id: true },
      }),
      this.prisma.subscriptionLifecycleEvent.count({
        where: {
          status: 'pending',
          scheduledAt: { lte: new Date() },
        },
      }),
    ]);

    const statusCounts: Record<string, number> = {};
    for (const row of byStatus) {
      statusCounts[row.status] = row._count.id;
    }

    const eventTypeCounts: Record<string, number> = {};
    for (const row of byEventType) {
      eventTypeCounts[row.eventType] = row._count.id;
    }

    return {
      statusCounts,
      eventTypeCounts,
      pendingDueCount,
    };
  }

  /**
   * Retry a single failed or cancelled event by resetting it to pending.
   */
  async retryEvent(eventId: string) {
    const event = await this.prisma.subscriptionLifecycleEvent.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      throw new NotFoundException(`Lifecycle event ${eventId} not found`);
    }

    if (!['failed', 'cancelled'].includes(event.status)) {
      throw new BadRequestException(
        `Cannot retry event in status "${event.status}". Only failed or cancelled events can be retried.`,
      );
    }

    const updated = await this.prisma.subscriptionLifecycleEvent.update({
      where: { id: eventId },
      data: {
        status: 'pending',
        attempts: 0,
        lastError: null,
        processedAt: null,
      },
    });

    this.logger.log(`Lifecycle event ${eventId} reset to pending for retry by admin`);
    return updated;
  }

  /**
   * Cancel a pending event.
   */
  async cancelEvent(eventId: string) {
    const event = await this.prisma.subscriptionLifecycleEvent.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      throw new NotFoundException(`Lifecycle event ${eventId} not found`);
    }

    if (event.status !== 'pending') {
      throw new BadRequestException(
        `Cannot cancel event in status "${event.status}". Only pending events can be cancelled.`,
      );
    }

    const updated = await this.prisma.subscriptionLifecycleEvent.update({
      where: { id: eventId },
      data: { status: 'cancelled' },
    });

    this.logger.log(`Lifecycle event ${eventId} cancelled by admin`);
    return updated;
  }

  /**
   * Bulk retry all failed events, optionally filtered by event type.
   */
  async bulkRetry(eventType?: string) {
    const where: Prisma.SubscriptionLifecycleEventWhereInput = {
      status: 'failed',
    };
    if (eventType) where.eventType = eventType;

    const result = await this.prisma.subscriptionLifecycleEvent.updateMany({
      where,
      data: {
        status: 'pending',
        attempts: 0,
        lastError: null,
        processedAt: null,
      },
    });

    this.logger.log(
      `Bulk retry: reset ${result.count} failed lifecycle event(s) to pending` +
      (eventType ? ` (type: ${eventType})` : ''),
    );

    return { count: result.count };
  }
}
