import { randomUUID } from 'crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { CeleryDispatcherService } from '../../common/services/celery-dispatcher.service';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  AdminAnswerReviewStatusFilter,
  BulkApproveBarExamAnswersDto,
  BulkRejectBarExamAnswersDto,
  DispatchAnswerGenerationDto,
} from './dto';
import { MIN_BULK_CONFIDENCE } from './dto';

/** Direct, unqueued generation. Still used by ad-hoc/internal callers. */
const GENERATE_TASK = 'bar_exam.generate_answers_for_questions';

/** The queued path: one chunk of a generation job, chaining itself. */
const RUN_JOB_TASK = 'bar_exam.run_answer_generation_job';

/** Job statuses that cannot be advanced any further without a retry. */
const TERMINAL_JOB_STATUSES = [
  'completed',
  'completed_with_failures',
  'cancelled',
] as const;

/**
 * A running job whose newest item has not moved in this long is stalled — the
 * worker that claimed its chunk is gone. The worker uses the same window to
 * return stale `running` items to `queued`, so a stalled job recovers on the
 * next chunk rather than needing a retry.
 */
const STALL_THRESHOLD_MS = 15 * 60 * 1000;

/** Rows per updateMany inside a bulk approve/reject. */
const BULK_WRITE_CHUNK = 200;

/** Audit entries written concurrently per wave. */
const AUDIT_CONCURRENCY = 50;

export interface AdminBarExamAnswerRow {
  id: string;
  barExamQuestionId: string;
  answerType: string;
  reviewStatus: string;
  visibility: string;
  confidence: number | null;
  reviewedAt: string | null;
  reviewedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  question: {
    id: string;
    questionNumber: number;
    excerpt: string;
    sittingYear: number;
    subjectStudyCode: string | null;
  };
  modelRun: {
    id: string;
    modelName: string;
    promptTemplateVersion: string | null;
  } | null;
}

export interface AdminBarExamAnswerDetail extends AdminBarExamAnswerRow {
  answerText: string;
  structuredAnswerJson: unknown;
  question: AdminBarExamAnswerRow['question'] & { questionText: string };
}

export interface ListResult {
  items: AdminBarExamAnswerRow[];
  meta: {
    hasNext: boolean;
    nextCursor: string | null;
    limit: number;
  };
}

/** One year × subject bucket of a resolved question or answer set. */
export interface YearSubjectCount {
  year: number;
  subjectCode: string | null;
  count: number;
}

export interface DispatchDryRunResult {
  dryRun: true;
  total: number;
  byYearSubject: YearSubjectCount[];
}

export interface DispatchJobResult {
  dryRun: false;
  jobId: string;
  total: number;
}

export type DispatchResult = DispatchDryRunResult | DispatchJobResult;

export interface GenerationJobCounts {
  queued: number;
  running: number;
  generated: number;
  generatedUngrounded: number;
  skippedExisting: number;
  failed: number;
}

export interface GenerationJobSummary {
  id: string;
  status: string;
  total: number;
  onlyMissing: boolean;
  filters: unknown;
  triggeredByUserId: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  lastItemUpdatedAt: string | null;
  /** Items that reached a terminal item status. */
  done: number;
  /** Running, but nothing has moved for STALL_THRESHOLD_MS. */
  stalled: boolean;
  counts: GenerationJobCounts;
}

export interface GenerationJobFailedItem {
  id: string;
  questionId: string;
  questionNumber: number;
  sittingYear: number;
  subjectStudyCode: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  attempts: number;
  updatedAt: string;
}

export interface GenerationJobDetail extends GenerationJobSummary {
  failedItems: {
    items: GenerationJobFailedItem[];
    meta: { hasNext: boolean; nextCursor: string | null; limit: number };
  };
}

export interface CoverageCell {
  year: number;
  subjectCode: string | null;
  totalQuestions: number;
  answered: number;
  missing: number;
  pending: number;
  pendingAtOrAbove070: number;
  approved: number;
  rejected: number;
  unscored: number;
}

