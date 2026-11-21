import { ForbiddenException, Injectable } from '@nestjs/common';
import type { CommunitySanction, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { RESTRICTIVE_SANCTIONS } from './moderation.constants';

/**
 * Enforces community sanctions on every write into the shared community:
 * posts, comments, ratings/reviews and publishing study items. Reports and
 * blocks stay available to sanctioned users on purpose: a suspended user who
 * is being harassed must still be able to report it.
 */
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
}
