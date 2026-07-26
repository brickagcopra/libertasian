import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

import { PrismaService } from '../../prisma/prisma.service';
import { extractSearchableText } from './derivative-extract';
import {
  DERIVATIVES_INDEX,
  DERIVATIVES_INDEX_PHYSICAL,
  INDEX_TOPOLOGY,
  KEYWORD_INDEX,
  KEYWORD_INDEX_PHYSICAL,
  USER_UPLOADS_INDEX,
  USER_UPLOADS_INDEX_PHYSICAL,
  VECTOR_INDEX,
  VECTOR_INDEX_PHYSICAL,
} from './index-mappings';
import {
  OpenSearchService,
  type DerivativeDocumentPayload,
  type IndexDocumentPayload,
} from './opensearch.service';

export const INDEX_REBUILD_QUEUE = 'search-index-rebuild';

/** Per CLAUDE.md: bulk indexing batch size 500. */
const REINDEX_BATCH_SIZE = 500;

/** Per CLAUDE.md: relax refresh to 30s during bulk ingestion, then restore. */
const BULK_REFRESH_INTERVAL = '30s';
/** The steady-state value declared in BASE_SETTINGS; restored after bulk. */
const STEADY_REFRESH_INTERVAL = '5s';

/**
 * The verified doc count must land within this fraction of the count we
 * actually pushed. Anything worse aborts BEFORE the destructive alias swap.
 */
const VERIFY_TOLERANCE = 0.01;

export interface IndexRebuildJobData {
  triggeredByUserId: string;
  organizationId: string;
  /** Skip the alias swap and leave the freshly built index unattached. */
  dryRun: boolean;
}

/**
 * Outcome of a server-side index copy, derived from `_count` on both sides —
 * never from the `_reindex` response, which reported `created: 0` in production
 * for copies that in fact moved every document.
 *
 * The distinction that matters operationally is between `source_missing`
 * (nothing to copy, destination legitimately empty) and `failed`/`mismatch`
 * (documents were lost). Both used to surface as the number 0.
 */
export type IndexCopyStatus = 'verified' | 'source_missing' | 'mismatch' | 'failed';

export interface IndexCopyOutcome {
  source: string;
  dest: string;
  status: IndexCopyStatus;
  sourceCount: number;
  destCount: number;
  /** What `_reindex` claimed. Recorded for diagnosis; not used for any decision. */
  reportedCreated: number | null;
  error?: string;
}

export interface IndexRebuildProgress {
  phase:
    | 'starting'
    | 'creating_indices'
    | 'reindexing_documents'
    | 'reindexing_vectors'
    | 'reindexing_uploads'
    | 'reindexing_derivatives'
    | 'verifying'
    | 'swapping_alias'
    | 'completed'
    | 'aborted';
  documentsProcessed: number;
  documentsTotal: number;
  docsPushed: number;
  /** Verified destination count — what `_count` says landed, not what `_reindex` claimed. */
  vectorsCopied: number;
  uploadsCopied: number;
  /** Derivative rows read out of PostgreSQL so far. */
  derivativesProcessed: number;
  /** Non-deleted `derivative_artifacts` rows in PostgreSQL — the source floor. */
  derivativesTotal: number;
  /** Derivative documents accepted by `_bulk`. */
  derivativesPushed: number;
  vectorCopy: IndexCopyOutcome | null;
  uploadCopy: IndexCopyOutcome | null;
  /** Measured source/dest reconciliation for the derivatives index. */
  derivativeCopy: IndexCopyOutcome | null;
  message: string;
}

export interface IndexRebuildResult extends IndexRebuildProgress {
  keywordTarget: string;
  vectorTarget: string;
  uploadsTarget: string;
  derivativesTarget: string;
  verifiedCount: number;
  /** True when the KEYWORD alias was repointed. */
  aliasSwapped: boolean;
  /**
   * Aliases deliberately left on their previous target because the copy behind
   * them could not be verified. Empty on a clean run.
   */
  aliasesSkipped: string[];
}

