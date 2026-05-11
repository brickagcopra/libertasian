import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { CeleryDispatcherService } from '../../common/services/celery-dispatcher.service';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  AdminAnswerReviewStatus,
  DispatchAnswerGenerationDto,
} from './dto';

const GENERATE_TASK = 'bar_exam.generate_answers_for_questions';

/**
 * Hard cap on questions per admin dispatch. The worker enforces the same
 * cap (see ``MAX_QUESTIONS_PER_DISPATCH`` in ``bar_exam_answer_tasks.py``)
 * — defense in depth so a manually-crafted Celery message can't bypass it.
 */
export const MAX_QUESTIONS_PER_DISPATCH = 50;

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

export interface DispatchResult {
  taskId: string;
  taskName: string;
  questionCount: number;
  truncated: boolean;
}

const QUESTION_EXCERPT_LENGTH = 220;

@Injectable()
export class AdminBarExamAnswersService {
  private readonly logger = new Logger(AdminBarExamAnswersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly celery: CeleryDispatcherService,
  ) {}

  async listAnswers(opts: {
    reviewStatus?: AdminAnswerReviewStatus;
    cursor?: string;
    limit?: number;
  }): Promise<ListResult> {
    const limit = opts.limit ?? 25;
    const status = opts.reviewStatus ?? 'pending';

    const rows = await this.prisma.barExamAnswer.findMany({
      where: { reviewStatus: status },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      ...(opts.cursor
        ? { skip: 1, cursor: { id: opts.cursor } }
        : {}),
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

  /**
   * Resolve filters to a list of question ids and dispatch a Celery task.
   * Returns ``{taskId, taskName, questionCount, truncated}``. Hard-caps
   * the resolved set at ``MAX_QUESTIONS_PER_DISPATCH`` BEFORE dispatch —
   * the worker enforces the same cap as a backstop.
   */
  async dispatchGeneration(
    dto: DispatchAnswerGenerationDto,
  ): Promise<DispatchResult> {
    const resolved = await this.resolveQuestionIds(dto);
    if (resolved.length === 0) {
      throw new BadRequestException(
        'No bar exam questions matched the requested filters.',
      );
    }

    const truncated = resolved.length > MAX_QUESTIONS_PER_DISPATCH;
    const ids = truncated
      ? resolved.slice(0, MAX_QUESTIONS_PER_DISPATCH)
      : resolved;

    const taskId = await this.celery.sendTask(GENERATE_TASK, {
      kwargs: { question_ids: ids },
    });

    if (truncated) {
      this.logger.warn(
        `dispatch-generation: requested ${resolved.length}, capped to ${MAX_QUESTIONS_PER_DISPATCH}`,
      );
    }

    return {
      taskId,
      taskName: GENERATE_TASK,
      questionCount: ids.length,
      truncated,
    };
  }

  private async resolveQuestionIds(
    dto: DispatchAnswerGenerationDto,
  ): Promise<string[]> {
    if (dto.questionIds && dto.questionIds.length > 0) {
      // Trust explicit list — the worker still re-checks idempotency per
      // question. We still verify they exist so the audit log isn't
      // littered with phantom UUIDs.
      const rows = await this.prisma.barExamQuestion.findMany({
        where: { id: { in: dto.questionIds } },
        select: { id: true },
      });
      return rows.map((r) => r.id);
    }

    const sittingWhere: Record<string, unknown> = {};
    if (dto.year !== undefined) sittingWhere['year'] = dto.year;
    if (dto.subjectCode) sittingWhere['subjectStudyCode'] = dto.subjectCode;

    const where: Record<string, unknown> = {};
    if (dto.sittingId) {
      where['barExamSittingId'] = dto.sittingId;
    } else if (Object.keys(sittingWhere).length > 0) {
      where['barExamSitting'] = { is: sittingWhere };
    } else {
      // No filters at all — refuse to dispatch the entire corpus by
      // accident. Caller must scope the request.
      throw new BadRequestException(
        'Provide at least one of: questionIds, sittingId, year, or subjectCode.',
      );
    }

    const rows = await this.prisma.barExamQuestion.findMany({
      where,
      select: { id: true },
      // Pull enough to know we hit the cap; the slice happens in the
      // caller so the truncated flag is honest.
      take: MAX_QUESTIONS_PER_DISPATCH + 1,
      orderBy: [{ questionNumber: 'asc' }, { id: 'asc' }],
    });
    return rows.map((r) => r.id);
  }
}

function excerptOf(text: string): string {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= QUESTION_EXCERPT_LENGTH) return trimmed;
  return trimmed.slice(0, QUESTION_EXCERPT_LENGTH - 1).trimEnd() + '…';
}
