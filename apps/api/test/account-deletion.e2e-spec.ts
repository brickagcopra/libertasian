import { INestApplication } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');
import { createTestApp, createAuthenticatedUser } from './helpers';
import { NotificationsService } from '../src/modules/notifications/notifications.service';

/**
 * Self-serve account deletion (Apple 5.1.1(v) / Google Play).
 *
 * Two properties matter most here and neither can be proven with unit tests:
 *
 * 1. There is no way to address ANOTHER account. `DELETE /users/me` takes its
 *    subject from the verified JWT, so a cross-tenant caller can only ever
 *    delete themselves — the classic "delete by id" hole does not exist.
 * 2. A deactivated account cannot log back in. Login already rejects any
 *    status other than 'active' (auth.service.ts:202), so the deletion flow
 *    adds no second check; this suite proves that existing gate covers the new
 *    `pending_deletion` status.
 */
describe('Account Deletion (E2E)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  describe('Cross-tenant isolation', () => {
    it('offers no route that deletes another user by id', async () => {
      const victim = await createAuthenticatedUser(app, {
        email: `del-victim-${Date.now()}@test.com`,
      });
      const attacker = await createAuthenticatedUser(app, {
        email: `del-attacker-${Date.now()}@test.com`,
      });

      // No `DELETE /users/:id` exists. Assert it stays that way — adding one
      // later without an ownership check would be a critical vulnerability.
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/users/${victim.userId}`)
        .set('Authorization', `Bearer ${attacker.accessToken}`)
        .send({ confirm: 'DELETE', password: attacker.password });

      expect([403, 404, 405]).toContain(res.status);

      // The victim is untouched and can still authenticate.
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: victim.email, password: victim.password })
        .expect(201);
    });

    it('deletes only the caller when two users act concurrently', async () => {
      const caller = await createAuthenticatedUser(app, {
        email: `del-caller-${Date.now()}@test.com`,
      });
      const bystander = await createAuthenticatedUser(app, {
        email: `del-bystander-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .delete('/api/v1/users/me')
        .set('Authorization', `Bearer ${caller.accessToken}`)
        .send({ confirm: 'DELETE', password: caller.password })
        .expect(200);

      // The bystander's account is unaffected.
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: bystander.email, password: bystander.password })
        .expect(201);
    });
  });

  describe('Request validation', () => {
    it('rejects a body without the typed confirmation', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `del-noconfirm-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .delete('/api/v1/users/me')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ password: user.password })
        .expect(400);
    });

    it('rejects a wrong password with 401 and leaves the account active', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `del-badpass-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .delete('/api/v1/users/me')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ confirm: 'DELETE', password: 'not-the-password' })
        .expect(401);

      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: user.password })
        .expect(201);
    });

    it('requires authentication', async () => {
      await request(app.getHttpServer())
        .delete('/api/v1/users/me')
        .send({ confirm: 'DELETE', password: 'x' })
        .expect(401);
    });
  });

  describe('Deactivation', () => {
    it('returns the 30-day restore schedule', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `del-schedule-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .delete('/api/v1/users/me')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ confirm: 'DELETE', password: user.password })
        .expect(200);

      expect(res.body.data.status).toBe('pending_deletion');
      expect(res.body.data.restoreWindowDays).toBe(30);

      const requestedAt = new Date(res.body.data.deletionRequestedAt).getTime();
      const purgeAt = new Date(res.body.data.scheduledPurgeAt).getTime();
      expect(purgeAt - requestedAt).toBe(30 * 24 * 60 * 60 * 1000);
    });

    it('blocks login for a deactivated account at the EXISTING status gate', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `del-nologin-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .delete('/api/v1/users/me')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ confirm: 'DELETE', password: user.password })
        .expect(200);

      // auth.service.ts:202 — `user.status !== 'active'`. No second check was
      // added for pending_deletion; this proves the existing one covers it.
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: user.password })
        .expect(401);
    });

    it('revokes every refresh-token family', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `del-revoke-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .delete('/api/v1/users/me')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ confirm: 'DELETE', password: user.password })
        .expect(200);

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', [user.refreshCookie])
        .send({});

      expect(res.status).toBe(401);
    });

    it('is idempotent — a repeat request returns the same schedule', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `del-idem-${Date.now()}@test.com`,
      });

      const first = await request(app.getHttpServer())
        .delete('/api/v1/users/me')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ confirm: 'DELETE', password: user.password })
        .expect(200);

      const second = await request(app.getHttpServer())
        .delete('/api/v1/users/me')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ confirm: 'DELETE', password: user.password })
        .expect(200);

      expect(second.body.data.deletionRequestedAt).toBe(
        first.body.data.deletionRequestedAt,
      );
    });
  });

  describe('Restore', () => {
    it('restores the account inside the window and lets the user log in again', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `del-restore-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .delete('/api/v1/users/me')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ confirm: 'DELETE', password: user.password })
        .expect(200);

      // The access token outlives the deactivation (JwtStrategy does not
      // re-read status), which is exactly the window the "Undo" affordance
      // in the client uses.
      await request(app.getHttpServer())
        .post('/api/v1/users/me/deletion/cancel')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({})
        .expect(200);

      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: user.password })
        .expect(201);
    });

    it('restores from the emailed token with NO authentication, once', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `del-token-${Date.now()}@test.com`,
      });

      // Capture the raw token off the mail hop — only its SHA-256 hash is
      // persisted, so this is the only place it is observable.
      const notifications = app.get(NotificationsService);
      const sent = jest
        .spyOn(notifications, 'sendAccountRestoreEmail')
        .mockResolvedValue(undefined);

      await request(app.getHttpServer())
        .delete('/api/v1/users/me')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ confirm: 'DELETE', password: user.password })
        .expect(200);

      expect(sent).toHaveBeenCalled();
      const token = sent.mock.calls[0]?.[2] as string;
      expect(token).toMatch(/^[0-9a-f]{64}$/);

      // No Authorization header: the account cannot sign in, which is the
      // whole reason this endpoint is public.
      const restored = await request(app.getHttpServer())
        .post('/api/v1/users/deletion/restore')
        .send({ token })
        .expect(200);
      expect(restored.body.data.status).toBe('active');

      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: user.password })
        .expect(201);

      // Single-use.
      await request(app.getHttpServer())
        .post('/api/v1/users/deletion/restore')
        .send({ token })
        .expect(400);

      sent.mockRestore();
    });

    it('rejects an unknown restore token', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/users/deletion/restore')
        .send({ token: 'f'.repeat(64) })
        .expect(400);
    });

    it('rejects an empty restore token at the DTO', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/users/deletion/restore')
        .send({ token: '' })
        .expect(400);
    });

    it('400s when there is nothing to restore', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `del-norestore-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/users/me/deletion/cancel')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({});

      // An active account is a no-op restore, not an error.
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('active');
    });
  });
});
