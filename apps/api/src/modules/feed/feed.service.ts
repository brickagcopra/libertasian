import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
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

  constructor(private readonly prisma: PrismaService) {}

  async createPost(dto: CreatePostDto, userId: string, organizationId: string) {
    // Validate media if provided
    if (dto.mediaId) {
      const media = await this.prisma.feedPostMedia.findUnique({
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
      const existingPost = await this.prisma.feedPost.findUnique({
        where: { mediaId: dto.mediaId },
      });
      if (existingPost) {
        throw new BadRequestException('Media is already attached to another post');
      }
    }

    const post = await this.prisma.feedPost.create({
      data: {
        organizationId,
        authorId: userId,
        textContent: dto.textContent,
        visibility: dto.visibility ?? 'organization',
        mediaId: dto.mediaId,
      },
      select: POST_SELECT,
    });

    return this.formatPost(post, userId);
  }

  async updatePost(postId: string, dto: UpdatePostDto, userId: string) {
    const post = await this.prisma.feedPost.findUnique({
      where: { id: postId },
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }
    if (post.authorId !== userId) {
      throw new ForbiddenException('Cannot edit another user\'s post');
    }
    if (post.deletedAt) {
      throw new NotFoundException('Post not found');
    }

    const updated = await this.prisma.feedPost.update({
      where: { id: postId },
      data: {
        ...(dto.textContent !== undefined && { textContent: dto.textContent }),
        ...(dto.visibility !== undefined && { visibility: dto.visibility }),
        editedAt: new Date(),
      },
      select: POST_SELECT,
    });

    return this.formatPost(updated, userId);
  }

  async deletePost(postId: string, userId: string) {
    const post = await this.prisma.feedPost.findUnique({
      where: { id: postId },
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }
    if (post.authorId !== userId) {
      throw new ForbiddenException('Cannot delete another user\'s post');
    }
    if (post.deletedAt) {
      throw new NotFoundException('Post not found');
    }

    await this.prisma.feedPost.update({
      where: { id: postId },
      data: {
        deletedAt: new Date(),
        status: 'removed_by_author',
      },
    });
  }

  async getPost(postId: string, userId: string) {
    const post = await this.prisma.feedPost.findUnique({
      where: { id: postId },
      select: POST_SELECT,
    });

    if (!post || post.status !== 'published') {
      throw new NotFoundException('Post not found');
    }

    return this.formatPost(post, userId);
  }

  async getPublicFeed(query: FeedQueryDto, userId: string) {
    return this.queryFeed(
      {
        visibility: 'public',
        status: 'published',
        deletedAt: null,
      },
      query,
      userId,
    );
  }

  async getOrganizationFeed(query: FeedQueryDto, organizationId: string, userId: string) {
    return this.queryFeed(
      {
        organizationId,
        status: 'published',
        deletedAt: null,
        visibility: { in: ['organization', 'public'] },
      },
      query,
      userId,
    );
  }

  async getUserProfileFeed(query: FeedQueryDto, profileUserId: string, requesterId: string) {
    const isSelf = profileUserId === requesterId;

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

  async getBookmarkedPosts(query: FeedQueryDto, userId: string) {
    const limit = query.limit ?? 20;

    const bookmarks = await this.prisma.feedPostBookmark.findMany({
      take: limit + 1,
      ...(query.cursor && { skip: 1, cursor: { id: query.cursor } }),
      where: { userId },
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
      results
        .filter((b) => b.post.status === 'published' && !b.post.updatedAt)
        .map((b) => this.formatPost(b.post, userId)),
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
