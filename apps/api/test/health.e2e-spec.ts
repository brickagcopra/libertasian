import { INestApplication } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');
import { createTestApp } from './helpers';

describe('Health (E2E)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/v1/health', () => {
    it('should return 200 with health status', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/health')
        .expect(200);

      // Health endpoint returns { status, timestamp, services } directly
      expect(res.body.status).toBeDefined();
      expect(res.body.timestamp).toBeDefined();
    });

    it('should be accessible without authentication', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/health')
        .expect(200);
    });
  });
});