type ProgressReporter = (progress: IndexRebuildProgress) => Promise<void>;

/**
 * Rebuilds the OpenSearch projection from PostgreSQL (the system of record,
 * CLAUDE.md rule 4) into freshly created, explicitly mapped physical indices,
 * then flips the aliases.
 *
 * The ordering is the whole point of this class and is asserted by tests:
 *
 *   create → reindex → refresh → verify count → THEN swap/delete
 *
 * Nothing is ever deleted before the verification passes. If the count check
 * fails the job aborts with the new index left in place for inspection and the
 * old one still serving traffic.
 */
@Injectable()
export class IndexRebuildService {
  private readonly logger = new Logger(IndexRebuildService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly openSearch: OpenSearchService,
    private readonly config: ConfigService,
    @InjectQueue(INDEX_REBUILD_QUEUE) private readonly queue: Queue,
  ) {}

  async enqueueRebuild(data: IndexRebuildJobData): Promise<{ jobId: string }> {
    const job = await this.queue.add('rebuild', data, {
      removeOnComplete: false,
      removeOnFail: false,
      attempts: 1,
    });
    if (!job.id) {
      throw new BadRequestException('Failed to enqueue index rebuild');
    }
    return { jobId: job.id };
  }

  async getJobStatus(jobId: string): Promise<{
    jobId: string;
    state: string;
    progress: IndexRebuildProgress | null;
    result: IndexRebuildResult | null;
    failedReason: string | null;
  }> {
    const job = await this.queue.getJob(jobId);
    if (!job) {
      throw new BadRequestException(`Rebuild job ${jobId} not found`);
    }
    const progress = job.progress;
    return {
      jobId,
      state: await job.getState(),
      progress:
        typeof progress === 'object' && progress !== null
          ? (progress as unknown as IndexRebuildProgress)
          : null,
      result: (job.returnvalue as IndexRebuildResult | undefined) ?? null,
      failedReason: job.failedReason ?? null,
    };
  }

  /**
   * Repoint an alias at an existing physical index.
   *
   * Note: the *first* migration deletes the legacy concrete index (it occupies
   * the alias name, so it cannot coexist with the alias). Rollback is therefore
   * only meaningful once at least two physical versions exist — e.g. after a
   * future v2 → v3 rebuild. The caller must name the target explicitly.
   */
  async rollbackAlias(alias: string, targetIndex: string): Promise<{
    alias: string;
    previousTargets: string[];
    target: string;
  }> {
    const known = INDEX_TOPOLOGY.map((entry) => entry.alias);
    if (!known.includes(alias)) {
      throw new BadRequestException(`Unknown search alias: ${alias}`);
    }
    if (!(await this.openSearch.indexExists(targetIndex))) {
      throw new BadRequestException(
        `Cannot roll back: physical index ${targetIndex} does not exist`,
      );
    }
    if (await this.openSearch.aliasExists(targetIndex)) {
      throw new BadRequestException(
        `${targetIndex} is an alias, not a physical index — refusing to roll back onto it`,
      );
    }

    const previousTargets = await this.openSearch.resolveAliasTargets(alias);
    await this.openSearch.swapAlias({
      alias,
      target: targetIndex,
      detachFrom: previousTargets.filter((name) => name !== targetIndex),
    });
    this.logger.warn(
      `Rolled back alias ${alias}: [${previousTargets.join(', ')}] → ${targetIndex}`,
    );
    return { alias, previousTargets, target: targetIndex };
  }

  /** List physical indices behind each alias so an operator can pick a rollback target. */
  async describeTopology(): Promise<
    { alias: string; expectedPhysical: string; currentTargets: string[]; isAlias: boolean }[]
  > {
    const rows = [];
    for (const entry of INDEX_TOPOLOGY) {
      rows.push({
        alias: entry.alias,
        expectedPhysical: entry.physical,
        currentTargets: await this.openSearch.resolveAliasTargets(entry.alias),
        isAlias: await this.openSearch.aliasExists(entry.alias),
      });
    }
    return rows;
  }

