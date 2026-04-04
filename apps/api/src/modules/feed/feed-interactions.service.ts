import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { CreateCommentDto, UpdateCommentDto, ReportPostDto, FeedQueryDto } from './dto';

@Injectable()
export class FeedInteractionsService {
  private readonly logger = new Logger(FeedInteractionsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // =========================================================================
  // Likes (Posts)
  // =========================================================================

  async likePost(postId: string, userId: string) {
    await this.validatePostExists(postId);

    // Upsert-like: ignore if already exists (unique constraint)
    try {
      await this.prisma.feedPostLike.create({
        data: { postId, userId },
      });
      await this.prisma.feedPost.update({
        where: { id: postId },
        data: { likeCount: { increment: 1 } },
      });
    } catch (err: unknown) {
      // P2002 = unique constraint violation — already liked, no-op
      if (this.isPrismaUniqueError(err)) return;
      throw err;
    }
  }

  async unlikePost(postId: string, userId: string) {
    const like = await this.prisma.feedPostLike.findUnique({
      where: { postId_userId: { postId, userId } },
    });

    if (!like) return; // Already unliked — idempotent

    await this.prisma.feedPostLike.delete({
      where: { id: like.id },
    });
    await this.prisma.feedPost.update({
      where: { id: postId },
      data: { likeCount: { decrement: 1 } },
    });
  }

  // =========================================================================
  // Bookmarks
  // =========================================================================

  async bookmarkPost(postId: string, userId: string) {
    await this.validatePostExists(postId);

    try {
      await this.prisma.feedPostBookmark.create({
        data: { postId, userId },
      });
      await this.prisma.feedPost.update({
        where: { id: postId },
        data: { bookmarkCount: { increment: 1 } },
      });
    } catch (err: unknown) {
      if (this.isPrismaUniqueError(err)) return;
      throw err;
    }
  }

  async unbookmarkPost(postId: string, userId: string) {
    const bookmark = await this.prisma.feedPostBookmark.findUnique({
      where: { postId_userId: { postId, userId } },
    });

    if (!bookmark) return;

    await this.prisma.feedPostBookmark.delete({
      where: { id: bookmark.id },
    });
    await this.prisma.feedPost.update({
      where: { id: postId },
      data: { bookmarkCount: { decrement: 1 } },
    });
  }

  // =========================================================================
  // Comments
  // =========================================================================

  async createComment(postId: string, dto: CreateCommentDto, userId: string) {
    await this.validatePostExists(postId);

    // Validate parent if provided (must belong to same post, max 1 level deep)
    if (dto.parentId) {
      const parent = await this.prisma.feedComment.findUnique({
        where: { id: dto.parentId },
      });
      if (!parent) {
        throw new NotFoundException('Parent comment not found');
      }
      if (parent.postId !== postId) {
        throw new BadRequestException('Parent comment does not belong to this post');
      }
      if (parent.parentId) {
        throw new BadRequestException('Cannot reply to a reply (max 1 level of threading)');
      }
    }

    const comment = await this.prisma.feedComment.create({
      data: {
        postId,
        authorId: userId,
        textContent: dto.textContent,
        parentId: dto.parentId,
      },
      include: {
        author: { select: { id: true, fullName: true } },
      },
    });

    await this.prisma.feedPost.update({
      where: { id: postId },
      data: { commentCount: { increment: 1 } },
    });

    return this.formatComment(comment);
  }

  async updateComment(commentId: string, dto: { textContent: string }, userId: string) {
    const comment = await this.prisma.feedComment.findUnique({
      where: { id: commentId },
    });

    if (!comment) {
      throw new NotFoundException('Comment not found');
    }
    if (comment.authorId !== userId) {
      throw new ForbiddenException('Cannot edit another user\'s comment');
    }
    if (comment.deletedAt) {
      throw new NotFoundException('Comment not found');
    }

    const updated = await this.prisma.feedComment.update({
      where: { id: commentId },
      data: {
        textContent: dto.textContent,
        editedAt: new Date(),
      },
      include: {
        author: { select: { id: true, fullName: true } },
      },
    });

    return this.formatComment(updated);
  }

  async deleteComment(commentId: string, userId: string) {
    const comment = await this.prisma.feedComment.findUnique({
      where: { id: commentId },
    });

    if (!comment) {
      throw new NotFoundException('Comment not found');
    }
    if (comment.authorId !== userId) {
      throw new ForbiddenException('Cannot delete another user\'s comment');
    }
    if (comment.deletedAt) {
      throw new NotFoundException('Comment not found');
    }

    await this.prisma.feedComment.update({
      where: { id: commentId },
      data: {
        deletedAt: new Date(),
        status: 'removed_by_author',
      },
    });

    await this.prisma.feedPost.update({
      where: { id: comment.postId },
      data: { commentCount: { decrement: 1 } },
    });
  }

  async getComments(postId: string, query: FeedQueryDto, userId: string) {
    const limit = query.limit ?? 20;

    // Get top-level comments
    const comments = await this.prisma.feedComment.findMany({
      take: limit + 1,
      ...(query.cursor && { skip: 1, cursor: { id: query.cursor } }),
      where: {
        postId,
        parentId: null,
        deletedAt: null,
        status: 'published',
      },
      orderBy: { createdAt: 'desc' },
      include: {
        author: { select: { id: true, fullName: true } },
        replies: {
          where: { deletedAt: null, status: 'published' },
          orderBy: { createdAt: 'asc' },
          take: 3, // Show first 3 replies inline
          include: {
            author: { select: { id: true, fullName: true } },
          },
        },
        _count: {
          select: {
            replies: {
              where: { deletedAt: null, status: 'published' },
            },
          },
        },
      },
    });

    const hasNext = comments.length > limit;
    const results = hasNext ? comments.slice(0, limit) : comments;

    const items = await Promise.all(
      results.map(async (comment) => {
        const isLikedByMe = await this.isCommentLikedByUser(comment.id, userId);
        return {
          ...this.formatComment(comment),
          isLikedByMe,
          replies: await Promise.all(
            comment.replies.map(async (reply) => ({
              ...this.formatComment(reply),
              isLikedByMe: await this.isCommentLikedByUser(reply.id, userId),
            })),
          ),
          totalReplyCount: comment._count.replies,
        };
      }),
    );

    return {
      items,
      hasNext,
      nextCursor: results.length > 0 ? results[results.length - 1]!.id : null,
    };
  }

  // =========================================================================
  // Likes (Comments)
  // =========================================================================

  async likeComment(commentId: string, userId: string) {
    const comment = await this.prisma.feedComment.findUnique({
      where: { id: commentId },
    });
    if (!comment || comment.deletedAt) {
      throw new NotFoundException('Comment not found');
    }

    try {
      await this.prisma.feedCommentLike.create({
        data: { commentId, userId },
      });
      await this.prisma.feedComment.update({
        where: { id: commentId },
        data: { likeCount: { increment: 1 } },
      });
    } catch (err: unknown) {
      if (this.isPrismaUniqueError(err)) return;
      throw err;
    }
  }

  async unlikeComment(commentId: string, userId: string) {
    const like = await this.prisma.feedCommentLike.findUnique({
      where: { commentId_userId: { commentId, userId } },
    });

    if (!like) return;

    await this.prisma.feedCommentLike.delete({
      where: { id: like.id },
    });
    await this.prisma.feedComment.update({
      where: { id: commentId },
      data: { likeCount: { decrement: 1 } },
    });
  }

  // =========================================================================
  // Reports
  // =========================================================================

  async reportPost(postId: string, dto: ReportPostDto, userId: string) {
    await this.validatePostExists(postId);

    try {
      const report = await this.prisma.feedPostReport.create({
        data: {
          postId,
          reporterUserId: userId,
          reason: dto.reason,
          details: dto.details,
        },
      });

      await this.prisma.feedPost.update({
        where: { id: postId },
        data: { reportCount: { increment: 1 } },
      });

      return report;
    } catch (err: unknown) {
      if (this.isPrismaUniqueError(err)) {
        throw new BadRequestException('You have already reported this post');
      }
      throw err;
    }
  }

  // =========================================================================
  // Admin Moderation
  // =========================================================================

  async listReports(query: FeedQueryDto & { status?: string }) {
    const limit = query.limit ?? 20;

    const reports = await this.prisma.feedPostReport.findMany({
      take: limit + 1,
      ...(query.cursor && { skip: 1, cursor: { id: query.cursor } }),
      where: {
        status: query.status ?? 'open',
      },
      orderBy: { createdAt: 'desc' },
      include: {
        reporter: { select: { id: true, fullName: true } },
        post: {
          select: {
            id: true,
            textContent: true,
            status: true,
            author: { select: { id: true, fullName: true } },
          },
        },
      },
    });

    const hasNext = reports.length > limit;
    const results = hasNext ? reports.slice(0, limit) : reports;

    return {
      items: results.map((r) => ({
        id: r.id,
        postId: r.postId,
        reason: r.reason,
        details: r.details,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        reporter: r.reporter,
        post: r.post,
      })),
      hasNext,
      nextCursor: results.length > 0 ? results[results.length - 1]!.id : null,
    };
  }

  async resolveReport(reportId: string, resolverUserId: string, dto: { status: string; resolutionNote?: string }) {
    const report = await this.prisma.feedPostReport.findUnique({
      where: { id: reportId },
    });

    if (!report) {
      throw new NotFoundException('Report not found');
    }
    if (report.status !== 'open') {
      throw new BadRequestException('Report is already resolved');
    }

    return this.prisma.feedPostReport.update({
      where: { id: reportId },
      data: {
        status: dto.status,
        resolvedByUserId: resolverUserId,
        resolutionNote: dto.resolutionNote,
        resolvedAt: new Date(),
      },
    });
  }

  async moderatePost(postId: string, status: string) {
    const post = await this.prisma.feedPost.findUnique({
      where: { id: postId },
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    return this.prisma.feedPost.update({
      where: { id: postId },
      data: { status },
    });
  }

  async moderateComment(commentId: string, status: string) {
    const comment = await this.prisma.feedComment.findUnique({
      where: { id: commentId },
    });

    if (!comment) {
      throw new NotFoundException('Comment not found');
    }

    return this.prisma.feedComment.update({
      where: { id: commentId },
      data: { status },
    });
  }

  // ─── Private Helpers ────────────────────────────────────────────────────

  private async validatePostExists(postId: string) {
    const post = await this.prisma.feedPost.findUnique({
      where: { id: postId },
      select: { id: true, status: true, deletedAt: true },
    });
    if (!post || post.status !== 'published' || post.deletedAt) {
      throw new NotFoundException('Post not found');
    }
  }

  private async isCommentLikedByUser(commentId: string, userId: string): Promise<boolean> {
    const like = await this.prisma.feedCommentLike.findUnique({
      where: { commentId_userId: { commentId, userId } },
    });
    return !!like;
  }

  private formatComment(comment: {
    id: string;
    postId: string;
    textContent: string;
    likeCount: number;
    status: string;
    editedAt: Date | null;
    createdAt: Date;
    author: { id: string; fullName: string };
  }) {
    return {
      id: comment.id,
      postId: comment.postId,
      textContent: comment.textContent,
      likeCount: comment.likeCount,
      editedAt: comment.editedAt?.toISOString() ?? null,
      createdAt: comment.createdAt.toISOString(),
      author: comment.author,
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
