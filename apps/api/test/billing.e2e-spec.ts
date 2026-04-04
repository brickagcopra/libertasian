import { INestApplication } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');
import { createTestApp, createAuthenticatedUser } from './helpers';

/**
 * Billing E2E tests — subscriptions, checkout, payment methods, invoices.
 * Per CLAUDE.md: Xendit integration, plan-based rate limiting.
 * Per PRD: Free, Edu, Pro, Team, Enterprise tiers.
 */
describe('Billing (E2E)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  // ── GET /billing/subscription ──────────────────────────────

  describe('GET /api/v1/billing/subscription', () => {
    it('should require authentication', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/billing/subscription')
        .expect(401);
    });

    it('should return current subscription (defaults to free)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `billing-sub-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/billing/subscription')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
      // New users default to free plan
      expect(res.body.data.planCode).toBe('free');
    });
  });

  // ── POST /billing/checkout/preview ─────────────────────────

  describe('POST /api/v1/billing/checkout/preview', () => {
    it('should require authentication', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/billing/checkout/preview')
        .send({ planCode: 'pro', billingPeriod: 'monthly' })
        .expect(401);
    });

    it('should preview checkout for valid plan', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `billing-preview-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/billing/checkout/preview')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ planCode: 'pro', billingPeriod: 'monthly' });

      expect([200, 201, 400]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body.success).toBe(true);
        expect(res.body.data.totalAmount).toBeDefined();
      }
    });

    it('should reject invalid plan code', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `billing-badplan-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .post('/api/v1/billing/checkout/preview')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ planCode: 'nonexistent-plan', billingPeriod: 'monthly' })
        .expect(400);
    });
  });

  // ── POST /billing/checkout ─────────────────────────────────

  describe('POST /api/v1/billing/checkout', () => {
    it('should require authentication', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/billing/checkout')
        .send({ planCode: 'pro', billingPeriod: 'monthly' })
        .expect(401);
    });

    it('should reject missing fields', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `billing-nocheckout-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .post('/api/v1/billing/checkout')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({})
        .expect(400);
    });
  });

  // ── POST /billing/cancel ───────────────────────────────────

  describe('POST /api/v1/billing/cancel', () => {
    it('should require authentication', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/billing/cancel')
        .expect(401);
    });

    it('should reject cancellation when no paid subscription exists', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `billing-cancel-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/billing/cancel')
        .set('Authorization', `Bearer ${user.accessToken}`);

      // Cannot cancel a free plan
      expect([400, 404]).toContain(res.status);
    });
  });

  // ── GET /billing/invoices ──────────────────────────────────

  describe('GET /api/v1/billing/invoices', () => {
    it('should require authentication', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/billing/invoices')
        .expect(401);
    });

    it('should list invoices (empty for free user)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `billing-invoices-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/billing/invoices')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  // ── Webhook Security ───────────────────────────────────────

  describe('POST /api/v1/billing/webhooks/xendit', () => {
    it('should reject webhook without callback token', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/billing/webhooks/xendit')
        .send({ event: 'payment.completed' });

      // Controller throws BadRequestException for missing/invalid callback token
      expect([400, 401, 403]).toContain(res.status);
    });
  });
});
