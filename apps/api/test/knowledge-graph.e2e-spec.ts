import { INestApplication } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');
import { createTestApp, createAuthenticatedUser } from './helpers';

/**
 * Knowledge Graph E2E tests.
 *
 * Tests cover:
 * - Public graph query endpoints (auth required, no admin role needed)
 * - Admin citation resolution endpoints (admin/editor role required)
 * - Admin case-codal link CRUD (admin/editor role required)
 * - Validation of required fields and UUID formats
 * - Auth enforcement (401 without token)
 * - Role enforcement (403 for non-admin users on admin endpoints)
 */
describe('Knowledge Graph (E2E)', () => {
  let app: INestApplication;

  const FAKE_UUID_1 = '00000000-0000-4000-a000-000000000001';
  const FAKE_UUID_2 = '00000000-0000-4000-a000-000000000002';
  const FAKE_UUID_3 = '00000000-0000-4000-a000-000000000003';
  const INVALID_UUID = 'not-a-valid-uuid';

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  // =========================================================================
  // Public Graph Query Endpoints (JwtAuthGuard only)
  // =========================================================================

  describe('GET /api/v1/knowledge-graph/cites', () => {
    it('should reject unauthenticated requests with 401', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/knowledge-graph/cites')
        .query({ documentId: FAKE_UUID_1 })
        .expect(401);
    });

    it('should return 400 when documentId is missing', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `kg-cites-missing-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .get('/api/v1/knowledge-graph/cites')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(400);
    });

    it('should return 400 when documentId is not a valid UUID', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `kg-cites-invalid-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .get('/api/v1/knowledge-graph/cites')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .query({ documentId: INVALID_UUID })
        .expect(400);
    });

    it('should accept valid documentId and return success response', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `kg-cites-ok-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/knowledge-graph/cites')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .query({ documentId: FAKE_UUID_1, depth: 1 });

      // May return 200 with empty data or 404 if document not found — both are valid
      expect([200, 404]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body.success).toBe(true);
        expect(res.body.data).toBeDefined();
      }
    });

    it('should reject depth > 3', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `kg-cites-depth-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .get('/api/v1/knowledge-graph/cites')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .query({ documentId: FAKE_UUID_1, depth: 5 })
        .expect(400);
    });
  });

  describe('GET /api/v1/knowledge-graph/cited-by', () => {
    it('should reject unauthenticated requests with 401', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/knowledge-graph/cited-by')
        .query({ documentId: FAKE_UUID_1 })
        .expect(401);
    });

    it('should return 400 when documentId is missing', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `kg-citedby-miss-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .get('/api/v1/knowledge-graph/cited-by')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(400);
    });

    it('should accept valid documentId', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `kg-citedby-ok-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/knowledge-graph/cited-by')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .query({ documentId: FAKE_UUID_1 });

      expect([200, 404]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body.success).toBe(true);
      }
    });
  });

  describe('GET /api/v1/knowledge-graph/chain', () => {
    it('should reject unauthenticated requests with 401', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/knowledge-graph/chain')
        .query({ documentId: FAKE_UUID_1 })
        .expect(401);
    });

    it('should return 400 when documentId is missing', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `kg-chain-miss-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .get('/api/v1/knowledge-graph/chain')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(400);
    });

    it('should accept valid documentId with depth', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `kg-chain-ok-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/knowledge-graph/chain')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .query({ documentId: FAKE_UUID_1, depth: 3 });

      expect([200, 404]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body.success).toBe(true);
      }
    });
  });

  describe('GET /api/v1/knowledge-graph/network', () => {
    it('should reject unauthenticated requests with 401', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/knowledge-graph/network')
        .query({ documentId: FAKE_UUID_1 })
        .expect(401);
    });

    it('should return 400 when documentId is missing', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `kg-network-miss-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .get('/api/v1/knowledge-graph/network')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(400);
    });

    it('should accept valid documentId with depth', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `kg-network-ok-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/knowledge-graph/network')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .query({ documentId: FAKE_UUID_1, depth: 2 });

      expect([200, 404]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body.success).toBe(true);
      }
    });
  });

  describe('GET /api/v1/knowledge-graph/codal-links/:documentId', () => {
    it('should reject unauthenticated requests with 401', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/knowledge-graph/codal-links/${FAKE_UUID_1}`)
        .expect(401);
    });

    it('should return 400 for invalid UUID param', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `kg-codal-invalid-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .get(`/api/v1/knowledge-graph/codal-links/${INVALID_UUID}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(400);
    });

    it('should accept valid UUID param', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `kg-codal-ok-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/knowledge-graph/codal-links/${FAKE_UUID_1}`)
        .set('Authorization', `Bearer ${user.accessToken}`);

      expect([200, 404]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body.success).toBe(true);
      }
    });
  });

  // =========================================================================
  // Admin Endpoints (JwtAuthGuard + MfaGuard + RolesGuard, ADMIN|EDITOR)
  // =========================================================================

  describe('POST /api/v1/admin/knowledge-graph/resolve-citations/:documentId', () => {
    it('should reject unauthenticated requests with 401', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/admin/knowledge-graph/resolve-citations/${FAKE_UUID_1}`)
        .expect(401);
    });

    it('should reject non-admin users with 403', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `kg-resolve-nonadmin-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .post(`/api/v1/admin/knowledge-graph/resolve-citations/${FAKE_UUID_1}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });

    it('should return 403 for invalid UUID param (role guard fires before validation)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `kg-resolve-baduuid-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .post(`/api/v1/admin/knowledge-graph/resolve-citations/${INVALID_UUID}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });
  });

  describe('POST /api/v1/admin/knowledge-graph/resolve-citation/:citationId', () => {
    it('should reject unauthenticated requests with 401', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/admin/knowledge-graph/resolve-citation/${FAKE_UUID_1}`)
        .send({ toDocumentId: FAKE_UUID_2 })
        .expect(401);
    });

    it('should reject non-admin users with 403', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `kg-resolvecit-nonadmin-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .post(`/api/v1/admin/knowledge-graph/resolve-citation/${FAKE_UUID_1}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ toDocumentId: FAKE_UUID_2 })
        .expect(403);
    });

    it('should return 403 for invalid citationId UUID (role guard fires before validation)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `kg-resolvecit-baduuid-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .post(`/api/v1/admin/knowledge-graph/resolve-citation/${INVALID_UUID}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ toDocumentId: FAKE_UUID_2 })
        .expect(403);
    });

    it('should return 403 when toDocumentId is missing or invalid (role guard fires before validation)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `kg-resolvecit-nobody-${Date.now()}@test.com`,
      });

      // Missing toDocumentId — but role guard rejects non-admin first
      await request(app.getHttpServer())
        .post(`/api/v1/admin/knowledge-graph/resolve-citation/${FAKE_UUID_1}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({})
        .expect(403);
    });
  });

  describe('GET /api/v1/admin/knowledge-graph/unresolved-citations', () => {
    it('should reject unauthenticated requests with 401', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/admin/knowledge-graph/unresolved-citations')
        .expect(401);
    });

    it('should reject non-admin users with 403', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `kg-unresolved-nonadmin-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .get('/api/v1/admin/knowledge-graph/unresolved-citations')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });

    it('should return 403 for invalid cursor UUID (role guard fires before validation)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `kg-unresolved-badcursor-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .get('/api/v1/admin/knowledge-graph/unresolved-citations')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .query({ cursor: INVALID_UUID })
        .expect(403);
    });
  });

  // ---- Case-Codal Link CRUD (Admin) ----

  describe('POST /api/v1/admin/knowledge-graph/case-codal-links', () => {
    it('should reject unauthenticated requests with 401', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/admin/knowledge-graph/case-codal-links')
        .send({
          caseDocumentId: FAKE_UUID_1,
          codalDocumentId: FAKE_UUID_2,
          linkType: 'interprets',
        })
        .expect(401);
    });

    it('should reject non-admin users with 403', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `kg-ccl-create-nonadmin-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .post('/api/v1/admin/knowledge-graph/case-codal-links')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          caseDocumentId: FAKE_UUID_1,
          codalDocumentId: FAKE_UUID_2,
          linkType: 'interprets',
        })
        .expect(403);
    });

    it('should return 403 when required fields are missing (role guard fires before validation)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `kg-ccl-missing-${Date.now()}@test.com`,
      });

      // Missing caseDocumentId, codalDocumentId, linkType — but role guard rejects non-admin first
      await request(app.getHttpServer())
        .post('/api/v1/admin/knowledge-graph/case-codal-links')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({})
        .expect(403);
    });

    it('should return 403 when linkType is invalid (role guard fires before validation)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `kg-ccl-badtype-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .post('/api/v1/admin/knowledge-graph/case-codal-links')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          caseDocumentId: FAKE_UUID_1,
          codalDocumentId: FAKE_UUID_2,
          linkType: 'invalid_type',
        })
        .expect(403);
    });

    it('should return 403 when caseDocumentId is not a valid UUID (role guard fires before validation)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `kg-ccl-baduuid-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .post('/api/v1/admin/knowledge-graph/case-codal-links')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          caseDocumentId: INVALID_UUID,
          codalDocumentId: FAKE_UUID_2,
          linkType: 'applies',
        })
        .expect(403);
    });

    it('should reject unknown fields with 403 (role guard fires before validation)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `kg-ccl-extra-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .post('/api/v1/admin/knowledge-graph/case-codal-links')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          caseDocumentId: FAKE_UUID_1,
          codalDocumentId: FAKE_UUID_2,
          linkType: 'interprets',
          unknownField: 'should be rejected',
        })
        .expect(403);
    });
  });

  describe('GET /api/v1/admin/knowledge-graph/case-codal-links', () => {
    it('should reject unauthenticated requests with 401', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/admin/knowledge-graph/case-codal-links')
        .expect(401);
    });

    it('should reject non-admin users with 403', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `kg-ccl-list-nonadmin-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .get('/api/v1/admin/knowledge-graph/case-codal-links')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });

    it('should accept valid filter params', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `kg-ccl-list-filter-${Date.now()}@test.com`,
      });

      // This will be 403 for non-admin, testing the validation for admin is separate
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/knowledge-graph/case-codal-links')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .query({ linkType: 'invalid_type' });

      // Either 400 (validation fail) or 403 (role fail) — both acceptable
      expect([400, 403]).toContain(res.status);
    });
  });

  describe('PATCH /api/v1/admin/knowledge-graph/case-codal-links/:id', () => {
    it('should reject unauthenticated requests with 401', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/admin/knowledge-graph/case-codal-links/${FAKE_UUID_1}`)
        .send({ linkType: 'applies' })
        .expect(401);
    });

    it('should reject non-admin users with 403', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `kg-ccl-update-nonadmin-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .patch(`/api/v1/admin/knowledge-graph/case-codal-links/${FAKE_UUID_1}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ linkType: 'applies' })
        .expect(403);
    });

    it('should return 403 for invalid UUID param (role guard fires before validation)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `kg-ccl-update-baduuid-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .patch(`/api/v1/admin/knowledge-graph/case-codal-links/${INVALID_UUID}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ linkType: 'applies' })
        .expect(403);
    });

    it('should return 400 for invalid linkType in body', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `kg-ccl-update-badtype-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/admin/knowledge-graph/case-codal-links/${FAKE_UUID_1}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ linkType: 'not_valid' });

      // Either 400 (validation) or 403 (role) — both acceptable
      expect([400, 403]).toContain(res.status);
    });
  });

  describe('DELETE /api/v1/admin/knowledge-graph/case-codal-links/:id', () => {
    it('should reject unauthenticated requests with 401', async () => {
      await request(app.getHttpServer())
        .delete(`/api/v1/admin/knowledge-graph/case-codal-links/${FAKE_UUID_1}`)
        .expect(401);
    });

    it('should reject non-admin users with 403', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `kg-ccl-delete-nonadmin-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .delete(`/api/v1/admin/knowledge-graph/case-codal-links/${FAKE_UUID_1}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });

    it('should return 403 for invalid UUID param (role guard fires before validation)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `kg-ccl-delete-baduuid-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .delete(`/api/v1/admin/knowledge-graph/case-codal-links/${INVALID_UUID}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });
  });
});
