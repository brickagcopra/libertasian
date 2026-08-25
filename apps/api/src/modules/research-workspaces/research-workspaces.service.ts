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
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import {
  AskResearchQueryDto,
  CreateResearchWorkspaceDto,
  ListResearchWorkspacesQueryDto,
  UpdateResearchWorkspaceDto,
} from './dto';

export interface ResearchQueryJobData {
  queryId: string;
  workspaceId: string;
  query: string;
  contextJson: Record<string, unknown>;
  previousQueries: { query: string; answer: string }[];
}

@Injectable()
export class ResearchWorkspacesService {
  private readonly logger = new Logger(ResearchWorkspacesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionsService: SubscriptionsService,
    @InjectQueue('research-workspaces') private readonly queue: Queue,
  ) {}

  /**
   * Create a new research workspace. Enforces maxResearchWorkspaces entitlement.
   */
  async create(
    dto: CreateResearchWorkspaceDto,
    userId: string,
    organizationId: string,
  ) {
    // Check workspace count against entitlement
    const entitlements =
      await this.subscriptionsService.getEntitlements(organizationId);
    const maxWorkspaces = entitlements.maxResearchWorkspaces ?? 0;

    if (maxWorkspaces !== -1) {
      const currentCount = await this.prisma.researchWorkspace.count({
        where: { organizationId, userId },
      });
      if (currentCount >= maxWorkspaces) {
        // Factual usage cap only — no tier name, no purchase action
        // (App Review 3.1.1); mobile renders this body verbatim.
        throw new ForbiddenException(
          `Research workspace limit reached. You have ${currentCount}/${maxWorkspaces} workspaces.`,
        );
      }
    }

    const contextJson = {
      pinnedDocumentIds: dto.pinnedDocumentIds ?? [],
      pinnedSectionIds: [] as string[],
      notes: '',
    };

    const workspace = await this.prisma.researchWorkspace.create({
      data: {
        organizationId,
        userId,
        title: dto.title,
        description: dto.description ?? null,
        contextJson: contextJson as unknown as Prisma.InputJsonValue,
      },
      include: {
        _count: { select: { queries: true } },
      },
    });

    this.logger.log(
      `Research workspace created: id=${workspace.id}, title="${dto.title}"`,
    );

    return {
      ...workspace,
      queryCount: workspace._count.queries,
    };
  }

