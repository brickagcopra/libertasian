import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PaywallException } from '../../common/exceptions/paywall.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/services/redis.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { ListDerivativesQueryDto } from './dto';

const GATED_DERIVATIVE_TYPES = new Set([
  'mcq_question',
  'essay_model_answer',
  'suggested_bar_answer',
  'sample_pleading',
  'sample_contract',
]);

const UPGRADE_TIER = 'edu';

const SUBJECT_SUMMARY_TTL_SECONDS = 300;

const PREVIEW_IDS_CACHE_KEY = 'cache:derivative-preview-ids';
const PREVIEW_IDS_CACHE_TTL = 60;

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

interface BarAnswerRowForMapping {
  id: string;
  answerText: string;
  structuredAnswerJson: Prisma.JsonValue | null;
  confidence: number | null;
  createdAt: Date;
  question: {
    questionNumber: number;
    questionText: string;
    barExamSitting: {
      year: number;
      subjectStudyCode: string | null;
      taxonomyVersion: string;
    };
  };
}

interface EssayPromptRowForListMapping {
  id: string;
  title: string;
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
  subjectAssignments: Array<{
    isPrimary: boolean;
    subject: { code: string; name: string; taxonomyVersion: string };
  }>;
  contentDisclaimer: {
    id: string;
    contentClass: string;
    version: number;
  } | null;
}

