import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

import { PrismaService } from '../../prisma/prisma.service';
import { EmbeddingClientService } from '../search/embedding-client.service';
import { OpenSearchService } from '../search/opensearch.service';
import {
  buildVectorEmbeddingInputs,
  joinSectionText,
  toVectorDocumentPayload,
  vectorDocumentId,
  type VectorEmbeddingInput,
  type VectorPayloadBase,
} from '../search/vector-embedding-inputs';
import {
  FAILURE_REASONS,
  SKIP_REASONS,
  VECTOR_BACKFILL_ACTIVE_STATES,
  VECTOR_BACKFILL_DEFAULT_BATCH_SIZE,
  VECTOR_BACKFILL_DEFAULT_DELAY_MS,
  VECTOR_BACKFILL_DOCUMENT_PAGE_SIZE,
  VECTOR_BACKFILL_JOB,
  VECTOR_BACKFILL_MAX_BATCH_SIZE,
  VECTOR_BACKFILL_MAX_DELAY_MS,
  VECTOR_BACKFILL_QUEUE,
  VECTOR_BACKFILL_REST_BUCKET,
  VECTOR_BACKFILL_TYPE_PRIORITY,
} from './vector-backfill.constants';

/** What the BullMQ job carries. Everything else is read from the run row. */
export interface VectorBackfillJobData {
  runId: string;
  triggeredByUserId?: string;
  organizationId?: string;
}

export interface VectorBackfillRunOptions {
  dryRun?: boolean;
  /** Restrict to these document types. Empty/omitted = full priority order. */
  documentTypes?: string[];
  batchSize?: number;
  batchDelayMs?: number;
  maxDocuments?: number;
  triggeredByUserId?: string;
  organizationId?: string;
}

/** One document's place in the run order. */
export interface OrderedDocument {
  documentId: string;
  documentType: string;
}

/** A document's measured shortfall against the vector index. */
export interface DocumentGap {
  documentId: string;
  documentType: string;
  /** Chunks this document should have. */
  expected: number;
  /** Chunks it is missing — the work. */
  missing: VectorEmbeddingInput[];
  base: VectorPayloadBase;
}

export interface GapByType {
  documents: number;
  documentsWithGap: number;
  expectedChunks: number;
  missingChunks: number;
}

export interface GapReport {
  documentsScanned: number;
  documentsWithGap: number;
  expectedChunks: number;
  missingChunks: number;
  byType: Record<string, GapByType>;
}

export interface VectorBackfillProgress {
  phase: 'enumerating' | 'embedding' | 'finalizing' | 'done';
  documentsTotal: number;
  documentsProcessed: number;
  documentsIndexed: number;
  documentsSkipped: number;
  documentsFailed: number;
  chunksTotal: number;
  chunksIndexed: number;
  chunksFailed: number;
  batchesCompleted: number;
  batchesFailed: number;
  message: string;
}

export interface VectorBackfillResult extends VectorBackfillProgress {
  runId: string;
  /** completed | paused | cancelled */
  status: string;
  gapByType: Record<string, GapByType>;
}

type ProgressReporter = (progress: VectorBackfillProgress) => Promise<void>;

/** A chunk waiting in the embedding buffer. */
interface PendingChunk {
  documentId: string;
  input: VectorEmbeddingInput;
  base: VectorPayloadBase;
}

/** Per-document tally, held until every one of its chunks has been flushed. */
interface DocumentTally {
  documentType: string;
  attempted: number;
  indexed: number;
  failed: number;
  /** Chunks still sitting in the buffer or in flight. */
  remaining: number;
  firstReason: string | null;
}

