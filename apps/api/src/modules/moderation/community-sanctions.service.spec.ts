import { ForbiddenException, HttpException } from '@nestjs/common';

import { CommunitySanctionsService } from './community-sanctions.service';

describe('CommunitySanctionsService', () => {
  const prisma = {
    communitySanction: { findFirst: jest.fn() },
    moderationAction: { findFirst: jest.fn() },
    feedPostReport: { aggregate: jest.fn() },
    feedCommentReport: { aggregate: jest.fn() },
    communityFlag: { aggregate: jest.fn() },
  };
  const service = new CommunitySanctionsService(prisma as never);

  beforeEach(() => jest.resetAllMocks());

  describe('assertCanParticipate', () => {
    it('passes a user with no active restriction', async () => {
      prisma.communitySanction.findFirst.mockResolvedValue(null);
      await expect(service.assertCanParticipate('u1')).resolves.toBeUndefined();
    });

    it('only looks for unrevoked, started, unexpired suspensions and bans', async () => {
      prisma.communitySanction.findFirst.mockResolvedValue(null);
      await service.assertCanParticipate('u1');
      const where = prisma.communitySanction.findFirst.mock.calls[0][0].where;
      expect(where.userId).toBe('u1');
      expect(where.type).toEqual({ in: ['suspension', 'ban'] });
      expect(where.revokedAt).toBeNull();
      expect(where.OR).toEqual([{ endsAt: null }, { endsAt: { gt: expect.any(Date) } }]);
    });

    it('refuses a banned user', async () => {
      prisma.communitySanction.findFirst.mockResolvedValue({ type: 'ban', endsAt: null });
      await expect(service.assertCanParticipate('u1')).rejects.toThrow(/banned/);
    });

    it('refuses a suspended user and names the end date', async () => {
      prisma.communitySanction.findFirst.mockResolvedValue({
        type: 'suspension',
        endsAt: new Date('2026-12-01T04:00:00Z'),
      });
      await expect(service.assertCanParticipate('u1')).rejects.toThrow(/suspended until December 1, 2026/);
    });
  });

  describe('assertCanPublish', () => {
    it('refuses to republish an item whose latest moderation action is a removal', async () => {
      prisma.communitySanction.findFirst.mockResolvedValue(null);
      prisma.moderationAction.findFirst.mockResolvedValue({ action: 'remove' });
      await expect(
        service.assertCanPublish('u1', { targetType: 'flashcard_set', targetId: 's1' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows republishing after a moderator restore', async () => {
      prisma.communitySanction.findFirst.mockResolvedValue(null);
      prisma.moderationAction.findFirst.mockResolvedValue({ action: 'restore' });
      await expect(
        service.assertCanPublish('u1', { targetType: 'reviewer_pack', targetId: 'p1' }),
      ).resolves.toBeUndefined();
    });
  });

  describe('isActive', () => {
    const now = new Date('2026-11-20T00:00:00Z');
    const base = { startsAt: new Date('2026-11-01T00:00:00Z'), revokedAt: null, endsAt: null };

    it('treats warnings as never active', () => {
      expect(CommunitySanctionsService.isActive({ ...base, type: 'warning' }, now)).toBe(false);
    });
    it('treats an expired suspension as inactive', () => {
      expect(
        CommunitySanctionsService.isActive({ ...base, type: 'suspension', endsAt: new Date('2026-11-10') }, now),
      ).toBe(false);
    });
    it('treats a revoked ban as inactive', () => {
      expect(CommunitySanctionsService.isActive({ ...base, type: 'ban', revokedAt: now }, now)).toBe(false);
    });
    it('treats an open-ended ban as active', () => {
      expect(CommunitySanctionsService.isActive({ ...base, type: 'ban' }, now)).toBe(true);
    });
  });

  describe('assertCanReport', () => {
    const agg = (n: number, oldest: Date | null = null) => ({ _count: { _all: n }, _min: { createdAt: oldest } });
    const now = new Date('2026-11-21T12:00:00Z');

    it('allows a user under the 24h cap and counts all three report tables', async () => {
      prisma.feedPostReport.aggregate.mockResolvedValue(agg(10));
      prisma.feedCommentReport.aggregate.mockResolvedValue(agg(5));
      prisma.communityFlag.aggregate.mockResolvedValue(agg(4));
      await expect(service.assertCanReport('u1', now)).resolves.toBeUndefined();
      const where = prisma.feedPostReport.aggregate.mock.calls[0][0].where;
      expect(where).toEqual({ reporterUserId: 'u1', createdAt: { gte: new Date('2026-11-20T12:00:00Z') } });
    });

    it('refuses the 21st report with 429 quota_exceeded and a retry time from the oldest report', async () => {
      prisma.feedPostReport.aggregate.mockResolvedValue(agg(12, new Date('2026-11-20T18:00:00Z')));
      prisma.feedCommentReport.aggregate.mockResolvedValue(agg(8, new Date('2026-11-20T15:00:00Z')));
      prisma.communityFlag.aggregate.mockResolvedValue(agg(0));
      const err = await service.assertCanReport('u1', now).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(HttpException);
      const http = err as HttpException;
      expect(http.getStatus()).toBe(429);
      // Oldest counted report is 15:00 yesterday, so a slot frees at 15:00 today: 3h.
      expect(http.getResponse()).toMatchObject({ code: 'quota_exceeded', retryAfterSeconds: 3 * 3600 });
    });
  });
});
