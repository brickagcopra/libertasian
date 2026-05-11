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

interface DigestRowForMapping {
  id: string;
  title: string;
  confidenceScore: number | null;
  createdAt: Date;
  summary: string | null;
  facts: string | null;
  petitionerArguments: string | null;
  respondentArguments: string | null;
  issues: string | null;
  ruling: string | null;
  doctrine: string | null;
  dispositive: string | null;
  legalDocument: {
    id: string;
    title: string;
    shortTitle: string | null;
    citationText: string | null;
    court: string | null;
    decisionDate: Date | null;
    subjectAssignments: Array<{
      isPrimary: boolean;
      subject: { code: string; name: string; taxonomyVersion: string };
    }>;
  } | null;
  contentDisclaimer: {
    id: string;
    contentClass: string;
    version: number;
  } | null;
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
    if (query.derivativeType === 'case_digest') {
      return this.listCaseDigests(query);
    }

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
      const digest = await this.findCaseDigestById(id);
      if (digest) {
        return digest;
      }
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

  /**
   * Per-type subjects summary for the Library subject-tile grid. Returns one
   * row per subject in the taxonomy (always the full 8 for study_8, even when
   * count=0), with counts restricted to a single derivative_type that honor
   * the same visibility rules as the public list endpoint.
   */
  async subjectsSummaryByType(
    type: string,
    userId: string,
    organizationId: string,
    taxonomyVersion = 'study_8',
  ): Promise<
    Array<{
      subjectCode: string;
      subjectName: string;
      taxonomyVersion: string;
      totalCount: number;
      approvedCount: number;
    }>
  > {
    const subjects = await this.prisma.subject.findMany({
      where: { taxonomyVersion },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, code: true, name: true, taxonomyVersion: true },
    });

    if (type === 'case_digest') {
      const digestCounts = await Promise.all(
        subjects.map((s) =>
          this.prisma.digest.count({
            where: {
              ...this.caseDigestVisibilityWhere(),
              legalDocument: {
                subjectAssignments: { some: { subjectId: s.id } },
              },
            },
          }),
        ),
      );

      return subjects.map((s, i) => ({
        subjectCode: s.code,
        subjectName: s.name,
        taxonomyVersion: s.taxonomyVersion,
        totalCount: digestCounts[i] ?? 0,
        approvedCount: digestCounts[i] ?? 0,
      }));
    }

    const visibilityOr: Prisma.DerivativeArtifactWhereInput[] = [
      { createdByUserId: userId },
      { organizationId, visibility: { not: 'private' } },
      { visibility: 'public_editorial', reviewStatus: 'approved' },
    ];

    const [totalCounts, approvedCounts] = await Promise.all([
      this.prisma.documentSubjectAssignment.groupBy({
        by: ['subjectId'],
        where: {
          subjectId: { in: subjects.map((s) => s.id) },
          derivativeArtifact: {
            deletedAt: null,
            derivativeType: type,
            OR: visibilityOr,
          },
        },
        _count: { _all: true },
      }),
      this.prisma.documentSubjectAssignment.groupBy({
        by: ['subjectId'],
        where: {
          subjectId: { in: subjects.map((s) => s.id) },
          derivativeArtifact: {
            deletedAt: null,
            derivativeType: type,
            visibility: 'public_editorial',
            reviewStatus: 'approved',
          },
        },
        _count: { _all: true },
      }),
    ]);

    const totalMap = new Map(totalCounts.map((c) => [c.subjectId, c._count._all]));
    const approvedMap = new Map(approvedCounts.map((c) => [c.subjectId, c._count._all]));

    return subjects.map((s) => ({
      subjectCode: s.code,
      subjectName: s.name,
      taxonomyVersion: s.taxonomyVersion,
      totalCount: totalMap.get(s.id) ?? 0,
      approvedCount: approvedMap.get(s.id) ?? 0,
    }));
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

    const [counts, digestCounts] = await Promise.all([
      this.prisma.documentSubjectAssignment.groupBy({
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
      }),
      Promise.all(
        subjects.map((s) =>
          this.prisma.digest.count({
            where: {
              ...this.caseDigestVisibilityWhere(),
              legalDocument: {
                subjectAssignments: { some: { subjectId: s.id } },
              },
            },
          }),
        ),
      ),
    ]);

    const countMap = new Map(counts.map((c) => [c.subjectId, c._count._all]));

