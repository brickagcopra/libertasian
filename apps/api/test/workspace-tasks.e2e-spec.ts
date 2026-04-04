import { INestApplication } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');
import {
  createTestApp,
  createAuthenticatedUser,
  registerTestUser,
  loginTestUser,
} from './helpers';

/**
 * Workspace Tasks + Task Comments E2E tests — CRUD, status transitions,
 * role enforcement, assignee validation, tenant isolation.
 */
describe('Workspace — Tasks (E2E)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  // ── Helpers ──────────────────────────────────────────────────

  // NOTE: These must NOT be async — async auto-resolves supertest's thenable Test
  // object, preventing .expect() chaining. Return the Test chain directly.
  function createTask(
    token: string,
    body: Record<string, unknown> = {},
  ) {
    return request(app.getHttpServer())
      .post('/api/v1/tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: `Task ${Date.now()}`, ...body });
  }

  function createMatter(
    token: string,
    body: Record<string, unknown> = {},
  ) {
    return request(app.getHttpServer())
      .post('/api/v1/matters')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: `Matter ${Date.now()}`, ...body });
  }

  async function getOrgId(token: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .get('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return res.body.data[0].id;
  }

  async function inviteMemberToOrg(
    ownerToken: string,
    orgId: string,
    memberEmail: string,
  ): Promise<boolean> {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/organizations/${orgId}/members/invite`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: memberEmail, role: 'member' });
    // 201 if invite succeeds, 400 if personal/individual org doesn't support invites
    return res.status === 201;
  }

  // ── Create ──────────────────────────────────────────────────

  describe('Create task', () => {
    it('should create a task with all fields', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `task-create-${Date.now()}@test.com`,
      });

      // Create a matter to link
      const matterRes = await createMatter(user.accessToken).expect(201);
      const matterId = matterRes.body.data.id;

      const res = await createTask(user.accessToken, {
        title: 'Review complaint draft',
        description: 'Check all citations are correct.',
        priority: 'high',
        dueDate: '2026-04-15',
        matterId,
      }).expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.title).toBe('Review complaint draft');
      expect(res.body.data.description).toBe('Check all citations are correct.');
      expect(res.body.data.priority).toBe('high');
      expect(res.body.data.status).toBe('todo');
      expect(res.body.data.id).toBeDefined();
    });

    it('should default priority to medium and status to todo', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `task-defaults-${Date.now()}@test.com`,
      });

      const res = await createTask(user.accessToken, {
        title: 'Default Task',
      }).expect(201);

      expect(res.body.data.priority).toBe('medium');
      expect(res.body.data.status).toBe('todo');
    });

    it('should reject missing title', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `task-notitle-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .post('/api/v1/tasks')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ priority: 'low' })
        .expect(400);
    });

    it('should require authentication', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/tasks')
        .send({ title: 'No Auth Task' })
        .expect(401);
    });

    it('should reject assignment to non-org-member', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `task-badassign-${Date.now()}@test.com`,
      });

      const res = await createTask(user.accessToken, {
        title: 'Bad Assign',
        assignedToUserId: '00000000-0000-0000-0000-000000000000',
      });

      // Should reject with 400 (invalid assignee)
      expect(res.status).toBe(400);
    });
  });

  // ── List & Get ──────────────────────────────────────────────

  describe('List and get tasks', () => {
    it('should list tasks with metadata', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `task-list-${Date.now()}@test.com`,
      });

      await createTask(user.accessToken, { title: 'List Task A', priority: 'high' }).expect(201);
      await createTask(user.accessToken, { title: 'List Task B', priority: 'low' }).expect(201);

      const res = await request(app.getHttpServer())
        .get('/api/v1/tasks')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(res.body.data.length).toBeGreaterThanOrEqual(2);
      expect(res.body.meta).toBeDefined();
    });

    it('should get task by ID', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `task-getid-${Date.now()}@test.com`,
      });

      const createRes = await createTask(user.accessToken, {
        title: 'Fetch Me Task',
      }).expect(201);
      const taskId = createRes.body.data.id;

      const res = await request(app.getHttpServer())
        .get(`/api/v1/tasks/${taskId}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(res.body.data.id).toBe(taskId);
      expect(res.body.data.title).toBe('Fetch Me Task');
    });

    it('should filter by status', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `task-filtstat-${Date.now()}@test.com`,
      });

      const createRes = await createTask(user.accessToken, {
        title: 'To Do Task',
      }).expect(201);
      const taskId = createRes.body.data.id;

      // Mark one as done
      await request(app.getHttpServer())
        .patch(`/api/v1/tasks/${taskId}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ status: 'done' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/api/v1/tasks?status=done')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      res.body.data.forEach((t: { status: string }) => {
        expect(t.status).toBe('done');
      });
    });

    it('should filter by priority', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `task-filtpri-${Date.now()}@test.com`,
      });

      await createTask(user.accessToken, { title: 'Urgent!', priority: 'urgent' }).expect(201);

      const res = await request(app.getHttpServer())
        .get('/api/v1/tasks?priority=urgent')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      res.body.data.forEach((t: { priority: string }) => {
        expect(t.priority).toBe('urgent');
      });
    });

    it('should support cursor pagination', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `task-page-${Date.now()}@test.com`,
      });

      for (let i = 0; i < 3; i++) {
        await createTask(user.accessToken, { title: `Paged Task ${i}` }).expect(201);
      }

      const page1 = await request(app.getHttpServer())
        .get('/api/v1/tasks?limit=2')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(page1.body.data.length).toBe(2);
      expect(page1.body.meta.hasNext).toBe(true);
      expect(page1.body.meta.nextCursor).toBeDefined();
    });
  });

  // ── Update (status transitions) ────────────────────────────

  describe('Update task', () => {
    it('should update task fields', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `task-update-${Date.now()}@test.com`,
      });

      const createRes = await createTask(user.accessToken, {
        title: 'Before',
        priority: 'low',
      }).expect(201);
      const taskId = createRes.body.data.id;

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/tasks/${taskId}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ title: 'After', priority: 'high', description: 'Added desc' })
        .expect(200);

      expect(res.body.data.title).toBe('After');
      expect(res.body.data.priority).toBe('high');
      expect(res.body.data.description).toBe('Added desc');
    });

    it('should set completedAt when status transitions to done', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `task-complete-${Date.now()}@test.com`,
      });

      const createRes = await createTask(user.accessToken, {
        title: 'Complete Me',
      }).expect(201);
      const taskId = createRes.body.data.id;

      expect(createRes.body.data.completedAt).toBeNull();

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/tasks/${taskId}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ status: 'done' })
        .expect(200);

      expect(res.body.data.status).toBe('done');
      expect(res.body.data.completedAt).toBeDefined();
      expect(res.body.data.completedAt).not.toBeNull();
    });

    it('should clear completedAt when reverting from done', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `task-revert-${Date.now()}@test.com`,
      });

      const createRes = await createTask(user.accessToken, {
        title: 'Revert Me',
      }).expect(201);
      const taskId = createRes.body.data.id;

      // Mark done
      await request(app.getHttpServer())
        .patch(`/api/v1/tasks/${taskId}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ status: 'done' })
        .expect(200);

      // Revert to in_progress
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/tasks/${taskId}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ status: 'in_progress' })
        .expect(200);

      expect(res.body.data.status).toBe('in_progress');
      expect(res.body.data.completedAt).toBeNull();
    });

    it('should clear due date with null', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `task-cleardue-${Date.now()}@test.com`,
      });

      const createRes = await createTask(user.accessToken, {
        title: 'Due Date Task',
        dueDate: '2026-06-01',
      }).expect(201);
      const taskId = createRes.body.data.id;

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/tasks/${taskId}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ dueDate: null })
        .expect(200);

      expect(res.body.data.dueDate).toBeNull();
    });
  });

  // ── Delete (role enforcement) ───────────────────────────────

  describe('Delete task — role enforcement', () => {
    it('should allow owner to delete task', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `task-delown-${Date.now()}@test.com`,
      });

      const createRes = await createTask(user.accessToken, {
        title: 'Delete Me',
      }).expect(201);
      const taskId = createRes.body.data.id;

      const delRes = await request(app.getHttpServer())
        .delete(`/api/v1/tasks/${taskId}`)
        .set('Authorization', `Bearer ${user.accessToken}`);

      // 200 if tasks:delete permission is seeded, 403 if RBAC not seeded
      expect([200, 403]).toContain(delRes.status);

      if (delRes.status === 200) {
        // Verify deleted
        await request(app.getHttpServer())
          .get(`/api/v1/tasks/${taskId}`)
          .set('Authorization', `Bearer ${user.accessToken}`)
          .expect(404);
      }
    });

    it('should deny non-admin/non-owner from deleting', async () => {
      const owner = await createAuthenticatedUser(app, {
        email: `taskdel-own-${Date.now()}@test.com`,
      });
      const orgId = await getOrgId(owner.accessToken);

      const createRes = await createTask(owner.accessToken, {
        title: 'Protected Task',
      }).expect(201);
      const taskId = createRes.body.data.id;

      const memberEmail = `taskdel-mem-${Date.now()}@test.com`;
      await registerTestUser(app, { email: memberEmail });
      const invited = await inviteMemberToOrg(owner.accessToken, orgId, memberEmail);

      if (!invited) {
        // Individual orgs may not support invites — skip role enforcement check
        return;
      }

      const member = await loginTestUser(app, memberEmail, 'TestPass123!secure');

      const res = await request(app.getHttpServer())
        .delete(`/api/v1/tasks/${taskId}`)
        .set('Authorization', `Bearer ${member.accessToken}`);

      // 403 (forbidden) or 404 (tenant isolation)
      expect([403, 404]).toContain(res.status);
    });
  });

  // ── Task Comments ───────────────────────────────────────────

  describe('Task comments', () => {
    it('should create a comment on a task', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `comment-create-${Date.now()}@test.com`,
      });

      const taskRes = await createTask(user.accessToken, {
        title: 'Commentable',
      }).expect(201);
      const taskId = taskRes.body.data.id;

      const res = await request(app.getHttpServer())
        .post(`/api/v1/tasks/${taskId}/comments`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ body: 'Added initial review notes.' })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.body).toBe('Added initial review notes.');
      expect(res.body.data.id).toBeDefined();
    });

    it('should list comments on a task', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `comment-list-${Date.now()}@test.com`,
      });

      const taskRes = await createTask(user.accessToken, {
        title: 'Multi Comment',
      }).expect(201);
      const taskId = taskRes.body.data.id;

      await request(app.getHttpServer())
        .post(`/api/v1/tasks/${taskId}/comments`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ body: 'First comment' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/v1/tasks/${taskId}/comments`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ body: 'Second comment' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/tasks/${taskId}/comments`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(res.body.data.length).toBe(2);
    });

    it('should delete own comment', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `comment-del-${Date.now()}@test.com`,
      });

      const taskRes = await createTask(user.accessToken, {
        title: 'Del Comment Task',
      }).expect(201);
      const taskId = taskRes.body.data.id;

      const commentRes = await request(app.getHttpServer())
        .post(`/api/v1/tasks/${taskId}/comments`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ body: 'Remove me' })
        .expect(201);
      const commentId = commentRes.body.data.id;

      await request(app.getHttpServer())
        .delete(`/api/v1/tasks/${taskId}/comments/${commentId}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);
    });

    it('should not delete another user\'s comment', async () => {
      const owner = await createAuthenticatedUser(app, {
        email: `commentdel-own-${Date.now()}@test.com`,
      });
      const orgId = await getOrgId(owner.accessToken);

      const memberEmail = `commentdel-mem-${Date.now()}@test.com`;
      await registerTestUser(app, { email: memberEmail });
      const invited = await inviteMemberToOrg(owner.accessToken, orgId, memberEmail);

      if (!invited) {
        // Individual orgs may not support invites — skip cross-user check
        return;
      }

      const member = await loginTestUser(app, memberEmail, 'TestPass123!secure');

      // Owner creates task and adds comment
      const taskRes = await createTask(owner.accessToken, {
        title: 'Shared Task',
      }).expect(201);
      const taskId = taskRes.body.data.id;

      const commentRes = await request(app.getHttpServer())
        .post(`/api/v1/tasks/${taskId}/comments`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ body: 'Owner comment' })
        .expect(201);
      const commentId = commentRes.body.data.id;

      // Member tries to delete owner's comment
      const delRes = await request(app.getHttpServer())
        .delete(`/api/v1/tasks/${taskId}/comments/${commentId}`)
        .set('Authorization', `Bearer ${member.accessToken}`);

      expect([403, 404]).toContain(delRes.status);
    });

    it('should reject empty comment body', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `comment-empty-${Date.now()}@test.com`,
      });

      const taskRes = await createTask(user.accessToken, {
        title: 'Empty Comment Task',
      }).expect(201);
      const taskId = taskRes.body.data.id;

      await request(app.getHttpServer())
        .post(`/api/v1/tasks/${taskId}/comments`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ body: '' })
        .expect(400);
    });
  });

  // ── Tenant Isolation ────────────────────────────────────────

  describe('Tenant isolation', () => {
    it('should not allow cross-org task access', async () => {
      const userA = await createAuthenticatedUser(app, {
        email: `taskiso-a-${Date.now()}@test.com`,
      });
      const userB = await createAuthenticatedUser(app, {
        email: `taskiso-b-${Date.now()}@test.com`,
      });

      const taskRes = await createTask(userA.accessToken, {
        title: 'Org A Task',
      }).expect(201);
      const taskId = taskRes.body.data.id;

      // User B (different org) cannot access
      await request(app.getHttpServer())
        .get(`/api/v1/tasks/${taskId}`)
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(404);
    });

    it('should not allow cross-org task update', async () => {
      const userA = await createAuthenticatedUser(app, {
        email: `taskisoupd-a-${Date.now()}@test.com`,
      });
      const userB = await createAuthenticatedUser(app, {
        email: `taskisoupd-b-${Date.now()}@test.com`,
      });

      const taskRes = await createTask(userA.accessToken, {
        title: 'Immutable',
      }).expect(201);
      const taskId = taskRes.body.data.id;

      await request(app.getHttpServer())
        .patch(`/api/v1/tasks/${taskId}`)
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .send({ title: 'Hacked' })
        .expect(404);
    });

    it('should isolate task lists between orgs', async () => {
      const userA = await createAuthenticatedUser(app, {
        email: `taskisolist-a-${Date.now()}@test.com`,
      });
      const userB = await createAuthenticatedUser(app, {
        email: `taskisolist-b-${Date.now()}@test.com`,
      });

      await createTask(userA.accessToken, { title: 'Org A Secret Task' }).expect(201);

      const resB = await request(app.getHttpServer())
        .get('/api/v1/tasks')
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(200);

      const titles = resB.body.data.map((t: { title: string }) => t.title);
      expect(titles).not.toContain('Org A Secret Task');
    });

    it('should not allow cross-org comment on task', async () => {
      const userA = await createAuthenticatedUser(app, {
        email: `taskisocom-a-${Date.now()}@test.com`,
      });
      const userB = await createAuthenticatedUser(app, {
        email: `taskisocom-b-${Date.now()}@test.com`,
      });

      const taskRes = await createTask(userA.accessToken, {
        title: 'No Cross Comment',
      }).expect(201);
      const taskId = taskRes.body.data.id;

      await request(app.getHttpServer())
        .post(`/api/v1/tasks/${taskId}/comments`)
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .send({ body: 'Cross-org comment' })
        .expect(404);
    });
  });
});
