import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CeleryDispatcherService } from '../../common/services/celery-dispatcher.service';
import { RedisService } from '../../common/services/redis.service';
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

const CITATIONS_PLAN_CACHE_KEY = 'cache:admin:citations-backfill-plan';
const DERIVATIVES_PLAN_CACHE_KEY = 'cache:admin:missing-derivatives-plan';
const PLAN_CACHE_TTL_SECONDS = 60;

// Citations-per-doc estimates derived from the LawPhil corpus where the
// extractor's average yield clusters around 10–25 unique citations per
// case. Used only for the operator preview range.
const CITATIONS_PER_DOC_LOW = 10;
const CITATIONS_PER_DOC_HIGH = 25;

// Citation extraction is mostly DB write — the LLM-free pipeline averages
// well under half a second per doc on the dev cluster. 0.4s is the
// conservative end of that range.
const SECONDS_PER_CITATION_DOC = 0.4;

// Per-call cost for the cheapest derivative-generation model in the mix.
// The plan endpoint multiplies this by missingCount as a worst-case;
// actual spend depends on which model the per-type policy resolves to.
const DERIVATIVE_COST_PER_CALL_USD = 0.0003;
const SECONDS_PER_DERIVATIVE_DOC = 0.4;

const IN_FLIGHT_DERIVATIVE_STATUSES = [
  'pending',
  'dispatched',
  'running',
  'validating',
] as const;

export interface BackfillCitationsResult {
  taskId: string;
  dispatchedAt: string;
  limit: number | null;
}

export interface CitationsBackfillPlan {
  totalCorpusDocs: number;
  docsAlreadyHaveCitations: number;
  docsPending: number;
  estimatedNewCitationsRange: { low: number; high: number };
  estimatedMinutes: number;
  lastBackfillAt: string | null;
  lastBackfillDispatchedBy: string | null;
}

export interface MissingDerivativesPlanType {
  type: BackfillMissingDerivativeType;
  missingCount: number;
  costPerCallUsd: number;
  estimatedCostUsd: number;
  estimatedMinutes: number;
}

export interface MissingDerivativesPlan {
  perType: MissingDerivativesPlanType[];
  totals: {
    totalMissing: number;
    totalEstimatedCostUsd: number;
    totalEstimatedMinutes: number;
    lastBackfillAt: string | null;
    lastBackfillDispatchedBy: string | null;
  };
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
    private readonly redis: RedisService,
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
   * Read-only operator preview for citations backfill. Counts total corpus
   * docs, distinct fromDocumentId in `citations` (≈ docs that have already
   * been extracted), and the resulting pending count. 60s Redis cache so
   * a dialog open doesn't hammer the DB on every refresh.
   */
  async getCitationsBackfillPlan(): Promise<CitationsBackfillPlan> {
    const cached = await this.tryReadCache<CitationsBackfillPlan>(
      CITATIONS_PLAN_CACHE_KEY,
    );
    if (cached) return cached;

    const [totalCorpusDocs, alreadyExtracted, lastAudit] = await Promise.all([
      this.prisma.legalDocument.count(),
      // groupBy on a single column gives one row per distinct value; .length
      // is the distinct-count we want without pulling every citation row.
      this.prisma.citation.groupBy({ by: ['fromDocumentId'] }),
      this.prisma.auditLog.findFirst({
        where: { action: 'admin_dispatched_citation_backfill' },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, actorUserId: true },
      }),
    ]);

    const docsAlreadyHaveCitations = alreadyExtracted.length;
    const docsPending = Math.max(
      0,
      totalCorpusDocs - docsAlreadyHaveCitations,
    );
    const estimatedMinutes = Math.ceil(
      (docsPending * SECONDS_PER_CITATION_DOC) / 60,
    );

    const plan: CitationsBackfillPlan = {
      totalCorpusDocs,
      docsAlreadyHaveCitations,
      docsPending,
      estimatedNewCitationsRange: {
        low: docsPending * CITATIONS_PER_DOC_LOW,
        high: docsPending * CITATIONS_PER_DOC_HIGH,
      },
      estimatedMinutes,
      lastBackfillAt: lastAudit?.createdAt
        ? lastAudit.createdAt.toISOString()
        : null,
      lastBackfillDispatchedBy: lastAudit?.actorUserId ?? null,
    };

