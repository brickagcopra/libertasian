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
import { GenerateHearingPrepDto, ListHearingPrepQueryDto } from './dto';

export interface HearingPrepJobData {
  packId: string;
  topic: string;
  issue?: string;
  documentIds: string[];
  inputContext?: Record<string, unknown>;
}

@Injectable()
export class HearingPrepService {
  private readonly logger = new Logger(HearingPrepService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usageQuota: UsageQuotaService,
    @InjectQueue('hearing-prep') private readonly queue: Queue,
  ) {}

  /**
   * Trigger hearing prep generation. Creates a pending record, checks quota,
   * validates documents (if provided), and enqueues a BullMQ job.
   */
  async triggerGeneration(
    dto: GenerateHearingPrepDto,
    userId: string,
    organizationId: string,
  ) {
    // Check usage quota
    const quota = await this.usageQuota.checkAndIncrement(
      organizationId,
      userId,
      'hearingPrepPerMonth',
    );
    if (!quota.allowed) {
      throw new ForbiddenException(
        `Hearing prep quota exceeded. Used: ${quota.used}/${quota.limit}. Resets at: ${quota.resetsAt}`,
      );
    }

    const documentIds = dto.documentIds ?? [];

    // Validate documents if provided
    if (documentIds.length > 0) {
      const documents = await this.prisma.legalDocument.findMany({
        where: { id: { in: documentIds } },
        select: { id: true, title: true, citationText: true },
      });
      if (documents.length !== documentIds.length) {
        throw new BadRequestException(
          `Some documents not found. Requested ${documentIds.length}, found ${documents.length}`,
        );
      }
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

    // Create hearing prep record in pending status
    const pack = await this.prisma.hearingPrepPack.create({
      data: {
        organizationId,
        userId,
        topic: dto.topic,
        issue: dto.issue ?? null,
        documentIds: documentIds,
        inputContext: dto.inputContext
          ? (dto.inputContext as Prisma.JsonObject)
          : undefined,
        matterId: dto.matterId ?? null,
        status: 'pending',
      },
      include: {
        matter: { select: { id: true, title: true } },
      },
    });

    // Enqueue BullMQ job
    const job = await this.queue.add(
      'generate-hearing-prep',
      {
        packId: pack.id,
        topic: dto.topic,
        issue: dto.issue,
        documentIds: documentIds,
        inputContext: dto.inputContext,
      } satisfies HearingPrepJobData,
      {
        attempts: 2,
        backoff: { type: 'exponential', delay: 10000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    );

    // Store job ID for tracking
    await this.prisma.hearingPrepPack.update({
      where: { id: pack.id },
      data: { jobId: job.id ?? null },
    });

    this.logger.log(
      `Hearing prep triggered: id=${pack.id}, topic="${dto.topic}", docs=${documentIds.length}, jobId=${job.id}`,
    );

    return pack;
  }

  /**
   * List hearing prep packs with cursor-based pagination, scoped to user's org.
   */
  async list(
    userId: string,
    organizationId: string,
    query: ListHearingPrepQueryDto,
  ) {
    const limit = query.limit ?? 20;

    const where: Prisma.HearingPrepPackWhereInput = {
      organizationId,
      userId,
    };

    if (query.status) {
      where.status = query.status;
    }
    if (query.matterId) {
      where.matterId = query.matterId;
    }

    const packs = await this.prisma.hearingPrepPack.findMany({
      where,
      take: limit + 1,
      ...(query.cursor && { skip: 1, cursor: { id: query.cursor } }),
      orderBy: { createdAt: 'desc' },
      include: {
        matter: { select: { id: true, title: true } },
      },
    });

    const hasNext = packs.length > limit;
    const items = hasNext ? packs.slice(0, limit) : packs;
    const lastItem = items[items.length - 1];
    const nextCursor = hasNext && lastItem ? lastItem.id : undefined;

    return {
      items,
      meta: { hasNext, nextCursor, limit },
    };
  }

  /**
   * Get a hearing prep pack by ID. Enforces user/org access.
   */
  async findById(id: string, userId: string, organizationId: string) {
    const pack = await this.prisma.hearingPrepPack.findUnique({
      where: { id },
      include: {
        matter: { select: { id: true, title: true } },
      },
    });

    if (!pack) {
      throw new NotFoundException('Hearing prep pack not found');
    }

    if (
      pack.organizationId !== organizationId ||
      pack.userId !== userId
    ) {
      throw new ForbiddenException(
        'You do not have access to this hearing prep pack',
      );
    }

    return pack;
  }

  /**
   * Delete a hearing prep pack. Only the creator can delete.
   */
  async delete(id: string, userId: string, organizationId: string) {
    const pack = await this.prisma.hearingPrepPack.findUnique({
      where: { id },
    });

    if (!pack) {
      throw new NotFoundException('Hearing prep pack not found');
    }

    if (
      pack.organizationId !== organizationId ||
      pack.userId !== userId
    ) {
      throw new ForbiddenException(
        'You do not have access to this hearing prep pack',
      );
    }

    await this.prisma.hearingPrepPack.delete({ where: { id } });
  }

  /**
   * Update pack status and result — called by processor on completion.
   */
  async updateFromGeneration(
    id: string,
    data: {
      status: string;
      packJson?: Record<string, unknown>;
      modelRunId?: string;
    },
  ) {
    return this.prisma.hearingPrepPack.update({
      where: { id },
      data: {
        status: data.status,
        ...(data.packJson !== undefined && {
          packJson: data.packJson as Prisma.JsonObject,
        }),
        ...(data.modelRunId !== undefined && {
          modelRunId: data.modelRunId,
        }),
      },
    });
  }

  /**
   * Get pack status — lightweight query for SSE polling.
   */
  async getStatus(id: string, userId: string, organizationId: string) {
    const pack = await this.prisma.hearingPrepPack.findUnique({
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

    if (!pack) {
      throw new NotFoundException('Hearing prep pack not found');
    }

    if (
      pack.organizationId !== organizationId ||
      pack.userId !== userId
    ) {
      throw new ForbiddenException(
        'You do not have access to this hearing prep pack',
      );
    }

    return {
      id: pack.id,
      status: pack.status,
      createdAt: pack.createdAt,
      updatedAt: pack.updatedAt,
    };
  }
}
