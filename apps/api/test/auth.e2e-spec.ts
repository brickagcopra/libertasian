import { INestApplication } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');
import {
  createTestApp,
  registerTestUser,
  loginTestUser,
  createAuthenticatedUser,
  extractRefreshCookie,
} from './helpers';

describe('Auth (E2E)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  // ---- Registration ----

  describe('POST /api/v1/auth/register', () => {
    it('should register a new user', async () => {
      const email = `reg-${Date.now()}@test.com`;
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email, password: 'StrongPass123!test', fullName: 'Reg Test' })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.user.email).toBe(email);
      expect(res.body.data.user.fullName).toBe('Reg Test');
      expect(res.body.data.user.emailVerified).toBe(false);
      // Sensitive fields should not be present
      expect(res.body.data.user.passwordHash).toBeUndefined();
      expect(res.body.data.user.mfaSecret).toBeUndefined();
    });

    it('should reject duplicate email', async () => {
      const email = `dup-${Date.now()}@test.com`;
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email, password: 'StrongPass123!test', fullName: 'User' })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email, password: 'StrongPass123!test', fullName: 'User' })
        .expect(409);
    });

    it('should reject short password (< 10 chars)', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: `short-${Date.now()}@test.com`, password: 'short1', fullName: 'User' })
        .expect(400);
    });

    it('should reject missing fields', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: 'missing@test.com' })
        .expect(400);
    });

    it('should reject unknown fields (whitelist)', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: `extra-${Date.now()}@test.com`,
          password: 'StrongPass123!test',
          fullName: 'User',
          isAdmin: true, // unknown field — should be rejected
        })
        .expect(400);
    });
  });

  // ---- Login ----

  describe('POST /api/v1/auth/login', () => {
    it('should login with valid credentials', async () => {
      const { email, password } = await registerTestUser(app);

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.tokens.accessToken).toBeDefined();
      // Refresh token is now issued as an httpOnly Set-Cookie and no
      // longer appears in the body (commit af823bd RS256 + cookie migration).
      expect(res.body.data.tokens.refreshToken).toBeUndefined();
      const setCookie = res.headers['set-cookie'];
      expect(
        (Array.isArray(setCookie) ? setCookie : [setCookie]).some(
          (c) => typeof c === 'string' && c.startsWith('libertasian-refresh='),
        ),
      ).toBe(true);
      expect(res.body.data.mfaRequired).toBe(false);
    });

    it('should reject invalid password', async () => {
      const { email } = await registerTestUser(app);

      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'WrongPassword123!' })
        .expect(401);
    });

    it('should reject non-existent email', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'nonexistent@test.com', password: 'SomePassword123!' })
        .expect(401);
    });
  });

  // ---- Token Refresh ----

  describe('POST /api/v1/auth/refresh', () => {
    it('should refresh tokens with a valid refresh token', async () => {
      // Refresh token travels in the httpOnly `libertasian-refresh`
      // cookie (commit af823bd). Set-Cookie → Cookie round-trip.
      const { refreshToken, refreshCookie } = await createAuthenticatedUser(app);

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', refreshCookie)
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.accessToken).toBeDefined();
      // The rotated refresh token is in the new Set-Cookie, not the body.
      expect(res.body.data.refreshToken).toBeUndefined();
      const rotated = extractRefreshCookie(res.headers['set-cookie']);
      expect(rotated.refreshToken).toBeTruthy();
      expect(rotated.refreshToken).not.toBe(refreshToken);
    });

    it('should reject reused (already-rotated) refresh token', async () => {
      // Use the raw cookie string for .set('Cookie', ...) — body field
      // is ignored post-af823bd.
      const { refreshCookie } = await createAuthenticatedUser(app);

      // First refresh — succeeds
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', refreshCookie)
        .expect(201);

      // Second refresh with same cookie — reuse detection, should fail
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', refreshCookie)
        .expect(401);
    });

    it('should reject second concurrent refresh with same token (reuse detection)', async () => {
      const { refreshCookie } = await createAuthenticatedUser(app);

      // First refresh — succeeds and rotates the token
      const first = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', refreshCookie)
        .expect(201);

      expect(first.body.success).toBe(true);

      // Second refresh with the same (now-revoked) cookie — strict reuse
      // detection revokes the entire family. Client-side single-flight
      // prevents this race; server enforces as defense-in-depth.
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', refreshCookie)
        .expect(401);

      // The rotated token from the first call should also be revoked
      // (entire family revoked by reuse detection)
      const firstCookie = extractRefreshCookie(first.headers['set-cookie']);
      if (firstCookie.refreshCookie) {
        await request(app.getHttpServer())
          .post('/api/v1/auth/refresh')
          .set('Cookie', firstCookie.refreshCookie)
          .expect(401);
      }
    });

    it('should reject invalid refresh token', async () => {
      // Cookie-based refresh (af823bd): set a bogus cookie value rather
      // than sending it in the body, which the server now ignores.
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', 'libertasian-refresh=invalid-token')
        .expect(401);
    });

    it('two concurrent refreshes with the same cookie: exactly one wins, family revoked', async () => {
      // Mobile + web tab both detect access-token expiry at the same
      // instant and POST /auth/refresh with the same refresh cookie.
      // Server must treat this as a reuse-detection event: at most one
      // request rotates the token, and the entire refresh-token family
      // is revoked. Anything else lets two valid token families coexist.
      const { refreshCookie } = await createAuthenticatedUser(app);

      const fire = () =>
        request(app.getHttpServer())
          .post('/api/v1/auth/refresh')
          .set('Cookie', refreshCookie);

      const [a, b] = await Promise.all([fire(), fire()]);

      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([201, 401]);

      const winner = a.status === 201 ? a : b;
      expect(winner.body.success).toBe(true);
      expect(winner.body.data.accessToken).toBeDefined();
      const rotated = extractRefreshCookie(winner.headers['set-cookie']);
      expect(rotated.refreshToken).toBeTruthy();

      // The "winner's" rotated token should also be dead — the loser's
      // 401 must have triggered family-wide revocation. If both families
      // are alive, this is the bug.
      if (rotated.refreshCookie) {
        await request(app.getHttpServer())
          .post('/api/v1/auth/refresh')
          .set('Cookie', rotated.refreshCookie)
          .expect(401);
      }
    });
  });

  // ---- Logout ----

  describe('POST /api/v1/auth/logout', () => {
    it('should revoke refresh token family on logout', async () => {
      // Logout and refresh both read the refresh token from the
      // httpOnly `libertasian-refresh` cookie (commit af823bd).
      const { accessToken, refreshCookie } = await createAuthenticatedUser(app);

      await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Cookie', refreshCookie)
        .expect(201);

      // Refresh with the old cookie should now fail
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', refreshCookie)
        .expect(401);
    });
  });

  // ---- Protected Endpoints ----

  describe('GET /api/v1/users/me', () => {
    it('should return current user with valid token', async () => {
      const { accessToken, email } = await createAuthenticatedUser(app);

      const res = await request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body.data.email).toBe(email);
    });

    it('should reject request without auth token', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/users/me')
        .expect(401);
    });

    it('should reject request with invalid token', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
    });
  });

  // ---- Forgot / Reset Password ----

  describe('Password reset flow', () => {
    it('should return success for forgot password (anti-enumeration)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/forgot-password')
        .send({ email: 'nonexistent@test.com' })
        .expect(201);

      expect(res.body.success).toBe(true);
      // Should always return success to prevent email enumeration
    });

    it('should reject reset with invalid token', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .send({ token: 'invalid-token', newPassword: 'NewStrongPass123!' })
        .expect(400);
    });
  });

  // ---- Session Management ----

  describe('Session management', () => {
    it('should list active sessions', async () => {
      const { accessToken } = await createAuthenticatedUser(app);

      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/sessions')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('should revoke all sessions', async () => {
      // Refresh token lives in an httpOnly cookie since af823bd; round-trip it
      // back to the server via .set('Cookie', refreshCookie).
      const { accessToken, refreshCookie } = await createAuthenticatedUser(app);

      await request(app.getHttpServer())
        .delete('/api/v1/auth/sessions')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      // Refresh cookie should be revoked
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', refreshCookie)
        .expect(401);
    });
  });
});
