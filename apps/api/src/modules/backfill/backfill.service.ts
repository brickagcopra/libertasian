import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { BackfillBatch } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateBackfillBatchDto,
  ListBackfillBatchesDto,
  HaltBackfillDto,
  KillInflightDto,
  ExtendBudgetDto,
} from './dto';

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

  constructor(private readonly prisma: PrismaService) {}

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

    // Validate sourceId exists
    const source = await this.prisma.source.findUnique({
      where: { id: dto.sourceId },
    });
    if (!source) {
      throw new NotFoundException(`Source ${dto.sourceId} not found`);
    }

    const batch = await this.prisma.backfillBatch.create({
      data: {
        sourceId: dto.sourceId,
        sourceEndpointId: dto.sourceEndpointId,
        name: dto.name,
        description: dto.description,
        yearStart: dto.yearStart,
        yearEnd: dto.yearEnd,
        monthStart: dto.monthStart,
        monthEnd: dto.monthEnd,
        budgetCeilingUsd: dto.budgetCeilingUsd,
        adminNotes: dto.adminNotes,
        createdByUserId: userId,
        status: 'pending',
      },
    });

    // If startImmediately, transition to enumerating
    if (dto.startImmediately) {
      return this.transition(batch.id, 'pending', 'enumerating');
    }

    return batch;
  }

  async findAll(
    dto: ListBackfillBatchesDto,
  ): Promise<{ data: BackfillBatch[]; total: number }> {
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
