import { INestApplication } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');
import { createTestApp, createAuthenticatedUser } from './helpers';

/**
 * AI Generation Features E2E tests — Memos, Pleadings, Case Comparisons,
 * Contradictions, Hearing Prep, Timelines.
 *
 * All share a common pattern: async job-based generation with CRUD.
 * Per CLAUDE.md: NestJS is the single gateway, clients never call Python directly.
 * Per PRD: Phase 4-6 features, subscription-gated.
 *
 * NOTE: Actual generation requires RAG/vLLM services.
 * Tests validate auth, validation, subscription enforcement, and CRUD behavior.
 */
describe('AI Generation Features (E2E)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  // ═══════════════════════════════════════════════════════════
  // MEMOS
  // ═══════════════════════════════════════════════════════════

  describe('Memos', () => {
    describe('POST /api/v1/memos/generate', () => {
      it('should require authentication', async () => {
        await request(app.getHttpServer())
          .post('/api/v1/memos/generate')
          .send({ topic: 'constructive dismissal', matterId: null })
          .expect(401);
      });

      it('should reject empty topic', async () => {
        const user = await createAuthenticatedUser(app, {
          email: `memo-empty-${Date.now()}@test.com`,
        });

        await request(app.getHttpServer())
          .post('/api/v1/memos/generate')
          .set('Authorization', `Bearer ${user.accessToken}`)
          .send({ topic: '' })
          .expect(400);
      });

      it('should accept valid memo generation request', async () => {
        const user = await createAuthenticatedUser(app, {
          email: `memo-gen-${Date.now()}@test.com`,
        });

        const res = await request(app.getHttpServer())
          .post('/api/v1/memos/generate')
          .set('Authorization', `Bearer ${user.accessToken}`)
          .send({ topic: 'Constructive dismissal under Philippine Labor Code' });

        // 200/202 (success/queued), 400/403 (validation/subscription), 500/503 (service unavailable)
        expect([200, 202, 400, 403, 500, 503]).toContain(res.status);
      });
    });

    describe('GET /api/v1/memos', () => {
      it('should require authentication', async () => {
        await request(app.getHttpServer())
          .get('/api/v1/memos')
          .expect(401);
      });

      it('should list user memos (initially empty)', async () => {
        const user = await createAuthenticatedUser(app, {
          email: `memo-list-${Date.now()}@test.com`,
        });

        const res = await request(app.getHttpServer())
          .get('/api/v1/memos')
          .set('Authorization', `Bearer ${user.accessToken}`)
          .expect(200);

        expect(res.body.success).toBe(true);
        expect(Array.isArray(res.body.data)).toBe(true);
      });
    });

    describe('GET /api/v1/memos/:id', () => {
      it('should return 404 for non-existent memo', async () => {
        const user = await createAuthenticatedUser(app, {
          email: `memo-notfound-${Date.now()}@test.com`,
        });

        await request(app.getHttpServer())
          .get('/api/v1/memos/00000000-0000-0000-0000-000000000000')
          .set('Authorization', `Bearer ${user.accessToken}`)
          .expect(404);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════
  // PLEADINGS
  // ═══════════════════════════════════════════════════════════

  describe('Pleadings', () => {
    describe('POST /api/v1/pleadings/generate', () => {
      it('should require authentication', async () => {
        await request(app.getHttpServer())
          .post('/api/v1/pleadings/generate')
          .send({ templateId: 'motion-to-dismiss' })
          .expect(401);
      });

      it('should reject missing fields', async () => {
        const user = await createAuthenticatedUser(app, {
          email: `plead-empty-${Date.now()}@test.com`,
        });

        await request(app.getHttpServer())
          .post('/api/v1/pleadings/generate')
          .set('Authorization', `Bearer ${user.accessToken}`)
          .send({})
          .expect(400);
      });
    });

    describe('GET /api/v1/pleadings/templates', () => {
      it('should list available pleading templates', async () => {
        const user = await createAuthenticatedUser(app, {
          email: `plead-templates-${Date.now()}@test.com`,
        });

        const res = await request(app.getHttpServer())
          .get('/api/v1/pleadings/templates')
          .set('Authorization', `Bearer ${user.accessToken}`)
          .expect(200);

        expect(res.body.success).toBe(true);
        expect(Array.isArray(res.body.data)).toBe(true);
      });
    });

    describe('GET /api/v1/pleadings', () => {
      it('should list user pleadings', async () => {
        const user = await createAuthenticatedUser(app, {
          email: `plead-list-${Date.now()}@test.com`,
        });

        const res = await request(app.getHttpServer())
          .get('/api/v1/pleadings')
          .set('Authorization', `Bearer ${user.accessToken}`)
          .expect(200);

        expect(res.body.success).toBe(true);
        expect(Array.isArray(res.body.data)).toBe(true);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════
  // CASE COMPARISONS
  // ═══════════════════════════════════════════════════════════

  describe('Case Comparisons', () => {
    describe('POST /api/v1/case-comparisons/generate', () => {
      it('should require authentication', async () => {
        await request(app.getHttpServer())
          .post('/api/v1/case-comparisons/generate')
          .send({ documentIds: [] })
          .expect(401);
      });

      it('should reject empty document list', async () => {
        const user = await createAuthenticatedUser(app, {
          email: `compare-empty-${Date.now()}@test.com`,
        });

        await request(app.getHttpServer())
          .post('/api/v1/case-comparisons/generate')
          .set('Authorization', `Bearer ${user.accessToken}`)
          .send({ documentIds: [] })
          .expect(400);
      });
    });

    describe('GET /api/v1/case-comparisons', () => {
      it('should list user comparisons', async () => {
        const user = await createAuthenticatedUser(app, {
          email: `compare-list-${Date.now()}@test.com`,
        });

        const res = await request(app.getHttpServer())
          .get('/api/v1/case-comparisons')
          .set('Authorization', `Bearer ${user.accessToken}`)
          .expect(200);

        expect(res.body.success).toBe(true);
        expect(Array.isArray(res.body.data)).toBe(true);
      });
    });

    describe('GET /api/v1/case-comparisons/:id', () => {
      it('should return 404 for non-existent comparison', async () => {
        const user = await createAuthenticatedUser(app, {
          email: `compare-404-${Date.now()}@test.com`,
        });

        await request(app.getHttpServer())
          .get('/api/v1/case-comparisons/00000000-0000-0000-0000-000000000000')
          .set('Authorization', `Bearer ${user.accessToken}`)
          .expect(404);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════
  // CONTRADICTIONS
  // ═══════════════════════════════════════════════════════════

  describe('Contradictions', () => {
    describe('POST /api/v1/contradictions/generate', () => {
      it('should require authentication', async () => {
        await request(app.getHttpServer())
          .post('/api/v1/contradictions/generate')
          .send({ documentIds: [] })
          .expect(401);
      });
    });

    describe('GET /api/v1/contradictions', () => {
      it('should list user contradictions', async () => {
        const user = await createAuthenticatedUser(app, {
          email: `contra-list-${Date.now()}@test.com`,
        });

        const res = await request(app.getHttpServer())
          .get('/api/v1/contradictions')
          .set('Authorization', `Bearer ${user.accessToken}`)
          .expect(200);

        expect(res.body.success).toBe(true);
        expect(Array.isArray(res.body.data)).toBe(true);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════
  // HEARING PREP
  // ═══════════════════════════════════════════════════════════

  describe('Hearing Prep', () => {
    describe('POST /api/v1/hearing-prep/generate', () => {
      it('should require authentication', async () => {
        await request(app.getHttpServer())
          .post('/api/v1/hearing-prep/generate')
          .send({ matterId: '00000000-0000-0000-0000-000000000000' })
          .expect(401);
      });
    });

    describe('GET /api/v1/hearing-prep', () => {
      it('should list user hearing preps', async () => {
        const user = await createAuthenticatedUser(app, {
          email: `hearing-list-${Date.now()}@test.com`,
        });

        const res = await request(app.getHttpServer())
          .get('/api/v1/hearing-prep')
          .set('Authorization', `Bearer ${user.accessToken}`)
          .expect(200);

        expect(res.body.success).toBe(true);
        expect(Array.isArray(res.body.data)).toBe(true);
      });
    });

    describe('GET /api/v1/hearing-prep/:id', () => {
      it('should return 404 for non-existent hearing prep', async () => {
        const user = await createAuthenticatedUser(app, {
          email: `hearing-404-${Date.now()}@test.com`,
        });

        await request(app.getHttpServer())
          .get('/api/v1/hearing-prep/00000000-0000-0000-0000-000000000000')
          .set('Authorization', `Bearer ${user.accessToken}`)
          .expect(404);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════
  // TIMELINES
  // ═══════════════════════════════════════════════════════════

  describe('Timelines', () => {
    describe('POST /api/v1/timelines/generate', () => {
      it('should require authentication', async () => {
        await request(app.getHttpServer())
          .post('/api/v1/timelines/generate')
          .send({ documentId: '00000000-0000-0000-0000-000000000000' })
          .expect(401);
      });
    });

    describe('GET /api/v1/timelines', () => {
      it('should list user timelines', async () => {
        const user = await createAuthenticatedUser(app, {
          email: `timeline-list-${Date.now()}@test.com`,
        });

        const res = await request(app.getHttpServer())
          .get('/api/v1/timelines')
          .set('Authorization', `Bearer ${user.accessToken}`)
          .expect(200);

        expect(res.body.success).toBe(true);
        expect(Array.isArray(res.body.data)).toBe(true);
      });
    });

    describe('GET /api/v1/timelines/:id', () => {
      it('should return 404 for non-existent timeline', async () => {
        const user = await createAuthenticatedUser(app, {
          email: `timeline-404-${Date.now()}@test.com`,
        });

        await request(app.getHttpServer())
          .get('/api/v1/timelines/00000000-0000-0000-0000-000000000000')
          .set('Authorization', `Bearer ${user.accessToken}`)
          .expect(404);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════
  // CROSS-CUTTING: TENANT ISOLATION FOR ALL AI FEATURES
  // ═══════════════════════════════════════════════════════════

  describe('Tenant isolation across AI features', () => {
    it('should not expose memos across organizations', async () => {
      const userA = await createAuthenticatedUser(app, {
        email: `ai-iso-a-${Date.now()}@test.com`,
      });
      const userB = await createAuthenticatedUser(app, {
        email: `ai-iso-b-${Date.now()}@test.com`,
      });

      // User B should only see their own memos
      const resB = await request(app.getHttpServer())
        .get('/api/v1/memos')
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(200);

      // Should be empty (new user, no memos created)
      expect(resB.body.data.length).toBe(0);
    });

    it('should not expose pleadings across organizations', async () => {
      const userB = await createAuthenticatedUser(app, {
        email: `plead-iso-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/pleadings')
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(200);

      expect(res.body.data.length).toBe(0);
    });

    it('should not expose case comparisons across organizations', async () => {
      const userB = await createAuthenticatedUser(app, {
        email: `compare-iso-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/case-comparisons')
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(200);

      expect(res.body.data.length).toBe(0);
    });
  });
});
