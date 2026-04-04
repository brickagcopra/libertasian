import { INestApplication } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');
import { createTestApp, createAuthenticatedUser } from './helpers';

/**
 * Community & Marketplace E2E tests — browse, ratings, votes, flags, expert verification.
 * Per PDD: Phase 4 Community & Marketplace feature set.
 */
describe('Community & Marketplace (E2E)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  // ── Marketplace Browse ─────────────────────────────────────

  describe('Marketplace browsing', () => {
    it('should list featured community content', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `comm-featured-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/community/marketplace/featured')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
    });

    it('should browse flashcard sets', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `comm-fc-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/community/marketplace/flashcard-sets')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('should browse reviewer packs', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `comm-rp-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/community/marketplace/reviewer-packs')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
    });

    it('should browse digests', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `comm-dig-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/community/marketplace/digests')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
    });

    it('should allow unauthenticated access to featured marketplace', async () => {
      // Marketplace featured endpoint is public (no auth guard)
      await request(app.getHttpServer())
        .get('/api/v1/community/marketplace/featured')
        .expect(200);
    });
  });

  // ── Ratings ────────────────────────────────────────────────

  describe('Ratings', () => {
    it('should require authentication for creating rating', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/community/ratings')
        .send({ entityType: 'flashcard_set', entityId: '00000000-0000-0000-0000-000000000000', score: 5 })
        .expect(401);
    });

    it('should reject rating with invalid score', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `comm-badrate-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .post('/api/v1/community/ratings')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          entityType: 'flashcard_set',
          entityId: '00000000-0000-0000-0000-000000000000',
          score: 10, // Invalid — should be 1-5
        })
        .expect(400);
    });
  });

  // ── Flags ──────────────────────────────────────────────────

  describe('Content Flags', () => {
    it('should require authentication for flagging', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/community/flags')
        .send({
          entityType: 'digest',
          entityId: '00000000-0000-0000-0000-000000000000',
          reason: 'inappropriate',
        })
        .expect(401);
    });
  });

  // ── Expert Verification ────────────────────────────────────

  describe('Expert Verification', () => {
    it('should get own verification status', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `comm-verify-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/community/expert-verification/me')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
    });
  });

  // ── Admin Community Moderation ─────────────────────────────

  describe('Admin community moderation', () => {
    it('should reject flag listing without admin role', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `comm-noadmin-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .get('/api/v1/community/admin/flags')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });

    it('should reject expert verification listing without admin role', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `comm-noexpert-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .get('/api/v1/community/admin/expert-verifications')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });
  });
});
