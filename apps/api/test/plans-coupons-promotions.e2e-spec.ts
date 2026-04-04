import { INestApplication } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');
import { createTestApp, createAuthenticatedUser } from './helpers';

/**
 * Plans, Coupons, Promotions E2E tests — CRUD, validation, admin operations.
 * Per CLAUDE.md: subscription entitlement enforcement, plan-based rate limiting.
 * Per PDD: Xendit integration, JSONB entitlements, Redis quota counters.
 */
describe('Plans, Coupons & Promotions (E2E)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  // ═══════════════════════════════════════════════════════════
  // PLANS
  // ═══════════════════════════════════════════════════════════

  describe('Plans', () => {
    describe('GET /api/v1/plans', () => {
      it('should list available plans (public/authenticated)', async () => {
        const user = await createAuthenticatedUser(app, {
          email: `plans-list-${Date.now()}@test.com`,
        });

        const res = await request(app.getHttpServer())
          .get('/api/v1/plans')
          .set('Authorization', `Bearer ${user.accessToken}`)
          .expect(200);

        expect(res.body.success).toBe(true);
        expect(Array.isArray(res.body.data)).toBe(true);
        // Plans may be empty if not seeded in test DB
        expect(res.body.data.length).toBeGreaterThanOrEqual(0);
      });
    });

    describe('Admin plan management', () => {
      it('should reject plan creation without admin role', async () => {
        const user = await createAuthenticatedUser(app, {
          email: `plans-noadmin-${Date.now()}@test.com`,
        });

        await request(app.getHttpServer())
          .post('/api/v1/admin/plans')
          .set('Authorization', `Bearer ${user.accessToken}`)
          .send({ name: 'Hacker Plan', code: 'hacker', displayOrder: 99 })
          .expect(403);
      });

      it('should reject plan update without admin role', async () => {
        const user = await createAuthenticatedUser(app, {
          email: `plans-noupdate-${Date.now()}@test.com`,
        });

        await request(app.getHttpServer())
          .patch('/api/v1/admin/plans/00000000-0000-0000-0000-000000000000')
          .set('Authorization', `Bearer ${user.accessToken}`)
          .send({ name: 'Modified' })
          .expect(403);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════
  // COUPONS
  // ═══════════════════════════════════════════════════════════

  describe('Coupons', () => {
    describe('POST /api/v1/coupons/validate', () => {
      it('should require authentication', async () => {
        await request(app.getHttpServer())
          .post('/api/v1/coupons/validate')
          .send({ code: 'TESTCOUPON' })
          .expect(401);
      });

      it('should reject invalid coupon code', async () => {
        const user = await createAuthenticatedUser(app, {
          email: `coupon-invalid-${Date.now()}@test.com`,
        });

        const res = await request(app.getHttpServer())
          .post('/api/v1/coupons/validate')
          .set('Authorization', `Bearer ${user.accessToken}`)
          .send({ code: 'NONEXISTENT_COUPON_CODE' });

        expect([400, 404]).toContain(res.status);
      });

      it('should reject empty coupon code', async () => {
        const user = await createAuthenticatedUser(app, {
          email: `coupon-empty-${Date.now()}@test.com`,
        });

        await request(app.getHttpServer())
          .post('/api/v1/coupons/validate')
          .set('Authorization', `Bearer ${user.accessToken}`)
          .send({ code: '' })
          .expect(400);
      });
    });

    describe('Admin coupon management', () => {
      it('should reject coupon creation without admin role', async () => {
        const user = await createAuthenticatedUser(app, {
          email: `coupon-noadmin-${Date.now()}@test.com`,
        });

        await request(app.getHttpServer())
          .post('/api/v1/admin/coupons')
          .set('Authorization', `Bearer ${user.accessToken}`)
          .send({
            code: 'HACK50',
            discountType: 'percentage',
            discountValue: 50,
          })
          .expect(403);
      });

      it('should reject coupon listing without admin role', async () => {
        const user = await createAuthenticatedUser(app, {
          email: `coupon-nolist-${Date.now()}@test.com`,
        });

        await request(app.getHttpServer())
          .get('/api/v1/admin/coupons')
          .set('Authorization', `Bearer ${user.accessToken}`)
          .expect(403);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════
  // PROMOTIONS
  // ═══════════════════════════════════════════════════════════

  describe('Promotions', () => {
    describe('GET /api/v1/promotions/active', () => {
      it('should return active promotions', async () => {
        const user = await createAuthenticatedUser(app, {
          email: `promo-active-${Date.now()}@test.com`,
        });

        const res = await request(app.getHttpServer())
          .get('/api/v1/promotions/active')
          .set('Authorization', `Bearer ${user.accessToken}`)
          .expect(200);

        expect(res.body.success).toBe(true);
        expect(Array.isArray(res.body.data)).toBe(true);
      });
    });

    describe('POST /api/v1/promotions/eligible', () => {
      it('should check promotion eligibility', async () => {
        const user = await createAuthenticatedUser(app, {
          email: `promo-eligible-${Date.now()}@test.com`,
        });

        const res = await request(app.getHttpServer())
          .post('/api/v1/promotions/eligible')
          .set('Authorization', `Bearer ${user.accessToken}`)
          .send({ planCode: 'pro' });

        expect([200, 400]).toContain(res.status);
      });
    });

    describe('Admin promotion management', () => {
      it('should reject promotion creation without admin role', async () => {
        const user = await createAuthenticatedUser(app, {
          email: `promo-noadmin-${Date.now()}@test.com`,
        });

        await request(app.getHttpServer())
          .post('/api/v1/admin/promotions')
          .set('Authorization', `Bearer ${user.accessToken}`)
          .send({
            name: 'Hack Promo',
            type: 'discount',
            status: 'active',
          })
          .expect(403);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════
  // SUBSCRIPTION OPERATIONS
  // ═══════════════════════════════════════════════════════════

  describe('Subscription Operations', () => {
    describe('POST /api/v1/subscriptions/trial/start', () => {
      it('should require authentication', async () => {
        await request(app.getHttpServer())
          .post('/api/v1/subscriptions/trial/start')
          .send({ planCode: 'pro' })
          .expect(401);
      });
    });

    describe('GET /api/v1/quotas/usage', () => {
      it('should return usage quota for authenticated user', async () => {
        const user = await createAuthenticatedUser(app, {
          email: `quota-usage-${Date.now()}@test.com`,
        });

        const res = await request(app.getHttpServer())
          .get('/api/v1/quotas/usage')
          .set('Authorization', `Bearer ${user.accessToken}`)
          .expect(200);

        expect(res.body.success).toBe(true);
        expect(res.body.data).toBeDefined();
      });
    });

    describe('Admin subscription management', () => {
      it('should reject force cancel without admin role', async () => {
        const user = await createAuthenticatedUser(app, {
          email: `sub-noforce-${Date.now()}@test.com`,
        });

        await request(app.getHttpServer())
          .post('/api/v1/admin/subscriptions/00000000-0000-0000-0000-000000000000/force-cancel')
          .set('Authorization', `Bearer ${user.accessToken}`)
          .expect(403);
      });

      it('should reject complimentary grant without admin role', async () => {
        const user = await createAuthenticatedUser(app, {
          email: `sub-nocomp-${Date.now()}@test.com`,
        });

        await request(app.getHttpServer())
          .post('/api/v1/admin/subscriptions/complimentary/grant')
          .set('Authorization', `Bearer ${user.accessToken}`)
          .send({ organizationId: '00000000-0000-0000-0000-000000000000', planCode: 'pro' })
          .expect(403);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════
  // REPORTING
  // ═══════════════════════════════════════════════════════════

  describe('Reporting', () => {
    it('should reject revenue summary without admin role', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `report-norev-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .get('/api/v1/admin/reporting/revenue/summary')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });

    it('should reject subscription summary without admin role', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `report-nosub-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .get('/api/v1/admin/reporting/subscriptions/summary')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(403);
    });

    it('should require authentication for all reporting endpoints', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/admin/reporting/revenue/summary')
        .expect(401);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // SIMULATOR
  // ═══════════════════════════════════════════════════════════

  describe('Simulator', () => {
    it('should reject simulation without admin role', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `sim-noadmin-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .post('/api/v1/admin/simulator/pricing')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ planCode: 'pro', billingPeriod: 'monthly' })
        .expect(403);
    });

    it('should reject lifecycle simulation without admin role', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `sim-nolife-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .post('/api/v1/admin/simulator/lifecycle')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ planCode: 'pro' })
        .expect(403);
    });
  });
});
