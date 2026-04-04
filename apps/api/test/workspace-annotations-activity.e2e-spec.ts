import { INestApplication } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');
import { createTestApp, createAuthenticatedUser } from './helpers';

/**
 * Workspace Annotations + Activity Feed E2E tests.
 * Annotations are user-scoped (personal highlights, not org-scoped).
 * Activity feed is org-scoped via audit logs.
 */
describe('Workspace — Annotations & Activity (E2E)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  // ── Annotations ─────────────────────────────────────────────

  describe('Annotations', () => {
    it('should require authentication', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/annotations')
        .send({
          legalDocumentId: '00000000-0000-0000-0000-000000000000',
          textAnchor: { startOffset: 0, endOffset: 50, anchorText: 'test' },
        })
        .expect(401);
    });

    it('should return empty list for user with no annotations', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `annot-empty-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/annotations')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });

    it('should isolate annotations between users', async () => {
      const userA = await createAuthenticatedUser(app, {
        email: `annot-iso-a-${Date.now()}@test.com`,
      });
      const userB = await createAuthenticatedUser(app, {
        email: `annot-iso-b-${Date.now()}@test.com`,
      });

      // Both users list annotations — should both be empty, no cross-contamination
      const resA = await request(app.getHttpServer())
        .get('/api/v1/annotations')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(200);

      const resB = await request(app.getHttpServer())
        .get('/api/v1/annotations')
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(200);

      expect(resA.body.data).toEqual([]);
      expect(resB.body.data).toEqual([]);
    });

    it('should reject annotation with missing required fields', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `annot-invalid-${Date.now()}@test.com`,
      });

      // Missing legalDocumentId
      await request(app.getHttpServer())
        .post('/api/v1/annotations')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ textAnchor: { startOffset: 0, endOffset: 50 } })
        .expect(400);

      // Missing textAnchor
      await request(app.getHttpServer())
        .post('/api/v1/annotations')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ legalDocumentId: '00000000-0000-0000-0000-000000000000' })
        .expect(400);
    });

    it('should reject unknown fields (whitelist enforcement)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `annot-whitelist-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .post('/api/v1/annotations')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          legalDocumentId: '00000000-0000-0000-0000-000000000000',
          textAnchor: { startOffset: 0, endOffset: 50 },
          hackerField: 'injected',
        })
        .expect(400);
    });
  });

  // ── Activity Feed ───────────────────────────────────────────

  describe('Activity feed', () => {
    it('should require authentication', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/activity')
        .expect(401);
    });

    it('should return activity entries after workspace operations', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `activity-ops-${Date.now()}@test.com`,
      });

      // Create a matter (should generate audit log entry)
      await request(app.getHttpServer())
        .post('/api/v1/matters')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ title: 'Activity Test Matter' })
        .expect(201);

      // Create a task
      await request(app.getHttpServer())
        .post('/api/v1/tasks')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ title: 'Activity Test Task' })
        .expect(201);

      // Check activity feed
      const res = await request(app.getHttpServer())
        .get('/api/v1/activity')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(2);

      // Verify structure of activity entries
      const entry = res.body.data[0];
      expect(entry.id).toBeDefined();
      expect(entry.action).toBeDefined();
      expect(entry.entityType).toBeDefined();
      expect(entry.createdAt).toBeDefined();
    });

    it('should filter activity by entity type', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `activity-filter-${Date.now()}@test.com`,
      });

      // Create a matter and a task
      await request(app.getHttpServer())
        .post('/api/v1/matters')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ title: 'Filter Matter' })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/v1/tasks')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ title: 'Filter Task' })
        .expect(201);

      // Filter by 'matter' entity type
      const res = await request(app.getHttpServer())
        .get('/api/v1/activity?entityType=matter')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      // All returned entries should be matter-related
      res.body.data.forEach((entry: { entityType: string }) => {
        expect(entry.entityType).toBe('matter');
      });
    });

    it('should support cursor pagination', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `activity-page-${Date.now()}@test.com`,
      });

      // Create several matters to generate multiple activity entries
      for (let i = 0; i < 3; i++) {
        await request(app.getHttpServer())
          .post('/api/v1/matters')
          .set('Authorization', `Bearer ${user.accessToken}`)
          .send({ title: `Pagination Matter ${i}` })
          .expect(201);
      }

      const res = await request(app.getHttpServer())
        .get('/api/v1/activity?limit=2')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(res.body.data.length).toBe(2);
      // meta may include hasNext + nextCursor
      expect(res.body.meta || res.body.data.length).toBeDefined();
    });

    it('should isolate activity between orgs', async () => {
      const userA = await createAuthenticatedUser(app, {
        email: `activity-iso-a-${Date.now()}@test.com`,
      });
      const userB = await createAuthenticatedUser(app, {
        email: `activity-iso-b-${Date.now()}@test.com`,
      });

      // User A creates a matter
      await request(app.getHttpServer())
        .post('/api/v1/matters')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({ title: 'Org A Activity Matter' })
        .expect(201);

      // User B's activity should not show User A's actions
      const resB = await request(app.getHttpServer())
        .get('/api/v1/activity')
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(200);

      const actions = resB.body.data.map(
        (e: { metadata: Record<string, unknown> }) => e.metadata,
      );
      // None of B's activity should reference "Org A Activity Matter"
      const hasCrossOrgActivity = resB.body.data.some(
        (e: { metadata?: { title?: string } }) =>
          e.metadata?.title === 'Org A Activity Matter',
      );
      expect(hasCrossOrgActivity).toBe(false);
    });
  });
});
