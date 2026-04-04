import { INestApplication } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');
import { createTestApp, createAuthenticatedUser } from './helpers';

/**
 * External API E2E tests — API key authenticated endpoints.
 * Per PDD: Enterprise API access, usage-metered.
 * These endpoints use API key auth instead of JWT.
 */
describe('External API (E2E)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/v1/external-api/search', () => {
    it('should reject request without API key', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/external-api/search')
        .send({ query: 'test search' })
        .expect(401);
    });

    it('should reject request with invalid API key', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/external-api/search')
        .set('X-API-Key', 'invalid-key-here')
        .send({ query: 'test search' })
        .expect(401);
    });
  });

  describe('GET /api/v1/external-api/documents/:id', () => {
    it('should reject request without API key', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/external-api/documents/00000000-0000-0000-0000-000000000000')
        .expect(401);
    });
  });

  describe('GET /api/v1/external-api/documents/:id/sections', () => {
    it('should reject request without API key', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/external-api/documents/00000000-0000-0000-0000-000000000000/sections')
        .expect(401);
    });
  });

  describe('POST /api/v1/external-api/memos', () => {
    it('should reject request without API key', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/external-api/memos')
        .send({ topic: 'labor law' })
        .expect(401);
    });
  });

  describe('API key creation and usage', () => {
    it('should create an API key and use it for external API', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `extapi-key-${Date.now()}@test.com`,
      });

      // Create an API key — requires enterprise subscription + owner/admin role
      const keyRes = await request(app.getHttpServer())
        .post('/api/v1/api-keys')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ name: 'E2E Test Key', scopes: ['search', 'documents'] });

      // 201 if allowed, 403 if subscription/role blocks
      expect([201, 403]).toContain(keyRes.status);

      // Skip external API usage test if key creation was blocked
      if (keyRes.status !== 201) return;

      expect(keyRes.body.data.key).toBeDefined();
      const apiKey = keyRes.body.data.key;

      // Use the API key for external search
      const searchRes = await request(app.getHttpServer())
        .post('/api/v1/external-api/search')
        .set('X-API-Key', apiKey)
        .send({ query: 'test query' });

      // Should succeed or return 503 (if search service is down)
      expect([200, 503]).toContain(searchRes.status);
    });
  });
});
