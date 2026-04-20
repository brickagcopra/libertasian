import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/services/redis.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { ListDerivativesQueryDto } from './dto';

const GATED_DERIVATIVE_TYPES = new Set([
  'mcq_question',
  'essay_model_answer',
  'suggested_bar_answer',
]);

const UPGRADE_TIER = 'edu';

const SUBJECT_SUMMARY_TTL_SECONDS = 300;

export interface DerivativeListItem {
  id: string;
  title: string;
  derivativeType: string;
  confidenceScore: number | null;
  createdAt: Date;
  publishedAt: Date | null;
  audience: string;
  language: string;
  sourceDocument: {
    id: string;
    title: string | null;
    shortTitle: string | null;
    citationText: string | null;
    court: string | null;
    decisionDate: Date | null;
  } | null;
  subjects: Array<{
    code: string;
    name: string;
    taxonomyVersion: string;
    isPrimary: boolean;
  }>;
  disclaimer: {
    id: string;
    contentClass: string;
    version: number;
  } | null;
  isGated: boolean;
  upgradeTier: string | null;
}

export interface DerivativeDetail extends DerivativeListItem {
  contentJson: Prisma.JsonValue | null;
  contentPlainText: string | null;
  disclaimerBody: {
    bodyHtml: string;
    bodyPlain: string;
  } | null;
  mcqQuestion: unknown | null;
  essayPrompt: unknown | null;
}

@Injectable()
export class DerivativesService {
  private readonly logger = new Logger(DerivativesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: SubscriptionsService,
    @Optional() private readonly redis?: RedisService,
  ) {}

  async list(
    userId: string,
    organizationId: string,
    query: ListDerivativesQueryDto,
  ): Promise<{
    items: DerivativeListItem[];
    meta: { hasNext: boolean; nextCursor?: string; limit: number };
  }> {
    const limit = query.limit ?? 20;
    const taxonomyVersion = query.taxonomyVersion ?? 'study_8';

    const where: Prisma.DerivativeArtifactWhereInput = {
      deletedAt: null,
      AND: [
        {
          OR: [
            { createdByUserId: userId },
            {
              organizationId,
              visibility: { not: 'private' },
            },
            { visibility: 'public_editorial', reviewStatus: 'approved' },
          ],
        },
      ],
    };

    if (query.derivativeType) {
      where.derivativeType = query.derivativeType;
    }

    if (query.subjectCode) {
      where.subjectAssignments = {
        some: {
          subject: {
            code: query.subjectCode,
            taxonomyVersion,
          },
        },
      };
    }

    if (query.search) {
      where.title = { contains: query.search, mode: 'insensitive' };
    }

    const rows = await this.prisma.derivativeArtifact.findMany({
      where,
      take: limit + 1,
      ...(query.cursor && { skip: 1, cursor: { id: query.cursor } }),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: {
        sourceDocument: {
          select: {
            id: true,
            title: true,
            shortTitle: true,
            citationText: true,
            court: true,
            decisionDate: true,
          },
        },
        subjectAssignments: {
          include: {
            subject: {
              select: { code: true, name: true, taxonomyVersion: true },
            },
          },
        },
        contentDisclaimer: {
          select: {
            id: true,
            contentClass: true,
            version: true,
          },
        },
      },
    });

    const hasNext = rows.length > limit;
    const pageRows = hasNext ? rows.slice(0, limit) : rows;
    const lastRow = pageRows[pageRows.length - 1];
    const nextCursor = hasNext && lastRow ? lastRow.id : undefined;

    const planCode = await this.subscriptions.getPlanCode(organizationId);
    const meetsEdu = SubscriptionsService.meetsMinimumTier(planCode, UPGRADE_TIER);

    const items: DerivativeListItem[] = pageRows.map((row) => {
      const gated = GATED_DERIVATIVE_TYPES.has(row.derivativeType) && !meetsEdu;
      return {
        id: row.id,
        title: row.title,
        derivativeType: row.derivativeType,
        confidenceScore: row.confidenceScore,
        createdAt: row.createdAt,
        publishedAt: row.publishedAt,
        audience: row.audience,
        language: row.language,
        sourceDocument: row.sourceDocument
          ? {
              id: row.sourceDocument.id,
              title: row.sourceDocument.title,
              shortTitle: row.sourceDocument.shortTitle,
              citationText: row.sourceDocument.citationText,
              court: row.sourceDocument.court,
              decisionDate: row.sourceDocument.decisionDate,
            }
          : null,
        subjects: row.subjectAssignments.map((a) => ({
          code: a.subject.code,
          name: a.subject.name,
          taxonomyVersion: a.subject.taxonomyVersion,
          isPrimary: a.isPrimary,
        })),
        disclaimer: row.contentDisclaimer
          ? {
              id: row.contentDisclaimer.id,
              contentClass: row.contentDisclaimer.contentClass,
              version: row.contentDisclaimer.version,
            }
          : null,
        isGated: gated,
        upgradeTier: gated ? UPGRADE_TIER : null,
      };
    });

    return { items, meta: { hasNext, nextCursor, limit } };
  }

