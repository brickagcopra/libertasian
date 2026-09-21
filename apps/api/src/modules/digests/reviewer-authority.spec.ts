import { BadRequestException } from '@nestjs/common';

import { DigestsService } from './digests.service';

/**
 * Who may review a digest.
 *
 * Two questions used to be answered by two unrelated queries:
 *  - validateReviewerRole() read the LEGACY `organization_members.role` string
 *    column against a hardcoded ['admin','editor','reviewer']. The RBAC APIs
 *    write `member_roles` and never touch that column, so granting someone the
 *    reviewer role in a panel could never satisfy it — every batch-assign to a
 *    real reviewer returned 400.
 *  - the assign dropdown was built from getReviewStats().perReviewer, which
 *    lists who has review HISTORY.
 *
 * Both now resolve from the `digests:review` PLATFORM permission, so the list
 * and the validator cannot disagree (P6).
 */

interface Fixture {
  /** userId → holds digests:review as a platform capability */
  permitted: Record<string, boolean>;
  /** rows getReviewStats' workload query would return */
  workload: Array<{
    reviewer_user_id: string;
    reviewer_name: string | null;
    assigned: bigint;
    reviewed: bigint;
  }>;
}

function buildService(fixture: Fixture) {
  const permittedIds = Object.entries(fixture.permitted)
    .filter(([, v]) => v)
    .map(([id]) => id);

  const platformGrants = {
    hasPlatformPermission: jest
      .fn()
      .mockImplementation((userId: string, code: string) =>
        Promise.resolve(code === 'digests:review' && !!fixture.permitted[userId]),
      ),
    listUsersWithPlatformPermission: jest
      .fn()
      .mockImplementation((code: string) =>
        Promise.resolve(
          code === 'digests:review'
            ? permittedIds.map((id) => ({
                userId: id,
                fullName: `User ${id}`,
                email: `${id}@libertasian.com`,
              }))
            : [],
        ),
      ),
  };

  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue(fixture.workload),
    digest: {
      findUnique: jest.fn().mockResolvedValue({ id: 'digest-1' }),
      update: jest.fn().mockImplementation(({ data }: { data: unknown }) =>
        Promise.resolve({ id: 'digest-1', ...(data as object) }),
      ),
      updateMany: jest.fn().mockResolvedValue({ count: 2 }),
    },
  };

  const service = new DigestsService(
    prisma as never,
    { add: jest.fn() } as never,
    { emit: jest.fn() } as never,
    platformGrants as never,
  );

  return { service, prisma, platformGrants };
}

const NO_HISTORY: Fixture['workload'] = [];

describe('digest reviewer authority', () => {
  it('lists everyone holding digests:review, with zeroed counts when they have no history', async () => {
    const { service } = buildService({
      permitted: { 'u-reviewer': true, 'u-editor': true, 'u-owner': false },
      workload: NO_HISTORY,
    });

    const reviewers = await service.listReviewers();

    expect(reviewers).toEqual([
      {
        userId: 'u-reviewer',
        fullName: 'User u-reviewer',
        email: 'u-reviewer@libertasian.com',
        assigned: 0,
        reviewed: 0,
      },
      {
        userId: 'u-editor',
        fullName: 'User u-editor',
        email: 'u-editor@libertasian.com',
        assigned: 0,
        reviewed: 0,
      },
    ]);
  });

  it('LEFT JOINs the workload counts rather than filtering by them', async () => {
    const { service } = buildService({
      permitted: { 'u-veteran': true, 'u-new': true },
      workload: [
        {
          reviewer_user_id: 'u-veteran',
          reviewer_name: 'Veteran',
          assigned: 12n,
          reviewed: 30n,
        },
        // A user with history who NO LONGER holds the permission must not
        // appear — this is the difference from getReviewStats().perReviewer.
        {
          reviewer_user_id: 'u-former',
          reviewer_name: 'Former',
          assigned: 4n,
          reviewed: 9n,
        },
      ],
    });

    const reviewers = await service.listReviewers();

    expect(reviewers.map((r) => r.userId).sort()).toEqual(['u-new', 'u-veteran']);
    expect(reviewers.find((r) => r.userId === 'u-veteran')).toMatchObject({
      assigned: 12,
      reviewed: 30,
    });
    expect(reviewers.find((r) => r.userId === 'u-new')).toMatchObject({
      assigned: 0,
      reviewed: 0,
    });
  });

  it('P6: the reviewer list and the assignment validator agree on one fixture', async () => {
    const fixture: Fixture = {
      permitted: {
        'u-reviewer': true,
        'u-editor': true,
        'u-owner': false,
        'u-former': false,
      },
      workload: [
        {
          reviewer_user_id: 'u-former',
          reviewer_name: 'Former',
          assigned: 4n,
          reviewed: 9n,
        },
      ],
    };
    const { service } = buildService(fixture);

    const listed = new Set(
      (await service.listReviewers()).map((r) => r.userId),
    );

    for (const userId of Object.keys(fixture.permitted)) {
      const assignable = await service
        .assignReviewer('digest-1', { reviewerUserId: userId })
        .then(() => true)
        .catch(() => false);

      // The dropdown must never offer someone the validator will reject, and
      // must never hide someone the validator would accept.
      expect({ userId, listed: listed.has(userId) }).toEqual({
        userId,
        listed: assignable,
      });
    }
  });

  it('refuses an assignment to a user without the permission, naming the permission', async () => {
    const { service } = buildService({
      permitted: { 'u-owner': false },
      workload: NO_HISTORY,
    });

    await expect(
      service.assignReviewer('digest-1', { reviewerUserId: 'u-owner' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.assignReviewer('digest-1', { reviewerUserId: 'u-owner' }),
    ).rejects.toThrow(/"digests:review" platform permission/);
  });

  it('batchAssign runs the same validation as the single assign', async () => {
    const { service } = buildService({
      permitted: { 'u-owner': false, 'u-reviewer': true },
      workload: NO_HISTORY,
    });

    await expect(
      service.batchAssign({
        digestIds: ['d-1', 'd-2'],
        reviewerUserId: 'u-owner',
      }),
    ).rejects.toThrow(/"digests:review" platform permission/);

    await expect(
      service.batchAssign({
        digestIds: ['d-1', 'd-2'],
        reviewerUserId: 'u-reviewer',
      }),
    ).resolves.toMatchObject({ processed: 2 });
  });

  it('never consults organization_members.role', async () => {
    // The legacy column is exactly what made a panel-granted reviewer role
    // invisible to the assignment path.
    const { service, prisma } = buildService({
      permitted: { 'u-reviewer': true },
      workload: NO_HISTORY,
    });

    await service.assignReviewer('digest-1', { reviewerUserId: 'u-reviewer' });

    expect(prisma).not.toHaveProperty('organizationMember');
  });
});