/** A finalized per-document outcome, buffered for a batched insert. */
interface DocumentStatusRow {
  runId: string;
  legalDocumentId: string;
  documentType: string;
  status: 'indexed' | 'skipped' | 'failed';
  reason: string | null;
  chunksAttempted: number;
  chunksIndexed: number;
  chunksFailed: number;
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Per-document status rows are written this many at a time. */
const STATUS_FLUSH_SIZE = 200;

/**
 * Fills the gap between what `legal_document_sections` says should be in the
 * OpenSearch vector index and what actually is.
 *
 * Three properties make this safe to run against production:
 *
 * 1. **It enumerates the gap, it does not re-embed the corpus.** Every
 *    candidate `_id` is diffed against the live index first, so a second run
 *    over a partially filled index does only the remainder.
 * 2. **Every write is an idempotent overwrite.** The vector `_id` is
 *    `section_id ?? document_id`, derived from the row's own identity, so
 *    running twice converges rather than duplicating.
 * 3. **It embeds by exactly the same rules as the live path.** Both call
 *    `buildVectorEmbeddingInputs`; see `vector-embedding-inputs.ts` for why a
 *    second set of rules would be worse than the gap it fixes.
 */
@Injectable()
export class VectorBackfillService {
  private readonly logger = new Logger(VectorBackfillService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly openSearch: OpenSearchService,
    private readonly embeddingClient: EmbeddingClientService,
    @InjectQueue(VECTOR_BACKFILL_QUEUE) private readonly queue: Queue,
  ) {}

  // ---------------------------------------------------------------------
  // Enqueue / control
  // ---------------------------------------------------------------------

  /**
   * Create a run row and enqueue its job.
   *
   * Refuses while another run is queued or running. Concurrency is already
   * pinned to 1 at the processor, but a second queued run would enumerate a gap
   * the first is actively closing and then report a stale picture, so the
   * refusal is about honest reporting as much as about load.
   */
  async enqueueRun(options: VectorBackfillRunOptions) {
    const active = await this.prisma.vectorBackfillRun.findFirst({
      where: { status: { in: [...VECTOR_BACKFILL_ACTIVE_STATES] } },
      orderBy: { createdAt: 'desc' },
    });
    if (active) {
      throw new BadRequestException(
        `Vector backfill run ${active.id} is already ${active.status}. ` +
          'Pause or cancel it before starting another.',
      );
    }

    const batchSize = this.normalizeBatchSize(options.batchSize);
    const batchDelayMs = this.normalizeDelay(options.batchDelayMs);
    const documentTypes = options.documentTypes ?? [];

    const run = await this.prisma.vectorBackfillRun.create({
      data: {
        status: 'queued',
        dryRun: options.dryRun === true,
        documentTypes,
        batchSize,
        batchDelayMs,
        maxDocuments: options.maxDocuments ?? null,
        triggeredByUserId: options.triggeredByUserId ?? null,
        organizationId: options.organizationId ?? null,
      },
    });

    const job = await this.queue.add(
      VECTOR_BACKFILL_JOB,
      {
        runId: run.id,
        triggeredByUserId: options.triggeredByUserId,
        organizationId: options.organizationId,
      } satisfies VectorBackfillJobData,
      { removeOnComplete: false, removeOnFail: false, attempts: 1 },
    );

    if (!job.id) {
      await this.prisma.vectorBackfillRun.update({
        where: { id: run.id },
        data: { status: 'failed', failureReason: 'Failed to enqueue job' },
      });
      throw new BadRequestException('Failed to enqueue vector backfill');
    }

    await this.prisma.vectorBackfillRun.update({
      where: { id: run.id },
      data: { jobId: job.id },
    });

    this.logger.log(
      `Enqueued vector backfill run ${run.id} (job ${job.id}, dryRun=${run.dryRun}, ` +
        `batchSize=${batchSize}, delayMs=${batchDelayMs}, ` +
        `types=${documentTypes.join(',') || 'all'})`,
    );

    return { ...run, jobId: job.id };
  }

  /**
   * Ask a running job to stop between batches.
   *
   * `pause` leaves the run in `paused` with its per-document rows intact;
   * `resume` starts a fresh run that re-enumerates and picks up the remainder.
   * The alternative — killing the worker — abandons a bulk write mid-flight and
   * loses the tally of what had already landed.
   */
  async signal(runId: string, signal: 'pause' | 'cancel') {
    const run = await this.prisma.vectorBackfillRun.findUnique({
      where: { id: runId },
    });
    if (!run) throw new NotFoundException(`Vector backfill run ${runId} not found`);
    if (!(VECTOR_BACKFILL_ACTIVE_STATES as readonly string[]).includes(run.status)) {
      throw new BadRequestException(
        `Run ${runId} is ${run.status}; only a queued or running job can be ${signal}led`,
      );
    }
    return this.prisma.vectorBackfillRun.update({
      where: { id: runId },
      data: { controlSignal: signal },
    });
  }

