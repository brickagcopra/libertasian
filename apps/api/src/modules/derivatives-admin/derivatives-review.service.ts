import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { DigestsService } from '../digests/digests.service';
import {
  BulkApproveByConfidenceDto,
  BulkApproveByConfidenceResult,
  ENQUEUEABLE_DERIVATIVE_TYPES,
  SubmitDerivativeReviewDto,
} from './dto';

export interface SubmitDerivativeReviewResult {
  artifactId: string;
  reviewId: string;
  newStatus: string;
  newVisibility: string;
  verdict: string;
  subjectsCopiedFromParent: number;
}

/**
 * Hard ceiling on a single bulk-approve call. Tuned to the 2026-04-22
 * bulk-gen scale (≈400 items). Above this, the UI should nudge the
 * operator to narrow the threshold.
 */
const BULK_APPROVE_WARN_THRESHOLD = 500;

@Injectable()
export class DerivativesReviewService {
  private readonly logger = new Logger(DerivativesReviewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly digests: DigestsService,
  ) {}

  async submitReview(
    artifactId: string,
    reviewerUserId: string,
    dto: SubmitDerivativeReviewDto,
  ): Promise<SubmitDerivativeReviewResult> {
    const artifact = await this.prisma.derivativeArtifact.findFirst({
      where: { id: artifactId, deletedAt: null },
      include: {
        subjectAssignments: { select: { id: true } },
      },
    });
    if (!artifact) {
      throw new NotFoundException('Derivative artifact not found');
    }

    const newStatus = this.mapVerdictToStatus(dto.verdict);

    // AI-generated, unowned artifacts get auto-promoted to public_editorial on approve.
    const shouldPromoteVisibility =
      dto.verdict === 'approve' &&
      artifact.contentRights === 'ai_generated_derivative' &&
      artifact.visibility === 'private' &&
      artifact.createdByUserId === null;

    const updateData: { reviewStatus: string; visibility?: string; publishedAt?: Date } = {
      reviewStatus: newStatus,
    };
    if (shouldPromoteVisibility) {
      updateData.visibility = 'public_editorial';
      updateData.publishedAt = new Date();
    }

    // If approving an artifact with no explicit classifier tags, inherit from parent
    // doc so it surfaces under the right subject chip.
    const needsSubjectFallback =
      dto.verdict === 'approve' &&
      artifact.subjectAssignments.length === 0 &&
      artifact.sourceDocumentId !== null;

    const parentAssignments = needsSubjectFallback
      ? await this.prisma.documentSubjectAssignment.findMany({
          where: { legalDocumentId: artifact.sourceDocumentId ?? undefined },
          select: {
            subjectId: true,
            subjectTopicId: true,
            isPrimary: true,
          },
        })
      : [];

    const result = await this.prisma.$transaction(async (tx) => {
      const review = await tx.derivativeReview.create({
        data: {
          derivativeArtifactId: artifactId,
          reviewerUserId,
          verdict: dto.verdict,
          notes: dto.notes,
          truthfulnessScore: dto.truthfulnessScore,
          completenessScore: dto.completenessScore,
          citationAccuracyScore: dto.citationAccuracyScore,
        },
      });

      const updated = await tx.derivativeArtifact.update({
        where: { id: artifactId },
        data: updateData,
      });

      let subjectsCopied = 0;
      if (parentAssignments.length > 0) {
        const created = await tx.documentSubjectAssignment.createMany({
          data: parentAssignments.map((a) => ({
            derivativeArtifactId: artifactId,
            subjectId: a.subjectId,
            subjectTopicId: a.subjectTopicId,
            isPrimary: a.isPrimary,
            classifiedBy: 'manual',
            confidence: null,
          })),
          skipDuplicates: true,
        });
        subjectsCopied = created.count;
      }

      return { review, updated, subjectsCopied };
    });

    if (needsSubjectFallback && result.subjectsCopied === 0) {
      this.logger.warn(
        `Derivative ${artifactId} approved but parent legal document has no subject assignments; artifact will not appear in any subject filter until tagged.`,
      );
    }

    return {
      artifactId,
      reviewId: result.review.id,
      newStatus: result.updated.reviewStatus,
      newVisibility: result.updated.visibility,
      verdict: dto.verdict,
      subjectsCopiedFromParent: result.subjectsCopied,
    };
  }

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
   * Batch-approve private artifacts (and optionally digests) whose
   * `confidence_score >= threshold`. Reuses {@link submitReview} per
   * artifact so visibility flip, subject-inheritance fallback, and
   * audit-grade review rows all stay correct. Digests reuse
   * {@link DigestsService.batchApprove}.
   *
   * Not wrapped in a single outer transaction: `submitReview` opens
   * its own interactive transaction per item, and Prisma does not
   * allow a single long-lived tx to nest hundreds of short-lived
   * ones. Each artifact is therefore atomic on its own; a mid-batch
   * failure aborts the loop and the caller receives the partial
   * counts + the offending error. Earlier approvals stay committed
   * — that's the recoverable outcome we want when an operator
   * re-runs with a narrower threshold.
   */
  async bulkApproveByConfidence(
    dto: BulkApproveByConfidenceDto,
    reviewerUserId: string,
  ): Promise<BulkApproveByConfidenceResult> {
    const includeDigests = dto.includeDigests ?? true;
    const dryRun = dto.dryRun ?? false;

    const typeFilter = dto.derivativeTypes ?? [...ENQUEUEABLE_DERIVATIVE_TYPES];
    // class-validator already enforces membership, but re-check to make
    // the service safe for direct (non-controller) callers.
    for (const t of typeFilter) {
      if (!ENQUEUEABLE_DERIVATIVE_TYPES.includes(t as (typeof ENQUEUEABLE_DERIVATIVE_TYPES)[number])) {
        throw new BadRequestException(`Unknown derivative type: ${t}`);
      }
    }

    const artifactCandidates = await this.prisma.derivativeArtifact.findMany({
      where: {
        deletedAt: null,
        visibility: 'private',
        reviewStatus: { in: ['draft', 'needs_human_review'] },
        confidenceScore: { gte: dto.threshold },
        derivativeType: { in: typeFilter },
      },
      select: { id: true, derivativeType: true },
    });

    const perTypeBreakdown: Record<string, number> = {};
    for (const a of artifactCandidates) {
      perTypeBreakdown[a.derivativeType] = (perTypeBreakdown[a.derivativeType] ?? 0) + 1;
    }

    let digestCandidateCount = 0;
    let digestCandidateIds: string[] = [];
    if (includeDigests) {
      const digestCandidates = await this.prisma.digest.findMany({
        where: {
          reviewStatus: 'needs_human_review',
          confidenceScore: { gte: dto.threshold },
        },
        select: { id: true },
      });
      digestCandidateIds = digestCandidates.map((d) => d.id);
      digestCandidateCount = digestCandidateIds.length;
    }

    const totalCandidates = artifactCandidates.length + digestCandidateCount;
    if (totalCandidates > BULK_APPROVE_WARN_THRESHOLD) {
      this.logger.warn(
        `bulkApproveByConfidence: ${totalCandidates} candidates at threshold ${dto.threshold} (>${BULK_APPROVE_WARN_THRESHOLD}). ` +
          `Consider a narrower threshold or per-type filter.`,
      );
    }

    if (dryRun) {
      return {
        dryRun: true,
        artifactsPromoted: artifactCandidates.length,
        digestsPromoted: digestCandidateCount,
        subjectsInherited: 0,
        perTypeBreakdown: Object.entries(perTypeBreakdown).map(
          ([derivativeType, count]) => ({ derivativeType, count }),
        ),
        errors: [],
      };
    }

    const notes = `Bulk auto-approve threshold >= ${dto.threshold} via admin UI`;
    const errors: BulkApproveByConfidenceResult['errors'] = [];
    let artifactsPromoted = 0;
    let subjectsInherited = 0;

    for (const a of artifactCandidates) {
      try {
        const result = await this.submitReview(a.id, reviewerUserId, {
          verdict: 'approve',
          notes,
        });
        artifactsPromoted += 1;
        subjectsInherited += result.subjectsCopiedFromParent;
      } catch (err) {
        errors.push({
          entityType: 'derivative_artifact',
          entityId: a.id,
          reason: err instanceof Error ? err.message : String(err),
        });
        this.logger.error(
          `bulkApproveByConfidence: failed to approve artifact ${a.id}: ${err}`,
        );
      }
    }

    let digestsPromoted = 0;
    if (includeDigests && digestCandidateIds.length > 0) {
      try {
        const res = await this.digests.batchApprove(
          { digestIds: digestCandidateIds, notes },
          reviewerUserId,
        );
        digestsPromoted = res.processed;
      } catch (err) {
        errors.push({
          entityType: 'digest_batch',
          entityId: digestCandidateIds.join(','),
          reason: err instanceof Error ? err.message : String(err),
        });
        this.logger.error(
          `bulkApproveByConfidence: digest batchApprove failed: ${err}`,
        );
      }
    }

    return {
      dryRun: false,
      artifactsPromoted,
      digestsPromoted,
      subjectsInherited,
      perTypeBreakdown: Object.entries(perTypeBreakdown).map(
        ([derivativeType, count]) => ({ derivativeType, count }),
      ),
      errors,
    };
  }
}