  /**
   * The actual rebuild. Called by the BullMQ processor; `report` streams
   * progress back onto the job.
   */
  async runRebuild(
    data: IndexRebuildJobData,
    report: ProgressReporter,
  ): Promise<IndexRebuildResult> {
    const state: IndexRebuildProgress = {
      phase: 'starting',
      documentsProcessed: 0,
      documentsTotal: 0,
      docsPushed: 0,
      vectorsCopied: 0,
      uploadsCopied: 0,
      derivativesProcessed: 0,
      derivativesTotal: 0,
      derivativesPushed: 0,
      vectorCopy: null,
      uploadCopy: null,
      derivativeCopy: null,
      message: 'Preparing rebuild',
    };
    const push = async (patch: Partial<IndexRebuildProgress>) => {
      Object.assign(state, patch);
      await report({ ...state });
    };

    const keywordTarget = await this.allocateTargetIndex(
      KEYWORD_INDEX,
      KEYWORD_INDEX_PHYSICAL,
    );
    const vectorTarget = await this.allocateTargetIndex(
      VECTOR_INDEX,
      VECTOR_INDEX_PHYSICAL,
    );
    const uploadsTarget = await this.allocateTargetIndex(
      USER_UPLOADS_INDEX,
      USER_UPLOADS_INDEX_PHYSICAL,
    );
    const derivativesTarget = await this.allocateTargetIndex(
      DERIVATIVES_INDEX,
      DERIVATIVES_INDEX_PHYSICAL,
    );

    // ---- 1. create the new physical indices with explicit mappings ----
    await push({ phase: 'creating_indices', message: `Creating ${keywordTarget}` });
    const dimension = this.openSearch.embeddingDimension;
    for (const [target, entry] of [
      [keywordTarget, INDEX_TOPOLOGY[0]!],
      [vectorTarget, INDEX_TOPOLOGY[1]!],
      [uploadsTarget, INDEX_TOPOLOGY[2]!],
      [derivativesTarget, INDEX_TOPOLOGY[3]!],
    ] as const) {
      await this.openSearch.createPhysicalIndex(target, entry.buildMapping(dimension));
    }

    // ---- 2. reindex the keyword index from PostgreSQL ----
    const documentsTotal = await this.prisma.legalDocument.count();
    await push({
      phase: 'reindexing_documents',
      documentsTotal,
      message: `Reindexing ${documentsTotal} documents from PostgreSQL`,
    });

    const pushed = await this.reindexKeywordFromPostgres(keywordTarget, async (processed, docs) => {
      await push({
        documentsProcessed: processed,
        docsPushed: docs,
        message: `Reindexed ${processed}/${documentsTotal} documents`,
      });
    });

    // ---- 3. copy the vector + upload indices server-side ----
    // Embeddings cost real GPU/CPU time to regenerate and OCR text is not
    // reproducible at all, so these are copied rather than rebuilt.
    await push({ phase: 'reindexing_vectors', message: 'Copying vector index' });
    const vectorCopy = await this.copyAndVerify(VECTOR_INDEX, vectorTarget);
    await push({
      vectorsCopied: vectorCopy.destCount,
      vectorCopy,
      message: `Vector copy ${vectorCopy.status}: ${vectorCopy.destCount}/${vectorCopy.sourceCount}`,
    });

    await push({ phase: 'reindexing_uploads', message: 'Copying user uploads index' });
    const uploadCopy = await this.copyAndVerify(USER_UPLOADS_INDEX, uploadsTarget);
    await push({
      uploadsCopied: uploadCopy.destCount,
      uploadCopy,
      message: `Upload copy ${uploadCopy.status}: ${uploadCopy.destCount}/${uploadCopy.sourceCount}`,
    });

    // ---- 3b. build the derivatives index from PostgreSQL ----
    // Unlike vectors/uploads this is a rebuild, not a copy: `content_json` is
    // the system of record and the extractor is pure, so the index is fully
    // reproducible. It runs LAST so a derivative failure cannot delay or
    // destabilise the keyword index, which is the one that fixes search.
    const derivativesTotal = await this.prisma.derivativeArtifact.count({
      where: { deletedAt: null },
    });
    await push({
      phase: 'reindexing_derivatives',
      derivativesTotal,
      message: `Indexing ${derivativesTotal} derivative artifacts from PostgreSQL`,
    });

    const derivativeCopy = await this.indexDerivativesFromPostgres(
      derivativesTarget,
      derivativesTotal,
      async (processed, pushedDerivatives) => {
        await push({
          derivativesProcessed: processed,
          derivativesPushed: pushedDerivatives,
          message: `Indexed ${processed}/${derivativesTotal} derivative artifacts`,
        });
      },
    );
    await push({
      derivativeCopy,
      derivativesPushed: derivativeCopy.reportedCreated ?? 0,
      message:
        `Derivative index ${derivativeCopy.status}: ` +
        `${derivativeCopy.destCount}/${derivativeCopy.sourceCount}`,
    });

    // ---- 4. verify BEFORE anything destructive happens ----
    await push({ phase: 'verifying', message: 'Verifying document counts' });
    await this.openSearch.refreshIndex(keywordTarget);
    const verifiedCount = await this.openSearch.countIndex(keywordTarget);

    // Gate 1 — SOURCE-derived floor. Every legal document contributes at least
    // its document-level entry, so the pushed count can never legitimately fall
    // below the PostgreSQL row count. This is the check that catches a bulk
    // pass silently dropping payloads: gate 2 alone is self-referential
    // (`pushed` and `verifiedCount` happily agree at a low number) and would
    // let the alias swap land on a thin index.
    if (pushed < documentsTotal) {
      await push({
        phase: 'aborted',
        message:
          `Verification failed: pushed ${pushed} entries for ${documentsTotal} ` +
          `source documents — expected at least one entry per document`,
      });
      throw new Error(
        `Index rebuild aborted before alias swap — only ${pushed} entries were ` +
          `indexed for ${documentsTotal} PostgreSQL documents. Every document ` +
          `contributes at least one entry, so payloads were dropped during bulk ` +
          `indexing. The previous index is untouched and still serving traffic.`,
      );
    }

    // Gate 2 — round-trip check: what we pushed actually landed in OpenSearch.
    const minAcceptable = Math.floor(pushed * (1 - VERIFY_TOLERANCE));
    if (pushed === 0 || verifiedCount < minAcceptable) {
      await push({
        phase: 'aborted',
        message: `Verification failed: ${keywordTarget} holds ${verifiedCount} docs, expected >= ${minAcceptable}`,
      });
      throw new Error(
        `Index rebuild aborted before alias swap — ${keywordTarget} holds ${verifiedCount} ` +
          `documents but ${pushed} were pushed (tolerance ${VERIFY_TOLERANCE * 100}%). ` +
          `The previous index is untouched and still serving traffic.`,
      );
    }

    if (data.dryRun) {
      await push({
        phase: 'completed',
        message: `Dry run complete — ${keywordTarget} built and verified but not aliased`,
      });
      return {
        ...state,
        keywordTarget,
        vectorTarget,
        uploadsTarget,
        derivativesTarget,
        verifiedCount,
        aliasSwapped: false,
        aliasesSkipped: [],
      };
    }

    // ---- 5. swap aliases (this is the only destructive step) ----
    await push({ phase: 'swapping_alias', message: 'Swapping aliases' });
    await this.swapOne(KEYWORD_INDEX, keywordTarget);

    // A copied index only takes traffic once its copy has been verified.
    // Otherwise the alias stays on its previous target: a stale vector index
    // still answers kNN queries, an empty one silently answers none.
    const aliasesSkipped: string[] = [];
    for (const [alias, target, copy] of [
      [VECTOR_INDEX, vectorTarget, vectorCopy],
      [USER_UPLOADS_INDEX, uploadsTarget, uploadCopy],
      [DERIVATIVES_INDEX, derivativesTarget, derivativeCopy],
    ] as const) {
      if (copy.status === 'verified' || copy.status === 'source_missing') {
        await this.swapOne(alias, target);
        continue;
      }
      aliasesSkipped.push(alias);
      this.logger.error(
        `Leaving alias ${alias} on its previous target — copy into ${target} ` +
          `was not verified (${copy.status}: ${copy.destCount}/${copy.sourceCount}). ` +
          `${target} is left in place for inspection.`,
      );
    }

    await push({
      phase: 'completed',
      message:
        `Rebuild complete — ${KEYWORD_INDEX} → ${keywordTarget} (${verifiedCount} docs)` +
        (aliasesSkipped.length > 0
          ? `; UNVERIFIED copies left unswapped: ${aliasesSkipped.join(', ')}`
          : ''),
    });

    return {
      ...state,
      keywordTarget,
      vectorTarget,
      uploadsTarget,
      derivativesTarget,
      verifiedCount,
      aliasSwapped: true,
      aliasesSkipped,
    };
  }

