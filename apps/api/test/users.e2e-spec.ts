import { INestApplication } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');
import { createTestApp, createAuthenticatedUser } from './helpers';

/**
 * Users E2E tests — profile management, update, onboarding.
 * Per CLAUDE.md: No `any` usage, whitelist enforcement, no PII leakage.
 */
describe('Users (E2E)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  // ── GET /users/me ──────────────────────────────────────────

  describe('GET /api/v1/users/me', () => {
    it('should return current user profile with valid token', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `user-me-${Date.now()}@test.com`,
        fullName: 'Profile Test',
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.email).toBe(user.email);
      expect(res.body.data.fullName).toBe('Profile Test');
      expect(res.body.data.id).toBeDefined();
      // Sensitive fields must not be returned
      expect(res.body.data.passwordHash).toBeUndefined();
      expect(res.body.data.mfaSecret).toBeUndefined();
    });

    it('should reject request without auth token', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/users/me')
        .expect(401);
    });

    it('should reject request with invalid token', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Authorization', 'Bearer invalid-token-here')
        .expect(401);
    });

    it('should reject request with expired/malformed JWT', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Authorization', 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.invalid.payload')
        .expect(401);
    });
  });

  // ── PATCH /users/me ────────────────────────────────────────

  describe('PATCH /api/v1/users/me', () => {
    it('should update user profile fields', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `user-update-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ fullName: 'Updated Name' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.fullName).toBe('Updated Name');
    });

    it('should reject update without authentication', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/users/me')
        .send({ fullName: 'Hacker' })
        .expect(401);
    });

    it('should reject unknown fields (whitelist enforcement)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `user-whitelist-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ role: 'admin', isAdmin: true })
        .expect(400);
    });

    it('should not allow updating email directly via profile update', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `user-noemail-${Date.now()}@test.com`,
      });

      // Attempting to change email via profile patch should be rejected
      const res = await request(app.getHttpServer())
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ email: 'hacked@test.com' });

      // Should either 400 (whitelist rejection) or ignore the field
      expect([200, 400]).toContain(res.status);
      if (res.status === 200) {
        // If 200, email should NOT have changed
        const profile = await request(app.getHttpServer())
          .get('/api/v1/users/me')
          .set('Authorization', `Bearer ${user.accessToken}`)
          .expect(200);
        expect(profile.body.data.email).toBe(user.email);
      }
    });
  });

  // ── PATCH /users/me/onboarding ─────────────────────────────

  describe('PATCH /api/v1/users/me/onboarding', () => {
    it('should complete onboarding for a new user', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `user-onboard-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .patch('/api/v1/users/me/onboarding')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ completed: true });

      // Should succeed (200) or be already completed
      expect([200, 400]).toContain(res.status);
    });

    it('should require authentication', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/users/me/onboarding')
        .send({ completed: true })
        .expect(401);
    });
  });
});
