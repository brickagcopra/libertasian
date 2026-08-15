import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { FeedBlocksService } from './feed-blocks.service';
import { CreatePostDto, UpdatePostDto, FeedQueryDto } from './dto';

const AUTHOR_SELECT = {
  select: {
    id: true,
    fullName: true,
  },
} as const;

const POST_SELECT = {
  id: true,
  organizationId: true,
  authorId: true,
  textContent: true,
  visibility: true,
  status: true,
  mediaId: true,
  commentCount: true,
  likeCount: true,
  bookmarkCount: true,
  isPinned: true,
  editedAt: true,
  createdAt: true,
  updatedAt: true,
  author: AUTHOR_SELECT,
  media: {
    select: {
      id: true,
      processedObjectKey: true,
      thumbnailObjectKey: true,
      mimeType: true,
      width: true,
      height: true,
      processingStatus: true,
    },
  },
} as const;

@Injectable()
export class FeedService {
  private readonly logger = new Logger(FeedService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly blocks: FeedBlocksService,
  ) {}

  async createPost(dto: CreatePostDto, userId: string, organizationId: string) {
    const hasText = (dto.textContent ?? '').trim().length > 0;
    const hasMedia = !!dto.mediaId;
    if (!hasText && !hasMedia) {
      throw new BadRequestException('Post must have text or an image');
    }

    // Validate media if provided
    if (dto.mediaId) {
      const media = await this.prisma.forTenant(organizationId).feedPostMedia.findUnique({
        where: { id: dto.mediaId },
      });

      if (!media) {
        throw new NotFoundException('Media not found');
      }
      if (media.ownerUserId !== userId) {
        throw new ForbiddenException('Media does not belong to you');
      }
      if (media.processingStatus !== 'ready') {
        throw new BadRequestException('Media is not ready for attachment');
      }

      // Check if media is already attached to another post (unique constraint on FeedPost.mediaId)
      const existingPost = await this.prisma.forTenant(organizationId).feedPost.findUnique({
        where: { mediaId: dto.mediaId },
      });
      if (existingPost) {
        throw new BadRequestException('Media is already attached to another post');
      }
    }

    // Helper also injects this on create; explicit pass kept for TS NOT NULL.
    const post = await this.prisma.forTenant(organizationId).feedPost.create({
      data: {
        organizationId,
        authorId: userId,
        textContent: dto.textContent?.trim() ?? null,
        visibility: dto.visibility ?? 'organization',
        mediaId: dto.mediaId,
      },
      select: POST_SELECT,
    });

    return this.formatPost(post, userId);
  }

  async updatePost(
    postId: string,
    dto: UpdatePostDto,
    userId: string,
    organizationId: string,
  ) {
    // Authorship scoping enforced at the DB layer via updateMany with a
    // compound where clause: { id, authorId, deletedAt: null }. A zero
    // affected-rows result collapses to a single NotFoundException,
    // removing the 403-vs-404 fingerprinting oracle (DF-1). Prior to
    // this fix, findUnique followed by post-hoc authorId / deletedAt
    // checks leaked post existence and authorship — a viewer could
    // distinguish "post doesn't exist" (404) from "post exists but
    // belongs to another user" (403). Collapsing both into 404 matches
    // getPost's shape and forces would-be enumerators to guess blindly.
    const { count } = await this.prisma.forTenant(organizationId).feedPost.updateMany({
      where: { id: postId, authorId: userId, deletedAt: null },
      data: {
        ...(dto.textContent !== undefined && { textContent: dto.textContent }),
        ...(dto.visibility !== undefined && { visibility: dto.visibility }),
        editedAt: new Date(),
      },
    });

    if (count === 0) {
      throw new NotFoundException('Post not found');
    }

    const updated = await this.prisma.forTenant(organizationId).feedPost.findUniqueOrThrow({
      where: { id: postId },
      select: POST_SELECT,
    });

    return this.formatPost(updated, userId);
  }

