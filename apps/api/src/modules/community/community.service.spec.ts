import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { CommunityService } from './community.service';
import { PrismaService } from '../../prisma/prisma.service';

// ─── Mock Data ────────────────────────────────────────────────────────────────

const now = new Date('2026-03-22T10:00:00.000Z');

const mockCreator = {
  id: 'user-1',
  fullName: 'Atty. Juan Dela Cruz',
  expertVerification: { expertiseType: 'lawyer', status: 'approved' },
};

const mockFlashcardSet = {
  id: 'fcs-1',
  title: 'Constitutional Law Flashcards',
  description: 'Comprehensive set for bar review',
  barSubject: 'constitutional_law',
  topic: 'Bill of Rights',
  avgRating: 4.5,
  ratingCount: 10,
  cardCount: 50,
  visibility: 'public_editorial',
  createdAt: now,
  updatedAt: now,
  user: mockCreator,
};

const mockReviewerPack = {
  id: 'rp-1',
  title: 'Criminal Law Reviewer',
  description: 'Complete reviewer pack',
  barSubject: 'criminal_law',
  topic: 'Felonies',
  avgRating: 4.2,
  ratingCount: 5,
  itemCount: 30,
  visibility: 'public_editorial',
  createdAt: now,
  updatedAt: now,
  creator: mockCreator,
};

const mockDigest = {
  id: 'digest-1',
  title: 'People v. Santos Digest',
  summary: 'A case about criminal liability.',
  digestType: 'case_digest',
  avgRating: 4.8,
  ratingCount: 15,
  voteScore: 12,
  visibility: 'public_editorial',
  createdAt: now,
  updatedAt: now,
  user: mockCreator,
};

const mockRating = {
  id: 'rating-1',
  userId: 'user-1',
  entityType: 'flashcard_set',
  entityId: 'fcs-1',
  score: 5,
  reviewTitle: 'Excellent',
  reviewBody: 'Very helpful for bar review.',
  createdAt: now,
  updatedAt: now,
  user: { id: 'user-1', fullName: 'Atty. Juan Dela Cruz' },
};

const mockVote = {
  id: 'vote-1',
  userId: 'user-1',
  entityType: 'digest',
  entityId: 'digest-1',
  voteType: 'up',
  createdAt: now,
  updatedAt: now,
};

const mockFlag = {
  id: 'flag-1',
  reporterUserId: 'user-1',
  entityType: 'flashcard_set',
  entityId: 'fcs-1',
  reason: 'inaccurate',
  details: 'Contains wrong citation.',
  status: 'open',
  resolvedByUserId: null,
  resolutionNote: null,
  resolvedAt: null,
  createdAt: now,
  reporter: { id: 'user-1', fullName: 'Atty. Juan Dela Cruz' },
  resolvedBy: null,
};

const mockExpertVerification = {
  id: 'ev-1',
  userId: 'user-1',
  expertiseType: 'lawyer',
  credentialDetails: 'Bar Roll No. 12345',
  status: 'pending',
  reviewNote: null,
  reviewedAt: null,
  createdAt: now,
  updatedAt: now,
  user: { id: 'user-1', fullName: 'Atty. Juan Dela Cruz', email: 'juan@example.com' },
};

// ─── Mock PrismaService ───────────────────────────────────────────────────────

