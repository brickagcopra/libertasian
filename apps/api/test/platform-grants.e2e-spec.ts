import { INestApplication } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');

import { createTestApp, createAuthenticatedUser } from './helpers';
import { PrismaService } from '../src/prisma/prisma.service';
import { PlatformGrantsService } from '../src/modules/rbac/platform-grants.service';
import { RbacCacheService } from '../src/modules/rbac/rbac-cache.service';

/**
 * Platform capability, end to end.
 *
 * The two facts this file exists to pin down:
 *
 *  1. An ordinary self-registered user — `owner` on their own personal
 *     workspace — gets 403 on the review queue. Before migration
 *     20260920140000 the SYSTEM owner role carried `digests:review`, and
 *     DigestsAdminController accepts {digests:review, admin:review-queue}
 *     with mode 'any', so every signup got HTTP 200 (verified on prod with
 *     john@gmail.com, 2026-09-21).
 *
 *  2. A platform reviewer whose JWT organization is their own personal
 *     workspace CAN be assigned a digest. This is the case no org-scoped
 *     model can express: login picks the oldest membership and there is no
 *     org-switch endpoint, so a staff member's JWT org is permanently their
 *     personal workspace.
 *
 * Note on the acting admin below: DigestsAdminController's guard chain is
 * JwtAuthGuard + MfaGuard + TenantGuard + PermissionsGuard, and this PR
 * deliberately does not touch it, so REACHING /admin/digests/* still needs a
 * TENANT permission. The actor is therefore linked to the system admin role
 * the way migration 20260702120000 links the allowlist. The ASSIGNEE holds
 * nothing but a platform grant — which is the thing under test. Repointing
 * that controller at platform capability is the separate follow-up the brief
 * scopes out; `platformStaffCannotYetReachAdminDigests` below pins the
 * current behaviour so the follow-up has something to flip.
 *
 * Requires PostgreSQL and Redis, and a database with the migration applied.
 */
