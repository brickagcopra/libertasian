import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CeleryDispatcherService } from '../../common/services/celery-dispatcher.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AutoPromoteService } from '../internal/auto-promote.service';
import {
  BACKFILL_MISSING_DERIVATIVE_TYPES,
  BackfillMissingDerivativeType,
} from './dto';

const CITATIONS_BACKFILL_TASK = 'citations.backfill_corpus_documents';

// Single beat poller picks up rows from `derivative_generation_jobs` with
// status='pending' and dispatches the per-type generator task. We kick it
// once after inserting so it runs on the next worker cycle instead of
// waiting up to 30s for the next beat tick.
const DERIVATIVE_POLL_TASK = 'derivatives.poll_pending_jobs';

const DEFAULT_BACKFILL_LIMIT = 200;

export interface BackfillCitationsResult {
  taskId: string;
  dispatchedAt: string;
  limit: number | null;
}

export interface BackfillMissingDerivativesResult {
  dispatchedByType: Record<BackfillMissingDerivativeType, number>;
  totalDispatched: number;
  totalSkipped: number;
}

export interface AutoPromoteSweepResult {
  promoted: number;
  scanned: number;
}

export interface AutoPromoteStatus {
  lastSweepAt: string | null;
  lastPromoted: number | null;
  last24hPromoted: number;
  totalPromoted: number;
  configThreshold: number;
  configExcludedTypes: string[];
}