export type CoverageTotals = Omit<CoverageCell, 'year' | 'subjectCode'>;

export interface CoverageResult {
  cells: CoverageCell[];
  totals: CoverageTotals;
}

export interface BulkReviewResult {
  dryRun: boolean;
  matched: number;
  updated: number;
  byYearSubject: YearSubjectCount[];
  bulkOperationId: string | null;
}

interface ResolvedQuestion {
  id: string;
  year: number;
  subjectCode: string | null;
}

const QUESTION_EXCERPT_LENGTH = 220;

@Injectable()
export class AdminBarExamAnswersService {
  private readonly logger = new Logger(AdminBarExamAnswersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly celery: CeleryDispatcherService,
  ) {}

  // ─── Review queue ──────────────────────────────────────────────────────

  async listAnswers(opts: {
    reviewStatus?: AdminAnswerReviewStatusFilter;
    year?: number;
    subjectCode?: string;
    minConfidence?: number;
    cursor?: string;
    limit?: number;
  }): Promise<ListResult> {
    const limit = opts.limit ?? 25;
    const status = opts.reviewStatus ?? 'pending';

    const where: Prisma.BarExamAnswerWhereInput = {};
    // 'all' is the one value that applies no status filter. Absent still
    // means 'pending' — the queue is the default view.
    if (status !== 'all') {
      where.reviewStatus = status;
    }
    // `gte` is already NULL-excluding in SQL, which is the behaviour we want:
    // a priors-only row has no score, and filtering by score must not imply a
    // score it does not have.
    if (opts.minConfidence !== undefined) {
      where.confidence = { gte: opts.minConfidence };
    }
    const sitting = this.sittingFilter(opts.year, opts.subjectCode);
    if (sitting) {
      where.question = { is: { barExamSitting: { is: sitting } } };
    }

    const rows = await this.prisma.barExamAnswer.findMany({
      where,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      ...(opts.cursor ? { skip: 1, cursor: { id: opts.cursor } } : {}),
      include: {
        question: {
          select: {
            id: true,
            questionNumber: true,
            questionText: true,
            barExamSitting: {
              select: { year: true, subjectStudyCode: true },
            },
          },
        },
        modelRun: {
          select: { id: true, modelName: true, promptTemplateVersion: true },
        },
      },
    });

    const hasNext = rows.length > limit;
    const slice = hasNext ? rows.slice(0, limit) : rows;
    const items: AdminBarExamAnswerRow[] = slice.map((r) => ({
      id: r.id,
      barExamQuestionId: r.barExamQuestionId,
      answerType: r.answerType,
      reviewStatus: r.reviewStatus,
      visibility: r.visibility,
      confidence: r.confidence,
      reviewedAt: r.reviewedAt?.toISOString() ?? null,
      reviewedByUserId: r.reviewedByUserId,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      question: {
        id: r.question.id,
        questionNumber: r.question.questionNumber,
        excerpt: excerptOf(r.question.questionText),
        sittingYear: r.question.barExamSitting.year,
        subjectStudyCode: r.question.barExamSitting.subjectStudyCode,
      },
      modelRun: r.modelRun
        ? {
            id: r.modelRun.id,
            modelName: r.modelRun.modelName,
            promptTemplateVersion: r.modelRun.promptTemplateVersion,
          }
        : null,
    }));

    return {
      items,
      meta: {
        hasNext,
        nextCursor: hasNext ? items[items.length - 1]!.id : null,
        limit,
      },
    };
  }

