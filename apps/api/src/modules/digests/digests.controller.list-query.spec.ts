import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminBypassAuditService } from '../../common/services/admin-bypass-audit.service';
import { AuditService } from '../audit/audit.service';
import { EntitlementService } from '../subscriptions/entitlement.service';
import { UsageQuotaService } from '../subscriptions/usage-quota.service';
import { DigestsController } from './digests.controller';
import { DigestsService } from './digests.service';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');

/**
 * HTTP-level regression test for GET /digests query whitelisting.
 *
 * The global ValidationPipe runs with forbidNonWhitelisted: true, so any
 * query param missing from ListDigestsQueryDto turns the request into a 400.
 * The mobile app sends orderBy/orderDirection on every Digests page load —
 * before those fields were whitelisted, the page 400'd unconditionally.
 * This spec boots the controller behind the same pipe config as main.ts and
 * asserts the real HTTP status.
 */
describe('DigestsController — list query whitelisting (HTTP)', () => {
  let app: INestApplication;

  const digestsService = {
    list: jest.fn().mockResolvedValue({
      items: [],
      meta: { hasNext: false, nextCursor: undefined, limit: 20 },
    }),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [DigestsController],
      providers: [
        { provide: DigestsService, useValue: digestsService },
        { provide: AuditService, useValue: { log: jest.fn() } },
        { provide: UsageQuotaService, useValue: { checkAndIncrement: jest.fn() } },
        {
          provide: EntitlementService,
          useValue: {
            resolveEffectiveEntitlements: jest
              .fn()
              .mockResolvedValue({ previewOnly: false }),
          },
        },
        { provide: AdminBypassAuditService, useValue: { record: jest.fn() } },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: { switchToHttp: () => { getRequest: () => Record<string, unknown> } }) => {
          const req = ctx.switchToHttp().getRequest();
          req['user'] = {
            sub: '00000000-0000-0000-0000-000000000002',
            organizationId: '00000000-0000-0000-0000-000000000001',
          };
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    // Mirror the global pipe config from main.ts exactly
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

  beforeEach(() => {
    digestsService.list.mockClear();
  });

  it('returns 200 for GET /digests?orderBy=createdAt&orderDirection=desc', async () => {
    await request(app.getHttpServer())
      .get('/digests')
      .query({ orderBy: 'createdAt', orderDirection: 'desc' })
      .expect(200);

    expect(digestsService.list).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ orderBy: 'createdAt', orderDirection: 'desc' }),
      false,
    );
  });

  it('returns 400 for an invalid orderBy value', async () => {
    await request(app.getHttpServer())
      .get('/digests')
      .query({ orderBy: 'voteScore' })
      .expect(400);
  });

  it('still returns 400 for unknown query params (forbidNonWhitelisted intact)', async () => {
    await request(app.getHttpServer())
      .get('/digests')
      .query({ totallyUnknownParam: '1' })
      .expect(400);
  });
});
