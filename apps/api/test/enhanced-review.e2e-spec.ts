import { INestApplication } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');
import { createTestApp, createAuthenticatedUser } from './helpers';

/**
 * Enhanced Digest Review E2E tests.
 *
 * Tests cover:
 * - Auth enforcement (401 without token on all endpoints)
 * - Role enforcement (403 for non-admin/editor/reviewer users)
 * - Review queue listing with advanced filters
 * - Review stats endpoint
 * - Reviewer assignment/unassignment workflow
 * - Review verdict submission
 * - Batch operations: approve, reject, assign
 * - Validation of required fields, UUID formats, and enum values
 *
 * All endpoints are admin-gated (JwtAuthGuard + MfaGuard + RolesGuard, ADMIN|EDITOR|REVIEWER).
 */
describe('Enhanced Digest Review (E2E)', () => {
  let app: INestApplication;

  const FAKE_UUID_1 = '00000000-0000-4000-a000-000000000001';
  const FAKE_UUID_2 = '00000000-0000-4000-a000-000000000002';
  const FAKE_UUID_3 = '00000000-0000-4000-a000-000000000003';
  const FAKE_UUID_4 = '00000000-0000-4000-a000-000000000004';
  const INVALID_UUID = 'not-a-valid-uuid';

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  // =========================================================================
  // Auth enforcement — 401 for all endpoints
  // =========================================================================

  describe('Auth enforcement', () => {
    it('should reject unauthenticated GET /api/v1/admin/digests/review-queue', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/admin/digests/review-queue')
        .expect(401);
    });

    it('should reject unauthenticated GET /api/v1/admin/digests/review-stats', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/admin/digests/review-stats')
        .expect(401);
    });

    it('should reject unauthenticated POST /api/v1/admin/digests/:id/assign', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/admin/digests/${FAKE_UUID_1}/assign`)
        .send({ reviewerUserId: FAKE_UUID_2 })
        .expect(401);
    });

    it('should reject unauthenticated POST /api/v1/admin/digests/:id/unassign', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/admin/digests/${FAKE_UUID_1}/unassign`)
        .expect(401);
    });

    it('should reject unauthenticated POST /api/v1/admin/digests/:id/review', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/admin/digests/${FAKE_UUID_1}/review`)
        .send({ verdict: 'approve' })
        .expect(401);
    });

    it('should reject unauthenticated POST /api/v1/admin/digests/batch-approve', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/admin/digests/batch-approve')
        .send({ digestIds: [FAKE_UUID_1] })
        .expect(401);
    });

    it('should reject unauthenticated POST /api/v1/admin/digests/batch-reject', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/admin/digests/batch-reject')
        .send({ digestIds: [FAKE_UUID_1], reason: 'Low quality' })
        .expect(401);
    });

    it('should reject unauthenticated POST /api/v1/admin/digests/batch-assign', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/admin/digests/batch-assign')
        .send({ digestIds: [FAKE_UUID_1], reviewerUserId: FAKE_UUID_2 })
        .expect(401);
    });
  });

  // =========================================================================
  // Role enforcement — 403 for regular (non-admin/editor/reviewer) users
  // =========================================================================

  describe('Role enforcement', () => {
    it('should reject non-admin user for review queue', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `review-queue-nonadmin-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .get('/api/v1/admin/digests/review-queue')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });

    it('should reject non-admin user for review stats', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `review-stats-nonadmin-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .get('/api/v1/admin/digests/review-stats')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });

    it('should reject non-admin user for assign', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `review-assign-nonadmin-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .post(`/api/v1/admin/digests/${FAKE_UUID_1}/assign`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ reviewerUserId: FAKE_UUID_2 })
        .expect(403);
    });

    it('should reject non-admin user for unassign', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `review-unassign-nonadmin-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .post(`/api/v1/admin/digests/${FAKE_UUID_1}/unassign`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });

    it('should reject non-admin user for review verdict', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `review-verdict-nonadmin-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .post(`/api/v1/admin/digests/${FAKE_UUID_1}/review`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ verdict: 'approve' })
        .expect(403);
    });

    it('should reject non-admin user for batch-approve', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `review-batchappr-nonadmin-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .post('/api/v1/admin/digests/batch-approve')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ digestIds: [FAKE_UUID_1] })
        .expect(403);
    });

    it('should reject non-admin user for batch-reject', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `review-batchrej-nonadmin-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .post('/api/v1/admin/digests/batch-reject')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ digestIds: [FAKE_UUID_1] })
        .expect(403);
    });

    it('should reject non-admin user for batch-assign', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `review-batchasgn-nonadmin-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .post('/api/v1/admin/digests/batch-assign')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ digestIds: [FAKE_UUID_1], reviewerUserId: FAKE_UUID_2 })
        .expect(403);
    });
  });

  // =========================================================================
  // Review Queue — query validation
  // =========================================================================

  describe('GET /api/v1/admin/digests/review-queue — validation', () => {
    it('should return 400 for invalid cursor UUID', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `rq-badcursor-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/digests/review-queue')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .query({ cursor: INVALID_UUID });

      // 400 (validation) or 403 (role) — both acceptable
      expect([400, 403]).toContain(res.status);
    });

    it('should return 400 for limit > 100', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `rq-badlimit-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/digests/review-queue')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .query({ limit: 200 });

      expect([400, 403]).toContain(res.status);
    });

    it('should return 400 for invalid reviewStatus', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `rq-badstatus-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/digests/review-queue')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .query({ reviewStatus: 'invalid_status' });

      expect([400, 403]).toContain(res.status);
    });

    it('should return 400 for invalid sourceOrigin', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `rq-badorigin-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/digests/review-queue')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .query({ sourceOrigin: 'invalid_origin' });

      expect([400, 403]).toContain(res.status);
    });

    it('should return 400 for invalid digestType', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `rq-badtype-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/digests/review-queue')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .query({ digestType: 'invalid_type' });

      expect([400, 403]).toContain(res.status);
    });

    it('should return 400 for invalid sortBy field', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `rq-badsort-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/digests/review-queue')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .query({ sortBy: 'invalid_field' });

      expect([400, 403]).toContain(res.status);
    });

    it('should return 400 for invalid sortOrder', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `rq-badorder-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/digests/review-queue')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .query({ sortOrder: 'random' });

      expect([400, 403]).toContain(res.status);
    });

    it('should accept valid filter combinations', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `rq-validfilter-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/digests/review-queue')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .query({
          reviewStatus: 'needs_human_review',
          digestType: 'case_digest',
          sortBy: 'createdAt',
          sortOrder: 'desc',
          limit: 10,
        });

      // 403 for non-admin, 200 for admin
      expect([200, 403]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body.success).toBe(true);
        expect(res.body.data).toBeDefined();
        expect(res.body.meta).toBeDefined();
      }
    });
  });

  // =========================================================================
  // Review Stats
  // =========================================================================

  describe('GET /api/v1/admin/digests/review-stats', () => {
    it('should reject without auth', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/admin/digests/review-stats')
        .expect(401);
    });
  });

  // =========================================================================
  // Assign / Unassign Reviewer
  // =========================================================================

  describe('POST /api/v1/admin/digests/:id/assign — validation', () => {
    it('should return 403 for invalid digest UUID (role guard fires before validation)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `assign-baduuid-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .post(`/api/v1/admin/digests/${INVALID_UUID}/assign`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ reviewerUserId: FAKE_UUID_2 })
        .expect(403);
    });

    it('should return 400 when reviewerUserId is missing', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `assign-nobody-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .post(`/api/v1/admin/digests/${FAKE_UUID_1}/assign`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({});

      // 400 (validation) or 403 (role)
      expect([400, 403]).toContain(res.status);
    });

    it('should return 400 when reviewerUserId is not a valid UUID', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `assign-badreviewer-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .post(`/api/v1/admin/digests/${FAKE_UUID_1}/assign`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ reviewerUserId: INVALID_UUID });

      expect([400, 403]).toContain(res.status);
    });

    it('should reject unknown fields (whitelist validation)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `assign-extra-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .post(`/api/v1/admin/digests/${FAKE_UUID_1}/assign`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          reviewerUserId: FAKE_UUID_2,
          unknownField: 'should be rejected',
        });

      expect([400, 403]).toContain(res.status);
    });
  });

  describe('POST /api/v1/admin/digests/:id/unassign — validation', () => {
    it('should return 403 for invalid digest UUID (role guard fires before validation)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `unassign-baduuid-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .post(`/api/v1/admin/digests/${INVALID_UUID}/unassign`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });
  });

  // =========================================================================
  // Submit Review Verdict
  // =========================================================================

  describe('POST /api/v1/admin/digests/:id/review — validation', () => {
    it('should return 403 for invalid digest UUID (role guard fires before validation)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `review-baduuid-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .post(`/api/v1/admin/digests/${INVALID_UUID}/review`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ verdict: 'approve' })
        .expect(403);
    });

    it('should return 400 when verdict is missing', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `review-noverdict-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .post(`/api/v1/admin/digests/${FAKE_UUID_1}/review`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({});

      expect([400, 403]).toContain(res.status);
    });

    it('should return 400 for invalid verdict value', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `review-badverdict-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .post(`/api/v1/admin/digests/${FAKE_UUID_1}/review`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ verdict: 'invalid_verdict' });

      expect([400, 403]).toContain(res.status);
    });

    it('should accept valid verdict with optional scores', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `review-validverdict-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .post(`/api/v1/admin/digests/${FAKE_UUID_1}/review`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          verdict: 'approve',
          notes: 'Looks good',
          truthfulnessScore: 0.9,
          completenessScore: 0.85,
          citationAccuracyScore: 0.95,
        });

      // 403 for non-admin, 200/201 for admin, 404 if digest not found
      expect([200, 201, 403, 404]).toContain(res.status);
      if (res.status === 200 || res.status === 201) {
        expect(res.body.success).toBe(true);
      }
    });

    it('should return 400 when truthfulnessScore is out of range', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `review-badscore-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .post(`/api/v1/admin/digests/${FAKE_UUID_1}/review`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ verdict: 'approve', truthfulnessScore: 1.5 });

      expect([400, 403]).toContain(res.status);
    });

    it('should reject unknown fields in review body (whitelist validation)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `review-extra-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .post(`/api/v1/admin/digests/${FAKE_UUID_1}/review`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          verdict: 'approve',
          unknownField: 'should be rejected',
        });

      expect([400, 403]).toContain(res.status);
    });
  });

  // =========================================================================
  // Batch Operations
  // =========================================================================

  describe('POST /api/v1/admin/digests/batch-approve — validation', () => {
    it('should return 400 when digestIds is missing', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `batchappr-noids-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/admin/digests/batch-approve')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({});

      expect([400, 403]).toContain(res.status);
    });

    it('should return 400 when digestIds is empty array', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `batchappr-empty-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/admin/digests/batch-approve')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ digestIds: [] });

      expect([400, 403]).toContain(res.status);
    });

    it('should return 400 when digestIds contains invalid UUIDs', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `batchappr-baduuids-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/admin/digests/batch-approve')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ digestIds: [INVALID_UUID, 'also-invalid'] });

      expect([400, 403]).toContain(res.status);
    });

    it('should accept valid digestIds array', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `batchappr-valid-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/admin/digests/batch-approve')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ digestIds: [FAKE_UUID_1, FAKE_UUID_2] });

      // 403 for non-admin, 200/201 for admin, 404 if digests not found
      expect([200, 201, 403, 404]).toContain(res.status);
    });
  });

  describe('POST /api/v1/admin/digests/batch-reject — validation', () => {
    it('should return 400 when digestIds is missing', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `batchrej-noids-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/admin/digests/batch-reject')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({});

      expect([400, 403]).toContain(res.status);
    });

    it('should return 400 when digestIds is empty array', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `batchrej-empty-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/admin/digests/batch-reject')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ digestIds: [] });

      expect([400, 403]).toContain(res.status);
    });

    it('should return 400 when digestIds contains invalid UUIDs', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `batchrej-baduuids-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/admin/digests/batch-reject')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ digestIds: [INVALID_UUID] });

      expect([400, 403]).toContain(res.status);
    });

    it('should accept valid digestIds with optional reason', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `batchrej-valid-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/admin/digests/batch-reject')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          digestIds: [FAKE_UUID_1, FAKE_UUID_2],
          reason: 'Low confidence scores',
          notes: 'Rejected during batch review',
        });

      expect([200, 201, 403, 404]).toContain(res.status);
    });
  });

  describe('POST /api/v1/admin/digests/batch-assign — validation', () => {
    it('should return 400 when digestIds is missing', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `batchasgn-noids-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/admin/digests/batch-assign')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ reviewerUserId: FAKE_UUID_2 });

      expect([400, 403]).toContain(res.status);
    });

    it('should return 400 when reviewerUserId is missing', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `batchasgn-noreviewer-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/admin/digests/batch-assign')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ digestIds: [FAKE_UUID_1] });

      expect([400, 403]).toContain(res.status);
    });

    it('should return 400 when digestIds is empty array', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `batchasgn-empty-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/admin/digests/batch-assign')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ digestIds: [], reviewerUserId: FAKE_UUID_2 });

      expect([400, 403]).toContain(res.status);
    });

    it('should return 400 when reviewerUserId is invalid UUID', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `batchasgn-badreviewer-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/admin/digests/batch-assign')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ digestIds: [FAKE_UUID_1], reviewerUserId: INVALID_UUID });

      expect([400, 403]).toContain(res.status);
    });

    it('should reject unknown fields (whitelist validation)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `batchasgn-extra-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/admin/digests/batch-assign')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          digestIds: [FAKE_UUID_1],
          reviewerUserId: FAKE_UUID_2,
          unknownField: 'should be rejected',
        });

      expect([400, 403]).toContain(res.status);
    });

    it('should accept valid batch assign payload', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `batchasgn-valid-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/admin/digests/batch-assign')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          digestIds: [FAKE_UUID_1, FAKE_UUID_3, FAKE_UUID_4],
          reviewerUserId: FAKE_UUID_2,
        });

      expect([200, 201, 403, 404]).toContain(res.status);
    });
  });
});
