import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import {
  MarketplaceQueryDto,
  CreateCommunityRatingDto,
  ListRatingsQueryDto,
  UpsertCommunityVoteDto,
  CreateCommunityFlagDto,
  ResolveCommunityFlagDto,
  ListFlagsQueryDto,
  SubmitExpertVerificationDto,
  ResolveExpertVerificationDto,
  ListExpertVerificationsQueryDto,
} from './dto';

// ─── Helpers ──────────────────────────────────────────────────────────────

const VOTABLE_ENTITY_TYPES = ['digest'] as const;

@Injectable()
export class CommunityService {
  private readonly logger = new Logger(CommunityService.name);

  constructor(private readonly prisma: PrismaService) {}

  // =========================================================================
  // Entity Validation
  // =========================================================================

  private async validatePublicEntity(
    entityType: string,
    entityId: string,
  ): Promise<void> {
    let entity: { visibility: string } | null = null;

    switch (entityType) {
      case 'flashcard_set':
        entity = await this.prisma.flashcardSet.findUnique({
          where: { id: entityId },
          select: { visibility: true },
        });
        break;
      case 'reviewer_pack':
        entity = await this.prisma.reviewerPack.findUnique({
          where: { id: entityId },
          select: { visibility: true },
        });
        break;
      case 'digest':
        entity = await this.prisma.digest.findUnique({
          where: { id: entityId },
          select: { visibility: true },
        });
        break;
      default:
        throw new BadRequestException(`Unknown entity type: ${entityType}`);
    }

    if (!entity) {
      throw new NotFoundException(`${entityType} not found`);
    }
    if (entity.visibility !== 'public_editorial') {
      throw new ForbiddenException('Entity is not publicly visible');
    }
  }

  // =========================================================================
  // Marketplace Browse
  // =========================================================================

  private buildOrderBy(sortBy: string): Record<string, string> {
    switch (sortBy) {
      case 'newest':
        return { createdAt: 'desc' };
      case 'top_rated':
        return { avgRating: 'desc' };
      case 'most_reviewed':
        return { ratingCount: 'desc' };
      case 'trending':
        return { ratingCount: 'desc' };
      default:
        return { avgRating: 'desc' };
    }
  }

  private readonly creatorInclude = {
    select: {
      id: true,
      fullName: true,
      expertVerification: {
        select: { expertiseType: true, status: true },
      },
    },
  } as const;

  async browseFlashcardSets(query: MarketplaceQueryDto) {
    const limit = query.limit ?? 20;
    const orderBy = this.buildOrderBy(query.sortBy ?? 'top_rated');

    const where: Prisma.FlashcardSetWhereInput = {
      visibility: 'public_editorial',
      ...(query.barSubject && { barSubject: query.barSubject }),
      ...(query.search && {
        title: { contains: query.search, mode: 'insensitive' as const },
      }),
    };

    const items = await this.prisma.flashcardSet.findMany({
      take: limit + 1,
      ...(query.cursor && { skip: 1, cursor: { id: query.cursor } }),
      where,
      orderBy,
      select: {
        id: true,
        title: true,
        description: true,
        barSubject: true,
        topic: true,
        avgRating: true,
        ratingCount: true,
        cardCount: true,
        createdAt: true,
        updatedAt: true,
        user: this.creatorInclude,
      },
    });

    const hasNext = items.length > limit;
    const results = hasNext ? items.slice(0, limit) : items;

    return {
      items: results.map((item) => ({
        id: item.id,
        contentType: 'flashcard_set' as const,
        title: item.title,
        description: item.description,
        barSubject: item.barSubject,
        topic: item.topic,
        avgRating: item.avgRating,
        ratingCount: item.ratingCount,
        itemCount: item.cardCount,
        creator: {
          id: item.user.id,
          fullName: item.user.fullName,
          expertVerification: item.user.expertVerification,
        },
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      })),
      hasNext,
      nextCursor: results.length > 0 ? results[results.length - 1]!.id : null,
    };
  }

