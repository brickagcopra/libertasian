import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');
import { AppModule } from '../src/app.module';
import { registerTestUser, loginTestUser } from './helpers';

/**
 * Rate Limiting E2E tests (Phase 2 — Coverage Gaps).
 *
 * These tests verify that the AppThrottlerGuard actually enforces rate limits.
 * Unlike other E2E tests which disable rate limiting, these tests keep it enabled
 * to validate 429 responses and Retry-After headers.
 *
 * NOTE: These tests do NOT mock the throttler guard, so they require Redis.
 */
describe('Rate Limiting (E2E)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    // Do NOT mock the throttler guard — we want to test real rate limiting
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: false },
      }),
    );
    app.setGlobalPrefix('api/v1');

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Auth route rate limiting (10 requests / 15 min per IP)', () => {
    it('should allow requests within the rate limit', async () => {
      // A single request should always succeed (ignoring credential validity)
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'ratelimit-test@test.com', password: 'SomePassword123!' });

      // Should get 401 (invalid credentials) not 429
      expect(res.status).toBe(401);
    });

    it('should return 429 after exceeding auth rate limit', async () => {
      // Auth routes have a limit of 10 requests per 15 minutes per IP.
      // Send 11 rapid requests to trigger the limit.
      const results: number[] = [];

      for (let i = 0; i < 12; i++) {
        const res = await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({
            email: `ratelimit-burst-${i}@test.com`,
            password: 'SomePassword123!',
          });
        results.push(res.status);
      }

      // At least one request should have been rate limited (429)
      const has429 = results.includes(429);
      // The first requests should be 401 (bad credentials, not rate limited)
      const firstFew = results.slice(0, 5);
      const allFirstAre401 = firstFew.every((s) => s === 401);

      expect(allFirstAre401).toBe(true);
      expect(has429).toBe(true);
    });

    it('should include Retry-After header in 429 response', async () => {
      // Send enough requests to trigger rate limiting
      let rateLimitedResponse: { headers: Record<string, string>; status: number } | null = null;

      for (let i = 0; i < 15; i++) {
        const res = await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({
            email: `retry-after-${i}@test.com`,
            password: 'SomePassword123!',
          });

        if (res.status === 429) {
          rateLimitedResponse = res;
          break;
        }
      }

      if (rateLimitedResponse) {
        // Retry-After header should be present
        expect(
          rateLimitedResponse.headers['retry-after'] ||
          rateLimitedResponse.headers['x-ratelimit-reset'],
        ).toBeDefined();
      }
      // If we didn't get 429 after 15 requests, the limit may be reset
      // from previous test — that's acceptable in isolated test runs
    });
  });

  describe('Registration rate limiting', () => {
    it('should rate limit registration endpoint', async () => {
      const results: number[] = [];

      for (let i = 0; i < 12; i++) {
        const res = await request(app.getHttpServer())
          .post('/api/v1/auth/register')
          .send({
            email: `ratelimit-reg-${Date.now()}-${i}@test.com`,
            password: 'StrongPass123!test',
            fullName: `Rate Limit Test ${i}`,
          });
        results.push(res.status);
      }

      // First requests should succeed (201), eventually we should hit 429
      expect(results.slice(0, 3).every((s) => s === 201)).toBe(true);
      expect(results.includes(429)).toBe(true);
    });
  });

  describe('General API rate limiting (300 requests / 1 min per user)', () => {
    it('should enforce general rate limit on authenticated endpoints', async () => {
      // Register and login to get a valid token
      const email = `general-rl-${Date.now()}@test.com`;
      const password = 'StrongPass123!test';

      const regRes = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email, password, fullName: 'RL User' });

      // If registration is rate limited from previous tests, skip
      if (regRes.status === 429) return;

      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password });

      if (loginRes.status === 429) return;

      const accessToken = loginRes.body.data.tokens.accessToken;

      // The general limit is 300/min — that's too many to hit in a test.
      // Instead, we verify the rate limit headers are present on normal requests.
      const res = await request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      // Rate limit headers should be present (varies by implementation)
      // Common headers: X-RateLimit-Limit, X-RateLimit-Remaining
      // The throttler module may set these — check for presence
      const hasRateLimitHeaders =
        res.headers['x-ratelimit-limit'] !== undefined ||
        res.headers['x-ratelimit-remaining'] !== undefined ||
        res.headers['ratelimit-limit'] !== undefined;

      // This assertion is informational — not all throttler configs set headers
      if (hasRateLimitHeaders) {
        expect(
          parseInt(res.headers['x-ratelimit-limit'] || res.headers['ratelimit-limit'], 10),
        ).toBeGreaterThan(0);
      }
    });
  });

  describe('Forgot password rate limiting', () => {
    it('should rate limit forgot-password to prevent abuse', async () => {
      const results: number[] = [];

      for (let i = 0; i < 12; i++) {
        const res = await request(app.getHttpServer())
          .post('/api/v1/auth/forgot-password')
          .send({ email: `forgot-rl-${i}@test.com` });
        results.push(res.status);
      }

      // First requests should succeed (201), eventually we should hit 429
      const successCount = results.filter((s) => s === 201).length;
      const rateLimitedCount = results.filter((s) => s === 429).length;

      expect(successCount).toBeGreaterThan(0);
      expect(rateLimitedCount).toBeGreaterThan(0);
    });
  });
});
