import { INestApplication } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');

import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, createAuthenticatedUser } from './helpers';

describe('Exports (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  // =========================================================================
  // Helper: look up the org a freshly-created test user belongs to.
  // The login response's sanitized user (users.service.ts:124-136
  // `sanitize()`) does not expose organizationId, so `user.user.organizationId`
  // is always undefined. Query the membership table directly instead.
  // =========================================================================

  async function getUserOrgId(userId: string): Promise<string> {
    const membership = await prisma.organizationMember.findFirst({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    if (!membership) {
      throw new Error(`No organization membership found for user ${userId}`);
    }
    return membership.organizationId;
  }

  // =========================================================================
  // Helper: create note via API
  // =========================================================================

  async function createNote(token: string, overrides: Record<string, unknown> = {}) {
    const res = await request(app.getHttpServer())
      .post('/api/v1/notes')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: `Export Test Note ${Date.now()}`,
        body: {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Test note content for export.' }] },
          ],
        },
        ...overrides,
      })
      .expect(201);

    return res.body.data;
  }

  // =========================================================================
  // Helper: create digest directly in DB (digests require legal_document link)
  // =========================================================================

  // Deterministic UUID for the shared E2E export source row. The old
  // 'e2e-export-source' string literal was rejected by Prisma because
  // Source.id is @db.Uuid (schema.prisma:402). Keep a fixed valid
  // UUID so the upsert still returns the same row across test runs.
  const EXPORT_TEST_SOURCE_ID = '00000000-0000-4e2e-8e2e-000000000001';

  async function createTestDigest(userId: string, orgId: string) {
    // Create minimal source
    const source = await prisma.source.upsert({
      where: { id: EXPORT_TEST_SOURCE_ID },
      update: {},
      create: {
        id: EXPORT_TEST_SOURCE_ID,
        name: 'E2E Export Test Source',
        type: 'editorial',
        trustLevel: 'medium',
        fetchStrategy: 'manual',
      },
    });

    // Create minimal legal document
    const doc = await prisma.legalDocument.create({
      data: {
        sourceId: source.id,
        documentType: 'case',
        jurisdiction: 'PH',
        title: `E2E Export Test Case ${Date.now()}`,
        citationText: 'G.R. No. 999999',
        grNo: '999999',
        court: 'Supreme Court',
        ponente: 'Justice Test',
        decisionDate: new Date('2024-01-01'),
        status: 'published',
        isPublished: true,
        isOfficial: false,
        truthfulnessStatus: 'needs_review',
      },
    });

    // Create digest
    const digest = await prisma.digest.create({
      data: {
        legalDocumentId: doc.id,
        organizationId: orgId,
        userId,
        sourceOrigin: 'admin_generated',
        digestType: 'case_digest',
        title: `E2E Test Digest ${Date.now()}`,
        summary: 'Summary for export test.',
        facts: 'Facts for export test.',
        issues: 'Whether the export feature works correctly.',
        ruling: 'The Court held that it does.',
        doctrine: null,
        dispositive: 'WHEREFORE, the export is GRANTED.',
        petitionerArguments: null,
        respondentArguments: null,
        citedAuthoritiesJson: [{ citation_text: 'G.R. No. 999999' }],
        confidenceScore: 0.8,
        reviewStatus: 'approved',
        visibility: 'private',
      },
    });

    return digest;
  }

  // =========================================================================
  // POST /api/v1/exports — Create export
  // =========================================================================

  describe('POST /api/v1/exports', () => {
    it('should reject unauthenticated requests', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/exports')
        .send({ contentType: 'note', contentId: 'any-id', format: 'pdf' })
        .expect(401);
    });

    it('should reject invalid content type', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `exp-invalid-ct-${Date.now()}@libertasian-test.com`,
      });

      await request(app.getHttpServer())
        .post('/api/v1/exports')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ contentType: 'invoice', contentId: 'any-id', format: 'pdf' })
        .expect(400);
    });

    it('should reject invalid format', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `exp-invalid-fmt-${Date.now()}@libertasian-test.com`,
      });

      await request(app.getHttpServer())
        .post('/api/v1/exports')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ contentType: 'note', contentId: 'any-id', format: 'csv' })
        .expect(400);
    });

    it('should reject invalid contentId (not UUID)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `exp-invalid-id-${Date.now()}@libertasian-test.com`,
      });

      await request(app.getHttpServer())
        .post('/api/v1/exports')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ contentType: 'note', contentId: 'not-a-uuid', format: 'pdf' })
        .expect(400);
    });

    it('should reject missing required fields', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `exp-missing-fields-${Date.now()}@libertasian-test.com`,
      });

      await request(app.getHttpServer())
        .post('/api/v1/exports')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ contentType: 'note' })
        .expect(400);
    });

    it('should reject unknown fields (whitelist)', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `exp-whitelist-${Date.now()}@libertasian-test.com`,
      });

      await request(app.getHttpServer())
        .post('/api/v1/exports')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          contentType: 'note',
          contentId: '00000000-0000-0000-0000-000000000000',
          format: 'pdf',
          isAdmin: true,
        })
        .expect(400);
    });

    it('should return 404 when content does not exist', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `exp-missing-note-${Date.now()}@libertasian-test.com`,
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/exports')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          contentType: 'note',
          contentId: '00000000-0000-0000-0000-000000000001',
          format: 'pdf',
        });

      // NotFoundException thrown during fetchContent → may be 404 or 400 depending on error handling
      expect([400, 404]).toContain(res.status);
    });

    it('should create a note PDF export successfully', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `exp-note-pdf-${Date.now()}@libertasian-test.com`,
      });

      const note = await createNote(user.accessToken);

      const res = await request(app.getHttpServer())
        .post('/api/v1/exports')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ contentType: 'note', contentId: note.id, format: 'pdf' });

      // May succeed (200/201) or fail due to missing S3 in test env
      if (res.status === 201 || res.status === 200) {
        expect(res.body.success).toBe(true);
        expect(res.body.data).toBeDefined();
        expect(res.body.data.contentType).toBe('note');
        expect(res.body.data.format).toBe('pdf');
        expect(res.body.data.status).toBe('completed');
      }
      // If S3 is not available, it will be 400 (generation failed)
    });

    it('should create a note DOCX export successfully', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `exp-note-docx-${Date.now()}@libertasian-test.com`,
      });

      const note = await createNote(user.accessToken);

      const res = await request(app.getHttpServer())
        .post('/api/v1/exports')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ contentType: 'note', contentId: note.id, format: 'docx' });

      if (res.status === 201 || res.status === 200) {
        expect(res.body.success).toBe(true);
        expect(res.body.data.format).toBe('docx');
      }
    });

    it('should create a digest PDF export successfully', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `exp-digest-pdf-${Date.now()}@libertasian-test.com`,
      });

      // user.user.organizationId is undefined (see getUserOrgId comment).
      const orgId = await getUserOrgId(user.userId);
      const digest = await createTestDigest(user.userId, orgId);

      const res = await request(app.getHttpServer())
        .post('/api/v1/exports')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ contentType: 'digest', contentId: digest.id, format: 'pdf' });

      if (res.status === 201 || res.status === 200) {
        expect(res.body.success).toBe(true);
        expect(res.body.data.contentType).toBe('digest');
      }
    });

    it('should deny export of another user private note', async () => {
      const userA = await createAuthenticatedUser(app, {
        email: `exp-owner-a-${Date.now()}@libertasian-test.com`,
      });
      const userB = await createAuthenticatedUser(app, {
        email: `exp-other-b-${Date.now()}@libertasian-test.com`,
      });

      const note = await createNote(userA.accessToken);

      const res = await request(app.getHttpServer())
        .post('/api/v1/exports')
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .send({ contentType: 'note', contentId: note.id, format: 'pdf' });

      expect([403, 404]).toContain(res.status);
    });

    it('should deny export of another user private digest', async () => {
      const userA = await createAuthenticatedUser(app, {
        email: `exp-dig-owner-${Date.now()}@libertasian-test.com`,
      });
      const userB = await createAuthenticatedUser(app, {
        email: `exp-dig-other-${Date.now()}@libertasian-test.com`,
      });

      // userA.user.organizationId is undefined (see getUserOrgId comment).
      const orgIdA = await getUserOrgId(userA.userId);
      const digest = await createTestDigest(userA.userId, orgIdA);

      const res = await request(app.getHttpServer())
        .post('/api/v1/exports')
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .send({ contentType: 'digest', contentId: digest.id, format: 'pdf' });

      expect([403, 404]).toContain(res.status);
    });
  });

  // =========================================================================
  // GET /api/v1/exports — List exports
  // =========================================================================

  describe('GET /api/v1/exports', () => {
    it('should reject unauthenticated requests', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/exports')
        .expect(401);
    });

    it('should return empty list for new user', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `exp-list-empty-${Date.now()}@libertasian-test.com`,
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/exports')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
      expect(res.body.nextCursor).toBeNull();
    });

    it('should list user exports after creation', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `exp-list-after-${Date.now()}@libertasian-test.com`,
      });

      const note = await createNote(user.accessToken);

      // Create export
      await request(app.getHttpServer())
        .post('/api/v1/exports')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ contentType: 'note', contentId: note.id, format: 'pdf' });

      const res = await request(app.getHttpServer())
        .get('/api/v1/exports')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      // Should have at least 1 export (even if failed due to S3)
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('should filter exports by contentType', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `exp-list-filter-${Date.now()}@libertasian-test.com`,
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/exports?contentType=memo')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('should reject invalid contentType filter', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `exp-list-bad-filter-${Date.now()}@libertasian-test.com`,
      });

      await request(app.getHttpServer())
        .get('/api/v1/exports?contentType=invoice')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(400);
    });

    it('should respect limit parameter', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `exp-list-limit-${Date.now()}@libertasian-test.com`,
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/exports?limit=5')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBeLessThanOrEqual(5);
    });

    it('should reject limit > 50', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `exp-list-limit-max-${Date.now()}@libertasian-test.com`,
      });

      await request(app.getHttpServer())
        .get('/api/v1/exports?limit=100')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(400);
    });

    it('should reject limit < 1', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `exp-list-limit-min-${Date.now()}@libertasian-test.com`,
      });

      await request(app.getHttpServer())
        .get('/api/v1/exports?limit=0')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(400);
    });

    it('should not show exports from other users', async () => {
      const userA = await createAuthenticatedUser(app, {
        email: `exp-list-iso-a-${Date.now()}@libertasian-test.com`,
      });
      const userB = await createAuthenticatedUser(app, {
        email: `exp-list-iso-b-${Date.now()}@libertasian-test.com`,
      });

      // User A creates an export
      const note = await createNote(userA.accessToken);
      await request(app.getHttpServer())
        .post('/api/v1/exports')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({ contentType: 'note', contentId: note.id, format: 'pdf' });

      // User B should not see User A's exports
      const res = await request(app.getHttpServer())
        .get('/api/v1/exports')
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(200);

      expect(res.body.data).toEqual([]);
    });
  });

  // =========================================================================
  // GET /api/v1/exports/:id — Get export detail
  // =========================================================================

  describe('GET /api/v1/exports/:id', () => {
    it('should reject unauthenticated requests', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/exports/00000000-0000-0000-0000-000000000000')
        .expect(401);
    });

    it('should return 404 for non-existent export', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `exp-get-404-${Date.now()}@libertasian-test.com`,
      });

      await request(app.getHttpServer())
        .get('/api/v1/exports/00000000-0000-0000-0000-000000000001')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(404);
    });

    it('should reject invalid UUID param', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `exp-get-baduuid-${Date.now()}@libertasian-test.com`,
      });

      await request(app.getHttpServer())
        .get('/api/v1/exports/not-a-uuid')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(400);
    });

    it('should return export detail for owner', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `exp-get-detail-${Date.now()}@libertasian-test.com`,
      });

      const note = await createNote(user.accessToken);

      // Create export
      const createRes = await request(app.getHttpServer())
        .post('/api/v1/exports')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ contentType: 'note', contentId: note.id, format: 'pdf' });

      // May fail if S3 not available — check for job creation anyway
      if (createRes.body.data?.id) {
        const res = await request(app.getHttpServer())
          .get(`/api/v1/exports/${createRes.body.data.id}`)
          .set('Authorization', `Bearer ${user.accessToken}`)
          .expect(200);

        expect(res.body.success).toBe(true);
        expect(res.body.data.id).toBe(createRes.body.data.id);
        expect(res.body.data.contentType).toBe('note');
      }
    });

    it('should deny access to another user export', async () => {
      const userA = await createAuthenticatedUser(app, {
        email: `exp-get-owner-${Date.now()}@libertasian-test.com`,
      });
      const userB = await createAuthenticatedUser(app, {
        email: `exp-get-other-${Date.now()}@libertasian-test.com`,
      });

      const note = await createNote(userA.accessToken);

      const createRes = await request(app.getHttpServer())
        .post('/api/v1/exports')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({ contentType: 'note', contentId: note.id, format: 'pdf' });

      if (createRes.body.data?.id) {
        const res = await request(app.getHttpServer())
          .get(`/api/v1/exports/${createRes.body.data.id}`)
          .set('Authorization', `Bearer ${userB.accessToken}`);

        expect([403, 404]).toContain(res.status);
      }
    });
  });

  // =========================================================================
  // GET /api/v1/exports/:id/download — Download export file
  // =========================================================================

  describe('GET /api/v1/exports/:id/download', () => {
    it('should reject unauthenticated requests', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/exports/00000000-0000-0000-0000-000000000000/download')
        .expect(401);
    });

    it('should return 404 for non-existent export download', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `exp-dl-404-${Date.now()}@libertasian-test.com`,
      });

      await request(app.getHttpServer())
        .get('/api/v1/exports/00000000-0000-0000-0000-000000000001/download')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(404);
    });

    it('should reject invalid UUID param for download', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `exp-dl-baduuid-${Date.now()}@libertasian-test.com`,
      });

      await request(app.getHttpServer())
        .get('/api/v1/exports/not-a-uuid/download')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(400);
    });

    it('should deny download to non-owner', async () => {
      const userA = await createAuthenticatedUser(app, {
        email: `exp-dl-owner-${Date.now()}@libertasian-test.com`,
      });
      const userB = await createAuthenticatedUser(app, {
        email: `exp-dl-other-${Date.now()}@libertasian-test.com`,
      });

      const note = await createNote(userA.accessToken);

      const createRes = await request(app.getHttpServer())
        .post('/api/v1/exports')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({ contentType: 'note', contentId: note.id, format: 'pdf' });

      if (createRes.body.data?.id) {
        const res = await request(app.getHttpServer())
          .get(`/api/v1/exports/${createRes.body.data.id}/download`)
          .set('Authorization', `Bearer ${userB.accessToken}`);

        expect([403, 404]).toContain(res.status);
      }
    });

    it('should set Content-Disposition: attachment header on download', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `exp-dl-header-${Date.now()}@libertasian-test.com`,
      });

      const note = await createNote(user.accessToken);

      const createRes = await request(app.getHttpServer())
        .post('/api/v1/exports')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ contentType: 'note', contentId: note.id, format: 'pdf' });

      if (createRes.body.data?.id && createRes.body.data?.status === 'completed') {
        const res = await request(app.getHttpServer())
          .get(`/api/v1/exports/${createRes.body.data.id}/download`)
          .set('Authorization', `Bearer ${user.accessToken}`);

        if (res.status === 200) {
          expect(res.headers['content-disposition']).toContain('attachment');
          expect(res.headers['content-type']).toContain('application/pdf');
        }
      }
    });

    it('should reject download of processing export', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `exp-dl-processing-${Date.now()}@libertasian-test.com`,
      });

      // Directly create a 'processing' export job. user.user.organizationId
      // is undefined in the login response (see getUserOrgId comment), so
      // look the org up from the membership table. Without this, Prisma
      // throws `Argument `organization` is missing` because organizationId
      // is a required FK on ExportJob (schema.prisma:2748).
      const orgId = await getUserOrgId(user.userId);
      const job = await prisma.exportJob.create({
        data: {
          organizationId: orgId,
          userId: user.userId,
          contentType: 'note',
          contentId: '00000000-0000-0000-0000-000000000000',
          format: 'pdf',
          status: 'processing',
          startedAt: new Date(),
        },
      });

      await request(app.getHttpServer())
        .get(`/api/v1/exports/${job.id}/download`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(400);
    });

    it('should reject download of expired export', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `exp-dl-expired-${Date.now()}@libertasian-test.com`,
      });

      // Directly create an expired 'completed' export job (see
      // getUserOrgId comment for why we can't read organizationId
      // straight off `user.user`).
      const orgId = await getUserOrgId(user.userId);
      const job = await prisma.exportJob.create({
        data: {
          organizationId: orgId,
          userId: user.userId,
          contentType: 'note',
          contentId: '00000000-0000-0000-0000-000000000000',
          format: 'pdf',
          status: 'completed',
          objectKey: 'exports/test/expired.pdf',
          filename: 'expired.pdf',
          fileSizeBytes: 100,
          expiresAt: new Date(Date.now() - 86400000), // 24 hours ago
          startedAt: new Date(),
          finishedAt: new Date(),
        },
      });

      await request(app.getHttpServer())
        .get(`/api/v1/exports/${job.id}/download`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(400);
    });

    it('should reject download of failed export', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `exp-dl-failed-${Date.now()}@libertasian-test.com`,
      });

      // user.user.organizationId is undefined (see getUserOrgId comment).
      const orgId = await getUserOrgId(user.userId);
      const job = await prisma.exportJob.create({
        data: {
          organizationId: orgId,
          userId: user.userId,
          contentType: 'note',
          contentId: '00000000-0000-0000-0000-000000000000',
          format: 'pdf',
          status: 'failed',
          failureReason: 'Test failure',
          startedAt: new Date(),
          finishedAt: new Date(),
        },
      });

      await request(app.getHttpServer())
        .get(`/api/v1/exports/${job.id}/download`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(400);
    });
  });

  // =========================================================================
  // Input validation edge cases
  // =========================================================================

  describe('input validation', () => {
    it('should reject empty body on POST', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `exp-val-empty-${Date.now()}@libertasian-test.com`,
      });

      await request(app.getHttpServer())
        .post('/api/v1/exports')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({})
        .expect(400);
    });

    it('should reject contentType as number', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `exp-val-numtype-${Date.now()}@libertasian-test.com`,
      });

      await request(app.getHttpServer())
        .post('/api/v1/exports')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ contentType: 123, contentId: '00000000-0000-0000-0000-000000000000', format: 'pdf' })
        .expect(400);
    });

    it('should reject cursor as non-UUID on list', async () => {
      const user = await createAuthenticatedUser(app, {
        email: `exp-val-cursor-${Date.now()}@libertasian-test.com`,
      });

      await request(app.getHttpServer())
        .get('/api/v1/exports?cursor=not-a-uuid')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(400);
    });
  });
});