  /**
   * Update a research workspace's metadata or context.
   */
  async update(
    id: string,
    dto: UpdateResearchWorkspaceDto,
    userId: string,
    organizationId: string,
  ) {
    const workspace = await this.findById(id, userId, organizationId);

    const existingContext = (workspace.contextJson ?? {}) as Record<string, unknown>;
    const updatedContext = { ...existingContext };

    if (dto.pinnedDocumentIds !== undefined) {
      updatedContext['pinnedDocumentIds'] = dto.pinnedDocumentIds;
    }
    if (dto.pinnedSectionIds !== undefined) {
      updatedContext['pinnedSectionIds'] = dto.pinnedSectionIds;
    }
    if (dto.notes !== undefined) {
      updatedContext['notes'] = dto.notes;
    }

    const updated = await this.prisma.researchWorkspace.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.description !== undefined && { description: dto.description }),
        contextJson: updatedContext as unknown as Prisma.InputJsonValue,
      },
      include: {
        _count: { select: { queries: true } },
      },
    });

    return {
      ...updated,
      queryCount: updated._count.queries,
    };
  }

  /**
   * Ask a query within the workspace context. Creates a ResearchQuery record
   * and enqueues a BullMQ job for RAG-based answer generation.
   */
  async askQuery(
    workspaceId: string,
    dto: AskResearchQueryDto,
    userId: string,
    organizationId: string,
  ) {
    // Verify workspace access
    const workspace = await this.findById(
      workspaceId,
      userId,
      organizationId,
    );

    // Get previous queries for conversation context (last 5)
    const previousQueries = await this.prisma.researchQuery.findMany({
      where: { researchWorkspaceId: workspaceId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        query: true,
        responseJson: true,
      },
    });

    const previousContext = previousQueries
      .reverse()
      .filter((q) => q.responseJson)
      .map((q) => {
        const resp = q.responseJson as Record<string, unknown> | null;
        return {
          query: q.query,
          answer: resp?.['answer']?.toString() ?? '',
        };
      });

    // Create query record
    const researchQuery = await this.prisma.researchQuery.create({
      data: {
        researchWorkspaceId: workspaceId,
        query: dto.query,
      },
    });

    // Enqueue BullMQ job
    const job = await this.queue.add(
      'generate-research-answer',
      {
        queryId: researchQuery.id,
        workspaceId,
        query: dto.query,
        contextJson: workspace.contextJson as Record<string, unknown>,
        previousQueries: previousContext,
      } satisfies ResearchQueryJobData,
      {
        attempts: 2,
        backoff: { type: 'exponential', delay: 10000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    );

    this.logger.log(
      `Research query enqueued: queryId=${researchQuery.id}, workspaceId=${workspaceId}, jobId=${job.id}`,
    );

    return researchQuery;
  }

  /**
   * List research workspaces with cursor-based pagination.
   */
  async list(
    userId: string,
    organizationId: string,
    query: ListResearchWorkspacesQueryDto,
  ) {
    const limit = query.limit ?? 20;

    const where: Prisma.ResearchWorkspaceWhereInput = {
      organizationId,
      userId,
    };

    const workspaces = await this.prisma.researchWorkspace.findMany({
      where,
      take: limit + 1,
      ...(query.cursor && { skip: 1, cursor: { id: query.cursor } }),
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: { select: { queries: true } },
      },
    });

    const hasNext = workspaces.length > limit;
    const items = hasNext ? workspaces.slice(0, limit) : workspaces;
    const lastItem = items[items.length - 1];
    const nextCursor = hasNext && lastItem ? lastItem.id : undefined;

    return {
      items: items.map((w) => ({
        ...w,
        queryCount: w._count.queries,
      })),
      meta: { hasNext, nextCursor, limit },
    };
  }

  /**
   * Get a workspace by ID with query count. Enforces user/org access.
   */
  async findById(id: string, userId: string, organizationId: string) {
    const workspace = await this.prisma.researchWorkspace.findUnique({
      where: { id },
      include: {
        _count: { select: { queries: true } },
      },
    });

    if (!workspace) {
      throw new NotFoundException('Research workspace not found');
    }

    if (
      workspace.organizationId !== organizationId ||
      workspace.userId !== userId
    ) {
      throw new ForbiddenException(
        'You do not have access to this research workspace',
      );
    }

    return {
      ...workspace,
      queryCount: workspace._count.queries,
    };
  }

  /**
   * List queries within a workspace.
   */
  async listQueries(
    workspaceId: string,
    userId: string,
    organizationId: string,
    cursor?: string,
    limit: number = 50,
  ) {
    // Verify workspace access
    await this.findById(workspaceId, userId, organizationId);

    const queries = await this.prisma.researchQuery.findMany({
      where: { researchWorkspaceId: workspaceId },
      take: limit + 1,
      ...(cursor && { skip: 1, cursor: { id: cursor } }),
      orderBy: { createdAt: 'asc' },
    });

    const hasNext = queries.length > limit;
    const items = hasNext ? queries.slice(0, limit) : queries;
    const lastItem = items[items.length - 1];
    const nextCursor = hasNext && lastItem ? lastItem.id : undefined;

    return {
      items,
      meta: { hasNext, nextCursor, limit },
    };
  }

  /**
   * Get query status — for polling pending queries.
   */
  async getQueryStatus(
    queryId: string,
    workspaceId: string,
    userId: string,
    organizationId: string,
  ) {
    // Verify workspace access
    await this.findById(workspaceId, userId, organizationId);

    const query = await this.prisma.researchQuery.findUnique({
      where: { id: queryId },
      select: {
        id: true,
        responseJson: true,
        createdAt: true,
      },
    });

    if (!query) {
      throw new NotFoundException('Research query not found');
    }

    return {
      id: query.id,
      status: query.responseJson ? 'completed' : 'pending',
      createdAt: query.createdAt,
    };
  }

  /**
   * Delete a workspace and all its queries.
   */
  async delete(id: string, userId: string, organizationId: string) {
    const workspace = await this.prisma.researchWorkspace.findUnique({
      where: { id },
    });

    if (!workspace) {
      throw new NotFoundException('Research workspace not found');
    }

    if (
      workspace.organizationId !== organizationId ||
      workspace.userId !== userId
    ) {
      throw new ForbiddenException(
        'You do not have access to this research workspace',
      );
    }

    // Cascade delete handles queries
    await this.prisma.researchWorkspace.delete({ where: { id } });
  }
}
