import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CeleryDispatcherService } from '../../common/services/celery-dispatcher.service';
import { RedisService } from '../../common/services/redis.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ABSENCE_REASON,
  ALL_YEAR_SLUGS,
  absentYears,
  archiveUrlFor,
  archivedYears,
  getSubjectMeta,
} from './bar-exam-subjects';

const INGEST_TASK = 'bar_exam.ingest_sitting';
const BACKFILL_TASK = 'bar_exam.backfill_lawphil_archive';

const PLAN_CACHE_KEY = 'cache:bar-exam:backfill-plan';
const PLAN_CACHE_TTL_SECONDS = 60;

// Worker is configured at 2s polite-delay between fetches; 5h fetch
// window per the off-peak gate. These constants drive the time-cost
// estimate displayed to the operator — they intentionally mirror the
// Python worker config rather than inventing new numbers.
const POLITE_DELAY_SECONDS_PER_FETCH = 2;
const FETCH_WINDOW_HOURS = 5;
const QUESTIONS_PER_SITTING_LOW = 20;
const QUESTIONS_PER_SITTING_HIGH = 25;

export interface DispatchedTask {
  taskId: string;
  taskName: string;
  kwargs: Record<string, unknown>;
}

export interface BarExamAdminSittingRow {
  id: string;
  year: number;
  part: string | null;
  subjectStudyCode: string | null;
  subjectBarAdminCode: string | null;
  chairperson: string | null;
  sourceUrl: string | null;
  sourceDocumentId: string | null;
  questionCount: number;
  lastIngestedAt: string | null;
}

export type BackfillSittingStatus = 'pending' | 'already_ingested';

export interface BackfillPlanSitting {
  year: number;
  subjectSlug: string;
  subjectStudyCode: string;
  subjectAdminCode: string;
  part: string | null;
  label: string;
  status: BackfillSittingStatus;
  existingSittingId: string | null;
  existingQuestionCount: number | null;
  sourceUrl: string;
}

export interface BackfillPlan {
  coverage: {
    yearsAvailable: readonly number[];
    yearsAbsentOnLawphil: readonly number[];
    absenceReason: string;
  };
  sittings: BackfillPlanSitting[];
  totals: {
    pending: number;
    alreadyIngested: number;
    totalCombinations: number;
    estimatedQuestionsLow: number;
    estimatedQuestionsHigh: number;
    estimatedFetchMinutes: number;
    estimatedFetchWindowsNeeded: number;
  };
  configuredFetchWindow: {
    tz: string;
    startHour: number;
    endHour: number;
  };
}

export interface DispatchSittingRequest {
  year: number;
  subjectSlug: string;
}

export interface DispatchResult {
  dispatched: { year: number; subjectSlug: string; taskId: string }[];
  skipped: {
    year: number;
    subjectSlug: string;
    reason: string;
  }[];
  totalDispatched: number;
  totalSkipped: number;
}

