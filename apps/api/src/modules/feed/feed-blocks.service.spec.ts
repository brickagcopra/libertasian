import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';

import { FeedBlocksService } from './feed-blocks.service';
import { PrismaService } from '../../prisma/prisma.service';

const ME = 'user-me';
const THEM = 'user-them';
const THIRD = 'user-third';

const mockPrisma = {
  feedUserBlock: {
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    deleteMany: jest.fn(),
  },
  user: {
    findFirst: jest.fn(),
  },
};

function uniqueError() {
  return Object.assign(new Error('unique'), { code: 'P2002' });
}

describe('FeedBlocksService', () => {
  let service: FeedBlocksService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeedBlocksService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<FeedBlocksService>(FeedBlocksService);
    jest.clearAllMocks();

    mockPrisma.user.findFirst.mockResolvedValue({ id: THEM });
    mockPrisma.feedUserBlock.count.mockResolvedValue(0);
    mockPrisma.feedUserBlock.create.mockResolvedValue({ id: 'block-1' });
    mockPrisma.feedUserBlock.deleteMany.mockResolvedValue({ count: 1 });
  });

  // ─── getHiddenUserIds ───────────────────────────────────────────────────

  describe('getHiddenUserIds', () => {
    it('unions both directions — people I blocked and people who blocked me', async () => {
      mockPrisma.feedUserBlock.findMany.mockResolvedValue([
        { blockerUserId: ME, blockedUserId: THEM },
        { blockerUserId: THIRD, blockedUserId: ME },
      ]);

      const hidden = await service.getHiddenUserIds(ME);

      expect(hidden.sort()).toEqual([THEM, THIRD].sort());
    });

    it('dedupes a mutual block into a single id', async () => {
      mockPrisma.feedUserBlock.findMany.mockResolvedValue([
        { blockerUserId: ME, blockedUserId: THEM },
        { blockerUserId: THEM, blockedUserId: ME },
      ]);

      expect(await service.getHiddenUserIds(ME)).toEqual([THEM]);
    });

    it('returns an empty list when there are no blocks', async () => {
      mockPrisma.feedUserBlock.findMany.mockResolvedValue([]);
      expect(await service.getHiddenUserIds(ME)).toEqual([]);
    });
  });

  // ─── hiddenAuthorFilter ─────────────────────────────────────────────────

  describe('hiddenAuthorFilter', () => {
    it('emits NOTHING when the list is empty, keeping the hot query unchanged', () => {
      expect(service.hiddenAuthorFilter([])).toEqual({});
    });

    it('emits a notIn predicate when there are blocks', () => {
      expect(service.hiddenAuthorFilter([THEM])).toEqual({
        authorId: { notIn: [THEM] },
      });
    });
  });

  // ─── blockUser ──────────────────────────────────────────────────────────

  describe('blockUser', () => {
    it('rejects blocking yourself', async () => {
      await expect(service.blockUser(ME, ME)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockPrisma.feedUserBlock.create).not.toHaveBeenCalled();
    });

    it('404s on an unknown or deleted target', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      await expect(service.blockUser(ME, THEM)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockPrisma.feedUserBlock.create).not.toHaveBeenCalled();
    });

    it('excludes soft-deleted users from the target lookup', async () => {
      await service.blockUser(ME, THEM);

      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: THEM, deletedAt: null },
        }),
      );
    });

    it('creates the block row', async () => {
      await service.blockUser(ME, THEM);

      expect(mockPrisma.feedUserBlock.create).toHaveBeenCalledWith({
        data: { blockerUserId: ME, blockedUserId: THEM },
      });
    });

    it('is idempotent — a duplicate block is a no-op, not an error', async () => {
      mockPrisma.feedUserBlock.create.mockRejectedValue(uniqueError());

      await expect(service.blockUser(ME, THEM)).resolves.toBeUndefined();
    });

    it('rethrows non-unique database errors', async () => {
      mockPrisma.feedUserBlock.create.mockRejectedValue(new Error('boom'));

      await expect(service.blockUser(ME, THEM)).rejects.toThrow('boom');
    });

    it('rejects once the per-user block cap is reached', async () => {
      mockPrisma.feedUserBlock.count.mockResolvedValue(1000);

      await expect(service.blockUser(ME, THEM)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockPrisma.feedUserBlock.create).not.toHaveBeenCalled();
    });
  });

  // ─── unblockUser ────────────────────────────────────────────────────────

  describe('unblockUser', () => {
    it('deletes only the outbound row', async () => {
      await service.unblockUser(ME, THEM);

      expect(mockPrisma.feedUserBlock.deleteMany).toHaveBeenCalledWith({
        where: { blockerUserId: ME, blockedUserId: THEM },
      });
    });

    it('is idempotent — unblocking a non-block does not throw', async () => {
      mockPrisma.feedUserBlock.deleteMany.mockResolvedValue({ count: 0 });

      await expect(service.unblockUser(ME, THEM)).resolves.toBeUndefined();
    });
  });

  // ─── listBlockedUsers ───────────────────────────────────────────────────

  describe('listBlockedUsers', () => {
    it('returns only the outbound direction, never who blocked me', async () => {
      mockPrisma.feedUserBlock.findMany.mockResolvedValue([]);

      await service.listBlockedUsers(ME, {});

      expect(mockPrisma.feedUserBlock.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { blockerUserId: ME } }),
      );
      const call = mockPrisma.feedUserBlock.findMany.mock.calls[0]![0];
      expect(JSON.stringify(call.where)).not.toContain('blockedUserId');
    });

    it('paginates with take limit + 1 and reports hasNext', async () => {
      const rows = Array.from({ length: 3 }, (_, i) => ({
        id: `block-${i}`,
        createdAt: new Date('2026-08-15T00:00:00.000Z'),
        blocked: { id: `u-${i}`, fullName: `User ${i}` },
      }));
      mockPrisma.feedUserBlock.findMany.mockResolvedValue(rows);

      const result = await service.listBlockedUsers(ME, { limit: 2 });

      expect(mockPrisma.feedUserBlock.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 3 }),
      );
      expect(result.items).toHaveLength(2);
      expect(result.hasNext).toBe(true);
      expect(result.nextCursor).toBe('block-1');
      expect(result.items[0]).toEqual({
        id: 'block-0',
        user: { id: 'u-0', fullName: 'User 0' },
        createdAt: '2026-08-15T00:00:00.000Z',
      });
    });
  });
});
