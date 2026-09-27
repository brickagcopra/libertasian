import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import type { JwtPayload } from '@libertasian/types';
import type { Request } from 'express';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');

import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import { PLATFORM_PERMISSIONS_KEY } from '../../common/decorators/platform-permissions.decorator';
import { InternalApiGuard } from '../../common/guards/internal-api.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MfaGuard } from '../../common/guards/mfa.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { PlatformPermissionsGuard } from '../../common/guards/platform-permissions.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { AdminBypassAuditService } from '../../common/services/admin-bypass-audit.service';
import { AuditService } from '../audit/audit.service';
import { PlatformGrantsService } from '../rbac/platform-grants.service';
import { EntitlementService } from '../subscriptions/entitlement.service';
import { UsageQuotaService } from '../subscriptions/usage-quota.service';
import { VectorBackfillController } from '../vector-backfill/vector-backfill.controller';
import { VectorBackfillService } from '../vector-backfill/vector-backfill.service';
import { IndexRebuildService } from './index-rebuild.service';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

/**
 * The search index-maintenance and vector-backfill endpoints, over HTTP, with
 * the REAL PlatformPermissionsGuard and MfaGuard in the chain. Only the JWT
 * verification is stubbed: a test header names which principal the request
 * carries, as JwtStrategy would have attached it.
 *
 * Regression pinned (prod, 2026-09-27): these routes carried TenantGuard, which
 * 403'd every platform admin on "No organization context" — platform staff
 * belong to no organization by design — so no real admin could rebuild the
 * index. They now use the /platform/staff and /admin/digests mechanism.
 */

/** Holds platform `admin` (so admin:ingestion) and belongs to no organization. */
const PLATFORM_ADMIN = {
  sub: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  email: 'staff@example.com',
  role: 'member',
  mfaVerified: true,
} as unknown as JwtPayload;

/**
 * Owner of their own workspace. Their TENANT role may even list
 * admin:ingestion (a pre-#495 grant); what they lack is the PLATFORM grant.
 */
const ORG_MEMBER = {
  sub: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  email: 'member@example.com',
  role: 'member',
  mfaVerified: false,
  organizationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
} as unknown as JwtPayload;

const PRINCIPALS: Record<string, JwtPayload> = {
  admin: PLATFORM_ADMIN,
  member: ORG_MEMBER,
};

const DOC_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

/** Stands in for passport: attaches the principal named by `x-test-user`. */
class FakeJwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const who = req.headers['x-test-user'];
    const user = typeof who === 'string' ? PRINCIPALS[who] : undefined;
    if (!user) return false;
    Object.assign(req, { user });
    return true;
  }
}

const INDEX_ROUTES = [
  ['post', '/search/index/initialize'],
  ['get', '/search/index/topology'],
  ['post', '/search/index/rebuild'],
  ['get', '/search/index/rebuild/job-1'],
  ['post', '/search/index/rollback'],
  ['post', `/search/index/document/${DOC_ID}`],
  ['post', '/search/index/bulk'],
] as const;

const INDEX_HANDLERS = [
  'initializeIndexes',
  'getIndexTopology',
  'rebuildIndexes',
  'getRebuildStatus',
  'rollbackIndex',
  'indexDocument',
  'bulkIndex',
] as const;

