import { INestApplication } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');
import { createTestApp, createAuthenticatedUser } from './helpers';

/**
 * Notifications E2E tests — list, read, mark-all-read, delete.
 */
describe('Notifications (E2E)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/v1/notifications', () => {
    it('should require authentication', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/notifications')
        .expect(401);
    });

    it('should list notifications (initially empty)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `notif-list-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/notifications')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe('GET /api/v1/notifications/unread-count', () => {
    it('should return unread count', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `notif-unread-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/notifications/unread-count')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(typeof res.body.data.count).toBe('number');
    });
  });

  describe('POST /api/v1/notifications/mark-all-read', () => {
    it('should require authentication', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/notifications/mark-all-read')
        .expect(401);
    });

    it('should mark all notifications as read', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `notif-markall-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/notifications/mark-all-read')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(201); // NestJS POST default status code

      expect(res.body.success).toBe(true);
    });
  });

  describe('PATCH /api/v1/notifications/:id/read', () => {
    it('should return 404 for non-existent notification', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `notif-read404-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .patch('/api/v1/notifications/00000000-0000-0000-0000-000000000000/read')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(404);
    });
  });

  describe('DELETE /api/v1/notifications/:id', () => {
    it('should return 404 for non-existent notification', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `notif-del404-${Date.now()}@test.com`,
      });

      await request(app.getHttpServer())
        .delete('/api/v1/notifications/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(404);
    });
  });
});