interface EssayPromptRowForDetailProjection extends EssayPromptRowForListMapping {
  contentJson: Prisma.JsonValue | null;
  contentDisclaimer: {
    id: string;
    contentClass: string;
    version: number;
    bodyHtml: string;
    bodyPlain: string;
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
    previewOnly = false,
  ): Promise<{
    items: DerivativeListItem[];
    meta: {
      hasNext: boolean;
      nextCursor?: string;
      limit: number;
      previewMode?: boolean;
      lockedCount?: number;
      upgradeRequired?: boolean;
    };
  }> {
    if (query.derivativeType === 'case_digest') {
      return this.listCaseDigests(query);
    }

    if (query.derivativeType === 'suggested_bar_answer') {
      return this.listSuggestedBarAnswers(query, organizationId);
    }

    if (query.derivativeType === 'essay_model_answer') {
      return this.listEssayModelAnswers(userId, query, organizationId);
    }

    if (previewOnly) {
      return this.listForPreview(organizationId, query);
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
    previewOnly = false,
    asType?: string,
  ): Promise<DerivativeDetail> {
    if (previewOnly) {
      const previewIds = await this.getFreePreviewIds();
      if (!previewIds.has(id)) {
        // Throw BEFORE the tenant lookup so the existence of the row is
        // never leaked across tenants for free-tier callers.
        throw new PaywallException({ corpus: 'derivatives' });
      }
    }

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
      const barAnswer = await this.findSuggestedBarAnswerById(id, organizationId);
      if (barAnswer) {
        return barAnswer;
      }
      // Return 404 (not 403) to avoid leaking existence across tenants.
      throw new NotFoundException('Derivative artifact not found');
    }

    const planCode = await this.subscriptions.getPlanCode(organizationId);
    const meetsEdu = SubscriptionsService.meetsMinimumTier(planCode, UPGRADE_TIER);

    // CARVE-OUT: essay_model_answer is a read-only projection OF the loaded
    // essay_prompt artifact (the id is the essay_prompt UUID; ParseUUIDPipe
    // forbids synthetic ids, so the client passes ?as=essay_model_answer to
    // request the projection). Project content_json.modelAnswer → the renderer
    // contract and gate at edu tier exactly like suggested_bar_answer.
    if (asType === 'essay_model_answer' && row.derivativeType === 'essay_prompt') {
      return this.projectEssayModelAnswerDetail(row, !meetsEdu);
    }

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
      contentJson: gated
        ? this.redactGatedContent(row.contentJson, row.derivativeType)
        : row.contentJson,
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
          // CARVE-OUT: count under caseDigestVisibilityWhere() (visibility='public_editorial', reviewStatus in approved/ai_generated); forTenant() would miscount
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

    if (type === 'suggested_bar_answer') {
      const answerCounts = await Promise.all(
        subjects.map((s) =>
          // CARVE-OUT: count under suggestedBarAnswerVisibilityWhere() (visibility='public_editorial', reviewStatus='approved') against the foreign bar_exam_answers table; forTenant() would miscount this cross-org public_editorial read
          this.prisma.barExamAnswer.count({
            where: {
              ...this.suggestedBarAnswerVisibilityWhere(),
              question: {
                barExamSitting: {
                  subjectStudyCode: s.code,
                  taxonomyVersion,
                },
              },
            },
          }),
        ),
      );

      // total === approved for suggested_bar_answer (single visibility-filter
      // count serves both — only approved + public_editorial rows are surfaced).
      return subjects.map((s, i) => ({
        subjectCode: s.code,
        subjectName: s.name,
        taxonomyVersion: s.taxonomyVersion,
        totalCount: answerCounts[i] ?? 0,
        approvedCount: answerCounts[i] ?? 0,
      }));
    }

    if (type === 'essay_model_answer') {
      // CARVE-OUT: essay_model_answer surfaces approved essay_prompt artifacts as
      // a read-only projection, so count under derivativeType='essay_prompt' with
      // the public_editorial + approved visibility filter. total === approved
      // (only approved + public_editorial essay prompts are bridged).
      const counts = await this.prisma.documentSubjectAssignment.groupBy({
        by: ['subjectId'],
        where: {
          subjectId: { in: subjects.map((s) => s.id) },
          derivativeArtifact: {
            deletedAt: null,
            derivativeType: 'essay_prompt',
            visibility: 'public_editorial',
            reviewStatus: 'approved',
          },
        },
        _count: { _all: true },
      });

      const countMap = new Map(counts.map((c) => [c.subjectId, c._count._all]));

      return subjects.map((s) => ({
        subjectCode: s.code,
        subjectName: s.name,
        taxonomyVersion: s.taxonomyVersion,
        totalCount: countMap.get(s.id) ?? 0,
        approvedCount: countMap.get(s.id) ?? 0,
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

    const [counts, digestCounts, barAnswerCounts] = await Promise.all([
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
          // CARVE-OUT: count under caseDigestVisibilityWhere() (visibility='public_editorial', reviewStatus in approved/ai_generated); forTenant() would miscount
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
      Promise.all(
        subjects.map((s) =>
          // CARVE-OUT: count under suggestedBarAnswerVisibilityWhere() (visibility='public_editorial', reviewStatus='approved') against the foreign bar_exam_answers table; forTenant() would miscount this cross-org public_editorial read
          this.prisma.barExamAnswer.count({
            where: {
              ...this.suggestedBarAnswerVisibilityWhere(),
              question: {
                barExamSitting: {
                  subjectStudyCode: s.code,
                  taxonomyVersion,
                },
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
      count: (countMap.get(s.id) ?? 0) + (digestCounts[i] ?? 0) + (barAnswerCounts[i] ?? 0),
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

  /**
   * One approved, non-deleted artifact id per `derivativeType`, ordered by
   * `published_at DESC NULLS LAST, id ASC`. Used by the free-plan preview
   * cap. Cached 60s.
   */
  async getFreePreviewIds(): Promise<Set<string>> {
    if (this.redis) {
      try {
        const cached = await this.redis.get(PREVIEW_IDS_CACHE_KEY);
        if (cached) {
          return new Set(JSON.parse(cached) as string[]);
        }
      } catch (err) {
        this.logger.warn(
          `Derivative preview-ids cache read failed: ${(err as Error).message}`,
        );
      }
    }

    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT DISTINCT ON (derivative_type) id
      FROM derivative_artifacts
      WHERE review_status = 'approved' AND deleted_at IS NULL
      ORDER BY derivative_type, published_at DESC NULLS LAST, id ASC
    `;
    const ids = rows.map((r) => r.id);

    if (this.redis) {
      try {
        await this.redis.set(
          PREVIEW_IDS_CACHE_KEY,
          JSON.stringify(ids),
          PREVIEW_IDS_CACHE_TTL,
        );
      } catch (err) {
        this.logger.warn(
          `Derivative preview-ids cache write failed: ${(err as Error).message}`,
        );
      }
    }

    return new Set(ids);
  }

  private async listForPreview(
    organizationId: string,
    query: ListDerivativesQueryDto,
  ): Promise<{
    items: DerivativeListItem[];
    meta: {
      hasNext: boolean;
      nextCursor?: string;
      limit: number;
      previewMode: boolean;
      lockedCount: number;
      upgradeRequired: boolean;
    };
  }> {
    const limit = query.limit ?? 20;
    const previewIds = await this.getFreePreviewIds();
    const previewIdList = Array.from(previewIds);

    const baseWhere: Prisma.DerivativeArtifactWhereInput = {
      deletedAt: null,
      reviewStatus: 'approved',
      visibility: 'public_editorial',
    };
    if (query.derivativeType) {
      baseWhere.derivativeType = query.derivativeType;
    }

    const lockedCount = previewIdList.length === 0
      ? 0
      : await this.prisma.derivativeArtifact.count({
          where: { ...baseWhere, id: { notIn: previewIdList } },
        });

    const rows = previewIdList.length === 0
      ? []
      : await this.prisma.derivativeArtifact.findMany({
          where: { ...baseWhere, id: { in: previewIdList } },
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
              select: { id: true, contentClass: true, version: true },
            },
          },
        });

    const planCode = await this.subscriptions.getPlanCode(organizationId);
    const meetsEdu = SubscriptionsService.meetsMinimumTier(planCode, UPGRADE_TIER);

    const items: DerivativeListItem[] = rows.map((row) => {
      // KEEP the existing GATED_DERIVATIVE_TYPES logic — preview cap is
      // additive. A free user sees ≤1 per type AND those items remain
      // isGated when they're MCQ/essay (need edu+ to read answers).
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

    return {
      items,
      meta: {
        hasNext: false,
        limit,
        previewMode: true,
        lockedCount,
        upgradeRequired: true,
      },
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

    // CARVE-OUT: read under caseDigestVisibilityWhere() (visibility='public_editorial'); forTenant() would 404 cross-org
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
    // CARVE-OUT: read under caseDigestVisibilityWhere() (visibility='public_editorial'); forTenant() would 404 cross-org
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
   * Suggested bar answers live in the foreign `bar_exam_answers` table (one
   * approved answer per past bar exam question). Only admin-approved,
   * public_editorial answers are surfaced — the same public, cross-org read
   * rationale as the case_digest bridge. Treated as public (never paid-gated).
   */
  private suggestedBarAnswerVisibilityWhere(): Prisma.BarExamAnswerWhereInput {
    return {
      reviewStatus: 'approved',
      visibility: 'public_editorial',
    };
  }

  /**
   * Maps a taxonomy's subject `code` → its human name. `bar_exam_sittings`
   * only stores the subject_study_code string, so we resolve display names via
   * the Subject table for the requested taxonomy version.
   */
  private async subjectNameMap(
    taxonomyVersion: string,
  ): Promise<Map<string, { name: string; taxonomyVersion: string }>> {
    const subjects = await this.prisma.subject.findMany({
      where: { taxonomyVersion },
      select: { code: true, name: true, taxonomyVersion: true },
    });
    return new Map(
      subjects.map((s) => [s.code, { name: s.name, taxonomyVersion: s.taxonomyVersion }]),
    );
  }

  private async listSuggestedBarAnswers(
    query: ListDerivativesQueryDto,
    organizationId: string,
  ): Promise<{
    items: DerivativeListItem[];
    meta: { hasNext: boolean; nextCursor?: string; limit: number };
  }> {
    const limit = query.limit ?? 20;
    const taxonomyVersion = query.taxonomyVersion ?? 'study_8';

    const where: Prisma.BarExamAnswerWhereInput = this.suggestedBarAnswerVisibilityWhere();

    const questionWhere: Prisma.BarExamQuestionWhereInput = {};
    if (query.subjectCode) {
      questionWhere.barExamSitting = {
        subjectStudyCode: query.subjectCode,
        taxonomyVersion,
      };
    }
    if (query.search) {
      questionWhere.questionText = { contains: query.search, mode: 'insensitive' };
    }
    if (Object.keys(questionWhere).length > 0) {
      where.question = questionWhere;
    }

    // CARVE-OUT: read under suggestedBarAnswerVisibilityWhere() (visibility='public_editorial'); forTenant() would 404 these cross-org public reads
    const rows = await this.prisma.barExamAnswer.findMany({
      where,
      take: limit + 1,
      ...(query.cursor && { skip: 1, cursor: { id: query.cursor } }),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: {
        question: {
          select: {
            questionNumber: true,
            questionText: true,
            barExamSitting: {
              select: { year: true, subjectStudyCode: true, taxonomyVersion: true },
            },
          },
        },
      },
    });

    const hasNext = rows.length > limit;
    const pageRows = hasNext ? rows.slice(0, limit) : rows;
    const lastRow = pageRows[pageRows.length - 1];
    const nextCursor = hasNext && lastRow ? lastRow.id : undefined;

    // suggested_bar_answer is an edu-tier paid feature (in GATED_DERIVATIVE_TYPES);
    // gate it consistently with the dedicated /bar-exams paywall. One plan lookup
    // per call — never N+1 across rows.
    const planCode = await this.subscriptions.getPlanCode(organizationId);
    const meetsEdu = SubscriptionsService.meetsMinimumTier(planCode, UPGRADE_TIER);
    const gated = GATED_DERIVATIVE_TYPES.has('suggested_bar_answer') && !meetsEdu;

    const subjectNameByCode = await this.subjectNameMap(taxonomyVersion);
    const items: DerivativeListItem[] = pageRows.map((row) =>
      this.mapBarAnswerToListItem(row, subjectNameByCode, gated),
    );

    return { items, meta: { hasNext, nextCursor, limit } };
  }

  private async findSuggestedBarAnswerById(
    id: string,
    organizationId: string,
  ): Promise<DerivativeDetail | null> {
    // CARVE-OUT: read under suggestedBarAnswerVisibilityWhere() (visibility='public_editorial'); forTenant() would 404 these cross-org public reads
    const row = await this.prisma.barExamAnswer.findFirst({
      where: { id, ...this.suggestedBarAnswerVisibilityWhere() },
      include: {
        question: {
          select: {
            questionNumber: true,
            questionText: true,
            barExamSitting: {
              select: { year: true, subjectStudyCode: true, taxonomyVersion: true },
            },
          },
        },
      },
    });

    if (!row) return null;

    // suggested_bar_answer is an edu-tier paid feature (in GATED_DERIVATIVE_TYPES);
    // gate it consistently with the dedicated /bar-exams paywall.
    const planCode = await this.subscriptions.getPlanCode(organizationId);
    const meetsEdu = SubscriptionsService.meetsMinimumTier(planCode, UPGRADE_TIER);
    const gated = GATED_DERIVATIVE_TYPES.has('suggested_bar_answer') && !meetsEdu;

    // Resolve subject display names against the sitting's own taxonomy version.
    const subjectNameByCode = await this.subjectNameMap(
      row.question.barExamSitting.taxonomyVersion,
    );
    const listItem = this.mapBarAnswerToListItem(row, subjectNameByCode, gated);
    const subjectName =
      listItem.subjects[0]?.name ?? row.question.barExamSitting.subjectStudyCode ?? '';

    const contentJson = this.buildBarAnswerContentJson(row, subjectName);

    return {
      ...listItem,
      // Redact answer-side content (suggestedAnswer, annotations) server-side for
      // gated tiers so it never reaches the client. questionText/barYear/
      // examSubject remain visible for the preview.
      contentJson: gated
        ? this.redactGatedContent(contentJson, 'suggested_bar_answer')
        : contentJson,
      contentPlainText: null,
      disclaimerBody: null,
      mcqQuestion: null,
      essayPrompt: null,
    };
  }

  private mapBarAnswerToListItem(
    row: BarAnswerRowForMapping,
    subjectNameByCode: Map<string, { name: string; taxonomyVersion: string }>,
    gated: boolean,
  ): DerivativeListItem {
    const sitting = row.question.barExamSitting;
    const code = sitting.subjectStudyCode ?? '';
    const subjectMeta = code ? subjectNameByCode.get(code) : undefined;
    const subjectName = subjectMeta?.name ?? code;
    const taxonomyVersion = subjectMeta?.taxonomyVersion ?? sitting.taxonomyVersion;

    const title = `${subjectName} — Bar ${sitting.year} Q${row.question.questionNumber}`;

    return {
      id: row.id,
      title,
      derivativeType: 'suggested_bar_answer',
      confidenceScore: row.confidence,
      createdAt: row.createdAt,
      publishedAt: null,
      audience: 'both',
      language: 'en',
      sourceDocument: null,
      subjects: code
        ? [{ code, name: subjectName, taxonomyVersion, isPrimary: true }]
        : [],
      disclaimer: null,
      // Paid-gated at edu tier, mirroring GATED_DERIVATIVE_TYPES and the
      // dedicated /bar-exams paywall (NOT free like case_digest).
      isGated: gated,
      upgradeTier: gated ? UPGRADE_TIER : null,
    };
  }

  private buildBarAnswerContentJson(
    row: BarAnswerRowForMapping,
    subjectName: string,
  ): Prisma.JsonValue {
    const content: Record<string, Prisma.JsonValue> = {
      barYear: row.question.barExamSitting.year,
      examSubject: subjectName,
      questionText: row.question.questionText,
      suggestedAnswer: row.answerText,
    };

    // annotations[] and sourceAttribution are optional renderer extras carried
    // in structured_answer_json — surface them only when present.
    const structured = row.structuredAnswerJson;
    if (structured && typeof structured === 'object' && !Array.isArray(structured)) {
      const obj = structured as Record<string, Prisma.JsonValue>;
      if (Array.isArray(obj['annotations'])) {
        content['annotations'] = obj['annotations'];
      }
      if (typeof obj['sourceAttribution'] === 'string') {
        content['sourceAttribution'] = obj['sourceAttribution'];
      }
    }

    return content as Prisma.JsonValue;
  }

  /**
   * Essay model answers are a read-only projection of approved `essay_prompt`
   * artifacts: every approved essay prompt already embeds its worked answer in
   * `content_json.modelAnswer` (ALAC outline) plus `content_json.promptText`.
   * No new rows are written — the Library simply surfaces that embedded answer
   * under the `essay_model_answer` type. Edu-gated, mirroring suggested_bar_answer.
   */
  private async listEssayModelAnswers(
    userId: string,
    query: ListDerivativesQueryDto,
    organizationId: string,
  ): Promise<{
    items: DerivativeListItem[];
    meta: { hasNext: boolean; nextCursor?: string; limit: number };
  }> {
    const limit = query.limit ?? 20;
    const taxonomyVersion = query.taxonomyVersion ?? 'study_8';

    const where: Prisma.DerivativeArtifactWhereInput = {
      deletedAt: null,
      derivativeType: 'essay_prompt',
      AND: [
        {
          OR: [
            { createdByUserId: userId },
            { organizationId, visibility: { not: 'private' } },
            { visibility: 'public_editorial', reviewStatus: 'approved' },
          ],
        },
      ],
    };

    if (query.subjectCode) {
      where.subjectAssignments = {
        some: {
          subject: { code: query.subjectCode, taxonomyVersion },
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
          select: { id: true, contentClass: true, version: true },
        },
      },
    });

    const hasNext = rows.length > limit;
    const pageRows = hasNext ? rows.slice(0, limit) : rows;
    const lastRow = pageRows[pageRows.length - 1];
    const nextCursor = hasNext && lastRow ? lastRow.id : undefined;

    // essay_model_answer is an edu-tier paid feature (in GATED_DERIVATIVE_TYPES);
    // gate consistently with suggested_bar_answer. One plan lookup per call.
    const planCode = await this.subscriptions.getPlanCode(organizationId);
    const meetsEdu = SubscriptionsService.meetsMinimumTier(planCode, UPGRADE_TIER);
    const gated = GATED_DERIVATIVE_TYPES.has('essay_model_answer') && !meetsEdu;

    const items: DerivativeListItem[] = pageRows.map((row) =>
      this.mapEssayPromptToModelAnswerListItem(row, gated),
    );

    return { items, meta: { hasNext, nextCursor, limit } };
  }

  private essayModelAnswerTitle(promptTitle: string): string {
    return `Model Answer — ${promptTitle}`;
  }

  private mapEssayPromptToModelAnswerListItem(
    row: EssayPromptRowForListMapping,
    gated: boolean,
  ): DerivativeListItem {
    return {
      id: row.id,
      title: this.essayModelAnswerTitle(row.title),
      derivativeType: 'essay_model_answer',
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
      // Paid-gated at edu tier, mirroring GATED_DERIVATIVE_TYPES (NOT free).
      isGated: gated,
      upgradeTier: gated ? UPGRADE_TIER : null,
    };
  }

  private projectEssayModelAnswerDetail(
    row: EssayPromptRowForDetailProjection,
    gated: boolean,
  ): DerivativeDetail {
    const contentJson = this.buildEssayModelAnswerContentJson(row.contentJson);
    const listItem = this.mapEssayPromptToModelAnswerListItem(row, gated);

    return {
      ...listItem,
      // Redact answer-side content (answer.outlineSections + modelAnswer) server-side
      // for gated tiers so the worked answer never reaches free clients. promptRef
      // (the essay prompt text) stays visible for the preview.
      contentJson: gated
        ? this.redactGatedContent(contentJson, 'essay_model_answer')
        : contentJson,
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

  /**
   * Project an `essay_prompt` artifact's embedded model answer into the
   * EssayModelAnswerRenderer contract: `{ promptRef, format: 'alac',
   * answer: { outlineSections } }`. The source carries no writingTips/
   * commonPitfalls, so those are omitted (the renderer treats them as optional).
   */
  private buildEssayModelAnswerContentJson(
    contentJson: Prisma.JsonValue | null,
  ): Prisma.JsonValue {
    const obj =
      contentJson && typeof contentJson === 'object' && !Array.isArray(contentJson)
        ? (contentJson as Record<string, Prisma.JsonValue>)
        : {};

    const promptText = typeof obj['promptText'] === 'string' ? obj['promptText'] : '';

    const modelAnswer = obj['modelAnswer'];
    const rawSections =
      modelAnswer && typeof modelAnswer === 'object' && !Array.isArray(modelAnswer)
        ? (modelAnswer as Record<string, Prisma.JsonValue>)['outlineSections']
        : undefined;
    const outlineSections: Prisma.JsonValue = Array.isArray(rawSections) ? rawSections : [];

    return {
      promptRef: promptText,
      format: 'alac',
      answer: { outlineSections },
    } as Prisma.JsonValue;
  }

  /**
   * Redact answer/solution fields in contentJson for gated tiers. We keep the
   * prompt/stem/question text and strip keys that would reveal the answer,
   * matching the Quimbee-style preview pattern.
   */
  private redactGatedContent(
    content: Prisma.JsonValue | null,
    derivativeType: string,
  ): Prisma.JsonValue | null {
    if (!content || typeof content !== 'object' || Array.isArray(content)) {
      return content;
    }
    const redactedKeys = new Set([
      'correctAnswer',
      'correctOptionId',
      'answer',
      'modelAnswer',
      'suggestedAnswer',
      // bar-answer-specific: annotations are answer-side commentary (renderer
      // already hides them behind isGated; strip them server-side too).
      'annotations',
      'explanation',
      'rationale',
      'solution',
    ]);
    if (derivativeType === 'sample_pleading') {
      // Preview keeps ONLY: pleadingType, caption. Strip the substantive body.
      // NOTE asymmetry: pleading strips 'parties'; sample_contract KEEPS it.
      ['parties', 'preamble', 'sections', 'prayer', 'verification', 'proofOfService'].forEach(
        (k) => redactedKeys.add(k),
      );
    } else if (derivativeType === 'sample_contract') {
      // Preview keeps ONLY: contractType, parties. Strip the substantive body.
      ['recitals', 'clauses', 'schedules', 'signatureBlocks'].forEach((k) =>
        redactedKeys.add(k),
      );
    }
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
