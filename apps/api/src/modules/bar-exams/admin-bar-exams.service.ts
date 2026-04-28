import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { CeleryDispatcherService } from '../../common/services/celery-dispatcher.service';
import { PrismaService } from '../../prisma/prisma.service';

const INGEST_TASK = 'bar_exam.ingest_sitting';
const BACKFILL_TASK = 'bar_exam.backfill_lawphil_archive';

/**
 * Map a study_8 subject_code → its LawPhil URL slug for a given year.
 *
 * 2022 introduced split papers (Civil Law I/II, Remedial Law I/II) and
 * renamed several files; everything else carries the 2006-2018 legacy
 * slugs. ``null`` means the (year, subject) combination doesn't have a
 * canonical LawPhil page on record.
 */
function slugForReingest(
  year: number,
  studyCode: string,
  part: string | null,
): string | null {
  if (year === 2022) {
    if (studyCode === 'remedial_law' && part === 'I') return 'remedial-I_Q';
    if (studyCode === 'remedial_law' && part === 'II') return 'remedial-II_Q';
    if (studyCode === 'civil_law' && part === 'I') return 'civil-I_Q';
    if (studyCode === 'civil_law' && part === 'II') return 'civil-II_Q';
    if (studyCode === 'criminal_law') return 'criminalQ';
    if (studyCode === 'mercantile_law') return 'comlawQ';
    if (studyCode === 'political_law') return 'poliQ';
    if (studyCode === 'labor_law') return 'laborQ';
    return null;
  }
  if (year === 2015 && studyCode === 'legal_ethics') return 'legalQ';
  switch (studyCode) {
    case 'legal_ethics':
      return 'ethicQ';
    case 'remedial_law':
      return 'remedialQ';
    case 'criminal_law':
      return 'criminalQ';
    case 'mercantile_law':
      return 'mercanQ';
    case 'civil_law':
      return 'civilQ';
    case 'taxation':
      return 'taxQ';
    case 'labor_law':
      return 'laborQ';
    case 'political_law':
      return 'poliQ';
    default:
      return null;
  }
}

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

@Injectable()
export class AdminBarExamsService {
  private readonly logger = new Logger(AdminBarExamsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly celery: CeleryDispatcherService,
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
   * One of three dispatch shapes:
   *
   * 1. ``{year, subjectSlug}`` → fire ``bar_exam.ingest_sitting`` for that
   *    one paper.
   * 2. ``{year}`` (no slug) → fire ``backfill_lawphil_archive`` capped to
   *    that single year (year_start = year_end = year).
   * 3. neither → fire the full archive backfill.
   *
   * ``limit`` only applies to the backfill shapes.
   */
  async dispatchIngest(input: {
    year?: number;
    subjectSlug?: string;
    limit?: number;
  }): Promise<DispatchedTask> {
    const { year, subjectSlug, limit } = input;
    if (subjectSlug && year === undefined) {
      throw new BadRequestException(
        '`year` is required when `subjectSlug` is provided',
      );
    }

    if (year !== undefined && subjectSlug) {
      const taskId = await this.celery.sendTask(INGEST_TASK, {
        kwargs: { year, subject_slug: subjectSlug },
      });
      return {
        taskId,
        taskName: INGEST_TASK,
        kwargs: { year, subject_slug: subjectSlug },
      };
    }

    const kwargs: Record<string, unknown> = {};
    if (year !== undefined) {
      kwargs['year_start'] = year;
      kwargs['year_end'] = year;
    }
    if (limit !== undefined) {
      kwargs['limit'] = limit;
    }
    const taskId = await this.celery.sendTask(BACKFILL_TASK, { kwargs });
    return { taskId, taskName: BACKFILL_TASK, kwargs };
  }

  /**
   * Reparse one existing sitting by re-fetching its LawPhil page. Looks
   * up the (year, subject_study_code, part) triple, derives the slug,
   * and dispatches ``bar_exam.ingest_sitting`` — which is idempotent and
   * upserts questions in place.
   */
  async dispatchReparse(sittingId: string): Promise<DispatchedTask> {
    const sitting = await this.prisma.barExamSitting.findUnique({
      where: { id: sittingId },
      select: {
        year: true,
        subjectStudyCode: true,
        part: true,
      },
    });
    if (!sitting) {
      throw new NotFoundException(`Bar exam sitting ${sittingId} not found`);
    }
    if (!sitting.subjectStudyCode) {
      throw new BadRequestException(
        `Sitting ${sittingId} has no subject_study_code; cannot reparse`,
      );
    }

    const slug = slugForReingest(
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
}