  /** Start a new run carrying the paused/cancelled run's options. */
  async resume(runId: string, actor: { userId?: string; organizationId?: string }) {
    const run = await this.prisma.vectorBackfillRun.findUnique({
      where: { id: runId },
    });
    if (!run) throw new NotFoundException(`Vector backfill run ${runId} not found`);
    if ((VECTOR_BACKFILL_ACTIVE_STATES as readonly string[]).includes(run.status)) {
      throw new BadRequestException(`Run ${runId} is still ${run.status}`);
    }
    return this.enqueueRun({
      dryRun: run.dryRun,
      documentTypes: run.documentTypes,
      batchSize: run.batchSize,
      batchDelayMs: run.batchDelayMs,
      maxDocuments: run.maxDocuments ?? undefined,
      triggeredByUserId: actor.userId,
      organizationId: actor.organizationId,
    });
  }

  async getRun(runId: string) {
    const run = await this.prisma.vectorBackfillRun.findUnique({
      where: { id: runId },
    });
    if (!run) throw new NotFoundException(`Vector backfill run ${runId} not found`);

    const job = run.jobId ? await this.queue.getJob(run.jobId) : null;
    return {
      ...run,
      jobState: job ? await job.getState() : null,
      jobFailedReason: job?.failedReason ?? null,
    };
  }

  /**
   * Mark a run failed after the processor caught an exception the run loop
   * could not absorb (a Postgres or OpenSearch outage, not a batch hiccup).
   * Without this the row would sit in `running` for ever and block every
   * subsequent enqueue.
   */
  async markRunFailed(runId: string, reason: string) {
    try {
      await this.prisma.vectorBackfillRun.update({
        where: { id: runId },
        data: {
          status: 'failed',
          controlSignal: null,
          finishedAt: new Date(),
          failureReason: reason.slice(0, 2000),
        },
      });
    } catch (err) {
      this.logger.error(
        `Could not mark run ${runId} failed: ${(err as Error).message}`,
      );
    }
  }

