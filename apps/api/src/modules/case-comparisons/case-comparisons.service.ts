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
import { GenerateCaseComparisonDto, ListCaseComparisonsQueryDto } from './dto';

export interface CaseComparisonJobData {
  comparisonId: string;
  documentIds: string[];
  comparisonType: string;
}

@Injectable()
export class CaseComparisonsService {
  private readonly logger = new Logger(CaseComparisonsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usageQuota: UsageQuotaService,
    @InjectQueue('case-comparisons') private readonly queue: Queue,
  ) {}

  /**
   * Trigger case comparison generation. Creates a pending record, checks quota,
   * validates documents exist, and enqueues a BullMQ job.
   */
  async triggerGeneration(
    dto: GenerateCaseComparisonDto,
    userId: string,
    organizationId: string,
  ) {
    // Check usage quota
    const quota = await this.usageQuota.checkAndIncrement(
      organizationId,
      userId,
      'caseComparisonPerMonth',
    );
    if (!quota.allowed) {
      throw new ForbiddenException(
        `Case comparison quota exceeded. Used: ${quota.used}/${quota.limit}. Resets at: ${quota.resetsAt}`,
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

    // Create comparison record in pending status
    const comparison = await this.prisma.caseComparison.create({
      data: {
        organizationId,
        userId,
        documentIds: dto.documentIds,
        comparisonType: dto.comparisonType,
        matterId: dto.matterId ?? null,
        status: 'pending',
      },
      include: {
        matter: { select: { id: true, title: true } },
      },
    });

    // Enqueue BullMQ job
    const job = await this.queue.add(
      'generate-comparison',
      {
        comparisonId: comparison.id,
        documentIds: dto.documentIds,
        comparisonType: dto.comparisonType,
      } satisfies CaseComparisonJobData,
      {
        attempts: 2,
        backoff: { type: 'exponential', delay: 10000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    );

    // Store job ID for tracking
    await this.prisma.caseComparison.update({
      where: { id: comparison.id },
      data: { jobId: job.id ?? null },
    });

    this.logger.log(
      `Case comparison triggered: id=${comparison.id}, type=${dto.comparisonType}, docs=${dto.documentIds.length}, jobId=${job.id}`,
    );

    return comparison;
  }

  /**
   * List case comparisons with cursor-based pagination, scoped to user's org.
   */
  async list(
    userId: string,
    organizationId: string,
    query: ListCaseComparisonsQueryDto,
  ) {
    const limit = query.limit ?? 20;

    const where: Prisma.CaseComparisonWhereInput = {
      organizationId,
      userId,
    };

    if (query.comparisonType) {
      where.comparisonType = query.comparisonType;
    }
    if (query.status) {
      where.status = query.status;
    }
    if (query.matterId) {
      where.matterId = query.matterId;
    }

    const comparisons = await this.prisma.caseComparison.findMany({
      where,
      take: limit + 1,
      ...(query.cursor && { skip: 1, cursor: { id: query.cursor } }),
      orderBy: { createdAt: 'desc' },
      include: {
        matter: { select: { id: true, title: true } },
      },
    });

    const hasNext = comparisons.length > limit;
    const items = hasNext ? comparisons.slice(0, limit) : comparisons;
    const lastItem = items[items.length - 1];
    const nextCursor = hasNext && lastItem ? lastItem.id : undefined;

    return {
      items,
      meta: { hasNext, nextCursor, limit },
    };
  }

  /**
   * Get a comparison by ID. Enforces user/org access.
   */
  async findById(id: string, userId: string, organizationId: string) {
    const comparison = await this.prisma.caseComparison.findUnique({
      where: { id },
      include: {
        matter: { select: { id: true, title: true } },
      },
    });

    if (!comparison) {
      throw new NotFoundException('Case comparison not found');
    }

    if (
      comparison.organizationId !== organizationId ||
      comparison.userId !== userId
    ) {
      throw new ForbiddenException(
        'You do not have access to this comparison',
      );
    }

    return comparison;
  }

  /**
   * Delete a comparison. Only the creator can delete.
   */
  async delete(id: string, userId: string, organizationId: string) {
    const comparison = await this.prisma.caseComparison.findUnique({
      where: { id },
    });

    if (!comparison) {
      throw new NotFoundException('Case comparison not found');
    }

    if (
      comparison.organizationId !== organizationId ||
      comparison.userId !== userId
    ) {
      throw new ForbiddenException(
        'You do not have access to this comparison',
      );
    }

    await this.prisma.caseComparison.delete({ where: { id } });
  }

  /**
   * Update comparison status and result — called by processor on completion.
   */
  async updateFromGeneration(
    id: string,
    data: {
      status: string;
      resultJson?: Record<string, unknown>;
      modelRunId?: string;
    },
  ) {
    return this.prisma.caseComparison.update({
      where: { id },
      data: {
        status: data.status,
        ...(data.resultJson !== undefined && {
          resultJson: data.resultJson as Prisma.JsonObject,
        }),
        ...(data.modelRunId !== undefined && {
          modelRunId: data.modelRunId,
        }),
      },
    });
  }

  /**
   * Get comparison status — lightweight query for SSE polling.
   */
  async getStatus(id: string, userId: string, organizationId: string) {
    const comparison = await this.prisma.caseComparison.findUnique({
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

    if (!comparison) {
      throw new NotFoundException('Case comparison not found');
    }

    if (
      comparison.organizationId !== organizationId ||
      comparison.userId !== userId
    ) {
      throw new ForbiddenException(
        'You do not have access to this comparison',
      );
    }

    return {
      id: comparison.id,
      status: comparison.status,
      createdAt: comparison.createdAt,
      updatedAt: comparison.updatedAt,
    };
  }
}
