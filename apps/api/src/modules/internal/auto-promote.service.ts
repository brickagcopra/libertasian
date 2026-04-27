import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

/**
 * System actor for auto-triggered derivative promotions. Pre-existing
 * convention used by other system-triggered actors (e.g. admin bulk-gen
 * flashcard owner). Listed here so a single grep finds every system-actor
 * write.
 */
const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000002';

/** Page size for the periodic sweep — keeps a single tick bounded. */
const SWEEP_BATCH_SIZE = 100;

@Injectable()
export class AutoPromoteService {
  private readonly logger = new Logger(AutoPromoteService.name);
  private readonly threshold: number;
  private readonly excludedTypes: ReadonlySet<string>;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.threshold = config.get<number>(
      'AUTO_PROMOTE_CONFIDENCE_THRESHOLD',
      0.7,
    );
    const excluded = config.get<string>(
      'AUTO_PROMOTE_EXCLUDED_TYPES',
      'mcq_question',
    );
    this.excludedTypes = new Set(
      excluded
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    );
  }

  shouldAutoPromote(
    derivativeType: string,
    confidenceScore: number | null | undefined,
  ): boolean {
    if (confidenceScore == null) return false;
    if (this.excludedTypes.has(derivativeType)) return false;
    return confidenceScore >= this.threshold;
  }

  /**
   * Resolve the (visibility, reviewStatus) the writer should set on
   * artifact insert. Returns the dto-supplied defaults unchanged when
   * auto-promote does not apply.
   */
  initialVisibilityAndStatus(
    derivativeType: string,
    confidenceScore: number | null | undefined,
    dtoVisibility: string | undefined,
    dtoReviewStatus: string | undefined,
  ): { visibility: string; reviewStatus: string; promoted: boolean } {
    if (this.shouldAutoPromote(derivativeType, confidenceScore)) {
      return {
        visibility: 'public_editorial',
        reviewStatus: 'approved',
        promoted: true,
      };
    }
    return {
      visibility: dtoVisibility ?? 'private',
      reviewStatus: dtoReviewStatus ?? 'draft',
      promoted: false,
    };
  }

  /**
   * Atomic audit + review trail for an auto-promoted artifact. Must be
   * called inside the same tx that wrote the artifact (or the sweep's
   * per-row tx) so a failure of either side rolls the whole thing back.
   */
  async recordAutoPromotion(
    tx: Prisma.TransactionClient,
    artifactId: string,
    derivativeType: string,
    confidenceScore: number,
  ): Promise<void> {
    await tx.derivativeReview.create({
      data: {
        derivativeArtifactId: artifactId,
        reviewerUserId: SYSTEM_USER_ID,
        verdict: 'approve',
        notes: `auto-promoted at confidence >= ${this.threshold}`,
      },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: SYSTEM_USER_ID,
        actorType: 'system',
        action: 'derivative_auto_promoted',
        entityType: 'derivative_artifact',
        entityId: artifactId,
        metadataJson: {
          threshold: this.threshold,
          confidence_score: confidenceScore,
          derivative_type: derivativeType,
        },
      },
    });
  }

  /**
   * Periodic catch-up for artifacts that landed before this code shipped
   * or that wrote with confidence < threshold but were later corrected.
   * Bounded to ``SWEEP_BATCH_SIZE`` rows per tick so a backlog drains
   * over multiple ticks instead of locking the table.
   */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async sweepBacklog(): Promise<{ promoted: number; scanned: number }> {
    const excluded = Array.from(this.excludedTypes);
    const candidates = await this.prisma.derivativeArtifact.findMany({
      where: {
        visibility: 'private',
        reviewStatus: { in: ['draft', 'needs_human_review'] },
        derivativeType: excluded.length > 0 ? { notIn: excluded } : undefined,
        confidenceScore: { gte: this.threshold },
        deletedAt: null,
      },
      select: {
        id: true,
        derivativeType: true,
        confidenceScore: true,
      },
      take: SWEEP_BATCH_SIZE,
      orderBy: { createdAt: 'asc' },
    });

    let promoted = 0;
    for (const c of candidates) {
      // Per-row tx so one failure doesn't block the rest of the page.
      try {
        const didPromote = await this.prisma.$transaction(async (tx) => {
          const updated = await tx.derivativeArtifact.updateMany({
            where: {
              id: c.id,
              visibility: 'private',
              reviewStatus: { in: ['draft', 'needs_human_review'] },
            },
            data: {
              visibility: 'public_editorial',
              reviewStatus: 'approved',
            },
          });
          if (updated.count === 0) return false;
          await this.recordAutoPromotion(
            tx,
            c.id,
            c.derivativeType,
            c.confidenceScore ?? 0,
          );
          return true;
        });
        if (didPromote) promoted += 1;
      } catch (err) {
        this.logger.error(
          `auto-promote sweep failed for artifact ${c.id}`,
          err,
        );
      }
    }

    if (promoted > 0) {
      this.logger.log(
        `auto-promote sweep: scanned=${candidates.length} promoted=${promoted}`,
      );
    }
    return { promoted, scanned: candidates.length };
  }
}
