import { ForbiddenException, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import * as Joi from 'joi';

import { RedisService } from '../../common/services/redis.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminBypassAuditService } from '../../common/services/admin-bypass-audit.service';
import { AuditService } from '../audit/audit.service';
import { DigestsController } from '../digests/digests.controller';
import { DigestsService } from '../digests/digests.service';
import { FeatureFlagService } from '../feature-flags/feature-flags.service';
import { PlansService } from '../plans/plans.service';
import { UploadsController } from '../uploads/uploads.controller';
import { UploadsService } from '../uploads/uploads.service';
import { UserUploadSearchService } from '../uploads/user-upload-search.service';
import { EntitlementService } from './entitlement.service';
import { SubscriptionsService } from './subscriptions.service';
import { UsageQuotaService } from './usage-quota.service';

/**
 * WHAT A FREE ACCOUNT IS TOLD WHEN IT RUNS OUT.
 *
 * The free tier grants one digest generation and one camera scan per month —
 * positive numbers, chosen so that the refusal a free user eventually meets is
 * always a QUOTA refusal. A 0 limit takes a different branch in
 * `DigestsController.generateOnDemand` and answers 402 `subscription_required`,
 * which App Review reads as a paywall and which got a build rejected. Nothing
 * about that branch changed here; what changed is that free can no longer reach
 * it, and this file is what keeps it that way.
 *
 * Real services throughout — `SubscriptionsService` → `EntitlementService` →
 * `UsageQuotaService` → the controller's own gate. Only Redis, Prisma and the
 * work the handler delegates to are doubles. A mocked quota result would assert
 * the controller's `if` and nothing about the number the free plan grants,
 * which is the half that just moved.
 */
describe('free-tier refusals are quota refusals, never subscription_required', () => {
  const VARS = [
    'PAYWALL_ENFORCED',
    'STORE_PURCHASE_AVAILABLE_IOS',
    'STORE_PURCHASE_AVAILABLE_ANDROID',
  ] as const;

  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const v of VARS) {
      saved[v] = process.env[v];
      delete process.env[v];
    }
  });
  afterEach(() => {
    for (const v of VARS) {
      if (saved[v] === undefined) delete process.env[v];
      else process.env[v] = saved[v];
    }
  });

  const USER = {
    sub: 'user-1',
    organizationId: 'org-1',
    isPlatformAdmin: false,
  } as never;

  /**
   * The real graph over an in-memory Redis.
   *
   * `PAYWALL_ENFORCED=true` via PROCESS.ENV, not a `load:` factory: Joi coerces
   * `'true'` to a real boolean only on the env-var path, and
   * `isPaywallEnforcedForRequest` compares with `=== true`. Built the other way
   * the paywall would read OFF, `getEntitlements` would short-circuit to the
   * pro-sized fallback, and every assertion here would pass while measuring
   * nothing.
   */
  const build = async () => {
    Object.assign(process.env, { PAYWALL_ENFORCED: 'true' });

    const redisStore = new Map<string, string>();
    const generateOnDemand = jest.fn().mockResolvedValue({ jobId: 'job-1' });
    const uploadCameraScan = jest.fn().mockResolvedValue({ id: 'upload-1' });

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          validationSchema: Joi.object({
            PAYWALL_ENFORCED: Joi.boolean().default(false),
            STORE_PURCHASE_AVAILABLE_IOS: Joi.boolean().default(false),
            STORE_PURCHASE_AVAILABLE_ANDROID: Joi.boolean().default(false),
          }).unknown(true),
          validationOptions: { allowUnknown: true },
        }),
      ],
      // Providers only. The two controllers are constructed BY HAND below:
      // registering them would pull their `@UseGuards` chains into the test
      // module, and this file is about what the handler body decides once a
      // request is already past the guards.
      providers: [
        SubscriptionsService,
        EntitlementService,
        UsageQuotaService,
        {
          provide: PrismaService,
          useValue: {
            // A FREE org with no billing period — the shape a self-serve signup
            // has on the day it registers.
            subscription: {
              findFirst: jest.fn().mockResolvedValue({
                id: 'sub-1',
                organizationId: 'org-1',
                planCode: 'free',
                entitlementsJson: null,
                currentPeriodStart: null,
                currentPeriodEnd: null,
              }),
            },
            entitlementOverride: { findMany: jest.fn().mockResolvedValue([]) },
          },
        },
        {
          provide: RedisService,
          useValue: {
            get: jest.fn(async (k: string) => redisStore.get(k) ?? null),
            set: jest.fn(async (k: string, v: string) => {
              redisStore.set(k, v);
            }),
            del: jest.fn(async (k: string) => {
              redisStore.delete(k);
            }),
            incr: jest.fn(async (k: string) => {
              const next = Number(redisStore.get(k) ?? '0') + 1;
              redisStore.set(k, String(next));
              return next;
            }),
            getClient: () => ({
              // SET key 0 EX ttl NX — seeds the counter only if absent.
              set: jest.fn(async (k: string, v: string) => {
                if (!redisStore.has(k)) redisStore.set(k, v);
              }),
            }),
          },
        },
        { provide: AuditService, useValue: { log: jest.fn() } },
        { provide: AdminBypassAuditService, useValue: { record: jest.fn() } },
        // DB plans OFF — the hardcoded free defaults are what production runs.
        { provide: FeatureFlagService, useValue: { isEnabled: jest.fn().mockResolvedValue(false) } },
        { provide: PlansService, useValue: { resolveEntitlements: jest.fn() } },
      ],
    }).compile();

    const quota = moduleRef.get(UsageQuotaService);
    const audit = moduleRef.get(AuditService);

    const digests = new DigestsController(
      { generateOnDemand } as unknown as DigestsService,
      audit,
      quota,
      moduleRef.get(EntitlementService),
      { record: jest.fn() } as unknown as AdminBypassAuditService,
    );
    const uploads = new UploadsController(
      { uploadCameraScan } as unknown as UploadsService,
      audit,
      quota,
      {} as UserUploadSearchService,
    );

    return {
      digests,
      uploads,
      quota,
      entitlements: moduleRef.get(EntitlementService),
      generateOnDemand,
      uploadCameraScan,
      redisStore,
    };
  };

  /** Whatever the handler threw, as a plain body + status. */
  const refusal = async (call: () => Promise<unknown>) => {
    try {
      await call();
      return null;
    } catch (e) {
      const err = e as HttpException;
      return {
        status: err.getStatus(),
        body: err.getResponse() as Record<string, unknown>,
      };
    }
  };

  // ---- the resolved plan, at the top, because everything below rests on it ----

  it('a free org resolves to 3 / 1 / 1 / offlineReading true', async () => {
    const { quota, entitlements } = await build();

    // Through the quota layer, which is what the gates below consult...
    const summary = await quota.getUsageSummary('org-1', 'user-1');
    expect(summary.aiAnswers.limit).toBe(3);
    expect(summary.digestsPerMonth.limit).toBe(1);
    expect(summary.cameraScansPerMonth.limit).toBe(1);

    // ...and the non-metered half of the same answer.
    const ent = await entitlements.resolveEffectiveEntitlements('org-1');
    expect(ent.offlineReading).toBe(true);
    expect(ent.previewOnly).toBe(true);
  });

  // ---- POST /digests/generate-on-demand ----

  describe('digest generation', () => {
    const dto = { legalDocumentId: 'doc-1' } as never;

    it('allows the first call of the month', async () => {
      const { digests, generateOnDemand } = await build();

      const res = (await digests.generateOnDemand(dto, USER, '1.2.3.4')) as {
        success: boolean;
        meta: { quota: { used: number; limit: number; remaining: number } };
      };

      expect(res.success).toBe(true);
      expect(generateOnDemand).toHaveBeenCalledTimes(1);
      expect(res.meta.quota).toEqual({ used: 1, limit: 1, remaining: 0 });
    });

    it('refuses the SECOND call with 429 quota_exceeded', async () => {
      const { digests } = await build();

      await digests.generateOnDemand(dto, USER, '1.2.3.4');
      const second = await refusal(() => digests.generateOnDemand(dto, USER, '1.2.3.4'));

      expect(second?.status).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(second?.body).toMatchObject({
        success: false,
        error: 'quota_exceeded',
        limit: 1,
        currentUsage: 1,
      });
    });

    it('never answers subscription_required, however many times it is called', async () => {
      // THE regression this file exists for. The 402 branch is reachable only
      // at limit === 0, and a free org must never resolve to one.
      const { digests, generateOnDemand } = await build();

      for (let i = 0; i < 5; i++) {
        const res = await refusal(() => digests.generateOnDemand(dto, USER, '1.2.3.4'));
        expect(res?.status ?? 202).not.toBe(HttpStatus.PAYMENT_REQUIRED);
        expect(res?.body?.['error'] ?? 'quota_exceeded').not.toBe('subscription_required');
      }

      // ...and the allowance was real: exactly one generation actually ran.
      expect(generateOnDemand).toHaveBeenCalledTimes(1);
    });

    it('carries a resetAt so the client can say WHEN, not just no', async () => {
      const { digests } = await build();

      await digests.generateOnDemand(dto, USER, '1.2.3.4');
      const second = await refusal(() => digests.generateOnDemand(dto, USER, '1.2.3.4'));

      expect(typeof second?.body?.['resetAt']).toBe('string');
    });
  });

  // ---- POST /uploads/camera-scan ----

  describe('camera scan', () => {
    const files = [{ originalname: 'page-1.jpg', buffer: Buffer.from('x') }] as never;
    const dto = { devicePlatform: 'ios', captureMode: 'single_page' } as never;

    it('allows one scan, then refuses on quota', async () => {
      const { uploads, uploadCameraScan } = await build();

      await uploads.uploadCameraScan(files, dto, USER, '1.2.3.4');
      expect(uploadCameraScan).toHaveBeenCalledTimes(1);

      const second = await refusal(() =>
        uploads.uploadCameraScan(files, dto, USER, '1.2.3.4'),
      );

      expect(second?.status).toBe(HttpStatus.FORBIDDEN);
      expect(second?.body).toMatchObject({
        message: 'Camera scan quota exceeded for this month',
        quota: { used: 1, limit: 1 },
      });
      // The refused call did no work.
      expect(uploadCameraScan).toHaveBeenCalledTimes(1);
    });

    it('refuses with a quota body, not a payment demand', async () => {
      const { uploads } = await build();

      await uploads.uploadCameraScan(files, dto, USER, '1.2.3.4');
      const second = await refusal(() =>
        uploads.uploadCameraScan(files, dto, USER, '1.2.3.4'),
      );

      expect(second?.status).not.toBe(HttpStatus.PAYMENT_REQUIRED);
      expect(second?.body?.['error']).toBeUndefined();
      expect(second?.body).toHaveProperty('quota');
    });

    it('the refusal is a ForbiddenException carrying the counters', async () => {
      // Pinned because the client renders `quota.resetsAt`; a bare 403 string
      // would type-check and tell the user nothing.
      const { uploads } = await build();
      await uploads.uploadCameraScan(files, dto, USER, '1.2.3.4');

      await expect(
        uploads.uploadCameraScan(files, dto, USER, '1.2.3.4'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