describe('Index maintenance — platform admin without an organization', () => {
  let app: INestApplication;
  let platformGrants: { hasAllPlatformPermissions: jest.Mock; hasAnyPlatformPermission: jest.Mock };
  let indexRebuild: Record<string, jest.Mock>;
  let backfill: { enqueueRun: jest.Mock };
  let audit: { log: jest.Mock };

  beforeAll(async () => {
    const holdsPlatformIngestion = async (userId: string, codes: string[]) =>
      userId === PLATFORM_ADMIN.sub && codes.every((c) => c === 'admin:ingestion');
    platformGrants = {
      hasAllPlatformPermissions: jest.fn(holdsPlatformIngestion),
      hasAnyPlatformPermission: jest.fn(holdsPlatformIngestion),
    };
    indexRebuild = {
      describeTopology: jest.fn().mockResolvedValue({ aliases: [] }),
      enqueueRebuild: jest.fn().mockResolvedValue({ jobId: 'job-1' }),
      getJobStatus: jest.fn().mockResolvedValue({ jobId: 'job-1', state: 'active' }),
      rollbackAlias: jest.fn().mockResolvedValue({ alias: 'x', target: 'y' }),
    };
    backfill = {
      enqueueRun: jest.fn().mockResolvedValue({ id: 'run-1', jobId: 'job-9' }),
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      controllers: [SearchController, VectorBackfillController],
      providers: [
        {
          provide: SearchService,
          useValue: {
            initializeIndexes: jest.fn().mockResolvedValue({ ok: true }),
            indexLegalDocument: jest.fn().mockResolvedValue(undefined),
            bulkIndexDocuments: jest.fn().mockResolvedValue({ indexed: 0 }),
          },
        },
        { provide: IndexRebuildService, useValue: indexRebuild },
        { provide: VectorBackfillService, useValue: backfill },
        { provide: AuditService, useValue: audit },
        { provide: UsageQuotaService, useValue: {} },
        { provide: EntitlementService, useValue: {} },
        { provide: AdminBypassAuditService, useValue: { record: jest.fn() } },
        { provide: PlatformGrantsService, useValue: platformGrants },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(FakeJwtAuthGuard)
      // Only on the service-to-service route, which is not under test here.
      .overrideGuard(InternalApiGuard)
      .useValue({ canActivate: () => false })
      .compile();

    app = moduleRef.createNestApplication();
    // Same global pipe as main.ts.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: false },
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  const send = (method: 'get' | 'post', path: string, who: string) => {
    const req = request(app.getHttpServer())[method](path).set('x-test-user', who);
    if (method === 'get') return req;
    if (path.endsWith('/rollback')) {
      return req.send({
        alias: 'legal_documents_keyword',
        targetIndex: 'legal_documents_keyword_v2',
      });
    }
    if (path.endsWith('/bulk')) return req.send({ documentIds: [DOC_ID] });
    return req.send({});
  };

  describe('wiring', () => {
    it.each(INDEX_HANDLERS)(
      '%s: JwtAuthGuard + MfaGuard + PlatformPermissionsGuard, platform admin:ingestion, no TenantGuard',
      (handler) => {
        const fn = SearchController.prototype[handler] as unknown as object;
        expect(Reflect.getMetadata(GUARDS_METADATA, fn)).toEqual([
          JwtAuthGuard,
          MfaGuard,
          PlatformPermissionsGuard,
        ]);
        expect(Reflect.getMetadata(PLATFORM_PERMISSIONS_KEY, fn)).toEqual({
          permissions: ['admin:ingestion'],
          mode: 'all',
        });
        expect(Reflect.getMetadata(PERMISSIONS_KEY, fn)).toBeUndefined();
      },
    );

    it('user-facing search routes are untouched by the change', () => {
      const guardsOf = (name: keyof SearchController) =>
        Reflect.getMetadata(
          GUARDS_METADATA,
          SearchController.prototype[name] as unknown as object,
        ) as unknown[];
      // POST /search never carried TenantGuard; it resolves the org itself.
      expect(guardsOf('search')).toEqual([JwtAuthGuard]);
      for (const name of ['search', 'searchByCitation', 'getSuggestions'] as const) {
        expect(guardsOf(name)).not.toContain(PlatformPermissionsGuard);
      }
      // No guard on the class, so nothing is inherited by every route.
      expect(Reflect.getMetadata(GUARDS_METADATA, SearchController)).toBeUndefined();
    });

    it('no index-maintenance route is reachable through TenantGuard/PermissionsGuard', () => {
      for (const handler of INDEX_HANDLERS) {
        const guards = Reflect.getMetadata(
          GUARDS_METADATA,
          SearchController.prototype[handler] as unknown as object,
        ) as unknown[];
        expect(guards).not.toContain(TenantGuard);
        expect(guards).not.toContain(PermissionsGuard);
      }
    });
  });

  describe('(a) a platform admin with no organization gets 2xx', () => {
    it.each(INDEX_ROUTES)('%s %s', async (method, path) => {
      const res = await send(method, path, 'admin');
      expect(res.status).toBeGreaterThanOrEqual(200);
      expect(res.status).toBeLessThan(300);
    });

    it('GET /search/index/topology returns the topology', async () => {
      const res = await send('get', '/search/index/topology', 'admin').expect(200);
      expect(res.body).toEqual({ success: true, data: { aliases: [] } });
    });

    it('POST /search/index/rebuild enqueues with no organization and audits the actor', async () => {
      await request(app.getHttpServer())
        .post('/search/index/rebuild')
        .set('x-test-user', 'admin')
        .send({ dryRun: true })
        .expect(201);

      expect(indexRebuild['enqueueRebuild']).toHaveBeenCalledWith({
        triggeredByUserId: PLATFORM_ADMIN.sub,
        organizationId: undefined,
        dryRun: true,
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'search.index.rebuild_requested',
          actorUserId: PLATFORM_ADMIN.sub,
          actorType: 'admin',
          organizationId: undefined,
        }),
      );
    });

    it('POST /admin/vector-backfill/runs starts a run', async () => {
      await request(app.getHttpServer())
        .post('/admin/vector-backfill/runs')
        .set('x-test-user', 'admin')
        .send({ dryRun: true })
        .expect(201);

      expect(backfill.enqueueRun).toHaveBeenCalledWith(
        expect.objectContaining({
          triggeredByUserId: PLATFORM_ADMIN.sub,
          organizationId: undefined,
        }),
      );
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'search.vector_backfill.requested',
          actorUserId: PLATFORM_ADMIN.sub,
        }),
      );
    });

    it('POST /admin/vector-backfill/runs accepts documentIds + force', async () => {
      await request(app.getHttpServer())
        .post('/admin/vector-backfill/runs')
        .set('x-test-user', 'admin')
        .send({ documentIds: [DOC_ID], force: true })
        .expect(201);
      expect(backfill.enqueueRun).toHaveBeenCalledWith(
        expect.objectContaining({ documentIds: [DOC_ID], force: true }),
      );
    });
  });

  describe('(b) an org member without platform admin:ingestion still gets 403', () => {
    it.each([
      ...INDEX_ROUTES,
      ['post', '/admin/vector-backfill/runs'],
      ['get', '/admin/vector-backfill/gap'],
    ] as const)('%s %s', async (method, path) => {
      const res = await send(method, path, 'member');
      expect(res.status).toBe(403);
    });

    it('does not reach any service', async () => {
      await send('post', '/search/index/rebuild', 'member');
      await send('post', '/admin/vector-backfill/runs', 'member');
      expect(indexRebuild['enqueueRebuild']).not.toHaveBeenCalled();
      expect(backfill.enqueueRun).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });
  });

  describe('(c) request validation on vector-backfill start', () => {
    const start = (body: Record<string, unknown>) =>
      request(app.getHttpServer())
        .post('/admin/vector-backfill/runs')
        .set('x-test-user', 'admin')
        .send(body);

    it('force without documentIds is 400', async () => {
      const res = await start({ force: true }).expect(400);
      expect(JSON.stringify(res.body)).toContain('force requires documentIds');
      expect(backfill.enqueueRun).not.toHaveBeenCalled();
    });

    it('force with an empty documentIds list is 400', async () => {
      await start({ force: true, documentIds: [] }).expect(400);
      expect(backfill.enqueueRun).not.toHaveBeenCalled();
    });

    it('a non-UUID document id is 400', async () => {
      await start({ documentIds: ['not-a-uuid'] }).expect(400);
    });

    it('more than 100 document ids is 400', async () => {
      const ids = Array.from(
        { length: 101 },
        (_, i) => `dddddddd-dddd-4ddd-8ddd-${String(i).padStart(12, '0')}`,
      );
      await start({ documentIds: ids }).expect(400);
      await start({ documentIds: ids.slice(0, 100) }).expect(201);
    });
  });
});
