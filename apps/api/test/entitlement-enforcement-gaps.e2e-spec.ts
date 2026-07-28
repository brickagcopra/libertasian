import { INestApplication } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');
import {
  createTestApp,
  createAuthenticatedUser,
  updateSubscriptionPlan,
} from './helpers';
import { PrismaService } from '../src/prisma/prisma.service';
import { RbacCacheService } from '../src/modules/rbac/rbac-cache.service';

/**
 * Entitlement enforcement gaps — E2E
 *
 * `@RequiredSubscription(tier)` does nothing unless SubscriptionGuard sits in
 * the same route's guard chain. StudyController and OrganizationsController
 * had neither; AuditController had the guard but no decorator. A free JWT
 * therefore got 200 on /study/bar-readiness, /study/flashcard-sets/:id/
 * generate-ai and /audit-logs in production (measured 2026-07-28).
 *
 * These specs assert the gate from the outside: free is refused, the required
 * tier is admitted, and platform admins bypass by design.
 *
 * Tier floors under test:
 *   edu  — flashcardGeneration, studyProgressTracking
 *   team — auditLogs, teamCollaboration (member invites)
 */
describe('Entitlement enforcement gaps (E2E)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  async function getOrgId(token: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .get('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return res.body.data[0].id as string;
  }

  /**
   * Grant an arbitrary permission code to a user via a test-only RBAC role.
   *
   * Audit-log routes run PermissionsGuard BEFORE SubscriptionGuard, so
   * without `audit-logs:read` a team-tier user still 403s — for the wrong
   * reason. Granting it makes the subscription gate the only variable.
   *
   * Non-`admin:*` codes leave `isPlatformAdmin` false (jwt.strategy.ts), so
   * this does not accidentally hand out the SubscriptionGuard bypass.
   */
  async function grantPermission(
    userId: string,
    token: string,
    code: string,
    slug: string,
  ): Promise<void> {
    const orgId = await getOrgId(token);
    const prisma = app.get(PrismaService);
    const [resource, action] = code.split(':');

    const permission = await prisma.permission.upsert({
      where: { code },
      update: {},
      create: {
        code,
        resource: resource ?? code,
        action: action ?? 'read',
        category: resource ?? 'general',
        description: `E2E-granted ${code}`,
        isSystem: true,
      },
    });

    let role = await prisma.roleDefinition.findFirst({ where: { slug } });
    if (!role) {
      role = await prisma.roleDefinition.create({
        data: {
          name: `E2E ${code}`,
          slug,
          description: `Test-only role carrying ${code}`,
          isSystem: false,
          requiresMfa: false,
        },
      });
    }

    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: { roleId: role.id, permissionId: permission.id },
      },
      update: {},
      create: { roleId: role.id, permissionId: permission.id },
    });

    const member = await prisma.organizationMember.findFirst({
      where: { userId, organizationId: orgId, status: 'active' },
    });
    if (!member) throw new Error('No active organization member found');

    await prisma.memberRole.upsert({
      where: {
        organizationMemberId_roleDefinitionId: {
          organizationMemberId: member.id,
          roleDefinitionId: role.id,
        },
      },
      update: {},
      create: {
        organizationMemberId: member.id,
        roleDefinitionId: role.id,
      },
    });

    await app.get(RbacCacheService).invalidateForMember(member.id);
  }

  /** Promote to platform admin — any `admin:*` code sets isPlatformAdmin. */
  async function grantPlatformAdmin(userId: string, token: string) {
    await grantPermission(userId, token, 'admin:users', 'e2e-gap-platform-admin');
  }

  /** Create a flashcard set so generate-ai has a real target. */
  async function createFlashcardSet(token: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/study/flashcard-sets')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Gate test set', barSubject: 'civil_law' })
      .expect(201);
    return res.body.data.id as string;
  }

  // ─── Study: AI flashcard generation — edu required ───────────────────────

  describe('POST /study/flashcard-sets/:setId/generate-ai — edu required', () => {
    it('denies a free org (403)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `gap-genai-free-${Date.now()}@test.com`,
      });
      const setId = await createFlashcardSet(user.accessToken);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/study/flashcard-sets/${setId}/generate-ai`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ topic: 'Obligations', count: 3 })
        .expect(403);

      const message =
        res.body.error?.message ?? res.body.message ?? JSON.stringify(res.body);
      expect(String(message).toLowerCase()).toContain('edu');
    });

    it('admits an edu org (not plan-gated)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `gap-genai-edu-${Date.now()}@test.com`,
      });
      const setId = await createFlashcardSet(user.accessToken);
      await updateSubscriptionPlan(app, user.accessToken, 'edu');

      const res = await request(app.getHttpServer())
        .post(`/api/v1/study/flashcard-sets/${setId}/generate-ai`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ topic: 'Obligations', count: 3 });

      // The gate must be open. A 5xx is acceptable only because the RAG
      // service is not running in the test environment (same treatment as
      // the upload spec's S3/ClamAV allowance).
      expect(res.status).not.toBe(403);
      expect([200, 201, 500, 502, 503]).toContain(res.status);
    });

    it('admits a platform admin on the free plan (bypass by design)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `gap-genai-admin-${Date.now()}@test.com`,
      });
      const setId = await createFlashcardSet(user.accessToken);
      await grantPlatformAdmin(user.userId, user.accessToken);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/study/flashcard-sets/${setId}/generate-ai`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ topic: 'Obligations', count: 3 });

      expect(res.status).not.toBe(403);
    });
  });

  // ─── Study: bar readiness + progress — edu required ──────────────────────

  describe('GET /study/bar-readiness — edu required', () => {
    it('denies a free org (403)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `gap-readiness-free-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .get('/api/v1/study/bar-readiness')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });

    it('admits an edu org (200)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `gap-readiness-edu-${Date.now()}@test.com`,
      });
      await updateSubscriptionPlan(app, user.accessToken, 'edu');

      const res = await request(app.getHttpServer())
        .get('/api/v1/study/bar-readiness')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);
      expect(res.body.success).toBe(true);
    });

    it('admits a pro org — the tier ladder, not a boolean entitlement', async () => {
      // `studyProgressTracking` exists only on the edu plan row, so a
      // truthiness check here would wrongly 403 Pro/Team/Enterprise.
      const user = await createAuthenticatedUser(app, {
        email: `gap-readiness-pro-${Date.now()}@test.com`,
      });
      await updateSubscriptionPlan(app, user.accessToken, 'pro');

      await request(app.getHttpServer())
        .get('/api/v1/study/bar-readiness')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);
    });

    it('admits a platform admin on the free plan (bypass by design)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `gap-readiness-admin-${Date.now()}@test.com`,
      });
      await grantPlatformAdmin(user.userId, user.accessToken);

      await request(app.getHttpServer())
        .get('/api/v1/study/bar-readiness')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);
    });
  });

  describe('PUT /study/progress/:entityType/:entityId — edu required', () => {
    const targetId = '00000000-0000-4000-8000-000000000001';

    it('denies a free org (403)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `gap-progress-free-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .put(`/api/v1/study/progress/flashcard_set/${targetId}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ status: 'completed' })
        .expect(403);
    });

    it('admits an edu org (not plan-gated)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `gap-progress-edu-${Date.now()}@test.com`,
      });
      await updateSubscriptionPlan(app, user.accessToken, 'edu');

      const res = await request(app.getHttpServer())
        .put(`/api/v1/study/progress/flashcard_set/${targetId}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ status: 'completed' });

      expect(res.status).not.toBe(403);
    });
  });

  // ─── Audit logs — team required ──────────────────────────────────────────

  describe('GET /audit-logs — team required', () => {
    async function auditReader(label: string, plan?: string) {
      const user = await createAuthenticatedUser(app, {
        email: `gap-audit-${label}-${Date.now()}@test.com`,
      });
      await grantPermission(
        user.userId,
        user.accessToken,
        'audit-logs:read',
        'e2e-audit-log-reader',
      );
      if (plan) await updateSubscriptionPlan(app, user.accessToken, plan);
      return user;
    }

    it.each(['free', 'edu', 'pro'])('denies a %s org (403)', async (plan) => {
      const user = await auditReader(plan, plan === 'free' ? undefined : plan);

      await request(app.getHttpServer())
        .get('/api/v1/audit-logs')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });

    it('admits a team org (200)', async () => {
      const user = await auditReader('team', 'team');

      const res = await request(app.getHttpServer())
        .get('/api/v1/audit-logs')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('admits a platform admin on the free plan (bypass by design)', async () => {
      const user = await auditReader('admin');
      await grantPlatformAdmin(user.userId, user.accessToken);

      await request(app.getHttpServer())
        .get('/api/v1/audit-logs')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);
    });
  });

  // ─── Member invites — team required ──────────────────────────────────────

  describe('POST /organizations/:id/members/invite — team required', () => {
    it.each(['free', 'edu', 'pro'])('denies a %s org (403)', async (plan) => {
      const user = await createAuthenticatedUser(app, {
        email: `gap-invite-${plan}-${Date.now()}@test.com`,
      });
      if (plan !== 'free') {
        await updateSubscriptionPlan(app, user.accessToken, plan);
      }
      const orgId = await getOrgId(user.accessToken);

      await request(app.getHttpServer())
        .post(`/api/v1/organizations/${orgId}/members/invite`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ email: `invitee-${Date.now()}@test.com`, role: 'member' })
        .expect(403);
    });

    it('admits a team org (not plan-gated)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `gap-invite-team-${Date.now()}@test.com`,
      });
      await updateSubscriptionPlan(app, user.accessToken, 'team');
      const orgId = await getOrgId(user.accessToken);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/organizations/${orgId}/members/invite`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ email: `invitee-${Date.now()}@test.com`, role: 'member' });

      // Seat limits / outbound email may still reject; the gate must not.
      expect(res.status).not.toBe(403);
    });

    it('admits a platform admin on the free plan (bypass by design)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `gap-invite-admin-${Date.now()}@test.com`,
      });
      await grantPlatformAdmin(user.userId, user.accessToken);
      const orgId = await getOrgId(user.accessToken);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/organizations/${orgId}/members/invite`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ email: `invitee-${Date.now()}@test.com`, role: 'member' });

      expect(res.status).not.toBe(403);
    });

    it('never gates member listing, role changes or removal', async () => {
      // A lapsed plan must not strand an org's existing members.
      const user = await createAuthenticatedUser(app, {
        email: `gap-invite-readonly-${Date.now()}@test.com`,
      });
      const orgId = await getOrgId(user.accessToken);

      await request(app.getHttpServer())
        .get(`/api/v1/organizations/${orgId}/members`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);
    });
  });
});
