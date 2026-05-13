import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { FeedService } from './feed.service';
import { PrismaService } from '../../prisma/prisma.service';

// ─── Mock Data ────────────────────────────────────────────────────────────────

const now = new Date('2026-03-30T10:00:00.000Z');
const USER_ID = 'user-1';
const OTHER_USER_ID = 'user-2';
const ORG_ID = 'org-1';
const POST_ID = 'post-1';
const MEDIA_ID = 'media-1';

const mockAuthor = { id: USER_ID, fullName: 'Atty. Juan Dela Cruz' };

const mockPost = {
  id: POST_ID,
  organizationId: ORG_ID,
  authorId: USER_ID,
  textContent: 'Legal insight on recent Supreme Court ruling.',
  visibility: 'organization',
  status: 'published',
  mediaId: null,
  commentCount: 0,
  likeCount: 0,
  bookmarkCount: 0,
  isPinned: false,
  editedAt: null,
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
  author: mockAuthor,
  media: null,
};

const mockMedia = {
  id: MEDIA_ID,
  ownerUserId: USER_ID,
  organizationId: ORG_ID,
  processingStatus: 'ready',
  processedObjectKey: 'feed/org-1/media-1/feed.jpg',
  thumbnailObjectKey: 'feed/org-1/media-1/thumb.jpg',
  mimeType: 'image/jpeg',
  width: 1080,
  height: 720,
};

// ─── Mock Prisma ──────────────────────────────────────────────────────────────

const mockPrisma = {
  feedPost: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  feedPostMedia: {
    findUnique: jest.fn(),
  },
  feedPostLike: {
    findUnique: jest.fn(),
  },
  feedPostBookmark: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
  },
};

