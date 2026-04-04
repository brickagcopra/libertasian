import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { ListDuplicatesQueryDto, MergeDuplicateDto } from './dto';

const DOC_SELECT = {
  id: true,
  title: true,
  citationText: true,
  grNo: true,
  documentType: true,
  court: true,
  checksum: true,
} as const;

@Injectable()
export class DuplicatesService {
  private readonly logger = new Logger(DuplicatesService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ---- Query Methods ----

  async list(query: ListDuplicatesQueryDto) {
    const limit = query.limit ?? 20;
    const where: Prisma.DocumentSimilarityWhereInput = {};

    if (query.status) {
      where.status = query.status;
    }
    if (query.similarityType) {
      where.similarityType = query.similarityType;
    }
    if (query.classificationTier) {
      where.classificationTier = query.classificationTier;
    }
    if (query.minConfidence !== undefined) {
      where.classificationConfidence = { gte: query.minConfidence };
    }

    const items = await this.prisma.documentSimilarity.findMany({
      take: limit + 1,
      ...(query.cursor && { skip: 1, cursor: { id: query.cursor } }),
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        documentA: { select: DOC_SELECT },
        documentB: { select: DOC_SELECT },
      },
    });

    const hasNext = items.length > limit;
    const results = hasNext ? items.slice(0, limit) : items;
    const lastItem = results[results.length - 1];
    const nextCursor = hasNext && lastItem ? lastItem.id : undefined;

    return { items: results, meta: { hasNext, nextCursor, limit } };
  }

  async getReviewablePairs(query: { cursor?: string; limit?: number }) {
    const limit = query.limit ?? 20;

    const items = await this.prisma.documentSimilarity.findMany({
      take: limit + 1,
      ...(query.cursor && { skip: 1, cursor: { id: query.cursor } }),
      where: {
        classificationTier: 'possible_duplicate',
        status: 'pending',
      },
      orderBy: { createdAt: 'desc' },
      include: {
        documentA: { select: DOC_SELECT },
        documentB: { select: DOC_SELECT },
      },
    });

    const hasNext = items.length > limit;
    const results = hasNext ? items.slice(0, limit) : items;
    const lastItem = results[results.length - 1];
    const nextCursor = hasNext && lastItem ? lastItem.id : undefined;

    return { items: results, meta: { hasNext, nextCursor, limit } };
  }

  async findById(id: string) {
    const pair = await this.prisma.documentSimilarity.findUnique({
      where: { id },
      include: {
        documentA: { select: DOC_SELECT },
        documentB: { select: DOC_SELECT },
      },
    });

    if (!pair) {
      throw new NotFoundException('Document similarity pair not found');
    }

    return pair;
  }

  async getStats() {
    const [total, pending, merged, dismissed, autoDismissed] = await Promise.all([
      this.prisma.documentSimilarity.count(),
      this.prisma.documentSimilarity.count({ where: { status: 'pending' } }),
      this.prisma.documentSimilarity.count({ where: { status: 'merged' } }),
      this.prisma.documentSimilarity.count({ where: { status: 'dismissed' } }),
      this.prisma.documentSimilarity.count({ where: { status: 'auto_dismissed' } }),
    ]);

    const byTypeRaw = await this.prisma.documentSimilarity.groupBy({
      by: ['similarityType'],
      _count: true,
    });

    const byType = byTypeRaw.map((g) => ({
      type: g.similarityType,
      count: g._count,
    }));

    const byTierRaw = await this.prisma.documentSimilarity.groupBy({
      by: ['classificationTier'],
      _count: true,
    });

    const byTier = byTierRaw.map((g) => ({
      tier: g.classificationTier,
      count: g._count,
    }));

    return { total, pending, merged, dismissed, autoDismissed, byType, byTier };
  }

  // ---- Detection Methods ----

