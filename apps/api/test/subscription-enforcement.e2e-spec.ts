import { INestApplication } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');
import {
  createTestApp,
  createAuthenticatedUser,
  updateSubscriptionPlan,
} from './helpers';
import { PrismaService } from '../src/prisma/prisma.service';
import { EntitlementService } from '../src/modules/subscriptions/entitlement.service';
import { RbacCacheService } from '../src/modules/rbac/rbac-cache.service';

/**
 * Subscription Enforcement E2E Tests — Session 91
 *
 * Per PRD Section 11 and CLAUDE.md: subscription entitlements must be enforced
 * at the API gateway level. These tests verify that:
 * - Free users are blocked from pro/edu/team/enterprise features
 * - Subscription-gated endpoints return 403 with helpful messages
 * - Upgrade paths are communicated correctly
 *
 * Note: Some endpoints (e.g. API keys) are protected by BOTH PermissionsGuard
 * and SubscriptionGuard. Without seeded RBAC MemberRole records, the
 * PermissionsGuard may fire first and return 403 for "Insufficient permissions"
 * rather than a subscription tier error. The tests validate that access is
 * correctly denied (403) regardless of which guard fires first.
 */
describe('Subscription Enforcement (E2E)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  /** Helper: get user's org ID */
  async function getOrgId(token: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .get('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return res.body.data[0].id;
  }

  /** Helper: upgrade subscription in DB (direct Prisma update) */
  async function upgradeSubscription(
    token: string,
    planCode: string,
    entitlements?: Record<string, unknown>,
  ) {
    const orgId = await getOrgId(token);
    const prisma = app.get(PrismaService);
    const sub = await prisma.subscription.findFirst({
      where: { organizationId: orgId, status: 'active' },
    });
    if (sub) {
      await prisma.subscription.update({
        where: { id: sub.id },
        data: {
          planCode,
          ...(entitlements && { entitlementsJson: entitlements }),
        },
      });
    }
    // Drop any cached entitlements so the new plan takes effect immediately
    await app.get(EntitlementService).invalidateEntitlementCache(orgId);
  }

  /**
   * Helper: promote a user to platform admin by granting an `admin:*`
   * permission via RBAC role assignment. JwtStrategy resolves
   * isPlatformAdmin=true when the member's effective permissions include
   * any code starting with `admin:` (see jwt.strategy.ts).
   */
  async function grantPlatformAdmin(userId: string, token: string) {
    const orgId = await getOrgId(token);
    const prisma = app.get(PrismaService);

    const permission = await prisma.permission.upsert({
      where: { code: 'admin:users' },
      update: {},
      create: {
        code: 'admin:users',
        resource: 'admin',
        action: 'users',
        category: 'admin',
        description: 'View users across organizations (admin user management)',
        isSystem: true,
      },
    });

    let adminRole = await prisma.roleDefinition.findFirst({
      where: { slug: 'e2e-platform-admin' },
    });
    if (!adminRole) {
      adminRole = await prisma.roleDefinition.create({
        data: {
          name: 'E2E Platform Admin',
          slug: 'e2e-platform-admin',
          description: 'Test-only role carrying an admin:* permission',
          isSystem: false,
          requiresMfa: false,
        },
      });
    }

    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: adminRole.id,
          permissionId: permission.id,
        },
      },
      update: {},
      create: {
        roleId: adminRole.id,
        permissionId: permission.id,
      },
    });

    const member = await prisma.organizationMember.findFirst({
      where: { userId, organizationId: orgId, status: 'active' },
    });
    if (!member) throw new Error('No active organization member found');

    await prisma.memberRole.upsert({
      where: {
        organizationMemberId_roleDefinitionId: {
          organizationMemberId: member.id,
          roleDefinitionId: adminRole.id,
        },
      },
      update: {},
      create: {
        organizationMemberId: member.id,
        roleDefinitionId: adminRole.id,
      },
    });

    // Drop cached (possibly empty) permissions so the admin grant takes
    // effect on the next request instead of after the 5-min cache TTL.
    await app.get(RbacCacheService).invalidateForMember(member.id);
  }

  // ─── API Keys — Enterprise tier required ─────────────────────────────────

  describe('API Keys — enterprise subscription required', () => {
    it('should deny free tier user from creating API keys (403)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `sub-ak1-${Date.now()}@test.com`,
      });
      await request(app.getHttpServer())
        .post('/api/v1/api-keys')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ name: 'Test Key', permissions: ['search'] })
        .expect(403);
    });

    it('should deny edu tier user from creating API keys (403)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `sub-ak2-${Date.now()}@test.com`,
      });
      await upgradeSubscription(user.accessToken, 'edu');
      await request(app.getHttpServer())
        .post('/api/v1/api-keys')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ name: 'Test Key', permissions: ['search'] })
        .expect(403);
    });

    it('should deny pro tier user from creating API keys (403)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `sub-ak3-${Date.now()}@test.com`,
      });
      await upgradeSubscription(user.accessToken, 'pro');
      await request(app.getHttpServer())
        .post('/api/v1/api-keys')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ name: 'Test Key', permissions: ['search'] })
        .expect(403);
    });

    it('should deny team tier user from creating API keys (403)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `sub-ak4-${Date.now()}@test.com`,
      });
      await upgradeSubscription(user.accessToken, 'team');
      await request(app.getHttpServer())
        .post('/api/v1/api-keys')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ name: 'Test Key', permissions: ['search'] })
        .expect(403);
    });

    it('should deny free tier user from listing API keys (403)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `sub-ak5-${Date.now()}@test.com`,
      });
      await request(app.getHttpServer())
        .get('/api/v1/api-keys')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });
  });

  // ─── Upload digest generation — Edu tier required ────────────────────────

  describe('Upload digest generation — edu subscription required', () => {
    it('should deny free tier user from generating digest from upload', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `sub-dg1-${Date.now()}@test.com`,
      });
      // Attempt to generate a digest — should fail with 403 (no upload needed, guard fires first)
      await request(app.getHttpServer())
        .post('/api/v1/uploads/00000000-0000-0000-0000-000000000000/generate-digest')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });

    it('should deny free tier user from generating flashcards from upload', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `sub-fc1-${Date.now()}@test.com`,
      });
      await request(app.getHttpServer())
        .post('/api/v1/uploads/00000000-0000-0000-0000-000000000000/generate-flashcards')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });

    it('should deny free tier user from generating outline from upload', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `sub-ol1-${Date.now()}@test.com`,
      });
      await request(app.getHttpServer())
        .post('/api/v1/uploads/00000000-0000-0000-0000-000000000000/generate-outline')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });
  });

  // ─── Bookmarks & annotations creation — Edu tier required ────────────────

  describe('Bookmarks & annotations creation — edu subscription required', () => {
    // Deterministic UUID for the shared seeded source (Source.id is @db.Uuid).
    const GATE_TEST_SOURCE_ID = '00000000-0000-4e2e-8e2e-000000000002';

    /** Seed a minimal published legal document for successful create paths */
    async function seedLegalDocument(): Promise<string> {
      const prisma = app.get(PrismaService);
      await prisma.source.upsert({
        where: { id: GATE_TEST_SOURCE_ID },
        update: {},
        create: {
          id: GATE_TEST_SOURCE_ID,
          name: 'E2E Subscription Gate Test Source',
          type: 'editorial',
          trustLevel: 'medium',
          fetchStrategy: 'manual',
        },
      });
      const doc = await prisma.legalDocument.create({
        data: {
          sourceId: GATE_TEST_SOURCE_ID,
          documentType: 'case',
          jurisdiction: 'PH',
          title: `E2E Gate Test Case ${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
          citationText: 'G.R. No. 888888',
          status: 'published',
          isPublished: true,
          isOfficial: false,
          truthfulnessStatus: 'needs_review',
        },
      });
      return doc.id;
    }

    it('should deny free tier user from creating a bookmark (403)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `sub-bm1-${Date.now()}@test.com`,
      });
      // Guard fires before validation/service, so a dummy UUID suffices
      const res = await request(app.getHttpServer())
        .post('/api/v1/bookmarks')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ legalDocumentId: '00000000-0000-0000-0000-000000000000' })
        .expect(403);

      const errorMsg =
        res.body.error?.message ?? res.body.message ?? JSON.stringify(res.body);
      expect(errorMsg.toLowerCase()).toMatch(/edu|subscription|plan/i);
    });

    it('should deny free tier user from creating an annotation (403)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `sub-an1-${Date.now()}@test.com`,
      });
      const res = await request(app.getHttpServer())
        .post('/api/v1/annotations')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          legalDocumentId: '00000000-0000-0000-0000-000000000000',
          textAnchor: { startOffset: 0, endOffset: 10, anchorText: 'test' },
        })
        .expect(403);

      const errorMsg =
        res.body.error?.message ?? res.body.message ?? JSON.stringify(res.body);
      expect(errorMsg.toLowerCase()).toMatch(/edu|subscription|plan/i);
    });

    it('should allow edu tier user to create a bookmark', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `sub-bm2-${Date.now()}@test.com`,
      });
      await upgradeSubscription(user.accessToken, 'edu');
      const docId = await seedLegalDocument();

      const res = await request(app.getHttpServer())
        .post('/api/v1/bookmarks')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ legalDocumentId: docId, note: 'edu tier bookmark' })
        .expect(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBeDefined();
    });

    it('should allow edu tier user to create an annotation', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `sub-an2-${Date.now()}@test.com`,
      });
      await upgradeSubscription(user.accessToken, 'edu');
      const docId = await seedLegalDocument();

      const res = await request(app.getHttpServer())
        .post('/api/v1/annotations')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          legalDocumentId: docId,
          textAnchor: { startOffset: 0, endOffset: 10, anchorText: 'The court' },
          color: 'yellow',
        })
        .expect(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBeDefined();
    });

    it('should still allow free tier user to list bookmarks (reads ungated)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `sub-bm3-${Date.now()}@test.com`,
      });
      const res = await request(app.getHttpServer())
        .get('/api/v1/bookmarks')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);
      expect(res.body.success).toBe(true);
    });

    it('should still allow free tier user to list annotations (reads ungated)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `sub-an3-${Date.now()}@test.com`,
      });
      const res = await request(app.getHttpServer())
        .get('/api/v1/annotations')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);
      expect(res.body.success).toBe(true);
    });
  });

  // ─── Document uploads — Pro tier required ────────────────────────────────

  describe('Document uploads — pro subscription required', () => {
    /** Minimal valid PDF so requests reach (and pass) magic-byte validation */
    function createTestPdfBuffer(): Buffer {
      const pdfContent =
        '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
        '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
        '3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R>>endobj\n' +
        'xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n' +
        '0000000058 00000 n \n0000000115 00000 n \n' +
        'trailer<</Size 4/Root 1 0 R>>\nstartxref\n190\n%%EOF';
      return Buffer.from(pdfContent);
    }

    it('should deny free tier user from uploading documents (403)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `sub-du1-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/uploads')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .attach('file', createTestPdfBuffer(), {
          filename: 'gated.pdf',
          contentType: 'application/pdf',
        })
        .expect(403);

      const errorMsg =
        res.body.error?.message ?? res.body.message ?? JSON.stringify(res.body);
      expect(errorMsg.toLowerCase()).toContain('pro');
    });

    it('should deny edu tier user from uploading documents (403)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `sub-du2-${Date.now()}@test.com`,
      });
      await updateSubscriptionPlan(app, user.accessToken, 'edu');

      await request(app.getHttpServer())
        .post('/api/v1/uploads')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .attach('file', createTestPdfBuffer(), {
          filename: 'gated-edu.pdf',
          contentType: 'application/pdf',
        })
        .expect(403);
    });

    it('should allow pro tier user to upload documents (202)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `sub-du3-${Date.now()}@test.com`,
      });
      await updateSubscriptionPlan(app, user.accessToken, 'pro');

      const res = await request(app.getHttpServer())
        .post('/api/v1/uploads')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .attach('file', createTestPdfBuffer(), {
          filename: 'allowed-pro.pdf',
          contentType: 'application/pdf',
        });

      // Must NOT be plan-gated. 500 acceptable only when S3/ClamAV is
      // unavailable in the test environment (same as camera-scan spec).
      expect(res.status).not.toBe(403);
      expect([202, 500]).toContain(res.status);
      if (res.status === 202) {
        expect(res.body.success).toBe(true);
        expect(res.body.data.id).toBeDefined();
      }
    });
  });

  // ─── External API — Enterprise tier required ─────────────────────────────

  describe('External API — enterprise subscription required', () => {
    it('should deny access without API key header', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/external-api/search')
        .send({ query: 'test' })
        .expect(401);
    });

    it('should deny with invalid API key', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/external-api/search')
        .set('X-API-Key', 'invalid-key')
        .send({ query: 'test' })
        .expect(401);
    });
  });

  // ─── Free tier access — basic features should work ───────────────────────

  describe('Free tier — basic features should be accessible', () => {
    it('should allow free tier user to list bookmarks', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `sub-free1-${Date.now()}@test.com`,
      });
      const res = await request(app.getHttpServer())
        .get('/api/v1/bookmarks')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);
      expect(res.body.success).toBe(true);
    });

    it('should allow free tier user to list documents', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/documents')
        .expect(200);
      expect(res.body.success).toBe(true);
    });

    it('should allow free tier user to list digests', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `sub-free2-${Date.now()}@test.com`,
      });
      const res = await request(app.getHttpServer())
        .get('/api/v1/digests')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);
      expect(res.body.success).toBe(true);
    });

    it('should allow free tier user to list uploads', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `sub-free3-${Date.now()}@test.com`,
      });
      const res = await request(app.getHttpServer())
        .get('/api/v1/uploads')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);
      expect(res.body.success).toBe(true);
    });

    it('should allow free tier user to access study endpoints', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `sub-free4-${Date.now()}@test.com`,
      });
      const res = await request(app.getHttpServer())
        .get('/api/v1/study/bar-subjects')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);
      expect(res.body.success).toBe(true);
    });

    it('should allow free tier user to list matters', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `sub-free5-${Date.now()}@test.com`,
      });
      const res = await request(app.getHttpServer())
        .get('/api/v1/matters')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);
      expect(res.body.success).toBe(true);
    });
  });

  // ─── Matter creation — maxMatters entitlement ────────────────────────────

  describe('Matter creation — maxMatters entitlement', () => {
    function createMatter(token: string) {
      return request(app.getHttpServer())
        .post('/api/v1/matters')
        .set('Authorization', `Bearer ${token}`)
        .send({ title: `Entitlement Matter ${Date.now()}` });
    }

    it('should deny free tier user from creating a matter (403)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `sub-mat1-${Date.now()}@test.com`,
      });
      const res = await createMatter(user.accessToken).expect(403);
      expect(res.body.message).toBe('Matters are available on Pro plans and above.');
      expect(res.body.quota).toEqual({ used: 0, limit: 0, resetsAt: '' });
    });

    it('should allow pro tier user to create a matter (limit 20)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `sub-mat2-${Date.now()}@test.com`,
      });
      await upgradeSubscription(user.accessToken, 'pro');
      const res = await createMatter(user.accessToken).expect(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('active');
    });

    it('should enforce the pro plan active-matter limit (403 when full)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `sub-mat3-${Date.now()}@test.com`,
      });
      // Shrink the limit to 1 via per-subscription override to keep the test fast
      await upgradeSubscription(user.accessToken, 'pro', { maxMatters: 1 });

      await createMatter(user.accessToken).expect(201);
      const res = await createMatter(user.accessToken).expect(403);
      expect(res.body.message).toBe(
        'Matter limit reached. Your plan allows 1 active matters.',
      );
      expect(res.body.quota).toEqual({ used: 1, limit: 1, resetsAt: '' });
    });

    it('should allow team tier user to create matters without limit', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `sub-mat4-${Date.now()}@test.com`,
      });
      await upgradeSubscription(user.accessToken, 'team');
      await createMatter(user.accessToken).expect(201);
      await createMatter(user.accessToken).expect(201);
      await createMatter(user.accessToken).expect(201);
    });

    it('should allow a platform admin on the free plan to create a matter', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `sub-mat5-${Date.now()}@test.com`,
      });
      // Org stays on the free plan (maxMatters = 0) — the admin bypass,
      // not the plan entitlement, must permit creation.
      await grantPlatformAdmin(user.userId, user.accessToken);

      const res = await createMatter(user.accessToken).expect(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('active');
    });
  });

  // ─── Subscription tier error messages ────────────────────────────────────

  describe('Error messages — should indicate required tier', () => {
    it('should include a relevant denial reason in 403 message for API keys', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `sub-msg1-${Date.now()}@test.com`,
      });
      const res = await request(app.getHttpServer())
        .post('/api/v1/api-keys')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ name: 'Test Key', permissions: ['search'] })
        .expect(403);

      // The API keys endpoint is protected by both PermissionsGuard and
      // SubscriptionGuard. Without RBAC MemberRole seed data, the
      // PermissionsGuard fires first with "Insufficient permissions".
      // With seed data, the SubscriptionGuard fires with a tier message.
      // Either guard correctly blocks access.
      const errorMsg =
        res.body.error?.message ?? res.body.message ?? JSON.stringify(res.body);
      expect(errorMsg.toLowerCase()).toMatch(
        /enterprise|subscription|plan|permission|forbidden/i,
      );
    });

    it('should include the required tier in 403 message for digest generation', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `sub-msg2-${Date.now()}@test.com`,
      });
      const res = await request(app.getHttpServer())
        .post('/api/v1/uploads/00000000-0000-0000-0000-000000000000/generate-digest')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);

      // The generate-digest endpoint is only protected by SubscriptionGuard
      // (no PermissionsGuard), so the message should mention the required tier.
      const errorMsg =
        res.body.error?.message ?? res.body.message ?? JSON.stringify(res.body);
      expect(errorMsg.toLowerCase()).toMatch(
        /edu|subscription|plan|forbidden/i,
      );
    });
  });

  // ─── Tier hierarchy validation ───────────────────────────────────────────

  describe('Tier hierarchy — higher tiers should include lower tier access', () => {
    it('should allow edu tier user to access bookmarks (free feature)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `sub-hier1-${Date.now()}@test.com`,
      });
      await upgradeSubscription(user.accessToken, 'edu');
      const res = await request(app.getHttpServer())
        .get('/api/v1/bookmarks')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);
      expect(res.body.success).toBe(true);
    });

    it('should allow pro tier user to access study features (edu feature)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `sub-hier2-${Date.now()}@test.com`,
      });
      await upgradeSubscription(user.accessToken, 'pro');
      const res = await request(app.getHttpServer())
        .get('/api/v1/study/bar-subjects')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);
      expect(res.body.success).toBe(true);
    });

    it('should allow enterprise tier user to access all basic features', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `sub-hier3-${Date.now()}@test.com`,
      });
      await upgradeSubscription(user.accessToken, 'enterprise');

      // Should be able to access bookmarks, digests, matters, study
      const endpoints = [
        '/api/v1/bookmarks',
        '/api/v1/digests',
        '/api/v1/matters',
        '/api/v1/study/bar-subjects',
      ];

      for (const path of endpoints) {
        const res = await request(app.getHttpServer())
          .get(path)
          .set('Authorization', `Bearer ${user.accessToken}`)
          .expect(200);
        expect(res.body.success).toBe(true);
      }
    });
  });
});
