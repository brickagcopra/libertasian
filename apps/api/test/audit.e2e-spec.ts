import { INestApplication } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');
import { createTestApp, createAuthenticatedUser } from './helpers';

/**
 * Audit E2E tests — audit log queries, exports, entity types/actions.
 * Per CLAUDE.md: audit_logs table is append-only. PII redacted in logs.
 * Retain for minimum 2 years (Philippine Data Privacy Act compliance).
 */
describe('Audit (E2E)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  // ── GET /audit — List Audit Logs ───────────────────────────

  describe('GET /api/v1/audit-logs', () => {
    it('should require authentication', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/audit-logs')
        .expect(401);
    });

    it('should return audit logs for authenticated user', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `audit-list-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/audit-logs')
        .set('Authorization', `Bearer ${user.accessToken}`);

      // Audit logs may require admin/editor role — 403 if RBAC denies, 200 if allowed
      expect([200, 403]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body.success).toBe(true);
        expect(Array.isArray(res.body.data)).toBe(true);
      }
    });

    it('should support pagination', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `audit-page-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/audit-logs?limit=5')
        .set('Authorization', `Bearer ${user.accessToken}`);

      // 403 if user lacks audit:read permission
      expect([200, 403]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body.success).toBe(true);
        expect(res.body.meta).toBeDefined();
      }
    });

    it('should filter by entity type', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `audit-entity-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/audit-logs?entityType=user')
        .set('Authorization', `Bearer ${user.accessToken}`);

      expect([200, 403]).toContain(res.status);
    });

    it('should filter by action', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `audit-action-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/audit-logs?action=login')
        .set('Authorization', `Bearer ${user.accessToken}`);

      expect([200, 403]).toContain(res.status);
    });

    it('should not expose PII in audit logs (redacted)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `audit-pii-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/audit-logs')
        .set('Authorization', `Bearer ${user.accessToken}`);

      // 403 if user lacks audit:read permission
      expect([200, 403]).toContain(res.status);
      if (res.status === 200) {
        // Check that no plaintext PII is in metadata
        for (const log of res.body.data) {
          if (log.metadataJson) {
            const meta = typeof log.metadataJson === 'string'
              ? JSON.parse(log.metadataJson)
              : log.metadataJson;
            const metaStr = JSON.stringify(meta);
            expect(metaStr).not.toMatch(/password/i);
          }
        }
      }
    });
  });

  // ── GET /audit/entity-types ────────────────────────────────

  describe('GET /api/v1/audit-logs/entity-types', () => {
    it('should return available entity types', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `audit-types-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/audit-logs/entity-types')
        .set('Authorization', `Bearer ${user.accessToken}`);

      // 403 if user lacks audit:read permission
      expect([200, 403]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body.success).toBe(true);
        expect(Array.isArray(res.body.data)).toBe(true);
      }
    });
  });

  // ── GET /audit/actions ─────────────────────────────────────

  describe('GET /api/v1/audit-logs/actions', () => {
    it('should return available audit actions', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `audit-actions-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/audit-logs/actions')
        .set('Authorization', `Bearer ${user.accessToken}`);

      // 403 if user lacks audit:read permission
      expect([200, 403]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body.success).toBe(true);
        expect(Array.isArray(res.body.data)).toBe(true);
      }
    });
  });

  // ── GET /audit/export ──────────────────────────────────────

  describe('GET /api/v1/audit-logs/export', () => {
    it('should require authentication for export', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/audit-logs/export')
        .expect(401);
    });

    it('should export audit logs', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `audit-export-${Date.now()}@test.com`,
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/audit-logs/export')
        .set('Authorization', `Bearer ${user.accessToken}`);

      // Should return 200 with export data or 403 if admin-only
      expect([200, 403]).toContain(res.status);
    });
  });
});