  async detectChecksumDuplicates(): Promise<{ pairsCreated: number }> {
    const startTime = Date.now();
    this.logger.log('Starting checksum duplicate detection...');

    // Find documents sharing the same non-null checksum
    const checksumGroups = await this.prisma.legalDocument.groupBy({
      by: ['checksum'],
      _count: true,
      having: { checksum: { _count: { gt: 1 } } },
      where: { checksum: { not: null } },
    });

    let pairsCreated = 0;

    for (const group of checksumGroups) {
      if (!group.checksum) continue;

      const docs = await this.prisma.legalDocument.findMany({
        where: { checksum: group.checksum },
        select: { id: true },
        orderBy: { id: 'asc' },
      });

      pairsCreated += await this.createPairsFromGroup(docs, 'checksum', 1.0);
    }

    const duration = Date.now() - startTime;
    this.logger.log(`Checksum detection complete: ${pairsCreated} pairs in ${duration}ms`);
    return { pairsCreated };
  }

  async detectTitleDuplicates(threshold = 0.85): Promise<{ pairsCreated: number }> {
    const startTime = Date.now();
    this.logger.log(`Starting title duplicate detection (threshold=${threshold})...`);

    // Load all document titles for comparison
    const docs = await this.prisma.legalDocument.findMany({
      select: { id: true, title: true },
      where: { status: { not: 'archived' } },
      orderBy: { id: 'asc' },
    });

    let pairsCreated = 0;

    // O(n^2) comparison — acceptable for <50K docs
    for (let i = 0; i < docs.length; i++) {
      const docI = docs[i]!;
      const titleA = this.normalizeTitle(docI.title);

      for (let j = i + 1; j < docs.length; j++) {
        const docJ = docs[j]!;
        const titleB = this.normalizeTitle(docJ.title);
        const similarity = this.levenshteinSimilarity(titleA, titleB);

        if (similarity >= threshold) {
          const [docAId, docBId] = this.orderIds(docI.id, docJ.id);

          const existing = await this.prisma.documentSimilarity.findFirst({
            where: {
              documentAId: docAId,
              documentBId: docBId,
              similarityType: 'title',
            },
          });

          if (!existing) {
            await this.prisma.documentSimilarity.create({
              data: {
                documentAId: docAId,
                documentBId: docBId,
                similarityScore: similarity,
                similarityType: 'title',
                status: 'pending',
              },
            });
            pairsCreated++;
          }
        }
      }
    }

    const duration = Date.now() - startTime;
    this.logger.log(`Title detection complete: ${pairsCreated} pairs in ${duration}ms`);
    return { pairsCreated };
  }

  async detectCitationOverlap(): Promise<{ pairsCreated: number }> {
    const startTime = Date.now();
    this.logger.log('Starting citation overlap detection...');

    let pairsCreated = 0;

    // Group by GR number
    const grGroups = await this.prisma.legalDocument.groupBy({
      by: ['grNo'],
      _count: true,
      having: { grNo: { _count: { gt: 1 } } },
      where: { grNo: { not: null } },
    });

    for (const group of grGroups) {
      if (!group.grNo) continue;

      const docs = await this.prisma.legalDocument.findMany({
        where: { grNo: group.grNo },
        select: { id: true },
        orderBy: { id: 'asc' },
      });

      pairsCreated += await this.createPairsFromGroup(docs, 'citation', 0.9);
    }

    // Group by citation text
    const citationGroups = await this.prisma.legalDocument.groupBy({
      by: ['citationText'],
      _count: true,
      having: { citationText: { _count: { gt: 1 } } },
      where: { citationText: { not: null } },
    });

    for (const group of citationGroups) {
      if (!group.citationText) continue;

      const docs = await this.prisma.legalDocument.findMany({
        where: { citationText: group.citationText },
        select: { id: true },
        orderBy: { id: 'asc' },
      });

      pairsCreated += await this.createPairsFromGroup(docs, 'citation', 0.85);
    }

    const duration = Date.now() - startTime;
    this.logger.log(`Citation detection complete: ${pairsCreated} pairs in ${duration}ms`);
    return { pairsCreated };
  }

