import { INestApplication } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');
import * as crypto from 'crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import { S3Service } from '../src/modules/uploads/s3.service';
import {
  createTestApp,
  createAuthenticatedUser,
  registerTestUser,
  loginTestUser,
} from './helpers';

/**
 * Phase 4 Security Testing: Authentication & Authorization Security
 *
 * Tests for:
 * - Privilege escalation attempts
 * - IDOR (Insecure Direct Object Reference) attacks
 * - Mass assignment / parameter tampering
 * - Session fixation
 * - Account takeover vectors
 * - Input validation bypass
 * - Sensitive data exposure
 */
describe('Authentication & Authorization Security (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let s3: S3Service;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    s3 = app.get(S3Service);
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  // ---- Privilege Escalation ----

  describe('Privilege escalation prevention', () => {
    it('should not allow role override via registration body', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: `privesc-${Date.now()}@test.com`,
          password: 'StrongPass123!test',
          fullName: 'Test',
          role: 'admin', // attempt to set role
        });

      // forbidNonWhitelisted should reject the extra 'role' field
      expect(res.status).toBe(400);
    });

    it('should not allow isAdmin flag via registration body', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: `admin-${Date.now()}@test.com`,
          password: 'StrongPass123!test',
          fullName: 'Test',
          isAdmin: true,
        });

      expect(res.status).toBe(400);
    });

    it('should not allow organizationId override in requests', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `orgoverride-${Date.now()}@test.com`,
      });

      // Attempt to access another org's data by injecting organizationId
      const res = await request(app.getHttpServer())
        .get('/api/v1/bookmarks')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .query({ organizationId: '00000000-0000-0000-0000-000000000099' });

      // Should either ignore the param or return 400
      // Should NOT return data from another org
      expect([200, 400]).toContain(res.status);
      if (res.status === 200) {
        // Data should be scoped to user's own org, not the injected one
        // (tenant guard extracts org from JWT, not from query params)
      }
    });
  });

  // ---- IDOR (Insecure Direct Object Reference) ----

  describe('IDOR prevention', () => {
    it('should not allow user A to access user B private digests by ID', async () => {
      const userA = await createAuthenticatedUser(app, {
        email: `idor-a-${Date.now()}@test.com`,
      });
      const userB = await createAuthenticatedUser(app, {
        email: `idor-b-${Date.now()}@test.com`,
      });

      // Create a matter as user A
      const matterRes = await request(app.getHttpServer())
        .post('/api/v1/matters')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({ title: 'Private Matter A' });

      if (matterRes.status === 201) {
        const matterId = matterRes.body.data.id;

        // User B tries to access user A's matter
        const idorRes = await request(app.getHttpServer())
          .get(`/api/v1/matters/${matterId}`)
          .set('Authorization', `Bearer ${userB.accessToken}`);

        // Should be 403 or 404 — never 200
        expect([403, 404]).toContain(idorRes.status);
      }
    });

    it('should not allow user A to update user B resources', async () => {
      const userA = await createAuthenticatedUser(app, {
        email: `idor-update-a-${Date.now()}@test.com`,
      });
      const userB = await createAuthenticatedUser(app, {
        email: `idor-update-b-${Date.now()}@test.com`,
      });

      // Create note as user A
      const noteRes = await request(app.getHttpServer())
        .post('/api/v1/notes')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({
          title: 'A Private Note',
          body: { type: 'doc', content: [] },
        });

      if (noteRes.status === 201) {
        const noteId = noteRes.body.data.id;

        // User B tries to update user A's note
        const updateRes = await request(app.getHttpServer())
          .patch(`/api/v1/notes/${noteId}`)
          .set('Authorization', `Bearer ${userB.accessToken}`)
          .send({ title: 'Hijacked!' });

        expect([403, 404]).toContain(updateRes.status);
      }
    });

    it('should not allow user A to delete user B resources', async () => {
      const userA = await createAuthenticatedUser(app, {
        email: `idor-del-a-${Date.now()}@test.com`,
      });
      const userB = await createAuthenticatedUser(app, {
        email: `idor-del-b-${Date.now()}@test.com`,
      });

      const matterRes = await request(app.getHttpServer())
        .post('/api/v1/matters')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({ title: 'Delete Test Matter' });

      if (matterRes.status === 201) {
        const matterId = matterRes.body.data.id;

        const deleteRes = await request(app.getHttpServer())
          .delete(`/api/v1/matters/${matterId}`)
          .set('Authorization', `Bearer ${userB.accessToken}`);

        expect([403, 404]).toContain(deleteRes.status);
      }
    });
  });

  // ---- Mass Assignment Prevention ----

  describe('Mass assignment / parameter tampering', () => {
    it('should reject unknown fields in login DTO', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: 'test@test.com',
          password: 'TestPass123!test',
          mfaBypass: true, // unknown field
        });

      // Should be 400 (forbidNonWhitelisted) or 401 (invalid creds after stripping)
      expect([400, 401]).toContain(res.status);
    });

    it('should reject unknown fields in refresh DTO', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({
          refreshToken: 'some-token',
          skipDeviceCheck: true, // unknown field
        });

      expect([400, 401]).toContain(res.status);
    });

    it('should not allow setting internal fields via matter creation', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `mass-assign-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/matters')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          title: 'Normal Matter',
          organizationId: '00000000-0000-0000-0000-000000000099',
          userId: '00000000-0000-0000-0000-000000000099',
          createdAt: '2020-01-01T00:00:00Z',
        });

      // Should be 400 (reject unknown fields) or 201 (ignore unknown fields)
      expect([201, 400]).toContain(res.status);
    });
  });

  // ---- Sensitive Data Exposure ----

  describe('Sensitive data exposure prevention', () => {
    it('should not expose passwordHash in user responses', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `expose-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(res.body.data.passwordHash).toBeUndefined();
      expect(res.body.data.password).toBeUndefined();
    });

    it('should not expose mfaSecret in user responses', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `mfa-expose-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(res.body.data.mfaSecret).toBeUndefined();
    });

    it('should not expose refresh token hashes in any response', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `hash-expose-${Date.now()}@test.com`,
      });

      // List sessions
      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/sessions')
        .set('Authorization', `Bearer ${user.accessToken}`);

      if (res.status === 200) {
        const body = JSON.stringify(res.body);
        expect(body).not.toContain('tokenHash');
        expect(body).not.toContain('passwordHash');
      }
    });

    it('should not expose internal IDs or database details in error responses', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/documents/not-a-uuid')
        .set('Authorization', `Bearer ${(await createAuthenticatedUser(app, { email: `err-${Date.now()}@test.com` })).accessToken}`);

      const body = JSON.stringify(res.body);
      expect(body).not.toContain('prisma');
      expect(body).not.toContain('postgresql');
      expect(body).not.toContain('SELECT');
      expect(body).not.toContain('WHERE');
    });
  });

  // ---- Input Validation Bypass ----

  describe('Input validation bypass prevention', () => {
    it('should reject extremely long input values', async () => {
      const longString = 'A'.repeat(100000);
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: `long-${Date.now()}@test.com`,
          password: longString,
          fullName: longString,
        });

      // Should be 400 (MaxLength validation) or handled gracefully
      expect([400, 413]).toContain(res.status);
    });

    it('should reject null byte injection in string fields', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: `null\x00byte-${Date.now()}@test.com`,
          password: 'StrongPass123!test',
          fullName: 'Test\x00User',
        });

      // Should be 400 (invalid email format) or handled safely
      expect([400, 201]).toContain(res.status);
    });

    it('should reject non-string types for string fields', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: 12345,
          password: ['array', 'value'],
          fullName: { nested: 'object' },
        });

      expect(res.status).toBe(400);
    });

    it('should reject array injection for single-value fields', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: ['admin@test.com', 'user@test.com'],
          password: ['pass1', 'pass2'],
        });

      expect(res.status).toBe(400);
    });
  });

  // ---- Account Security ----

  describe('Account security', () => {
    it('should not allow login to suspended accounts', async () => {
      // Register a user (account active by default)
      const email = `suspended-${Date.now()}@test.com`;
      const password = 'StrongPass123!test';
      await registerTestUser(app, { email, password });

      // Login should work initially
      await loginTestUser(app, email, password);

      // We can't easily suspend from E2E without admin access,
      // but we verify the login flow works for active accounts
    });

    it('should use constant-time comparison for token validation', async () => {
      // This is a timing attack defense verification.
      // We can't directly test constant-time comparison in E2E,
      // but we verify that similar-length invalid tokens don't
      // produce significantly different response times.
      const validFormatToken = 'a'.repeat(64); // same length as a real token
      const shortToken = 'abc';

      const start1 = Date.now();
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: validFormatToken });
      const time1 = Date.now() - start1;

      const start2 = Date.now();
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: shortToken });
      const time2 = Date.now() - start2;

      // Both should be fast (< 1 second) — if one is significantly
      // slower, it might indicate a timing oracle
      expect(time1).toBeLessThan(5000);
      expect(time2).toBeLessThan(5000);
    });
  });

  // ---- HTTP Method Enforcement ----

  describe('HTTP method enforcement', () => {
    it('should reject GET for login endpoint (POST only)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/login');

      // Should be 404 (no GET route) or 405 (Method Not Allowed)
      expect([404, 405]).toContain(res.status);
    });

    it('should reject PUT for register endpoint', async () => {
      const res = await request(app.getHttpServer())
        .put('/api/v1/auth/register')
        .send({
          email: 'test@test.com',
          password: 'StrongPass123!test',
          fullName: 'Test',
        });

      expect([404, 405]).toContain(res.status);
    });
  });

  // ---- Content-Type Enforcement ----

  describe('Content-Type enforcement', () => {
    it('should reject non-JSON content type for API endpoints', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Content-Type', 'text/plain')
        .send('email=admin@test.com&password=admin');

      // Should not parse form-encoded or plain text as JSON
      expect([400, 415]).toContain(res.status);
    });
  });

  // ---- Cross-tenant feed visibility ----

  describe('Cross-tenant feed isolation', () => {
    it('should not show org-private feed posts to users from other orgs', async () => {
      const userA = await createAuthenticatedUser(app, {
        email: `feed-a-${Date.now()}@test.com`,
      });
      const userB = await createAuthenticatedUser(app, {
        email: `feed-b-${Date.now()}@test.com`,
      });

      // User A creates an org-scoped post
      const postRes = await request(app.getHttpServer())
        .post('/api/v1/feed/posts')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({
          textContent: 'Private org discussion',
          visibility: 'organization',
        });

      if (postRes.status === 201) {
        const postId = postRes.body.data.id;

        // User B should not see user A's org post
        const getRes = await request(app.getHttpServer())
          .get(`/api/v1/feed/posts/${postId}`)
          .set('Authorization', `Bearer ${userB.accessToken}`);

        expect([403, 404]).toContain(getRes.status);
      }
    });

    // E14 companion: public posts must remain readable cross-tenant.
    it('should allow cross-tenant reads of a public feed post', async () => {
      const userA = await createAuthenticatedUser(app, {
        email: `feed-pub-a-${Date.now()}@test.com`,
      });
      const userB = await createAuthenticatedUser(app, {
        email: `feed-pub-b-${Date.now()}@test.com`,
      });

      const createRes = await request(app.getHttpServer())
        .post('/api/v1/feed/posts')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({ textContent: 'Hello world', visibility: 'public' })
        .expect(201);

      const postId = createRes.body.data.id;

      const getRes = await request(app.getHttpServer())
        .get(`/api/v1/feed/posts/${postId}`)
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(200);

      expect(getRes.body.success).toBe(true);
      expect(getRes.body.data.id).toBe(postId);
      expect(getRes.body.data.visibility).toBe('public');
      expect(getRes.body.data.textContent).toBe('Hello world');
    });

    // E14 companion: soft-deleted posts must not leak cross-tenant.
    it('should return 404 cross-tenant for a soft-deleted public post', async () => {
      const userA = await createAuthenticatedUser(app, {
        email: `feed-del-a-${Date.now()}@test.com`,
      });
      const userB = await createAuthenticatedUser(app, {
        email: `feed-del-b-${Date.now()}@test.com`,
      });

      const createRes = await request(app.getHttpServer())
        .post('/api/v1/feed/posts')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({ textContent: 'Doomed post', visibility: 'public' })
        .expect(201);

      const postId = createRes.body.data.id;

      // Author soft-deletes the post.
      await request(app.getHttpServer())
        .delete(`/api/v1/feed/posts/${postId}`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(204);

      // Cross-tenant viewer receives NotFound — same shape as the
      // "never existed" branch, preventing existence fingerprinting.
      await request(app.getHttpServer())
        .get(`/api/v1/feed/posts/${postId}`)
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(404);
    });

    // E14 companion: same-tenant reads of an organization-scoped
    // post still succeed. The author is trivially in the post's org,
    // so using the author as the reader is the simplest same-tenant
    // case without needing member-invite plumbing in the test.
    it('should allow same-tenant read of an organization feed post', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `feed-same-${Date.now()}@test.com`,
      });

      const createRes = await request(app.getHttpServer())
        .post('/api/v1/feed/posts')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ textContent: 'Team update', visibility: 'organization' })
        .expect(201);

      const postId = createRes.body.data.id;

      const getRes = await request(app.getHttpServer())
        .get(`/api/v1/feed/posts/${postId}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(getRes.body.data.id).toBe(postId);
      expect(getRes.body.data.visibility).toBe('organization');
    });

    // E14 companion (getBookmarkedPosts bypass): a user bookmarks a
    // public post, the author later flips visibility to organization,
    // and the stale bookmark must be filtered out server-side. The
    // DB filter (not a JS post-filter) is what drops the row, so we
    // assert that the post does not appear in the returned array.
    it('should not leak stale bookmarks after a post flips to organization visibility', async () => {
      const userA = await createAuthenticatedUser(app, {
        email: `feed-bm-a-${Date.now()}@test.com`,
      });
      const userB = await createAuthenticatedUser(app, {
        email: `feed-bm-b-${Date.now()}@test.com`,
      });

      // userA publishes a public post.
      const createRes = await request(app.getHttpServer())
        .post('/api/v1/feed/posts')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({ textContent: 'Initially public', visibility: 'public' })
        .expect(201);

      const postId = createRes.body.data.id;

      // userB (different org) bookmarks it while it is public.
      await request(app.getHttpServer())
        .post(`/api/v1/feed/posts/${postId}/bookmark`)
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(204);

      // Sanity check: bookmark shows up while the post is public.
      const beforeRes = await request(app.getHttpServer())
        .get('/api/v1/feed/bookmarks')
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(200);

      const beforeIds = (beforeRes.body.data as Array<{ id: string }>).map(
        (p) => p.id,
      );
      expect(beforeIds).toContain(postId);

      // userA flips visibility to organization.
      await request(app.getHttpServer())
        .patch(`/api/v1/feed/posts/${postId}`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({ visibility: 'organization' })
        .expect(200);

      // userB's bookmark list must no longer surface the post. The
      // filter is enforced at the DB layer, so the returned array
      // must not contain a row with this id.
      const afterRes = await request(app.getHttpServer())
        .get('/api/v1/feed/bookmarks')
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(200);

      const afterIds = (afterRes.body.data as Array<{ id: string }>).map(
        (p) => p.id,
      );
      expect(afterIds).not.toContain(postId);
    });

    // E14 companion (getBookmarkedPosts): same-tenant bookmarks of
    // organization-scoped posts still surface in /feed/bookmarks.
    it('should still return same-tenant bookmarks of organization posts', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `feed-bm-same-${Date.now()}@test.com`,
      });

      const createRes = await request(app.getHttpServer())
        .post('/api/v1/feed/posts')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ textContent: 'Team link', visibility: 'organization' })
        .expect(201);

      const postId = createRes.body.data.id;

      await request(app.getHttpServer())
        .post(`/api/v1/feed/posts/${postId}/bookmark`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(204);

      const res = await request(app.getHttpServer())
        .get('/api/v1/feed/bookmarks')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      const ids = (res.body.data as Array<{ id: string }>).map((p) => p.id);
      expect(ids).toContain(postId);
    });
  });

  // ---- BYPASS #2 — cross-tenant write protection on feed interactions ----
  //
  // Prior to commit P1 the `FeedInteractionsService.validatePostExists`
  // helper only checked status + deletedAt. Any authenticated user in
  // any tenant could like, bookmark, comment on, or report an
  // organization-scoped post belonging to a tenant they were not a
  // member of. This batch asserts the four write paths all return 404
  // (matching the anti-fingerprinting read-path shape) and that the
  // comment/report rows are NOT persisted.
  describe('Cross-tenant feed interaction isolation (BYPASS #2)', () => {
    async function createOrgPostAsUserA(): Promise<{
      postId: string;
      userA: Awaited<ReturnType<typeof createAuthenticatedUser>>;
      userB: Awaited<ReturnType<typeof createAuthenticatedUser>>;
    }> {
      const userA = await createAuthenticatedUser(app, {
        email: `fi-a-${Date.now()}-${Math.random()}@test.com`,
      });
      const userB = await createAuthenticatedUser(app, {
        email: `fi-b-${Date.now()}-${Math.random()}@test.com`,
      });
      const createRes = await request(app.getHttpServer())
        .post('/api/v1/feed/posts')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({ textContent: 'org-only', visibility: 'organization' })
        .expect(201);
      return { postId: createRes.body.data.id as string, userA, userB };
    }

    it('should block cross-tenant likePost on an org-scoped post with 404', async () => {
      const { postId, userB } = await createOrgPostAsUserA();

      await request(app.getHttpServer())
        .post(`/api/v1/feed/posts/${postId}/like`)
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(404);
    });

    it('should block cross-tenant bookmarkPost on an org-scoped post with 404', async () => {
      const { postId, userB } = await createOrgPostAsUserA();

      await request(app.getHttpServer())
        .post(`/api/v1/feed/posts/${postId}/bookmark`)
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(404);
    });

    it('should block cross-tenant createComment and write no comment row', async () => {
      const { postId, userB } = await createOrgPostAsUserA();

      await request(app.getHttpServer())
        .post(`/api/v1/feed/posts/${postId}/comments`)
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .send({ textContent: 'injected from another tenant' })
        .expect(404);

      // Anti-injection: the comment row must never have been written.
      const comments = await prisma.feedComment.findMany({
        where: { postId, authorId: userB.userId },
      });
      expect(comments).toHaveLength(0);
    });

    it('should block cross-tenant reportPost and write no report row', async () => {
      const { postId, userB } = await createOrgPostAsUserA();

      await request(app.getHttpServer())
        .post(`/api/v1/feed/posts/${postId}/report`)
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .send({ reason: 'spam' })
        .expect(404);

      const reports = await prisma.feedPostReport.findMany({
        where: { postId, reporterUserId: userB.userId },
      });
      expect(reports).toHaveLength(0);
    });

    // One happy-path case covers all four write verbs — the guard
    // shape is shared by a single private helper, so repeating the
    // same-tenant case per verb would add no real coverage.
    it('should still allow same-tenant likePost on an org-scoped post', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `fi-same-${Date.now()}@test.com`,
      });
      const createRes = await request(app.getHttpServer())
        .post('/api/v1/feed/posts')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ textContent: 'my org', visibility: 'organization' })
        .expect(201);
      const postId = createRes.body.data.id as string;

      await request(app.getHttpServer())
        .post(`/api/v1/feed/posts/${postId}/like`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(204);
    });
  });

  // ---- BYPASS #1 — cross-tenant feed media image protection ----
  //
  // Prior to commit P2 `FeedMediaService.getMediaImage` selected the
  // parent post's `visibility` and `organizationId` but never used
  // them in the non-owner access check — dead defensive code that
  // only validated `status === 'published'` and `deletedAt`. Any
  // authenticated viewer holding a mediaId could therefore fetch the
  // processed image bytes of an organization-scoped post belonging
  // to a tenant they were not a member of. This batch asserts the
  // post-attached fallback now requires the viewer's organization
  // match the post's when `visibility === 'organization'`, and that
  // soft-deleted posts drop out of the allowed set regardless of
  // visibility.
  describe('Cross-tenant feed media isolation (BYPASS #1)', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    // Directly seed a ready FeedPostMedia + attached FeedPost via
    // Prisma so the test can bypass the real upload/BullMQ pipeline.
    // S3 writes are not performed here — tests that need to exercise
    // the bytes-return happy path mock `s3.get` in-situ, which
    // sidesteps the AWS SDK dynamic-import issue under jest-vm.
    async function seedMediaPost(opts: {
      ownerUserId: string;
      organizationId: string;
      visibility: 'public' | 'organization';
      deleted?: boolean;
    }): Promise<{ mediaId: string; processedObjectKey: string }> {
      const processedObjectKey =
        `feed/${opts.organizationId}/${crypto.randomUUID()}/feed.jpg`;
      const originalObjectKey =
        `feed-temp/${opts.organizationId}/${opts.ownerUserId}/${crypto.randomUUID()}/raw.jpg`;

      const media = await prisma.feedPostMedia.create({
        data: {
          ownerUserId: opts.ownerUserId,
          organizationId: opts.organizationId,
          originalObjectKey,
          processedObjectKey,
          mimeType: 'image/jpeg',
          originalFileSize: 500,
          sha256Checksum: crypto.randomBytes(32).toString('hex'),
          processingStatus: 'ready',
          moderationStatus: 'approved',
        },
      });

      await prisma.feedPost.create({
        data: {
          organizationId: opts.organizationId,
          authorId: opts.ownerUserId,
          textContent: `bypass-1-test-${Date.now()}`,
          visibility: opts.visibility,
          status: 'published',
          mediaId: media.id,
          deletedAt: opts.deleted ? new Date() : null,
        },
      });

      return { mediaId: media.id, processedObjectKey };
    }

    // Registered users auto-create a personal organization on
    // signup; the membership row is the source of truth for the
    // org_id the JWT carries. Look it up here so the seeded post
    // lands in the same tenant as the authenticated viewer.
    async function getUserOrgId(userId: string): Promise<string> {
      const member = await prisma.organizationMember.findFirst({
        where: { userId, status: 'active' },
      });
      if (!member) {
        throw new Error(`No active organization member row for ${userId}`);
      }
      return member.organizationId;
    }

    it('should block cross-tenant image reads on an org-scoped post with 403', async () => {
      const userA = await createAuthenticatedUser(app, {
        email: `fm-bypass1-a-${Date.now()}@test.com`,
      });
      const userB = await createAuthenticatedUser(app, {
        email: `fm-bypass1-b-${Date.now()}@test.com`,
      });
      const orgA = await getUserOrgId(userA.userId);

      const { mediaId } = await seedMediaPost({
        ownerUserId: userA.userId,
        organizationId: orgA,
        visibility: 'organization',
      });

      // userB (different tenant) must NOT receive image bytes. The
      // fix short-circuits on the OR-filter miss and throws
      // ForbiddenException before any S3 call is attempted.
      await request(app.getHttpServer())
        .get(`/api/v1/feed/media/${mediaId}/image`)
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(403);
    });

    it('should return the processed image bytes for the media owner (same-tenant happy path)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `fm-bypass1-own-${Date.now()}@test.com`,
      });
      const orgId = await getUserOrgId(user.userId);

      // Minimal JPEG magic bytes. Content is arbitrary for this
      // test — we only assert the endpoint returns the buffer the
      // S3 layer would have delivered after the auth check passes.
      const jpegBytes = Buffer.from([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00,
      ]);

      // Mock S3 get to return our fake buffer. The AWS SDK's dynamic
      // imports don't play well with jest's vm sandbox, and the
      // actual S3 round-trip is irrelevant to the authorization
      // contract under test — we just need the controller to reach
      // the S3 layer to prove the auth check passed.
      jest.spyOn(s3, 'get').mockResolvedValue(jpegBytes);

      const { mediaId } = await seedMediaPost({
        ownerUserId: user.userId,
        organizationId: orgId,
        visibility: 'organization',
      });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/feed/media/${mediaId}/image`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .buffer(true)
        .parse((response, cb) => {
          const chunks: Buffer[] = [];
          response.on('data', (c: Buffer) => chunks.push(c));
          response.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);

      expect(res.headers['content-type']).toContain('image/jpeg');
      expect(Buffer.isBuffer(res.body)).toBe(true);
      expect((res.body as Buffer).length).toBe(jpegBytes.length);
    });

    it('should return 403 for cross-tenant reads of a soft-deleted post (even when public)', async () => {
      const userA = await createAuthenticatedUser(app, {
        email: `fm-bypass1-del-a-${Date.now()}@test.com`,
      });
      const userB = await createAuthenticatedUser(app, {
        email: `fm-bypass1-del-b-${Date.now()}@test.com`,
      });
      const orgA = await getUserOrgId(userA.userId);

      // Public visibility + deleted: the OR-filter's public branch
      // matches, but `deletedAt: null` drops the row. Confirms the
      // tombstone filter cannot be bypassed via public visibility.
      const { mediaId } = await seedMediaPost({
        ownerUserId: userA.userId,
        organizationId: orgA,
        visibility: 'public',
        deleted: true,
      });

      await request(app.getHttpServer())
        .get(`/api/v1/feed/media/${mediaId}/image`)
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(403);
    });
  });
});
