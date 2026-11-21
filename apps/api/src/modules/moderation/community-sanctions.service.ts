import { ForbiddenException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { CommunitySanction, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { REPORT_DAILY_CAP, RESTRICTIVE_SANCTIONS } from './moderation.constants';

/**
 * Enforces community sanctions on every write into the shared community:
 * posts, comments, ratings/reviews and publishing study items. Reports and
 * blocks stay available to sanctioned users on purpose: a suspended user who
 * is being harassed must still be able to report it.
 */
const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class CommunitySanctionsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Where-clause for sanctions restricting participation at `now`. */
  static activeWhere(now: Date): Prisma.CommunitySanctionWhereInput {
    return {
      type: { in: [...RESTRICTIVE_SANCTIONS] },
      revokedAt: null,
      startsAt: { lte: now },
      OR: [{ endsAt: null }, { endsAt: { gt: now } }],
    };
  }

  static isActive(
    s: Pick<CommunitySanction, 'type' | 'revokedAt' | 'startsAt' | 'endsAt'>,
    now: Date = new Date(),
  ): boolean {
    return (
      (RESTRICTIVE_SANCTIONS as readonly string[]).includes(s.type) &&
      s.revokedAt === null &&
      s.startsAt <= now &&
      (s.endsAt === null || s.endsAt > now)
    );
  }

  async getActiveSanction(userId: string): Promise<CommunitySanction | null> {
    const now = new Date();
    return this.prisma.communitySanction.findFirst({
      where: { userId, ...CommunitySanctionsService.activeWhere(now) },
      // A ban outranks a suspension; among equals, the latest-ending wins.
      orderBy: [{ type: 'asc' }, { endsAt: { sort: 'desc', nulls: 'first' } }],
    });
  }

  /**
   * Gate for making a study item public. The author must be in good standing,
   * and an item a moderator removed stays removed: without this, the author
   * could undo a removal by setting visibility back to public_editorial.
   */
  async assertCanPublish(
    userId: string,
    target?: { targetType: 'flashcard_set' | 'reviewer_pack'; targetId: string },
  ): Promise<void> {
    await this.assertCanParticipate(userId);
    if (!target) return;
    const last = await this.prisma.moderationAction.findFirst({
      where: { targetType: target.targetType, targetId: target.targetId, action: { in: ['remove', 'restore'] } },
      orderBy: { createdAt: 'desc' },
      select: { action: true },
    });
    if (last?.action === 'remove') {
      throw new ForbiddenException(
        "A moderator removed this from the community for breaking our Community Guidelines, so it can't be made public again.",
      );
    }
  }

  /** Throws 403 if the user is suspended or banned from the community. */
  async assertCanParticipate(userId: string): Promise<void> {
    const sanction = await this.getActiveSanction(userId);
    if (!sanction) return;

    if (sanction.type === 'ban' || sanction.endsAt === null) {
      throw new ForbiddenException(
        "You've been banned from posting in the LIBERTASIAN community for breaking our Community Guidelines.",
      );
    }
    const until = sanction.endsAt.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'Asia/Manila',
    });
    throw new ForbiddenException(
      `Your community access is suspended until ${until} for breaking our Community Guidelines.`,
    );
  }

  /**
   * Per-user cap on reports filed in a rolling 24 hours, across posts,
   * comments and community items. A real reporter never comes close; the cap
   * stops one account from mass-flagging (and, past AUTO_HIDE_THRESHOLD,
   * mass-hiding) content. Throws 429 quota_exceeded with retryAfterSeconds.
   */
  async assertCanReport(userId: string, now: Date = new Date()): Promise<void> {
    const since = new Date(now.getTime() - DAY_MS);
    const where = { reporterUserId: userId, createdAt: { gte: since } };
    const args = { where, _count: { _all: true }, _min: { createdAt: true } } as const;
    const [posts, comments, flags] = await Promise.all([
      this.prisma.feedPostReport.aggregate(args),
      this.prisma.feedCommentReport.aggregate(args),
      this.prisma.communityFlag.aggregate(args),
    ]);
    const parts = [posts, comments, flags];
    const count = parts.reduce((n, p) => n + p._count._all, 0);
    if (count < REPORT_DAILY_CAP) return;

    const oldest = parts
      .map((p) => p._min.createdAt)
      .filter((d): d is Date => d !== null)
      .reduce((m, d) => (d < m ? d : m), now);
    const retryAfterSeconds = Math.max(60, Math.ceil((oldest.getTime() + DAY_MS - now.getTime()) / 1000));
    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        error: 'quota_exceeded',
        code: 'quota_exceeded',
        message: `You've reached the limit of ${REPORT_DAILY_CAP} reports in 24 hours. Our moderators review every report; please try again later.`,
        retryAfterSeconds,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
