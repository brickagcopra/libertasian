import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { FeedInteractionsService } from './feed-interactions.service';
import { FeedBlocksService } from './feed-blocks.service';
import { PrismaService } from '../../prisma/prisma.service';

// ─── Mock Data ────────────────────────────────────────────────────────────────

const now = new Date('2026-03-30T10:00:00.000Z');
const USER_ID = 'user-1';
const OTHER_USER_ID = 'user-2';
const POST_ID = 'post-1';
const COMMENT_ID = 'comment-1';
const ORG_ID = 'org-1';
const OTHER_ORG_ID = 'org-2';

// `validatePostReadable` now runs a `findFirst` with a visibility
// OR-filter (BYPASS #2 fix). The unit tests only need a row with an
// `id` to pass the null check — the filter logic itself is exercised
// by the auth-security e2e suite against a real database.
const mockPublishedPost = {
  id: POST_ID,
};

const mockComment = {
  id: COMMENT_ID,
  postId: POST_ID,
  authorId: USER_ID,
  parentId: null,
  textContent: 'Great post!',
  likeCount: 0,
  status: 'published',
  editedAt: null,
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
  author: { id: USER_ID, fullName: 'Atty. Juan Dela Cruz' },
};

// ─── Mock Prisma ──────────────────────────────────────────────────────────────

const mockPrisma: {
  feedPost: { findUnique: jest.Mock; findFirst: jest.Mock; update: jest.Mock };
  feedPostLike: { create: jest.Mock; findUnique: jest.Mock; delete: jest.Mock };
  feedPostBookmark: { create: jest.Mock; findUnique: jest.Mock; delete: jest.Mock };
  feedComment: { create: jest.Mock; findUnique: jest.Mock; findMany: jest.Mock; update: jest.Mock };
  feedCommentLike: { create: jest.Mock; findUnique: jest.Mock; delete: jest.Mock };
  feedPostReport: { create: jest.Mock; findUnique: jest.Mock; findMany: jest.Mock; update: jest.Mock };
  feedUserBlock: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    count: jest.Mock;
    create: jest.Mock;
    deleteMany: jest.Mock;
  };
  user: { findFirst: jest.Mock };
  forTenant: jest.Mock;
} = {
  feedPost: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  feedPostLike: {
    create: jest.fn(),
    findUnique: jest.fn(),
    delete: jest.fn(),
  },
  feedPostBookmark: {
    create: jest.fn(),
    findUnique: jest.fn(),
    delete: jest.fn(),
  },
  feedComment: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
  feedCommentLike: {
    create: jest.fn(),
    findUnique: jest.fn(),
    delete: jest.fn(),
  },
  feedPostReport: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
  feedUserBlock: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    deleteMany: jest.fn(),
  },
  user: {
    findFirst: jest.fn(),
  },
  forTenant: jest.fn(),
};

// `forTenant(orgId).feedComment.findUnique(...)` chains back to the same
// mock so test setups can keep using `mockPrisma.feedComment.*` directly.
// Cross-tenant behavior is simulated per-test by having the mocked
// findUnique/findMany return null/[] when the caller's org wouldn't see
// the row.
mockPrisma.forTenant.mockReturnValue(mockPrisma);