  /**
   * Pick a free physical index name. Normally `<alias>_v2`; if that name is
   * already the live alias target we cannot rebuild into it in place, so fall
   * back to `<alias>_v2_r1`, `_r2`, … This keeps every rebuild blue/green and
   * leaves the previous physical index intact as a rollback target.
   */
  private async allocateTargetIndex(alias: string, preferred: string): Promise<string> {
    if (!(await this.openSearch.indexExists(preferred))) return preferred;

    for (let attempt = 1; attempt <= 20; attempt++) {
      const candidate = `${preferred}_r${attempt}`;
      if (!(await this.openSearch.indexExists(candidate))) return candidate;
    }
    throw new BadRequestException(
      `No free physical index name for ${alias} — clean up stale ${preferred}_r* indices`,
    );
  }

  /**
   * Attach `alias` to `target`. When the alias name is currently occupied by a
   * *concrete* index (production today), delete it in the same
   * `updateAliases` call so the name never stops resolving.
   */
  private async swapOne(alias: string, target: string): Promise<void> {
    const isAlias = await this.openSearch.aliasExists(alias);
    if (isAlias) {
      const previous = await this.openSearch.resolveAliasTargets(alias);
      await this.openSearch.swapAlias({
        alias,
        target,
        detachFrom: previous.filter((name) => name !== target),
      });
      this.logger.log(`Alias ${alias}: [${previous.join(', ')}] → ${target}`);
      return;
    }

    const concreteExists = await this.openSearch.indexExists(alias);
    await this.openSearch.swapAlias({
      alias,
      target,
      removeConcreteIndex: concreteExists,
    });
    this.logger.log(
      concreteExists
        ? `Replaced concrete index ${alias} with alias → ${target}`
        : `Created alias ${alias} → ${target}`,
    );
  }