  async browseReviewerPacks(query: MarketplaceQueryDto) {
    const limit = query.limit ?? 20;
    const orderBy = this.buildOrderBy(query.sortBy ?? 'top_rated');

    const where: Prisma.ReviewerPackWhereInput = {
      visibility: 'public_editorial',
      ...(query.barSubject && { barSubject: query.barSubject }),
      ...(query.search && {
        title: { contains: query.search, mode: 'insensitive' as const },
      }),
    };

    const items = await this.prisma.reviewerPack.findMany({
      take: limit + 1,
      ...(query.cursor && { skip: 1, cursor: { id: query.cursor } }),
      where,
      orderBy,
      select: {
        id: true,
        title: true,
        description: true,
        barSubject: true,
        topic: true,
        avgRating: true,
        ratingCount: true,
        itemCount: true,
        createdAt: true,
        updatedAt: true,
        creator: this.creatorInclude,
      },
    });

    const hasNext = items.length > limit;
    const results = hasNext ? items.slice(0, limit) : items;

    return {
      items: results.map((item) => ({
        id: item.id,
        contentType: 'reviewer_pack' as const,
        title: item.title,
        description: item.description,
        barSubject: item.barSubject,
        topic: item.topic,
        avgRating: item.avgRating,
        ratingCount: item.ratingCount,
        itemCount: item.itemCount,
        creator: {
          id: item.creator.id,
          fullName: item.creator.fullName,
          expertVerification: item.creator.expertVerification,
        },
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      })),
      hasNext,
      nextCursor: results.length > 0 ? results[results.length - 1]!.id : null,
    };
  }

  async browseDigests(query: MarketplaceQueryDto) {
    const limit = query.limit ?? 20;
    const sortBy = query.sortBy ?? 'top_rated';

    let orderBy: Prisma.DigestOrderByWithRelationInput;
    switch (sortBy) {
      case 'newest':
        orderBy = { createdAt: 'desc' };
        break;
      case 'most_reviewed':
        orderBy = { ratingCount: 'desc' };
        break;
      case 'trending':
        orderBy = { voteScore: 'desc' };
        break;
      default:
        orderBy = { avgRating: 'desc' };
    }

    const where: Prisma.DigestWhereInput = {
      visibility: 'public_editorial',
      ...(query.search && {
        title: { contains: query.search, mode: 'insensitive' as const },
      }),
    };

    const items = await this.prisma.digest.findMany({
      take: limit + 1,
      ...(query.cursor && { skip: 1, cursor: { id: query.cursor } }),
      where,
      orderBy,
      select: {
        id: true,
        title: true,
        summary: true,
        digestType: true,
        avgRating: true,
        ratingCount: true,
        voteScore: true,
        createdAt: true,
        updatedAt: true,
        user: this.creatorInclude,
      },
    });

    const hasNext = items.length > limit;
    const results = hasNext ? items.slice(0, limit) : items;

    return {
      items: results.map((item) => ({
        id: item.id,
        contentType: 'digest' as const,
        title: item.title,
        description: item.summary,
        barSubject: null,
        topic: item.digestType,
        avgRating: item.avgRating,
        ratingCount: item.ratingCount,
        voteScore: item.voteScore,
        itemCount: 0,
        creator: item.user
          ? {
              id: item.user.id,
              fullName: item.user.fullName,
              expertVerification: item.user.expertVerification,
            }
          : { id: '', fullName: 'System', expertVerification: null },
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      })),
      hasNext,
      nextCursor: results.length > 0 ? results[results.length - 1]!.id : null,
    };
  }