  async runFullDetection() {
    this.logger.log('Running full duplicate detection...');
    const startTime = Date.now();

    const checksum = await this.detectChecksumDuplicates();
    const title = await this.detectTitleDuplicates();
    const citation = await this.detectCitationOverlap();

    const duration = Date.now() - startTime;

    return {
      checksum,
      title,
      citation,
      totalPairsCreated: checksum.pairsCreated + title.pairsCreated + citation.pairsCreated,
      duration,
    };
  }

  // ---- Merge & Dismiss ----

  async merge(pairId: string, dto: MergeDuplicateDto, actorUserId: string) {
    const pair = await this.findById(pairId);

    if (pair.status !== 'pending') {
      throw new BadRequestException(`Cannot merge a pair with status "${pair.status}"`);
    }

    const keepId = dto.keepDocumentId;
    const removeId = keepId === pair.documentAId ? pair.documentBId : pair.documentAId;

    if (keepId !== pair.documentAId && keepId !== pair.documentBId) {
      throw new BadRequestException('keepDocumentId must be one of the two documents in the pair');
    }

    await this.prisma.$transaction(async (tx) => {
      // Transfer bookmarks from duplicate to canonical
      await tx.bookmark.updateMany({
        where: { legalDocumentId: removeId },
        data: { legalDocumentId: keepId },
      });

      // Transfer annotations from duplicate to canonical
      await tx.annotation.updateMany({
        where: { legalDocumentId: removeId },
        data: { legalDocumentId: keepId },
      });

      // Transfer matter-document links from duplicate to canonical
      await tx.matterDocument.updateMany({
        where: { legalDocumentId: removeId },
        data: { legalDocumentId: keepId },
      });

      // Transfer editorial flags from duplicate to canonical
      await tx.editorialFlag.updateMany({
        where: { legalDocumentId: removeId },
        data: { legalDocumentId: keepId },
      });

      // Archive the duplicate document
      await tx.legalDocument.update({
        where: { id: removeId },
        data: { status: 'archived' },
      });

      // Mark the pair as merged
      await tx.documentSimilarity.update({
        where: { id: pairId },
        data: { status: 'merged' },
      });

      // Dismiss any other pending pairs involving the removed document
      await tx.documentSimilarity.updateMany({
        where: {
          status: 'pending',
          OR: [
            { documentAId: removeId },
            { documentBId: removeId },
          ],
        },
        data: { status: 'dismissed' },
      });
    });

    this.logger.log(`Merged duplicate pair ${pairId}: kept ${keepId}, archived ${removeId}`);

    return { pairId, keptDocumentId: keepId, archivedDocumentId: removeId };
  }

  async dismiss(pairId: string) {
    const pair = await this.findById(pairId);

    if (pair.status !== 'pending') {
      throw new BadRequestException(`Cannot dismiss a pair with status "${pair.status}"`);
    }

    await this.prisma.documentSimilarity.update({
      where: { id: pairId },
      data: { status: 'dismissed' },
    });

    this.logger.log(`Dismissed duplicate pair ${pairId}`);

    return { pairId, status: 'dismissed' };
  }

  async resolve(
    pairId: string,
    action: string,
    keepDocumentId: string,
    reviewerUserId: string,
  ) {
    const pair = await this.findById(pairId);

    if (pair.status !== 'pending') {
      throw new BadRequestException(`Cannot resolve a pair with status "${pair.status}"`);
    }

    switch (action) {
      case 'merge':
        return this.resolveAsMerge(pairId, pair, keepDocumentId, reviewerUserId);
      case 'dismiss':
        return this.resolveAsDismiss(pairId, reviewerUserId);
      case 'version_update':
        return this.resolveAsVersionUpdate(pairId, pair, keepDocumentId, reviewerUserId);
      default:
        throw new BadRequestException(`Unknown resolve action: ${action}`);
    }
  }