  async deletePost(postId: string, userId: string, organizationId: string) {
    // Same DF-1 collapse as updatePost: soft-delete via updateMany so
    // the authorship + not-already-deleted check happens atomically in
    // the WHERE clause, with a single NotFoundException on miss.
    const { count } = await this.prisma.forTenant(organizationId).feedPost.updateMany({
      where: { id: postId, authorId: userId, deletedAt: null },
      data: {
        deletedAt: new Date(),
        status: 'removed_by_author',
      },
    });

    if (count === 0) {
      throw new NotFoundException('Post not found');
    }
  }

  async getPost(postId: string, userId: string, viewerOrgId: string) {
    // Tenant-visibility scoping enforced at the DB layer: a single
    // NotFoundException branch covers "post doesn't exist", "soft-deleted",
    // "non-published", and "not readable from viewer's org". Keeping one
    // exception shape prevents an attacker from fingerprinting the
    // existence or org membership of a post via error type. (E14)
    // A blocked author's post collapses into the same NotFoundException as
    // every other unreadable case above — no new error branch, so blocking
    // does not become a fingerprinting oracle either. (E14)
    // CARVE-OUT: cross-org public read — forTenant() would break visibility: 'public'
    const post = await this.prisma.feedPost.findFirst({
      where: {
        id: postId,
        status: 'published',
        deletedAt: null,
        OR: [
          { visibility: 'public' },
          { visibility: 'organization', organizationId: viewerOrgId },
        ],
        ...(await this.blocks.authorFilterFor(userId)),
      },
      select: POST_SELECT,
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    return this.formatPost(post, userId);
  }

  async getPublicFeed(query: FeedQueryDto, userId: string) {
    // CARVE-OUT: cross-org public read — forTenant() would break visibility: 'public'
    return this.queryFeed(
      {
        visibility: 'public',
        status: 'published',
        deletedAt: null,
        ...(await this.blocks.authorFilterFor(userId)),
      },
      query,
      userId,
    );
  }

  async getOrganizationFeed(query: FeedQueryDto, organizationId: string, userId: string) {
    // The existing `organizationId` predicate in this WHERE clause is
    // the tenant guard. Kept on raw `this.prisma.*` because queryFeed
    // is shared with the cross-org public/profile readers below, which
    // CANNOT be forTenant()-wrapped without breaking visibility: 'public'.
    return this.queryFeed(
      {
        organizationId,
        status: 'published',
        deletedAt: null,
        visibility: { in: ['organization', 'public'] },
        ...(await this.blocks.authorFilterFor(userId)),
      },
      query,
      userId,
    );
  }

  async getUserProfileFeed(query: FeedQueryDto, profileUserId: string, requesterId: string) {
    const isSelf = profileUserId === requesterId;

    // Blocking short-circuits here rather than spreading hiddenAuthorFilter()
    // into the WHERE below: this reader already keys on `authorId`, and
    // `authorId: { notIn: [...] }` would overwrite it and silently widen the
    // query to every author. An empty page is also the honest answer — a
    // blocked author's profile has nothing the viewer may see.
    if (!isSelf) {
      const hidden = await this.blocks.getHiddenUserIds(requesterId);
      if (hidden.includes(profileUserId)) {
        return { items: [], hasNext: false, nextCursor: null };
      }
    }

    // CARVE-OUT: cross-org public read — forTenant() would break visibility: 'public'
    return this.queryFeed(
      {
        authorId: profileUserId,
        status: 'published',
        deletedAt: null,
        ...(isSelf ? {} : { visibility: 'public' }),
      },
      query,
      requesterId,
    );
  }

  async getBookmarkedPosts(
    query: FeedQueryDto,
    userId: string,
    viewerOrgId: string,
  ) {
    const limit = query.limit ?? 20;

    // Tenant visibility + liveness enforced at the DB layer via a
    // relational filter on `post`. Prisma only returns bookmark rows
    // whose related post is published, not soft-deleted, and readable
    // to the viewer (public, or organization-scoped to the viewer's
    // org). This closes the E14-class bypass where a stale bookmark
    // (e.g. created while a post was public, then flipped to
    // organization visibility) would otherwise keep leaking the post's
    // full content via /feed/bookmarks. It also removes the former
    // JS-side `.filter(... !b.post.updatedAt)` typo, which had meant
    // `updatedAt` instead of `deletedAt` and was always truthy —
    // folded into this same fix as a side effect of moving the filter
    // into the query.
    // CARVE-OUT: cross-org public read — forTenant() would break visibility: 'public'.
    // feedPostBookmark is also user-scoped and not in the forTenant model map.
    const bookmarks = await this.prisma.feedPostBookmark.findMany({
      take: limit + 1,
      ...(query.cursor && { skip: 1, cursor: { id: query.cursor } }),
      where: {
        userId,
        post: {
          status: 'published',
          deletedAt: null,
          OR: [
            { visibility: 'public' },
            { visibility: 'organization', organizationId: viewerOrgId },
          ],
          // The bookmark row itself is left alone — blocking is a view
          // filter, not a delete — so unblocking restores the bookmark.
          ...(await this.blocks.authorFilterFor(userId)),
        },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        post: {
          select: POST_SELECT,
        },
      },
    });

    const hasNext = bookmarks.length > limit;
    const results = hasNext ? bookmarks.slice(0, limit) : bookmarks;

    const items = await Promise.all(
      results.map((b) => this.formatPost(b.post, userId)),
    );

    return {
      items,
      hasNext,
      nextCursor: results.length > 0 ? results[results.length - 1]!.id : null,
    };
  }

  // ─── Private Helpers ────────────────────────────────────────────────

  private async queryFeed(
    where: Record<string, unknown>,
    query: FeedQueryDto,
    userId: string,
  ) {
    const limit = query.limit ?? 20;

    // CARVE-OUT: cross-org public read — forTenant() would break visibility: 'public'.
    // Callers pass heterogeneous where clauses including cross-org public predicates.
    const posts = await this.prisma.feedPost.findMany({
      take: limit + 1,
      ...(query.cursor && { skip: 1, cursor: { id: query.cursor } }),
      where,
      orderBy: { createdAt: 'desc' },
      select: POST_SELECT,
    });

    const hasNext = posts.length > limit;
    const results = hasNext ? posts.slice(0, limit) : posts;

    const items = await Promise.all(
      results.map((post) => this.formatPost(post, userId)),
    );

    return {
      items,
      hasNext,
      nextCursor: results.length > 0 ? results[results.length - 1]!.id : null,
    };
  }

  private async formatPost(
    post: {
      id: string;
      organizationId: string;
      authorId: string;
      textContent: string | null;
      visibility: string;
      status: string;
      mediaId: string | null;
      commentCount: number;
      likeCount: number;
      bookmarkCount: number;
      isPinned: boolean;
      editedAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
      author: { id: string; fullName: string };
      media: {
        id: string;
        processedObjectKey: string | null;
        thumbnailObjectKey: string | null;
        mimeType: string;
        width: number | null;
        height: number | null;
        processingStatus: string;
      } | null;
    },
    requestingUserId: string,
  ) {
    // Batch check like + bookmark status
    // CARVE-OUT: feedPostLike + feedPostBookmark are user-scoped junction
    // tables and are intentionally NOT in the forTenant model map.
    const [like, bookmark] = await Promise.all([
      this.prisma.feedPostLike.findUnique({
        where: { postId_userId: { postId: post.id, userId: requestingUserId } },
      }),
      this.prisma.feedPostBookmark.findUnique({
        where: { postId_userId: { postId: post.id, userId: requestingUserId } },
      }),
    ]);

    return {
      id: post.id,
      organizationId: post.organizationId,
      textContent: post.textContent,
      visibility: post.visibility,
      commentCount: post.commentCount,
      likeCount: post.likeCount,
      bookmarkCount: post.bookmarkCount,
      isPinned: post.isPinned,
      editedAt: post.editedAt?.toISOString() ?? null,
      createdAt: post.createdAt.toISOString(),
      updatedAt: post.updatedAt.toISOString(),
      author: {
        id: post.author.id,
        fullName: post.author.fullName,
      },
      media: post.media
        ? {
            id: post.media.id,
            processedObjectKey: post.media.processedObjectKey,
            thumbnailObjectKey: post.media.thumbnailObjectKey,
            mimeType: post.media.mimeType,
            width: post.media.width,
            height: post.media.height,
            processingStatus: post.media.processingStatus,
          }
        : null,
      isLikedByMe: !!like,
      isBookmarkedByMe: !!bookmark,
    };
  }
}