  /**
   * Copy `source` → `dest` and VERIFY it by counting both indices.
   *
   * A copy failure still must not take the whole rebuild down — the keyword
   * index is the one that fixes search. What it must do is refuse to look like
   * success: an unverified copy returns a non-`verified` status, and
   * `runRebuild` then leaves that alias pointing at its old target rather than
   * swapping traffic onto an index that may be missing documents.
   */
  private async copyAndVerify(source: string, dest: string): Promise<IndexCopyOutcome> {
    const base = { source, dest, reportedCreated: null, sourceCount: 0, destCount: 0 };

    if (!(await this.openSearch.indexExists(source))) {
      this.logger.warn(`${source} does not exist — ${dest} starts empty`);
      return { ...base, status: 'source_missing' };
    }

    let counts;
    try {
      counts = await this.openSearch.reindexInto(source, dest);
    } catch (error) {
      const message = (error as Error).message;
      this.logger.error(`Copy ${source} → ${dest} failed: ${message}`);
      return { ...base, status: 'failed', error: message };
    }

    const { sourceCount, destCount, reportedCreated } = counts;

    // Same 1% window as the keyword gate: the source index is live and may take
    // writes mid-copy, so an exact equality check would flap.
    const minAcceptable = Math.floor(sourceCount * (1 - VERIFY_TOLERANCE));
    if (destCount < minAcceptable) {
      const message =
        `Copy ${source} → ${dest} moved ${destCount} of ${sourceCount} documents ` +
        `(expected >= ${minAcceptable})`;
      this.logger.error(message);
      return {
        ...base,
        status: 'mismatch',
        sourceCount,
        destCount,
        reportedCreated,
        error: message,
      };
    }

    if (reportedCreated !== null && reportedCreated !== destCount) {
      this.logger.warn(
        `_reindex ${source} → ${dest} reported created=${reportedCreated} but ` +
          `${dest} holds ${destCount} documents — trusting the count.`,
      );
    }
    this.logger.log(`Copied ${source} → ${dest}: ${destCount}/${sourceCount} documents`);

    return { ...base, status: 'verified', sourceCount, destCount, reportedCreated };
  }

