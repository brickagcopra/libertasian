import { INestApplication } from '@nestjs/common';
import type { UserRole } from '@libertasian/types';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');

import { createAuthenticatedUser, createTestApp } from './helpers';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { RbacCacheService } from '../src/modules/rbac/rbac-cache.service';

/**
 * Search index maintenance and the vector backfill, reached by a PLATFORM
 * admin whose JWT carries no organization.
 *
 * Regression pinned (prod, 2026-09-27): these routes carried TenantGuard,
 * which threw 403 "No organization context" for exactly this caller before
 * any permission check ran, so no real admin could rebuild the index. They
 * now use the /platform/staff and /admin/digests mechanism
 * (PlatformPermissionsGuard + platform `admin:ingestion`).
 *
 * The org-less token is minted by the app's own signer (AuthService's
 * issueTokenPair), so JwtStrategy validates it exactly as it would a real one.
 *
 * Requires PostgreSQL (migrations applied, `seed:rbac` run) and Redis. The
 * OpenSearch-backed routes are asserted only to get past the guards.
 */
describe('Index maintenance — platform admin without an organization (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let cache: RbacCacheService;
  let adminToken: string;
  let adminUserId: string;
  let memberToken: string;
  let documentId: string;

  interface TokenIssuer {
    issueTokenPair(
      userId: string,
      email: string,
      role: UserRole,
      organizationId: string,
      mfaVerified: boolean,
      deviceFingerprint: string,
    ): Promise<{ accessToken: string }>;
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    cache = app.get(RbacCacheService);

    // The platform admin: a real user, holding the system `admin` role as a
    // PLATFORM grant, with an access token that names no organization.
    const staff = await createAuthenticatedUser(app, {
      email: `idx-platform-admin-${Date.now()}@libertasian-test.com`,
    });
    adminUserId = staff.userId;
    const adminRole = await prisma.roleDefinition.findFirstOrThrow({
      where: { slug: 'admin', isSystem: true, organizationId: null },
      select: { id: true },
    });
    await prisma.platformRoleGrant.create({
      data: { userId: adminUserId, roleDefinitionId: adminRole.id },
    });
    await cache.invalidatePlatformForUser(adminUserId);

    const issuer = app.get(AuthService) as unknown as TokenIssuer;
    const pair = await issuer.issueTokenPair(
      adminUserId,
      staff.email,
      'member' as UserRole,
      undefined as unknown as string, // no organization
      true,
      'e2e-index-maintenance',
    );
    adminToken = pair.accessToken;

    // An ordinary org member (owner of their personal workspace), no grant.
    const member = await createAuthenticatedUser(app, {
      email: `idx-member-${Date.now()}@libertasian-test.com`,
    });
    memberToken = member.accessToken;

    // One real document for the targeted backfill.
    const source = await prisma.source.create({
      data: { name: `E2E index maintenance ${Date.now()}`, type: 'official' },
      select: { id: true },
    });
    const created = await prisma.legalDocument.create({
      data: {
        sourceId: source.id,
        title: 'E2E index maintenance fixture',
        documentType: 'codal',
      },
      select: { id: true },
    });
    documentId = created.id;
  }, 60000);

  afterAll(async () => {
    await prisma.platformRoleGrant.deleteMany({ where: { userId: adminUserId } });
    await cache.invalidatePlatformForUser(adminUserId);
    await prisma.vectorBackfillRun.updateMany({
      where: { status: { in: ['queued', 'running'] } },
      data: { status: 'cancelled' },
    });
    await app.close();
  });

  const api = () => request(app.getHttpServer());

  it('the admin token really carries no organization', () => {
    const payload = JSON.parse(
      Buffer.from(adminToken.split('.')[1]!, 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
    expect(payload['organizationId']).toBeUndefined();
  });

  describe('(a) platform admin, no organization', () => {
    it('POST /search/index/rebuild → 201 and an audit row with the actor, no org', async () => {
      const res = await api()
        .post('/api/v1/search/index/rebuild')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ dryRun: true })
        .expect(201);
      expect(res.body.data.jobId).toBeDefined();

      const row = await prisma.auditLog.findFirst({
        where: { action: 'search.index.rebuild_requested', actorUserId: adminUserId },
        orderBy: { createdAt: 'desc' },
      });
      expect(row).not.toBeNull();
      expect(row!.organizationId).toBeNull();
    });

    it('GET /search/index/topology gets past the guards (never 401/403)', async () => {
      // 200 with OpenSearch up; a 5xx here is the missing cluster, not auth.
      const res = await api()
        .get('/api/v1/search/index/topology')
        .set('Authorization', `Bearer ${adminToken}`);
      expect([401, 403]).not.toContain(res.status);
    });

    it('POST /admin/vector-backfill/runs → 201 (dry run), run row carries no org', async () => {
      const res = await api()
        .post('/api/v1/admin/vector-backfill/runs')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ dryRun: true, maxDocuments: 1 })
        .expect(201);

      const run = await prisma.vectorBackfillRun.findUniqueOrThrow({
        where: { id: res.body.data.id as string },
      });
      expect(run.triggeredByUserId).toBe(adminUserId);
      expect(run.organizationId).toBeNull();

      const row = await prisma.auditLog.findFirst({
        where: { action: 'search.vector_backfill.requested', entityId: run.id },
      });
      expect(row?.actorUserId).toBe(adminUserId);

      // Let the next test start its own run.
      await prisma.vectorBackfillRun.update({
        where: { id: run.id },
        data: { status: 'cancelled' },
      });
    });

    it('POST /admin/vector-backfill/runs with documentIds + force persists both', async () => {
      await prisma.vectorBackfillRun.updateMany({
        where: { status: { in: ['queued', 'running'] } },
        data: { status: 'cancelled' },
      });
      const res = await api()
        .post('/api/v1/admin/vector-backfill/runs')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ dryRun: true, documentIds: [documentId], force: true })
        .expect(201);

      const run = await prisma.vectorBackfillRun.findUniqueOrThrow({
        where: { id: res.body.data.id as string },
      });
      expect(run.documentIds).toEqual([documentId]);
      expect(run.force).toBe(true);
    });
  });

  describe('(b) org member without platform admin:ingestion', () => {
    it.each([
      ['post', '/api/v1/search/index/rebuild'],
      ['get', '/api/v1/search/index/topology'],
      ['post', '/api/v1/search/index/rollback'],
      ['post', '/api/v1/admin/vector-backfill/runs'],
      ['get', '/api/v1/admin/vector-backfill/gap'],
    ] as const)('%s %s → 403', async (method, path) => {
      await api()[method](path).set('Authorization', `Bearer ${memberToken}`).send({}).expect(403);
    });
  });

  describe('(c) validation', () => {
    it('force without documentIds → 400', async () => {
      const res = await api()
        .post('/api/v1/admin/vector-backfill/runs')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ force: true })
        .expect(400);
      expect(JSON.stringify(res.body)).toContain('force requires documentIds');
    });

    it('a non-UUID documentId → 400', async () => {
      await api()
        .post('/api/v1/admin/vector-backfill/runs')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ documentIds: ['../etc/passwd'] })
        .expect(400);
    });
  });
});