const mockPrismaService = {
  flashcardSet: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  reviewerPack: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  digest: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
  },
  communityRating: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    upsert: jest.fn(),
    delete: jest.fn(),
    aggregate: jest.fn(),
    groupBy: jest.fn(),
  },
  communityVote: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
  communityFlag: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  expertVerification: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CommunityService', () => {
  let service: CommunityService;
  let prisma: typeof mockPrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommunityService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<CommunityService>(CommunityService);
    prisma = module.get(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ===========================================================================
  // Marketplace Browse — browseFlashcardSets
  // ===========================================================================

  describe('browseFlashcardSets', () => {
    it('should return paginated public flashcard sets with default sort', async () => {
      prisma.flashcardSet.findMany.mockResolvedValue([mockFlashcardSet]);

      const result = await service.browseFlashcardSets({});

      expect(prisma.flashcardSet.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 21,
          where: { visibility: 'public_editorial' },
          orderBy: { avgRating: 'desc' },
        }),
      );
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.contentType).toBe('flashcard_set');
      expect(result.items[0]!.title).toBe('Constitutional Law Flashcards');
      expect(result.items[0]!.itemCount).toBe(50);
      expect(result.hasNext).toBe(false);
    });

    it('should apply search filter', async () => {
      prisma.flashcardSet.findMany.mockResolvedValue([]);

      await service.browseFlashcardSets({ search: 'constitutional' });

      expect(prisma.flashcardSet.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            visibility: 'public_editorial',
            title: { contains: 'constitutional', mode: 'insensitive' },
          },
        }),
      );
    });

    it('should apply barSubject filter', async () => {
      prisma.flashcardSet.findMany.mockResolvedValue([]);

      await service.browseFlashcardSets({ barSubject: 'criminal_law' });

      expect(prisma.flashcardSet.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            visibility: 'public_editorial',
            barSubject: 'criminal_law',
          },
        }),
      );
    });

    it('should support cursor-based pagination', async () => {
      prisma.flashcardSet.findMany.mockResolvedValue([]);

      await service.browseFlashcardSets({ cursor: 'fcs-5' });

      expect(prisma.flashcardSet.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 1,
          cursor: { id: 'fcs-5' },
        }),
      );
    });

    it('should detect hasNext when more items exist', async () => {
      const items = Array.from({ length: 21 }, (_, i) => ({
        ...mockFlashcardSet,
        id: `fcs-${i + 1}`,
      }));
      prisma.flashcardSet.findMany.mockResolvedValue(items);

      const result = await service.browseFlashcardSets({});

      expect(result.items).toHaveLength(20);
      expect(result.hasNext).toBe(true);
      expect(result.nextCursor).toBe('fcs-20');
    });

    it('should sort by newest', async () => {
      prisma.flashcardSet.findMany.mockResolvedValue([]);

      await service.browseFlashcardSets({ sortBy: 'newest' });

      expect(prisma.flashcardSet.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { createdAt: 'desc' },
        }),
      );
    });

    it('should sort by most_reviewed', async () => {
      prisma.flashcardSet.findMany.mockResolvedValue([]);

      await service.browseFlashcardSets({ sortBy: 'most_reviewed' });

      expect(prisma.flashcardSet.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { ratingCount: 'desc' },
        }),
      );
    });

    it('should include creator with expert verification', async () => {
      prisma.flashcardSet.findMany.mockResolvedValue([mockFlashcardSet]);

      const result = await service.browseFlashcardSets({});

      expect(result.items[0]!.creator).toEqual({
        id: 'user-1',
        fullName: 'Atty. Juan Dela Cruz',
        expertVerification: { expertiseType: 'lawyer', status: 'approved' },
      });
    });

    it('should return ISO date strings', async () => {
      prisma.flashcardSet.findMany.mockResolvedValue([mockFlashcardSet]);

      const result = await service.browseFlashcardSets({});

      expect(result.items[0]!.createdAt).toBe('2026-03-22T10:00:00.000Z');
      expect(result.items[0]!.updatedAt).toBe('2026-03-22T10:00:00.000Z');
    });

    it('should return null nextCursor when no items', async () => {
      prisma.flashcardSet.findMany.mockResolvedValue([]);

      const result = await service.browseFlashcardSets({});

      expect(result.nextCursor).toBeNull();
    });

    it('should respect custom limit', async () => {
      prisma.flashcardSet.findMany.mockResolvedValue([]);

      await service.browseFlashcardSets({ limit: 5 });

      expect(prisma.flashcardSet.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 6 }),
      );
    });
  });

  // ===========================================================================
  // Marketplace Browse — browseReviewerPacks
  // ===========================================================================

  describe('browseReviewerPacks', () => {
    it('should return paginated public reviewer packs', async () => {
      prisma.reviewerPack.findMany.mockResolvedValue([mockReviewerPack]);

      const result = await service.browseReviewerPacks({});

      expect(prisma.reviewerPack.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 21,
          where: { visibility: 'public_editorial' },
          orderBy: { avgRating: 'desc' },
        }),
      );
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.contentType).toBe('reviewer_pack');
      expect(result.items[0]!.itemCount).toBe(30);
    });

    it('should apply search and barSubject filters', async () => {
      prisma.reviewerPack.findMany.mockResolvedValue([]);

      await service.browseReviewerPacks({
        search: 'criminal',
        barSubject: 'criminal_law',
      });

      expect(prisma.reviewerPack.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            visibility: 'public_editorial',
            barSubject: 'criminal_law',
            title: { contains: 'criminal', mode: 'insensitive' },
          },
        }),
      );
    });

    it('should support cursor-based pagination', async () => {
      prisma.reviewerPack.findMany.mockResolvedValue([]);

      await service.browseReviewerPacks({ cursor: 'rp-5' });

      expect(prisma.reviewerPack.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 1,
          cursor: { id: 'rp-5' },
        }),
      );
    });

    it('should detect hasNext correctly', async () => {
      const items = Array.from({ length: 21 }, (_, i) => ({
        ...mockReviewerPack,
        id: `rp-${i + 1}`,
      }));
      prisma.reviewerPack.findMany.mockResolvedValue(items);

      const result = await service.browseReviewerPacks({});

      expect(result.items).toHaveLength(20);
      expect(result.hasNext).toBe(true);
      expect(result.nextCursor).toBe('rp-20');
    });
  });

  // ===========================================================================
  // Marketplace Browse — browseDigests
  // ===========================================================================

  describe('browseDigests', () => {
    it('should return paginated public digests', async () => {
      prisma.digest.findMany.mockResolvedValue([mockDigest]);

      const result = await service.browseDigests({});

      expect(prisma.digest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 21,
          where: { visibility: 'public_editorial' },
          orderBy: { avgRating: 'desc' },
        }),
      );
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.contentType).toBe('digest');
      expect(result.items[0]!.voteScore).toBe(12);
    });

    it('should sort by newest', async () => {
      prisma.digest.findMany.mockResolvedValue([]);

      await service.browseDigests({ sortBy: 'newest' });

      expect(prisma.digest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { createdAt: 'desc' },
        }),
      );
    });

    it('should sort by trending (voteScore)', async () => {
      prisma.digest.findMany.mockResolvedValue([]);

      await service.browseDigests({ sortBy: 'trending' });

      expect(prisma.digest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { voteScore: 'desc' },
        }),
      );
    });

    it('should sort by most_reviewed (ratingCount)', async () => {
      prisma.digest.findMany.mockResolvedValue([]);

      await service.browseDigests({ sortBy: 'most_reviewed' });

      expect(prisma.digest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { ratingCount: 'desc' },
        }),
      );
    });

    it('should handle digest without user (system-generated)', async () => {
      const systemDigest = { ...mockDigest, user: null };
      prisma.digest.findMany.mockResolvedValue([systemDigest]);

      const result = await service.browseDigests({});

      expect(result.items[0]!.creator).toEqual({
        id: '',
        fullName: 'System',
        expertVerification: null,
      });
    });

    it('should map description from summary field', async () => {
      prisma.digest.findMany.mockResolvedValue([mockDigest]);

      const result = await service.browseDigests({});

      expect(result.items[0]!.description).toBe('A case about criminal liability.');
    });

    it('should apply search filter', async () => {
      prisma.digest.findMany.mockResolvedValue([]);

      await service.browseDigests({ search: 'Santos' });

      expect(prisma.digest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            visibility: 'public_editorial',
            title: { contains: 'Santos', mode: 'insensitive' },
          },
        }),
      );
    });

    it('should set barSubject to null and topic to digestType', async () => {
      prisma.digest.findMany.mockResolvedValue([mockDigest]);

      const result = await service.browseDigests({});

      expect(result.items[0]!.barSubject).toBeNull();
      expect(result.items[0]!.topic).toBe('case_digest');
    });
  });

  // ===========================================================================
  // Marketplace Browse — getFeatured
  // ===========================================================================

  describe('getFeatured', () => {
    it('should return featured items from all three categories', async () => {
      prisma.flashcardSet.findMany.mockResolvedValue([mockFlashcardSet]);
      prisma.reviewerPack.findMany.mockResolvedValue([mockReviewerPack]);
      prisma.digest.findMany.mockResolvedValue([mockDigest]);

      const result = await service.getFeatured();

      expect(result.flashcardSets).toHaveLength(1);
      expect(result.reviewerPacks).toHaveLength(1);
      expect(result.digests).toHaveLength(1);
    });

    it('should only include items with ratingCount > 0', async () => {
      prisma.flashcardSet.findMany.mockResolvedValue([]);
      prisma.reviewerPack.findMany.mockResolvedValue([]);
      prisma.digest.findMany.mockResolvedValue([]);

      await service.getFeatured();

      expect(prisma.flashcardSet.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { visibility: 'public_editorial', ratingCount: { gt: 0 } },
        }),
      );
      expect(prisma.reviewerPack.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { visibility: 'public_editorial', ratingCount: { gt: 0 } },
        }),
      );
      expect(prisma.digest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { visibility: 'public_editorial', ratingCount: { gt: 0 } },
        }),
      );
    });

    it('should limit to 6 items per category', async () => {
      prisma.flashcardSet.findMany.mockResolvedValue([]);
      prisma.reviewerPack.findMany.mockResolvedValue([]);
      prisma.digest.findMany.mockResolvedValue([]);

      await service.getFeatured();

      expect(prisma.flashcardSet.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 6 }),
      );
    });

    it('should order by avgRating desc', async () => {
      prisma.flashcardSet.findMany.mockResolvedValue([]);
      prisma.reviewerPack.findMany.mockResolvedValue([]);
      prisma.digest.findMany.mockResolvedValue([]);

      await service.getFeatured();

      expect(prisma.flashcardSet.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { avgRating: 'desc' } }),
      );
    });

    it('should handle system-generated digests in featured', async () => {
      prisma.flashcardSet.findMany.mockResolvedValue([]);
      prisma.reviewerPack.findMany.mockResolvedValue([]);
      prisma.digest.findMany.mockResolvedValue([{ ...mockDigest, user: null }]);

      const result = await service.getFeatured();

      expect(result.digests[0]!.creator.fullName).toBe('System');
    });
  });

  // ===========================================================================
  // Marketplace Browse — getContributorProfile
  // ===========================================================================

  describe('getContributorProfile', () => {
    it('should return contributor profile with stats', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        fullName: 'Atty. Juan Dela Cruz',
        createdAt: now,
        expertVerification: { expertiseType: 'lawyer', status: 'approved' },
      });
      prisma.flashcardSet.count.mockResolvedValue(5);
      prisma.reviewerPack.count.mockResolvedValue(3);
      prisma.digest.count.mockResolvedValue(10);
      prisma.flashcardSet.findMany.mockResolvedValue([{ id: 'fcs-1' }]);
      prisma.reviewerPack.findMany.mockResolvedValue([{ id: 'rp-1' }]);
      prisma.digest.findMany.mockResolvedValue([{ id: 'digest-1' }]);
      prisma.communityRating.aggregate.mockResolvedValue({
        _count: 25,
        _avg: { score: 4.5 },
      });

      const result = await service.getContributorProfile('user-1');

      expect(result.user.id).toBe('user-1');
      expect(result.user.fullName).toBe('Atty. Juan Dela Cruz');
      expect(result.stats.flashcardSetCount).toBe(5);
      expect(result.stats.reviewerPackCount).toBe(3);
      expect(result.stats.digestCount).toBe(10);
      expect(result.stats.totalRatingsReceived).toBe(25);
      expect(result.stats.avgRating).toBe(4.5);
    });

    it('should throw NotFoundException for non-existent user', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.getContributorProfile('non-existent'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should only count public_editorial content', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        fullName: 'Test',
        createdAt: now,
        expertVerification: null,
      });
      prisma.flashcardSet.count.mockResolvedValue(0);
      prisma.reviewerPack.count.mockResolvedValue(0);
      prisma.digest.count.mockResolvedValue(0);
      prisma.flashcardSet.findMany.mockResolvedValue([]);
      prisma.reviewerPack.findMany.mockResolvedValue([]);
      prisma.digest.findMany.mockResolvedValue([]);
      prisma.communityRating.aggregate.mockResolvedValue({
        _count: 0,
        _avg: { score: null },
      });

      await service.getContributorProfile('user-1');

      expect(prisma.flashcardSet.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', visibility: 'public_editorial' },
        }),
      );
      expect(prisma.reviewerPack.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { creatorUserId: 'user-1', visibility: 'public_editorial' },
        }),
      );
      expect(prisma.digest.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', visibility: 'public_editorial' },
        }),
      );
    });
  });

  // ===========================================================================
  // Ratings — upsertRating
  // ===========================================================================

  describe('upsertRating', () => {
    beforeEach(() => {
      // Default: entity exists and is public
      prisma.flashcardSet.findUnique.mockResolvedValue({
        visibility: 'public_editorial',
      });
      prisma.communityRating.aggregate.mockResolvedValue({
        _avg: { score: 4.5 },
        _count: 10,
      });
      prisma.flashcardSet.update.mockResolvedValue({});
    });

    it('should create or update a rating', async () => {
      prisma.communityRating.upsert.mockResolvedValue(mockRating);

      const result = await service.upsertRating('user-1', {
        entityType: 'flashcard_set',
        entityId: 'fcs-1',
        score: 5,
        reviewTitle: 'Excellent',
        reviewBody: 'Very helpful.',
      });

      expect(prisma.communityRating.upsert).toHaveBeenCalledWith({
        where: {
          userId_entityType_entityId: {
            userId: 'user-1',
            entityType: 'flashcard_set',
            entityId: 'fcs-1',
          },
        },
        create: {
          userId: 'user-1',
          entityType: 'flashcard_set',
          entityId: 'fcs-1',
          score: 5,
          reviewTitle: 'Excellent',
          reviewBody: 'Very helpful.',
        },
        update: {
          score: 5,
          reviewTitle: 'Excellent',
          reviewBody: 'Very helpful.',
        },
      });
      expect(result).toEqual(mockRating);
    });

    it('should recalculate rating aggregates after upsert', async () => {
      prisma.communityRating.upsert.mockResolvedValue(mockRating);

      await service.upsertRating('user-1', {
        entityType: 'flashcard_set',
        entityId: 'fcs-1',
        score: 5,
      });

      expect(prisma.communityRating.aggregate).toHaveBeenCalledWith({
        where: { entityType: 'flashcard_set', entityId: 'fcs-1' },
        _avg: { score: true },
        _count: true,
      });
      expect(prisma.flashcardSet.update).toHaveBeenCalledWith({
        where: { id: 'fcs-1' },
        data: { avgRating: 4.5, ratingCount: 10 },
      });
    });

    it('should recalculate aggregates on reviewer_pack', async () => {
      prisma.reviewerPack.findUnique.mockResolvedValue({
        visibility: 'public_editorial',
      });
      prisma.communityRating.upsert.mockResolvedValue(mockRating);
      prisma.communityRating.aggregate.mockResolvedValue({
        _avg: { score: 3.8 },
        _count: 7,
      });
      prisma.reviewerPack.update.mockResolvedValue({});

      await service.upsertRating('user-1', {
        entityType: 'reviewer_pack',
        entityId: 'rp-1',
        score: 4,
      });

      expect(prisma.reviewerPack.update).toHaveBeenCalledWith({
        where: { id: 'rp-1' },
        data: { avgRating: 3.8, ratingCount: 7 },
      });
    });

    it('should recalculate aggregates on digest', async () => {
      prisma.digest.findUnique.mockResolvedValue({
        visibility: 'public_editorial',
      });
      prisma.communityRating.upsert.mockResolvedValue(mockRating);
      prisma.communityRating.aggregate.mockResolvedValue({
        _avg: { score: 4.0 },
        _count: 20,
      });
      prisma.digest.update.mockResolvedValue({});

      await service.upsertRating('user-1', {
        entityType: 'digest',
        entityId: 'digest-1',
        score: 3,
      });

      expect(prisma.digest.update).toHaveBeenCalledWith({
        where: { id: 'digest-1' },
        data: { avgRating: 4.0, ratingCount: 20 },
      });
    });

    it('should throw NotFoundException for non-existent entity', async () => {
      prisma.flashcardSet.findUnique.mockResolvedValue(null);

      await expect(
        service.upsertRating('user-1', {
          entityType: 'flashcard_set',
          entityId: 'non-existent',
          score: 5,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException for non-public entity', async () => {
      prisma.flashcardSet.findUnique.mockResolvedValue({
        visibility: 'private',
      });

      await expect(
        service.upsertRating('user-1', {
          entityType: 'flashcard_set',
          entityId: 'fcs-private',
          score: 5,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException for unknown entity type', async () => {
      await expect(
        service.upsertRating('user-1', {
          entityType: 'unknown_type' as string,
          entityId: 'some-id',
          score: 5,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ===========================================================================
  // Ratings — listRatings
  // ===========================================================================

  describe('listRatings', () => {
    it('should return paginated ratings with aggregate', async () => {
      prisma.communityRating.findMany.mockResolvedValue([mockRating]);
      prisma.communityRating.groupBy.mockResolvedValue([
        { score: 5, _count: 8 },
        { score: 4, _count: 5 },
        { score: 3, _count: 2 },
      ]);

      const result = await service.listRatings('flashcard_set', 'fcs-1', {});

      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.score).toBe(5);
      expect(result.aggregate.ratingCount).toBe(15);
      expect(result.aggregate.avgRating).toBeCloseTo((5 * 8 + 4 * 5 + 3 * 2) / 15);
      expect(result.aggregate.distribution).toEqual({
        1: 0,
        2: 0,
        3: 2,
        4: 5,
        5: 8,
      });
    });

    it('should return null avgRating when no ratings', async () => {
      prisma.communityRating.findMany.mockResolvedValue([]);
      prisma.communityRating.groupBy.mockResolvedValue([]);

      const result = await service.listRatings('flashcard_set', 'fcs-1', {});

      expect(result.aggregate.avgRating).toBeNull();
      expect(result.aggregate.ratingCount).toBe(0);
    });

    it('should support cursor-based pagination', async () => {
      prisma.communityRating.findMany.mockResolvedValue([]);
      prisma.communityRating.groupBy.mockResolvedValue([]);

      await service.listRatings('flashcard_set', 'fcs-1', { cursor: 'rating-5' });

      expect(prisma.communityRating.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 1,
          cursor: { id: 'rating-5' },
        }),
      );
    });

    it('should detect hasNext correctly', async () => {
      const ratings = Array.from({ length: 21 }, (_, i) => ({
        ...mockRating,
        id: `rating-${i + 1}`,
      }));
      prisma.communityRating.findMany.mockResolvedValue(ratings);
      prisma.communityRating.groupBy.mockResolvedValue([]);

      const result = await service.listRatings('flashcard_set', 'fcs-1', {});

      expect(result.items).toHaveLength(20);
      expect(result.hasNext).toBe(true);
    });

    it('should include user info on each rating', async () => {
      prisma.communityRating.findMany.mockResolvedValue([mockRating]);
      prisma.communityRating.groupBy.mockResolvedValue([]);

      const result = await service.listRatings('flashcard_set', 'fcs-1', {});

      expect(result.items[0]!.user).toEqual({
        id: 'user-1',
        fullName: 'Atty. Juan Dela Cruz',
      });
    });
  });

  // ===========================================================================
  // Ratings — getMyRating
  // ===========================================================================

  describe('getMyRating', () => {
    it('should return user rating for entity', async () => {
      prisma.communityRating.findUnique.mockResolvedValue(mockRating);

      const result = await service.getMyRating('user-1', 'flashcard_set', 'fcs-1');

      expect(prisma.communityRating.findUnique).toHaveBeenCalledWith({
        where: {
          userId_entityType_entityId: {
            userId: 'user-1',
            entityType: 'flashcard_set',
            entityId: 'fcs-1',
          },
        },
      });
      expect(result).toEqual(mockRating);
    });

    it('should return null when no rating exists', async () => {
      prisma.communityRating.findUnique.mockResolvedValue(null);

      const result = await service.getMyRating('user-1', 'flashcard_set', 'fcs-1');

      expect(result).toBeNull();
    });
  });

  // ===========================================================================
  // Ratings — deleteRating
  // ===========================================================================

  describe('deleteRating', () => {
    it('should delete own rating and recalculate aggregates', async () => {
      prisma.communityRating.findUnique.mockResolvedValue({
        ...mockRating,
        userId: 'user-1',
        entityType: 'flashcard_set',
        entityId: 'fcs-1',
      });
      prisma.communityRating.delete.mockResolvedValue({});
      prisma.communityRating.aggregate.mockResolvedValue({
        _avg: { score: 4.0 },
        _count: 9,
      });
      prisma.flashcardSet.update.mockResolvedValue({});

      await service.deleteRating('user-1', 'rating-1');

      expect(prisma.communityRating.delete).toHaveBeenCalledWith({
        where: { id: 'rating-1' },
      });
      expect(prisma.flashcardSet.update).toHaveBeenCalledWith({
        where: { id: 'fcs-1' },
        data: { avgRating: 4.0, ratingCount: 9 },
      });
    });

    it('should throw NotFoundException for non-existent rating', async () => {
      prisma.communityRating.findUnique.mockResolvedValue(null);

      await expect(
        service.deleteRating('user-1', 'non-existent'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when deleting another user rating', async () => {
      prisma.communityRating.findUnique.mockResolvedValue({
        ...mockRating,
        userId: 'other-user',
      });

      await expect(
        service.deleteRating('user-1', 'rating-1'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ===========================================================================
  // Votes — upsertVote
  // ===========================================================================

  describe('upsertVote', () => {
    beforeEach(() => {
      prisma.digest.findUnique.mockResolvedValue({
        visibility: 'public_editorial',
      });
      prisma.communityVote.count.mockResolvedValue(0);
      prisma.digest.update.mockResolvedValue({});
    });

    it('should create or update a vote on digest', async () => {
      prisma.communityVote.upsert.mockResolvedValue(mockVote);

      const result = await service.upsertVote('user-1', 'digest', 'digest-1', {
        voteType: 'up',
      });

      expect(prisma.communityVote.upsert).toHaveBeenCalledWith({
        where: {
          userId_entityType_entityId: {
            userId: 'user-1',
            entityType: 'digest',
            entityId: 'digest-1',
          },
        },
        create: {
          userId: 'user-1',
          entityType: 'digest',
          entityId: 'digest-1',
          voteType: 'up',
        },
        update: { voteType: 'up' },
      });
      expect(result).toEqual(mockVote);
    });

    it('should recalculate vote score after upvote', async () => {
      prisma.communityVote.upsert.mockResolvedValue(mockVote);
      prisma.communityVote.count
        .mockResolvedValueOnce(10) // upCount
        .mockResolvedValueOnce(3); // downCount

      await service.upsertVote('user-1', 'digest', 'digest-1', {
        voteType: 'up',
      });

      expect(prisma.digest.update).toHaveBeenCalledWith({
        where: { id: 'digest-1' },
        data: { voteScore: 7 },
      });
    });

    it('should reject votes on non-digest entity types', async () => {
      await expect(
        service.upsertVote('user-1', 'flashcard_set', 'fcs-1', {
          voteType: 'up',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException for non-existent digest', async () => {
      prisma.digest.findUnique.mockResolvedValue(null);

      await expect(
        service.upsertVote('user-1', 'digest', 'non-existent', {
          voteType: 'up',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException for non-public digest', async () => {
      prisma.digest.findUnique.mockResolvedValue({ visibility: 'private' });

      await expect(
        service.upsertVote('user-1', 'digest', 'digest-private', {
          voteType: 'up',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should support downvote', async () => {
      prisma.communityVote.upsert.mockResolvedValue({
        ...mockVote,
        voteType: 'down',
      });

      await service.upsertVote('user-1', 'digest', 'digest-1', {
        voteType: 'down',
      });

      expect(prisma.communityVote.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ voteType: 'down' }),
          update: { voteType: 'down' },
        }),
      );
    });
  });

  // ===========================================================================
  // Votes — removeVote
  // ===========================================================================

  describe('removeVote', () => {
    it('should remove existing vote and recalculate score', async () => {
      prisma.communityVote.findUnique.mockResolvedValue(mockVote);
      prisma.communityVote.delete.mockResolvedValue({});
      prisma.communityVote.count
        .mockResolvedValueOnce(9) // upCount after removal
        .mockResolvedValueOnce(3); // downCount
      prisma.digest.update.mockResolvedValue({});

      await service.removeVote('user-1', 'digest', 'digest-1');

      expect(prisma.communityVote.delete).toHaveBeenCalledWith({
        where: { id: 'vote-1' },
      });
      expect(prisma.digest.update).toHaveBeenCalledWith({
        where: { id: 'digest-1' },
        data: { voteScore: 6 },
      });
    });

    it('should throw NotFoundException when no vote exists', async () => {
      prisma.communityVote.findUnique.mockResolvedValue(null);

      await expect(
        service.removeVote('user-1', 'digest', 'digest-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ===========================================================================
  // Votes — getMyVote
  // ===========================================================================

  describe('getMyVote', () => {
    it('should return user vote for entity', async () => {
      prisma.communityVote.findUnique.mockResolvedValue(mockVote);

      const result = await service.getMyVote('user-1', 'digest', 'digest-1');

      expect(prisma.communityVote.findUnique).toHaveBeenCalledWith({
        where: {
          userId_entityType_entityId: {
            userId: 'user-1',
            entityType: 'digest',
            entityId: 'digest-1',
          },
        },
      });
      expect(result).toEqual(mockVote);
    });

    it('should return null when no vote exists', async () => {
      prisma.communityVote.findUnique.mockResolvedValue(null);

      const result = await service.getMyVote('user-1', 'digest', 'digest-1');

      expect(result).toBeNull();
    });
  });

  // ===========================================================================
  // Flags — createFlag
  // ===========================================================================

  describe('createFlag', () => {
    it('should create a content flag', async () => {
      prisma.communityFlag.create.mockResolvedValue(mockFlag);

      const result = await service.createFlag('user-1', {
        entityType: 'flashcard_set',
        entityId: 'fcs-1',
        reason: 'inaccurate',
        details: 'Contains wrong citation.',
      });

      expect(prisma.communityFlag.create).toHaveBeenCalledWith({
        data: {
          reporterUserId: 'user-1',
          entityType: 'flashcard_set',
          entityId: 'fcs-1',
          reason: 'inaccurate',
          details: 'Contains wrong citation.',
        },
      });
      expect(result).toEqual(mockFlag);
    });

    it('should create flag without optional details', async () => {
      prisma.communityFlag.create.mockResolvedValue({
        ...mockFlag,
        details: null,
      });

      await service.createFlag('user-1', {
        entityType: 'flashcard_set',
        entityId: 'fcs-1',
        reason: 'spam',
      });

      expect(prisma.communityFlag.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          reason: 'spam',
          details: undefined,
        }),
      });
    });
  });

  // ===========================================================================
  // Flags — listFlags
  // ===========================================================================

  describe('listFlags', () => {
    it('should list open flags by default', async () => {
      prisma.communityFlag.findMany.mockResolvedValue([mockFlag]);

      const result = await service.listFlags({});

      expect(prisma.communityFlag.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'open' },
          orderBy: { createdAt: 'desc' },
        }),
      );
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.reason).toBe('inaccurate');
    });

    it('should filter by provided status', async () => {
      prisma.communityFlag.findMany.mockResolvedValue([]);

      await service.listFlags({ status: 'actioned' });

      expect(prisma.communityFlag.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'actioned' },
        }),
      );
    });

    it('should support cursor-based pagination', async () => {
      prisma.communityFlag.findMany.mockResolvedValue([]);

      await service.listFlags({ cursor: 'flag-5' });

      expect(prisma.communityFlag.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 1,
          cursor: { id: 'flag-5' },
        }),
      );
    });

    it('should include reporter and resolvedBy', async () => {
      prisma.communityFlag.findMany.mockResolvedValue([mockFlag]);

      const result = await service.listFlags({});

      expect(result.items[0]!.reporter).toEqual({
        id: 'user-1',
        fullName: 'Atty. Juan Dela Cruz',
      });
    });

    it('should handle null resolvedAt', async () => {
      prisma.communityFlag.findMany.mockResolvedValue([mockFlag]);

      const result = await service.listFlags({});

      expect(result.items[0]!.resolvedAt).toBeNull();
    });
  });

  // ===========================================================================
  // Flags — resolveFlag
  // ===========================================================================

  describe('resolveFlag', () => {
    it('should resolve an open flag as dismissed', async () => {
      prisma.communityFlag.findUnique.mockResolvedValue({
        ...mockFlag,
        status: 'open',
      });
      prisma.communityFlag.update.mockResolvedValue({
        ...mockFlag,
        status: 'dismissed',
        resolvedByUserId: 'admin-1',
        resolutionNote: 'Not a real issue',
      });

      const result = await service.resolveFlag('flag-1', 'admin-1', {
        status: 'dismissed',
        resolutionNote: 'Not a real issue',
      });

      expect(prisma.communityFlag.update).toHaveBeenCalledWith({
        where: { id: 'flag-1' },
        data: expect.objectContaining({
          status: 'dismissed',
          resolvedByUserId: 'admin-1',
          resolutionNote: 'Not a real issue',
          resolvedAt: expect.any(Date),
        }),
      });
      expect(result.status).toBe('dismissed');
    });

    it('should resolve an open flag as actioned', async () => {
      prisma.communityFlag.findUnique.mockResolvedValue({
        ...mockFlag,
        status: 'open',
      });
      prisma.communityFlag.update.mockResolvedValue({
        ...mockFlag,
        status: 'actioned',
      });

      await service.resolveFlag('flag-1', 'admin-1', {
        status: 'actioned',
      });

      expect(prisma.communityFlag.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'actioned' }),
        }),
      );
    });

    it('should throw NotFoundException for non-existent flag', async () => {
      prisma.communityFlag.findUnique.mockResolvedValue(null);

      await expect(
        service.resolveFlag('non-existent', 'admin-1', { status: 'dismissed' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException for already-resolved flag', async () => {
      prisma.communityFlag.findUnique.mockResolvedValue({
        ...mockFlag,
        status: 'dismissed',
      });

      await expect(
        service.resolveFlag('flag-1', 'admin-1', { status: 'actioned' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ===========================================================================
  // Expert Verification — submitExpertVerification
  // ===========================================================================

  describe('submitExpertVerification', () => {
    it('should create new verification for first-time submission', async () => {
      prisma.expertVerification.findUnique.mockResolvedValue(null);
      prisma.expertVerification.create.mockResolvedValue(mockExpertVerification);

      const result = await service.submitExpertVerification('user-1', {
        expertiseType: 'lawyer',
        credentialDetails: 'Bar Roll No. 12345',
      });

      expect(prisma.expertVerification.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          expertiseType: 'lawyer',
          credentialDetails: 'Bar Roll No. 12345',
        },
      });
      expect(result).toEqual(mockExpertVerification);
    });

    it('should allow re-submission after rejection', async () => {
      prisma.expertVerification.findUnique.mockResolvedValue({
        ...mockExpertVerification,
        status: 'rejected',
      });
      prisma.expertVerification.update.mockResolvedValue({
        ...mockExpertVerification,
        status: 'pending',
      });

      await service.submitExpertVerification('user-1', {
        expertiseType: 'law_professor',
        credentialDetails: 'Faculty ID UP Law',
      });

      expect(prisma.expertVerification.update).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        data: {
          expertiseType: 'law_professor',
          credentialDetails: 'Faculty ID UP Law',
          status: 'pending',
          reviewNote: null,
          reviewedAt: null,
        },
      });
    });

    it('should allow re-submission after revocation', async () => {
      prisma.expertVerification.findUnique.mockResolvedValue({
        ...mockExpertVerification,
        status: 'revoked',
      });
      prisma.expertVerification.update.mockResolvedValue({
        ...mockExpertVerification,
        status: 'pending',
      });

      await service.submitExpertVerification('user-1', {
        expertiseType: 'judge_retired',
      });

      expect(prisma.expertVerification.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'pending' }),
        }),
      );
    });

    it('should throw ConflictException if already approved', async () => {
      prisma.expertVerification.findUnique.mockResolvedValue({
        ...mockExpertVerification,
        status: 'approved',
      });

      await expect(
        service.submitExpertVerification('user-1', {
          expertiseType: 'lawyer',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw ConflictException if already pending', async () => {
      prisma.expertVerification.findUnique.mockResolvedValue({
        ...mockExpertVerification,
        status: 'pending',
      });

      await expect(
        service.submitExpertVerification('user-1', {
          expertiseType: 'lawyer',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ===========================================================================
  // Expert Verification — getMyExpertVerification
  // ===========================================================================

  describe('getMyExpertVerification', () => {
    it('should return verification status', async () => {
      prisma.expertVerification.findUnique.mockResolvedValue(mockExpertVerification);

      const result = await service.getMyExpertVerification('user-1');

      expect(prisma.expertVerification.findUnique).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
      expect(result).toEqual(mockExpertVerification);
    });

    it('should return null when no verification exists', async () => {
      prisma.expertVerification.findUnique.mockResolvedValue(null);

      const result = await service.getMyExpertVerification('user-1');

      expect(result).toBeNull();
    });
  });

  // ===========================================================================
  // Expert Verification — listExpertVerifications
  // ===========================================================================

  describe('listExpertVerifications', () => {
    it('should list pending verifications by default', async () => {
      prisma.expertVerification.findMany.mockResolvedValue([mockExpertVerification]);

      const result = await service.listExpertVerifications({});

      expect(prisma.expertVerification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'pending' },
          orderBy: { createdAt: 'desc' },
        }),
      );
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.expertiseType).toBe('lawyer');
    });

    it('should filter by provided status', async () => {
      prisma.expertVerification.findMany.mockResolvedValue([]);

      await service.listExpertVerifications({ status: 'approved' });

      expect(prisma.expertVerification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'approved' },
        }),
      );
    });

    it('should include user info', async () => {
      prisma.expertVerification.findMany.mockResolvedValue([mockExpertVerification]);

      const result = await service.listExpertVerifications({});

      expect(result.items[0]!.user).toEqual({
        id: 'user-1',
        fullName: 'Atty. Juan Dela Cruz',
        email: 'juan@example.com',
      });
    });

    it('should support cursor-based pagination', async () => {
      prisma.expertVerification.findMany.mockResolvedValue([]);

      await service.listExpertVerifications({ cursor: 'ev-5' });

      expect(prisma.expertVerification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 1,
          cursor: { id: 'ev-5' },
        }),
      );
    });

    it('should handle null reviewedAt', async () => {
      prisma.expertVerification.findMany.mockResolvedValue([mockExpertVerification]);

      const result = await service.listExpertVerifications({});

      expect(result.items[0]!.reviewedAt).toBeNull();
    });

    it('should detect hasNext correctly', async () => {
      const items = Array.from({ length: 21 }, (_, i) => ({
        ...mockExpertVerification,
        id: `ev-${i + 1}`,
      }));
      prisma.expertVerification.findMany.mockResolvedValue(items);

      const result = await service.listExpertVerifications({});

      expect(result.items).toHaveLength(20);
      expect(result.hasNext).toBe(true);
      expect(result.nextCursor).toBe('ev-20');
    });
  });

  // ===========================================================================
  // Expert Verification — resolveExpertVerification
  // ===========================================================================

  describe('resolveExpertVerification', () => {
    it('should approve a pending verification', async () => {
      prisma.expertVerification.findUnique.mockResolvedValue({
        ...mockExpertVerification,
        status: 'pending',
      });
      prisma.expertVerification.update.mockResolvedValue({
        ...mockExpertVerification,
        status: 'approved',
      });

      const result = await service.resolveExpertVerification('ev-1', {
        status: 'approved',
        reviewNote: 'Credentials verified',
      });

      expect(prisma.expertVerification.update).toHaveBeenCalledWith({
        where: { id: 'ev-1' },
        data: {
          status: 'approved',
          reviewNote: 'Credentials verified',
          reviewedAt: expect.any(Date),
        },
      });
      expect(result.status).toBe('approved');
    });

    it('should reject a pending verification', async () => {
      prisma.expertVerification.findUnique.mockResolvedValue({
        ...mockExpertVerification,
        status: 'pending',
      });
      prisma.expertVerification.update.mockResolvedValue({
        ...mockExpertVerification,
        status: 'rejected',
      });

      await service.resolveExpertVerification('ev-1', {
        status: 'rejected',
        reviewNote: 'Insufficient documentation',
      });

      expect(prisma.expertVerification.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'rejected' }),
        }),
      );
    });

    it('should revoke an approved verification', async () => {
      prisma.expertVerification.findUnique.mockResolvedValue({
        ...mockExpertVerification,
        status: 'approved',
      });
      prisma.expertVerification.update.mockResolvedValue({
        ...mockExpertVerification,
        status: 'revoked',
      });

      await service.resolveExpertVerification('ev-1', {
        status: 'revoked',
        reviewNote: 'Misconduct reported',
      });

      expect(prisma.expertVerification.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'revoked' }),
        }),
      );
    });

    it('should throw NotFoundException for non-existent verification', async () => {
      prisma.expertVerification.findUnique.mockResolvedValue(null);

      await expect(
        service.resolveExpertVerification('non-existent', { status: 'approved' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when revoking non-approved', async () => {
      prisma.expertVerification.findUnique.mockResolvedValue({
        ...mockExpertVerification,
        status: 'pending',
      });

      await expect(
        service.resolveExpertVerification('ev-1', { status: 'revoked' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when approving non-pending', async () => {
      prisma.expertVerification.findUnique.mockResolvedValue({
        ...mockExpertVerification,
        status: 'approved',
      });

      await expect(
        service.resolveExpertVerification('ev-1', { status: 'approved' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when rejecting non-pending', async () => {
      prisma.expertVerification.findUnique.mockResolvedValue({
        ...mockExpertVerification,
        status: 'rejected',
      });

      await expect(
        service.resolveExpertVerification('ev-1', { status: 'rejected' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ===========================================================================
  // Entity Validation — private method tested indirectly
  // ===========================================================================

  describe('validatePublicEntity (indirect)', () => {
    it('should validate flashcard_set entity', async () => {
      prisma.flashcardSet.findUnique.mockResolvedValue({
        visibility: 'public_editorial',
      });
      prisma.communityRating.upsert.mockResolvedValue(mockRating);
      prisma.communityRating.aggregate.mockResolvedValue({
        _avg: { score: 4.0 },
        _count: 1,
      });
      prisma.flashcardSet.update.mockResolvedValue({});

      await service.upsertRating('user-1', {
        entityType: 'flashcard_set',
        entityId: 'fcs-1',
        score: 5,
      });

      expect(prisma.flashcardSet.findUnique).toHaveBeenCalledWith({
        where: { id: 'fcs-1' },
        select: { visibility: true },
      });
    });

    it('should validate reviewer_pack entity', async () => {
      prisma.reviewerPack.findUnique.mockResolvedValue({
        visibility: 'public_editorial',
      });
      prisma.communityRating.upsert.mockResolvedValue(mockRating);
      prisma.communityRating.aggregate.mockResolvedValue({
        _avg: { score: 4.0 },
        _count: 1,
      });
      prisma.reviewerPack.update.mockResolvedValue({});

      await service.upsertRating('user-1', {
        entityType: 'reviewer_pack',
        entityId: 'rp-1',
        score: 5,
      });

      expect(prisma.reviewerPack.findUnique).toHaveBeenCalledWith({
        where: { id: 'rp-1' },
        select: { visibility: true },
      });
    });

    it('should validate digest entity', async () => {
      prisma.digest.findUnique.mockResolvedValue({
        visibility: 'public_editorial',
      });
      prisma.communityRating.upsert.mockResolvedValue(mockRating);
      prisma.communityRating.aggregate.mockResolvedValue({
        _avg: { score: 4.0 },
        _count: 1,
      });
      prisma.digest.update.mockResolvedValue({});

      await service.upsertRating('user-1', {
        entityType: 'digest',
        entityId: 'digest-1',
        score: 5,
      });

      expect(prisma.digest.findUnique).toHaveBeenCalledWith({
        where: { id: 'digest-1' },
        select: { visibility: true },
      });
    });

    it('should reject org-visible entity', async () => {
      prisma.flashcardSet.findUnique.mockResolvedValue({
        visibility: 'org',
      });

      await expect(
        service.upsertRating('user-1', {
          entityType: 'flashcard_set',
          entityId: 'fcs-org',
          score: 5,
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