  private async resolveAsMerge(
    pairId: string,
    pair: Awaited<ReturnType<typeof this.findById>>,
    keepDocumentId: string,
    reviewerUserId: string,
  ) {
    const result = await this.merge(pairId, { keepDocumentId }, reviewerUserId);

    await this.prisma.documentSimilarity.update({
      where: { id: pairId },
      data: { reviewedByUserId: reviewerUserId, reviewedAt: new Date() },
    });

    return { ...result, action: 'merge' };
  }

  private async resolveAsDismiss(pairId: string, reviewerUserId: string) {
    const result = await this.dismiss(pairId);

    await this.prisma.documentSimilarity.update({
      where: { id: pairId },
      data: { reviewedByUserId: reviewerUserId, reviewedAt: new Date() },
    });

    return { ...result, action: 'dismiss' };
  }

  private async resolveAsVersionUpdate(
    pairId: string,
    pair: Awaited<ReturnType<typeof this.findById>>,
    keepDocumentId: string,
    reviewerUserId: string,
  ) {
    if (keepDocumentId !== pair.documentAId && keepDocumentId !== pair.documentBId) {
      throw new BadRequestException('keepDocumentId must be one of the documents in the pair');
    }

    await this.prisma.documentSimilarity.update({
      where: { id: pairId },
      data: {
        status: 'dismissed',
        classificationTier: 'version_update',
        canonicalDocumentId: keepDocumentId,
        reviewedByUserId: reviewerUserId,
        reviewedAt: new Date(),
      },
    });

    this.logger.log(`Resolved pair ${pairId} as version_update, canonical=${keepDocumentId}`);

    return { pairId, action: 'version_update', canonicalDocumentId: keepDocumentId };
  }

  // ---- Helpers ----

  /** Ensure consistent pair ordering: documentAId < documentBId (lexicographic). */
  private orderIds(idA: string, idB: string): [string, string] {
    return idA < idB ? [idA, idB] : [idB, idA];
  }

  /** Create similarity pairs from a group of document IDs. */
  private async createPairsFromGroup(
    docs: { id: string }[],
    similarityType: string,
    score: number,
  ): Promise<number> {
    let created = 0;

    for (let i = 0; i < docs.length; i++) {
      const docI = docs[i]!;
      for (let j = i + 1; j < docs.length; j++) {
        const docJ = docs[j]!;
        const [docAId, docBId] = this.orderIds(docI.id, docJ.id);

        const existing = await this.prisma.documentSimilarity.findFirst({
          where: { documentAId: docAId, documentBId: docBId, similarityType },
        });

        if (!existing) {
          await this.prisma.documentSimilarity.create({
            data: {
              documentAId: docAId,
              documentBId: docBId,
              similarityScore: score,
              similarityType,
              status: 'pending',
            },
          });
          created++;
        }
      }
    }

    return created;
  }

  /** Normalize title for comparison: lowercase, strip punctuation, collapse whitespace. */
  private normalizeTitle(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Compute Levenshtein distance between two strings. */
  private levenshteinDistance(a: string, b: string): number {
    const m = a.length;
    const n = b.length;

    // Use two rows for space optimization
    let prev: number[] = Array.from({ length: n + 1 }, (_, i) => i);
    let curr: number[] = new Array<number>(n + 1).fill(0);

    for (let i = 1; i <= m; i++) {
      curr[0] = i;
      for (let j = 1; j <= n; j++) {
        if (a[i - 1] === b[j - 1]) {
          curr[j] = prev[j - 1]!;
        } else {
          curr[j] = 1 + Math.min(prev[j - 1]!, prev[j]!, curr[j - 1]!);
        }
      }
      [prev, curr] = [curr, prev];
    }

    return prev[n]!;
  }

  /** Compute Levenshtein similarity (0-1) between two strings. */
  private levenshteinSimilarity(a: string, b: string): number {
    const maxLen = Math.max(a.length, b.length);
    if (maxLen === 0) return 1.0;
    const distance = this.levenshteinDistance(a, b);
    return 1 - distance / maxLen;
  }
}
