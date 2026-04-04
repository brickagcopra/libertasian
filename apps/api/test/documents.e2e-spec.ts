import { INestApplication } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');
import { createTestApp, createAuthenticatedUser } from './helpers';

/**
 * Documents E2E tests — document CRUD, sections, citations, related documents.
 * Per PDD: legal_documents is the system of record (PostgreSQL).
 * Per CLAUDE.md: every legal_document must have source_id, never overwrite versions.
 */
describe('Documents (E2E)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  // ── GET /documents — List ──────────────────────────────────

  describe('GET /api/v1/documents', () => {
    it('should return a list of published documents', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `doc-list-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/documents')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('should support pagination', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `doc-page-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/documents?limit=5')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.meta).toBeDefined();
    });

    it('should support filtering by document type', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `doc-filter-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/documents?documentType=case')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
    });

    it('should be publicly accessible (documents are public)', async () => {
      // GET /documents is a public endpoint — no @UseGuards on the list method
      const res = await request(app.getHttpServer())
        .get('/api/v1/documents')
        .expect(200);

      expect(res.body.success).toBe(true);
    });
  });

  // ── GET /documents/:id — Get by ID ─────────────────────────

  describe('GET /api/v1/documents/:id', () => {
    it('should return 404 for non-existent document', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `doc-notfound-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .get('/api/v1/documents/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(404);
    });

    it('should reject invalid UUID format', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `doc-baduuid-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/documents/not-a-uuid')
        .set('Authorization', `Bearer ${user.accessToken}`);

      expect([400, 404]).toContain(res.status);
    });
  });

  // ── GET /documents/:id/sections — Document Sections ────────

  describe('GET /api/v1/documents/:id/sections', () => {
    it('should return 404 for non-existent document sections', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `doc-sections-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .get('/api/v1/documents/00000000-0000-0000-0000-000000000000/sections')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(404);
    });
  });

  // ── GET /documents/:id/citations ───────────────────────────

  describe('GET /api/v1/documents/:id/citations', () => {
    it('should return 404 for non-existent document citations', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `doc-citations-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .get('/api/v1/documents/00000000-0000-0000-0000-000000000000/citations')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(404);
    });
  });

  // ── GET /documents/:id/related ─────────────────────────────

  describe('GET /api/v1/documents/:id/related', () => {
    it('should return 404 for non-existent document related', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `doc-related-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .get('/api/v1/documents/00000000-0000-0000-0000-000000000000/related')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(404);
    });
  });

  // ── Admin Document Management ──────────────────────────────

  describe('Admin document endpoints', () => {
    it('should reject document creation without admin role', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `doc-noadmin-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .post('/api/v1/documents')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          title: 'Test Document',
          documentType: 'case',
          jurisdiction: 'PH',
        })
        .expect(403);
    });

    it('should reject publish without admin role', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `doc-nopub-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .post('/api/v1/documents/00000000-0000-0000-0000-000000000000/publish')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });

    it('should reject quarantine without admin role', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `doc-noqt-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .post('/api/v1/documents/00000000-0000-0000-0000-000000000000/quarantine')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });

    it('should reject unauthenticated admin requests', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/documents')
        .send({ title: 'No Auth', documentType: 'case' })
        .expect(401);
    });
  });

  // ── Classification Review Queue ────────────────────────────

  describe('Classification endpoints', () => {
    it('should reject review queue access without admin role', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `class-noadmin-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .get('/api/v1/admin/classification/review-queue')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });

    it('should reject classification stats without admin role', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `class-nostats-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .get('/api/v1/admin/classification/stats')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });
  });
});