  /**
   * Stream every legal document + its sections from PostgreSQL into `target`.
   * Keyset-paginated by id (CLAUDE.md: never OFFSET on large tables).
   * Returns the number of OpenSearch documents successfully pushed.
   */
  private async reindexKeywordFromPostgres(
    target: string,
    onProgress: (documentsProcessed: number, docsPushed: number) => Promise<void>,
  ): Promise<number> {
    const batchSize = this.config.get<number>(
      'SEARCH_INDEX_REBUILD_BATCH_SIZE',
      REINDEX_BATCH_SIZE,
    );

    let cursor: string | undefined;
    let documentsProcessed = 0;
    let docsPushed = 0;

    for (;;) {
      const documents = await this.prisma.legalDocument.findMany({
        take: batchSize,
        ...(cursor && { skip: 1, cursor: { id: cursor } }),
        orderBy: { id: 'asc' },
        include: {
          source: { select: { id: true, trustLevel: true } },
          sections: {
            select: { id: true, sectionType: true, plainText: true },
            orderBy: { ordering: 'asc' },
          },
          tagMaps: { include: { tag: { select: { code: true, tagType: true } } } },
        },
      });

      if (documents.length === 0) break;
      cursor = documents[documents.length - 1]!.id;

      const payloads: IndexDocumentPayload[] = [];
      for (const document of documents) {
        const base = this.toBasePayload(document);
        const fullText = document.sections
          .map((section) => section.plainText)
          .filter((text): text is string => Boolean(text))
          .join('\n\n');

        payloads.push({ ...base, plain_text: fullText });

        for (const section of document.sections) {
          if (!section.plainText) continue;
          payloads.push({
            ...base,
            section_id: section.id,
            section_type: section.sectionType,
            section_text: section.plainText,
          });
        }
      }

      const result = await this.openSearch.bulkIndexDocuments(payloads, target);
      docsPushed += result.indexed;
      documentsProcessed += documents.length;
      await onProgress(documentsProcessed, docsPushed);
    }

    return docsPushed;
  }

