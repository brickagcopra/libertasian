import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { Queue } from 'bullmq';

import { PaywallException } from '../../common/exceptions/paywall.exception';
import { RedisService } from '../../common/services/redis.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AssignReviewerDto,
  BatchApproveDto,
  BatchAssignDto,
  BatchRejectDto,
  CreateDigestDto,
  CreateProvenanceDto,
  GenerateDigestDto,
  ListDigestsQueryDto,
  ReviewQueueQueryDto,
  SubmitReviewDto,
  UpdateDigestDto,
} from './dto';

/** Confidence threshold: below this → needs_human_review per CLAUDE.md */
const CONFIDENCE_THRESHOLD = 0.7;

/** Source origins that come from user scans — always private visibility */
export const USER_SCAN_ORIGINS = ['user_scan', 'user_upload', 'camera_capture'];

const PREVIEW_DIGEST_CACHE_KEY = 'cache:digest-preview-id';
const PREVIEW_DIGEST_CACHE_TTL = 60;

@Injectable()
export class DigestsService {
  private readonly logger = new Logger(DigestsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('digests') private readonly digestQueue: Queue,
    @Optional() private readonly redis?: RedisService,
  ) {}

  /**
   * Single newest public_editorial+approved digest id, used as the
   * free-plan preview. Cached 60s in Redis.
   */
  async getFreePreviewDigestId(): Promise<string | null> {
    if (this.redis) {
      try {
        const cached = await this.redis.get(PREVIEW_DIGEST_CACHE_KEY);
        if (cached !== null) {
          // Empty string sentinel means "no rows match" — distinguish from
          // cache miss so we don't re-query on every request.
          return cached === '' ? null : cached;
        }
      } catch (err) {
        this.logger.warn(
          `Digest preview-id cache read failed: ${(err as Error).message}`,
        );
      }
    }

    // CARVE-OUT: public_editorial cross-org read; forTenant() would filter out cross-org rows
    const row = await this.prisma.digest.findFirst({
      where: { visibility: 'public_editorial', reviewStatus: 'approved' },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    const id = row?.id ?? null;

    if (this.redis) {
      try {
        await this.redis.set(
          PREVIEW_DIGEST_CACHE_KEY,
          id ?? '',
          PREVIEW_DIGEST_CACHE_TTL,
        );
      } catch (err) {
        this.logger.warn(
          `Digest preview-id cache write failed: ${(err as Error).message}`,
        );
      }
    }

    return id;
  }

  private async assertDigestPreviewAllowed(id: string): Promise<void> {
    const previewId = await this.getFreePreviewDigestId();
    if (previewId !== id) {
      throw new PaywallException({ corpus: 'digests' });
    }
  }

  /**
   * Create a digest manually (from user action or admin).
   * Enforces visibility rules per CLAUDE.md: user-scan digests are always private.
   */
  async create(dto: CreateDigestDto, userId: string, organizationId: string) {
    // Verify legal document exists if provided
    if (dto.legalDocumentId) {
      const docCount = await this.prisma.legalDocument.count({
        where: { id: dto.legalDocumentId },
      });
      if (docCount === 0) {
        throw new NotFoundException('Legal document not found');
      }
    }

    // Enforce private visibility for user-scan origins
    const visibility = USER_SCAN_ORIGINS.includes(dto.sourceOrigin)
      ? 'private'
      : dto.visibility ?? 'private';

    // Determine review status based on confidence score
    const reviewStatus = this.determineReviewStatus(
      dto.confidenceScore ?? null,
      dto.sourceOrigin,
    );

    return this.prisma.forTenant(organizationId).digest.create({
      data: {
        legalDocumentId: dto.legalDocumentId,
        organizationId,
        userId,
        sourceOrigin: dto.sourceOrigin,
        title: dto.title.trim(),
        digestType: dto.digestType,
        facts: dto.facts?.trim(),
        issues: dto.issues?.trim(),
        ruling: dto.ruling?.trim(),
        doctrine: dto.doctrine?.trim(),
        dispositive: dto.dispositive?.trim(),
        summary: dto.summary?.trim(),
        petitionerArguments: dto.petitionerArguments?.trim(),
        respondentArguments: dto.respondentArguments?.trim(),
        confidenceScore: dto.confidenceScore,
        reviewStatus,
        visibility,
      },
      include: {
        legalDocument: {
          select: {
            id: true,
            title: true,
            shortTitle: true,
            citationText: true,
            grNo: true,
            court: true,
            decisionDate: true,
          },
        },
      },
    });
  }

  /**
   * Get a digest by ID. Enforces user/org access for private digests.
   * When `previewOnly` is true, only the single preview digest id is
   * accessible; other ids 402.
   */
  async findById(
    digestId: string,
    userId: string,
    organizationId: string,
    previewOnly = false,
  ) {
    if (previewOnly) {
      await this.assertDigestPreviewAllowed(digestId);
    }
    // CARVE-OUT: assertDigestAccess (line 1198) permits visibility='public_editorial' cross-org; forTenant() would 404 those
    const digest = await this.prisma.digest.findUnique({
      where: { id: digestId },
      include: {
        legalDocument: {
          select: {
            id: true,
            title: true,
            shortTitle: true,
            citationText: true,
            grNo: true,
            court: true,
            decisionDate: true,
            documentType: true,
            ponente: true,
          },
        },
        reviews: {
          select: {
            id: true,
            verdict: true,
            notes: true,
            truthfulnessScore: true,
            completenessScore: true,
            citationAccuracyScore: true,
            createdAt: true,
            reviewer: {
              select: { id: true, fullName: true },
            },
          },
          orderBy: { createdAt: 'desc' as const },
        },
        _count: {
          select: {
            doctrineExtracts: true,
            editorialFlags: true,
          },
        },
      },
    });

    if (!digest) {
      throw new NotFoundException('Digest not found');
    }

    // Access control: private digests only visible to owner/org members
    this.assertDigestAccess(digest, userId, organizationId);

    return digest;
  }

  /**
   * List digests with cursor-based pagination and filters.
   * Scoped to user's organization for private/org digests.
   * When `previewOnly` is true, returns at most the single newest
   * public_editorial+approved digest with meta.previewMode/lockedCount.
   */
  async list(
    userId: string,
    organizationId: string,
    query: ListDigestsQueryDto,
    previewOnly = false,
  ) {
    const limit = query.limit ?? 20;

    if (previewOnly) {
      const previewId = await this.getFreePreviewDigestId();
      // CARVE-OUT: public_editorial cross-org read; forTenant() would filter out cross-org rows
      const totalApproved = await this.prisma.digest.count({
        where: { visibility: 'public_editorial', reviewStatus: 'approved' },
      });
      const lockedCount = Math.max(0, totalApproved - (previewId ? 1 : 0));

      const items = previewId
        // CARVE-OUT: public_editorial cross-org read; forTenant() would filter out cross-org rows
        ? await this.prisma.digest.findMany({
            where: { id: previewId },
            include: {
              legalDocument: {
                select: {
                  id: true,
                  title: true,
                  shortTitle: true,
                  citationText: true,
                  grNo: true,
                  court: true,
                  decisionDate: true,
                  documentType: true,
                },
              },
            },
          })
        : [];

      return {
        items,
        meta: {
          hasNext: false,
          nextCursor: undefined as string | undefined,
          limit,
          previewMode: true,
          lockedCount,
          upgradeRequired: true,
        },
      };
    }

    const where: Prisma.DigestWhereInput = {
      OR: [
        // User's own private digests
        { userId, visibility: 'private' },
        // Org-visible digests
        { organizationId, visibility: 'org' },
        // Public editorial digests
        { visibility: 'public_editorial', reviewStatus: 'approved' },
      ],
    };

    // Apply filters
    if (query.legalDocumentId) {
      where.legalDocumentId = query.legalDocumentId;
    }
    if (query.digestType) {
      where.digestType = query.digestType;
    }
    if (query.reviewStatus) {
      where.reviewStatus = query.reviewStatus;
    }
    if (query.sourceOrigin) {
      where.sourceOrigin = query.sourceOrigin;
    }
    if (query.visibility) {
      where.visibility = query.visibility;
    }

    // CARVE-OUT: public_editorial cross-org read; forTenant() would filter out cross-org rows
    const digests = await this.prisma.digest.findMany({
      where,
      take: limit + 1,
      ...(query.cursor && { skip: 1, cursor: { id: query.cursor } }),
      // Order by updatedAt so freshly-approved digests (approval bumps updatedAt,
      // not createdAt) surface at the top. id is a deterministic keyset tiebreaker.
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      include: {
        legalDocument: {
          select: {
            id: true,
            title: true,
            shortTitle: true,
            citationText: true,
            grNo: true,
            court: true,
            decisionDate: true,
            documentType: true,
          },
        },
      },
    });

    const hasNext = digests.length > limit;
    const items = hasNext ? digests.slice(0, limit) : digests;
    const lastItem = items[items.length - 1];
    const nextCursor = hasNext && lastItem ? lastItem.id : undefined;

    return {
      items,
      meta: { hasNext, nextCursor, limit },
    };
  }

  /**
   * Update a digest. Only owner can update private digests.
   * Enforces visibility rules for user-scan origins.
   */
  async update(digestId: string, dto: UpdateDigestDto, userId: string, organizationId: string) {
    // CARVE-OUT: assertDigestAccess (line 1198) permits visibility='public_editorial' cross-org; forTenant() would 404 those
    const digest = await this.prisma.digest.findUnique({
      where: { id: digestId },
    });

    if (!digest) {
      throw new NotFoundException('Digest not found');
    }

    this.assertDigestAccess(digest, userId, organizationId);

    // SECURITY: assertDigestAccess permits visibility='public_editorial' for READ
    // (the editorial corpus is world-readable). It must NOT authorize WRITES.
    // Editorial digests are mutated only by their owner, or by editors/reviewers
    // through DigestsAdminController (permission-gated). delete() already enforces
    // owner-only; update() must match or any authenticated user can edit the corpus.
    if (digest.visibility === 'public_editorial' && digest.userId !== userId) {
      throw new ForbiddenException(
        'Editorial digests can only be modified by their owner or an editor',
      );
    }

    // Prevent changing visibility to non-private for user-scan origins
    if (
      dto.visibility &&
      dto.visibility !== 'private' &&
      USER_SCAN_ORIGINS.includes(digest.sourceOrigin)
    ) {
      throw new BadRequestException(
        'Digests from user scans cannot be promoted to non-private visibility',
      );
    }

    const data: Prisma.DigestUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.facts !== undefined) data.facts = dto.facts.trim();
    if (dto.issues !== undefined) data.issues = dto.issues.trim();
    if (dto.ruling !== undefined) data.ruling = dto.ruling.trim();
    if (dto.doctrine !== undefined) data.doctrine = dto.doctrine.trim();
    if (dto.dispositive !== undefined) data.dispositive = dto.dispositive.trim();
    if (dto.summary !== undefined) data.summary = dto.summary.trim();
    if (dto.petitionerArguments !== undefined) data.petitionerArguments = dto.petitionerArguments.trim();
    if (dto.respondentArguments !== undefined) data.respondentArguments = dto.respondentArguments.trim();
    if (dto.confidenceScore !== undefined) data.confidenceScore = dto.confidenceScore;
    if (dto.reviewStatus !== undefined) data.reviewStatus = dto.reviewStatus;
    if (dto.visibility !== undefined) data.visibility = dto.visibility;

    // CARVE-OUT: paired with cross-org-public find above; forTenant() update would inject viewerOrgId into WHERE and silently no-op for cross-org rows
    return this.prisma.digest.update({
      where: { id: digestId },
      data,
      include: {
        legalDocument: {
          select: {
            id: true,
            title: true,
            shortTitle: true,
            citationText: true,
            grNo: true,
          },
        },
      },
    });
  }

  /**
   * Delete a digest. Only owner can delete their own digests.
   */
  async delete(digestId: string, userId: string, organizationId: string) {
    // CARVE-OUT: assertDigestAccess (line 1198) permits visibility='public_editorial' cross-org; forTenant() would 404 those
    const digest = await this.prisma.digest.findUnique({
      where: { id: digestId },
    });

    if (!digest) {
      throw new NotFoundException('Digest not found');
    }

    this.assertDigestAccess(digest, userId, organizationId);

    // Only the creator can delete their own digest
    if (digest.userId !== userId) {
      throw new ForbiddenException('Only the digest creator can delete it');
    }

    // CARVE-OUT: paired with cross-org-public find above; forTenant() update would inject viewerOrgId into WHERE and silently no-op for cross-org rows
    await this.prisma.digest.delete({ where: { id: digestId } });
  }

  /**
   * Trigger digest generation for a legal document.
   * Creates a placeholder digest in 'draft' status.
   * Actual AI generation will be handled by the RAG service (Phase 1 - future).
   */
  async triggerGeneration(
    dto: GenerateDigestDto,
    userId: string,
    organizationId: string,
  ) {
    // Verify legal document exists
    const document = await this.prisma.legalDocument.findUnique({
      where: { id: dto.legalDocumentId },
      select: {
        id: true,
        title: true,
        shortTitle: true,
        citationText: true,
        grNo: true,
        sourceId: true,
        source: { select: { trustLevel: true, type: true } },
      },
    });

    if (!document) {
      throw new NotFoundException('Legal document not found');
    }

    // Check if a digest already exists for this document by this user
    const existing = await this.prisma.forTenant(organizationId).digest.findFirst({
      where: {
        legalDocumentId: dto.legalDocumentId,
        userId,
        reviewStatus: { notIn: ['rejected'] },
      },
    });

    if (existing) {
      throw new BadRequestException(
        'A digest already exists for this document. Delete the existing one first.',
      );
    }

    const digestType = dto.digestType ?? 'case_digest';

    // Determine source origin from the document's source
    const sourceOrigin = document.source?.type === 'user_upload'
      ? 'user_upload'
      : 'official_pipeline';

    // Create the digest in draft status — actual AI content will be filled by worker
    const digest = await this.prisma.forTenant(organizationId).digest.create({
      data: {
        legalDocumentId: document.id,
        organizationId,
        userId,
        sourceOrigin,
        title: `Digest: ${document.shortTitle ?? document.title}`,
        digestType,
        reviewStatus: 'draft',
        visibility: sourceOrigin === 'user_upload' ? 'private' : 'private',
      },
      include: {
        legalDocument: {
          select: {
            id: true,
            title: true,
            shortTitle: true,
            citationText: true,
            grNo: true,
          },
        },
      },
    });

    // Enqueue BullMQ job to trigger AI digest generation via RAG service
    await this.digestQueue.add('generate-digest', {
      digestId: digest.id,
      documentId: document.id,
    });

    this.logger.log(
      `Digest generation triggered: digestId=${digest.id}, documentId=${document.id}`,
    );

    return digest;
  }

  /**
   * Create provenance records linking a digest to its source passages.
   * Per CLAUDE.md: every digest field must have source section references.
   */
  async createProvenanceRecords(records: CreateProvenanceDto[]) {
    if (records.length === 0) return [];

    // Validate all source documents exist
    const sourceDocIds = [...new Set(records.map((r) => r.sourceDocumentId))];
    const docCount = await this.prisma.legalDocument.count({
      where: { id: { in: sourceDocIds } },
    });
    if (docCount !== sourceDocIds.length) {
      throw new NotFoundException('One or more source documents not found');
    }

    return this.prisma.provenanceRecord.createMany({
      data: records.map((r) => ({
        entityType: r.entityType,
        entityId: r.entityId,
        sourceDocumentId: r.sourceDocumentId,
        sourceSectionId: r.sourceSectionId,
        provenanceType: r.provenanceType,
      })),
    });
  }

  /**
   * Get provenance records for a digest (all source references).
   */
  async getProvenanceRecords(digestId: string) {
    return this.prisma.provenanceRecord.findMany({
      where: {
        entityType: 'digest',
        entityId: digestId,
      },
      include: {
        sourceDocument: {
          select: {
            id: true,
            title: true,
            shortTitle: true,
            citationText: true,
            grNo: true,
          },
        },
        sourceSection: {
          select: {
            id: true,
            sectionType: true,
            sectionLabel: true,
            pageStart: true,
            pageEnd: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Compute and update confidence score for a digest.
   * Per CLAUDE.md: score = source coverage + citation mapping + OCR quality.
   */
  async updateConfidenceScore(digestId: string) {
    // CARVE-OUT: background job — no orgId in scope (called from worker/processor)
    const digest = await this.prisma.digest.findUnique({
      where: { id: digestId },
      select: {
        id: true,
        summary: true,
        facts: true,
        petitionerArguments: true,
        respondentArguments: true,
        issues: true,
        ruling: true,
        doctrine: true,
        dispositive: true,
        sourceOrigin: true,
        legalDocument: {
          select: {
            source: { select: { trustLevel: true } },
          },
        },
      },
    });

    if (!digest) {
      throw new NotFoundException('Digest not found');
    }

    // Count provenance records for this digest
    const provenanceCount = await this.prisma.provenanceRecord.count({
      where: { entityType: 'digest', entityId: digestId },
    });

    // Compute source coverage: how many digest fields have content (DFIR+ 8 fields)
    const fields = [
      digest.summary, digest.facts, digest.petitionerArguments, digest.respondentArguments,
      digest.issues, digest.ruling, digest.doctrine, digest.dispositive,
    ];
    const filledFields = fields.filter((f) => f && f.trim().length > 0).length;
    // petitionerArguments and respondentArguments may be legitimately null,
    // so use 6 required fields as denominator
    const requiredFieldCount = 6;
    const sourceCoverage = Math.min(filledFields / requiredFieldCount, 1.0);

    // Citation mapping completeness: provenance records per filled field
    const citationMapping = filledFields > 0
      ? Math.min(provenanceCount / filledFields, 1)
      : 0;

    // OCR quality factor (1.0 for non-scan origins, reduced for scans without quality data)
    const ocrFactor = USER_SCAN_ORIGINS.includes(digest.sourceOrigin) ? 0.8 : 1.0;

    // Weighted confidence score
    const confidenceScore = (sourceCoverage * 0.4 + citationMapping * 0.4 + ocrFactor * 0.2);
    const roundedScore = Math.round(confidenceScore * 100) / 100;

    // Determine review status
    const reviewStatus = this.determineReviewStatus(roundedScore, digest.sourceOrigin);

    // CARVE-OUT: background job — no orgId in scope (called from worker/processor)
    return this.prisma.digest.update({
      where: { id: digestId },
      data: { confidenceScore: roundedScore, reviewStatus },
    });
  }

  /**
   * Find digests by a batch of legal document IDs.
   * Applies the same visibility rules as list(): private=owner, org=members, public_editorial=approved.
   */
  async findByDocumentIds(
    documentIds: string[],
    userId: string,
    organizationId: string,
  ) {
    // CARVE-OUT: public_editorial cross-org read; forTenant() would filter out cross-org rows
    return this.prisma.digest.findMany({
      where: {
        legalDocumentId: { in: documentIds },
        OR: [
          { userId, visibility: 'private' },
          { organizationId, visibility: 'org' },
          { visibility: 'public_editorial', reviewStatus: 'approved' },
        ],
      },
      orderBy: { createdAt: 'desc' },
      include: {
        legalDocument: {
          select: {
            id: true,
            title: true,
            shortTitle: true,
            citationText: true,
            grNo: true,
            court: true,
            decisionDate: true,
            documentType: true,
          },
        },
      },
    });
  }

  async countByDocumentIds(
    documentIds: string[],
    userId: string,
    organizationId: string,
  ): Promise<number> {
    // CARVE-OUT: public_editorial cross-org read; forTenant() would filter out cross-org rows
    return this.prisma.digest.count({
      where: {
        legalDocumentId: { in: documentIds },
        OR: [
          { userId, visibility: 'private' },
          { organizationId, visibility: 'org' },
          { visibility: 'public_editorial', reviewStatus: 'approved' },
        ],
      },
    });
  }

  /**
   * Get a digest by ID for admin review. Bypasses user/org visibility checks.
   * Authorization is handled by controller guards (RequiredPermissions).
   */
  async findByIdAdmin(digestId: string) {
    // CARVE-OUT: admin operation — cross-tenant by design
    const digest = await this.prisma.digest.findUnique({
      where: { id: digestId },
      include: {
        legalDocument: {
          select: {
            id: true,
            title: true,
            shortTitle: true,
            citationText: true,
            grNo: true,
            court: true,
            decisionDate: true,
            documentType: true,
            ponente: true,
          },
        },
        reviews: {
          select: {
            id: true,
            verdict: true,
            notes: true,
            truthfulnessScore: true,
            completenessScore: true,
            citationAccuracyScore: true,
            createdAt: true,
            reviewer: {
              select: { id: true, fullName: true },
            },
          },
          orderBy: { createdAt: 'desc' as const },
        },
        derivativeGenerationJob: {
          select: {
            id: true,
            derivativeType: true,
            modelName: true,
            promptTemplateVersion: true,
            startedAt: true,
            finishedAt: true,
            tokensIn: true,
            tokensOut: true,
            estimatedCostUsd: true,
          },
        },
        _count: {
          select: {
            doctrineExtracts: true,
            editorialFlags: true,
          },
        },
      },
    });

    if (!digest) {
      throw new NotFoundException('Digest not found');
    }

    return digest;
  }

  // =====================================================================
  // Admin Review Queue Methods — Phase 5 Batch 4
  // =====================================================================

  /**
   * List digests in the admin review queue with advanced filters.
   * Not tenant-scoped — admins see all digests across organizations.
   */
  async getReviewQueue(query: ReviewQueueQueryDto) {
    const limit = query.limit ?? 20;
    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder = (query.sortOrder ?? 'desc') as 'asc' | 'desc';

    const where: Prisma.DigestWhereInput = {};

    if (query.reviewStatus && query.reviewStatus.length > 0) {
      where.reviewStatus = { in: query.reviewStatus };
    }
    if (query.confidenceMin !== undefined || query.confidenceMax !== undefined) {
      where.confidenceScore = {};
      if (query.confidenceMin !== undefined) {
        where.confidenceScore.gte = query.confidenceMin;
      }
      if (query.confidenceMax !== undefined) {
        where.confidenceScore.lte = query.confidenceMax;
      }
    }
    if (query.sourceOrigin) {
      where.sourceOrigin = query.sourceOrigin;
    }
    if (query.digestType) {
      where.digestType = query.digestType;
    }
    if (query.assignedTo) {
      if (query.assignedTo === 'unassigned') {
        where.assignedReviewerUserId = null;
      } else {
        where.assignedReviewerUserId = query.assignedTo;
      }
    }

    // CARVE-OUT: admin operation — cross-tenant by design
    const digests = await this.prisma.digest.findMany({
      where,
      take: limit + 1,
      ...(query.cursor && { skip: 1, cursor: { id: query.cursor } }),
      orderBy: { [sortBy]: sortOrder },
      include: {
        legalDocument: {
          select: {
            id: true,
            title: true,
            shortTitle: true,
            citationText: true,
            grNo: true,
            court: true,
            decisionDate: true,
            documentType: true,
          },
        },
        assignedReviewer: {
          select: { id: true, fullName: true },
        },
        _count: {
          select: { reviews: true },
        },
      },
    });

    const hasNext = digests.length > limit;
    const items = hasNext ? digests.slice(0, limit) : digests;
    const lastItem = items[items.length - 1];
    const nextCursor = hasNext && lastItem ? lastItem.id : undefined;

    return {
      items,
      meta: { hasNext, nextCursor, limit },
    };
  }

  /**
   * Assign a reviewer to a digest. Validates the reviewer has an appropriate role.
   */
  async assignReviewer(digestId: string, dto: AssignReviewerDto) {
    // CARVE-OUT: admin operation — cross-tenant by design
    const digest = await this.prisma.digest.findUnique({
      where: { id: digestId },
    });
    if (!digest) {
      throw new NotFoundException('Digest not found');
    }

    await this.validateReviewerRole(dto.reviewerUserId);

    // CARVE-OUT: admin operation — cross-tenant by design
    return this.prisma.digest.update({
      where: { id: digestId },
      data: { assignedReviewerUserId: dto.reviewerUserId },
      include: {
        assignedReviewer: {
          select: { id: true, fullName: true },
        },
      },
    });
  }

  /**
   * Remove reviewer assignment from a digest.
   */
  async unassignReviewer(digestId: string) {
    // CARVE-OUT: admin operation — cross-tenant by design
    const digest = await this.prisma.digest.findUnique({
      where: { id: digestId },
    });
    if (!digest) {
      throw new NotFoundException('Digest not found');
    }

    // CARVE-OUT: admin operation — cross-tenant by design
    return this.prisma.digest.update({
      where: { id: digestId },
      data: { assignedReviewerUserId: null },
    });
  }

  /**
   * Submit a review verdict for a digest.
   * Creates a DigestReview record and updates the digest reviewStatus.
   */
  async submitReview(
    digestId: string,
    reviewerUserId: string,
    dto: SubmitReviewDto,
  ) {
    // CARVE-OUT: admin operation — cross-tenant by design
    const digest = await this.prisma.digest.findUnique({
      where: { id: digestId },
    });
    if (!digest) {
      throw new NotFoundException('Digest not found');
    }

    // Map verdict to reviewStatus
    const newStatus = this.mapVerdictToStatus(dto.verdict);

    // When approving an AI-generated digest with no user owner, promote to
    // public_editorial so end users can see it via assertDigestAccess.
    const shouldPromoteVisibility =
      dto.verdict === 'approve' &&
      digest.sourceOrigin === 'ai_generated' &&
      digest.visibility === 'private' &&
      digest.userId === null;

    const updateData: { reviewStatus: string; visibility?: string } = {
      reviewStatus: newStatus,
    };
    if (shouldPromoteVisibility) {
      updateData.visibility = 'public_editorial';
    }

    const [review, updatedDigest] = await this.prisma.$transaction([
      this.prisma.digestReview.create({
        data: {
          digestId,
          reviewerUserId,
          verdict: dto.verdict,
          notes: dto.notes,
          truthfulnessScore: dto.truthfulnessScore,
          completenessScore: dto.completenessScore,
          citationAccuracyScore: dto.citationAccuracyScore,
        },
      }),
      // CARVE-OUT: admin operation — cross-tenant by design
      this.prisma.digest.update({
        where: { id: digestId },
        data: updateData,
      }),
    ]);

    return {
      digestId,
      reviewId: review.id,
      newStatus: updatedDigest.reviewStatus,
      newVisibility: updatedDigest.visibility,
      verdict: dto.verdict,
    };
  }

  /**
   * Batch approve digests. Creates a DigestReview per item and updates statuses.
   */
  async batchApprove(
    dto: BatchApproveDto,
    reviewerUserId: string,
  ) {
    // CARVE-OUT: admin batch — cross-tenant by design
    // Skip already-terminal digests so stale re-submits are idempotent
    // (no duplicate review rows, no status churn).
    const digests = await this.prisma.digest.findMany({
      where: {
        id: { in: dto.digestIds },
        reviewStatus: { notIn: ['approved', 'rejected'] },
      },
      select: {
        id: true,
        sourceOrigin: true,
        visibility: true,
        userId: true,
        reviewStatus: true,
      },
    });

    const foundIds = digests.map((d) => d.id);
    if (foundIds.length === 0) {
      return { processed: 0, digestIds: [] };
    }

    // Identify AI-generated digests that should be promoted to public_editorial
    const promotableIds = digests
      .filter(
        (d) =>
          d.sourceOrigin === 'ai_generated' &&
          d.visibility === 'private' &&
          d.userId === null,
      )
      .map((d) => d.id);

    const txOps = [
      this.prisma.digestReview.createMany({
        data: foundIds.map((digestId) => ({
          digestId,
          reviewerUserId,
          verdict: 'approve',
          notes: dto.notes ?? null,
        })),
      }),
      // CARVE-OUT: admin batch — cross-tenant by design
      this.prisma.digest.updateMany({
        where: { id: { in: foundIds } },
        data: { reviewStatus: 'approved' },
      }),
    ];

    if (promotableIds.length > 0) {
      txOps.push(
        // CARVE-OUT: admin batch — cross-tenant by design
        this.prisma.digest.updateMany({
          where: { id: { in: promotableIds } },
          data: { visibility: 'public_editorial' },
        }),
      );
    }

    await this.prisma.$transaction(txOps);

    return { processed: foundIds.length, digestIds: foundIds };
  }

  /**
   * Batch reject digests. Creates a DigestReview per item and updates statuses.
   */
  async batchReject(
    dto: BatchRejectDto,
    reviewerUserId: string,
  ) {
    // CARVE-OUT: admin batch — cross-tenant by design
    // Skip already-terminal digests so stale re-submits are idempotent
    // (no duplicate review rows, no status churn).
    const digests = await this.prisma.digest.findMany({
      where: {
        id: { in: dto.digestIds },
        reviewStatus: { notIn: ['approved', 'rejected'] },
      },
      select: { id: true, reviewStatus: true },
    });

    const foundIds = digests.map((d) => d.id);
    if (foundIds.length === 0) {
      return { processed: 0, digestIds: [] };
    }

    const notes = [dto.notes, dto.reason].filter(Boolean).join(' | ') || null;

    await this.prisma.$transaction([
      this.prisma.digestReview.createMany({
        data: foundIds.map((digestId) => ({
          digestId,
          reviewerUserId,
          verdict: 'reject',
          notes,
        })),
      }),
      // CARVE-OUT: admin batch — cross-tenant by design
      this.prisma.digest.updateMany({
        where: { id: { in: foundIds } },
        data: { reviewStatus: 'rejected' },
      }),
    ]);

    return { processed: foundIds.length, digestIds: foundIds };
  }

  /**
   * Batch assign a reviewer to multiple digests.
   */
  async batchAssign(dto: BatchAssignDto) {
    await this.validateReviewerRole(dto.reviewerUserId);

    // CARVE-OUT: admin batch — cross-tenant by design
    const result = await this.prisma.digest.updateMany({
      where: { id: { in: dto.digestIds } },
      data: { assignedReviewerUserId: dto.reviewerUserId },
    });

    return { processed: result.count, digestIds: dto.digestIds };
  }

  /**
   * Get aggregate review queue statistics.
   */
  async getReviewStats() {
    const [
      total,
      byStatus,
      bySourceOrigin,
      unassigned,
      avgConfidenceResult,
      perReviewer,
    ] = await Promise.all([
      // Digests still pending review (excludes terminal states).
      // "Total in Queue" must shrink as digests are approved/rejected.
      // CARVE-OUT: global metric — counts all orgs by design
      this.prisma.digest.count({
        where: { reviewStatus: { notIn: ['approved', 'rejected'] } },
      }),

      // Count by review status
      // CARVE-OUT: global metric — counts all orgs by design
      this.prisma.digest.groupBy({
        by: ['reviewStatus'],
        _count: { _all: true },
      }),

      // Count by source origin
      // CARVE-OUT: global metric — counts all orgs by design
      this.prisma.digest.groupBy({
        by: ['sourceOrigin'],
        _count: { _all: true },
      }),

      // Unassigned count (pending only — must never exceed "Total in Queue")
      // CARVE-OUT: global metric — counts all orgs by design
      this.prisma.digest.count({
        where: {
          assignedReviewerUserId: null,
          reviewStatus: { notIn: ['approved', 'rejected'] },
        },
      }),

      // Average confidence score
      // CARVE-OUT: global metric — counts all orgs by design
      this.prisma.digest.aggregate({
        _avg: { confidenceScore: true },
      }),

      // Per-reviewer stats: assigned + reviewed
      this.prisma.$queryRaw<
        { reviewer_user_id: string; reviewer_name: string | null; assigned: bigint; reviewed: bigint }[]
      >`
        SELECT
          u.id AS reviewer_user_id,
          u.full_name AS reviewer_name,
          COUNT(DISTINCT d.id) AS assigned,
          COUNT(DISTINCT dr.id) AS reviewed
        FROM users u
        LEFT JOIN digests d ON d.assigned_reviewer_user_id = u.id
        LEFT JOIN digest_reviews dr ON dr.reviewer_user_id = u.id
        WHERE d.id IS NOT NULL OR dr.id IS NOT NULL
        GROUP BY u.id, u.full_name
      `,
    ]);

    // Compute average time-to-review using raw SQL
    const avgTimeResult = await this.prisma.$queryRaw<
      { avg_hours: number | null }[]
    >`
      SELECT AVG(
        EXTRACT(EPOCH FROM (dr.created_at - d.created_at)) / 3600.0
      ) AS avg_hours
      FROM digest_reviews dr
      JOIN digests d ON d.id = dr.digest_id
    `;

    return {
      total,
      byStatus: byStatus.map((r) => ({
        status: r.reviewStatus,
        count: r._count._all,
      })),
      bySourceOrigin: bySourceOrigin.map((r) => ({
        sourceOrigin: r.sourceOrigin,
        count: r._count._all,
      })),
      unassigned,
      avgConfidence: avgConfidenceResult._avg.confidenceScore,
      avgTimeToReviewHours: avgTimeResult[0]?.avg_hours
        ? Math.round(avgTimeResult[0].avg_hours * 100) / 100
        : null,
      perReviewer: perReviewer.map((r) => ({
        reviewerUserId: r.reviewer_user_id,
        reviewerName: r.reviewer_name,
        assigned: Number(r.assigned),
        reviewed: Number(r.reviewed),
      })),
    };
  }

  // =====================================================================
  // Private Helpers
  // =====================================================================

  /**
   * Validate that a user has an admin, editor, or reviewer role.
   */
  private async validateReviewerRole(userId: string) {
    const membership = await this.prisma.organizationMember.findFirst({
      where: {
        userId,
        role: { in: ['admin', 'editor', 'reviewer'] },
        status: 'active',
      },
    });
    if (!membership) {
      throw new BadRequestException(
        'User does not have a valid reviewer role (admin, editor, or reviewer required)',
      );
    }
  }

  /**
   * Map review verdict to digest review status.
   */
  private mapVerdictToStatus(verdict: string): string {
    switch (verdict) {
      case 'approve':
        return 'approved';
      case 'reject':
        return 'rejected';
      case 'needs_revision':
        return 'needs_human_review';
      default:
        return 'needs_human_review';
    }
  }

  /**
   * Determine review status based on confidence score and source origin.
   * Per CLAUDE.md:
   *   - confidence < 0.7 → needs_human_review
   *   - confidence >= 0.7 AND source is official → ai_generated (auto-approvable)
   *   - otherwise → draft
   */
  private determineReviewStatus(
    confidenceScore: number | null,
    sourceOrigin: string,
  ): string {
    if (confidenceScore === null) {
      return 'draft';
    }
    if (confidenceScore < CONFIDENCE_THRESHOLD) {
      return 'needs_human_review';
    }
    if (sourceOrigin === 'official_pipeline') {
      return 'ai_generated';
    }
    return 'ai_generated';
  }

  /**
   * Assert that the user has access to a digest based on visibility rules.
   */
  private assertDigestAccess(
    digest: { userId: string | null; organizationId: string | null; visibility: string },
    userId: string,
    organizationId: string,
  ) {
    if (digest.visibility === 'public_editorial') {
      return; // Public editorial digests are accessible to all
    }
    if (digest.visibility === 'private' && digest.userId === userId) {
      return; // Owner can access their own private digests
    }
    if (digest.visibility === 'org' && digest.organizationId === organizationId) {
      return; // Org members can access org-visible digests
    }
    // Also allow if user is the creator even for org digests
    if (digest.userId === userId) {
      return;
    }
    throw new ForbiddenException('You do not have access to this digest');
  }

  /**
   * Public editorial digest search. Restricted to
   * ``visibility = 'public_editorial' AND reviewStatus = 'approved'`` so no
   * private or in-review content can leak through this surface regardless of
   * caller identity.
   *
   * Empty-result case returns a ``matchedDocuments`` array of legal_documents
   * whose title / GR number matches the query, so the client can surface a
   * "Generate this digest" CTA without a second round-trip.
   */
  async search(
    query: {
      q?: string;
      cursor?: string;
      limit?: number;
    },
    previewOnly = false,
  ) {
    const limit = query.limit ?? 20;
    const needle = (query.q ?? '').trim();

    if (previewOnly) {
      const previewId = await this.getFreePreviewDigestId();
      // CARVE-OUT: public_editorial cross-org read; forTenant() would filter out cross-org rows
      const totalApproved = await this.prisma.digest.count({
        where: { visibility: 'public_editorial', reviewStatus: 'approved' },
      });
      const lockedCount = Math.max(0, totalApproved - (previewId ? 1 : 0));

      const results = previewId
        // CARVE-OUT: public_editorial cross-org read; forTenant() would filter out cross-org rows
        ? await this.prisma.digest.findMany({
            where: { id: previewId },
            include: {
              legalDocument: {
                select: {
                  id: true,
                  title: true,
                  shortTitle: true,
                  citationText: true,
                  grNo: true,
                  court: true,
                  decisionDate: true,
                  documentType: true,
                },
              },
            },
          })
        : [];

      return {
        results,
        hasMore: false,
        cursor: null as string | null,
        matchedDocuments: [] as Array<{
          id: string;
          title: string;
          grNo: string | null;
          citationText: string | null;
        }>,
        previewMode: true,
        lockedCount,
        upgradeRequired: true,
      };
    }

    const where: Prisma.DigestWhereInput = {
      visibility: 'public_editorial',
      reviewStatus: 'approved',
    };

    if (needle.length > 0) {
      where.OR = [
        { title: { contains: needle, mode: 'insensitive' } },
        { legalDocument: { title: { contains: needle, mode: 'insensitive' } } },
        { legalDocument: { grNo: { contains: needle, mode: 'insensitive' } } },
        { legalDocument: { citationText: { contains: needle, mode: 'insensitive' } } },
      ];
    }

    // CARVE-OUT: public_editorial cross-org read; forTenant() would filter out cross-org rows
    const digests = await this.prisma.digest.findMany({
      where,
      take: limit + 1,
      ...(query.cursor && { skip: 1, cursor: { id: query.cursor } }),
      // Order by updatedAt so freshly-approved digests (approval bumps updatedAt,
      // not createdAt) surface at the top. id is a deterministic keyset tiebreaker.
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      include: {
        legalDocument: {
          select: {
            id: true,
            title: true,
            shortTitle: true,
            citationText: true,
            grNo: true,
            court: true,
            decisionDate: true,
            documentType: true,
          },
        },
      },
    });

    const hasMore = digests.length > limit;
    const results = hasMore ? digests.slice(0, limit) : digests;
    const lastItem = results[results.length - 1];
    const cursor = hasMore && lastItem ? lastItem.id : null;

    // When the digest search turns up nothing, look for matching
    // legal_documents so the caller can offer on-demand generation.
    let matchedDocuments: Array<{
      id: string;
      title: string;
      grNo: string | null;
      citationText: string | null;
    }> = [];
    if (results.length === 0 && needle.length > 0) {
      matchedDocuments = await this.prisma.legalDocument.findMany({
        where: {
          OR: [
            { title: { contains: needle, mode: 'insensitive' } },
            { grNo: { contains: needle, mode: 'insensitive' } },
            { citationText: { contains: needle, mode: 'insensitive' } },
          ],
        },
        select: {
          id: true,
          title: true,
          grNo: true,
          citationText: true,
        },
        take: 5,
        orderBy: { createdAt: 'desc' },
      });
    }

    return {
      results,
      hasMore,
      cursor,
      matchedDocuments,
    };
  }

  /**
   * On-demand digest generation: user wants a digest for a specific
   * legal_document that doesn't have one yet. Creates a
   * ``derivative_generation_jobs`` row with
   * ``trigger_type='on_demand'``; the existing Celery Beat poller picks it
   * up within 30s via the same pipeline bulk-gen uses. No duplicate worker
   * code path.
   *
   * Callers (the controller) are responsible for the subscription +
   * quota + rate-limit gates. This method just validates the target
   * document exists and writes the job row.
   */
  async generateOnDemand(
    legalDocumentId: string,
    userId: string,
  ): Promise<{ jobId: string; status: string }> {
    const document = await this.prisma.legalDocument.findUnique({
      where: { id: legalDocumentId },
      select: { id: true },
    });
    if (!document) {
      throw new NotFoundException('Legal document not found');
    }

    // Reject if a pending/running on-demand job already exists for this
    // doc+user so users can't queue five duplicate jobs in 5 minutes by
    // hammering the button.
    const inflight = await this.prisma.derivativeGenerationJob.findFirst({
      where: {
        derivativeType: 'case_digest',
        sourceDocumentId: legalDocumentId,
        triggeredByUserId: userId,
        status: { in: ['pending', 'running', 'validating'] },
      },
      select: { id: true, status: true },
    });
    if (inflight) {
      return { jobId: inflight.id, status: inflight.status };
    }

    const job = await this.prisma.derivativeGenerationJob.create({
      data: {
        derivativeType: 'case_digest',
        triggerType: 'on_demand',
        sourceDocumentId: legalDocumentId,
        triggeredByUserId: userId,
        status: 'pending',
      },
      select: { id: true, status: true },
    });

    this.logger.log(
      `Queued on-demand digest job ${job.id} for doc ${legalDocumentId} (user ${userId})`,
    );

    return { jobId: job.id, status: job.status };
  }
}
