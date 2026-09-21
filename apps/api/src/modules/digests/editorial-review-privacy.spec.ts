import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { PrismaService } from '../../prisma/prisma.service';
import { PlatformGrantsService } from '../rbac/platform-grants.service';
import { DigestsService } from './digests.service';

/**
 * What the editorial review queue may and may not see.
 *
 * The admin queue is deliberately cross-tenant — one editorial team reviews a
 * corpus spanning every organization. That carve-out is about ORGANIZATIONS.
 * It must not extend to material a person owns and has kept private: per
 * CLAUDE.md a camera scan is `visibility = 'private'` always and never enters
 * the editorial corpus without consent and rights review.
 *
 * Measured on prod 2026-09-21 this excludes nothing — 30,084 digests, zero
 * with a non-null `user_id` — so these tests are the only thing standing
 * between the rule and the day camera-scan-to-digest gets real usage.
 *
 * The predicate is asserted at the QUERY level rather than by filtering
 * results, because that is where it is enforced: a route cannot reach around
 * a WHERE clause.
 */
describe('editorial review — user-owned private digests', () => {
  let service: DigestsService;
  let prisma: {
    digest: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      findUnique: jest.Mock;
    };
  };

  /** The predicate both call sites must carry. */
  const EXCLUSION = {
    NOT: { AND: [{ userId: { not: null } }, { visibility: 'private' }] },
  };

  beforeEach(async () => {
    prisma = {
      digest: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DigestsService,
        { provide: PrismaService, useValue: prisma },
        { provide: getQueueToken('digests'), useValue: { add: jest.fn() } },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        {
          provide: PlatformGrantsService,
          useValue: {
            hasPlatformPermission: jest.fn().mockResolvedValue(true),
            listUsersWithPlatformPermission: jest.fn().mockResolvedValue([]),
          },
        },
      ],
    }).compile();

    service = module.get<DigestsService>(DigestsService);
  });

  /** Does a WHERE clause actually exclude this row? Evaluates the predicate. */
  function isVisible(
    where: { AND?: unknown[]; NOT?: unknown },
    row: { userId: string | null; visibility: string },
  ): boolean {
    const clauses = [
      ...((where.AND as Array<{ NOT?: unknown }> | undefined) ?? []),
      ...(where.NOT ? [{ NOT: where.NOT }] : []),
    ];
    return clauses.every((clause) => {
      const not = clause.NOT as
        | { AND: [{ userId: { not: null } }, { visibility: string }] }
        | undefined;
      if (!not) return true;
      const excluded =
        row.userId !== null && row.visibility === not.AND[1].visibility;
      return !excluded;
    });
  }

  describe('getReviewQueue', () => {
    it('excludes a USER-OWNED PRIVATE digest from the queue', async () => {
      await service.getReviewQueue({});

      const args = (
        prisma.digest.findMany.mock.calls as Array<[{ where: { AND?: unknown[] } }]>
      )[0]![0];
      expect(args.where.AND).toEqual(
        expect.arrayContaining([expect.objectContaining(EXCLUSION)]),
      );
      expect(
        isVisible(args.where, { userId: 'user-1', visibility: 'private' }),
      ).toBe(false);
    });

    it('still shows an ORPHANED private digest (user_id NULL) — the 108 live rows', async () => {
      // All 108 private rows in the prod queue have user_id IS NULL. The
      // predicate needs BOTH conditions, so they keep working.
      await service.getReviewQueue({});

      const args = (
        prisma.digest.findMany.mock.calls as Array<[{ where: { AND?: unknown[] } }]>
      )[0]![0];
      expect(isVisible(args.where, { userId: null, visibility: 'private' })).toBe(
        true,
      );
    });

    it('still shows a PUBLIC_EDITORIAL digest from another organization', async () => {
      // This is the entire point of the cross-tenant carve-out.
      await service.getReviewQueue({});

      const args = (
        prisma.digest.findMany.mock.calls as Array<[{ where: { AND?: unknown[] } }]>
      )[0]![0];
      expect(
        isVisible(args.where, {
          userId: null,
          visibility: 'public_editorial',
        }),
      ).toBe(true);
      // …and a user-owned digest that is NOT private is still reviewable.
      expect(
        isVisible(args.where, {
          userId: 'user-1',
          visibility: 'public_editorial',
        }),
      ).toBe(true);
    });

    it('keeps the exclusion when other filters are applied', async () => {
      await service.getReviewQueue({
        reviewStatus: ['needs_human_review'],
        sourceOrigin: 'user_scan',
        assignedTo: 'unassigned',
      } as Parameters<DigestsService['getReviewQueue']>[0]);

      const args = (
        prisma.digest.findMany.mock.calls as Array<
          [{ where: { AND?: unknown[]; reviewStatus?: unknown } }]
        >
      )[0]![0];
      expect(args.where.AND).toEqual(
        expect.arrayContaining([expect.objectContaining(EXCLUSION)]),
      );
      expect(args.where.reviewStatus).toEqual({ in: ['needs_human_review'] });
    });
  });

  describe('findByIdAdmin', () => {
    it('404s on a USER-OWNED PRIVATE digest, and does not confirm it exists', async () => {
      // The exclusion is inside the WHERE, so Prisma returns null exactly as
      // it would for a digest that is not there. The caller cannot tell the
      // difference, and the message is the same 'Digest not found'.
      prisma.digest.findFirst.mockResolvedValue(null);

      await expect(service.findByIdAdmin('digest-private')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.findByIdAdmin('digest-private')).rejects.toThrow(
        'Digest not found',
      );

      const args = (
        prisma.digest.findFirst.mock.calls as Array<
          [{ where: { id: string; NOT?: unknown } }]
        >
      )[0]![0];
      expect(args.where).toEqual({ id: 'digest-private', ...EXCLUSION });
      expect(
        isVisible(args.where, { userId: 'user-1', visibility: 'private' }),
      ).toBe(false);
    });

    it('does not use findUnique, which cannot carry the exclusion', async () => {
      await service.findByIdAdmin('digest-1').catch(() => undefined);

      expect(prisma.digest.findUnique).not.toHaveBeenCalled();
      expect(prisma.digest.findFirst).toHaveBeenCalled();
    });

    it('still returns an ORPHANED private digest (user_id NULL)', async () => {
      prisma.digest.findFirst.mockResolvedValue({
        id: 'digest-orphan',
        userId: null,
        visibility: 'private',
      });

      await expect(service.findByIdAdmin('digest-orphan')).resolves.toMatchObject(
        { id: 'digest-orphan' },
      );

      const args = (
        prisma.digest.findFirst.mock.calls as Array<
          [{ where: { id: string; NOT?: unknown } }]
        >
      )[0]![0];
      expect(isVisible(args.where, { userId: null, visibility: 'private' })).toBe(
        true,
      );
    });

    it('still returns a PUBLIC_EDITORIAL digest from another organization', async () => {
      prisma.digest.findFirst.mockResolvedValue({
        id: 'digest-other-org',
        organizationId: 'org-someone-else',
        userId: null,
        visibility: 'public_editorial',
      });

      await expect(
        service.findByIdAdmin('digest-other-org'),
      ).resolves.toMatchObject({ organizationId: 'org-someone-else' });
    });
  });
});
