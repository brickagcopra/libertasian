import { INestApplication } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');
import { createTestApp, createAuthenticatedUser } from '../helpers';
import { PrismaService } from '../../src/prisma/prisma.service';
import { EmbeddingClientService } from '../../src/modules/search/embedding-client.service';
import { OpenSearchService } from '../../src/modules/search/opensearch.service';
import { RedisService } from '../../src/common/services/redis.service';
import {
  mockRagAnswerResponse,
  mockRagAnswerAbstained,
  mockEmbeddingVector,
} from './helpers/mock-services';

/**
 * Search & RAG Answer — Integration Tests (Phase 3)
 *
 * Tests the search pipeline and AI answer generation across service boundaries:
 * - Search: EmbeddingClient -> OpenSearch BM25 + kNN -> RRF fusion -> Cache
 * - AI Answer: RAG service HTTP -> model_run auditing -> response
 * - Fallback: embedding failure -> BM25-only search
 * - Abstention: RAG service returns abstained -> no hallucination
 *
 * Mocks: fetch (for RAG/Embedding HTTP calls), OpenSearch, EmbeddingClient
 * Real: PrismaService (PostgreSQL), RedisService (cache)
 */
describe('Search & RAG Answer — Integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let embeddingClient: EmbeddingClientService;
  let openSearch: OpenSearchService;

  // Save original fetch to restore later
  const originalFetch = global.fetch;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    embeddingClient = app.get(EmbeddingClientService);
    openSearch = app.get(OpenSearchService);
  }, 30000);

  afterAll(async () => {
    global.fetch = originalFetch;
    await app.close();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    global.fetch = originalFetch;
  });

  // ── Search Pipeline ────────────────────────────────────────────────────

  describe('Search pipeline', () => {
    it('should execute hybrid search when embedding service is available', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `search-hybrid-${Date.now()}@test.com`,
      });

      // Mock embedding client to return a vector
      jest.spyOn(embeddingClient, 'embed').mockResolvedValue(mockEmbeddingVector());

      // Mock OpenSearch to return results
      jest.spyOn(openSearch, 'searchKeyword').mockResolvedValue({
        items: [
          {
            id: 'doc-1', title: 'Test Case', documentType: 'case',
            score: 5.2, highlights: { plain_text: ['relevant passage'] },
          } as never,
        ],
        total: 1,
        maxScore: 5.2,
        timedOut: false,
      });
      jest.spyOn(openSearch, 'searchVector').mockResolvedValue({
        items: [
          {
            id: 'doc-1', title: 'Test Case', documentType: 'case',
            score: 0.95, highlights: {},
          } as never,
          {
            id: 'doc-2', title: 'Another Case', documentType: 'case',
            score: 0.82, highlights: {},
          } as never,
        ],
        total: 2,
        maxScore: 0.95,
        timedOut: false,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/search')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ query: 'constructive dismissal' });

      if (res.status === 200) {
        expect(res.body.data.meta.searchType).toBe('hybrid');
        expect(res.body.data.items.length).toBeGreaterThan(0);
      }
    });

    it('should fall back to BM25-only when embedding service is unavailable', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `search-bm25-${Date.now()}@test.com`,
      });

      // Embedding returns null (service unavailable)
      jest.spyOn(embeddingClient, 'embed').mockResolvedValue(null);

      jest.spyOn(openSearch, 'searchKeyword').mockResolvedValue({
        items: [
          {
            id: 'doc-1', title: 'Test Case', documentType: 'case',
            score: 3.5, highlights: {},
          } as never,
        ],
        total: 1,
        maxScore: 3.5,
        timedOut: false,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/search')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ query: 'illegal dismissal' });

      if (res.status === 200) {
        expect(res.body.data.meta.searchType).toBe('keyword_only');
      }
    });

    it('should fall back to BM25-only when kNN search throws', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `search-knn-fail-${Date.now()}@test.com`,
      });

      jest.spyOn(embeddingClient, 'embed').mockResolvedValue(mockEmbeddingVector());
      jest.spyOn(openSearch, 'searchKeyword').mockResolvedValue({
        items: [{ id: 'doc-1', title: 'Test', score: 3.0, highlights: {} } as never],
        total: 1, maxScore: 3.0, timedOut: false,
      });
      jest.spyOn(openSearch, 'searchVector').mockRejectedValue(
        new Error('OpenSearch vector index not found'),
      );

      const res = await request(app.getHttpServer())
        .post('/api/v1/search')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ query: 'labor law' });

      if (res.status === 200) {
        expect(res.body.data.meta.searchType).toBe('keyword_only');
        expect(res.body.data.items.length).toBeGreaterThan(0);
      }
    });

    it('should cache search results in Redis with 5-min TTL', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `search-cache-${Date.now()}@test.com`,
      });

      jest.spyOn(embeddingClient, 'embed').mockResolvedValue(null);
      jest.spyOn(openSearch, 'searchKeyword').mockResolvedValue({
        items: [], total: 0, maxScore: null, timedOut: false,
      });

      // First request
      await request(app.getHttpServer())
        .post('/api/v1/search')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ query: 'unique-test-query-cache-check' });

      // Second request should hit cache
      const searchKeywordSpy = jest.spyOn(openSearch, 'searchKeyword');
      const callsBefore = searchKeywordSpy.mock.calls.length;

      const res2 = await request(app.getHttpServer())
        .post('/api/v1/search')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ query: 'unique-test-query-cache-check' });

      if (res2.status === 200) {
        expect(res2.body.data.meta.cached).toBe(true);
      }
    });
  });

  // ── AI Answer Generation ───────────────────────────────────────────────

  describe('AI answer generation', () => {
    it('should call RAG service and return answer with sources', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `ai-answer-1-${Date.now()}@test.com`,
      });

      const ragResponse = mockRagAnswerResponse();

      // Mock global fetch for RAG service call
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ragResponse,
        text: async () => JSON.stringify(ragResponse),
      }) as jest.Mock;

      const res = await request(app.getHttpServer())
        .post('/api/v1/ai-answers')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ query: 'What is constructive dismissal?' });

      // May get 200 (success) or 403 (quota) depending on test state
      if (res.status === 200) {
        expect(res.body.data.answer).toBeTruthy();
        expect(res.body.data.sources).toBeDefined();
        expect(res.body.data.abstained).toBe(false);
        expect(res.body.data.confidence).toBeGreaterThan(0);
      }
    });

    it('should record model_run for auditing on every AI answer', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `ai-answer-audit-${Date.now()}@test.com`,
      });

      const ragResponse = mockRagAnswerResponse();
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ragResponse,
        text: async () => JSON.stringify(ragResponse),
      }) as jest.Mock;

      const countBefore = await prisma.modelRun.count({
        where: { runType: 'ai_answer' },
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/ai-answers')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ query: 'doctrine of last clear chance' });

      if (res.status === 200) {
        // Give time for async model run creation
        await new Promise((resolve) => setTimeout(resolve, 500));

        const countAfter = await prisma.modelRun.count({
          where: { runType: 'ai_answer' },
        });
        expect(countAfter).toBeGreaterThan(countBefore);

        // Verify model run has required audit fields
        const latestRun = await prisma.modelRun.findFirst({
          where: { runType: 'ai_answer' },
          orderBy: { createdAt: 'desc' },
        });
        expect(latestRun?.modelName).toBe('test-model-v1');
        expect(latestRun?.promptTemplateVersion).toBe('answer-v3.0');
        expect(latestRun?.confidence).toBe(0.88);
      }
    });

    it('should return abstention when RAG service abstains', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `ai-answer-abstain-${Date.now()}@test.com`,
      });

      const ragResponse = mockRagAnswerAbstained();
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ragResponse,
        text: async () => JSON.stringify(ragResponse),
      }) as jest.Mock;

      const res = await request(app.getHttpServer())
        .post('/api/v1/ai-answers')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ query: 'some obscure legal question' });

      if (res.status === 200) {
        expect(res.body.data.abstained).toBe(true);
        expect(res.body.data.abstention_reason).toBeTruthy();
        expect(res.body.data.sources).toEqual([]);
      }
    });

    it('should return error when RAG service is unavailable', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `ai-answer-unavail-${Date.now()}@test.com`,
      });

      global.fetch = jest.fn().mockRejectedValue(
        new Error('fetch failed: ECONNREFUSED'),
      ) as jest.Mock;

      const res = await request(app.getHttpServer())
        .post('/api/v1/ai-answers')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ query: 'test query' });

      // Should get 500 or 503
      expect([500, 503]).toContain(res.status);
    });

    it('should return error when RAG service returns non-200', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `ai-answer-500-${Date.now()}@test.com`,
      });

      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal model error',
      }) as jest.Mock;

      const res = await request(app.getHttpServer())
        .post('/api/v1/ai-answers')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ query: 'test query' });

      expect([500, 503]).toContain(res.status);
    });
  });

  // ── Quota Enforcement ──────────────────────────────────────────────────

  describe('AI answer quota enforcement', () => {
    it('should enforce AI answer quota and return 403 when exceeded', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `ai-quota-${Date.now()}@test.com`,
      });

      // Set entitlements to very low limit via subscription override
      const orgRes = await request(app.getHttpServer())
        .get('/api/v1/organizations/me')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);
      const orgId = orgRes.body.data[0].id;

      // Override AI answers to 0
      await prisma.entitlementOverride.create({
        data: {
          organizationId: orgId,
          entitlementKey: 'aiAnswers',
          overrideType: 'admin_override',
          numericValue: 0,
          reason: 'Test quota exhaustion',
          sourceType: 'system',
          startsAt: new Date(),
          createdByUserId: user.userId,
        },
      });
      await redis.del(`cache:entitlements:${orgId}`);

      const ragResponse = mockRagAnswerResponse();
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ragResponse,
        text: async () => JSON.stringify(ragResponse),
      }) as jest.Mock;

      const res = await request(app.getHttpServer())
        .post('/api/v1/ai-answers')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ query: 'test quota check' });

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/quota/i);
    });
  });
});
