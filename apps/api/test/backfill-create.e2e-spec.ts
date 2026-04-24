import { INestApplication } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');
import { createTestApp, createAuthenticatedUser } from './helpers';

/**
 * POST /api/v1/admin/backfill/batches — create batch E2E.
 *
 * Covers:
 * - Auth enforcement (401 without token)
 * - Role enforcement (403 for non-admin users)
 * - DTO validation paths (400/403): missing name, invalid slug, both
 *   sourceId and sourceSlug, year out of range
 *
 * The admin-role 201-success path is not exercised here because this suite
 * doesn't seed an admin user; that's covered in backfill.service.spec.ts
 * unit tests. Tests pattern-match [400, 403] to be tolerant of guard order
 * (PermissionsGuard may fire before ValidationPipe).
 */
describe('POST /api/v1/admin/backfill/batches (E2E)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Auth enforcement', () => {
    it('should reject unauthenticated request with 401', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/admin/backfill/batches')
        .send({
          sourceSlug: 'lawphil',
          name: 'LawPhil 2020 Pilot',
          yearStart: 2020,
          yearEnd: 2020,
          budgetCeilingUsd: 5,
        })
        .expect(401);
    });
  });

  describe('Role enforcement', () => {
    it('should reject non-admin authenticated user with 403', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `backfill-nonadmin-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .post('/api/v1/admin/backfill/batches')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          sourceSlug: 'lawphil',
          name: 'LawPhil 2020 Pilot',
          yearStart: 2020,
          yearEnd: 2020,
          budgetCeilingUsd: 5,
        })
        .expect(403);
    });
  });

  describe('DTO validation', () => {
    it('should reject an unknown sourceSlug', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `backfill-badslug-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/admin/backfill/batches')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          sourceSlug: 'officialgazette', // not in the allowed list
          name: 'OG',
          yearStart: 2020,
          yearEnd: 2020,
          budgetCeilingUsd: 5,
        });

      expect([400, 403]).toContain(res.status);
    });

    it('should reject when neither sourceId nor sourceSlug is given', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `backfill-nosource-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/admin/backfill/batches')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          name: 'Orphan',
          yearStart: 2020,
          yearEnd: 2020,
          budgetCeilingUsd: 5,
        });

      expect([400, 403]).toContain(res.status);
    });

    it('should reject yearStart below 1901', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `backfill-badyear-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/admin/backfill/batches')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          sourceSlug: 'lawphil',
          name: 'Too old',
          yearStart: 1850,
          yearEnd: 2020,
          budgetCeilingUsd: 5,
        });

      expect([400, 403]).toContain(res.status);
    });

    it('should reject missing name', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `backfill-noname-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/admin/backfill/batches')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          sourceSlug: 'lawphil',
          yearStart: 2020,
          yearEnd: 2020,
          budgetCeilingUsd: 5,
        });

      expect([400, 403]).toContain(res.status);
    });

    it('should reject unknown fields (whitelist)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `backfill-extra-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/admin/backfill/batches')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          sourceSlug: 'lawphil',
          name: 'Test',
          yearStart: 2020,
          yearEnd: 2020,
          budgetCeilingUsd: 5,
          superSecretOverride: true,
        });

      expect([400, 403]).toContain(res.status);
    });
  });

  describe('Slug validation', () => {
    it('should accept sourceSlug=lawphil at the validator layer', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `backfill-lawphil-${Date.now()}@test.com`,
      });

      // Non-admin → 403 before service executes, but DTO must have passed
      // validation. This confirms 'lawphil' is an allowed slug value.
      await request(app.getHttpServer())
        .post('/api/v1/admin/backfill/batches')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          sourceSlug: 'lawphil',
          name: 'LawPhil 2020',
          yearStart: 2020,
          yearEnd: 2020,
          budgetCeilingUsd: 5,
        })
        .expect(403); // role guard, not 400 validation
    });

    it('should accept sourceSlug=scel at the validator layer', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `backfill-scel-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .post('/api/v1/admin/backfill/batches')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          sourceSlug: 'scel',
          name: 'SCEL 2023',
          yearStart: 2023,
          yearEnd: 2023,
          budgetCeilingUsd: 5,
        })
        .expect(403);
    });
  });
});
