import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ClassificationService {
  constructor(private readonly prisma: PrismaService) {}

  async getClassificationReviewQueue(query: {
    cursor?: string;
    limit?: string;
    reviewStatus?: string;
    subjectCode?: string;
    documentType?: string;
  }) {
    const limit = Math.min(parseInt(query.limit || '20', 10), 100);
    const reviewStatus = query.reviewStatus || 'needs_review';

    const where: Record<string, unknown> = {
      tagMaps: {
        some: {
          reviewStatus,
          ...(query.subjectCode && {
            tag: { code: query.subjectCode },
          }),
        },
      },
      ...(query.documentType && { documentType: query.documentType }),
    };

    const items = await this.prisma.legalDocument.findMany({
      take: limit + 1,
      ...(query.cursor && { skip: 1, cursor: { id: query.cursor } }),
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        documentType: true,
        court: true,
        grNo: true,
        createdAt: true,
        tagMaps: {
          where: { reviewStatus },
          select: {
            id: true,
            isPrimary: true,
            confidence: true,
            classifiedBy: true,
            reviewStatus: true,
            tag: {
              select: {
                id: true,
                code: true,
                name: true,
                tagType: true,
              },
            },
          },
        },
      },
    });

    const hasNext = items.length > limit;
    const results = hasNext ? items.slice(0, limit) : items;
    const nextCursor = hasNext ? results[results.length - 1]?.id : undefined;

    return {
      items: results,
      meta: {
        hasNext,
        nextCursor,
        count: results.length,
      },
    };
  }

  /**
   * One document's classification state, for the admin review detail screen.
   *
   * `id` here is a LEGAL DOCUMENT id, not a tag-map id: the review queue
   * returns `legalDocument` rows and the mobile list pushes `item.id` into
   * this route. Confirm/reject/override take the same document id, so all four
   * screens agree on what the id in the URL means.
   *
   * Flattens the subject tag-maps the way the review queue's consumers expect:
   * one primary prediction, one secondary, and the primary's confidence.
   */
  async getClassificationDetail(documentId: string) {
    const doc = await this.prisma.legalDocument.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        title: true,
        documentType: true,
        court: true,
        createdAt: true,
        tagMaps: {
          where: { tag: { tagType: { in: ['bar_subject', 'subject'] } } },
          select: {
            isPrimary: true,
            confidence: true,
            tag: { select: { code: true } },
          },
        },
      },
    });

    if (!doc) {
      throw new NotFoundException(`Document ${documentId} not found`);
    }

    const primary = doc.tagMaps.find((t) => t.isPrimary) ?? null;
    const secondary = doc.tagMaps.find((t) => !t.isPrimary) ?? null;

    return {
      id: doc.id,
      legalDocumentId: doc.id,
      documentTitle: doc.title,
      documentType: doc.documentType,
      court: doc.court,
      createdAt: doc.createdAt,
      predictedPrimary: primary?.tag.code ?? null,
      predictedSecondary: secondary?.tag.code ?? null,
      // `confidence` is nullable in the schema; the detail screen renders it as
      // a percentage, so a missing value is 0 rather than NaN.
      confidence: primary?.confidence ?? 0,
    };
  }

  async confirmClassification(documentId: string, tagId: string) {
    const tagMap = await this.prisma.legalDocumentTagMap.findUnique({
      where: {
        legalDocumentId_tagId: { legalDocumentId: documentId, tagId },
      },
    });

    if (!tagMap) {
      throw new NotFoundException(
        `Classification not found for document ${documentId} tag ${tagId}`,
      );
    }

    return this.prisma.legalDocumentTagMap.update({
      where: { id: tagMap.id },
      data: { reviewStatus: 'confirmed' },
    });
  }

  async rejectClassification(documentId: string, tagId: string) {
    const tagMap = await this.prisma.legalDocumentTagMap.findUnique({
      where: {
        legalDocumentId_tagId: { legalDocumentId: documentId, tagId },
      },
    });

    if (!tagMap) {
      throw new NotFoundException(
        `Classification not found for document ${documentId} tag ${tagId}`,
      );
    }

    return this.prisma.legalDocumentTagMap.update({
      where: { id: tagMap.id },
      data: { reviewStatus: 'rejected', isPrimary: false },
    });
  }

  async overrideClassification(
    documentId: string,
    primaryTagId: string,
    secondaryTagIds: string[],
  ) {
    // Verify document exists
    const doc = await this.prisma.legalDocument.findUnique({
      where: { id: documentId },
      select: { id: true },
    });

    if (!doc) {
      throw new NotFoundException(`Document ${documentId} not found`);
    }

    // Delete existing subject-type tag mappings
    await this.prisma.legalDocumentTagMap.deleteMany({
      where: {
        legalDocumentId: documentId,
        tag: { tagType: { in: ['bar_subject', 'subject'] } },
      },
    });

    // Create primary mapping
    await this.prisma.legalDocumentTagMap.create({
      data: {
        legalDocumentId: documentId,
        tagId: primaryTagId,
        isPrimary: true,
        confidence: 1.0,
        classifiedBy: 'manual',
        reviewStatus: 'confirmed',
      },
    });

    // Create secondary mappings
    for (const tagId of secondaryTagIds) {
      if (tagId === primaryTagId) continue;
      await this.prisma.legalDocumentTagMap.create({
        data: {
          legalDocumentId: documentId,
          tagId,
          isPrimary: false,
          confidence: 1.0,
          classifiedBy: 'manual',
          reviewStatus: 'confirmed',
        },
      });
    }

    return {
      documentId,
      primaryTagId,
      secondaryTagIds: secondaryTagIds.filter((id) => id !== primaryTagId),
    };
  }

  async getReviewStats() {
    const [needsReview, auto, confirmed, rejected] = await Promise.all([
      this.prisma.legalDocumentTagMap.count({
        where: { reviewStatus: 'needs_review' },
      }),
      this.prisma.legalDocumentTagMap.count({
        where: { reviewStatus: 'auto' },
      }),
      this.prisma.legalDocumentTagMap.count({
        where: { reviewStatus: 'confirmed' },
      }),
      this.prisma.legalDocumentTagMap.count({
        where: { reviewStatus: 'rejected' },
      }),
    ]);

    return { needsReview, auto, confirmed, rejected };
  }
}
