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
import {
  GenerateContradictionReportDto,
  ListContradictionReportsQueryDto,
} from './dto';

export interface ContradictionJobData {
  reportId: string;
  documentIds: string[];
  scope: string;
  topic: string | null;
}

@Injectable()
export class ContradictionsService {
  private readonly logger = new Logger(ContradictionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usageQuota: UsageQuotaService,
    @InjectQueue('contradictions') private readonly queue: Queue,
  ) {}

  /**
   * Trigger contradiction detection. Creates a pending record, checks quota,
   * validates documents exist, and enqueues a BullMQ job.
   */
  async triggerGeneration(
    dto: GenerateContradictionReportDto,
    userId: string,
    organizationId: string,
    opts?: { isPlatformAdmin?: boolean },
  ) {
    // Check usage quota (team+ subscription)
    const quota = await this.usageQuota.checkAndIncrement(
      organizationId,
      userId,
      'contradictionDetectionPerMonth',
      { isPlatformAdmin: opts?.isPlatformAdmin === true },
    );
    if (!quota.allowed) {
      throw new ForbiddenException(
        `Contradiction detection quota exceeded. Used: ${quota.used}/${quota.limit}. Resets at: ${quota.resetsAt}`,
      );
    }

    // Validate scope + topic consistency
    const scope = dto.scope ?? 'selected';
    if (scope === 'topic_based' && !dto.topic) {
      throw new BadRequestException(
        'Topic is required when scope is topic_based',
      );
    }

    // Validate all documents exist
    const documents = await this.prisma.legalDocument.findMany({
      where: { id: { in: dto.documentIds } },
      select: { id: true },
    });
    if (documents.length !== dto.documentIds.length) {
      throw new BadRequestException(
        `Some documents not found. Requested ${dto.documentIds.length}, found ${documents.length}`,
      );
    }

    // Create report record in pending status
    const report = await this.prisma.contradictionReport.create({
      data: {
        organizationId,
        userId,
        documentIds: dto.documentIds,
        scope,
        topic: dto.topic ?? null,
        status: 'pending',
      },
    });

    // Enqueue BullMQ job
    const job = await this.queue.add(
      'generate-contradiction-report',
      {
        reportId: report.id,
        documentIds: dto.documentIds,
        scope,
        topic: dto.topic ?? null,
      } satisfies ContradictionJobData,
      {
        attempts: 2,
        backoff: { type: 'exponential', delay: 10000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    );

    // Store job ID for tracking
    await this.prisma.contradictionReport.update({
      where: { id: report.id },
      data: { jobId: job.id ?? null },
    });

    this.logger.log(
      `Contradiction detection triggered: id=${report.id}, scope=${scope}, docs=${dto.documentIds.length}, jobId=${job.id}`,
    );

    return report;
  }

  /**
   * List contradiction reports with cursor-based pagination, scoped to user's org.
   */
  async list(
    userId: string,
    organizationId: string,
    query: ListContradictionReportsQueryDto,
  ) {
    const limit = query.limit ?? 20;

    const where: Prisma.ContradictionReportWhereInput = {
      organizationId,
      userId,
    };

    if (query.status) {
      where.status = query.status;
    }
    if (query.scope) {
      where.scope = query.scope;
    }

    const reports = await this.prisma.contradictionReport.findMany({
      where,
      take: limit + 1,
      ...(query.cursor && { skip: 1, cursor: { id: query.cursor } }),
      orderBy: { createdAt: 'desc' },
    });

    const hasNext = reports.length > limit;
    const items = hasNext ? reports.slice(0, limit) : reports;
    const lastItem = items[items.length - 1];
    const nextCursor = hasNext && lastItem ? lastItem.id : undefined;

    return {
      items,
      meta: { hasNext, nextCursor, limit },
    };
  }

  /**
   * Get a contradiction report by ID. Enforces user/org access.
   */
  async findById(id: string, userId: string, organizationId: string) {
    const report = await this.prisma.contradictionReport.findUnique({
      where: { id },
    });

    if (!report) {
      throw new NotFoundException('Contradiction report not found');
    }

    if (
      report.organizationId !== organizationId ||
      report.userId !== userId
    ) {
      throw new ForbiddenException(
        'You do not have access to this contradiction report',
      );
    }

    return report;
  }

  /**
   * Delete a contradiction report. Only the creator can delete.
   */
  async delete(id: string, userId: string, organizationId: string) {
    const report = await this.prisma.contradictionReport.findUnique({
      where: { id },
    });

    if (!report) {
      throw new NotFoundException('Contradiction report not found');
    }

    if (
      report.organizationId !== organizationId ||
      report.userId !== userId
    ) {
      throw new ForbiddenException(
        'You do not have access to this contradiction report',
      );
    }

    await this.prisma.contradictionReport.delete({ where: { id } });
  }

  /**
   * Get report status — lightweight query for SSE polling.
   */
  async getStatus(id: string, userId: string, organizationId: string) {
    const report = await this.prisma.contradictionReport.findUnique({
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

    if (!report) {
      throw new NotFoundException('Contradiction report not found');
    }

    if (
      report.organizationId !== organizationId ||
      report.userId !== userId
    ) {
      throw new ForbiddenException(
        'You do not have access to this contradiction report',
      );
    }

    return {
      id: report.id,
      status: report.status,
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
    };
  }
}