  async getFeatured() {
    const [flashcardSets, reviewerPacks, digests] = await Promise.all([
      this.prisma.flashcardSet.findMany({
        where: { visibility: 'public_editorial', ratingCount: { gt: 0 } },
        orderBy: { avgRating: 'desc' },
        take: 6,
        select: {
          id: true,
          title: true,
          description: true,
          barSubject: true,
          topic: true,
          avgRating: true,
          ratingCount: true,
          cardCount: true,
          createdAt: true,
          updatedAt: true,
          user: this.creatorInclude,
        },
      }),
      this.prisma.reviewerPack.findMany({
        where: { visibility: 'public_editorial', ratingCount: { gt: 0 } },
        orderBy: { avgRating: 'desc' },
        take: 6,
        select: {
          id: true,
          title: true,
          description: true,
          barSubject: true,
          topic: true,
          avgRating: true,
          ratingCount: true,
          itemCount: true,
          createdAt: true,
          updatedAt: true,
          creator: this.creatorInclude,
        },
      }),
      this.prisma.digest.findMany({
        where: { visibility: 'public_editorial', ratingCount: { gt: 0 } },
        orderBy: { avgRating: 'desc' },
        take: 6,
        select: {
          id: true,
          title: true,
          summary: true,
          digestType: true,
          avgRating: true,
          ratingCount: true,
          voteScore: true,
          createdAt: true,
          updatedAt: true,
          user: this.creatorInclude,
        },
      }),
    ]);

    return {
      flashcardSets: flashcardSets.map((item) => ({
        id: item.id,
        contentType: 'flashcard_set' as const,
        title: item.title,
        description: item.description,
        barSubject: item.barSubject,
        topic: item.topic,
        avgRating: item.avgRating,
        ratingCount: item.ratingCount,
        itemCount: item.cardCount,
        creator: {
          id: item.user.id,
          fullName: item.user.fullName,
          expertVerification: item.user.expertVerification,
        },
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      })),
      reviewerPacks: reviewerPacks.map((item) => ({
        id: item.id,
        contentType: 'reviewer_pack' as const,
        title: item.title,
        description: item.description,
        barSubject: item.barSubject,
        topic: item.topic,
        avgRating: item.avgRating,
        ratingCount: item.ratingCount,
        itemCount: item.itemCount,
        creator: {
          id: item.creator.id,
          fullName: item.creator.fullName,
          expertVerification: item.creator.expertVerification,
        },
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      })),
      digests: digests.map((item) => ({
        id: item.id,
        contentType: 'digest' as const,
        title: item.title,
        description: item.summary,
        barSubject: null,
        topic: item.digestType,
        avgRating: item.avgRating,
        ratingCount: item.ratingCount,
        voteScore: item.voteScore,
        itemCount: 0,
        creator: item.user
          ? {
              id: item.user.id,
              fullName: item.user.fullName,
              expertVerification: item.user.expertVerification,
            }
          : { id: '', fullName: 'System', expertVerification: null },
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      })),
    };
  }

  async getContributorProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        fullName: true,
        createdAt: true,
        expertVerification: {
          select: { expertiseType: true, status: true },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const [flashcardSetCount, reviewerPackCount, digestCount, ratingStats] =
      await Promise.all([
        this.prisma.flashcardSet.count({
          where: { userId, visibility: 'public_editorial' },
        }),
        this.prisma.reviewerPack.count({
          where: { creatorUserId: userId, visibility: 'public_editorial' },
        }),
        this.prisma.digest.count({
          where: { userId, visibility: 'public_editorial' },
        }),
        this.prisma.communityRating.aggregate({
          where: {
            OR: [
              {
                entityType: 'flashcard_set',
                entityId: {
                  in: await this.prisma.flashcardSet
                    .findMany({
                      where: { userId, visibility: 'public_editorial' },
                      select: { id: true },
                    })
                    .then((sets) => sets.map((s) => s.id)),
                },
              },
              {
                entityType: 'reviewer_pack',
                entityId: {
                  in: await this.prisma.reviewerPack
                    .findMany({
                      where: {
                        creatorUserId: userId,
                        visibility: 'public_editorial',
                      },
                      select: { id: true },
                    })
                    .then((packs) => packs.map((p) => p.id)),
                },
              },
              {
                entityType: 'digest',
                entityId: {
                  in: await this.prisma.digest
                    .findMany({
                      where: { userId, visibility: 'public_editorial' },
                      select: { id: true },
                    })
                    .then((digests) => digests.map((d) => d.id)),
                },
              },
            ],
          },
          _count: true,
          _avg: { score: true },
        }),
      ]);

    return {
      user: {
        id: user.id,
        fullName: user.fullName,
        createdAt: user.createdAt.toISOString(),
      },
      expertVerification: user.expertVerification,
      stats: {
        flashcardSetCount,
        reviewerPackCount,
        digestCount,
        totalRatingsReceived: ratingStats._count,
        avgRating: ratingStats._avg.score,
      },
    };
  }

