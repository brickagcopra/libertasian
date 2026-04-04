import { InjectQueue } from '@nestjs/bullmq';
import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { Queue } from 'bullmq';

import { PrismaService } from '../../prisma/prisma.service';
import { UsageQuotaService } from '../subscriptions/usage-quota.service';
import { GenerateMemoDto, ListMemosQueryDto } from './dto';

export interface MemoJobData {
  memoId: string;
  query: string;
  memoType: string;
}

@Injectable()
export class MemosService {
  private readonly logger = new Logger(MemosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usageQuota: UsageQuotaService,
    @InjectQueue('memos') private readonly memosQueue: Queue,
  ) {}

  /**
   * Trigger memo generation. Creates a pending memo record, checks quota,
   * and enqueues a BullMQ job for async generation via RAG service.
   */
  async triggerGeneration(
    dto: GenerateMemoDto,
    userId: string,
    organizationId: string,
  ) {
    // Check usage quota
    const quota = await this.usageQuota.checkAndIncrement(
      organizationId,
      userId,
      'memoDraftingPerMonth',
    );
    if (!quota.allowed) {
      throw new ForbiddenException(
        `Memo drafting quota exceeded. Used: ${quota.used}/${quota.limit}. Resets at: ${quota.resetsAt}`,
      );
    }

    // Validate matter if provided
    if (dto.matterId) {
      const matter = await this.prisma.matter.findFirst({
        where: { id: dto.matterId, organizationId },
      });
      if (!matter) {
        throw new NotFoundException('Matter not found');
      }
    }

    // Create memo record in pending status
    const memo = await this.prisma.legalMemo.create({
      data: {
        organizationId,
        userId,
        query: dto.query.trim(),
        memoType: dto.memoType,
        matterId: dto.matterId ?? null,
        status: 'pending',
      },
      include: {
        matter: { select: { id: true, title: true } },
      },
    });

    // Enqueue BullMQ job for async generation
    const job = await this.memosQueue.add(
      'generate-memo',
      {
        memoId: memo.id,
        query: dto.query.trim(),
        memoType: dto.memoType,
      } satisfies MemoJobData,
      {
        attempts: 2,
        backoff: { type: 'exponential', delay: 10000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    );

    // Store job ID for tracking
    await this.prisma.legalMemo.update({
      where: { id: memo.id },
      data: { jobId: job.id ?? null },
    });

    this.logger.log(
      `Memo generation triggered: memoId=${memo.id}, type=${dto.memoType}, jobId=${job.id}`,
    );

    return memo;
  }

  /**
   * List memos with cursor-based pagination, scoped to user's organization.
   */
  async list(userId: string, organizationId: string, query: ListMemosQueryDto) {
    const limit = query.limit ?? 20;

    const where: Prisma.LegalMemoWhereInput = {
      organizationId,
      userId,
    };

    if (query.memoType) {
      where.memoType = query.memoType;
    }
    if (query.status) {
      where.status = query.status;
    }
    if (query.matterId) {
      where.matterId = query.matterId;
    }

    const memos = await this.prisma.legalMemo.findMany({
      where,
      take: limit + 1,
      ...(query.cursor && { skip: 1, cursor: { id: query.cursor } }),
      orderBy: { createdAt: 'desc' },
      include: {
        matter: { select: { id: true, title: true } },
      },
    });

    const hasNext = memos.length > limit;
    const items = hasNext ? memos.slice(0, limit) : memos;
    const lastItem = items[items.length - 1];
    const nextCursor = hasNext && lastItem ? lastItem.id : undefined;

    return {
      items,
      meta: { hasNext, nextCursor, limit },
    };
  }

  /**
   * Get a memo by ID. Enforces user/org access.
   */
  async findById(memoId: string, userId: string, organizationId: string) {
    const memo = await this.prisma.legalMemo.findUnique({
      where: { id: memoId },
      include: {
        matter: { select: { id: true, title: true } },
      },
    });

    if (!memo) {
      throw new NotFoundException('Memo not found');
    }

    // Access control: user can only see their own memos within their org
    if (memo.organizationId !== organizationId || memo.userId !== userId) {
      throw new ForbiddenException('You do not have access to this memo');
    }

    return memo;
  }

  /**
   * Delete a memo. Only the creator can delete.
   */
  async delete(memoId: string, userId: string, organizationId: string) {
    const memo = await this.prisma.legalMemo.findUnique({
      where: { id: memoId },
    });

    if (!memo) {
      throw new NotFoundException('Memo not found');
    }

    if (memo.organizationId !== organizationId || memo.userId !== userId) {
      throw new ForbiddenException('You do not have access to this memo');
    }

    await this.prisma.legalMemo.delete({ where: { id: memoId } });
  }

  /**
   * Update memo status and output — called by the processor on completion.
   */
  async updateFromGeneration(
    memoId: string,
    data: {
      status: string;
      structuredOutput?: Record<string, unknown>;
      citationsJson?: unknown[];
      confidenceScore?: number;
      modelRunId?: string;
    },
  ) {
    return this.prisma.legalMemo.update({
      where: { id: memoId },
      data: {
        status: data.status,
        ...(data.structuredOutput !== undefined && {
          structuredOutput: data.structuredOutput as Prisma.JsonObject,
        }),
        ...(data.citationsJson !== undefined && {
          citationsJson: data.citationsJson as Prisma.JsonArray,
        }),
        ...(data.confidenceScore !== undefined && {
          confidenceScore: data.confidenceScore,
        }),
        ...(data.modelRunId !== undefined && {
          modelRunId: data.modelRunId,
        }),
      },
    });
  }

  /**
   * Get memo status — lightweight query for polling / SSE.
   */
  async getStatus(memoId: string, userId: string, organizationId: string) {
    const memo = await this.prisma.legalMemo.findUnique({
      where: { id: memoId },
      select: {
        id: true,
        status: true,
        organizationId: true,
        userId: true,
        confidenceScore: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!memo) {
      throw new NotFoundException('Memo not found');
    }

    if (memo.organizationId !== organizationId || memo.userId !== userId) {
      throw new ForbiddenException('You do not have access to this memo');
    }

    return {
      id: memo.id,
      status: memo.status,
      confidenceScore: memo.confidenceScore,
      createdAt: memo.createdAt,
      updatedAt: memo.updatedAt,
    };
  }
}