  async getAnswerDetail(id: string): Promise<AdminBarExamAnswerDetail> {
    const row = await this.prisma.barExamAnswer.findUnique({
      where: { id },
      include: {
        question: {
          select: {
            id: true,
            questionNumber: true,
            questionText: true,
            barExamSitting: {
              select: { year: true, subjectStudyCode: true },
            },
          },
        },
        modelRun: {
          select: { id: true, modelName: true, promptTemplateVersion: true },
        },
      },
    });
    if (!row) {
      throw new NotFoundException(`Bar exam answer ${id} not found`);
    }
    return {
      id: row.id,
      barExamQuestionId: row.barExamQuestionId,
      answerType: row.answerType,
      reviewStatus: row.reviewStatus,
      visibility: row.visibility,
      confidence: row.confidence,
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      reviewedByUserId: row.reviewedByUserId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      answerText: row.answerText,
      structuredAnswerJson: row.structuredAnswerJson,
      question: {
        id: row.question.id,
        questionNumber: row.question.questionNumber,
        excerpt: excerptOf(row.question.questionText),
        questionText: row.question.questionText,
        sittingYear: row.question.barExamSitting.year,
        subjectStudyCode: row.question.barExamSitting.subjectStudyCode,
      },
      modelRun: row.modelRun
        ? {
            id: row.modelRun.id,
            modelName: row.modelRun.modelName,
            promptTemplateVersion: row.modelRun.promptTemplateVersion,
          }
        : null,
    };
  }

  async approve(id: string, reviewerUserId: string): Promise<AdminBarExamAnswerDetail> {
    const existing = await this.prisma.barExamAnswer.findUnique({
      where: { id },
      select: { reviewStatus: true },
    });
    if (!existing) {
      throw new NotFoundException(`Bar exam answer ${id} not found`);
    }
    if (existing.reviewStatus === 'approved') {
      // Idempotent — return the current detail without re-writing.
      return this.getAnswerDetail(id);
    }
    await this.prisma.barExamAnswer.update({
      where: { id },
      data: {
        reviewStatus: 'approved',
        visibility: 'public_editorial',
        reviewedByUserId: reviewerUserId,
        reviewedAt: new Date(),
      },
    });
    return this.getAnswerDetail(id);
  }

  async reject(id: string, reviewerUserId: string): Promise<AdminBarExamAnswerDetail> {
    const existing = await this.prisma.barExamAnswer.findUnique({
      where: { id },
      select: { reviewStatus: true },
    });
    if (!existing) {
      throw new NotFoundException(`Bar exam answer ${id} not found`);
    }
    if (existing.reviewStatus === 'rejected') {
      return this.getAnswerDetail(id);
    }
    await this.prisma.barExamAnswer.update({
      where: { id },
      data: {
        reviewStatus: 'rejected',
        visibility: 'private',
        reviewedByUserId: reviewerUserId,
        reviewedAt: new Date(),
      },
    });
    return this.getAnswerDetail(id);
  }

  // ─── Bulk review ───────────────────────────────────────────────────────

  /**
   * Approve many pending answers at once, by explicit id list or by filter.
   *
   * Filter mode is the dangerous one — nobody reads the individual rows — so
   * it carries two non-negotiable constraints: `minConfidence >= 0.70`, and
   * NULL confidences excluded. A NULL is a v1 priors-only row that was never
   * scored on the grounded terms; sweeping it in with `>= 0.70` would treat
   * "unmeasured" as "measured well".
   */
  async bulkApprove(
    dto: BulkApproveBarExamAnswersDto,
    reviewerUserId: string,
  ): Promise<{ result: BulkReviewResult; matchedIds: string[] }> {
    const hasIds = Boolean(dto.ids && dto.ids.length > 0);
    if (hasIds === Boolean(dto.filter)) {
      throw new BadRequestException(
        'Provide exactly one of: ids, filter.',
      );
    }

    const where: Prisma.BarExamAnswerWhereInput = { reviewStatus: 'pending' };
    if (hasIds) {
      where.id = { in: dto.ids! };
    } else {
      const filter = dto.filter!;
      if (filter.minConfidence < MIN_BULK_CONFIDENCE) {
        throw new BadRequestException(
          `filter.minConfidence must be >= ${MIN_BULK_CONFIDENCE}.`,
        );
      }
      where.confidence = { gte: filter.minConfidence };
      const sitting = this.sittingFilter(filter.year, filter.subjectCode);
      if (sitting) {
        where.question = { is: { barExamSitting: { is: sitting } } };
      }
    }

    return this.applyBulkReview('approve', where, dto.dryRun, reviewerUserId);
  }