  /**
   * Stream every non-deleted derivative artifact from PostgreSQL into `target`
   * and verify the result the same way #308 verifies a copy: by MEASURING both
   * sides, never by trusting what the write path reported.
   *
   * The returned `IndexCopyOutcome` reuses the copy vocabulary deliberately —
   * `sourceCount` is the PostgreSQL row count, `destCount` is `_count` on the
   * destination after a refresh, and `reportedCreated` is what `_bulk` claimed
   * it accepted. As with `_reindex`'s `created: 0`, the claim is recorded for
   * diagnosis and the measurement is what decides the status. `runRebuild` then
   * refuses to swap the alias for anything that is not `verified`.
   *
   * Per-item bulk failures throw out of `bulkIndexDerivatives` rather than
   * being counted; that error is caught here and surfaces as `failed`, so the
   * derivatives alias stays on its previous target and the rest of the rebuild
   * still completes.
   */
  private async indexDerivativesFromPostgres(
    target: string,
    sourceCount: number,
    onProgress: (processed: number, pushed: number) => Promise<void>,
  ): Promise<IndexCopyOutcome> {
    const base = { source: 'postgres:derivative_artifacts', dest: target };
    const batchSize = this.config.get<number>(
      'SEARCH_INDEX_REBUILD_BATCH_SIZE',
      REINDEX_BATCH_SIZE,
    );

    let processed = 0;
    let pushed = 0;

    try {
      // Relax refresh while bulk-loading; restore it in `finally` so a failure
      // cannot leave a 30s-stale index behind an alias.
      await this.openSearch.setRefreshInterval(target, BULK_REFRESH_INTERVAL);

      try {
        let cursor: string | undefined;
        for (;;) {
          const rows = await this.prisma.derivativeArtifact.findMany({
            take: batchSize,
            ...(cursor && { skip: 1, cursor: { id: cursor } }),
            where: { deletedAt: null },
            orderBy: { id: 'asc' },
            select: {
              id: true,
              derivativeType: true,
              title: true,
              contentJson: true,
              sourceDocumentId: true,
              organizationId: true,
              visibility: true,
              audience: true,
              language: true,
              taxonomyVersion: true,
              confidenceScore: true,
              publishedAt: true,
              createdAt: true,
              subjectAssignments: {
                select: { subject: { select: { code: true } } },
              },
            },
          });

          if (rows.length === 0) break;
          cursor = rows[rows.length - 1]!.id;

          const payloads = rows.map((row) => this.toDerivativePayload(row));
          const result = await this.openSearch.bulkIndexDerivatives(payloads, target);

          pushed += result.indexed;
          processed += rows.length;
          await onProgress(processed, pushed);
        }
      } finally {
        await this.openSearch.setRefreshInterval(target, STEADY_REFRESH_INTERVAL);
      }
    } catch (error) {
      const message = (error as Error).message;
      this.logger.error(`Derivative indexing into ${target} failed: ${message}`);
      return {
        ...base,
        status: 'failed',
        sourceCount,
        destCount: 0,
        reportedCreated: pushed,
        error: message,
      };
    }

    if (sourceCount === 0) {
      this.logger.warn('No derivative artifacts in PostgreSQL — destination starts empty');
      return { ...base, status: 'source_missing', sourceCount: 0, destCount: 0, reportedCreated: 0 };
    }

    await this.openSearch.refreshIndex(target);
    const destCount = await this.openSearch.countIndex(target);

    // Exactly one OpenSearch document per source row, so unlike the keyword
    // index there is no fan-out to reason about: the tolerance covers rows
    // written or soft-deleted mid-run, nothing else.
    const minAcceptable = Math.floor(sourceCount * (1 - VERIFY_TOLERANCE));
    if (destCount < minAcceptable) {
      const message =
        `Derivative index ${target} holds ${destCount} of ${sourceCount} artifacts ` +
        `(expected >= ${minAcceptable})`;
      this.logger.error(message);
      return {
        ...base,
        status: 'mismatch',
        sourceCount,
        destCount,
        reportedCreated: pushed,
        error: message,
      };
    }

    if (pushed !== destCount) {
      this.logger.warn(
        `_bulk into ${target} reported ${pushed} accepted but the index holds ` +
          `${destCount} — trusting the count.`,
      );
    }
    this.logger.log(`Indexed derivatives → ${target}: ${destCount}/${sourceCount}`);

    return { ...base, status: 'verified', sourceCount, destCount, reportedCreated: pushed };
  }

