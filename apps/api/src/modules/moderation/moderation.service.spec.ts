import { BadRequestException, ForbiddenException } from '@nestjs/common';

import { ModerationService } from './moderation.service';

const MOD = '00000000-0000-0000-0000-00000000000a';
const AUTHOR = '00000000-0000-0000-0000-00000000000b';
const POST = '00000000-0000-0000-0000-0000000000p1';

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

function makePrisma() {
  const model = () => ({
    findMany: jest.fn().mockResolvedValue([]),
    findFirst: jest.fn().mockResolvedValue(null),
    findUnique: jest.fn().mockResolvedValue(null),
    findUniqueOrThrow: jest.fn(),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'new-id', ...data })),
    update: jest.fn().mockResolvedValue({}),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
  });
  const prisma = {
    feedPostReport: model(),
    feedCommentReport: model(),
    communityFlag: model(),
    feedPost: model(),
    feedComment: model(),
    flashcardSet: model(),
    reviewerPack: model(),
    digest: model(),
    communityRating: model(),
    moderationAction: model(),
    communitySanction: model(),
    user: model(),
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
  return prisma;
}

function livePost(status = 'published', authorId = AUTHOR) {
  return {
    id: POST,
    authorId,
    textContent: 'An argument about estafa',
    status,
    deletedAt: null,
    createdAt: hoursAgo(30),
    editedAt: null,
    author: { id: authorId, fullName: 'Author' },
  };
}

