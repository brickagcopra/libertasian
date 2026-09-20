import { BadRequestException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, type TestingModule } from '@nestjs/testing';

import { PrismaService } from '../../prisma/prisma.service';
import { PermissionsService } from '../rbac/permissions.service';
import { DigestsService, REVIEWER_PERMISSION } from './digests.service';

/**
 * Who may be assigned a digest, and who the UI offers as an assignee, must be
 * the same answer (P6).
 *
 * Before this change the two disagreed structurally:
 *   - validateReviewerRole read the LEGACY organization_members.role column
 *     against a hardcoded ['admin','editor','reviewer'] list — a column the
 *     RBAC role APIs never write, so a role granted in the admin panel could
 *     never satisfy it and POST /admin/digests/batch-assign returned 400 for
 *     everyone outside that legacy set.
 *   - the assign dialog was fed from getReviewStats.perReviewer, which answers
 *     "who has review history" — a different question entirely.
 *
 * Both now resolve through PermissionsService.listPlatformMembersWithPermission
 * / hasPlatformPermission over the platform organization.
 */
describe('DigestsService — reviewer authority', () => {
  /** The single fixture both halves are asserted against. */
  const PLATFORM_STAFF = [
    {
      userId: 'u-admin',
      memberId: 'm-admin',
      fullName: 'Ada Admin',
      email: 'ada@libertasian.com',
    },
    {
      userId: 'u-reviewer',
      memberId: 'm-reviewer',
      fullName: 'Rey Reviewer',
      email: 'rey@libertasian.com',
    },
    {
      userId: 'u-editor',
      memberId: 'm-editor',
      fullName: null,
      email: 'edd@libertasian.com',
    },
  ];

  /** Everyone else on the system, including personal-workspace owners. */
  const NON_STAFF = ['u-owner-personal', 'u-student', 'u-stranger'];

  let service: DigestsService;
  let prisma: {
    digest: { groupBy: jest.Mock; updateMany: jest.Mock };
    digestReview: { groupBy: jest.Mock };
  };
  let permissions: {
    hasPlatformPermission: jest.Mock;
    listPlatformMembersWithPermission: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      digest: {
        groupBy: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      digestReview: { groupBy: jest.fn().mockResolvedValue([]) },
    };

    // One backing roster, two views of it — exactly as the real service
    // resolves both through getEffectivePermissions.
    const staffUserIds = new Set(PLATFORM_STAFF.map((s) => s.userId));
    permissions = {
      hasPlatformPermission: jest.fn((userId: string, code: string) =>
        Promise.resolve(code === REVIEWER_PERMISSION && staffUserIds.has(userId)),
      ),
      listPlatformMembersWithPermission: jest.fn((code: string) =>
        Promise.resolve(code === REVIEWER_PERMISSION ? PLATFORM_STAFF : []),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DigestsService,
        { provide: PrismaService, useValue: prisma },
        { provide: getQueueToken('digests'), useValue: { add: jest.fn() } },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: PermissionsService, useValue: permissions },
      ],
    }).compile();

    service = module.get<DigestsService>(DigestsService);
  });

  afterEach(() => jest.clearAllMocks());

  // -----------------------------------------------------------------------
  // listReviewers
  // -----------------------------------------------------------------------

  describe('listReviewers', () => {
    it('is sourced from the digests:review permission on the platform org', async () => {
      await service.listReviewers();

      expect(permissions.listPlatformMembersWithPermission).toHaveBeenCalledWith(
        REVIEWER_PERMISSION,
      );
    });

    it('returns user ids with assigned/reviewed counts', async () => {
      prisma.digest.groupBy.mockResolvedValue([
        { assignedReviewerUserId: 'u-admin', _count: { _all: 7 } },
      ]);
      prisma.digestReview.groupBy.mockResolvedValue([
        { reviewerUserId: 'u-admin', _count: { _all: 3 } },
        { reviewerUserId: 'u-reviewer', _count: { _all: 11 } },
      ]);

      const reviewers = await service.listReviewers();
      const byUser = Object.fromEntries(reviewers.map((r) => [r.userId, r]));

      expect(byUser['u-admin']).toMatchObject({ assigned: 7, reviewed: 3 });
      // Reviewed but never assigned — must still appear, with assigned 0.
      expect(byUser['u-reviewer']).toMatchObject({ assigned: 0, reviewed: 11 });
    });

    it('keeps staff with no history at all, at zero', async () => {
      const reviewers = await service.listReviewers();

      expect(reviewers).toHaveLength(3);
      expect(reviewers.every((r) => r.assigned === 0 && r.reviewed === 0)).toBe(
        true,
      );
    });

    it('returns an empty list — and issues no count queries — when there is no staff', async () => {
      permissions.listPlatformMembersWithPermission.mockResolvedValue([]);

      await expect(service.listReviewers()).resolves.toEqual([]);
      expect(prisma.digest.groupBy).not.toHaveBeenCalled();
    });

    it('ignores the null bucket in the assigned-by-reviewer grouping', async () => {
      // groupBy over a nullable column emits a row for unassigned digests.
      prisma.digest.groupBy.mockResolvedValue([
        { assignedReviewerUserId: null, _count: { _all: 9999 } },
        { assignedReviewerUserId: 'u-admin', _count: { _all: 2 } },
      ]);

      const reviewers = await service.listReviewers();

      expect(reviewers.find((r) => r.userId === 'u-admin')?.assigned).toBe(2);
      expect(reviewers.some((r) => r.assigned === 9999)).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // validateReviewerRole, via its two public callers
  // -----------------------------------------------------------------------

  describe('assignment validation', () => {
    it('rejects a non-staff assignee with 400 naming the permission', async () => {
      await expect(
        service.batchAssign({
          digestIds: ['d-1'],
          reviewerUserId: 'u-owner-personal',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      await expect(
        service.batchAssign({
          digestIds: ['d-1'],
          reviewerUserId: 'u-owner-personal',
        }),
      ).rejects.toThrow(REVIEWER_PERMISSION);
    });

    it('does not write when validation fails', async () => {
      await expect(
        service.batchAssign({ digestIds: ['d-1'], reviewerUserId: 'u-stranger' }),
      ).rejects.toThrow();

      expect(prisma.digest.updateMany).not.toHaveBeenCalled();
    });

    it('accepts platform staff', async () => {
      prisma.digest.updateMany.mockResolvedValue({ count: 2 });

      await expect(
        service.batchAssign({
          digestIds: ['d-1', 'd-2'],
          reviewerUserId: 'u-reviewer',
        }),
      ).resolves.toEqual({ processed: 2, digestIds: ['d-1', 'd-2'] });
    });

    it('checks the PLATFORM permission, not a role-name column', async () => {
      prisma.digest.updateMany.mockResolvedValue({ count: 1 });

      await service.batchAssign({
        digestIds: ['d-1'],
        reviewerUserId: 'u-editor',
      });

      expect(permissions.hasPlatformPermission).toHaveBeenCalledWith(
        'u-editor',
        REVIEWER_PERMISSION,
      );
    });
  });

  // -----------------------------------------------------------------------
  // P6 — the picker and the check agree, over one fixture
  // -----------------------------------------------------------------------

  it('every person listReviewers offers is accepted by an assignment, and no one else is', async () => {
    prisma.digest.updateMany.mockResolvedValue({ count: 1 });

    const offered = (await service.listReviewers()).map((r) => r.userId);

    for (const userId of offered) {
      await expect(
        service.batchAssign({ digestIds: ['d-1'], reviewerUserId: userId }),
      ).resolves.toMatchObject({ processed: 1 });
    }

    for (const userId of NON_STAFF) {
      expect(offered).not.toContain(userId);
      await expect(
        service.batchAssign({ digestIds: ['d-1'], reviewerUserId: userId }),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  });
});
