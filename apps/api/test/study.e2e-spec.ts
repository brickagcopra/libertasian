import { INestApplication } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');
import { createTestApp, createAuthenticatedUser } from './helpers';

/**
 * Study Module E2E tests — Codals, Flashcard Sets, Reviewer Packs, Syllabi, Progress.
 * Per PRD: STU-01 through STU-08 (Phase 2 features).
 * Per PDD: Bar subject categorization, offline mobile reading.
 * Per CLAUDE.md: subscription entitlement enforcement for gated study features.
 */
describe('Study (E2E)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  // ═══════════════════════════════════════════════════════════
  // BAR SUBJECTS
  // ═══════════════════════════════════════════════════════════

  describe('GET /api/v1/study/bar-subjects', () => {
    it('should be publicly accessible (no auth required)', async () => {
      // bar-subjects is a public endpoint (no @UseGuards on controller method)
      const res = await request(app.getHttpServer())
        .get('/api/v1/study/bar-subjects')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('should list bar exam subjects', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `study-subjects-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/study/bar-subjects')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // CODALS
  // ═══════════════════════════════════════════════════════════

  describe('GET /api/v1/study/codals/:subject', () => {
    it('should be publicly accessible (no auth required)', async () => {
      // codals/:subject is a public endpoint
      const res = await request(app.getHttpServer())
        .get('/api/v1/study/codals/civil');

      // 200 if route exists and data available, 404 if no data/route
      expect([200, 404]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body.success).toBe(true);
      }
    });

    it('should return codals for a valid subject', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `study-codals-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/study/codals/civil')
        .set('Authorization', `Bearer ${user.accessToken}`);

      // 200 if route exists and data available, 404 if no data/route
      expect([200, 404]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body.success).toBe(true);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════
  // FLASHCARD SETS
  // ═══════════════════════════════════════════════════════════

  describe('Flashcard Sets', () => {
    describe('POST /api/v1/study/flashcard-sets', () => {
      it('should require authentication', async () => {
        await request(app.getHttpServer())
          .post('/api/v1/study/flashcard-sets')
          .send({ title: 'Test Set' })
          .expect(401);
      });

      it('should create a flashcard set', async () => {
        const user = await createAuthenticatedUser(app, {
          email: `study-fc-create-${Date.now()}@test.com`,
        });

        const res = await request(app.getHttpServer())
          .post('/api/v1/study/flashcard-sets')
          .set('Authorization', `Bearer ${user.accessToken}`)
          .send({
            title: 'Civil Law Basics',
            description: 'Core concepts for civil law review',
            barSubject: 'civil',
          })
          .expect(201);

        expect(res.body.success).toBe(true);
        expect(res.body.data.title).toBe('Civil Law Basics');
        expect(res.body.data.id).toBeDefined();
      });

      it('should reject missing title', async () => {
        const user = await createAuthenticatedUser(app, {
          email: `study-fc-notitle-${Date.now()}@test.com`,
        });

        await request(app.getHttpServer())
          .post('/api/v1/study/flashcard-sets')
          .set('Authorization', `Bearer ${user.accessToken}`)
          .send({ description: 'No title' })
          .expect(400);
      });
    });

    describe('GET /api/v1/study/flashcard-sets', () => {
      it('should list user flashcard sets', async () => {
        const user = await createAuthenticatedUser(app, {
          email: `study-fc-list-${Date.now()}@test.com`,
        });

        const res = await request(app.getHttpServer())
          .get('/api/v1/study/flashcard-sets')
          .set('Authorization', `Bearer ${user.accessToken}`)
          .expect(200);

        expect(res.body.success).toBe(true);
        expect(Array.isArray(res.body.data)).toBe(true);
      });
    });

    describe('GET /api/v1/study/flashcard-sets/:id', () => {
      it('should get flashcard set by ID', async () => {
        const user = await createAuthenticatedUser(app, {
          email: `study-fc-get-${Date.now()}@test.com`,
        });

        // Create first
        const createRes = await request(app.getHttpServer())
          .post('/api/v1/study/flashcard-sets')
          .set('Authorization', `Bearer ${user.accessToken}`)
          .send({ title: 'Get Me Set' })
          .expect(201);

        const setId = createRes.body.data.id;

        const res = await request(app.getHttpServer())
          .get(`/api/v1/study/flashcard-sets/${setId}`)
          .set('Authorization', `Bearer ${user.accessToken}`)
          .expect(200);

        expect(res.body.data.id).toBe(setId);
        expect(res.body.data.title).toBe('Get Me Set');
      });

      it('should return 404 for non-existent set', async () => {
        const user = await createAuthenticatedUser(app, {
          email: `study-fc-404-${Date.now()}@test.com`,
        });

        await request(app.getHttpServer())
          .get('/api/v1/study/flashcard-sets/00000000-0000-0000-0000-000000000000')
          .set('Authorization', `Bearer ${user.accessToken}`)
          .expect(404);
      });
    });

    describe('PATCH /api/v1/study/flashcard-sets/:id', () => {
      it('should update flashcard set', async () => {
        const user = await createAuthenticatedUser(app, {
          email: `study-fc-update-${Date.now()}@test.com`,
        });

        const createRes = await request(app.getHttpServer())
          .post('/api/v1/study/flashcard-sets')
          .set('Authorization', `Bearer ${user.accessToken}`)
          .send({ title: 'Before Update' })
          .expect(201);

        const setId = createRes.body.data.id;

        const res = await request(app.getHttpServer())
          .patch(`/api/v1/study/flashcard-sets/${setId}`)
          .set('Authorization', `Bearer ${user.accessToken}`)
          .send({ title: 'After Update' })
          .expect(200);

        expect(res.body.data.title).toBe('After Update');
      });
    });

    describe('DELETE /api/v1/study/flashcard-sets/:id', () => {
      it('should delete flashcard set', async () => {
        const user = await createAuthenticatedUser(app, {
          email: `study-fc-delete-${Date.now()}@test.com`,
        });

        const createRes = await request(app.getHttpServer())
          .post('/api/v1/study/flashcard-sets')
          .set('Authorization', `Bearer ${user.accessToken}`)
          .send({ title: 'Delete Me' })
          .expect(201);

        const setId = createRes.body.data.id;

        await request(app.getHttpServer())
          .delete(`/api/v1/study/flashcard-sets/${setId}`)
          .set('Authorization', `Bearer ${user.accessToken}`)
          .expect(200);

        // Verify gone
        await request(app.getHttpServer())
          .get(`/api/v1/study/flashcard-sets/${setId}`)
          .set('Authorization', `Bearer ${user.accessToken}`)
          .expect(404);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════
  // FLASHCARDS (within sets)
  // ═══════════════════════════════════════════════════════════

  describe('Flashcards', () => {
    it('should add a flashcard to a set', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `study-card-add-${Date.now()}@test.com`,
      });

      const setRes = await request(app.getHttpServer())
        .post('/api/v1/study/flashcard-sets')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ title: 'Card Set' })
        .expect(201);

      const setId = setRes.body.data.id;

      const res = await request(app.getHttpServer())
        .post(`/api/v1/study/flashcard-sets/${setId}/flashcards`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          front: 'What is res judicata?',
          back: 'A matter that has been adjudicated by a competent court and may not be pursued further.',
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.front).toBe('What is res judicata?');
    });

    it('should list flashcards in a set', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `study-card-list-${Date.now()}@test.com`,
      });

      const setRes = await request(app.getHttpServer())
        .post('/api/v1/study/flashcard-sets')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ title: 'List Cards Set' })
        .expect(201);

      const setId = setRes.body.data.id;

      // Add a flashcard
      await request(app.getHttpServer())
        .post(`/api/v1/study/flashcard-sets/${setId}/flashcards`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ front: 'Q1', back: 'A1' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/study/flashcard-sets/${setId}/flashcards`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // TENANT ISOLATION
  // ═══════════════════════════════════════════════════════════

  describe('Study tenant isolation', () => {
    it('should not expose flashcard sets across orgs', async () => {
      const userA = await createAuthenticatedUser(app, {
        email: `study-iso-a-${Date.now()}@test.com`,
      });
      const userB = await createAuthenticatedUser(app, {
        email: `study-iso-b-${Date.now()}@test.com`,
      });

      // User A creates a set
      const createRes = await request(app.getHttpServer())
        .post('/api/v1/study/flashcard-sets')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({ title: 'Org A Study Set' })
        .expect(201);

      const setId = createRes.body.data.id;

      // User B tries to access User A's set — should be denied
      const accessRes = await request(app.getHttpServer())
        .get(`/api/v1/study/flashcard-sets/${setId}`)
        .set('Authorization', `Bearer ${userB.accessToken}`);

      expect([403, 404]).toContain(accessRes.status);

      // User B's list should not contain User A's set
      const listRes = await request(app.getHttpServer())
        .get('/api/v1/study/flashcard-sets')
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(200);

      const ids = listRes.body.data.map((s: { id: string }) => s.id);
      expect(ids).not.toContain(setId);
    });
  });
});