  async findOne(
    id: string,
    userId: string,
    organizationId: string,
  ): Promise<DerivativeDetail> {
    const row = await this.prisma.derivativeArtifact.findFirst({
      where: {
        id,
        deletedAt: null,
        OR: [
          { createdByUserId: userId },
          { organizationId, visibility: { not: 'private' } },
          { visibility: 'public_editorial', reviewStatus: 'approved' },
        ],
      },
      include: {
        sourceDocument: {
          select: {
            id: true,
            title: true,
            shortTitle: true,
            citationText: true,
            court: true,
            decisionDate: true,
          },
        },
        subjectAssignments: {
          include: {
            subject: {
              select: { code: true, name: true, taxonomyVersion: true },
            },
          },
        },
        contentDisclaimer: {
          select: {
            id: true,
            contentClass: true,
            version: true,
            bodyHtml: true,
            bodyPlain: true,
          },
        },
        mcqQuestion: true,
        essayPrompt: true,
      },
    });

    if (!row) {
      // Return 404 (not 403) to avoid leaking existence across tenants.
      throw new NotFoundException('Derivative artifact not found');
    }

    const planCode = await this.subscriptions.getPlanCode(organizationId);
    const meetsEdu = SubscriptionsService.meetsMinimumTier(planCode, UPGRADE_TIER);
    const gated = GATED_DERIVATIVE_TYPES.has(row.derivativeType) && !meetsEdu;

    return {
      id: row.id,
      title: row.title,
      derivativeType: row.derivativeType,
      confidenceScore: row.confidenceScore,
      createdAt: row.createdAt,
      publishedAt: row.publishedAt,
      audience: row.audience,
      language: row.language,
      contentJson: gated ? this.redactGatedContent(row.contentJson) : row.contentJson,
      contentPlainText: gated ? null : row.contentPlainText,
      sourceDocument: row.sourceDocument
        ? {
            id: row.sourceDocument.id,
            title: row.sourceDocument.title,
            shortTitle: row.sourceDocument.shortTitle,
            citationText: row.sourceDocument.citationText,
            court: row.sourceDocument.court,
            decisionDate: row.sourceDocument.decisionDate,
          }
        : null,
      subjects: row.subjectAssignments.map((a) => ({
        code: a.subject.code,
        name: a.subject.name,
        taxonomyVersion: a.subject.taxonomyVersion,
        isPrimary: a.isPrimary,
      })),
      disclaimer: row.contentDisclaimer
        ? {
            id: row.contentDisclaimer.id,
            contentClass: row.contentDisclaimer.contentClass,
            version: row.contentDisclaimer.version,
          }
        : null,
      disclaimerBody: row.contentDisclaimer
        ? {
            bodyHtml: row.contentDisclaimer.bodyHtml,
            bodyPlain: row.contentDisclaimer.bodyPlain,
          }
        : null,
      mcqQuestion: gated ? null : row.mcqQuestion,
      essayPrompt: gated ? null : row.essayPrompt,
      isGated: gated,
      upgradeTier: gated ? UPGRADE_TIER : null,
    };
  }

  async subjectsSummary(
    taxonomyVersion = 'study_8',
  ): Promise<Array<{ code: string; name: string; taxonomyVersion: string; count: number }>> {
    const cacheKey = `cache:derivatives:subjects:${taxonomyVersion}`;
    if (this.redis) {
      try {
        const cached = await this.redis.get(cacheKey);
        if (cached) {
          return JSON.parse(cached);
        }
      } catch (err) {
        this.logger.warn(`Subject summary cache read failed: ${(err as Error).message}`);
      }
    }

    const subjects = await this.prisma.subject.findMany({
      where: { taxonomyVersion },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, code: true, name: true, taxonomyVersion: true },
    });

    const counts = await this.prisma.documentSubjectAssignment.groupBy({
      by: ['subjectId'],
      where: {
        subjectId: { in: subjects.map((s) => s.id) },
        derivativeArtifact: {
          deletedAt: null,
          visibility: 'public_editorial',
          reviewStatus: 'approved',
        },
      },
      _count: { _all: true },
    });

    const countMap = new Map(counts.map((c) => [c.subjectId, c._count._all]));

    const result = subjects.map((s) => ({
      code: s.code,
      name: s.name,
      taxonomyVersion: s.taxonomyVersion,
      count: countMap.get(s.id) ?? 0,
    }));

    if (this.redis) {
      try {
        await this.redis.set(cacheKey, JSON.stringify(result), SUBJECT_SUMMARY_TTL_SECONDS);
      } catch (err) {
        this.logger.warn(`Subject summary cache write failed: ${(err as Error).message}`);
      }
    }

    return result;
  }

  /**
   * Redact answer/solution fields in contentJson for gated tiers. We keep the
   * prompt/stem/question text and strip keys that would reveal the answer,
   * matching the Quimbee-style preview pattern.
   */
  private redactGatedContent(content: Prisma.JsonValue | null): Prisma.JsonValue | null {
    if (!content || typeof content !== 'object' || Array.isArray(content)) {
      return content;
    }
    const redactedKeys = new Set([
      'correctAnswer',
      'correctOptionId',
      'answer',
      'modelAnswer',
      'suggestedAnswer',
      'explanation',
      'rationale',
      'solution',
    ]);
    const out: Record<string, Prisma.JsonValue> = {};
    for (const [key, value] of Object.entries(content as Record<string, Prisma.JsonValue>)) {
      if (redactedKeys.has(key)) {
        continue;
      }
      out[key] = value;
    }
    return out as Prisma.JsonValue;
  }
}
