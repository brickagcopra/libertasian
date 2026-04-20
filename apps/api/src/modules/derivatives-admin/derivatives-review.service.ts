import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { SubmitDerivativeReviewDto } from './dto';

export interface SubmitDerivativeReviewResult {
  artifactId: string;
  reviewId: string;
  newStatus: string;
  newVisibility: string;
  verdict: string;
  subjectsCopiedFromParent: number;
}

@Injectable()
export class DerivativesReviewService {
  private readonly logger = new Logger(DerivativesReviewService.name);

  constructor(private readonly prisma: PrismaService) {}

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
}
