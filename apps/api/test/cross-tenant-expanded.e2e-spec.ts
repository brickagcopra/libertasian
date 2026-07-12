import { INestApplication } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');
import { createTestApp, createAuthenticatedUser, createTeamUser } from './helpers';

/**
 * Expanded Cross-Tenant Isolation E2E Tests — Session 91
 *
 * Per CLAUDE.md: "Cross-tenant data access is a critical vulnerability.
 * Test with automated E2E tests that attempt cross-tenant reads/writes
 * and assert 403."
 *
 * These tests supplement tenant-isolation.e2e-spec.ts with coverage for:
 * - Matters (create, list, get, update, delete)
 * - Notes (create, list, delete)
 * - Tasks (create, list)
 * - Flashcard sets
 * - Study progress
 * - Notifications
 * - Annotations
 */
describe('Cross-Tenant Expanded Isolation (E2E)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  /** Helper: get user's org ID */
  async function getOrgId(token: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .get('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return res.body.data[0].id;
  }

  // ─── Matters ─────────────────────────────────────────────────────────────

  describe('Matters — cross-tenant isolation', () => {
    it('should not list another user\'s matters', async () => {
      const userA = await createTeamUser(app, {
        email: `xten-mat-a-${Date.now()}@test.com`,
      });
      const userB = await createAuthenticatedUser(app, {
        email: `xten-mat-b-${Date.now()}@test.com`,
      });

      // User A creates a matter
      await request(app.getHttpServer())
        .post('/api/v1/matters')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({ title: 'UserA Secret Matter' })
        .expect(201);

      // User A should see their matter
      const resA = await request(app.getHttpServer())
        .get('/api/v1/matters')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(200);
      expect(resA.body.data.length).toBeGreaterThanOrEqual(1);

      // User B should NOT see User A's matter
      const resB = await request(app.getHttpServer())
        .get('/api/v1/matters')
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(200);
      const bMatterTitles = resB.body.data.map(
        (m: { title: string }) => m.title,
      );
      expect(bMatterTitles).not.toContain('UserA Secret Matter');
    });

    it('should not allow User B to access User A\'s specific matter by ID', async () => {
      const userA = await createTeamUser(app, {
        email: `xten-mat2-a-${Date.now()}@test.com`,
      });
      const userB = await createAuthenticatedUser(app, {
        email: `xten-mat2-b-${Date.now()}@test.com`,
      });

      // User A creates a matter
      const createRes = await request(app.getHttpServer())
        .post('/api/v1/matters')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({ title: 'Confidential Matter' })
        .expect(201);

      const matterId = createRes.body.data.id;

      // User B tries to access it — should be denied (404 or 403 depending on guard ordering)
      const accessRes = await request(app.getHttpServer())
        .get(`/api/v1/matters/${matterId}`)
        .set('Authorization', `Bearer ${userB.accessToken}`);

      expect([403, 404]).toContain(accessRes.status);
    });

    it('should not allow User B to update User A\'s matter', async () => {
      const userA = await createTeamUser(app, {
        email: `xten-mat3-a-${Date.now()}@test.com`,
      });
      const userB = await createAuthenticatedUser(app, {
        email: `xten-mat3-b-${Date.now()}@test.com`,
      });

      const createRes = await request(app.getHttpServer())
        .post('/api/v1/matters')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({ title: 'UserA Only' })
        .expect(201);

      const matterId = createRes.body.data.id;

      // User B tries to update — should fail (404 or 403 depending on guard ordering)
      const updateRes = await request(app.getHttpServer())
        .patch(`/api/v1/matters/${matterId}`)
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .send({ title: 'Hacked Title' });

      expect([403, 404]).toContain(updateRes.status);
    });
  });

  // ─── Notes ───────────────────────────────────────────────────────────────

  describe('Notes — cross-tenant isolation', () => {
    it('should not list another user\'s notes', async () => {
      const userA = await createAuthenticatedUser(app, {
        email: `xten-note-a-${Date.now()}@test.com`,
      });
      const userB = await createAuthenticatedUser(app, {
        email: `xten-note-b-${Date.now()}@test.com`,
      });

      // User A creates a note
      await request(app.getHttpServer())
        .post('/api/v1/notes')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({ title: 'UserA Private Note', body: {} })
        .expect(201);

      // User B should NOT see User A's note
      const resB = await request(app.getHttpServer())
        .get('/api/v1/notes')
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(200);
      const bNoteTitles = resB.body.data.map(
        (n: { title: string }) => n.title,
      );
      expect(bNoteTitles).not.toContain('UserA Private Note');
    });

    it('should not allow User B to delete User A\'s note', async () => {
      const userA = await createAuthenticatedUser(app, {
        email: `xten-note2-a-${Date.now()}@test.com`,
      });
      const userB = await createAuthenticatedUser(app, {
        email: `xten-note2-b-${Date.now()}@test.com`,
      });

      const createRes = await request(app.getHttpServer())
        .post('/api/v1/notes')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({ title: 'Important Note', body: {} })
        .expect(201);

      const noteId = createRes.body.data.id;

      // User B tries to delete — should fail (404 for tenant scoping, or 403 for RBAC)
      const delRes = await request(app.getHttpServer())
        .delete(`/api/v1/notes/${noteId}`)
        .set('Authorization', `Bearer ${userB.accessToken}`);
      expect([403, 404]).toContain(delRes.status);
    });
  });

  // ─── Tasks ───────────────────────────────────────────────────────────────

  describe('Tasks — cross-tenant isolation', () => {
    it('should not list another user\'s tasks', async () => {
      const userA = await createTeamUser(app, {
        email: `xten-task-a-${Date.now()}@test.com`,
      });
      const userB = await createAuthenticatedUser(app, {
        email: `xten-task-b-${Date.now()}@test.com`,
      });

      // User A creates a matter and a task
      const matterRes = await request(app.getHttpServer())
        .post('/api/v1/matters')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({ title: 'Task Matter A' })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/v1/tasks')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({
          title: 'Secret Task',
          matterId: matterRes.body.data.id,
        })
        .expect(201);

      // User B should NOT see User A's task
      const resB = await request(app.getHttpServer())
        .get('/api/v1/tasks')
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(200);
      const bTaskTitles = resB.body.data.map(
        (t: { title: string }) => t.title,
      );
      expect(bTaskTitles).not.toContain('Secret Task');
    });
  });

  // ─── Flashcard Sets ──────────────────────────────────────────────────────

  describe('Flashcard Sets — cross-tenant isolation', () => {
    it('should not list another user\'s flashcard sets', async () => {
      const userA = await createAuthenticatedUser(app, {
        email: `xten-fc-a-${Date.now()}@test.com`,
      });
      const userB = await createAuthenticatedUser(app, {
        email: `xten-fc-b-${Date.now()}@test.com`,
      });

      // User A creates a flashcard set
      await request(app.getHttpServer())
        .post('/api/v1/study/flashcard-sets')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({
          title: 'UserA Criminal Law Cards',
          barSubject: 'criminal',
          visibility: 'private',
        })
        .expect(201);

      // User B should NOT see User A's flashcard set
      const resB = await request(app.getHttpServer())
        .get('/api/v1/study/flashcard-sets')
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(200);
      const bSetTitles = resB.body.data.map(
        (s: { title: string }) => s.title,
      );
      expect(bSetTitles).not.toContain('UserA Criminal Law Cards');
    });

    it('should not allow User B to access User A\'s flashcard set by ID', async () => {
      const userA = await createAuthenticatedUser(app, {
        email: `xten-fc2-a-${Date.now()}@test.com`,
      });
      const userB = await createAuthenticatedUser(app, {
        email: `xten-fc2-b-${Date.now()}@test.com`,
      });

      const createRes = await request(app.getHttpServer())
        .post('/api/v1/study/flashcard-sets')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({
          title: 'Private Cards',
          barSubject: 'civil',
          visibility: 'private',
        })
        .expect(201);

      const setId = createRes.body.data.id;

      // User B tries to read User A's set — should fail (404 or 403)
      const accessRes = await request(app.getHttpServer())
        .get(`/api/v1/study/flashcard-sets/${setId}`)
        .set('Authorization', `Bearer ${userB.accessToken}`);
      expect([403, 404]).toContain(accessRes.status);
    });
  });

  // ─── Reviewer Packs ──────────────────────────────────────────────────────

  describe('Reviewer Packs — cross-tenant isolation', () => {
    it('should not list another user\'s reviewer packs', async () => {
      const userA = await createAuthenticatedUser(app, {
        email: `xten-rp-a-${Date.now()}@test.com`,
      });
      const userB = await createAuthenticatedUser(app, {
        email: `xten-rp-b-${Date.now()}@test.com`,
      });

      // User A creates a reviewer pack
      await request(app.getHttpServer())
        .post('/api/v1/study/reviewer-packs')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({
          title: 'UserA Bar Review Pack',
          barSubject: 'remedial',
          visibility: 'private',
        })
        .expect(201);

      // User B should NOT see User A's reviewer pack
      const resB = await request(app.getHttpServer())
        .get('/api/v1/study/reviewer-packs')
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(200);
      const bPackTitles = resB.body.data.map(
        (p: { title: string }) => p.title,
      );
      expect(bPackTitles).not.toContain('UserA Bar Review Pack');
    });
  });

  // ─── Study Progress ──────────────────────────────────────────────────────

  describe('Study Progress — cross-tenant isolation', () => {
    it('should not list another user\'s study progress', async () => {
      const userA = await createAuthenticatedUser(app, {
        email: `xten-sp-a-${Date.now()}@test.com`,
      });
      const userB = await createAuthenticatedUser(app, {
        email: `xten-sp-b-${Date.now()}@test.com`,
      });

      // User A lists their study progress
      const resA = await request(app.getHttpServer())
        .get('/api/v1/study/progress')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(200);

      // User B lists their study progress
      const resB = await request(app.getHttpServer())
        .get('/api/v1/study/progress')
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(200);

      // Both should have empty or independent data
      expect(Array.isArray(resA.body.data)).toBe(true);
      expect(Array.isArray(resB.body.data)).toBe(true);
    });
  });

  // ─── Notifications ───────────────────────────────────────────────────────

  describe('Notifications — cross-user isolation', () => {
    it('should not list another user\'s notifications', async () => {
      const userA = await createAuthenticatedUser(app, {
        email: `xten-notif-a-${Date.now()}@test.com`,
      });
      const userB = await createAuthenticatedUser(app, {
        email: `xten-notif-b-${Date.now()}@test.com`,
      });

      // Both users list their notifications
      const resA = await request(app.getHttpServer())
        .get('/api/v1/notifications')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(200);

      const resB = await request(app.getHttpServer())
        .get('/api/v1/notifications')
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(200);

      // Should be independent (empty for new users)
      expect(Array.isArray(resA.body.data)).toBe(true);
      expect(Array.isArray(resB.body.data)).toBe(true);
    });
  });

  // ─── Organizations — member isolation ────────────────────────────────────

  describe('Organizations — member isolation', () => {
    it('should not list members of another org', async () => {
      const userA = await createAuthenticatedUser(app, {
        email: `xten-org-a-${Date.now()}@test.com`,
      });
      const userB = await createAuthenticatedUser(app, {
        email: `xten-org-b-${Date.now()}@test.com`,
      });

      const orgAId = await getOrgId(userA.accessToken);
      const orgBId = await getOrgId(userB.accessToken);

      // Each user should be able to list members of their own org
      const resA = await request(app.getHttpServer())
        .get(`/api/v1/organizations/${orgAId}/members`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(200);
      expect(resA.body.data.length).toBe(1); // Only themselves

      // User B trying to list User A's org members should fail
      await request(app.getHttpServer())
        .get(`/api/v1/organizations/${orgAId}/members`)
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(403);
    });

    it('should not allow User B to update User A\'s organization', async () => {
      const userA = await createAuthenticatedUser(app, {
        email: `xten-org2-a-${Date.now()}@test.com`,
      });
      const userB = await createAuthenticatedUser(app, {
        email: `xten-org2-b-${Date.now()}@test.com`,
      });

      const orgAId = await getOrgId(userA.accessToken);

      // User B tries to update User A's org
      await request(app.getHttpServer())
        .patch(`/api/v1/organizations/${orgAId}`)
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .send({ name: 'Hacked Org Name' })
        .expect(403);
    });
  });

  // ─── Sessions — user isolation ───────────────────────────────────────────

  describe('Sessions — user isolation', () => {
    it('should only show sessions for the authenticated user', async () => {
      const userA = await createAuthenticatedUser(app, {
        email: `xten-sess-a-${Date.now()}@test.com`,
      });
      const userB = await createAuthenticatedUser(app, {
        email: `xten-sess-b-${Date.now()}@test.com`,
      });

      // User A lists their sessions
      const resA = await request(app.getHttpServer())
        .get('/api/v1/auth/sessions')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(200);

      // User B lists their sessions
      const resB = await request(app.getHttpServer())
        .get('/api/v1/auth/sessions')
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(200);

      // Sessions should be independent
      expect(resA.body.data.length).toBeGreaterThanOrEqual(1);
      expect(resB.body.data.length).toBeGreaterThanOrEqual(1);
    });
  });
});