  /**
   * Map one PostgreSQL row to its indexed document.
   *
   * Body text comes from the C1 extractor — the shapes are NOT re-derived here.
   * That is what keeps the MCQ answer-key rule in exactly one place: the
   * extractor never emits `isCorrect`/`rationale`/`explanation`, and the
   * mapping has no field to hold them.
   *
   * `organization_id` is set only for a row that actually has one. A null org
   * must produce an ABSENT field, because the public branch of
   * `buildDerivativeVisibilityFilter` is `must_not exists organization_id`.
   */
  private toDerivativePayload(row: {
    id: string;
    derivativeType: string;
    title: string;
    contentJson: unknown;
    sourceDocumentId: string | null;
    organizationId: string | null;
    visibility: string;
    audience: string;
    language: string;
    taxonomyVersion: string | null;
    confidenceScore: number | null;
    publishedAt: Date | null;
    createdAt: Date;
    subjectAssignments: { subject: { code: string } }[];
  }): DerivativeDocumentPayload {
    const blocks = extractSearchableText(row.derivativeType, row.contentJson);
    const subjectCodes = row.subjectAssignments.map(
      (assignment) => assignment.subject.code,
    );

    return {
      derivative_id: row.id,
      derivative_type: row.derivativeType,
      title: row.title,
      ...(blocks.length > 0 && { body_text: blocks.join('\n\n') }),
      ...(row.sourceDocumentId && { source_document_id: row.sourceDocumentId }),
      // Spread-on-truthy, not `?? undefined`: the key must be absent, and an
      // explicit `undefined` would still be a key on the object literal.
      ...(row.organizationId && { organization_id: row.organizationId }),
      visibility: row.visibility,
      audience: row.audience,
      language: row.language,
      ...(row.taxonomyVersion && { taxonomy_version: row.taxonomyVersion }),
      ...(subjectCodes.length > 0 && { subject_codes: subjectCodes }),
      ...(row.confidenceScore !== null && { confidence_score: row.confidenceScore }),
      is_published: row.publishedAt !== null,
      created_at: row.createdAt.toISOString(),
      ...(row.publishedAt && { published_at: row.publishedAt.toISOString() }),
    };
  }

  private toBasePayload(document: {
    id: string;
    title: string;
    shortTitle: string | null;
    citationText: string | null;
    documentType: string;
    court: string | null;
    ponente: string | null;
    jurisdiction: string | null;
    language: string | null;
    status: string;
    grNo: string | null;
    docketNo: string | null;
    isOfficial: boolean;
    isPublished: boolean;
    decisionDate: Date | null;
    promulgationDate: Date | null;
    publicationDate: Date | null;
    createdAt: Date;
    source: { id: string; trustLevel: string } | null;
    tagMaps: { tag: { code: string; tagType: string } }[];
  }): IndexDocumentPayload {
    return {
      document_id: document.id,
      title: document.title,
      short_title: document.shortTitle ?? undefined,
      citation_text: document.citationText ?? undefined,
      document_type: document.documentType,
      court: document.court ?? undefined,
      ponente: document.ponente ?? undefined,
      jurisdiction: document.jurisdiction ?? undefined,
      language: document.language ?? undefined,
      status: document.status,
      gr_no: document.grNo ?? undefined,
      docket_no: document.docketNo ?? undefined,
      source_id: document.source?.id ?? undefined,
      source_trust_level: document.source?.trustLevel ?? undefined,
      is_official: document.isOfficial,
      is_published: document.isPublished,
      decision_date: document.decisionDate?.toISOString() ?? undefined,
      promulgation_date: document.promulgationDate?.toISOString() ?? undefined,
      publication_date: document.publicationDate?.toISOString() ?? undefined,
      created_at: document.createdAt.toISOString(),
      bar_subjects: document.tagMaps
        .filter((tagMap) => tagMap.tag.tagType === 'bar_subject')
        .map((tagMap) => tagMap.tag.code),
      topics: document.tagMaps
        .filter((tagMap) => tagMap.tag.tagType === 'topic')
        .map((tagMap) => tagMap.tag.code),
    };
  }
}
