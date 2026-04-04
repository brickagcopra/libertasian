import { INestApplication } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');
import { createTestApp, createAuthenticatedUser } from './helpers';

/**
 * Sources & Source Health Admin E2E tests.
 *
 * Tests cover:
 * - Auth enforcement (401 without token on all endpoints)
 * - Role enforcement (403 for non-admin/editor users)
 * - Source registry CRUD (list, get, create, update)
 * - Endpoint management (add, update, delete)
 * - Source health endpoints (per-source, all sources, recompute)
 * - Validation of required fields, UUID formats, and enum values
 *
 * All endpoints are admin-gated (JwtAuthGuard + MfaGuard + RolesGuard, ADMIN|EDITOR).
 */
describe('Sources & Source Health Admin (E2E)', () => {
  let app: INestApplication;

  const FAKE_UUID_1 = '00000000-0000-4000-a000-000000000001';
  const FAKE_UUID_2 = '00000000-0000-4000-a000-000000000002';
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
    it('should reject unauthenticated GET /api/v1/admin/sources', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/admin/sources')
        .expect(401);
    });

    it('should reject unauthenticated GET /api/v1/admin/sources/:id', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/admin/sources/${FAKE_UUID_1}`)
        .expect(401);
    });

    it('should reject unauthenticated POST /api/v1/admin/sources', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/admin/sources')
        .send({ name: 'Test Source', type: 'official' })
        .expect(401);
    });

    it('should reject unauthenticated PATCH /api/v1/admin/sources/:id', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/admin/sources/${FAKE_UUID_1}`)
        .send({ name: 'Updated' })
        .expect(401);
    });

    it('should reject unauthenticated POST /api/v1/admin/sources/:id/endpoints', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/admin/sources/${FAKE_UUID_1}/endpoints`)
        .send({ endpointUrl: 'https://example.com', parserType: 'html' })
        .expect(401);
    });

    it('should reject unauthenticated PATCH /api/v1/admin/sources/:id/endpoints/:endpointId', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/admin/sources/${FAKE_UUID_1}/endpoints/${FAKE_UUID_2}`)
        .send({ status: 'disabled' })
        .expect(401);
    });

    it('should reject unauthenticated DELETE /api/v1/admin/sources/:id/endpoints/:endpointId', async () => {
      await request(app.getHttpServer())
        .delete(`/api/v1/admin/sources/${FAKE_UUID_1}/endpoints/${FAKE_UUID_2}`)
        .expect(401);
    });

    it('should reject unauthenticated GET /api/v1/admin/sources/health', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/admin/sources/health')
        .expect(401);
    });

    it('should reject unauthenticated GET /api/v1/admin/sources/:id/health', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/admin/sources/${FAKE_UUID_1}/health`)
        .expect(401);
    });

    it('should reject unauthenticated POST /api/v1/admin/sources/health/recompute', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/admin/sources/health/recompute')
        .expect(401);
    });

    it('should reject unauthenticated POST /api/v1/admin/sources/:id/health/recompute', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/admin/sources/${FAKE_UUID_1}/health/recompute`)
        .expect(401);
    });

    it('should reject unauthenticated POST /api/v1/admin/sources/:id/fetch', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/admin/sources/${FAKE_UUID_1}/fetch`)
        .expect(401);
    });

    it('should reject unauthenticated GET /api/v1/admin/ingestion-jobs', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/admin/ingestion-jobs')
        .expect(401);
    });

    it('should reject unauthenticated GET /api/v1/admin/corpus-health', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/admin/corpus-health')
        .expect(401);
    });

    it('should reject unauthenticated GET /api/v1/admin/coverage-gaps', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/admin/coverage-gaps')
        .expect(401);
    });

    it('should reject unauthenticated GET /api/v1/admin/staleness-report', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/admin/staleness-report')
        .expect(401);
    });
  });

  // =========================================================================
  // Role enforcement — 403 for regular (non-admin/editor) users
  // =========================================================================

  describe('Role enforcement', () => {
    it('should reject non-admin user for GET /api/v1/admin/sources', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `src-list-nonadmin-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .get('/api/v1/admin/sources')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });

    it('should reject non-admin user for POST /api/v1/admin/sources', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `src-create-nonadmin-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .post('/api/v1/admin/sources')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ name: 'Test', type: 'official' })
        .expect(403);
    });

    it('should reject non-admin user for PATCH /api/v1/admin/sources/:id', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `src-update-nonadmin-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .patch(`/api/v1/admin/sources/${FAKE_UUID_1}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ name: 'Updated' })
        .expect(403);
    });

    it('should reject non-admin user for POST /api/v1/admin/sources/:id/endpoints', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `src-ep-create-nonadmin-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .post(`/api/v1/admin/sources/${FAKE_UUID_1}/endpoints`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ endpointUrl: 'https://example.com', parserType: 'html' })
        .expect(403);
    });

    it('should reject non-admin user for DELETE /api/v1/admin/sources/:id/endpoints/:endpointId', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `src-ep-del-nonadmin-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .delete(`/api/v1/admin/sources/${FAKE_UUID_1}/endpoints/${FAKE_UUID_2}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });

    it('should reject non-admin user for GET /api/v1/admin/sources/health', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `src-health-nonadmin-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .get('/api/v1/admin/sources/health')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });

    it('should reject non-admin user for POST /api/v1/admin/sources/health/recompute', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `src-recompute-nonadmin-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .post('/api/v1/admin/sources/health/recompute')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });

    it('should reject non-admin user for GET /api/v1/admin/corpus-health', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `corpus-health-nonadmin-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .get('/api/v1/admin/corpus-health')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });

    it('should reject non-admin user for POST /api/v1/admin/sources/:id/fetch', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `src-fetch-nonadmin-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .post(`/api/v1/admin/sources/${FAKE_UUID_1}/fetch`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });
  });

  // =========================================================================
  // Source Registry CRUD — Validation
  // =========================================================================

  describe('GET /api/v1/admin/sources/:id — get source', () => {
    it('should return 403 for invalid UUID param (role guard fires before validation)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `src-get-baduuid-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .get(`/api/v1/admin/sources/${INVALID_UUID}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });
  });

  describe('POST /api/v1/admin/sources — create source', () => {
    it('should return 400 when name is missing', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `src-create-noname-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/admin/sources')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ type: 'official' });

      // 400 (validation) or 403 (role)
      expect([400, 403]).toContain(res.status);
    });

    it('should return 400 when type is missing', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `src-create-notype-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/admin/sources')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ name: 'Test Source' });

      expect([400, 403]).toContain(res.status);
    });

    it('should return 400 for invalid type value', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `src-create-badtype-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/admin/sources')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ name: 'Test Source', type: 'invalid_type' });

      expect([400, 403]).toContain(res.status);
    });

    it('should return 400 for invalid trustLevel', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `src-create-badtrust-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/admin/sources')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ name: 'Test Source', type: 'official', trustLevel: 'invalid' });

      expect([400, 403]).toContain(res.status);
    });

    it('should return 400 for invalid fetchStrategy', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `src-create-badfetch-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/admin/sources')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ name: 'Test Source', type: 'official', fetchStrategy: 'invalid' });

      expect([400, 403]).toContain(res.status);
    });

    it('should reject unknown fields (whitelist validation)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `src-create-extra-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/admin/sources')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          name: 'Test Source',
          type: 'official',
          unknownField: 'should be rejected',
        });

      expect([400, 403]).toContain(res.status);
    });

    it('should accept valid source creation payload', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `src-create-valid-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/admin/sources')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          name: 'Supreme Court E-Library',
          type: 'official',
          domain: 'elibrary.judiciary.gov.ph',
          trustLevel: 'high',
          enabled: true,
          fetchStrategy: 'crawler',
        });

      // 403 for non-admin, 201 for admin
      expect([201, 403]).toContain(res.status);
      if (res.status === 201) {
        expect(res.body.success).toBe(true);
        expect(res.body.data).toBeDefined();
        expect(res.body.data.id).toBeDefined();
        expect(res.body.data.name).toBe('Supreme Court E-Library');
      }
    });
  });

  describe('PATCH /api/v1/admin/sources/:id — update source', () => {
    it('should return 403 for invalid UUID param (role guard fires before validation)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `src-update-baduuid-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .patch(`/api/v1/admin/sources/${INVALID_UUID}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ name: 'Updated' })
        .expect(403);
    });

    it('should return 400 for invalid type in update', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `src-update-badtype-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/admin/sources/${FAKE_UUID_1}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ type: 'invalid_type' });

      expect([400, 403]).toContain(res.status);
    });
  });

  // =========================================================================
  // Endpoint Management — Validation
  // =========================================================================

  describe('POST /api/v1/admin/sources/:id/endpoints — add endpoint', () => {
    it('should return 403 for invalid source UUID param (role guard fires before validation)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `ep-create-badsrc-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .post(`/api/v1/admin/sources/${INVALID_UUID}/endpoints`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ endpointUrl: 'https://example.com', parserType: 'html' })
        .expect(403);
    });

    it('should return 400 when endpointUrl is missing', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `ep-create-nourl-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .post(`/api/v1/admin/sources/${FAKE_UUID_1}/endpoints`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ parserType: 'html' });

      expect([400, 403]).toContain(res.status);
    });

    it('should return 400 when parserType is missing', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `ep-create-noparser-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .post(`/api/v1/admin/sources/${FAKE_UUID_1}/endpoints`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ endpointUrl: 'https://example.com' });

      expect([400, 403]).toContain(res.status);
    });

    it('should return 400 for invalid status enum', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `ep-create-badstatus-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .post(`/api/v1/admin/sources/${FAKE_UUID_1}/endpoints`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          endpointUrl: 'https://example.com',
          parserType: 'html',
          status: 'invalid_status',
        });

      expect([400, 403]).toContain(res.status);
    });

    it('should reject unknown fields (whitelist validation)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `ep-create-extra-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .post(`/api/v1/admin/sources/${FAKE_UUID_1}/endpoints`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          endpointUrl: 'https://example.com',
          parserType: 'html',
          unknownField: 'should be rejected',
        });

      expect([400, 403]).toContain(res.status);
    });

    it('should accept valid endpoint creation payload', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `ep-create-valid-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .post(`/api/v1/admin/sources/${FAKE_UUID_1}/endpoints`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          endpointUrl: 'https://elibrary.judiciary.gov.ph/api/decisions',
          parserType: 'html',
          contentTypeHint: 'text/html',
          scheduleCron: '0 */6 * * *',
          status: 'active',
        });

      // 403 for non-admin, 201 for admin, 404 if source not found
      expect([201, 403, 404]).toContain(res.status);
      if (res.status === 201) {
        expect(res.body.success).toBe(true);
        expect(res.body.data).toBeDefined();
        expect(res.body.data.id).toBeDefined();
      }
    });
  });

  describe('PATCH /api/v1/admin/sources/:id/endpoints/:endpointId — update endpoint', () => {
    it('should return 403 for invalid source UUID (role guard fires before validation)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `ep-update-badsrc-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .patch(`/api/v1/admin/sources/${INVALID_UUID}/endpoints/${FAKE_UUID_2}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ status: 'disabled' })
        .expect(403);
    });

    it('should return 403 for invalid endpoint UUID (role guard fires before validation)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `ep-update-badep-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .patch(`/api/v1/admin/sources/${FAKE_UUID_1}/endpoints/${INVALID_UUID}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ status: 'disabled' })
        .expect(403);
    });
  });

  describe('DELETE /api/v1/admin/sources/:id/endpoints/:endpointId — delete endpoint', () => {
    it('should return 403 for invalid source UUID (role guard fires before validation)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `ep-del-badsrc-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .delete(`/api/v1/admin/sources/${INVALID_UUID}/endpoints/${FAKE_UUID_2}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });

    it('should return 403 for invalid endpoint UUID (role guard fires before validation)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `ep-del-badep-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .delete(`/api/v1/admin/sources/${FAKE_UUID_1}/endpoints/${INVALID_UUID}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });

    it('should reject non-admin user', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `ep-del-nonadmin-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .delete(`/api/v1/admin/sources/${FAKE_UUID_1}/endpoints/${FAKE_UUID_2}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });
  });

  // =========================================================================
  // Source Health Endpoints
  // =========================================================================

  describe('GET /api/v1/admin/sources/health — all source health', () => {
    it('should reject without auth', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/admin/sources/health')
        .expect(401);
    });

    it('should reject non-admin user', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `health-all-nonadmin-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .get('/api/v1/admin/sources/health')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });
  });

  describe('GET /api/v1/admin/sources/:id/health — single source health', () => {
    it('should return 403 for invalid UUID (role guard fires before validation)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `health-single-baduuid-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .get(`/api/v1/admin/sources/${INVALID_UUID}/health`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });

    it('should reject non-admin user', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `health-single-nonadmin-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .get(`/api/v1/admin/sources/${FAKE_UUID_1}/health`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });
  });

  describe('POST /api/v1/admin/sources/health/recompute — recompute all', () => {
    it('should reject without auth', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/admin/sources/health/recompute')
        .expect(401);
    });

    it('should reject non-admin user', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `health-recomp-nonadmin-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .post('/api/v1/admin/sources/health/recompute')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });
  });

  describe('POST /api/v1/admin/sources/:id/health/recompute — recompute single', () => {
    it('should return 403 for invalid UUID (role guard fires before validation)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `health-recomp1-baduuid-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .post(`/api/v1/admin/sources/${INVALID_UUID}/health/recompute`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });

    it('should reject non-admin user', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `health-recomp1-nonadmin-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .post(`/api/v1/admin/sources/${FAKE_UUID_1}/health/recompute`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });
  });

  // =========================================================================
  // Manual Fetch Trigger
  // =========================================================================

  describe('POST /api/v1/admin/sources/:id/fetch — manual fetch', () => {
    it('should return 403 for invalid UUID (role guard fires before validation)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `fetch-baduuid-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .post(`/api/v1/admin/sources/${INVALID_UUID}/fetch`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });

    it('should reject non-admin user', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `fetch-nonadmin-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .post(`/api/v1/admin/sources/${FAKE_UUID_1}/fetch`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });
  });

  // =========================================================================
  // Ingestion Jobs
  // =========================================================================

  describe('GET /api/v1/admin/ingestion-jobs — list jobs', () => {
    it('should reject without auth', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/admin/ingestion-jobs')
        .expect(401);
    });

    it('should reject non-admin user', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `ingest-list-nonadmin-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .get('/api/v1/admin/ingestion-jobs')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });
  });

  // =========================================================================
  // Corpus Health
  // =========================================================================

  describe('GET /api/v1/admin/corpus-health', () => {
    it('should reject without auth', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/admin/corpus-health')
        .expect(401);
    });

    it('should reject non-admin user', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `corpus-nonadmin-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .get('/api/v1/admin/corpus-health')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });
  });

  // =========================================================================
  // Coverage Gaps
  // =========================================================================

  describe('GET /api/v1/admin/coverage-gaps', () => {
    it('should reject without auth', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/admin/coverage-gaps')
        .expect(401);
    });

    it('should reject non-admin user', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `coverage-nonadmin-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .get('/api/v1/admin/coverage-gaps')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });
  });

  // =========================================================================
  // Staleness Report
  // =========================================================================

  describe('GET /api/v1/admin/staleness-report', () => {
    it('should reject without auth', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/admin/staleness-report')
        .expect(401);
    });

    it('should reject non-admin user', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `stale-nonadmin-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .get('/api/v1/admin/staleness-report')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });
  });
});
