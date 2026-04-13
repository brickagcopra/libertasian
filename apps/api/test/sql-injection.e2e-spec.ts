import { INestApplication } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');
import { createTestApp, createAuthenticatedUser } from './helpers';

/**
 * Phase 4 Security Testing: SQL / NoSQL Injection Prevention
 *
 * Verifies that all endpoints properly parameterize queries and reject
 * injection attempts. Tests cover:
 * - Classic SQL injection payloads in text fields
 * - UNION-based injection attempts
 * - Boolean-based blind injection
 * - OpenSearch query injection via search endpoints
 * - NoSQL injection via JSON fields
 * - Second-order injection via stored values
 */
describe('SQL & NoSQL Injection Prevention (E2E)', () => {
  let app: INestApplication;
  let user: Awaited<ReturnType<typeof createAuthenticatedUser>>;

  beforeAll(async () => {
    app = await createTestApp();
    user = await createAuthenticatedUser(app, {
      email: `sqli-${Date.now()}@test.com`,
    });
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  // Common SQL injection payloads
  const sqlPayloads = [
    "'; DROP TABLE users; --",
    "' OR '1'='1",
    "' OR '1'='1' --",
    "1'; SELECT * FROM users WHERE ''='",
    "' UNION SELECT NULL, NULL, NULL --",
    "'; UPDATE users SET role='admin' WHERE email='",
    "1; WAITFOR DELAY '0:0:5' --",
    "' AND 1=1 --",
    "' AND EXTRACTVALUE(1, CONCAT(0x7e, (SELECT version()))) --",
    "\\'; DROP TABLE legal_documents; --",
  ];

  // ---- Registration endpoint ----

  describe('Auth registration — SQL injection in email/name', () => {
    it('should safely handle SQL payloads in email field', async () => {
      // email field has @IsEmail() validation — should reject all SQL payloads
      for (const payload of sqlPayloads.slice(0, 3)) {
        const res = await request(app.getHttpServer())
          .post('/api/v1/auth/register')
          .send({
            email: payload,
            password: 'StrongPass123!test',
            fullName: 'Test',
          });

        // Should be 400 (validation) not 500 (SQL error)
        expect(res.status).toBe(400);
      }
    });

    it('should safely handle SQL payloads in fullName field', async () => {
      for (const payload of sqlPayloads.slice(0, 3)) {
        const res = await request(app.getHttpServer())
          .post('/api/v1/auth/register')
          .send({
            email: `sqli-name-${Date.now()}@test.com`,
            password: 'StrongPass123!test',
            fullName: payload,
          });

        // Should be 201 (stored safely via parameterized query) or 400 (validation)
        // Must NOT be 500 (SQL error)
        expect([201, 400]).toContain(res.status);
        if (res.status === 500) {
          fail('SQL injection payload caused a server error');
        }
      }
    });
  });

  // ---- Search endpoint ----

  describe('Search — OpenSearch query injection', () => {
    const searchPayloads = [
      // OpenSearch DSL injection attempts
      '{"match_all":{}}',
      '"},"script":{"source":"java.lang.Runtime.getRuntime().exec(\'calc\')"},"query":{"match_all":{"',
      '* OR _exists_:password',
      '\\n{"size":9999,"query":{"match_all":{}}}',
      '"}},"aggs":{"leak":{"terms":{"field":"passwordHash"}}},"query":{"match_all":{"',
    ];

    it('should safely handle injection payloads in search query', async () => {
      for (const payload of searchPayloads) {
        const res = await request(app.getHttpServer())
          .post('/api/v1/search')
          .set('Authorization', `Bearer ${user.accessToken}`)
          .send({ query: payload });

        // Should be 200 (empty results) or 400 (validation) — never 500
        expect([200, 201, 400]).toContain(res.status);
      }
    });

    it('should safely handle SQL payloads in search query', async () => {
      for (const payload of sqlPayloads) {
        const res = await request(app.getHttpServer())
          .post('/api/v1/search')
          .set('Authorization', `Bearer ${user.accessToken}`)
          .send({ query: payload });

        expect([200, 201, 400]).toContain(res.status);
      }
    });

    it('should safely handle injection in search filter fields', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/search')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          query: 'test',
          documentType: "'; DROP TABLE legal_documents; --",
          court: "' OR '1'='1",
        });

      // Filter values should be validated or safely parameterized
      expect([200, 201, 400]).toContain(res.status);
    });
  });

  // ---- Bookmarks — note field ----

  describe('Bookmarks — SQL injection in note field', () => {
    it('should safely store SQL payloads in bookmark notes', async () => {
      for (const payload of sqlPayloads.slice(0, 3)) {
        const res = await request(app.getHttpServer())
          .post('/api/v1/bookmarks')
          .set('Authorization', `Bearer ${user.accessToken}`)
          .send({
            documentId: '00000000-0000-0000-0000-000000000001',
            note: payload,
          });

        // Should be 201 (safely stored) or 404 (doc not found) or 400 (validation)
        // Never 500
        expect([201, 400, 404]).toContain(res.status);
      }
    });
  });

  // ---- Feed posts — textContent field ----

  describe('Feed posts — SQL injection in content', () => {
    it('should safely store SQL payloads in post content', async () => {
      for (const payload of sqlPayloads.slice(0, 3)) {
        const res = await request(app.getHttpServer())
          .post('/api/v1/feed/posts')
          .set('Authorization', `Bearer ${user.accessToken}`)
          .send({
            textContent: payload,
            visibility: 'organization',
          });

        // Should be 201 (safely stored) or 400 (validation) — never 500
        expect([201, 400]).toContain(res.status);
      }
    });

    it('should safely handle UNION injection in post content', async () => {
      const unionPayload =
        "' UNION SELECT id, email, passwordHash, mfaSecret FROM users --";
      const res = await request(app.getHttpServer())
        .post('/api/v1/feed/posts')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          textContent: unionPayload,
          visibility: 'organization',
        });

      expect([201, 400]).toContain(res.status);

      // If stored, verify it doesn't leak database data when retrieved
      if (res.status === 201 && res.body.data?.id) {
        const getRes = await request(app.getHttpServer())
          .get(`/api/v1/feed/posts/${res.body.data.id}`)
          .set('Authorization', `Bearer ${user.accessToken}`)
          .expect(200);

        // The content should be stored literally, not executed as SQL
        expect(getRes.body.data.textContent).toContain('UNION SELECT');
        // Should NOT contain actual user data from the DB
        expect(getRes.body.data.textContent).not.toMatch(
          /[a-f0-9]{60}/, // bcrypt hash pattern
        );
      }
    });
  });

  // ---- Workspace matters — title/description ----

  describe('Workspace matters — SQL injection in title/description', () => {
    it('should safely handle SQL payloads in matter title', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/matters')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          title: "'; DELETE FROM matters; --",
          description: 'Normal description',
        });

      expect([201, 400]).toContain(res.status);
    });

    it('should safely handle SQL payloads in matter description', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/matters')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          title: 'Normal Title',
          description: "' OR 1=1; DROP TABLE matters; --",
        });

      expect([201, 400]).toContain(res.status);
    });
  });

  // ---- Workspace tasks ----

  describe('Workspace tasks — SQL injection', () => {
    it('should safely handle SQL payloads in task title', async () => {
      // First create a matter to attach tasks to
      const matterRes = await request(app.getHttpServer())
        .post('/api/v1/matters')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ title: 'Test Matter for SQLi' });

      if (matterRes.status === 201) {
        const matterId = matterRes.body.data.id;
        const res = await request(app.getHttpServer())
          .post('/api/v1/tasks')
          .set('Authorization', `Bearer ${user.accessToken}`)
          .send({
            matterId,
            title: "'; UPDATE users SET role='admin'; --",
            description: 'Normal description',
          });

        expect([201, 400]).toContain(res.status);
      }
    });
  });

  // ---- Notes ----

  describe('Workspace notes — SQL injection', () => {
    it('should safely handle SQL payloads in note body', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/notes')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          title: "'; DROP TABLE notes; --",
          body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: "' OR '1'='1" }] }] },
        });

      expect([201, 400]).toContain(res.status);
    });
  });

  // ---- Path traversal in URL parameters ----

  describe('Path traversal in URL parameters', () => {
    it('should reject path traversal in document ID', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/documents/../../../etc/passwd')
        .set('Authorization', `Bearer ${user.accessToken}`);

      // Should be 400 (invalid UUID) or 404 — never serve system files
      expect([400, 404]).toContain(res.status);
    });

    it('should reject null byte injection in parameters', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/documents/test%00.pdf')
        .set('Authorization', `Bearer ${user.accessToken}`);

      expect([400, 404]).toContain(res.status);
    });
  });

  // ---- NoSQL / JSON injection ----

  describe('JSON injection in structured fields', () => {
    it('should not allow JSON injection to modify query structure', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/search')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          query: 'test',
          // Attempt to inject extra fields that could modify the DB query
          where: { role: 'admin' },
          include: { passwordHash: true },
        });

      // forbidNonWhitelisted should reject unknown fields with 400
      // or they should be silently stripped (whitelist: true)
      expect([200, 201, 400]).toContain(res.status);
    });

    it('should handle prototype pollution attempts safely', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: `proto-${Date.now()}@test.com`,
          password: 'StrongPass123!test',
          fullName: 'Test',
          __proto__: { isAdmin: true },
          constructor: { prototype: { isAdmin: true } },
        });

      // __proto__ and constructor are stripped during JSON deserialization
      // before reaching ValidationPipe, so forbidNonWhitelisted doesn't see them.
      // 201 (registered safely) or 400 (rejected) are both acceptable — the key
      // is that the isAdmin field is NOT set on the created user.
      expect([201, 400]).toContain(res.status);

      if (res.status === 201) {
        // Verify the prototype pollution didn't actually work
        expect(res.body.data?.user?.isAdmin).not.toBe(true);
        expect(res.body.data?.user?.role).not.toBe('admin');
      }
    });
  });

  // ---- Verify no 500 errors from any injection attempt ----

  describe('No 500 errors from injection attempts', () => {
    it('should never return 500 for any SQL payload in login', async () => {
      for (const payload of sqlPayloads) {
        const res = await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ email: payload, password: payload });

        expect(res.status).not.toBe(500);
      }
    });
  });
});
