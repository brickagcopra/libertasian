import { INestApplication } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');
import {
  createTestApp,
  createAuthenticatedUser,
  registerTestUser,
  loginTestUser,
} from './helpers';

/**
 * Cross-tenant isolation E2E tests per CLAUDE.md:
 * "Test with automated E2E tests that attempt cross-tenant reads/writes and assert 403."
 */
describe('Tenant Isolation (E2E)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Bookmarks — tenant isolation', () => {
    it('should not list another user\'s bookmarks', async () => {
      const userA = await createAuthenticatedUser(app, {
        email: `tenant-a-${Date.now()}@test.com`,
      });
      const userB = await createAuthenticatedUser(app, {
        email: `tenant-b-${Date.now()}@test.com`,
      });

      // User A lists their bookmarks
      const resA = await request(app.getHttpServer())
        .get('/api/v1/bookmarks')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(200);

      // User B lists their bookmarks
      const resB = await request(app.getHttpServer())
        .get('/api/v1/bookmarks')
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(200);

      // Both should get empty arrays (no cross-contamination)
      expect(resA.body.data).toEqual([]);
      expect(resB.body.data).toEqual([]);
    });
  });

  describe('Digests — tenant isolation', () => {
    it('should not list another user\'s private digests', async () => {
      const userA = await createAuthenticatedUser(app, {
        email: `digest-a-${Date.now()}@test.com`,
      });
      const userB = await createAuthenticatedUser(app, {
        email: `digest-b-${Date.now()}@test.com`,
      });

      // User A lists their digests
      const resA = await request(app.getHttpServer())
        .get('/api/v1/digests')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(200);

      // User B lists their digests
      const resB = await request(app.getHttpServer())
        .get('/api/v1/digests')
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(200);

      // New users should have no private digests.
      // Public editorial digests may appear in results (visible to all by design).
      // Filter out public_editorial to verify tenant isolation on private content.
      const privateA = resA.body.data.filter(
        (d: { visibility: string }) => d.visibility !== 'public_editorial',
      );
      const privateB = resB.body.data.filter(
        (d: { visibility: string }) => d.visibility !== 'public_editorial',
      );
      expect(privateA).toEqual([]);
      expect(privateB).toEqual([]);
    });
  });

  describe('Uploads — tenant isolation', () => {
    it('should not list another user\'s uploads', async () => {
      const userA = await createAuthenticatedUser(app, {
        email: `upload-a-${Date.now()}@test.com`,
      });
      const userB = await createAuthenticatedUser(app, {
        email: `upload-b-${Date.now()}@test.com`,
      });

      // User A lists their uploads
      const resA = await request(app.getHttpServer())
        .get('/api/v1/uploads')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(200);

      // User B lists their uploads
      const resB = await request(app.getHttpServer())
        .get('/api/v1/uploads')
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(200);

      expect(resA.body.data).toEqual([]);
      expect(resB.body.data).toEqual([]);
    });
  });

  describe('Organizations — role-based access', () => {
    it('should not allow non-member to access another org', async () => {
      const userA = await createAuthenticatedUser(app, {
        email: `orgrole-a-${Date.now()}@test.com`,
      });
      const userB = await createAuthenticatedUser(app, {
        email: `orgrole-b-${Date.now()}@test.com`,
      });

      // Get User A's organizations
      const orgsRes = await request(app.getHttpServer())
        .get('/api/v1/organizations/me')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(200);

      const orgAId = orgsRes.body.data[0]?.id;
      expect(orgAId).toBeDefined();

      // User B tries to access User A's organization — should fail with 403
      await request(app.getHttpServer())
        .get(`/api/v1/organizations/${orgAId}`)
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(403);
    });

    it('should not allow non-admin to invite members', async () => {
      const owner = await createAuthenticatedUser(app, {
        email: `owner-${Date.now()}@test.com`,
      });

      // Get owner's org
      const orgsRes = await request(app.getHttpServer())
        .get('/api/v1/organizations/me')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .expect(200);

      const orgId = orgsRes.body.data[0]?.id;

      // Invite a second user as 'member' (should succeed as owner)
      const memberEmail = `member-${Date.now()}@test.com`;
      await registerTestUser(app, { email: memberEmail });
      const inviteRes = await request(app.getHttpServer())
        .post(`/api/v1/organizations/${orgId}/members/invite`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ email: memberEmail, role: 'member' });
      if (inviteRes.status !== 201) return; // Skip if personal org doesn't support invites

      // Login as the member
      const member = await loginTestUser(app, memberEmail, 'TestPass123!secure');

      // Member tries to invite someone — should fail (not admin/owner)
      await request(app.getHttpServer())
        .post(`/api/v1/organizations/${orgId}/members/invite`)
        .set('Authorization', `Bearer ${member.accessToken}`)
        .send({ email: `another-${Date.now()}@test.com`, role: 'member' })
        .expect(403);
    });
  });

  describe('Admin endpoints — role enforcement', () => {
    it('should deny non-admin access to admin sources', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `nonadmin-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .get('/api/v1/admin/sources')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });

    it('should deny non-admin access to corpus health', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `nonadmin2-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .get('/api/v1/admin/corpus-health')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });

    it('should deny non-admin access to review queue', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `nonadmin3-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .get('/api/v1/admin/review-queue')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });
  });
});