describe('Platform role grants (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let grants: PlatformGrantsService;
  let cache: RbacCacheService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    grants = app.get(PlatformGrantsService);
    cache = app.get(RbacCacheService);
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  /**
   * Link a user's personal-workspace membership to a SYSTEM role.
   *
   * This is what migration 20260611120000_backfill_legacy_member_roles did for
   * every pre-existing membership, and what the allowlist migration
   * 20260702120000 does for platform admins. Registration itself writes only
   * the legacy `organization_members.role` string, so without this a fresh
   * signup resolves to ZERO tenant permissions and would 403 below for an
   * unrelated reason — which would make the review-queue assertion prove
   * nothing.
   */
  async function linkTenantRole(userId: string, slug: string): Promise<void> {
    const membership = await prisma.organizationMember.findFirst({
      where: { userId, status: 'active' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!membership) throw new Error(`No membership for user ${userId}`);
    const role = await systemRole(slug);
    await prisma.memberRole.upsert({
      where: {
        organizationMemberId_roleDefinitionId: {
          organizationMemberId: membership.id,
          roleDefinitionId: role.id,
        },
      },
      create: {
        organizationMemberId: membership.id,
        roleDefinitionId: role.id,
      },
      update: {},
    });
    await cache.invalidateForMember(membership.id);
  }

  /** The SYSTEM role definition for a slug (organization_id IS NULL). */
  async function systemRole(slug: string) {
    const role = await prisma.roleDefinition.findFirst({
      where: { slug, isSystem: true, organizationId: null },
      select: { id: true, slug: true },
    });
    if (!role) {
      throw new Error(
        `System role "${slug}" not seeded — run pnpm --filter api seed:rbac`,
      );
    }
    return role;
  }

  describe('the john@gmail.com hole', () => {
    it('an ordinary owner gets 403 on GET /admin/digests/review-queue', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `plat-owner-${Date.now()}@libertasian-test.com`,
      });
      // Reproduce john@gmail.com exactly: a personal workspace whose
      // membership IS linked to the system owner role. Without this the 403
      // below would only prove that registration writes no member_roles row.
      await linkTenantRole(user.userId, 'owner');

      const perms = await request(app.getHttpServer())
        .get('/api/v1/rbac/me/permissions')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);
      // The owner role still works — it just no longer confers review authority.
      expect(perms.body.data.tenantPermissions).toEqual(
        expect.arrayContaining(['documents:read', 'digests:create']),
      );
      expect(perms.body.data.tenantPermissions).not.toContain('digests:review');
      expect(perms.body.data.tenantPermissions).not.toContain('admin:review-queue');

      await request(app.getHttpServer())
        .get('/api/v1/admin/digests/review-queue')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });

    it('the SYSTEM owner role no longer carries digests:review', async () => {
      const owner = await systemRole('owner');
      const held = await prisma.rolePermission.findMany({
        where: { roleId: owner.id, permission: { code: 'digests:review' } },
      });
      expect(held).toEqual([]);
    });

    it('an ordinary owner is not platform staff and holds nothing', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `plat-nostaff-${Date.now()}@libertasian-test.com`,
      });
      await linkTenantRole(user.userId, 'owner');

      const res = await request(app.getHttpServer())
        .get('/api/v1/rbac/me/permissions')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(res.body.data.isPlatformStaff).toBe(false);
      expect(res.body.data.platformPermissions).toEqual([]);
      // …while their own workspace permissions are intact.
      expect(res.body.data.tenantPermissions).toEqual(
        expect.arrayContaining(['documents:read']),
      );
    });
  });

  describe('a platform grant, with no organization anywhere', () => {
    it('platformStaffCannotYetReachAdminDigests — pins the scoped-out gap', async () => {
      // A platform reviewer holds digests:review as PLATFORM capability, but
      // DigestsAdminController is still guarded by PermissionsGuard, which
      // resolves TENANT permissions from the caller's organization membership.
      // This PR deliberately does not touch that guard chain, so the reviewer
      // is still refused at the door even though the platform model now knows
      // perfectly well who they are.
      //
      // This test exists to make that gap visible and to give the follow-up a
      // failing assertion to flip. It is NOT the desired end state.
      const user = await createAuthenticatedUser(app, {
        email: `plat-reviewer-${Date.now()}@libertasian-test.com`,
      });
      const reviewer = await systemRole('reviewer');
      await prisma.platformRoleGrant.create({
        data: { userId: user.userId, roleDefinitionId: reviewer.id },
      });
      await cache.invalidatePlatformForUser(user.userId);

      try {
        // The platform model says yes…
        const me = await request(app.getHttpServer())
          .get('/api/v1/rbac/me/permissions')
          .set('Authorization', `Bearer ${user.accessToken}`)
          .expect(200);
        expect(me.body.data.platformPermissions).toContain('digests:review');
        expect(me.body.data.isPlatformStaff).toBe(true);

        // …and the untouched tenant guard chain still says no.
        await request(app.getHttpServer())
          .get('/api/v1/admin/digests/review-queue')
          .set('Authorization', `Bearer ${user.accessToken}`)
          .expect(403);
      } finally {
        await prisma.platformRoleGrant.deleteMany({
          where: { userId: user.userId },
        });
        await cache.invalidatePlatformForUser(user.userId);
      }
    });

    it('a platform reviewer can be ASSIGNED a digest', async () => {
      const admin = await createAuthenticatedUser(app, {
        email: `plat-admin-${Date.now()}@libertasian-test.com`,
      });
      const reviewerUser = await createAuthenticatedUser(app, {
        email: `plat-assignee-${Date.now()}@libertasian-test.com`,
      });

      const adminRole = await systemRole('admin');
      const reviewerRole = await systemRole('reviewer');

      // The ACTOR needs tenant authority to get through
      // DigestsAdminController's untouched guard chain — the same link
      // migration 20260702120000 makes for the platform-admin allowlist.
      await linkTenantRole(admin.userId, 'admin');

      // The ASSIGNEE gets nothing but a platform grant. No membership
      // anywhere confers review authority on them; their JWT organization is
      // their own personal workspace. This is the case under test.
      await prisma.platformRoleGrant.createMany({
        data: [
          { userId: admin.userId, roleDefinitionId: adminRole.id },
          { userId: reviewerUser.userId, roleDefinitionId: reviewerRole.id },
        ],
      });
      await cache.invalidatePlatformForUser(admin.userId);
      await cache.invalidatePlatformForUser(reviewerUser.userId);

      // A digest in the admin's own workspace is enough — assignment is a
      // cross-tenant admin operation either way.
      const orgRes = await request(app.getHttpServer())
        .get('/api/v1/organizations/me')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);
      const organizationId = orgRes.body.data[0].id as string;

      const digest = await prisma.digest.create({
        data: {
          organizationId,
          userId: admin.userId,
          title: 'Assignment target',
          digestType: 'case',
          sourceOrigin: 'admin_generated',
          visibility: 'org',
          reviewStatus: 'needs_human_review',
        },
        select: { id: true },
      });

      try {
        // The reviewer appears in the dropdown…
        const reviewers = await request(app.getHttpServer())
          .get('/api/v1/admin/digests/reviewers')
          .set('Authorization', `Bearer ${admin.accessToken}`)
          .expect(200);
        expect(
          (reviewers.body.data as Array<{ userId: string }>).map((r) => r.userId),
        ).toContain(reviewerUser.userId);

        // …and the assignment that used to 400 now succeeds.
        await request(app.getHttpServer())
          .post(`/api/v1/admin/digests/${digest.id}/assign`)
          .set('Authorization', `Bearer ${admin.accessToken}`)
          .send({ reviewerUserId: reviewerUser.userId })
          .expect(201);

        const updated = await prisma.digest.findUnique({
          where: { id: digest.id },
          select: { assignedReviewerUserId: true },
        });
        // A USER id, not a member id.
        expect(updated?.assignedReviewerUserId).toBe(reviewerUser.userId);

        // And batch-assign — the endpoint that returned 400 on prod.
        await request(app.getHttpServer())
          .post('/api/v1/admin/digests/batch-assign')
          .set('Authorization', `Bearer ${admin.accessToken}`)
          .send({
            digestIds: [digest.id],
            reviewerUserId: reviewerUser.userId,
          })
          .expect(201);
      } finally {
        await prisma.digest.delete({ where: { id: digest.id } });
        await prisma.platformRoleGrant.deleteMany({
          where: { userId: { in: [admin.userId, reviewerUser.userId] } },
        });
        await cache.invalidatePlatformForUser(admin.userId);
        await cache.invalidatePlatformForUser(reviewerUser.userId);
      }
    });

    it('refuses to assign a digest to a user with no platform grant', async () => {
      const admin = await createAuthenticatedUser(app, {
        email: `plat-admin2-${Date.now()}@libertasian-test.com`,
      });
      const outsider = await createAuthenticatedUser(app, {
        email: `plat-outsider-${Date.now()}@libertasian-test.com`,
      });

      const adminRole = await systemRole('admin');
      await linkTenantRole(admin.userId, 'admin');
      await prisma.platformRoleGrant.create({
        data: { userId: admin.userId, roleDefinitionId: adminRole.id },
      });
      await cache.invalidatePlatformForUser(admin.userId);

      try {
        const res = await request(app.getHttpServer())
          .post('/api/v1/admin/digests/batch-assign')
          .set('Authorization', `Bearer ${admin.accessToken}`)
          .send({
            digestIds: ['00000000-0000-4000-8000-000000000000'],
            reviewerUserId: outsider.userId,
          })
          .expect(400);

        expect(res.body.message).toMatch(/digests:review/);
      } finally {
        await prisma.platformRoleGrant.deleteMany({
          where: { userId: admin.userId },
        });
        await cache.invalidatePlatformForUser(admin.userId);
      }
    });
  });

  describe('the staff API', () => {
    it('denies a user without platform-staff:manage', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `plat-nostaffapi-${Date.now()}@libertasian-test.com`,
      });

      await request(app.getHttpServer())
        .get('/api/v1/platform/staff')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });

    it('refuses privilege escalation over HTTP with 403', async () => {
      // A staff member who can administer staff but is not an admin must not
      // be able to mint an admin.
      const staffer = await createAuthenticatedUser(app, {
        email: `plat-staffer-${Date.now()}@libertasian-test.com`,
      });
      const target = await createAuthenticatedUser(app, {
        email: `plat-escalate-${Date.now()}@libertasian-test.com`,
      });

      const limited = await prisma.roleDefinition.create({
        data: {
          organizationId: null,
          name: `Staff Clerk ${Date.now()}`,
          slug: `staff-clerk-${Date.now()}`,
          isSystem: false,
        },
        select: { id: true },
      });
      const staffPerm = await prisma.permission.findUnique({
        where: { code: 'platform-staff:manage' },
        select: { id: true },
      });
      await prisma.rolePermission.create({
        data: { roleId: limited.id, permissionId: staffPerm!.id },
      });
      await prisma.platformRoleGrant.create({
        data: { userId: staffer.userId, roleDefinitionId: limited.id },
      });
      await cache.invalidatePlatformForUser(staffer.userId);

      const adminRole = await systemRole('admin');

      try {
        const res = await request(app.getHttpServer())
          .post(`/api/v1/platform/staff/${target.userId}/roles`)
          .set('Authorization', `Bearer ${staffer.accessToken}`)
          .send({ roleDefinitionId: adminRole.id })
          .expect(403);

        expect(res.body.message).toMatch(/escalation/i);

        // Nothing was written.
        const written = await prisma.platformRoleGrant.findMany({
          where: { userId: target.userId },
        });
        expect(written).toEqual([]);
      } finally {
        await prisma.platformRoleGrant.deleteMany({
          where: { roleDefinitionId: limited.id },
        });
        await prisma.rolePermission.deleteMany({ where: { roleId: limited.id } });
        await prisma.roleDefinition.delete({ where: { id: limited.id } });
        await cache.invalidatePlatformForUser(staffer.userId);
      }
    });
  });

  describe('expiry', () => {
    it('an expired grant confers nothing', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `plat-expired-${Date.now()}@libertasian-test.com`,
      });
      const reviewerRole = await systemRole('reviewer');

      await prisma.platformRoleGrant.create({
        data: {
          userId: user.userId,
          roleDefinitionId: reviewerRole.id,
          expiresAt: new Date(Date.now() - 60_000),
        },
      });
      await cache.invalidatePlatformForUser(user.userId);

      try {
        expect(await grants.getPlatformPermissions(user.userId)).toEqual([]);

        await request(app.getHttpServer())
          .get('/api/v1/admin/digests/review-queue')
          .set('Authorization', `Bearer ${user.accessToken}`)
          .expect(403);
      } finally {
        await prisma.platformRoleGrant.deleteMany({
          where: { userId: user.userId },
        });
        await cache.invalidatePlatformForUser(user.userId);
      }
    });
  });
});