describe('FeedInteractionsService', () => {
  let service: FeedInteractionsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeedInteractionsService,
        { provide: PrismaService, useValue: mockPrisma },
        FeedBlocksService,
      ],
    }).compile();

    service = module.get<FeedInteractionsService>(FeedInteractionsService);
    jest.clearAllMocks();

    // Default: the viewer has blocked nobody, so hiddenAuthorFilter() is {}
    // and every WHERE below stays byte-identical to the pre-blocking shape.
    mockPrisma.feedUserBlock.findMany.mockResolvedValue([]);

    // Default: post exists and is readable by the caller.
    // `validatePostReadable` uses `findFirst` (BYPASS #2 fix); the
    // legacy `findUnique` mock is kept for the comment branches that
    // still use it (parent lookup, update/delete, moderation).
    mockPrisma.feedPost.findFirst.mockResolvedValue(mockPublishedPost);
    mockPrisma.feedPost.findUnique.mockResolvedValue(mockPublishedPost);
    mockPrisma.feedPost.update.mockResolvedValue({});
  });

  // ─── Like Post ────────────────────────────────────────────────────────────

  describe('likePost', () => {
    it('should create a like and increment count', async () => {
      mockPrisma.feedPostLike.create.mockResolvedValue({ id: 'like-1' });

      await service.likePost(POST_ID, USER_ID, ORG_ID);

      expect(mockPrisma.feedPostLike.create).toHaveBeenCalledWith({
        data: { postId: POST_ID, userId: USER_ID },
      });
      expect(mockPrisma.feedPost.update).toHaveBeenCalledWith({
        where: { id: POST_ID },
        data: { likeCount: { increment: 1 } },
      });
    });

    it('should be idempotent (no-op on duplicate)', async () => {
      mockPrisma.feedPostLike.create.mockRejectedValue({ code: 'P2002' });

      await service.likePost(POST_ID, USER_ID, ORG_ID);

      // Should not increment count
      expect(mockPrisma.feedPost.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: { likeCount: { increment: 1 } },
        }),
      );
    });

    it('should throw on non-existent post', async () => {
      // validatePostReadable uses findFirst (BYPASS #2 fix)
      mockPrisma.feedPost.findFirst.mockResolvedValue(null);

      await expect(
        service.likePost('non-existent', USER_ID, ORG_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── Unlike Post ──────────────────────────────────────────────────────────

  describe('unlikePost', () => {
    it('should remove like and decrement count', async () => {
      mockPrisma.feedPostLike.findUnique.mockResolvedValue({ id: 'like-1' });

      await service.unlikePost(POST_ID, USER_ID);

      expect(mockPrisma.feedPostLike.delete).toHaveBeenCalledWith({
        where: { id: 'like-1' },
      });
      expect(mockPrisma.feedPost.update).toHaveBeenCalledWith({
        where: { id: POST_ID },
        data: { likeCount: { decrement: 1 } },
      });
    });

    it('should be idempotent when not liked', async () => {
      mockPrisma.feedPostLike.findUnique.mockResolvedValue(null);

      await service.unlikePost(POST_ID, USER_ID);

      expect(mockPrisma.feedPostLike.delete).not.toHaveBeenCalled();
    });
  });

  // ─── Bookmark ─────────────────────────────────────────────────────────────

  describe('bookmarkPost', () => {
    it('should create a bookmark', async () => {
      mockPrisma.feedPostBookmark.create.mockResolvedValue({ id: 'bm-1' });

      await service.bookmarkPost(POST_ID, USER_ID, ORG_ID);

      expect(mockPrisma.feedPostBookmark.create).toHaveBeenCalledWith({
        data: { postId: POST_ID, userId: USER_ID },
      });
    });
  });

  describe('unbookmarkPost', () => {
    it('should remove bookmark', async () => {
      mockPrisma.feedPostBookmark.findUnique.mockResolvedValue({ id: 'bm-1' });

      await service.unbookmarkPost(POST_ID, USER_ID);

      expect(mockPrisma.feedPostBookmark.delete).toHaveBeenCalledWith({
        where: { id: 'bm-1' },
      });
    });
  });

  // ─── Comments ─────────────────────────────────────────────────────────────

  describe('createComment', () => {
    it('should create a top-level comment', async () => {
      mockPrisma.feedComment.create.mockResolvedValue(mockComment);

      const result = await service.createComment(
        POST_ID,
        { textContent: 'Great post!' },
        USER_ID,
        ORG_ID,
      );

      expect(result.id).toBe(COMMENT_ID);
      expect(result.textContent).toBe('Great post!');
      expect(mockPrisma.feedPost.update).toHaveBeenCalledWith({
        where: { id: POST_ID },
        data: { commentCount: { increment: 1 } },
      });
    });

    it('should create a reply to a top-level comment', async () => {
      const parentComment = { ...mockComment, id: 'parent-1', parentId: null };
      mockPrisma.feedComment.findUnique.mockResolvedValue(parentComment);
      mockPrisma.feedComment.create.mockResolvedValue({
        ...mockComment,
        id: 'reply-1',
        parentId: 'parent-1',
      });

      await service.createComment(
        POST_ID,
        { textContent: 'Good reply', parentId: 'parent-1' },
        USER_ID,
        ORG_ID,
      );

      expect(mockPrisma.feedComment.create).toHaveBeenCalled();
    });

    it('should reject reply to a reply (max 1 level)', async () => {
      const replyComment = { ...mockComment, id: 'reply-1', parentId: 'parent-1' };
      mockPrisma.feedComment.findUnique.mockResolvedValue(replyComment);

      await expect(
        service.createComment(
          POST_ID,
          { textContent: 'Nested reply', parentId: 'reply-1' },
          USER_ID,
          ORG_ID,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject reply to comment from different post', async () => {
      const otherPostComment = { ...mockComment, id: 'other-1', postId: 'other-post' };
      mockPrisma.feedComment.findUnique.mockResolvedValue(otherPostComment);

      await expect(
        service.createComment(
          POST_ID,
          { textContent: 'Wrong post', parentId: 'other-1' },
          USER_ID,
          ORG_ID,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateComment', () => {
    it('should update own comment', async () => {
      mockPrisma.feedComment.findUnique.mockResolvedValue(mockComment);
      mockPrisma.feedComment.update.mockResolvedValue({
        ...mockComment,
        textContent: 'Updated',
        editedAt: new Date(),
      });

      const result = await service.updateComment(
        COMMENT_ID,
        { textContent: 'Updated' },
        USER_ID,
        ORG_ID,
      );

      expect(result.textContent).toBe('Updated');
    });

    it('should reject update on other user\'s comment', async () => {
      mockPrisma.feedComment.findUnique.mockResolvedValue(mockComment);

      await expect(
        service.updateComment(COMMENT_ID, { textContent: 'Hack' }, OTHER_USER_ID, ORG_ID),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('deleteComment', () => {
    it('should soft-delete own comment and decrement count', async () => {
      mockPrisma.feedComment.findUnique.mockResolvedValue(mockComment);

      await service.deleteComment(COMMENT_ID, USER_ID, ORG_ID);

      expect(mockPrisma.feedComment.update).toHaveBeenCalledWith({
        where: { id: COMMENT_ID },
        data: {
          deletedAt: expect.any(Date),
          status: 'removed_by_author',
        },
      });
      expect(mockPrisma.feedPost.update).toHaveBeenCalledWith({
        where: { id: POST_ID },
        data: { commentCount: { decrement: 1 } },
      });
    });

    it('should reject delete on other user\'s comment', async () => {
      mockPrisma.feedComment.findUnique.mockResolvedValue(mockComment);

      await expect(
        service.deleteComment(COMMENT_ID, OTHER_USER_ID, ORG_ID),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── Reports ──────────────────────────────────────────────────────────────

  describe('reportPost', () => {
    it('should create a report', async () => {
      mockPrisma.feedPostReport.create.mockResolvedValue({
        id: 'report-1',
        postId: POST_ID,
        reporterUserId: USER_ID,
        reason: 'spam',
      });

      const result = await service.reportPost(
        POST_ID,
        { reason: 'spam' },
        USER_ID,
        ORG_ID,
      );

      expect(result.id).toBe('report-1');
    });

    it('should reject duplicate reports', async () => {
      mockPrisma.feedPostReport.create.mockRejectedValue({ code: 'P2002' });

      await expect(
        service.reportPost(POST_ID, { reason: 'spam' }, USER_ID, ORG_ID),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── Comment Likes ────────────────────────────────────────────────────────

  describe('likeComment / unlikeComment', () => {
    it('should like a comment', async () => {
      mockPrisma.feedComment.findUnique.mockResolvedValue(mockComment);
      mockPrisma.feedCommentLike.create.mockResolvedValue({ id: 'cl-1' });
      mockPrisma.feedComment.update.mockResolvedValue({});

      await service.likeComment(COMMENT_ID, USER_ID, ORG_ID);

      expect(mockPrisma.feedCommentLike.create).toHaveBeenCalledWith({
        data: { commentId: COMMENT_ID, userId: USER_ID },
      });
    });

    it('should unlike a comment', async () => {
      mockPrisma.feedCommentLike.findUnique.mockResolvedValue({ id: 'cl-1' });
      mockPrisma.feedCommentLike.delete.mockResolvedValue({});
      mockPrisma.feedComment.update.mockResolvedValue({});

      await service.unlikeComment(COMMENT_ID, USER_ID, ORG_ID);

      expect(mockPrisma.feedCommentLike.delete).toHaveBeenCalledWith({
        where: { id: 'cl-1' },
      });
    });
  });

  // ─── Cross-Tenant Isolation (DF-2) ────────────────────────────────────────
  //
  // FeedComment carries organization_id and reads/writes flow through
  // `forTenant(viewerOrgId)`. When org B's user references an org A
  // comment by id, the tenant-scoped `feedComment.findUnique` returns
  // null and the service surfaces NotFoundException — never
  // ForbiddenException (which would leak existence cross-tenant).

  describe('cross-tenant isolation', () => {
    it('updateComment from a different org throws NotFoundException', async () => {
      // org A owns the comment; org B caller does not see it.
      mockPrisma.feedComment.findUnique.mockResolvedValue(null);

      await expect(
        service.updateComment(
          COMMENT_ID,
          { textContent: 'cross-tenant edit' },
          OTHER_USER_ID,
          OTHER_ORG_ID,
        ),
      ).rejects.toThrow(NotFoundException);

      expect(mockPrisma.forTenant).toHaveBeenCalledWith(OTHER_ORG_ID);
    });

    it('deleteComment from a different org throws NotFoundException', async () => {
      mockPrisma.feedComment.findUnique.mockResolvedValue(null);

      await expect(
        service.deleteComment(COMMENT_ID, OTHER_USER_ID, OTHER_ORG_ID),
      ).rejects.toThrow(NotFoundException);

      expect(mockPrisma.forTenant).toHaveBeenCalledWith(OTHER_ORG_ID);
    });

    it('likeComment from a different org throws NotFoundException', async () => {
      mockPrisma.feedComment.findUnique.mockResolvedValue(null);

      await expect(
        service.likeComment(COMMENT_ID, OTHER_USER_ID, OTHER_ORG_ID),
      ).rejects.toThrow(NotFoundException);

      expect(mockPrisma.forTenant).toHaveBeenCalledWith(OTHER_ORG_ID);
      // No like should be persisted on the cross-tenant attempt.
      expect(mockPrisma.feedCommentLike.create).not.toHaveBeenCalled();
    });

    it('getComments from a different org returns no items', async () => {
      // Post id belongs to org A; org B caller sees no comments
      // (the tenant-scoped findMany filters them out).
      mockPrisma.feedComment.findMany.mockResolvedValue([]);

      const result = await service.getComments(
        POST_ID,
        {},
        OTHER_USER_ID,
        OTHER_ORG_ID,
      );

      expect(result.items).toEqual([]);
      expect(result.hasNext).toBe(false);
      expect(result.nextCursor).toBeNull();
      expect(mockPrisma.forTenant).toHaveBeenCalledWith(OTHER_ORG_ID);
    });
  });

  // ─── Blocking ─────────────────────────────────────────────────────────────

  describe('blocked authors', () => {
    const BLOCKED_ID = 'user-blocked';

    function withBlock() {
      mockPrisma.feedUserBlock.findMany.mockResolvedValue([
        { blockerUserId: USER_ID, blockedUserId: BLOCKED_ID },
      ]);
    }

    it('filters blocked authors from comments, inline replies AND the reply count', async () => {
      withBlock();
      mockPrisma.feedComment.findMany.mockResolvedValue([]);

      await service.getComments(POST_ID, {}, USER_ID, ORG_ID);

      const call = mockPrisma.feedComment.findMany.mock.calls[0]![0];
      const notIn = { notIn: [BLOCKED_ID] };

      // (a) top-level comments
      expect(call.where).toEqual(expect.objectContaining({ authorId: notIn }));
      // (b) inlined replies
      expect(call.include.replies.where).toEqual(
        expect.objectContaining({ authorId: notIn }),
      );
      // (c) the aggregate count — omitting this leaks that a blocked user
      // replied, because the visible replies would not match the number.
      expect(call.include._count.select.replies.where).toEqual(
        expect.objectContaining({ authorId: notIn }),
      );
    });

    it('leaves the comment query untouched when the viewer has no blocks', async () => {
      mockPrisma.feedComment.findMany.mockResolvedValue([]);

      await service.getComments(POST_ID, {}, USER_ID, ORG_ID);

      const call = mockPrisma.feedComment.findMany.mock.calls[0]![0];
      expect(call.where).not.toHaveProperty('authorId');
      expect(call.include.replies.where).not.toHaveProperty('authorId');
      expect(call.include._count.select.replies.where).not.toHaveProperty(
        'authorId',
      );
    });

    it('blocks the write path: like, bookmark, comment and report all 404', async () => {
      withBlock();
      // The block predicate makes validatePostReadable's findFirst miss.
      mockPrisma.feedPost.findFirst.mockResolvedValue(null);

      await expect(
        service.likePost(POST_ID, USER_ID, ORG_ID),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.bookmarkPost(POST_ID, USER_ID, ORG_ID),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.createComment(POST_ID, { textContent: 'hi' }, USER_ID, ORG_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('still allows REPORTING a blocked user, so blocking is not a moderation shield', async () => {
      withBlock();
      // The post is readable on its own merits; only the block would hide it.
      mockPrisma.feedPost.findFirst.mockResolvedValue(mockPublishedPost);
      mockPrisma.feedPostReport.create.mockResolvedValue({ id: 'report-1' });

      await expect(
        service.reportPost(POST_ID, { reason: 'spam' }, USER_ID, ORG_ID),
      ).resolves.toEqual(expect.objectContaining({ id: 'report-1' }));

      // The gate ran WITHOUT the block predicate.
      const call = mockPrisma.feedPost.findFirst.mock.calls[0]![0];
      expect(call.where).not.toHaveProperty('authorId');
    });

    it('404s comments on a post the viewer cannot read', async () => {
      withBlock();
      mockPrisma.feedPost.findFirst.mockResolvedValue(null);

      await expect(
        service.getComments(POST_ID, {}, USER_ID, ORG_ID),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.feedComment.findMany).not.toHaveBeenCalled();
    });

    it('blocks liking a blocked author\'s comment', async () => {
      withBlock();
      mockPrisma.feedComment.findUnique.mockResolvedValue({
        id: COMMENT_ID,
        authorId: BLOCKED_ID,
        deletedAt: null,
      });

      await expect(
        service.likeComment(COMMENT_ID, USER_ID, ORG_ID),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.feedCommentLike.create).not.toHaveBeenCalled();
    });

    it('applies the block predicate inside the write gate', async () => {
      withBlock();
      mockPrisma.feedPost.findFirst.mockResolvedValue(null);

      await expect(
        service.likePost(POST_ID, USER_ID, ORG_ID),
      ).rejects.toThrow(NotFoundException);

      expect(mockPrisma.feedPost.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            authorId: { notIn: [BLOCKED_ID] },
          }),
        }),
      );
    });
  });
});