  async listRuns(limit = 20) {
    return this.prisma.vectorBackfillRun.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Per-document outcomes for a run. Cursor-based per CLAUDE.md — a full run
   * writes ~18k rows and an operator normally wants only the `failed` ones.
   */
  async listRunDocuments(
    runId: string,
    options: { status?: string; cursor?: string; limit?: number } = {},
  ) {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const rows = await this.prisma.vectorBackfillDocumentStatus.findMany({
      where: { runId, ...(options.status ? { status: options.status } : {}) },
      take: limit + 1,
      ...(options.cursor ? { skip: 1, cursor: { id: options.cursor } } : {}),
      orderBy: { id: 'asc' },
    });
    const hasNext = rows.length > limit;
    const items = hasNext ? rows.slice(0, limit) : rows;
    return {
      items,
      nextCursor: hasNext ? (items[items.length - 1]?.id ?? null) : null,
    };
  }

  // ---------------------------------------------------------------------
  // Gap enumeration
  // ---------------------------------------------------------------------

  /**
   * Documents in the order the backfill should touch them.
   *
   * Read in one query per phase and ordered in memory rather than paginated.
   * The corpus is ~18k documents of four small columns; keyset paging a recency
   * sort over a nullable `decision_date` would cost more complexity than the
   * memory it saves, and CLAUDE.md's no-OFFSET rule is satisfied either way
   * because there is no OFFSET.
   */
  async enumerateDocumentOrder(
    documentTypes: string[] = [],
  ): Promise<OrderedDocument[]> {
    const restricted = documentTypes.length > 0 ? new Set(documentTypes) : null;
    const priority = VECTOR_BACKFILL_TYPE_PRIORITY.filter(
      (type) => !restricted || restricted.has(type),
    );

    const select = {
      id: true,
      documentType: true,
      decisionDate: true,
      promulgationDate: true,
      createdAt: true,
    } as const;

    const ordered: OrderedDocument[] = [];

    // Phase 1 — the priority types, in the order they are listed. In prod this
    // is 24 documents and 7,685 chunks: on its own it closes the
    // statutory-retrieval hole, which is why the ordering is explicit rather
    // than "oldest first".
    if (priority.length > 0) {
      const rows = await this.prisma.legalDocument.findMany({
        where: { documentType: { in: [...priority] } },
        select,
      });
      const rank = new Map(priority.map((type, index) => [type as string, index]));
      rows.sort((a, b) => {
        const byType =
          (rank.get(a.documentType) ?? Number.MAX_SAFE_INTEGER) -
          (rank.get(b.documentType) ?? Number.MAX_SAFE_INTEGER);
        if (byType !== 0) return byType;
        return this.recencyKey(b) - this.recencyKey(a);
      });
      ordered.push(
        ...rows.map((r) => ({ documentId: r.id, documentType: r.documentType })),
      );
    }

    // Phase 2 — everything else (chiefly `decision`), most recent first. Stated
    // as "not in the priority list" rather than "type = decision" so a document
    // type nobody thought about is still reachable.
    const restTypes = restricted
      ? [...restricted].filter(
          (type) =>
            !(VECTOR_BACKFILL_TYPE_PRIORITY as readonly string[]).includes(type),
        )
      : null;
    if (!restTypes || restTypes.length > 0) {
      const rows = await this.prisma.legalDocument.findMany({
        where: restTypes
          ? { documentType: { in: restTypes } }
          : { documentType: { notIn: [...VECTOR_BACKFILL_TYPE_PRIORITY] } },
        select,
      });
      rows.sort((a, b) => this.recencyKey(b) - this.recencyKey(a));
      ordered.push(
        ...rows.map((r) => ({ documentId: r.id, documentType: r.documentType })),
      );
    }

    return ordered;
  }

  private recencyKey(row: {
    decisionDate: Date | null;
    promulgationDate: Date | null;
    createdAt: Date;
  }): number {
    return (row.decisionDate ?? row.promulgationDate ?? row.createdAt).getTime();
  }

  /**
   * The shortfall for one page of documents: which chunks each should have and
   * which of those the vector index does not hold.
   *
   * All candidate ids for the page go out in a single `findExistingVectorIds`
   * call — the diff is the cheap half of this job and should stay that way.
   */
  async computeGapForDocuments(documentIds: string[]): Promise<DocumentGap[]> {
    if (documentIds.length === 0) return [];

    const documents = await this.prisma.legalDocument.findMany({
      where: { id: { in: documentIds } },
      select: {
        id: true,
        title: true,
        citationText: true,
        documentType: true,
        court: true,
        isOfficial: true,
        isPublished: true,
        decisionDate: true,
        source: { select: { trustLevel: true } },
        sections: {
          select: { id: true, plainText: true },
          orderBy: { ordering: 'asc' },
        },
      },
    });

    const built = documents.map((doc) => {
      const inputs = buildVectorEmbeddingInputs(doc, joinSectionText(doc.sections));
      const base: VectorPayloadBase = {
        document_type: doc.documentType,
        court: doc.court ?? undefined,
        source_trust_level: doc.source?.trustLevel ?? undefined,
        is_official: doc.isOfficial,
        is_published: doc.isPublished,
        decision_date: doc.decisionDate?.toISOString() ?? undefined,
        title: doc.title,
        citation_text: doc.citationText ?? undefined,
      };
      return { doc, inputs, base };
    });

    const candidateIds = built.flatMap((entry) =>
      entry.inputs.map((input) => vectorDocumentId(input)),
    );
    const existing = await this.openSearch.findExistingVectorIds(candidateIds);

    // Preserve the caller's ordering: `findMany` does not guarantee it, and the
    // point of the priority order is that the valuable documents go first.
    const byId = new Map(built.map((entry) => [entry.doc.id, entry]));
    const gaps: DocumentGap[] = [];
    for (const documentId of documentIds) {
      const entry = byId.get(documentId);
      if (!entry) continue;
      gaps.push({
        documentId,
        documentType: entry.doc.documentType,
        expected: entry.inputs.length,
        missing: entry.inputs.filter(
          (input) => !existing.has(vectorDocumentId(input)),
        ),
        base: entry.base,
      });
    }
    return gaps;
  }

  /**
   * Measure the gap without embedding anything. This is the dry run, and also
   * the honest answer to "how bad is it?" that nothing could give before.
   */
  async enumerateGap(
    options: { documentTypes?: string[]; maxDocuments?: number } = {},
  ): Promise<GapReport> {
    const order = await this.enumerateDocumentOrder(options.documentTypes ?? []);
    const limited = this.applyMaxDocuments(order, options.maxDocuments);

    const report = this.emptyGapReport();
    for (let i = 0; i < limited.length; i += VECTOR_BACKFILL_DOCUMENT_PAGE_SIZE) {
      const page = limited.slice(i, i + VECTOR_BACKFILL_DOCUMENT_PAGE_SIZE);
      const gaps = await this.computeGapForDocuments(page.map((d) => d.documentId));
      for (const gap of gaps) this.accumulateGap(report, gap);
    }
    return report;
  }

  // ---------------------------------------------------------------------
  // The run
  // ---------------------------------------------------------------------

  /**
   * Execute a run. Called by the BullMQ processor; `report` streams progress
   * onto the job.
   *
   * Batch failures are recorded and stepped over, never thrown: a 4-hour run
   * that aborts on the first embedding-service hiccup would leave the corpus
   * exactly as broken as it found it, and would throw away the record of what
   * it had already fixed.
   */
  async runBackfill(
    data: VectorBackfillJobData,
    report: ProgressReporter,
  ): Promise<VectorBackfillResult> {
    const run = await this.prisma.vectorBackfillRun.findUnique({
      where: { id: data.runId },
    });
    if (!run) throw new NotFoundException(`Vector backfill run ${data.runId} not found`);

    const batchSize = this.normalizeBatchSize(run.batchSize);
    const batchDelayMs = this.normalizeDelay(run.batchDelayMs);

    const progress: VectorBackfillProgress = {
      phase: 'enumerating',
      documentsTotal: 0,
      documentsProcessed: 0,
      documentsIndexed: 0,
      documentsSkipped: 0,
      documentsFailed: 0,
      chunksTotal: 0,
      chunksIndexed: 0,
      chunksFailed: 0,
      batchesCompleted: 0,
      batchesFailed: 0,
      message: 'Enumerating documents',
    };
    const gapReport = this.emptyGapReport();

    await this.prisma.vectorBackfillRun.update({
      where: { id: run.id },
      data: {
        status: 'running',
        startedAt: new Date(),
        controlSignal: null,
        message: progress.message,
      },
    });
    await report(progress);

    const order = this.applyMaxDocuments(
      await this.enumerateDocumentOrder(run.documentTypes),
      run.maxDocuments ?? undefined,
    );
    progress.documentsTotal = order.length;
    progress.phase = 'embedding';

    // --- run-local state -------------------------------------------------
    const pending: PendingChunk[] = [];
    const tallies = new Map<string, DocumentTally>();
    const statusBuffer: DocumentStatusRow[] = [];
    // Held in an object rather than a bare `let` so TypeScript does not narrow
    // it to `null` in the outer scope — it is only ever assigned from inside
    // `flushBatch`.
    const control: { stop: 'pause' | 'cancel' | null } = { stop: null };

    const pushStatus = (row: DocumentStatusRow) => {
      statusBuffer.push(row);
      if (row.status === 'indexed') progress.documentsIndexed++;
      else if (row.status === 'skipped') progress.documentsSkipped++;
      else progress.documentsFailed++;
      progress.documentsProcessed++;
    };

    const finalizeTally = (documentId: string) => {
      const tally = tallies.get(documentId);
      if (!tally || tally.remaining > 0) return;
      tallies.delete(documentId);
      pushStatus({
        runId: run.id,
        legalDocumentId: documentId,
        documentType: tally.documentType,
        status: tally.failed > 0 ? 'failed' : 'indexed',
        reason: tally.failed > 0 ? tally.firstReason : null,
        chunksAttempted: tally.attempted,
        chunksIndexed: tally.indexed,
        chunksFailed: tally.failed,
      });
    };

    const flushStatuses = async (force = false) => {
      if (statusBuffer.length === 0) return;
      if (!force && statusBuffer.length < STATUS_FLUSH_SIZE) return;
      const rows = statusBuffer.splice(0, statusBuffer.length);
      await this.prisma.vectorBackfillDocumentStatus.createMany({
        data: rows,
        skipDuplicates: true,
      });
    };

    /**
     * Embed and index one batch. Every failure mode is caught here and
     * attributed to the documents that owned the chunks.
     */
    const flushBatch = async () => {
      const batch = pending.splice(0, batchSize);
      if (batch.length === 0) return;

      const chargeFailure = (chunks: PendingChunk[], reason: string) => {
        for (const chunk of chunks) {
          const tally = tallies.get(chunk.documentId);
          if (!tally) continue;
          tally.failed++;
          tally.remaining--;
          tally.firstReason ??= reason;
        }
        progress.chunksFailed += chunks.length;
      };

      let embeddings: number[][] | null = null;
      try {
        embeddings = await this.embeddingClient.embedBatch(
          batch.map((chunk) => chunk.input.text),
        );
      } catch (err) {
        embeddings = null;
        this.logger.warn(
          `Embedding call threw for run ${run.id}: ${(err as Error).message}`,
        );
      }

      if (!embeddings || embeddings.length !== batch.length) {
        progress.batchesFailed++;
        const reason =
          embeddings && embeddings.length !== batch.length
            ? `${FAILURE_REASONS.EMBEDDING_UNAVAILABLE} (got ${embeddings.length} for ${batch.length} texts)`
            : FAILURE_REASONS.EMBEDDING_UNAVAILABLE;
        chargeFailure(batch, reason);
      } else {
        const payloads = batch.map((chunk, idx) =>
          toVectorDocumentPayload(chunk.input, chunk.base, embeddings![idx]!),
        );
        try {
          const result = await this.openSearch.bulkIndexVectorDocuments(payloads);
          const failed = new Set(result.failedIds);
          for (const chunk of batch) {
            const tally = tallies.get(chunk.documentId);
            if (!tally) continue;
            tally.remaining--;
            if (failed.has(vectorDocumentId(chunk.input))) {
              tally.failed++;
              tally.firstReason ??= `${FAILURE_REASONS.BULK_INDEX_ERROR}: ${
                result.firstErrorReason ?? 'unknown'
              }`;
            } else {
              tally.indexed++;
            }
          }
          progress.chunksIndexed += result.indexed;
          progress.chunksFailed += result.errors;
          if (result.errors > 0) progress.batchesFailed++;
          else progress.batchesCompleted++;
        } catch (err) {
          progress.batchesFailed++;
          chargeFailure(
            batch,
            `${FAILURE_REASONS.BULK_INDEX_ERROR}: ${(err as Error).message}`,
          );
        }
      }

      for (const documentId of new Set(batch.map((c) => c.documentId))) {
        finalizeTally(documentId);
      }
      await flushStatuses();

      // One summary line per batch. The whole reason this PR exists is that the
      // old path produced no line at all.
      this.logger.log(
        `[vector-backfill ${run.id}] batch of ${batch.length}: ` +
          `chunks ${progress.chunksIndexed}/${progress.chunksTotal} indexed, ` +
          `${progress.chunksFailed} failed | docs ${progress.documentsProcessed}/${progress.documentsTotal} ` +
          `(${progress.documentsIndexed} indexed, ${progress.documentsSkipped} skipped, ` +
          `${progress.documentsFailed} failed) | batches ok=${progress.batchesCompleted} ` +
          `failed=${progress.batchesFailed}`,
      );

      progress.message =
        `${progress.chunksIndexed} chunks indexed, ${progress.chunksFailed} failed ` +
        `across ${progress.documentsProcessed}/${progress.documentsTotal} documents`;
      await report(progress);
      control.stop = await this.persistProgress(run.id, progress, gapReport);

      if (batchDelayMs > 0) await sleep(batchDelayMs);
    };

    // --- walk the corpus in priority order --------------------------------
    outer: for (
      let i = 0;
      i < order.length;
      i += VECTOR_BACKFILL_DOCUMENT_PAGE_SIZE
    ) {
      if (control.stop) break;

      const page = order.slice(i, i + VECTOR_BACKFILL_DOCUMENT_PAGE_SIZE);
      const gaps = await this.computeGapForDocuments(page.map((d) => d.documentId));

      for (const gap of gaps) {
        this.accumulateGap(gapReport, gap);

        if (gap.expected === 0) {
          pushStatus({
            runId: run.id,
            legalDocumentId: gap.documentId,
            documentType: gap.documentType,
            status: 'skipped',
            reason: SKIP_REASONS.NO_EMBEDDABLE_TEXT,
            chunksAttempted: 0,
            chunksIndexed: 0,
            chunksFailed: 0,
          });
          continue;
        }

        if (gap.missing.length === 0) {
          pushStatus({
            runId: run.id,
            legalDocumentId: gap.documentId,
            documentType: gap.documentType,
            status: 'skipped',
            reason: SKIP_REASONS.ALREADY_INDEXED,
            chunksAttempted: 0,
            chunksIndexed: 0,
            chunksFailed: 0,
          });
          continue;
        }

        if (run.dryRun) {
          // Counted, deliberately not embedded. `chunksAttempted` carries the
          // measured gap so a dry run's rows are a usable work estimate.
          progress.chunksTotal += gap.missing.length;
          pushStatus({
            runId: run.id,
            legalDocumentId: gap.documentId,
            documentType: gap.documentType,
            status: 'skipped',
            reason: SKIP_REASONS.DRY_RUN,
            chunksAttempted: gap.missing.length,
            chunksIndexed: 0,
            chunksFailed: 0,
          });
          continue;
        }

        progress.chunksTotal += gap.missing.length;
        tallies.set(gap.documentId, {
          documentType: gap.documentType,
          attempted: gap.missing.length,
          indexed: 0,
          failed: 0,
          remaining: gap.missing.length,
          firstReason: null,
        });
        for (const input of gap.missing) {
          pending.push({ documentId: gap.documentId, input, base: gap.base });
        }

        while (pending.length >= batchSize) {
          await flushBatch();
          if (control.stop) break outer;
        }
      }

      await flushStatuses();
      if (run.dryRun) {
        progress.message =
          `Dry run: ${gapReport.missingChunks} chunks missing across ` +
          `${gapReport.documentsWithGap} documents ` +
          `(${progress.documentsProcessed}/${progress.documentsTotal} scanned)`;
        await report(progress);
        control.stop = await this.persistProgress(run.id, progress, gapReport);
      }
    }

    // --- drain ------------------------------------------------------------
    progress.phase = 'finalizing';
    if (!control.stop) {
      while (pending.length > 0) {
        await flushBatch();
        if (control.stop) break;
      }
    }

    // A pause or cancel leaves chunks in the buffer. Their documents are
    // recorded as failed-with-reason rather than silently dropped — the next
    // run re-enumerates and picks them up, and meanwhile the row says why this
    // run did not finish them.
    if (pending.length > 0) {
      const abandoned = new Set(pending.map((chunk) => chunk.documentId));
      for (const documentId of abandoned) {
        const tally = tallies.get(documentId);
        if (!tally) continue;
        tally.firstReason ??= `run ${control.stop ?? 'stopped'} before these chunks were embedded`;
        tally.failed += tally.remaining;
        tally.remaining = 0;
        finalizeTally(documentId);
      }
      pending.length = 0;
    }
    await flushStatuses(true);

    const status =
      control.stop === 'cancel'
        ? 'cancelled'
        : control.stop === 'pause'
          ? 'paused'
          : 'completed';
    progress.phase = 'done';
    progress.message = this.summarize(status, progress, gapReport, run.dryRun);

    await this.prisma.vectorBackfillRun.update({
      where: { id: run.id },
      data: {
        status,
        controlSignal: null,
        finishedAt: new Date(),
        lastProgressAt: new Date(),
        message: progress.message,
        gapByType: gapReport.byType as unknown as object,
        ...this.progressColumns(progress),
      },
    });
    await report(progress);

    this.logger.log(`[vector-backfill ${run.id}] ${progress.message}`);

    return {
      ...progress,
      runId: run.id,
      status,
      gapByType: gapReport.byType,
    };
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  /**
   * Write progress and read back the operator's control signal in one round
   * trip. Called once per batch (~13s at the measured 4.8 texts/s), which is
   * how a pause is honoured promptly without polling Redis.
   */
  private async persistProgress(
    runId: string,
    progress: VectorBackfillProgress,
    gapReport: GapReport,
  ): Promise<'pause' | 'cancel' | null> {
    try {
      const updated = await this.prisma.vectorBackfillRun.update({
        where: { id: runId },
        data: {
          ...this.progressColumns(progress),
          message: progress.message,
          gapByType: gapReport.byType as unknown as object,
          lastProgressAt: new Date(),
        },
        select: { controlSignal: true },
      });
      if (updated.controlSignal === 'pause') return 'pause';
      if (updated.controlSignal === 'cancel') return 'cancel';
      return null;
    } catch (err) {
      // Bookkeeping must never take down the work it is bookkeeping for.
      this.logger.warn(
        `Failed to persist progress for run ${runId}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  private progressColumns(progress: VectorBackfillProgress) {
    return {
      documentsTotal: progress.documentsTotal,
      documentsProcessed: progress.documentsProcessed,
      documentsIndexed: progress.documentsIndexed,
      documentsSkipped: progress.documentsSkipped,
      documentsFailed: progress.documentsFailed,
      chunksTotal: progress.chunksTotal,
      chunksIndexed: progress.chunksIndexed,
      chunksFailed: progress.chunksFailed,
      batchesCompleted: progress.batchesCompleted,
      batchesFailed: progress.batchesFailed,
    };
  }

  private summarize(
    status: string,
    progress: VectorBackfillProgress,
    gapReport: GapReport,
    dryRun: boolean,
  ): string {
    if (dryRun) {
      const byType = Object.entries(gapReport.byType)
        .filter(([, entry]) => entry.missingChunks > 0)
        .sort((a, b) => b[1].missingChunks - a[1].missingChunks)
        .map(([type, entry]) => `${type}=${entry.missingChunks}`)
        .join(', ');
      return (
        `Dry run ${status}: ${gapReport.missingChunks} chunks missing across ` +
        `${gapReport.documentsWithGap} of ${gapReport.documentsScanned} documents` +
        (byType ? ` (${byType})` : '')
      );
    }
    return (
      `Run ${status}: ${progress.chunksIndexed} chunks indexed, ` +
      `${progress.chunksFailed} failed; documents ${progress.documentsIndexed} indexed, ` +
      `${progress.documentsSkipped} skipped, ${progress.documentsFailed} failed ` +
      `of ${progress.documentsTotal}`
    );
  }

  private emptyGapReport(): GapReport {
    return {
      documentsScanned: 0,
      documentsWithGap: 0,
      expectedChunks: 0,
      missingChunks: 0,
      byType: {},
    };
  }

  private accumulateGap(report: GapReport, gap: DocumentGap) {
    const bucket = gap.documentType || VECTOR_BACKFILL_REST_BUCKET;

    report.byType[bucket] ??= {
      documents: 0,
      documentsWithGap: 0,
      expectedChunks: 0,
      missingChunks: 0,
    };
    const entry = report.byType[bucket]!;

    report.documentsScanned++;
    report.expectedChunks += gap.expected;
    report.missingChunks += gap.missing.length;
    entry.documents++;
    entry.expectedChunks += gap.expected;
    entry.missingChunks += gap.missing.length;
    if (gap.missing.length > 0) {
      report.documentsWithGap++;
      entry.documentsWithGap++;
    }
  }

  private applyMaxDocuments(
    order: OrderedDocument[],
    maxDocuments?: number,
  ): OrderedDocument[] {
    return maxDocuments && maxDocuments > 0 ? order.slice(0, maxDocuments) : order;
  }

  private normalizeBatchSize(value?: number): number {
    if (!value || !Number.isFinite(value)) return VECTOR_BACKFILL_DEFAULT_BATCH_SIZE;
    return Math.min(Math.max(Math.trunc(value), 1), VECTOR_BACKFILL_MAX_BATCH_SIZE);
  }

  private normalizeDelay(value?: number): number {
    if (value === undefined || value === null || !Number.isFinite(value)) {
      return VECTOR_BACKFILL_DEFAULT_DELAY_MS;
    }
    return Math.min(Math.max(Math.trunc(value), 0), VECTOR_BACKFILL_MAX_DELAY_MS);
  }
}
