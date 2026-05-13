import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { BackfillBatch } from '@prisma/client';

import { CeleryDispatcherService } from '../../common/services/celery-dispatcher.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateBackfillBatchDto,
  ListBackfillBatchesDto,
  HaltBackfillDto,
  KillInflightDto,
  ExtendBudgetDto,
  UpdateInflightDto,
} from './dto';
import { BACKFILL_SLUG_TO_PARSER_TYPE } from './dto/create-backfill-batch.dto';

@Injectable()
export class BackfillService {
  private readonly logger = new Logger(BackfillService.name);

  /** Valid state transitions — enforced in every transition method. */
  private static readonly VALID_TRANSITIONS: Record<string, string[]> = {
    pending: ['enumerating', 'failed'],
    enumerating: ['running', 'failed'],
    running: ['paused', 'halted_budget', 'halted_admin', 'completed', 'failed'],
    paused: ['running', 'failed'],
    halted_budget: ['running'],
    halted_admin: ['running'],
    // completed and failed are terminal
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly celery: CeleryDispatcherService,
  ) {}

  async create(
    dto: CreateBackfillBatchDto,
    userId: string,
  ): Promise<BackfillBatch> {
    // Validate yearStart <= yearEnd
    if (dto.yearStart > dto.yearEnd) {
      throw new BadRequestException('yearStart must be <= yearEnd');
    }

    // Validate monthStart <= monthEnd when both are set
    if (
      dto.monthStart !== undefined &&
      dto.monthEnd !== undefined &&
      dto.monthStart > dto.monthEnd
    ) {
      throw new BadRequestException('monthStart must be <= monthEnd');
    }

    // Exactly one of sourceId / sourceSlug must be provided. class-validator
    // already rejects the "neither" case via ValidateIf, but catches both-set.
    if (dto.sourceId && dto.sourceSlug) {
      throw new BadRequestException(
        'Provide sourceId OR sourceSlug, not both',
      );
    }

    const sourceId = dto.sourceId
      ? dto.sourceId
      : await this.resolveSourceIdFromSlug(dto.sourceSlug!);

    // Validate sourceId exists
    const source = await this.prisma.source.findUnique({
      where: { id: sourceId },
    });
    if (!source) {
      throw new NotFoundException(`Source ${sourceId} not found`);
    }

    const batch = await this.prisma.backfillBatch.create({
      data: {
        sourceId,
        sourceEndpointId: dto.sourceEndpointId,
        name: dto.name,
        description: dto.description,
        yearStart: dto.yearStart,
        yearEnd: dto.yearEnd,
        monthStart: dto.monthStart,
        monthEnd: dto.monthEnd,
        budgetCeilingUsd: dto.budgetCeilingUsd,
        // Defaults to 25 at the column level when omitted.
        ...(dto.inflightCap !== undefined && { inflightCap: dto.inflightCap }),
        adminNotes: dto.adminNotes,
        createdByUserId: userId,
        status: 'pending',
      },
    });

    // If startImmediately, transition to enumerating AND fire the
    // Celery enumerate task synchronously. The transition alone is
    // not enough — without an actual task on the broker, the batch
    // sits idle until the worker's 5-min "rescue stuck enumerating"
    // sweep picks it up. Production batches created through the admin
    // UI consistently waited that full window before doing anything.
    // The rescue sweep stays in place as a safety net for SQL-inserted
    // batches and for the (unlikely) case where this dispatch fails
    // after the transition succeeded.
    if (dto.startImmediately) {
      const transitioned = await this.transition(
        batch.id,
        'pending',
        'enumerating',
      );

      try {
        await this.celery.sendTask('backfill.enumerate_candidates', {
          args: [transitioned.id],
        });
      } catch (err) {
        // Don't fail the create — the worker's rescue sweep will pick
        // this up within ~5 min. Log loud so an ops Sentry catches a
        // sustained Redis outage.
        this.logger.error(
          `startImmediately: dispatch of backfill.enumerate_candidates ` +
            `failed for batch ${transitioned.id} — relying on rescue sweep`,
          err instanceof Error ? err.stack : String(err),
        );
      }

      return transitioned;
    }

    return batch;
  }

