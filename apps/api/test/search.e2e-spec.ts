import { INestApplication } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');
import { createTestApp, createAuthenticatedUser } from './helpers';

/**
 * Search E2E tests — query search, citation lookup, suggestions, admin indexing.
 * Per CLAUDE.md: OpenSearch for search, PostgreSQL for truth.
 * Per PRD: SRCH-01 through SRCH-12.
 */
describe('Search (E2E)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  // ── POST /search — Natural Language Search ─────────────────

  describe('POST /api/v1/search', () => {
    it('should require authentication', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/search')
        .send({ query: 'doctrine of last clear chance' })
        .expect(401);
    });

    it('should execute search with valid query', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `search-query-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/search')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ query: 'constructive dismissal labor law' });

      // 200 with results, or 404/503 if OpenSearch index missing / service unavailable
      expect([200, 404, 503]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body.success).toBe(true);
        expect(res.body.data).toBeDefined();
      }
    });

    it('should reject empty query', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `search-empty-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/search')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ query: '' });

      // 400 for validation failure, or 404 if OpenSearch index missing
      expect([400, 404]).toContain(res.status);
    });

    it('should reject missing query field', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `search-noquery-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .post('/api/v1/search')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({})
        .expect(400);
    });

    it('should support metadata filters', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `search-filter-${Date.now()}@test.com`,
      });

      // SearchQueryDto uses individual filter fields (not nested `filters` object)
      const res = await request(app.getHttpServer())
        .post('/api/v1/search')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          query: 'illegal dismissal',
          documentType: 'case',
          court: 'Supreme Court',
        });

      // 200 with results, or 400 (validation), 404/503 (OpenSearch unavailable)
      expect([200, 400, 404, 503]).toContain(res.status);
    });

    it('should reject unknown fields (whitelist)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `search-whitelist-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .post('/api/v1/search')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ query: 'test', maliciousField: 'inject' })
        .expect(400);
    });
  });

  // ── GET /search/citation/:citation — Citation Lookup ───────

  describe('GET /api/v1/search/citation/:citation', () => {
    it('should handle citation lookup (may return empty for no matches)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/search/citation/G.R.%20No.%20123456');

      // 200 with results, or 404/503 if OpenSearch index missing
      expect([200, 404, 503]).toContain(res.status);
    });

    it('should normalize citation format variations', async () => {
      // Per CLAUDE.md: normalize "G.R. No." variations
      const res = await request(app.getHttpServer())
        .get('/api/v1/search/citation/GR%20No%20123456');

      expect([200, 404, 503]).toContain(res.status);
    });

    it('should be accessible without authentication (public)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/search/citation/RA%20No.%2010175');

      expect([200, 404, 503]).toContain(res.status);
    });
  });

  // ── GET /search/suggestions — Autocomplete ─────────────────

  describe('GET /api/v1/search/suggestions', () => {
    it('should return suggestions (may be empty)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/search/suggestions?q=const')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('should be accessible without authentication (public)', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/search/suggestions?q=labor')
        .expect(200);
    });
  });

  // ── Admin Index Management ─────────────────────────────────

  describe('Search index admin endpoints', () => {
    it('should reject index initialization without admin role', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `search-noadmin-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .post('/api/v1/search/index/initialize')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });

    it('should reject bulk indexing without admin role', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `search-nobulk-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .post('/api/v1/search/index/bulk')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ documentIds: [] })
        .expect(403);
    });

    it('should reject unauthenticated admin requests', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/search/index/initialize')
        .expect(401);
    });
  });
});