describe('FeedService', () => {
  let service: FeedService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeedService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<FeedService>(FeedService);

    // Reset all mocks
    jest.clearAllMocks();

    // Default: no like/bookmark for requesting user
    mockPrisma.feedPostLike.findUnique.mockResolvedValue(null);
    mockPrisma.feedPostBookmark.findUnique.mockResolvedValue(null);
  });

  // ─── Create Post ──────────────────────────────────────────────────────────

  describe('createPost', () => {
    it('should create a text-only post', async () => {
      mockPrisma.feedPost.create.mockResolvedValue(mockPost);

      const result = await service.createPost(
        { textContent: 'Legal insight on recent Supreme Court ruling.' },
        USER_ID,
        ORG_ID,
      );

      expect(result.id).toBe(POST_ID);
      expect(result.textContent).toBe('Legal insight on recent Supreme Court ruling.');
      expect(result.visibility).toBe('organization');
      expect(result.author.id).toBe(USER_ID);
      expect(result.isLikedByMe).toBe(false);
      expect(result.isBookmarkedByMe).toBe(false);
      expect(mockPrisma.feedPost.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organizationId: ORG_ID,
            authorId: USER_ID,
            textContent: 'Legal insight on recent Supreme Court ruling.',
            visibility: 'organization',
            mediaId: undefined,
          }),
        }),
      );
    });

    it('should create a post with public visibility', async () => {
      mockPrisma.feedPost.create.mockResolvedValue({ ...mockPost, visibility: 'public' });

      const result = await service.createPost(
        { textContent: 'Public post!', visibility: 'public' },
        USER_ID,
        ORG_ID,
      );

      expect(result.visibility).toBe('public');
    });

    it('should create a post with media', async () => {
      mockPrisma.feedPostMedia.findUnique.mockResolvedValue(mockMedia);
      mockPrisma.feedPost.findUnique.mockResolvedValue(null); // no existing post with this mediaId
      mockPrisma.feedPost.create.mockResolvedValue({
        ...mockPost,
        mediaId: MEDIA_ID,
        media: mockMedia,
      });

      const result = await service.createPost(
        { textContent: 'Post with image', mediaId: MEDIA_ID },
        USER_ID,
        ORG_ID,
      );

      expect(result.media).not.toBeNull();
      expect(result.media?.id).toBe(MEDIA_ID);
    });

    it('should reject post with non-existent media', async () => {
      mockPrisma.feedPostMedia.findUnique.mockResolvedValue(null);

      await expect(
        service.createPost(
          { textContent: 'Test', mediaId: 'non-existent-id' },
          USER_ID,
          ORG_ID,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should reject post with media owned by another user', async () => {
      mockPrisma.feedPostMedia.findUnique.mockResolvedValue({
        ...mockMedia,
        ownerUserId: OTHER_USER_ID,
      });

      await expect(
        service.createPost(
          { textContent: 'Test', mediaId: MEDIA_ID },
          USER_ID,
          ORG_ID,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject post with media not ready', async () => {
      mockPrisma.feedPostMedia.findUnique.mockResolvedValue({
        ...mockMedia,
        processingStatus: 'processing',
      });

      await expect(
        service.createPost(
          { textContent: 'Test', mediaId: MEDIA_ID },
          USER_ID,
          ORG_ID,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject post with media already attached', async () => {
      mockPrisma.feedPostMedia.findUnique.mockResolvedValue(mockMedia);
      mockPrisma.feedPost.findUnique.mockResolvedValue(mockPost); // already attached

      await expect(
        service.createPost(
          { textContent: 'Test', mediaId: MEDIA_ID },
          USER_ID,
          ORG_ID,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should allow image-only posts (no textContent)', async () => {
      mockPrisma.feedPostMedia.findUnique.mockResolvedValue(mockMedia);
      mockPrisma.feedPost.findUnique.mockResolvedValue(null);
      mockPrisma.feedPost.create.mockResolvedValue({
        ...mockPost,
        textContent: null,
        mediaId: MEDIA_ID,
        media: mockMedia,
      });

      const result = await service.createPost(
        { mediaId: MEDIA_ID },
        USER_ID,
        ORG_ID,
      );

      expect(result.id).toBe(POST_ID);
      expect(result.textContent).toBeNull();
      expect(result.media?.id).toBe(MEDIA_ID);
      expect(mockPrisma.feedPost.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            textContent: null,
            mediaId: MEDIA_ID,
          }),
        }),
      );
    });

    it('should reject when both textContent and mediaId are missing', async () => {
      await expect(
        service.createPost({}, USER_ID, ORG_ID),
      ).rejects.toThrow(
        new BadRequestException('Post must have text or an image'),
      );
      expect(mockPrisma.feedPost.create).not.toHaveBeenCalled();
    });

    it('should reject whitespace-only textContent without media', async () => {
      await expect(
        service.createPost({ textContent: '   ' }, USER_ID, ORG_ID),
      ).rejects.toThrow(
        new BadRequestException('Post must have text or an image'),
      );
      expect(mockPrisma.feedPost.create).not.toHaveBeenCalled();
    });
  });

  // ─── Update Post ──────────────────────────────────────────────────────────

  describe('updatePost', () => {
    it('should update own post', async () => {
      mockPrisma.feedPost.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.feedPost.findUniqueOrThrow.mockResolvedValue({
        ...mockPost,
        textContent: 'Updated content',
        editedAt: new Date(),
      });

      const result = await service.updatePost(POST_ID, { textContent: 'Updated content' }, USER_ID);

      expect(result.textContent).toBe('Updated content');
      expect(result.editedAt).not.toBeNull();
    });

    it('should reject update on another user\'s post (collapsed to NotFoundException)', async () => {
      // DF-1: updateMany with authorId mismatch returns count=0, collapsed to 404
      mockPrisma.feedPost.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.updatePost(POST_ID, { textContent: 'Hijack' }, OTHER_USER_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('should reject update on non-existent post', async () => {
      mockPrisma.feedPost.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.updatePost('non-existent', { textContent: 'Test' }, USER_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('should reject update on deleted post', async () => {
      // DF-1: updateMany where clause includes deletedAt: null, so deleted posts yield count=0
      mockPrisma.feedPost.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.updatePost(POST_ID, { textContent: 'Test' }, USER_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── Delete Post ──────────────────────────────────────────────────────────

  describe('deletePost', () => {
    it('should soft-delete own post', async () => {
      mockPrisma.feedPost.updateMany.mockResolvedValue({ count: 1 });

      await service.deletePost(POST_ID, USER_ID);

      expect(mockPrisma.feedPost.updateMany).toHaveBeenCalledWith({
        where: { id: POST_ID, authorId: USER_ID, deletedAt: null },
        data: {
          deletedAt: expect.any(Date),
          status: 'removed_by_author',
        },
      });
    });

    it('should reject delete on another user\'s post (collapsed to NotFoundException)', async () => {
      // DF-1: updateMany with authorId mismatch returns count=0, collapsed to 404
      mockPrisma.feedPost.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.deletePost(POST_ID, OTHER_USER_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── Get Post ─────────────────────────────────────────────────────────────

  describe('getPost', () => {
    // After the E14 fix, getPost() uses findFirst with a `where`
    // clause that enforces tenant visibility at the DB layer. Unit
    // tests mock findFirst; the DB filter semantics are covered by
    // auth-security.e2e-spec.ts cross-tenant cases.

    it('should return post with interaction flags', async () => {
      mockPrisma.feedPost.findFirst.mockResolvedValue(mockPost);

      const result = await service.getPost(POST_ID, USER_ID, ORG_ID);

      expect(result.id).toBe(POST_ID);
      expect(result.isLikedByMe).toBe(false);
      expect(result.isBookmarkedByMe).toBe(false);
    });

    it('should reflect liked + bookmarked state', async () => {
      mockPrisma.feedPost.findFirst.mockResolvedValue(mockPost);
      mockPrisma.feedPostLike.findUnique.mockResolvedValue({ id: 'like-1' });
      mockPrisma.feedPostBookmark.findUnique.mockResolvedValue({ id: 'bm-1' });

      const result = await service.getPost(POST_ID, USER_ID, ORG_ID);

      expect(result.isLikedByMe).toBe(true);
      expect(result.isBookmarkedByMe).toBe(true);
    });

    it('should throw NotFound when the post is filtered out by the DB', async () => {
      // The DB-level filter (non-published / soft-deleted / not
      // readable cross-tenant) collapses all four cases into a single
      // null result. The service throws NotFoundException with the
      // same message regardless of which branch was hit — this is
      // the anti-fingerprinting guarantee for E14.
      mockPrisma.feedPost.findFirst.mockResolvedValue(null);

      await expect(
        service.getPost(POST_ID, USER_ID, ORG_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('should pass viewer org id into the Prisma where clause', async () => {
      mockPrisma.feedPost.findFirst.mockResolvedValue(mockPost);

      await service.getPost(POST_ID, USER_ID, ORG_ID);

      expect(mockPrisma.feedPost.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: POST_ID,
            status: 'published',
            deletedAt: null,
            OR: [
              { visibility: 'public' },
              { visibility: 'organization', organizationId: ORG_ID },
            ],
          }),
        }),
      );
    });
  });

  // ─── Feed Queries ─────────────────────────────────────────────────────────

  describe('getPublicFeed', () => {
    it('should return cursor-paginated public posts', async () => {
      const posts = [
        { ...mockPost, id: 'p-1', visibility: 'public' },
        { ...mockPost, id: 'p-2', visibility: 'public' },
      ];
      mockPrisma.feedPost.findMany.mockResolvedValue(posts);

      const result = await service.getPublicFeed({}, USER_ID);

      expect(result.items).toHaveLength(2);
      expect(result.hasNext).toBe(false);
      expect(mockPrisma.feedPost.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            visibility: 'public',
            status: 'published',
            deletedAt: null,
          }),
          orderBy: { createdAt: 'desc' },
        }),
      );
    });

    it('should detect hasNext when results exceed limit', async () => {
      const posts = Array.from({ length: 3 }, (_, i) => ({
        ...mockPost,
        id: `p-${i}`,
        visibility: 'public',
      }));
      mockPrisma.feedPost.findMany.mockResolvedValue(posts);

      const result = await service.getPublicFeed({ limit: 2 }, USER_ID);

      expect(result.items).toHaveLength(2);
      expect(result.hasNext).toBe(true);
      expect(result.nextCursor).toBe('p-1');
    });
  });

  describe('getOrganizationFeed', () => {
    it('should scope to organization', async () => {
      mockPrisma.feedPost.findMany.mockResolvedValue([]);

      await service.getOrganizationFeed({}, ORG_ID, USER_ID);

      expect(mockPrisma.feedPost.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: ORG_ID,
            status: 'published',
            deletedAt: null,
          }),
        }),
      );
    });
  });
});