  async findAll(
    dto: ListBackfillBatchesDto,
  ): Promise<{
    data: Omit<BackfillBatch, 'checkpointState'>[];
    total: number;
  }> {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: { status?: string; sourceId?: string } = {};
    if (dto.status) where.status = dto.status;
    if (dto.sourceId) where.sourceId = dto.sourceId;

    const [data, total] = await Promise.all([
      this.prisma.backfillBatch.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { source: { select: { id: true, name: true } } },
        // checkpointState is multi-MB for live batches; detail endpoint serves it.
        omit: { checkpointState: true },
      }),
      this.prisma.backfillBatch.count({ where }),
    ]);

    return { data, total };
  }

  async findOne(id: string): Promise<BackfillBatch> {
    const batch = await this.prisma.backfillBatch.findUnique({
      where: { id },
      include: {
        source: { select: { id: true, name: true } },
        sourceEndpoint: { select: { id: true, endpointUrl: true } },
        checkpoints: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });

    if (!batch) {
      throw new NotFoundException(`BackfillBatch ${id} not found`);
    }

    return batch;
  }

  async start(id: string): Promise<BackfillBatch> {
    return this.transition(id, 'pending', 'enumerating');
  }

  async pause(id: string): Promise<BackfillBatch> {
    return this.transition(id, 'running', 'paused');
  }

  async resume(id: string): Promise<BackfillBatch> {
    const batch = await this.findOneOrFail(id);
    const allowed = ['paused', 'halted_budget', 'halted_admin'];

    if (!allowed.includes(batch.status)) {
      throw new BadRequestException(
        `Cannot resume batch: current status is '${batch.status}', expected one of '${allowed.join("', '")}'`,
      );
    }

    return this.prisma.backfillBatch.update({
      where: { id },
      data: { status: 'running' },
    });
  }

  async halt(id: string, dto: HaltBackfillDto): Promise<BackfillBatch> {
    const batch = await this.findOneOrFail(id);
    this.assertTransition(batch.status, 'halted_admin');

    return this.prisma.backfillBatch.update({
      where: { id },
      data: {
        status: 'halted_admin',
        adminNotes: dto.reason,
      },
    });
  }

  async extendBudget(
    id: string,
    dto: ExtendBudgetDto,
  ): Promise<BackfillBatch> {
    const batch = await this.findOneOrFail(id);

    if (batch.status !== 'halted_budget') {
      throw new BadRequestException(
        `Cannot extend budget: current status is '${batch.status}', expected 'halted_budget'`,
      );
    }

    return this.prisma.backfillBatch.update({
      where: { id },
      data: {
        budgetCeilingUsd: dto.newCeilingUsd,
        adminNotes: dto.reason,
      },
    });
  }

  /**
   * Update the per-batch in-flight concurrency cap mid-run.
   *
   * Effective on the next tick — the worker reads ``inflight_cap`` off the
   * row each iteration. No restart, no halt-then-resume choreography.
   * Bounds enforced by the DTO (1–200).
   */
  async updateInflight(
    id: string,
    dto: UpdateInflightDto,
  ): Promise<BackfillBatch> {
    await this.findOneOrFail(id);

    return this.prisma.backfillBatch.update({
      where: { id },
      data: { inflightCap: dto.inflightCap },
    });
  }

  async killInflight(
    id: string,
    dto: KillInflightDto,
  ): Promise<BackfillBatch> {
    const batch = await this.findOneOrFail(id);

    if (batch.name !== dto.confirmName) {
      throw new BadRequestException(
        `confirmName '${dto.confirmName}' does not match batch name '${batch.name}'`,
      );
    }

    // Mark in-flight child IngestionJobs as failed
    await this.prisma.ingestionJob.updateMany({
      where: {
        backfillBatchId: id,
        status: { in: ['pending', 'running'] },
      },
      data: { status: 'failed' },
    });

    return this.prisma.backfillBatch.update({
      where: { id },
      data: {
        status: 'failed',
        adminNotes: dto.reason,
        finishedAt: new Date(),
      },
    });
  }

  async remove(id: string): Promise<void> {
    const batch = await this.findOneOrFail(id);
    const terminal = ['completed', 'failed'];

    if (!terminal.includes(batch.status)) {
      throw new BadRequestException(
        `Cannot delete batch: current status is '${batch.status}', must be 'completed' or 'failed'`,
      );
    }

    await this.prisma.backfillBatch.delete({ where: { id } });
  }

  // ---- Private helpers ----

  /**
   * Resolve a backfill source slug ('lawphil' | 'scel') to a live Source UUID
   * by looking for a SourceEndpoint whose parserType matches the slug's
   * mapping. Matches the lookup pattern used by IngestionScheduler —
   * parserType is the canonical source key.
   */
  private async resolveSourceIdFromSlug(slug: string): Promise<string> {
    const parserType = BACKFILL_SLUG_TO_PARSER_TYPE[slug];
    if (!parserType) {
      // class-validator's @IsIn should have caught this; double-guard.
      throw new BadRequestException(`Unknown sourceSlug: '${slug}'`);
    }
    const endpoint = await this.prisma.sourceEndpoint.findFirst({
      where: { parserType },
      select: { sourceId: true },
    });
    if (!endpoint) {
      throw new NotFoundException(
        `No source endpoint found for slug='${slug}' (parserType='${parserType}'). ` +
          `Seed the Source + SourceEndpoint first.`,
      );
    }
    return endpoint.sourceId;
  }

  private async findOneOrFail(id: string): Promise<BackfillBatch> {
    const batch = await this.prisma.backfillBatch.findUnique({
      where: { id },
    });

    if (!batch) {
      throw new NotFoundException(`BackfillBatch ${id} not found`);
    }

    return batch;
  }

  private assertTransition(currentStatus: string, targetStatus: string): void {
    const allowed =
      BackfillService.VALID_TRANSITIONS[currentStatus] ?? [];

    if (!allowed.includes(targetStatus)) {
      throw new BadRequestException(
        `Cannot transition batch: current status is '${currentStatus}', target '${targetStatus}' is not allowed`,
      );
    }
  }

  private async transition(
    id: string,
    expectedCurrent: string,
    target: string,
  ): Promise<BackfillBatch> {
    const batch = await this.findOneOrFail(id);

    if (batch.status !== expectedCurrent) {
      throw new BadRequestException(
        `Cannot ${target} batch: current status is '${batch.status}', expected '${expectedCurrent}'`,
      );
    }

    this.assertTransition(batch.status, target);

    const data: { status: string; startedAt?: Date } = { status: target };
    if (target === 'enumerating' || target === 'running') {
      data.startedAt = batch.startedAt ?? new Date();
    }

    return this.prisma.backfillBatch.update({
      where: { id },
      data,
    });
  }
}