  // =========================================================================
  // Ratings
  // =========================================================================

  async upsertRating(userId: string, dto: CreateCommunityRatingDto) {
    await this.validatePublicEntity(dto.entityType, dto.entityId);

    const rating = await this.prisma.communityRating.upsert({
      where: {
        userId_entityType_entityId: {
          userId,
          entityType: dto.entityType,
          entityId: dto.entityId,
        },
      },
      create: {
        userId,
        entityType: dto.entityType,
        entityId: dto.entityId,
        score: dto.score,
        reviewTitle: dto.reviewTitle,
        reviewBody: dto.reviewBody,
      },
      update: {
        score: dto.score,
        reviewTitle: dto.reviewTitle,
        reviewBody: dto.reviewBody,
      },
    });

    await this.recalculateRatingAggregates(dto.entityType, dto.entityId);
    return rating;
  }

  async listRatings(
    entityType: string,
    entityId: string,
    query: ListRatingsQueryDto,
  ) {
    const limit = query.limit ?? 20;

    const items = await this.prisma.communityRating.findMany({
      take: limit + 1,
      ...(query.cursor && { skip: 1, cursor: { id: query.cursor } }),
      where: { entityType, entityId },
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, fullName: true } },
      },
    });

    const hasNext = items.length > limit;
    const results = hasNext ? items.slice(0, limit) : items;

    // Get aggregate info
    const aggregate = await this.prisma.communityRating.groupBy({
      by: ['score'],
      where: { entityType, entityId },
      _count: true,
    });

    const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let totalScore = 0;
    let totalCount = 0;
    for (const row of aggregate) {
      distribution[row.score] = row._count;
      totalScore += row.score * row._count;
      totalCount += row._count;
    }

    return {
      items: results.map((r) => ({
        id: r.id,
        userId: r.userId,
        entityType: r.entityType,
        entityId: r.entityId,
        score: r.score,
        reviewTitle: r.reviewTitle,
        reviewBody: r.reviewBody,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
        user: r.user,
      })),
      aggregate: {
        avgRating: totalCount > 0 ? totalScore / totalCount : null,
        ratingCount: totalCount,
        distribution,
      },
      hasNext,
      nextCursor: results.length > 0 ? results[results.length - 1]!.id : null,
    };
  }

  async getMyRating(userId: string, entityType: string, entityId: string) {
    return this.prisma.communityRating.findUnique({
      where: {
        userId_entityType_entityId: { userId, entityType, entityId },
      },
    });
  }

  async deleteRating(userId: string, ratingId: string) {
    const rating = await this.prisma.communityRating.findUnique({
      where: { id: ratingId },
    });

    if (!rating) {
      throw new NotFoundException('Rating not found');
    }
    if (rating.userId !== userId) {
      throw new ForbiddenException('Cannot delete another user\'s rating');
    }

    await this.prisma.communityRating.delete({ where: { id: ratingId } });
    await this.recalculateRatingAggregates(rating.entityType, rating.entityId);
  }

  private async recalculateRatingAggregates(
    entityType: string,
    entityId: string,
  ) {
    const agg = await this.prisma.communityRating.aggregate({
      where: { entityType, entityId },
      _avg: { score: true },
      _count: true,
    });

    const avgRating = agg._avg.score;
    const ratingCount = agg._count;

    switch (entityType) {
      case 'flashcard_set':
        await this.prisma.flashcardSet.update({
          where: { id: entityId },
          data: { avgRating, ratingCount },
        });
        break;
      case 'reviewer_pack':
        await this.prisma.reviewerPack.update({
          where: { id: entityId },
          data: { avgRating, ratingCount },
        });
        break;
      case 'digest':
        await this.prisma.digest.update({
          where: { id: entityId },
          data: { avgRating, ratingCount },
        });
        break;
    }
  }

  // =========================================================================
  // Votes (Community Digest Curation)
  // =========================================================================

  async upsertVote(
    userId: string,
    entityType: string,
    entityId: string,
    dto: UpsertCommunityVoteDto,
  ) {
    if (!VOTABLE_ENTITY_TYPES.includes(entityType as (typeof VOTABLE_ENTITY_TYPES)[number])) {
      throw new BadRequestException('Votes are only supported on digests');
    }

    await this.validatePublicEntity(entityType, entityId);

    const vote = await this.prisma.communityVote.upsert({
      where: {
        userId_entityType_entityId: { userId, entityType, entityId },
      },
      create: { userId, entityType, entityId, voteType: dto.voteType },
      update: { voteType: dto.voteType },
    });

    await this.recalculateVoteScore(entityType, entityId);
    return vote;
  }

  async removeVote(userId: string, entityType: string, entityId: string) {
    const vote = await this.prisma.communityVote.findUnique({
      where: {
        userId_entityType_entityId: { userId, entityType, entityId },
      },
    });

    if (!vote) {
      throw new NotFoundException('Vote not found');
    }

    await this.prisma.communityVote.delete({ where: { id: vote.id } });
    await this.recalculateVoteScore(entityType, entityId);
  }

  async getMyVote(userId: string, entityType: string, entityId: string) {
    return this.prisma.communityVote.findUnique({
      where: {
        userId_entityType_entityId: { userId, entityType, entityId },
      },
    });
  }

  private async recalculateVoteScore(entityType: string, entityId: string) {
    if (entityType !== 'digest') return;

    const [upCount, downCount] = await Promise.all([
      this.prisma.communityVote.count({
        where: { entityType, entityId, voteType: 'up' },
      }),
      this.prisma.communityVote.count({
        where: { entityType, entityId, voteType: 'down' },
      }),
    ]);

    await this.prisma.digest.update({
      where: { id: entityId },
      data: { voteScore: upCount - downCount },
    });
  }

  // =========================================================================
  // Flags
  // =========================================================================

  async createFlag(userId: string, dto: CreateCommunityFlagDto) {
    return this.prisma.communityFlag.create({
      data: {
        reporterUserId: userId,
        entityType: dto.entityType,
        entityId: dto.entityId,
        reason: dto.reason,
        details: dto.details,
      },
    });
  }

  async listFlags(query: ListFlagsQueryDto) {
    const limit = query.limit ?? 20;

    const where: Prisma.CommunityFlagWhereInput = {
      ...(query.status ? { status: query.status } : { status: 'open' }),
    };

    const items = await this.prisma.communityFlag.findMany({
      take: limit + 1,
      ...(query.cursor && { skip: 1, cursor: { id: query.cursor } }),
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        reporter: { select: { id: true, fullName: true } },
        resolvedBy: { select: { id: true, fullName: true } },
      },
    });

    const hasNext = items.length > limit;
    const results = hasNext ? items.slice(0, limit) : items;

    return {
      items: results.map((f) => ({
        id: f.id,
        reporterUserId: f.reporterUserId,
        entityType: f.entityType,
        entityId: f.entityId,
        reason: f.reason,
        details: f.details,
        status: f.status,
        resolvedByUserId: f.resolvedByUserId,
        resolutionNote: f.resolutionNote,
        resolvedAt: f.resolvedAt?.toISOString() ?? null,
        createdAt: f.createdAt.toISOString(),
        reporter: f.reporter,
        resolvedBy: f.resolvedBy,
      })),
      hasNext,
      nextCursor: results.length > 0 ? results[results.length - 1]!.id : null,
    };
  }

  async resolveFlag(flagId: string, resolverUserId: string, dto: ResolveCommunityFlagDto) {
    const flag = await this.prisma.communityFlag.findUnique({
      where: { id: flagId },
    });

    if (!flag) {
      throw new NotFoundException('Flag not found');
    }
    if (flag.status !== 'open') {
      throw new BadRequestException('Flag is already resolved');
    }

    return this.prisma.communityFlag.update({
      where: { id: flagId },
      data: {
        status: dto.status,
        resolvedByUserId: resolverUserId,
        resolutionNote: dto.resolutionNote,
        resolvedAt: new Date(),
      },
    });
  }

  // =========================================================================
  // Expert Verification
  // =========================================================================

  async submitExpertVerification(
    userId: string,
    dto: SubmitExpertVerificationDto,
  ) {
    const existing = await this.prisma.expertVerification.findUnique({
      where: { userId },
    });

    if (existing && existing.status === 'approved') {
      throw new ConflictException('You already have an approved verification');
    }
    if (existing && existing.status === 'pending') {
      throw new ConflictException('You already have a pending verification request');
    }

    if (existing) {
      // Re-submit after rejection/revocation
      return this.prisma.expertVerification.update({
        where: { userId },
        data: {
          expertiseType: dto.expertiseType,
          credentialDetails: dto.credentialDetails,
          status: 'pending',
          reviewNote: null,
          reviewedAt: null,
        },
      });
    }

    return this.prisma.expertVerification.create({
      data: {
        userId,
        expertiseType: dto.expertiseType,
        credentialDetails: dto.credentialDetails,
      },
    });
  }

  async getMyExpertVerification(userId: string) {
    return this.prisma.expertVerification.findUnique({
      where: { userId },
    });
  }

  async listExpertVerifications(query: ListExpertVerificationsQueryDto) {
    const limit = query.limit ?? 20;

    const where: Prisma.ExpertVerificationWhereInput = {
      ...(query.status ? { status: query.status } : { status: 'pending' }),
    };

    const items = await this.prisma.expertVerification.findMany({
      take: limit + 1,
      ...(query.cursor && { skip: 1, cursor: { id: query.cursor } }),
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, fullName: true, email: true } },
      },
    });

    const hasNext = items.length > limit;
    const results = hasNext ? items.slice(0, limit) : items;

    return {
      items: results.map((v) => ({
        id: v.id,
        userId: v.userId,
        expertiseType: v.expertiseType,
        credentialDetails: v.credentialDetails,
        status: v.status,
        reviewNote: v.reviewNote,
        reviewedAt: v.reviewedAt?.toISOString() ?? null,
        createdAt: v.createdAt.toISOString(),
        updatedAt: v.updatedAt.toISOString(),
        user: v.user,
      })),
      hasNext,
      nextCursor: results.length > 0 ? results[results.length - 1]!.id : null,
    };
  }

  async resolveExpertVerification(
    verificationId: string,
    dto: ResolveExpertVerificationDto,
  ) {
    const verification = await this.prisma.expertVerification.findUnique({
      where: { id: verificationId },
    });

    if (!verification) {
      throw new NotFoundException('Verification not found');
    }

    // Only allow revoke on approved verifications
    if (dto.status === 'revoked' && verification.status !== 'approved') {
      throw new BadRequestException('Can only revoke approved verifications');
    }

    // Only allow approve/reject on pending verifications
    if (
      (dto.status === 'approved' || dto.status === 'rejected') &&
      verification.status !== 'pending'
    ) {
      throw new BadRequestException(
        'Can only approve or reject pending verifications',
      );
    }

    return this.prisma.expertVerification.update({
      where: { id: verificationId },
      data: {
        status: dto.status,
        reviewNote: dto.reviewNote,
        reviewedAt: new Date(),
      },
    });
  }
}
