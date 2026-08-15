import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { FeedQueryDto } from './dto';

/**
 * Hard cap on OUTBOUND blocks per user.
 *
 * getHiddenUserIds() feeds its result into `authorId: { notIn: [...] }` on the
 * hottest query in the app, and this keeps the half a user controls from
 * growing without bound. No legitimate user approaches it.
 *
 * It is NOT a bound on the union getHiddenUserIds() returns: the inbound half
 * ("people who blocked me") cannot be capped, because you cannot stop others
 * from blocking you. N accounts each blocking the same victim once still
 * produces an N-element notIn on that victim's queries. That is acceptable at
 * our scale but it is a brigading vector, not a closed invariant — if the
 * inbound half ever grows large, the fix is to move the filter to a
 * NOT EXISTS join rather than to raise this number.
 */
const MAX_BLOCKS_PER_USER = 1000;

/**
 * User-level blocking for the community feed (App Store Guideline 1.2).
 *
 * A block is SYMMETRIC for reads — see the FeedUserBlock model docs. This
 * service owns both the mutations and the read-filter helper that every feed
 * reader composes into its WHERE clause.
 *
 * Depends only on PrismaService, so it can be injected into FeedService,
 * FeedInteractionsService and FeedMediaService without a circular import.
 */
@Injectable()
export class FeedBlocksService {
  private readonly logger = new Logger(FeedBlocksService.name);

  constructor(private readonly prisma: PrismaService) {}

  // =========================================================================
  // Read filter
  // =========================================================================

  /**
   * All user ids the viewer must not see, in either direction: people the
   * viewer blocked, plus people who blocked the viewer.
   *
   * feed_user_blocks is user-scoped, not org-scoped, so this deliberately
   * uses the raw client rather than forTenant() — a block spans orgs because
   * the public feed does.
   */
  async getHiddenUserIds(viewerId: string): Promise<string[]> {
    const rows = await this.prisma.feedUserBlock.findMany({
      where: {
        OR: [{ blockerUserId: viewerId }, { blockedUserId: viewerId }],
      },
      select: { blockerUserId: true, blockedUserId: true },
    });

    const hidden = new Set<string>();
    for (const row of rows) {
      hidden.add(
        row.blockerUserId === viewerId ? row.blockedUserId : row.blockerUserId,
      );
    }
    return [...hidden];
  }

  /**
   * Composable WHERE fragment for author-keyed post queries.
   *
   * Returns an EMPTY object when the viewer has no blocks, which is the case
   * for very nearly every request. That keeps the generated query
   * byte-identical to the pre-blocking one on the hot path, and keeps existing
   * `where`-shape assertions in the service specs from churning.
   */
  hiddenAuthorFilter(hiddenUserIds: string[]): Record<string, unknown> {
    return hiddenUserIds.length > 0
      ? { authorId: { notIn: hiddenUserIds } }
      : {};
  }

  /** Convenience: load and build the filter in one call. */
  async authorFilterFor(viewerId: string): Promise<Record<string, unknown>> {
    return this.hiddenAuthorFilter(await this.getHiddenUserIds(viewerId));
  }

  // =========================================================================
  // Mutations
  // =========================================================================

  async blockUser(blockerUserId: string, blockedUserId: string): Promise<void> {
    if (blockerUserId === blockedUserId) {
      // Not a fingerprinting concern: the caller already knows their own id.
      // A self-block row would make the user invisible to themselves.
      throw new BadRequestException('You cannot block yourself');
    }

    const target = await this.prisma.user.findFirst({
      where: { id: blockedUserId, deletedAt: null },
      select: { id: true },
    });
    if (!target) {
      throw new NotFoundException('User not found');
    }

    // Check for an existing row BEFORE the cap, so that a stale client
    // re-blocking someone already blocked stays a no-op instead of 400-ing
    // once the user happens to sit at the cap.
    const existing = await this.prisma.feedUserBlock.findUnique({
      where: { blockerUserId_blockedUserId: { blockerUserId, blockedUserId } },
      select: { id: true },
    });
    if (existing) return;

    const existingCount = await this.prisma.feedUserBlock.count({
      where: { blockerUserId },
    });
    if (existingCount >= MAX_BLOCKS_PER_USER) {
      throw new BadRequestException(
        `You cannot block more than ${MAX_BLOCKS_PER_USER} users`,
      );
    }

    // Read-then-write, so concurrent requests can overshoot the cap slightly.
    // Acceptable: the cap is a resource guard, not a security boundary, and
    // serialising it would cost a transaction on every block.
    try {
      await this.prisma.feedUserBlock.create({
        data: { blockerUserId, blockedUserId },
      });
    } catch (err: unknown) {
      // Already blocked — idempotent no-op rather than an error, mirroring
      // likePost. Re-blocking from a stale client must not 400.
      if (!this.isPrismaUniqueError(err)) {
        throw err;
      }
    }
  }

  async unblockUser(
    blockerUserId: string,
    blockedUserId: string,
  ): Promise<void> {
    // deleteMany, and the count is ignored: unblocking someone who was never
    // blocked is a no-op, not a 404. Avoids a block-state oracle.
    await this.prisma.feedUserBlock.deleteMany({
      where: { blockerUserId, blockedUserId },
    });
  }

  // =========================================================================
  // Listing
  // =========================================================================

  /**
   * The blocks the viewer created, for the unblock screen.
   *
   * Only the outbound direction — never the inbound one. Surfacing "who
   * blocked me" would defeat the point of a silent block.
   */
  async listBlockedUsers(blockerUserId: string, query: FeedQueryDto) {
    const limit = query.limit ?? 20;

    const rows = await this.prisma.feedUserBlock.findMany({
      take: limit + 1,
      ...(query.cursor && { skip: 1, cursor: { id: query.cursor } }),
      where: { blockerUserId },
      orderBy: { createdAt: 'desc' },
      include: {
        blocked: { select: { id: true, fullName: true } },
      },
    });

    const hasNext = rows.length > limit;
    const results = hasNext ? rows.slice(0, limit) : rows;

    return {
      items: results.map((row) => ({
        id: row.id,
        user: row.blocked,
        createdAt: row.createdAt.toISOString(),
      })),
      hasNext,
      nextCursor: results.length > 0 ? results[results.length - 1]!.id : null,
    };
  }

  private isPrismaUniqueError(err: unknown): boolean {
    return (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: string }).code === 'P2002'
    );
  }
}
