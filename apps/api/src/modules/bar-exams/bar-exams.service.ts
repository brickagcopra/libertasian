import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';

/**
 * Public read API for past Philippine Bar Examinations sourced from
 * LawPhil. Reads only — write paths live in the admin module.
 *
 * The DB schema models a ``BarExamSitting`` (year, part, subject) joined
 * to a list of ``BarExamQuestion`` rows. The public surface exposes those
 * groupings as: hub (years) → year detail (subjects per year) → sitting
 * detail (full questions for one paper).
 */
@Injectable()
export class BarExamsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * List every sitting that has at least one parsed question, grouped by
   * year (DESC) and decorated with the question count. Used by the
   * /bar-exams hub page so each year-card shows how complete it is.
   */
  async listAll() {
    const grouped = await this.prisma.barExamSitting.findMany({
      where: { sourceDocumentId: { not: null } },
      orderBy: [{ year: 'desc' }, { subjectStudyCode: 'asc' }, { part: 'asc' }],
      select: {
        id: true,
        year: true,
        part: true,
        subjectStudyCode: true,
        subjectBarAdminCode: true,
        chairperson: true,
        sourceUrl: true,
        _count: { select: { questions: true } },
      },
    });

    return groupSittingsByYear(grouped);
  }

  /**
   * Return only the subjects sat in a given year. ``404`` if the year is
   * unknown — keeps the public surface honest about which years LawPhil
   * actually has (LawPhil is missing 2019, 2020, 2021 outright).
   */
  async listByYear(year: number) {
    const sittings = await this.prisma.barExamSitting.findMany({
      where: { year, sourceDocumentId: { not: null } },
      orderBy: [{ subjectStudyCode: 'asc' }, { part: 'asc' }],
      select: {
        id: true,
        year: true,
        part: true,
        subjectStudyCode: true,
        subjectBarAdminCode: true,
        chairperson: true,
        sourceUrl: true,
        _count: { select: { questions: true } },
      },
    });

    if (sittings.length === 0) {
      throw new NotFoundException(`No bar exam sittings on record for ${year}`);
    }

    return {
      year,
      subjects: sittings.map(toSubjectSummary),
    };
  }

  /**
   * Sitting detail view: header metadata + all questions ordered by
   * question_number ASC. ``404`` if the (year, subjectCode, part?) triple
   * does not match any sitting.
   *
   * ``part`` is treated as an optional refinement: ``/bar-exams/2022/
   * remedial_law`` would otherwise be ambiguous because Remedial Law I and
   * II sat as two separate papers in 2022. Callers pass the part via
   * ``subjectCode`` using the disambiguating slug ("remedial_law-I" /
   * "remedial_law-II"), or the controller's URL helpers do it for them.
   */
  async getSittingByYearAndSubject(
    year: number,
    subjectStudyCode: string,
    part: string | null,
  ) {
    const sitting = await this.prisma.barExamSitting.findFirst({
      where: {
        year,
        subjectStudyCode,
        ...(part === null ? { part: null } : { part }),
      },
      select: {
        id: true,
        year: true,
        part: true,
        subjectStudyCode: true,
        subjectBarAdminCode: true,
        chairperson: true,
        sourceUrl: true,
        sourceDocumentId: true,
        questions: {
          orderBy: { questionNumber: 'asc' },
          select: {
            id: true,
            questionNumber: true,
            questionText: true,
            subPartsCount: true,
            sourceSectionAnchor: true,
          },
        },
      },
    });

    if (!sitting) {
      throw new NotFoundException(
        `No bar exam sitting for year=${year} subject=${subjectStudyCode}` +
          (part ? ` part=${part}` : ''),
      );
    }

    return {
      sitting: {
        id: sitting.id,
        year: sitting.year,
        part: sitting.part,
        subjectStudyCode: sitting.subjectStudyCode,
        subjectBarAdminCode: sitting.subjectBarAdminCode,
        chairperson: sitting.chairperson,
        sourceUrl: sitting.sourceUrl,
        sourceDocumentId: sitting.sourceDocumentId,
        questionCount: sitting.questions.length,
      },
      questions: sitting.questions.map((q) => ({
        id: q.id,
        number: q.questionNumber,
        text: q.questionText,
        subPartsCount: q.subPartsCount,
        sourceSectionAnchor: q.sourceSectionAnchor,
      })),
    };
  }
}

interface SittingRow {
  id: string;
  year: number;
  part: string | null;
  subjectStudyCode: string | null;
  subjectBarAdminCode: string | null;
  chairperson: string | null;
  sourceUrl: string | null;
  _count: { questions: number };
}

function toSubjectSummary(s: SittingRow) {
  return {
    sittingId: s.id,
    code: s.subjectStudyCode,
    adminCode: s.subjectBarAdminCode,
    part: s.part,
    chairperson: s.chairperson,
    sourceUrl: s.sourceUrl,
    questionCount: s._count.questions,
  };
}

function groupSittingsByYear(rows: SittingRow[]) {
  const map = new Map<number, ReturnType<typeof toSubjectSummary>[]>();
  for (const row of rows) {
    const list = map.get(row.year) ?? [];
    list.push(toSubjectSummary(row));
    map.set(row.year, list);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => b - a)
    .map(([year, subjects]) => ({ year, subjects }));
}
