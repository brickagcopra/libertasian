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
import { GeneratePleadingDto, ListPleadingsQueryDto } from './dto';

export interface PleadingJobData {
  pleadingId: string;
  templateId: string;
  inputData: Record<string, unknown>;
  contextQuery?: string;
  templateName: string;
  templateCategory: string;
  templateJson: unknown;
}

@Injectable()
export class PleadingsService {
  private readonly logger = new Logger(PleadingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usageQuota: UsageQuotaService,
    @InjectQueue('pleadings') private readonly queue: Queue,
  ) {}

  /**
   * Trigger pleading generation. Creates a pending record, checks quota,
   * validates template, and enqueues a BullMQ job.
   */
  async triggerGeneration(
    dto: GeneratePleadingDto,
    userId: string,
    organizationId: string,
  ) {
    // Check usage quota
    const quota = await this.usageQuota.checkAndIncrement(
      organizationId,
      userId,
      'pleadingAssistancePerMonth',
    );
    if (!quota.allowed) {
      throw new ForbiddenException(
        `Pleading assistance quota exceeded. Used: ${quota.used}/${quota.limit}. Resets at: ${quota.resetsAt}`,
      );
    }

    // Validate template exists and is active
    const template = await this.prisma.pleadingTemplate.findUnique({
      where: { id: dto.templateId },
    });
    if (!template || !template.isActive) {
      throw new NotFoundException('Pleading template not found or inactive');
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

    // Create pleading record in pending status
    const pleading = await this.prisma.pleading.create({
      data: {
        organizationId,
        userId,
        templateId: dto.templateId,
        inputData: dto.inputData as Prisma.JsonObject,
        matterId: dto.matterId ?? null,
        status: 'pending',
      },
      include: {
        template: { select: { id: true, name: true, slug: true, category: true } },
        matter: { select: { id: true, title: true } },
      },
    });

    // Enqueue BullMQ job
    const job = await this.queue.add(
      'generate-pleading',
      {
        pleadingId: pleading.id,
        templateId: dto.templateId,
        inputData: dto.inputData,
        contextQuery: dto.contextQuery,
        templateName: template.name,
        templateCategory: template.category,
        templateJson: template.templateJson,
      } satisfies PleadingJobData,
      {
        attempts: 2,
        backoff: { type: 'exponential', delay: 10000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    );

    // Store job ID
    await this.prisma.pleading.update({
      where: { id: pleading.id },
      data: { jobId: job.id ?? null },
    });

    this.logger.log(
      `Pleading generation triggered: id=${pleading.id}, template=${template.slug}, jobId=${job.id}`,
    );

    return pleading;
  }

  /**
   * List pleadings with cursor-based pagination.
   */
  async list(
    userId: string,
    organizationId: string,
    query: ListPleadingsQueryDto,
  ) {
    const limit = query.limit ?? 20;

    const where: Prisma.PleadingWhereInput = {
      organizationId,
      userId,
    };

    if (query.status) {
      where.status = query.status;
    }
    if (query.matterId) {
      where.matterId = query.matterId;
    }
    if (query.category) {
      where.template = { category: query.category };
    }

    const pleadings = await this.prisma.pleading.findMany({
      where,
      take: limit + 1,
      ...(query.cursor && { skip: 1, cursor: { id: query.cursor } }),
      orderBy: { createdAt: 'desc' },
      include: {
        template: { select: { id: true, name: true, slug: true, category: true } },
        matter: { select: { id: true, title: true } },
      },
    });

    const hasNext = pleadings.length > limit;
    const items = hasNext ? pleadings.slice(0, limit) : pleadings;
    const lastItem = items[items.length - 1];
    const nextCursor = hasNext && lastItem ? lastItem.id : undefined;

    return {
      items,
      meta: { hasNext, nextCursor, limit },
    };
  }

  /**
   * Get a pleading by ID. Enforces user/org access.
   */
  async findById(id: string, userId: string, organizationId: string) {
    const pleading = await this.prisma.pleading.findUnique({
      where: { id },
      include: {
        template: {
          select: { id: true, name: true, slug: true, category: true, court: true },
        },
        matter: { select: { id: true, title: true } },
      },
    });

    if (!pleading) {
      throw new NotFoundException('Pleading not found');
    }

    if (
      pleading.organizationId !== organizationId ||
      pleading.userId !== userId
    ) {
      throw new ForbiddenException('You do not have access to this pleading');
    }

    return pleading;
  }

  /**
   * Delete a pleading. Only the creator can delete.
   */
  async delete(id: string, userId: string, organizationId: string) {
    const pleading = await this.prisma.pleading.findUnique({
      where: { id },
    });

    if (!pleading) {
      throw new NotFoundException('Pleading not found');
    }

    if (
      pleading.organizationId !== organizationId ||
      pleading.userId !== userId
    ) {
      throw new ForbiddenException('You do not have access to this pleading');
    }

    await this.prisma.pleading.delete({ where: { id } });
  }

  /**
   * Update pleading output — called by processor on completion.
   */
  async updateFromGeneration(
    id: string,
    data: {
      status: string;
      generatedOutput?: Record<string, unknown>;
      citationsJson?: unknown[];
      modelRunId?: string;
    },
  ) {
    return this.prisma.pleading.update({
      where: { id },
      data: {
        status: data.status,
        ...(data.generatedOutput !== undefined && {
          generatedOutput: data.generatedOutput as Prisma.JsonObject,
        }),
        ...(data.citationsJson !== undefined && {
          citationsJson: data.citationsJson as Prisma.JsonArray,
        }),
        ...(data.modelRunId !== undefined && {
          modelRunId: data.modelRunId,
        }),
      },
    });
  }

  /**
   * Get pleading status — lightweight query for SSE.
   */
  async getStatus(id: string, userId: string, organizationId: string) {
    const pleading = await this.prisma.pleading.findUnique({
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

    if (!pleading) {
      throw new NotFoundException('Pleading not found');
    }

    if (
      pleading.organizationId !== organizationId ||
      pleading.userId !== userId
    ) {
      throw new ForbiddenException('You do not have access to this pleading');
    }

    return {
      id: pleading.id,
      status: pleading.status,
      createdAt: pleading.createdAt,
      updatedAt: pleading.updatedAt,
    };
  }

  /**
   * List all active pleading templates. Public for all authenticated users.
   */
  async listTemplates(category?: string) {
    const where: Prisma.PleadingTemplateWhereInput = { isActive: true };
    if (category) {
      where.category = category;
    }

    return this.prisma.pleadingTemplate.findMany({
      where,
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        slug: true,
        category: true,
        court: true,
        description: true,
        isActive: true,
      },
    });
  }

  /**
   * Get a single pleading template by ID (includes full templateJson).
   */
  async getTemplate(id: string) {
    const template = await this.prisma.pleadingTemplate.findUnique({
      where: { id },
    });

    if (!template || !template.isActive) {
      throw new NotFoundException('Pleading template not found or inactive');
    }

    return template;
  }
}