  /**
   * Reject many pending answers by explicit id list.
   *
   * There is no filter mode. Approving by filter is bounded by a confidence
   * floor the scoring contract already calls publishable; nothing plays that
   * role for rejection, and the only shape the shared filter could take —
   * "reject everything at or above 0.70" — is not an operation anyone wants.
   * The DTO has no `filter` property at all, so a request carrying one is a
   * 400 from the global pipe rather than something this method has to refuse.
   */
  async bulkReject(
    dto: BulkRejectBarExamAnswersDto,
    reviewerUserId: string,
  ): Promise<{ result: BulkReviewResult; matchedIds: string[] }> {
    const where: Prisma.BarExamAnswerWhereInput = {
      reviewStatus: 'pending',
      id: { in: dto.ids },
    };
    return this.applyBulkReview('reject', where, dto.dryRun, reviewerUserId);
  }

  /** Shared read → count → chunked write for both bulk paths. */
  private async applyBulkReview(
    action: 'approve' | 'reject',
    where: Prisma.BarExamAnswerWhereInput,
    dryRun: boolean | undefined,
    reviewerUserId: string,
  ): Promise<{ result: BulkReviewResult; matchedIds: string[] }> {
    const matched = await this.prisma.barExamAnswer.findMany({
      where,
      select: {
        id: true,
        question: {
          select: { barExamSitting: { select: { year: true, subjectStudyCode: true } } },
        },
      },
      orderBy: { id: 'asc' },
    });

    const byYearSubject = groupByYearSubject(
      matched.map((m) => ({
        year: m.question.barExamSitting.year,
        subjectCode: m.question.barExamSitting.subjectStudyCode,
      })),
    );

    if (dryRun) {
      return {
        result: {
          dryRun: true,
          matched: matched.length,
          updated: 0,
          byYearSubject,
          bulkOperationId: null,
        },
        matchedIds: [],
      };
    }

    const ids = matched.map((m) => m.id);
    const data =
      action === 'approve'
        ? {
            reviewStatus: 'approved',
            visibility: 'public_editorial',
            reviewedByUserId: reviewerUserId,
            reviewedAt: new Date(),
          }
        : {
            reviewStatus: 'rejected',
            visibility: 'private',
            reviewedByUserId: reviewerUserId,
            reviewedAt: new Date(),
          };

    // One transaction per chunk rather than one transaction over everything:
    // a filter can match the whole corpus, and a single interactive
    // transaction that large runs into Prisma's timeout and rolls back work
    // that was already correct. Each chunk is still all-or-nothing, and the
    // `reviewStatus: 'pending'` guard is repeated in the write so a row
    // reviewed by someone else between the read and the write is skipped
    // rather than overwritten.
    let updated = 0;
    for (const chunk of chunked(ids, BULK_WRITE_CHUNK)) {
      const [res] = await this.prisma.$transaction([
        this.prisma.barExamAnswer.updateMany({
          where: { id: { in: chunk }, reviewStatus: 'pending' },
          data,
        }),
      ]);
      updated += res?.count ?? 0;
    }

    return {
      result: {
        dryRun: false,
        matched: matched.length,
        updated,
        byYearSubject,
        bulkOperationId: randomUUID(),
      },
      matchedIds: ids,
    };
  }

  // ─── Coverage ──────────────────────────────────────────────────────────

