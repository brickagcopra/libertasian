import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { Queue } from 'bullmq';

import { PrismaService } from '../../prisma/prisma.service';
import { UsageQuotaService } from '../subscriptions/usage-quota.service';
import { GenerateTimelineDto, ListTimelinesQueryDto } from './dto';

export interface TimelineJobData {
  timelineId: string;
  documentIds: string[];
  title: string;
}

@Injectable()
export class TimelinesService {
  private readonly logger = new Logger(TimelinesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usageQuota: UsageQuotaService,
    @InjectQueue('timelines') private readonly queue: Queue,
  ) {}

  /**
   * Trigger timeline generation. Creates a pending record, checks quota,
   * validates documents exist, and enqueues a BullMQ job.
   */
  async triggerGeneration(
    dto: GenerateTimelineDto,
    userId: string,
    organizationId: string,
  ) {
    // Check usage quota
    const quota = await this.usageQuota.checkAndIncrement(
      organizationId,
      userId,
      'timelineGenerationPerMonth',
    );
    if (!quota.allowed) {
      throw new ForbiddenException(
        `Timeline generation quota exceeded. Used: ${quota.used}/${quota.limit}. Resets at: ${quota.resetsAt}`,
      );
    }

    // Validate all documents exist
    const documents = await this.prisma.legalDocument.findMany({
      where: { id: { in: dto.documentIds } },
      select: { id: true, title: true, citationText: true },
    });
    if (documents.length !== dto.documentIds.length) {
      throw new BadRequestException(
        `Some documents not found. Requested ${dto.documentIds.length}, found ${documents.length}`,
      );
    }

    // Validate matter if provided
    if (dto.matterId) {
      const matter = await this.prisma.forTenant(organizationId).matter.findFirst({
        where: { id: dto.matterId },
      });
      if (!matter) {
        throw new NotFoundException('Matter not found');
      }
    }

    // Create timeline record in pending status
    const timeline = await this.prisma.caseTimeline.create({
      data: {
        organizationId,
        userId,
        title: dto.title,
        documentIds: dto.documentIds,
        matterId: dto.matterId ?? null,
        status: 'pending',
      },
      include: {
        matter: { select: { id: true, title: true } },
      },
    });

    // Enqueue BullMQ job
    const job = await this.queue.add(
      'generate-timeline',
      {
        timelineId: timeline.id,
        documentIds: dto.documentIds,
        title: dto.title,
      } satisfies TimelineJobData,
      {
        attempts: 2,
        backoff: { type: 'exponential', delay: 10000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    );

    // Store job ID for tracking
    await this.prisma.caseTimeline.update({
      where: { id: timeline.id },
      data: { jobId: job.id ?? null },
    });

    this.logger.log(
      `Timeline generation triggered: id=${timeline.id}, title="${dto.title}", docs=${dto.documentIds.length}, jobId=${job.id}`,
    );

    return timeline;
  }

  /**
   * List timelines with cursor-based pagination, scoped to user's org.
   */
  async list(
    userId: string,
    organizationId: string,
    query: ListTimelinesQueryDto,
  ) {
    const limit = query.limit ?? 20;

    const where: Prisma.CaseTimelineWhereInput = {
      organizationId,
      userId,
    };

    if (query.status) {
      where.status = query.status;
    }
    if (query.matterId) {
      where.matterId = query.matterId;
    }

    const timelines = await this.prisma.caseTimeline.findMany({
      where,
      take: limit + 1,
      ...(query.cursor && { skip: 1, cursor: { id: query.cursor } }),
      orderBy: { createdAt: 'desc' },
      include: {
        matter: { select: { id: true, title: true } },
      },
    });

    const hasNext = timelines.length > limit;
    const items = hasNext ? timelines.slice(0, limit) : timelines;
    const lastItem = items[items.length - 1];
    const nextCursor = hasNext && lastItem ? lastItem.id : undefined;

    return {
      items,
      meta: { hasNext, nextCursor, limit },
    };
  }

  /**
   * Get a timeline by ID. Enforces user/org access.
   */
  async findById(id: string, userId: string, organizationId: string) {
    const timeline = await this.prisma.caseTimeline.findUnique({
      where: { id },
      include: {
        matter: { select: { id: true, title: true } },
      },
    });

    if (!timeline) {
      throw new NotFoundException('Timeline not found');
    }

    if (
      timeline.organizationId !== organizationId ||
      timeline.userId !== userId
    ) {
      throw new ForbiddenException(
        'You do not have access to this timeline',
      );
    }

    return timeline;
  }

  /**
   * Delete a timeline. Only the creator can delete.
   */
  async delete(id: string, userId: string, organizationId: string) {
    const timeline = await this.prisma.caseTimeline.findUnique({
      where: { id },
    });

    if (!timeline) {
      throw new NotFoundException('Timeline not found');
    }

    if (
      timeline.organizationId !== organizationId ||
      timeline.userId !== userId
    ) {
      throw new ForbiddenException(
        'You do not have access to this timeline',
      );
    }

    await this.prisma.caseTimeline.delete({ where: { id } });
  }

  /**
   * Update timeline status and result — called by processor on completion.
   */
  async updateFromGeneration(
    id: string,
    data: {
      status: string;
      timelineJson?: Record<string, unknown>;
      modelRunId?: string;
    },
  ) {
    return this.prisma.caseTimeline.update({
      where: { id },
      data: {
        status: data.status,
        ...(data.timelineJson !== undefined && {
          timelineJson: data.timelineJson as Prisma.JsonObject,
        }),
        ...(data.modelRunId !== undefined && {
          modelRunId: data.modelRunId,
        }),
      },
    });
  }

  /**
   * Get timeline status — lightweight query for SSE polling.
   */
  async getStatus(id: string, userId: string, organizationId: string) {
    const timeline = await this.prisma.caseTimeline.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        organizationId: true,
        userId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!timeline) {
      throw new NotFoundException('Timeline not found');
    }

    if (
      timeline.organizationId !== organizationId ||
      timeline.userId !== userId
    ) {
      throw new ForbiddenException(
        'You do not have access to this timeline',
      );
    }

    return {
      id: timeline.id,
      status: timeline.status,
      createdAt: timeline.createdAt,
      updatedAt: timeline.updatedAt,
    };
  }
}