describe('ModerationService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  const audit = { log: jest.fn() };
  const notificationCenter = { createNotification: jest.fn() };
  const notifications = { sendModerationAlert: jest.fn().mockResolvedValue(undefined) };
  const platformGrants = {
    listUsersWithPlatformPermission: jest
      .fn()
      .mockResolvedValue([{ userId: MOD, fullName: 'Mod', email: 'mod@example.com' }]),
  };
  let service: ModerationService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue({ id: AUTHOR, fullName: 'Author', createdAt: new Date(), status: 'active' });
    service = new ModerationService(
      prisma as never,
      audit as never,
      notificationCenter as never,
      notifications as never,
      platformGrants as never,
    );
  });

  describe('listCases', () => {
    it('groups reports per target, counts reasons and puts the oldest case first', async () => {
      prisma.feedPostReport.findMany.mockResolvedValue([
        { postId: 'p-new', reason: 'spam', status: 'open', createdAt: hoursAgo(1), resolvedAt: null },
        { postId: 'p-old', reason: 'harassment', status: 'open', createdAt: hoursAgo(30), resolvedAt: null },
        { postId: 'p-old', reason: 'harassment', status: 'open', createdAt: hoursAgo(20), resolvedAt: null },
      ]);
      prisma.communityFlag.findMany.mockResolvedValue([
        { entityType: 'flashcard_set', entityId: 'fs1', reason: 'copyright', status: 'open', createdAt: hoursAgo(5), resolvedAt: null },
      ]);

      const result = await service.listCases({});

      expect(result.total).toBe(3);
      expect(result.items.map((c) => c.targetId)).toEqual(['p-old', 'fs1', 'p-new']);
      expect(result.items[0]).toMatchObject({ reportCount: 2, reasons: { harassment: 2 }, status: 'open' });
    });

    it('sorts by report count when asked', async () => {
      prisma.feedPostReport.findMany.mockResolvedValue([
        { postId: 'a', reason: 'spam', status: 'open', createdAt: hoursAgo(9), resolvedAt: null },
        { postId: 'b', reason: 'spam', status: 'open', createdAt: hoursAgo(1), resolvedAt: null },
        { postId: 'b', reason: 'spam', status: 'open', createdAt: hoursAgo(1), resolvedAt: null },
      ]);
      const result = await service.listCases({ type: 'post', sort: 'most_reported' });
      expect(result.items.map((c) => c.targetId)).toEqual(['b', 'a']);
      expect(prisma.communityFlag.findMany).not.toHaveBeenCalled();
    });
  });

  describe('getStats', () => {
    it('counts overdue (>24h) and due-soon (12–24h) open cases', async () => {
      prisma.feedPostReport.findMany.mockImplementation(({ where }) =>
        Promise.resolve(
          where.status === 'open'
            ? [
                { postId: 'a', reason: 'spam', status: 'open', createdAt: hoursAgo(30), resolvedAt: null },
                { postId: 'b', reason: 'spam', status: 'open', createdAt: hoursAgo(13), resolvedAt: null },
                { postId: 'c', reason: 'spam', status: 'open', createdAt: hoursAgo(1), resolvedAt: null },
              ]
            : [{ postId: 'd', reason: 'spam', status: 'actioned', createdAt: hoursAgo(10), resolvedAt: hoursAgo(6) }],
        ),
      );
      const stats = await service.getStats();
      expect(stats).toMatchObject({ openCases: 3, overdueCases: 1, dueSoonCases: 1, resolvedLast7d: 1 });
      expect(stats.medianResolutionHours7d).toBeCloseTo(4, 0);
    });
  });

  describe('resolveCase', () => {
    it("refuses a moderator acting on their own content", async () => {
      prisma.feedPost.findMany.mockResolvedValue([livePost('published', MOD)]);
      await expect(
        service.resolveCase('post', POST, { decision: 'remove', reason: 'spam' }, MOD),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('removes a post, resolves every open report as actioned, logs and notifies the author', async () => {
      prisma.feedPost.findMany.mockResolvedValue([livePost()]);
      prisma.feedPostReport.count.mockResolvedValue(2);
      prisma.feedPostReport.updateMany.mockResolvedValue({ count: 2 });

      await service.resolveCase('post', POST, { decision: 'remove', reason: 'harassment', note: 'n' }, MOD);

      expect(prisma.feedPost.updateMany).toHaveBeenCalledWith({
        where: { id: POST, deletedAt: null },
        data: { status: 'removed_by_admin' },
      });
      expect(prisma.feedPostReport.updateMany).toHaveBeenCalledWith({
        where: { postId: POST, status: 'open' },
        data: expect.objectContaining({ status: 'actioned', resolvedByUserId: MOD, resolutionNote: 'n' }),
      });
      expect(prisma.moderationAction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'remove', reason: 'harassment', reportsResolved: 2, subjectUserId: AUTHOR }),
      });
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'moderation.remove', entityId: POST }));
      expect(notificationCenter.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({ userId: AUTHOR, title: 'Your post was removed', entityType: 'moderation' }),
      );
    });

    it('does not notify when notifyAuthor is false', async () => {
      prisma.feedPost.findMany.mockResolvedValue([livePost()]);
      await service.resolveCase('post', POST, { decision: 'remove', reason: 'spam', notifyAuthor: false }, MOD);
      expect(notificationCenter.createNotification).not.toHaveBeenCalled();
    });

    it('dismissing reports on auto-hidden content makes it visible again', async () => {
      prisma.feedPost.findMany.mockResolvedValue([livePost('hidden')]);
      prisma.feedPostReport.count.mockResolvedValue(3);
      await service.resolveCase('post', POST, { decision: 'dismiss' }, MOD);
      expect(prisma.feedPost.updateMany).toHaveBeenCalledWith({
        where: { id: POST, deletedAt: null },
        data: { status: 'published' },
      });
      expect(prisma.feedPostReport.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'dismissed' }) }),
      );
    });

    it('refuses to dismiss a case with no open reports', async () => {
      prisma.feedPost.findMany.mockResolvedValue([livePost()]);
      await expect(service.resolveCase('post', POST, { decision: 'dismiss' }, MOD)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('removing a community flashcard set unlists it and remembers how to restore it', async () => {
      prisma.flashcardSet.findMany.mockResolvedValue([
        { id: 'fs1', userId: AUTHOR, title: 'Set', description: null, visibility: 'public_editorial', createdAt: new Date(), user: { id: AUTHOR, fullName: 'A' } },
      ]);
      await service.resolveCase('flashcard_set', 'fs1', { decision: 'remove', reason: 'copyright' }, MOD);
      expect(prisma.flashcardSet.update).toHaveBeenCalledWith({ where: { id: 'fs1' }, data: { visibility: 'private' } });
      expect(prisma.communityFlag.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { entityType: 'flashcard_set', entityId: 'fs1', status: 'open' } }),
      );
      expect(prisma.moderationAction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ metadataJson: { previousVisibility: 'public_editorial' } }),
      });
    });
  });

  describe('restoreContent', () => {
    it('puts a removed review text back from the removal record', async () => {
      prisma.communityRating.findMany.mockResolvedValue([
        { id: 'r1', userId: AUTHOR, score: 1, reviewTitle: null, reviewBody: null, createdAt: new Date(), updatedAt: new Date(), user: { id: AUTHOR, fullName: 'A' } },
      ]);
      // Only the remove/restore status lookup gets a row; history stays empty.
      prisma.moderationAction.findMany.mockImplementation(({ where }) =>
        Promise.resolve(where.action ? [{ targetId: 'r1', action: 'remove' }] : []),
      );
      prisma.moderationAction.findFirst.mockResolvedValue({
        metadataJson: { previousReviewTitle: 'Bad', previousReviewBody: 'Words' },
      });

      await service.restoreContent('community_rating', 'r1', undefined, MOD);

      expect(prisma.communityRating.update).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: { reviewTitle: 'Bad', reviewBody: 'Words' },
      });
      expect(prisma.moderationAction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'restore' }),
      });
    });
  });

  describe('onReportFiled', () => {
    it('emails moderators when a new case opens', async () => {
      prisma.feedPostReport.count.mockResolvedValue(1);
      prisma.feedPost.findMany.mockResolvedValue([livePost()]);
      await service.onReportFiled('post', POST);
      expect(notifications.sendModerationAlert).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'mod@example.com', heading: 'New report on a post', urgent: false }),
      );
      expect(prisma.feedPost.updateMany).not.toHaveBeenCalled();
    });

    it('auto-hides a post at the report threshold and records it', async () => {
      prisma.feedPostReport.count.mockResolvedValue(3);
      prisma.feedPost.findMany.mockResolvedValue([livePost()]);
      prisma.feedPost.updateMany.mockResolvedValue({ count: 1 });

      await service.onReportFiled('post', POST);

      expect(prisma.feedPost.updateMany).toHaveBeenCalledWith({
        where: { id: POST, deletedAt: null, status: 'published' },
        data: { status: 'hidden' },
      });
      expect(prisma.moderationAction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'auto_hide', moderatorUserId: null }),
      });
      expect(notifications.sendModerationAlert).toHaveBeenCalledWith(expect.objectContaining({ urgent: true }));
    });

    it('never auto-hides community items', async () => {
      prisma.communityFlag.count.mockResolvedValue(5);
      await service.onReportFiled('flashcard_set', 'fs1');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('never throws, so a failure cannot fail the report', async () => {
      prisma.feedPostReport.count.mockRejectedValue(new Error('db down'));
      await expect(service.onReportFiled('post', POST)).resolves.toBeUndefined();
    });
  });

  describe('sanctions', () => {
    it("refuses a moderator sanctioning themself", async () => {
      await expect(
        service.createSanction(MOD, { type: 'warning', reason: 'spam' }, MOD),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('a suspension ends after its duration and supersedes a running restriction', async () => {
      prisma.communitySanction.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 's1', revokedAt: null, createdAt: new Date(), user: { id: AUTHOR, fullName: 'A' }, issuedBy: null, revokedBy: null, ...data }),
      );
      const before = Date.now();
      const s = await service.createSanction(AUTHOR, { type: 'suspension', reason: 'harassment', durationDays: 7 }, MOD);

      expect(prisma.communitySanction.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ revokedByUserId: MOD }) }),
      );
      const ends = new Date(s.endsAt!).getTime();
      expect(ends - before).toBeGreaterThanOrEqual(7 * 24 * 3_600_000 - 1000);
      expect(s.active).toBe(true);
      expect(notificationCenter.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({ userId: AUTHOR, title: 'Your community access is suspended for 7 days' }),
      );
    });

    it('a ban with removeContent takes down live posts and comments and resolves their reports', async () => {
      prisma.communitySanction.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 's2', revokedAt: null, createdAt: new Date(), user: { id: AUTHOR, fullName: 'A' }, issuedBy: null, revokedBy: null, ...data }),
      );
      prisma.feedPost.findMany.mockResolvedValue([{ id: 'p1' }]);
      prisma.feedComment.findMany.mockResolvedValue([{ id: 'c1' }]);
      prisma.feedPost.updateMany.mockResolvedValue({ count: 1 });
      prisma.feedComment.updateMany.mockResolvedValue({ count: 1 });

      const s = await service.createSanction(AUTHOR, { type: 'ban', reason: 'hate_speech', removeContent: true }, MOD);

      expect(s.endsAt).toBeNull();
      expect(prisma.feedPost.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'removed_by_admin' } }),
      );
      expect(prisma.feedPostReport.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { postId: { in: ['p1'] }, status: 'open' } }),
      );
      expect(prisma.moderationAction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'ban', targetType: 'user', targetId: AUTHOR }),
      });
    });

    it('revoking an active sanction records it and tells the user', async () => {
      prisma.communitySanction.findUnique.mockResolvedValue({
        id: 's1', userId: AUTHOR, type: 'suspension', revokedAt: null, startsAt: hoursAgo(1), endsAt: new Date(Date.now() + 3_600_000),
      });
      prisma.communitySanction.update.mockResolvedValue({
        id: 's1', userId: AUTHOR, type: 'suspension', reason: 'spam', note: null, startsAt: hoursAgo(1),
        endsAt: new Date(Date.now() + 3_600_000), revokedAt: new Date(), createdAt: new Date(),
        user: { id: AUTHOR, fullName: 'A' }, issuedBy: null, revokedBy: { id: MOD, fullName: 'Mod' },
      });
      const s = await service.revokeSanction('s1', 'appeal accepted', MOD);
      expect(s.active).toBe(false);
      expect(prisma.moderationAction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'revoke_sanction', note: 'appeal accepted' }),
      });
      expect(notificationCenter.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Your community access is restored' }),
      );
    });

    it('refuses to revoke twice', async () => {
      prisma.communitySanction.findUnique.mockResolvedValue({ id: 's1', userId: AUTHOR, revokedAt: new Date() });
      await expect(service.revokeSanction('s1', undefined, MOD)).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
