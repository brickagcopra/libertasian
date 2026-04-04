import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { FeedInteractionsService } from './feed-interactions.service';
import { PrismaService } from '../../prisma/prisma.service';

// ─── Mock Data ────────────────────────────────────────────────────────────────

const now = new Date('2026-03-30T10:00:00.000Z');
const USER_ID = 'user-1';
const OTHER_USER_ID = 'user-2';
const POST_ID = 'post-1';
const COMMENT_ID = 'comment-1';

const mockPublishedPost = {
  id: POST_ID,
  status: 'published',
  deletedAt: null,
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

const mockPrisma = {
  feedPost: {
    findUnique: jest.fn(),
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
};

describe('FeedInteractionsService', () => {
  let service: FeedInteractionsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeedInteractionsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<FeedInteractionsService>(FeedInteractionsService);
    jest.clearAllMocks();

    // Default: post exists
    mockPrisma.feedPost.findUnique.mockResolvedValue(mockPublishedPost);
    mockPrisma.feedPost.update.mockResolvedValue({});
  });

  // ─── Like Post ────────────────────────────────────────────────────────────

  describe('likePost', () => {
    it('should create a like and increment count', async () => {
      mockPrisma.feedPostLike.create.mockResolvedValue({ id: 'like-1' });

      await service.likePost(POST_ID, USER_ID);

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

      await service.likePost(POST_ID, USER_ID);

      // Should not increment count
      expect(mockPrisma.feedPost.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: { likeCount: { increment: 1 } },
        }),
      );
    });

    it('should throw on non-existent post', async () => {
      mockPrisma.feedPost.findUnique.mockResolvedValue(null);

      await expect(
        service.likePost('non-existent', USER_ID),
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

      await service.bookmarkPost(POST_ID, USER_ID);

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
      );

      expect(result.textContent).toBe('Updated');
    });

    it('should reject update on other user\'s comment', async () => {
      mockPrisma.feedComment.findUnique.mockResolvedValue(mockComment);

      await expect(
        service.updateComment(COMMENT_ID, { textContent: 'Hack' }, OTHER_USER_ID),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('deleteComment', () => {
    it('should soft-delete own comment and decrement count', async () => {
      mockPrisma.feedComment.findUnique.mockResolvedValue(mockComment);

      await service.deleteComment(COMMENT_ID, USER_ID);

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
        service.deleteComment(COMMENT_ID, OTHER_USER_ID),
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
      );

      expect(result.id).toBe('report-1');
    });

    it('should reject duplicate reports', async () => {
      mockPrisma.feedPostReport.create.mockRejectedValue({ code: 'P2002' });

      await expect(
        service.reportPost(POST_ID, { reason: 'spam' }, USER_ID),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── Comment Likes ────────────────────────────────────────────────────────

  describe('likeComment / unlikeComment', () => {
    it('should like a comment', async () => {
      mockPrisma.feedComment.findUnique.mockResolvedValue(mockComment);
      mockPrisma.feedCommentLike.create.mockResolvedValue({ id: 'cl-1' });
      mockPrisma.feedComment.update.mockResolvedValue({});

      await service.likeComment(COMMENT_ID, USER_ID);

      expect(mockPrisma.feedCommentLike.create).toHaveBeenCalledWith({
        data: { commentId: COMMENT_ID, userId: USER_ID },
      });
    });

    it('should unlike a comment', async () => {
      mockPrisma.feedCommentLike.findUnique.mockResolvedValue({ id: 'cl-1' });
      mockPrisma.feedCommentLike.delete.mockResolvedValue({});
      mockPrisma.feedComment.update.mockResolvedValue({});

      await service.unlikeComment(COMMENT_ID, USER_ID);

      expect(mockPrisma.feedCommentLike.delete).toHaveBeenCalledWith({
        where: { id: 'cl-1' },
      });
    });
  });
});