@Injectable()
export class AdminPipelineOpsService {
  private readonly logger = new Logger(AdminPipelineOpsService.name);
  private readonly configThreshold: number;
  private readonly configExcludedTypes: string[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly celery: CeleryDispatcherService,
    private readonly autoPromote: AutoPromoteService,
    config: ConfigService,
  ) {
    this.configThreshold = config.get<number>(
      'AUTO_PROMOTE_CONFIDENCE_THRESHOLD',
      0.7,
    );
    const excluded = config.get<string>(
      'AUTO_PROMOTE_EXCLUDED_TYPES',
      'mcq_question',
    );
    this.configExcludedTypes = excluded
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  async dispatchCitationsBackfill(
    limit: number | undefined,
  ): Promise<BackfillCitationsResult> {
    const kwargs: Record<string, unknown> = {};
    if (limit !== undefined) {
      kwargs['limit'] = limit;
    }
    const taskId = await this.celery.sendTask(CITATIONS_BACKFILL_TASK, {
      kwargs,
    });
    return {
      taskId,
      dispatchedAt: new Date().toISOString(),
      limit: limit ?? null,
    };
  }

  /**
   * For each requested derivative type, find legal_documents that have no
   * derivative_artifact for that type (deletedAt IS NULL) and INSERT a
   * pending derivative_generation_jobs row per doc. The existing
   * `derivatives.poll_pending_jobs` beat task atomically claims and
   * dispatches the matching generator. Skip count tracks docs that
   * already had an artifact and were not enqueued.
   */
  async backfillMissingDerivatives(
    types: BackfillMissingDerivativeType[],
    limit: number,
    triggeredByUserId: string,
  ): Promise<BackfillMissingDerivativesResult> {
    const dispatchedByType = Object.fromEntries(
      BACKFILL_MISSING_DERIVATIVE_TYPES.map((t) => [t, 0]),
    ) as Record<BackfillMissingDerivativeType, number>;

    let totalDispatched = 0;
    let totalSkipped = 0;

    for (const derivativeType of types) {
      const candidates = await this.findDocsMissingDerivative(
        derivativeType,
        limit,
      );
      const scanned = candidates.scanned;
      const docs = candidates.docs;

      if (docs.length === 0) {
        totalSkipped += scanned;
        continue;
      }

      // Per-row create — Prisma's createMany skips returning ids and we
      // need the ids if we ever extend this to write a per-job audit log.
      // The volume here is bounded by `limit` (default 200), so a small
      // loop is cheap and matches the existing enqueueGeneration pattern.
      for (const doc of docs) {
        await this.prisma.derivativeGenerationJob.create({
          data: {
            derivativeType,
            triggerType: 'auto_ingest_backfill',
            sourceDocumentId: doc.id,
            status: 'pending',
            triggeredByUserId,
          },
        });
      }

      dispatchedByType[derivativeType] = docs.length;
      totalDispatched += docs.length;
      totalSkipped += scanned - docs.length;
    }

    if (totalDispatched > 0) {
      try {
        await this.celery.sendTask(DERIVATIVE_POLL_TASK);
      } catch (err) {
        // Beat poller runs every ~30s anyway; a failed manual kick just
        // delays first dispatch by one tick. Log loud for ops.
        this.logger.error(
          `Failed to kick ${DERIVATIVE_POLL_TASK} after enqueueing ${totalDispatched} jobs — beat will pick them up`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }

    return { dispatchedByType, totalDispatched, totalSkipped };
  }

  async runAutoPromoteSweep(): Promise<AutoPromoteSweepResult> {
    return this.autoPromote.sweepBacklog();
  }

  async getAutoPromoteStatus(): Promise<AutoPromoteStatus> {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [lastManualSweep, lastAutoPromotion, last24hPromoted, totalPromoted] =
      await Promise.all([
        this.prisma.auditLog.findFirst({
          where: { action: 'admin_triggered_auto_promote_sweep' },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true, metadataJson: true },
        }),
        this.prisma.auditLog.findFirst({
          where: { action: 'derivative_auto_promoted' },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        }),
        this.prisma.auditLog.count({
          where: {
            action: 'derivative_auto_promoted',
            createdAt: { gte: since24h },
          },
        }),
        this.prisma.auditLog.count({
          where: { action: 'derivative_auto_promoted' },
        }),
      ]);

    const lastSweepAt = mostRecent(
      lastManualSweep?.createdAt ?? null,
      lastAutoPromotion?.createdAt ?? null,
    );

    const lastPromoted = readLastPromoted(lastManualSweep?.metadataJson);

    return {
      lastSweepAt: lastSweepAt ? lastSweepAt.toISOString() : null,
      lastPromoted,
      last24hPromoted,
      totalPromoted,
      configThreshold: this.configThreshold,
      configExcludedTypes: this.configExcludedTypes,
    };
  }

  private async findDocsMissingDerivative(
    derivativeType: BackfillMissingDerivativeType,
    limit: number,
  ): Promise<{ docs: Array<{ id: string }>; scanned: number }> {
    // Most-recent-first so a re-fire keeps catching freshly-ingested
    // documents before chewing through the whole backlog.
    const recent = await this.prisma.legalDocument.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (recent.length === 0) {
      return { docs: [], scanned: 0 };
    }

    const ids = recent.map((d) => d.id);
    const existing = await this.prisma.derivativeArtifact.findMany({
      where: {
        derivativeType,
        sourceDocumentId: { in: ids },
        deletedAt: null,
      },
      select: { sourceDocumentId: true },
    });
    const taken = new Set(
      existing
        .map((a) => a.sourceDocumentId)
        .filter((v): v is string => v !== null),
    );

    // Also exclude docs that already have a pending/running job for this
    // type — a re-fire shouldn't double-enqueue work the worker is about
    // to claim.
    const inFlight = await this.prisma.derivativeGenerationJob.findMany({
      where: {
        derivativeType,
        sourceDocumentId: { in: ids },
        status: { in: ['pending', 'dispatched', 'running', 'validating'] },
      },
      select: { sourceDocumentId: true },
    });
    for (const j of inFlight) {
      if (j.sourceDocumentId) taken.add(j.sourceDocumentId);
    }

    const docs = recent.filter((d) => !taken.has(d.id));
    return { docs, scanned: recent.length };
  }
}

function mostRecent(a: Date | null, b: Date | null): Date | null {
  if (a && b) return a.getTime() >= b.getTime() ? a : b;
  return a ?? b ?? null;
}

function readLastPromoted(metadata: unknown): number | null {
  if (
    metadata &&
    typeof metadata === 'object' &&
    !Array.isArray(metadata) &&
    'promoted' in metadata
  ) {
    const v = (metadata as Record<string, unknown>)['promoted'];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}