    await this.writeCache(CITATIONS_PLAN_CACHE_KEY, plan);
    return plan;
  }

  /**
   * Read-only operator preview for missing-derivatives backfill. Counts,
   * per type, legal_documents with no live artifact and no in-flight job
   * — i.e. docs the dispatcher would actually pick up. 60s Redis cache.
   */
  async getMissingDerivativesPlan(): Promise<MissingDerivativesPlan> {
    const cached = await this.tryReadCache<MissingDerivativesPlan>(
      DERIVATIVES_PLAN_CACHE_KEY,
    );
    if (cached) return cached;

    const totalCorpusDocs = await this.prisma.legalDocument.count();

    const perType: MissingDerivativesPlanType[] = [];
    for (const type of BACKFILL_MISSING_DERIVATIVE_TYPES) {
      const missingCount = await this.countDocsMissingDerivativeAcrossCorpus(
        type,
        totalCorpusDocs,
      );
      perType.push({
        type,
        missingCount,
        costPerCallUsd: DERIVATIVE_COST_PER_CALL_USD,
        estimatedCostUsd: missingCount * DERIVATIVE_COST_PER_CALL_USD,
        estimatedMinutes: Math.ceil(
          (missingCount * SECONDS_PER_DERIVATIVE_DOC) / 60,
        ),
      });
    }

    const totalMissing = perType.reduce((s, r) => s + r.missingCount, 0);
    const totalEstimatedCostUsd = perType.reduce(
      (s, r) => s + r.estimatedCostUsd,
      0,
    );
    const totalEstimatedMinutes = Math.ceil(
      (totalMissing * SECONDS_PER_DERIVATIVE_DOC) / 60,
    );

    const lastAudit = await this.prisma.auditLog.findFirst({
      where: { action: 'admin_dispatched_missing_derivatives_backfill' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, actorUserId: true },
    });

    const plan: MissingDerivativesPlan = {
      perType,
      totals: {
        totalMissing,
        totalEstimatedCostUsd,
        totalEstimatedMinutes,
        lastBackfillAt: lastAudit?.createdAt
          ? lastAudit.createdAt.toISOString()
          : null,
        lastBackfillDispatchedBy: lastAudit?.actorUserId ?? null,
      },
    };

    await this.writeCache(DERIVATIVES_PLAN_CACHE_KEY, plan);
    return plan;
  }

  /**
   * For each entry in perTypeLimits, find legal_documents that have no
   * derivative_artifact for that type (deletedAt IS NULL) and INSERT a
   * pending derivative_generation_jobs row per doc. Per-type limits let
   * the operator prioritize (e.g. essays 500, mcqs 100). Skip count
   * tracks docs that already had an artifact and were not enqueued.
   */
  async backfillMissingDerivatives(
    perTypeLimits: ReadonlyArray<{
      type: BackfillMissingDerivativeType;
      limit: number;
    }>,
    triggeredByUserId: string,
  ): Promise<BackfillMissingDerivativesResult> {
    const dispatchedByType = Object.fromEntries(
      BACKFILL_MISSING_DERIVATIVE_TYPES.map((t) => [t, 0]),
    ) as Record<BackfillMissingDerivativeType, number>;

    let totalDispatched = 0;
    let totalSkipped = 0;

    for (const { type: derivativeType, limit } of perTypeLimits) {
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

  /**
   * Total docs in the corpus that have neither a live artifact of this
   * type nor an in-flight job for it. Two cheap lookups + a Set diff
   * keeps this Prisma-DSL only (no raw SQL).
   */
  private async countDocsMissingDerivativeAcrossCorpus(
    derivativeType: BackfillMissingDerivativeType,
    totalCorpusDocs: number,
  ): Promise<number> {
    if (totalCorpusDocs === 0) return 0;

    const [withArtifact, inFlight] = await Promise.all([
      this.prisma.derivativeArtifact.findMany({
        where: {
          derivativeType,
          deletedAt: null,
          sourceDocumentId: { not: null },
        },
        select: { sourceDocumentId: true },
        distinct: ['sourceDocumentId'],
      }),
      this.prisma.derivativeGenerationJob.findMany({
        where: {
          derivativeType,
          status: { in: [...IN_FLIGHT_DERIVATIVE_STATUSES] },
          sourceDocumentId: { not: null },
        },
        select: { sourceDocumentId: true },
        distinct: ['sourceDocumentId'],
      }),
    ]);

    const taken = new Set<string>();
    for (const row of withArtifact) {
      if (row.sourceDocumentId) taken.add(row.sourceDocumentId);
    }
    for (const row of inFlight) {
      if (row.sourceDocumentId) taken.add(row.sourceDocumentId);
    }

    return Math.max(0, totalCorpusDocs - taken.size);
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
        status: { in: [...IN_FLIGHT_DERIVATIVE_STATUSES] },
      },
      select: { sourceDocumentId: true },
    });
    for (const j of inFlight) {
      if (j.sourceDocumentId) taken.add(j.sourceDocumentId);
    }

    const docs = recent.filter((d) => !taken.has(d.id));
    return { docs, scanned: recent.length };
  }

  private async tryReadCache<T>(key: string): Promise<T | null> {
    const cached = await this.redis.get(key);
    if (!cached) return null;
    try {
      return JSON.parse(cached) as T;
    } catch (err) {
      this.logger.warn(
        `Discarding malformed cache entry at ${key}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  private async writeCache(key: string, value: unknown): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(value), PLAN_CACHE_TTL_SECONDS);
    } catch (err) {
      this.logger.warn(
        `Failed to write plan cache at ${key}: ${(err as Error).message}`,
      );
    }
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

export { DEFAULT_BACKFILL_LIMIT };
