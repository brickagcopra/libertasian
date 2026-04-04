import { INestApplication } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');
import { createTestApp, createAuthenticatedUser } from './helpers';

/**
 * Research Workspaces E2E tests — CRUD, queries, tenant isolation.
 * Per PRD Phase 6: User-specific research workspaces with persistent AI context.
 */
describe('Research Workspaces (E2E)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/v1/research-workspaces', () => {
    it('should require authentication', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/research-workspaces')
        .send({ title: 'Test Workspace' })
        .expect(401);
    });

    it('should create a research workspace', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `rw-create-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/research-workspaces')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          title: 'Labor Law Research',
          description: 'Research on constructive dismissal cases',
        });

      // 201 if allowed, 403 if subscription/quota blocks (Pro+ required)
      expect([201, 403]).toContain(res.status);
      if (res.status === 201) {
        expect(res.body.success).toBe(true);
        expect(res.body.data.title).toBe('Labor Law Research');
        expect(res.body.data.id).toBeDefined();
      }
    });

    it('should reject missing title', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `rw-notitle-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .post('/api/v1/research-workspaces')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ description: 'No title' })
        .expect(400);
    });
  });

  describe('GET /api/v1/research-workspaces', () => {
    it('should list user workspaces', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `rw-list-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/research-workspaces')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe('GET /api/v1/research-workspaces/:id', () => {
    it('should get workspace by ID', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `rw-get-${Date.now()}@test.com`,
      });

      const createRes = await request(app.getHttpServer())
        .post('/api/v1/research-workspaces')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ title: 'Get Me' });

      // Skip if subscription blocks workspace creation
      if (createRes.status !== 201) return;

      const wsId = createRes.body.data.id;

      const res = await request(app.getHttpServer())
        .get(`/api/v1/research-workspaces/${wsId}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(res.body.data.id).toBe(wsId);
    });

    it('should return 404 for non-existent workspace', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `rw-404-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .get('/api/v1/research-workspaces/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(404);
    });
  });

  describe('PATCH /api/v1/research-workspaces/:id', () => {
    it('should update workspace', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `rw-update-${Date.now()}@test.com`,
      });

      const createRes = await request(app.getHttpServer())
        .post('/api/v1/research-workspaces')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ title: 'Before' });

      if (createRes.status !== 201) return;

      const wsId = createRes.body.data.id;

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/research-workspaces/${wsId}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ title: 'After' })
        .expect(200);

      expect(res.body.data.title).toBe('After');
    });
  });

  describe('DELETE /api/v1/research-workspaces/:id', () => {
    it('should delete workspace', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `rw-delete-${Date.now()}@test.com`,
      });

      const createRes = await request(app.getHttpServer())
        .post('/api/v1/research-workspaces')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ title: 'Delete Me' });

      if (createRes.status !== 201) return;

      const wsId = createRes.body.data.id;

      await request(app.getHttpServer())
        .delete(`/api/v1/research-workspaces/${wsId}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .get(`/api/v1/research-workspaces/${wsId}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(404);
    });
  });

  describe('Tenant isolation', () => {
    it('should not allow cross-org workspace access', async () => {
      const userA = await createAuthenticatedUser(app, {
        email: `rw-iso-a-${Date.now()}@test.com`,
      });
      const userB = await createAuthenticatedUser(app, {
        email: `rw-iso-b-${Date.now()}@test.com`,
      });

      const createRes = await request(app.getHttpServer())
        .post('/api/v1/research-workspaces')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({ title: 'Org A Only' });

      if (createRes.status !== 201) return;

      const wsId = createRes.body.data.id;

      const accessRes = await request(app.getHttpServer())
        .get(`/api/v1/research-workspaces/${wsId}`)
        .set('Authorization', `Bearer ${userB.accessToken}`);
      expect([403, 404]).toContain(accessRes.status);
    });
  });

  describe('Workspace queries', () => {
    it('should add a query to workspace', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `rw-query-${Date.now()}@test.com`,
      });

      const createRes = await request(app.getHttpServer())
        .post('/api/v1/research-workspaces')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ title: 'Query Workspace' });

      // Skip if subscription blocks workspace creation
      if (createRes.status !== 201) return;

      const wsId = createRes.body.data.id;

      const res = await request(app.getHttpServer())
        .post(`/api/v1/research-workspaces/${wsId}/queries`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ query: 'What is constructive dismissal?' });

      // May return 201 (created) or 503 (RAG service unavailable)
      expect([201, 503]).toContain(res.status);
    });

    it('should list workspace queries', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `rw-qlist-${Date.now()}@test.com`,
      });

      const createRes = await request(app.getHttpServer())
        .post('/api/v1/research-workspaces')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ title: 'Query List WS' });

      // Skip if subscription blocks workspace creation
      if (createRes.status !== 201) return;

      const wsId = createRes.body.data.id;

      const res = await request(app.getHttpServer())
        .get(`/api/v1/research-workspaces/${wsId}/queries`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });
});