@Injectable()
export class AdminBarExamsService {
  private readonly logger = new Logger(AdminBarExamsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly celery: CeleryDispatcherService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  async listSittingsForAdmin(): Promise<BarExamAdminSittingRow[]> {
    const rows = await this.prisma.barExamSitting.findMany({
      orderBy: [{ year: 'desc' }, { subjectStudyCode: 'asc' }, { part: 'asc' }],
      select: {
        id: true,
        year: true,
        part: true,
        subjectStudyCode: true,
        subjectBarAdminCode: true,
        chairperson: true,
        sourceUrl: true,
        sourceDocumentId: true,
        sourceDocument: { select: { updatedAt: true } },
        _count: { select: { questions: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      year: r.year,
      part: r.part,
      subjectStudyCode: r.subjectStudyCode,
      subjectBarAdminCode: r.subjectBarAdminCode,
      chairperson: r.chairperson,
      sourceUrl: r.sourceUrl,
      sourceDocumentId: r.sourceDocumentId,
      questionCount: r._count.questions,
      lastIngestedAt: r.sourceDocument?.updatedAt
        ? r.sourceDocument.updatedAt.toISOString()
        : null,
    }));
  }

  /**
   * Build the operator-facing backfill plan: enumerate every (year,
   * slug) the registry knows about, mark each as pending or already
   * ingested by joining against ``bar_exam_sittings``, and bundle a
   * coverage summary + time-cost estimate. Cached 60s in Redis so a
   * dialog open doesn't hammer the DB on every refresh.
   */
  async getBackfillPlan(): Promise<BackfillPlan> {
    const cached = await this.redis.get(PLAN_CACHE_KEY);
    if (cached) {
      try {
        return JSON.parse(cached) as BackfillPlan;
      } catch (err) {
        this.logger.warn(
          `Discarding malformed backfill plan cache entry: ${(err as Error).message}`,
        );
      }
    }

    const existingRows = await this.prisma.barExamSitting.findMany({
      select: {
        id: true,
        year: true,
        part: true,
        subjectStudyCode: true,
        sourceDocumentId: true,
        _count: { select: { questions: true } },
      },
    });

    const existingByKey = new Map<
      string,
      {
        id: string;
        sourceDocumentId: string | null;
        questionCount: number;
      }
    >();
    for (const row of existingRows) {
      if (!row.subjectStudyCode) continue;
      const key = `${row.year}|${row.part ?? ''}|${row.subjectStudyCode}`;
      existingByKey.set(key, {
        id: row.id,
        sourceDocumentId: row.sourceDocumentId,
        questionCount: row._count.questions,
      });
    }

    const sittings: BackfillPlanSitting[] = [];
    let pending = 0;
    let alreadyIngested = 0;
    for (const [year, slug] of ALL_YEAR_SLUGS) {
      const meta = getSubjectMeta(slug);
      if (!meta) continue;
      const key = `${year}|${meta.part ?? ''}|${meta.studyCode}`;
      const existing = existingByKey.get(key);
      const isIngested = !!(existing && existing.sourceDocumentId);
      if (isIngested) alreadyIngested += 1;
      else pending += 1;

      sittings.push({
        year,
        subjectSlug: slug,
        subjectStudyCode: meta.studyCode,
        subjectAdminCode: meta.adminCode,
        part: meta.part,
        label: meta.label,
        status: isIngested ? 'already_ingested' : 'pending',
        existingSittingId: existing?.id ?? null,
        existingQuestionCount: existing ? existing.questionCount : null,
        sourceUrl: archiveUrlFor(year, slug),
      });
    }

    sittings.sort((a, b) => {
      if (a.year !== b.year) return a.year - b.year;
      if (a.subjectStudyCode !== b.subjectStudyCode) {
        return a.subjectStudyCode.localeCompare(b.subjectStudyCode);
      }
      return (a.part ?? '').localeCompare(b.part ?? '');
    });

    const estimatedFetchSeconds = pending * POLITE_DELAY_SECONDS_PER_FETCH;
    const estimatedFetchMinutes = Math.ceil(estimatedFetchSeconds / 60);
    const fetchWindowMinutes = FETCH_WINDOW_HOURS * 60;
    const estimatedFetchWindowsNeeded =
      estimatedFetchMinutes === 0
        ? 0
        : Math.ceil(estimatedFetchMinutes / fetchWindowMinutes);

    const plan: BackfillPlan = {
      coverage: {
        yearsAvailable: archivedYears(),
        yearsAbsentOnLawphil: absentYears(),
        absenceReason: ABSENCE_REASON,
      },
      sittings,
      totals: {
        pending,
        alreadyIngested,
        totalCombinations: sittings.length,
        estimatedQuestionsLow: pending * QUESTIONS_PER_SITTING_LOW,
        estimatedQuestionsHigh: pending * QUESTIONS_PER_SITTING_HIGH,
        estimatedFetchMinutes,
        estimatedFetchWindowsNeeded,
      },
      configuredFetchWindow: {
        tz: this.config.get<string>(
          'BACKFILL_FETCH_WINDOW_TZ',
          'America/New_York',
        ),
        startHour: this.config.get<number>(
          'BACKFILL_FETCH_WINDOW_HOUR_START',
          13,
        ),
        endHour: this.config.get<number>(
          'BACKFILL_FETCH_WINDOW_HOUR_END',
          18,
        ),
      },
    };

    await this.redis.set(
      PLAN_CACHE_KEY,
      JSON.stringify(plan),
      PLAN_CACHE_TTL_SECONDS,
    );
    return plan;
  }

  /** Invalidate the cached backfill plan after a dispatch. */
  async invalidatePlanCache(): Promise<void> {
    await this.redis.del(PLAN_CACHE_KEY);
  }

  /**
   * Dispatch one sitting via ``bar_exam.ingest_sitting``. The slug
   * must exist in the registry; the year must be one the registry
   * lists for that slug. Returns the celery task id.
   */
  async dispatchSitting(
    year: number,
    subjectSlug: string,
  ): Promise<DispatchedTask> {
    const meta = getSubjectMeta(subjectSlug);
    if (!meta) {
      throw new BadRequestException(
        `Unknown LawPhil subject slug: ${subjectSlug}`,
      );
    }
    const isKnownYearSlug = ALL_YEAR_SLUGS.some(
      ([y, s]) => y === year && s === subjectSlug,
    );
    if (!isKnownYearSlug) {
      throw new BadRequestException(
        `Year ${year} is not in the LawPhil archive for slug ${subjectSlug}`,
      );
    }
    const taskId = await this.celery.sendTask(INGEST_TASK, {
      kwargs: { year, subject_slug: subjectSlug },
    });
    return {
      taskId,
      taskName: INGEST_TASK,
      kwargs: { year, subject_slug: subjectSlug },
    };
  }

  /**
   * Dispatch an explicit list of (year, slug) pairs. Each is fanned
   * out as a separate ``ingest_sitting`` task. Pairs whose sittings
   * are already ingested per the current plan are skipped (so an
   * operator who clicks Dispatch on a stale dialog doesn't double-
   * fetch). Pairs not in the registry are also skipped with a reason.
   */
  async dispatchSittingList(
    requests: DispatchSittingRequest[],
  ): Promise<DispatchResult> {
    if (requests.length === 0) {
      throw new BadRequestException(
        'sittings list must contain at least one entry',
      );
    }

    const existingRows = await this.prisma.barExamSitting.findMany({
      where: {
        OR: requests.map((r) => {
          const meta = getSubjectMeta(r.subjectSlug);
          return {
            year: r.year,
            subjectStudyCode: meta?.studyCode ?? '__unknown__',
            part: meta?.part ?? null,
          };
        }),
      },
      select: {
        year: true,
        part: true,
        subjectStudyCode: true,
        sourceDocumentId: true,
      },
    });
    const ingestedKeys = new Set<string>();
    for (const row of existingRows) {
      if (row.sourceDocumentId && row.subjectStudyCode) {
        ingestedKeys.add(
          `${row.year}|${row.part ?? ''}|${row.subjectStudyCode}`,
        );
      }
    }

    const dispatched: DispatchResult['dispatched'] = [];
    const skipped: DispatchResult['skipped'] = [];

    for (const req of requests) {
      const meta = getSubjectMeta(req.subjectSlug);
      if (!meta) {
        skipped.push({
          year: req.year,
          subjectSlug: req.subjectSlug,
          reason: 'unknown_slug',
        });
        continue;
      }
      const isKnownYearSlug = ALL_YEAR_SLUGS.some(
        ([y, s]) => y === req.year && s === req.subjectSlug,
      );
      if (!isKnownYearSlug) {
        skipped.push({
          year: req.year,
          subjectSlug: req.subjectSlug,
          reason: 'year_not_in_archive',
        });
        continue;
      }
      const key = `${req.year}|${meta.part ?? ''}|${meta.studyCode}`;
      if (ingestedKeys.has(key)) {
        skipped.push({
          year: req.year,
          subjectSlug: req.subjectSlug,
          reason: 'already_ingested',
        });
        continue;
      }
      const taskId = await this.celery.sendTask(INGEST_TASK, {
        kwargs: { year: req.year, subject_slug: req.subjectSlug },
      });
      dispatched.push({
        year: req.year,
        subjectSlug: req.subjectSlug,
        taskId,
      });
    }

    await this.invalidatePlanCache();

    return {
      dispatched,
      skipped,
      totalDispatched: dispatched.length,
      totalSkipped: skipped.length,
    };
  }

  /**
   * Convenience shape: dispatch the full archive backfill (worker
   * task fans out internally and skips already-ingested sittings).
   */
  async dispatchBackfillAll(): Promise<DispatchedTask> {
    const taskId = await this.celery.sendTask(BACKFILL_TASK, { kwargs: {} });
    await this.invalidatePlanCache();
    return { taskId, taskName: BACKFILL_TASK, kwargs: {} };
  }

  /**
   * Dispatch a single-year backfill: ``backfill_lawphil_archive``
   * scoped to ``[year, year]`` with an optional limit. The worker
   * still skips already-ingested sittings.
   */
  async dispatchSingleYearBackfill(
    year: number,
    limit?: number,
  ): Promise<DispatchedTask> {
    const kwargs: Record<string, unknown> = { year_start: year, year_end: year };
    if (limit !== undefined) kwargs['limit'] = limit;
    const taskId = await this.celery.sendTask(BACKFILL_TASK, { kwargs });
    await this.invalidatePlanCache();
    return { taskId, taskName: BACKFILL_TASK, kwargs };
  }

  /**
   * Reparse one existing sitting by re-fetching its LawPhil page.
   * Looks up the (year, study_code, part) triple, derives the slug
   * from the registry, and dispatches ``ingest_sitting`` (idempotent;
   * upserts questions in place).
   */
  async dispatchReparse(sittingId: string): Promise<DispatchedTask> {
    const sitting = await this.prisma.barExamSitting.findUnique({
      where: { id: sittingId },
      select: { year: true, subjectStudyCode: true, part: true },
    });
    if (!sitting) {
      throw new NotFoundException(`Bar exam sitting ${sittingId} not found`);
    }
    if (!sitting.subjectStudyCode) {
      throw new BadRequestException(
        `Sitting ${sittingId} has no subject_study_code; cannot reparse`,
      );
    }

    const slug = this.findSlug(
      sitting.year,
      sitting.subjectStudyCode,
      sitting.part,
    );
    if (!slug) {
      throw new BadRequestException(
        `No LawPhil slug mapping for year=${sitting.year} ` +
          `subject=${sitting.subjectStudyCode} part=${sitting.part ?? 'none'}`,
      );
    }

    const taskId = await this.celery.sendTask(INGEST_TASK, {
      kwargs: { year: sitting.year, subject_slug: slug },
    });
    return {
      taskId,
      taskName: INGEST_TASK,
      kwargs: { year: sitting.year, subject_slug: slug },
    };
  }

  /**
   * Reverse-lookup: (year, study_code, part) → LawPhil slug, using
   * the registry as the single source of truth. Returns ``null`` if
   * the triple is not in the archive.
   */
  private findSlug(
    year: number,
    studyCode: string,
    part: string | null,
  ): string | null {
    for (const [y, slug] of ALL_YEAR_SLUGS) {
      if (y !== year) continue;
      const meta = getSubjectMeta(slug);
      if (!meta) continue;
      if (meta.studyCode === studyCode && (meta.part ?? null) === (part ?? null)) {
        return slug;
      }
    }
    return null;
  }
}