    const result = subjects.map((s, i) => ({
      code: s.code,
      name: s.name,
      taxonomyVersion: s.taxonomyVersion,
      count: (countMap.get(s.id) ?? 0) + (digestCounts[i] ?? 0),
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
   * Case digests still live in the legacy `digests` table — the auto-promote
   * sweep flips them to public_editorial without changing review_status from
   * 'ai_generated', so accept both 'approved' and 'ai_generated' here.
   */
  private caseDigestVisibilityWhere(): Prisma.DigestWhereInput {
    return {
      visibility: 'public_editorial',
      reviewStatus: { in: ['approved', 'ai_generated'] },
    };
  }

  private async listCaseDigests(query: ListDerivativesQueryDto): Promise<{
    items: DerivativeListItem[];
    meta: { hasNext: boolean; nextCursor?: string; limit: number };
  }> {
    const limit = query.limit ?? 20;
    const taxonomyVersion = query.taxonomyVersion ?? 'study_8';

    const where: Prisma.DigestWhereInput = this.caseDigestVisibilityWhere();

    if (query.subjectCode) {
      where.legalDocument = {
        subjectAssignments: {
          some: {
            subject: {
              code: query.subjectCode,
              taxonomyVersion,
            },
          },
        },
      };
    }

    if (query.search) {
      where.title = { contains: query.search, mode: 'insensitive' };
    }

    const rows = await this.prisma.digest.findMany({
      where,
      take: limit + 1,
      ...(query.cursor && { skip: 1, cursor: { id: query.cursor } }),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: {
        legalDocument: {
          select: {
            id: true,
            title: true,
            shortTitle: true,
            citationText: true,
            court: true,
            decisionDate: true,
            subjectAssignments: {
              include: {
                subject: {
                  select: { code: true, name: true, taxonomyVersion: true },
                },
              },
            },
          },
        },
        contentDisclaimer: {
          select: { id: true, contentClass: true, version: true },
        },
      },
    });

    const hasNext = rows.length > limit;
    const pageRows = hasNext ? rows.slice(0, limit) : rows;
    const lastRow = pageRows[pageRows.length - 1];
    const nextCursor = hasNext && lastRow ? lastRow.id : undefined;

    const items: DerivativeListItem[] = pageRows.map((row) => this.mapDigestToListItem(row));

    return { items, meta: { hasNext, nextCursor, limit } };
  }

  private async findCaseDigestById(id: string): Promise<DerivativeDetail | null> {
    const row = await this.prisma.digest.findFirst({
      where: { id, ...this.caseDigestVisibilityWhere() },
      include: {
        legalDocument: {
          select: {
            id: true,
            title: true,
            shortTitle: true,
            citationText: true,
            court: true,
            decisionDate: true,
            subjectAssignments: {
              include: {
                subject: {
                  select: { code: true, name: true, taxonomyVersion: true },
                },
              },
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
      },
    });

    if (!row) return null;

    const listItem = this.mapDigestToListItem(row);
    return {
      ...listItem,
      contentJson: this.buildDigestContentJson(row),
      contentPlainText: null,
      disclaimerBody: row.contentDisclaimer
        ? {
            bodyHtml: row.contentDisclaimer.bodyHtml,
            bodyPlain: row.contentDisclaimer.bodyPlain,
          }
        : null,
      mcqQuestion: null,
      essayPrompt: null,
    };
  }

  private mapDigestToListItem(row: DigestRowForMapping): DerivativeListItem {
    const subjectAssignments = row.legalDocument?.subjectAssignments ?? [];
    return {
      id: row.id,
      title: row.title,
      derivativeType: 'case_digest',
      confidenceScore: row.confidenceScore,
      createdAt: row.createdAt,
      publishedAt: null,
      audience: 'both',
      language: 'en',
      sourceDocument: row.legalDocument
        ? {
            id: row.legalDocument.id,
            title: row.legalDocument.title,
            shortTitle: row.legalDocument.shortTitle,
            citationText: row.legalDocument.citationText,
            court: row.legalDocument.court,
            decisionDate: row.legalDocument.decisionDate,
          }
        : null,
      subjects: subjectAssignments.map((a) => ({
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
      isGated: false,
      upgradeTier: null,
    };
  }

  private buildDigestContentJson(row: DigestRowForMapping): Prisma.JsonValue {
    return {
      summary: row.summary,
      facts: row.facts,
      petitionerArguments: row.petitionerArguments,
      respondentArguments: row.respondentArguments,
      issues: row.issues,
      ruling: row.ruling,
      doctrine: row.doctrine,
      dispositive: row.dispositive,
    } as Prisma.JsonValue;
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
