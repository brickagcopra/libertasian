import { INestApplication } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');
import { createTestApp, createAuthenticatedUser } from './helpers';

/**
 * RBAC Enforcement E2E Tests — Session 91
 *
 * Per CLAUDE.md: role-based access control must be tested across all modules.
 * These tests verify that non-authorized roles are denied (403) and that
 * unauthenticated requests are denied (401) on all protected endpoints.
 */
describe('RBAC Enforcement (E2E)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  // ─── Auth enforcement (401) ──────────────────────────────────────────────

  describe('Unauthenticated access — should return 401', () => {
    const protectedEndpoints = [
      { method: 'get', path: '/api/v1/bookmarks' },
      { method: 'get', path: '/api/v1/digests' },
      { method: 'get', path: '/api/v1/uploads' },
      { method: 'get', path: '/api/v1/matters' },
      { method: 'get', path: '/api/v1/notes' },
      { method: 'get', path: '/api/v1/organizations/me' },
      { method: 'get', path: '/api/v1/users/me' },
      { method: 'get', path: '/api/v1/auth/sessions' },
      { method: 'get', path: '/api/v1/admin/sources' },
      { method: 'get', path: '/api/v1/admin/review-queue' },
      { method: 'get', path: '/api/v1/admin/corpus-health' },
      { method: 'get', path: '/api/v1/api-keys' },
      { method: 'post', path: '/api/v1/api-keys' },
      { method: 'post', path: '/api/v1/auth/logout' },
      { method: 'post', path: '/api/v1/auth/mfa/enroll' },
    ];

    protectedEndpoints.forEach(({ method, path }) => {
      it(`should deny ${method.toUpperCase()} ${path} without token`, async () => {
        const req = (request(app.getHttpServer()) as Record<string, Function>)[method](path);
        await req.expect(401);
      });
    });
  });

  // ─── Admin endpoints — role enforcement (403) ────────────────────────────

  describe('Admin Sources — requires admin/editor role', () => {
    it('should deny regular member access to GET /admin/sources', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `rbac-src-${Date.now()}@test.com`,
      });
      await request(app.getHttpServer())
        .get('/api/v1/admin/sources')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });

    it('should deny regular member access to POST /admin/sources', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `rbac-src2-${Date.now()}@test.com`,
      });
      await request(app.getHttpServer())
        .post('/api/v1/admin/sources')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ name: 'Test', type: 'official', domain: 'test.gov.ph' })
        .expect(403);
    });
  });

  describe('Admin Review Queue — requires admin/editor/reviewer role', () => {
    it('should deny regular member access to GET /admin/review-queue', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `rbac-rq-${Date.now()}@test.com`,
      });
      await request(app.getHttpServer())
        .get('/api/v1/admin/review-queue')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });

    it('should deny regular member access to review-stats', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `rbac-rs-${Date.now()}@test.com`,
      });
      await request(app.getHttpServer())
        .get('/api/v1/admin/digests/review-stats')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });
  });

  describe('Admin Corpus Health — requires admin/editor role', () => {
    it('should deny regular member access to corpus health', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `rbac-ch-${Date.now()}@test.com`,
      });
      await request(app.getHttpServer())
        .get('/api/v1/admin/corpus-health')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });
  });

  describe('Admin Duplicates — requires admin/editor role', () => {
    it('should deny regular member access to GET /admin/duplicates', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `rbac-dup-${Date.now()}@test.com`,
      });
      await request(app.getHttpServer())
        .get('/api/v1/admin/duplicates')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });

    it('should deny regular member access to POST /admin/duplicates/detect', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `rbac-dup2-${Date.now()}@test.com`,
      });
      await request(app.getHttpServer())
        .post('/api/v1/admin/duplicates/detect')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });

    it('should deny regular member access to duplicate stats', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `rbac-dup3-${Date.now()}@test.com`,
      });
      await request(app.getHttpServer())
        .get('/api/v1/admin/duplicates/stats')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });
  });

  describe('Admin Doctrines — requires admin/editor role', () => {
    it('should deny regular member access to admin doctrine endpoints', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `rbac-doc-${Date.now()}@test.com`,
      });
      await request(app.getHttpServer())
        .get('/api/v1/admin/doctrines')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });

    it('should deny regular member access to doctrine extraction', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `rbac-doc2-${Date.now()}@test.com`,
      });
      await request(app.getHttpServer())
        .post('/api/v1/admin/doctrines/extract')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ documentId: '00000000-0000-0000-0000-000000000000' })
        .expect(403);
    });
  });

  describe('Admin Knowledge Graph — requires admin/editor role', () => {
    it('should deny regular member access to admin knowledge graph', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `rbac-kg-${Date.now()}@test.com`,
      });
      await request(app.getHttpServer())
        .post('/api/v1/admin/knowledge-graph/resolve-citations/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });
  });

  describe('Documents — CRUD role enforcement', () => {
    it('should deny regular member access to POST /documents', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `rbac-docr-${Date.now()}@test.com`,
      });
      await request(app.getHttpServer())
        .post('/api/v1/documents')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          title: 'Test Document',
          documentType: 'case',
          sourceId: '00000000-0000-0000-0000-000000000000',
        })
        .expect(403);
    });

    it('should deny regular member access to PATCH /documents/:id', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `rbac-docr2-${Date.now()}@test.com`,
      });
      await request(app.getHttpServer())
        .patch('/api/v1/documents/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ title: 'Updated' })
        .expect(403);
    });

    it('should deny regular member access to publish document', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `rbac-docr3-${Date.now()}@test.com`,
      });
      await request(app.getHttpServer())
        .post('/api/v1/documents/00000000-0000-0000-0000-000000000000/publish')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });

    it('should deny regular member access to quarantine document', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `rbac-docr4-${Date.now()}@test.com`,
      });
      await request(app.getHttpServer())
        .post('/api/v1/documents/00000000-0000-0000-0000-000000000000/quarantine')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });
  });

  describe('Search — admin index management role enforcement', () => {
    it('should deny regular member access to search index initialization', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `rbac-si-${Date.now()}@test.com`,
      });
      await request(app.getHttpServer())
        .post('/api/v1/search/index/initialize')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });

    it('should deny regular member access to bulk index', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `rbac-si2-${Date.now()}@test.com`,
      });
      await request(app.getHttpServer())
        .post('/api/v1/search/index/bulk')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ documentIds: [] })
        .expect(403);
    });
  });

  describe('API Keys — requires enterprise subscription + owner/admin role', () => {
    it('should deny regular member access to create API keys (role check)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `rbac-ak-${Date.now()}@test.com`,
      });
      await request(app.getHttpServer())
        .post('/api/v1/api-keys')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ name: 'Test Key', permissions: ['search'] })
        .expect(403);
    });

    it('should deny regular member access to list API keys', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `rbac-ak2-${Date.now()}@test.com`,
      });
      await request(app.getHttpServer())
        .get('/api/v1/api-keys')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });
  });

  describe('Uploads — admin backfill requires admin role', () => {
    it('should deny regular member access to search backfill', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `rbac-ub-${Date.now()}@test.com`,
      });
      await request(app.getHttpServer())
        .post('/api/v1/uploads/search/backfill')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });
  });

  // ─── Public endpoints — should allow unauthenticated access ──────────────

  describe('Public endpoints — should allow access without auth', () => {
    it('should allow unauthenticated access to GET /documents', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/documents')
        .expect(200);
      expect(res.body.success).toBe(true);
    });

    it('should allow unauthenticated access to citation search', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/search/citation/G.R.%20No.%20123456');
      // 200 with results, or 404/503 if OpenSearch index not available
      expect([200, 404, 503]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body.success).toBe(true);
      }
    });

    it('should allow unauthenticated access to search suggestions', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/search/suggestions?q=test')
        .expect(200);
      expect(res.body.success).toBe(true);
    });
  });

  // ─── Authenticated but non-admin — should allow basic features ───────────

  describe('Authenticated member — should access basic features', () => {
    it('should allow member to list their own bookmarks', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `rbac-mbr-${Date.now()}@test.com`,
      });
      const res = await request(app.getHttpServer())
        .get('/api/v1/bookmarks')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);
      expect(res.body.success).toBe(true);
    });

    it('should allow member to list their own digests', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `rbac-mbr2-${Date.now()}@test.com`,
      });
      const res = await request(app.getHttpServer())
        .get('/api/v1/digests')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);
      expect(res.body.success).toBe(true);
    });

    it('should allow member to list their own uploads', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `rbac-mbr3-${Date.now()}@test.com`,
      });
      const res = await request(app.getHttpServer())
        .get('/api/v1/uploads')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);
      expect(res.body.success).toBe(true);
    });

    it('should allow member to list their own matters', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `rbac-mbr4-${Date.now()}@test.com`,
      });
      const res = await request(app.getHttpServer())
        .get('/api/v1/matters')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);
      expect(res.body.success).toBe(true);
    });

    it('should allow member to view their profile', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `rbac-mbr5-${Date.now()}@test.com`,
      });
      const res = await request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.email).toBe(user.email);
    });
  });

  // ─── Internal API guard ──────────────────────────────────────────────────

  describe('Internal API endpoints — X-Internal-Api-Key enforcement', () => {
    it('should deny access to internal index endpoint without internal key', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/search/internal/index/00000000-0000-0000-0000-000000000000')
        .expect(401);
    });

    it('should deny access with invalid internal key', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/search/internal/index/00000000-0000-0000-0000-000000000000')
        .set('X-Internal-Api-Key', 'wrong-key')
        .expect(401);
    });
  });
});