  /**
   * Answer coverage per sitting year × subject.
   *
   * One grouped query rather than 104 count() round-trips. It is raw SQL
   * because the shape (a LEFT JOIN plus seven FILTERed aggregates) has no
   * Prisma equivalent; it is a tagged template, so the only interpolated
   * value — the answer type — is a bound parameter, and no user input reaches
   * the query at all.
   */
  async coverage(): Promise<CoverageResult> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        year: number;
        subject_study_code: string | null;
        total_questions: bigint;
        missing: bigint;
        pending: bigint;
        pending_at_or_above_070: bigint;
        approved: bigint;
        rejected: bigint;
        unscored: bigint;
      }>
    >`
      SELECT s.year AS year,
             s.subject_study_code AS subject_study_code,
             COUNT(*)::bigint AS total_questions,
             COUNT(*) FILTER (WHERE a.id IS NULL)::bigint AS missing,
             COUNT(*) FILTER (WHERE a.review_status = 'pending')::bigint AS pending,
             COUNT(*) FILTER (
               WHERE a.review_status = 'pending' AND a.confidence >= ${MIN_BULK_CONFIDENCE}
             )::bigint AS pending_at_or_above_070,
             COUNT(*) FILTER (WHERE a.review_status = 'approved')::bigint AS approved,
             COUNT(*) FILTER (WHERE a.review_status = 'rejected')::bigint AS rejected,
             COUNT(*) FILTER (WHERE a.id IS NOT NULL AND a.confidence IS NULL)::bigint AS unscored
      FROM bar_exam_questions q
      JOIN bar_exam_sittings s ON s.id = q.bar_exam_sitting_id
      LEFT JOIN bar_exam_answers a
             ON a.bar_exam_question_id = q.id
            AND a.answer_type = ${'ai_generated'}
      GROUP BY s.year, s.subject_study_code
      ORDER BY s.year DESC, s.subject_study_code ASC
    `;

    // COUNT() comes back as BigInt, which JSON.stringify throws on — the
    // admin analytics dashboard was blank for exactly this reason (#475).
    const cells: CoverageCell[] = rows.map((r) => ({
      year: Number(r.year),
      subjectCode: r.subject_study_code,
      totalQuestions: Number(r.total_questions),
      answered: Number(r.total_questions) - Number(r.missing),
      missing: Number(r.missing),
      pending: Number(r.pending),
      pendingAtOrAbove070: Number(r.pending_at_or_above_070),
      approved: Number(r.approved),
      rejected: Number(r.rejected),
      unscored: Number(r.unscored),
    }));

    const totals = cells.reduce<CoverageTotals>(
      (acc, c) => ({
        totalQuestions: acc.totalQuestions + c.totalQuestions,
        answered: acc.answered + c.answered,
        missing: acc.missing + c.missing,
        pending: acc.pending + c.pending,
        pendingAtOrAbove070: acc.pendingAtOrAbove070 + c.pendingAtOrAbove070,
        approved: acc.approved + c.approved,
        rejected: acc.rejected + c.rejected,
        unscored: acc.unscored + c.unscored,
      }),
      {
        totalQuestions: 0,
        answered: 0,
        missing: 0,
        pending: 0,
        pendingAtOrAbove070: 0,
        approved: 0,
        rejected: 0,
        unscored: 0,
      },
    );

    return { cells, totals };
  }

  // ─── Generation jobs ───────────────────────────────────────────────────

  /**
   * Resolve filters into a durable job: one job row plus one item per
   * question, created in a single transaction, then a first chunk enqueued.
   *
   * `dryRun` resolves and counts only. The dialog runs it before every real
   * dispatch so "N questions will be generated" is a measured number rather
   * than a promise about a cap.
   */
  async dispatchGeneration(
    dto: DispatchAnswerGenerationDto,
    triggeredByUserId: string,
  ): Promise<DispatchResult> {
    const resolved = await this.resolveQuestions(dto);
    const byYearSubject = groupByYearSubject(resolved);

    if (dto.dryRun) {
      return { dryRun: true, total: resolved.length, byYearSubject };
    }

    if (resolved.length === 0) {
      throw new BadRequestException(
        'No bar exam questions matched the requested filters.',
      );
    }

    const onlyMissing = this.effectiveOnlyMissing(dto);
    const job = await this.prisma.$transaction(async (tx) => {
      const created = await tx.barExamAnswerGenerationJob.create({
        data: {
          status: 'queued',
          onlyMissing,
          total: resolved.length,
          triggeredByUserId,
          filtersJson: {
            questionIds: dto.questionIds?.length ?? null,
            sittingId: dto.sittingId ?? null,
            year: dto.year ?? null,
            subjectCode: dto.subjectCode ?? null,
            allMissing: dto.allMissing ?? false,
            onlyMissing,
          },
        },
        select: { id: true },
      });
      await tx.barExamAnswerGenerationItem.createMany({
        data: resolved.map((q) => ({ jobId: created.id, questionId: q.id })),
        skipDuplicates: true,
      });
      return created;
    });

    await this.celery.sendTask(RUN_JOB_TASK, { kwargs: { job_id: job.id } });
    this.logger.log(
      `dispatch-generation: job ${job.id} queued with ${resolved.length} item(s)`,
    );

    return { dryRun: false, jobId: job.id, total: resolved.length };
  }

  async listJobs(limit = 20): Promise<GenerationJobSummary[]> {
    const jobs = await this.prisma.barExamAnswerGenerationJob.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    if (jobs.length === 0) return [];

    const jobIds = jobs.map((j) => j.id);
    const grouped = await this.prisma.barExamAnswerGenerationItem.groupBy({
      by: ['jobId', 'status'],
      where: { jobId: { in: jobIds } },
      _count: { _all: true },
      _max: { updatedAt: true },
    });

    const countsByJob = new Map<string, Record<string, number>>();
    const lastUpdatedByJob = new Map<string, Date>();
    for (const row of grouped) {
      const counts = countsByJob.get(row.jobId) ?? {};
      counts[row.status] = row._count._all;
      countsByJob.set(row.jobId, counts);
      const seen = row._max.updatedAt;
      if (seen) {
        const prev = lastUpdatedByJob.get(row.jobId);
        if (!prev || seen > prev) lastUpdatedByJob.set(row.jobId, seen);
      }
    }

    return jobs.map((job) =>
      this.toJobSummary(
        job,
        countsByJob.get(job.id) ?? {},
        lastUpdatedByJob.get(job.id) ?? null,
      ),
    );
  }

  async getJob(
    id: string,
    opts: { failedCursor?: string; failedLimit?: number } = {},
  ): Promise<GenerationJobDetail> {
    const job = await this.prisma.barExamAnswerGenerationJob.findUnique({
      where: { id },
    });
    if (!job) {
      throw new NotFoundException(`Generation job ${id} not found`);
    }

    const grouped = await this.prisma.barExamAnswerGenerationItem.groupBy({
      by: ['status'],
      where: { jobId: id },
      _count: { _all: true },
      _max: { updatedAt: true },
    });
    const counts: Record<string, number> = {};
    let lastUpdated: Date | null = null;
    for (const row of grouped) {
      counts[row.status] = row._count._all;
      if (row._max.updatedAt && (!lastUpdated || row._max.updatedAt > lastUpdated)) {
        lastUpdated = row._max.updatedAt;
      }
    }

    const failedLimit = opts.failedLimit ?? 50;
    const failedRows = await this.prisma.barExamAnswerGenerationItem.findMany({
      where: { jobId: id, status: 'failed' },
      orderBy: { id: 'asc' },
      take: failedLimit + 1,
      ...(opts.failedCursor
        ? { skip: 1, cursor: { id: opts.failedCursor } }
        : {}),
      select: {
        id: true,
        questionId: true,
        errorCode: true,
        errorMessage: true,
        attempts: true,
        updatedAt: true,
        question: {
          select: {
            questionNumber: true,
            barExamSitting: { select: { year: true, subjectStudyCode: true } },
          },
        },
      },
    });

    const hasNext = failedRows.length > failedLimit;
    const slice = hasNext ? failedRows.slice(0, failedLimit) : failedRows;
    const items: GenerationJobFailedItem[] = slice.map((r) => ({
      id: r.id,
      questionId: r.questionId,
      questionNumber: r.question.questionNumber,
      sittingYear: r.question.barExamSitting.year,
      subjectStudyCode: r.question.barExamSitting.subjectStudyCode,
      errorCode: r.errorCode,
      errorMessage: r.errorMessage,
      attempts: r.attempts,
      updatedAt: r.updatedAt.toISOString(),
    }));

    return {
      ...this.toJobSummary(job, counts, lastUpdated),
      failedItems: {
        items,
        meta: {
          hasNext,
          nextCursor: hasNext ? items[items.length - 1]!.id : null,
          limit: failedLimit,
        },
      },
    };
  }

  /**
   * Cancel a job. Claimed items are released back to `queued` by the worker
   * itself when it sees the status flip, so nothing is left marked `running`
   * forever; the untouched queued items simply stay queued, which is an
   * honest record of what the run did and did not cover.
   */
  async cancelJob(id: string): Promise<GenerationJobSummary> {
    const job = await this.prisma.barExamAnswerGenerationJob.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!job) {
      throw new NotFoundException(`Generation job ${id} not found`);
    }
    if ((TERMINAL_JOB_STATUSES as readonly string[]).includes(job.status)) {
      throw new ConflictException(
        `Generation job ${id} is already ${job.status}.`,
      );
    }
    await this.prisma.barExamAnswerGenerationJob.update({
      where: { id },
      data: { status: 'cancelled', finishedAt: new Date() },
    });
    return this.getJobSummary(id);
  }

  /**
   * Re-queue every failed item and restart the chunk chain.
   *
   * Also the resume path for a `paused_budget` job: that job has no failed
   * items at all (a budget stop returns its item to `queued`), so "retry" for
   * it means nothing more than re-enqueueing the task once the ceiling has
   * been raised.
   */
  async retryFailedItems(
    id: string,
  ): Promise<{ job: GenerationJobSummary; requeued: number }> {
    const job = await this.prisma.barExamAnswerGenerationJob.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!job) {
      throw new NotFoundException(`Generation job ${id} not found`);
    }

    const requeued = await this.prisma.barExamAnswerGenerationItem.updateMany({
      where: { jobId: id, status: 'failed' },
      data: { status: 'queued', errorCode: null, errorMessage: null },
    });

    const queued = await this.prisma.barExamAnswerGenerationItem.count({
      where: { jobId: id, status: 'queued' },
    });
    if (queued === 0) {
      throw new ConflictException(
        `Generation job ${id} has nothing left to run.`,
      );
    }

    await this.prisma.barExamAnswerGenerationJob.update({
      where: { id },
      data: { status: 'queued', finishedAt: null },
    });
    await this.celery.sendTask(RUN_JOB_TASK, { kwargs: { job_id: id } });

    return { job: await this.getJobSummary(id), requeued: requeued.count };
  }

  /**
   * Direct, unqueued dispatch of the original per-question task. Kept for
   * internal/ad-hoc use; the admin UI goes through {@link dispatchGeneration}.
   */
  async dispatchDirect(questionIds: string[]): Promise<string> {
    return this.celery.sendTask(GENERATE_TASK, {
      kwargs: { question_ids: questionIds },
    });
  }

  // ─── Internals ─────────────────────────────────────────────────────────

  private async getJobSummary(id: string): Promise<GenerationJobSummary> {
    const detail = await this.getJob(id, { failedLimit: 1 });
    const { failedItems: _failedItems, ...summary } = detail;
    return summary;
  }

  private toJobSummary(
    job: {
      id: string;
      status: string;
      total: number;
      onlyMissing: boolean;
      filtersJson: unknown;
      triggeredByUserId: string | null;
      createdAt: Date;
      startedAt: Date | null;
      finishedAt: Date | null;
    },
    counts: Record<string, number>,
    lastItemUpdatedAt: Date | null,
  ): GenerationJobSummary {
    const normalized: GenerationJobCounts = {
      queued: counts['queued'] ?? 0,
      running: counts['running'] ?? 0,
      generated: counts['generated'] ?? 0,
      generatedUngrounded: counts['generated_ungrounded'] ?? 0,
      skippedExisting: counts['skipped_existing'] ?? 0,
      failed: counts['failed'] ?? 0,
    };
    const done =
      normalized.generated +
      normalized.generatedUngrounded +
      normalized.skippedExisting +
      normalized.failed;

    const stalled =
      job.status === 'running' &&
      (!lastItemUpdatedAt ||
        Date.now() - lastItemUpdatedAt.getTime() > STALL_THRESHOLD_MS);

    return {
      id: job.id,
      status: job.status,
      total: job.total,
      onlyMissing: job.onlyMissing,
      filters: job.filtersJson,
      triggeredByUserId: job.triggeredByUserId,
      createdAt: job.createdAt.toISOString(),
      startedAt: job.startedAt?.toISOString() ?? null,
      finishedAt: job.finishedAt?.toISOString() ?? null,
      lastItemUpdatedAt: lastItemUpdatedAt?.toISOString() ?? null,
      done,
      stalled,
      counts: normalized,
    };
  }

  private sittingFilter(
    year?: number,
    subjectCode?: string,
  ): Prisma.BarExamSittingWhereInput | null {
    const where: Prisma.BarExamSittingWhereInput = {};
    if (year !== undefined) where.year = year;
    if (subjectCode) where.subjectStudyCode = subjectCode;
    return Object.keys(where).length > 0 ? where : null;
  }

  /**
   * `allMissing` is defined as "every question that has no answer yet", so it
   * forces `onlyMissing` on. Otherwise the one request that skips the filter
   * guard would also be the one able to re-dispatch the entire 1,536-question
   * corpus including the 161 already answered.
   */
  private effectiveOnlyMissing(dto: DispatchAnswerGenerationDto): boolean {
    if (dto.allMissing) return true;
    return dto.onlyMissing ?? true;
  }

  private async resolveQuestions(
    dto: DispatchAnswerGenerationDto,
  ): Promise<ResolvedQuestion[]> {
    const where: Prisma.BarExamQuestionWhereInput = {};

    if (dto.questionIds && dto.questionIds.length > 0) {
      where.id = { in: dto.questionIds };
    } else if (dto.sittingId) {
      where.barExamSittingId = dto.sittingId;
    } else {
      const sitting = this.sittingFilter(dto.year, dto.subjectCode);
      if (sitting) {
        where.barExamSitting = { is: sitting };
      } else if (!dto.allMissing) {
        // No filters at all — refuse to dispatch the entire corpus by
        // accident. `allMissing: true` is the explicit way to ask for it.
        throw new BadRequestException(
          'Provide at least one of: questionIds, sittingId, year, subjectCode — or set allMissing=true.',
        );
      }
    }

    // The bug this fixes: the resolver used to take the first 51 questions by
    // question number and never exclude questions that already had an answer,
    // so re-dispatching a filter re-picked the same already-answered rows and
    // the worker skipped every one of them. Generation could not get past the
    // first 50 of any filter, ever.
    if (this.effectiveOnlyMissing(dto)) {
      where.answers = { none: { answerType: 'ai_generated' } };
    }

    const rows = await this.prisma.barExamQuestion.findMany({
      where,
      select: {
        id: true,
        barExamSitting: { select: { year: true, subjectStudyCode: true } },
      },
      orderBy: [{ barExamSittingId: 'asc' }, { questionNumber: 'asc' }],
    });

    return rows.map((r) => ({
      id: r.id,
      year: r.barExamSitting.year,
      subjectCode: r.barExamSitting.subjectStudyCode,
    }));
  }
}

function excerptOf(text: string): string {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= QUESTION_EXCERPT_LENGTH) return trimmed;
  return trimmed.slice(0, QUESTION_EXCERPT_LENGTH - 1).trimEnd() + '…';
}

function groupByYearSubject(
  rows: Array<{ year: number; subjectCode: string | null }>,
): YearSubjectCount[] {
  const buckets = new Map<string, YearSubjectCount>();
  for (const row of rows) {
    const key = `${row.year}::${row.subjectCode ?? ''}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      buckets.set(key, {
        year: row.year,
        subjectCode: row.subjectCode,
        count: 1,
      });
    }
  }
  return [...buckets.values()].sort(
    (a, b) =>
      b.year - a.year ||
      (a.subjectCode ?? '').localeCompare(b.subjectCode ?? ''),
  );
}

function chunked<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export { AUDIT_CONCURRENCY, GENERATE_TASK, RUN_JOB_TASK, chunked };
