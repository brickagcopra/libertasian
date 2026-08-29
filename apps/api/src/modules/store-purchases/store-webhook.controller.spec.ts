/**
 * The webhook route and its authentication (D4).
 *
 * A REAL `RevenueCatService` is bound to the port here rather than a stub, so
 * these tests exercise the actual `Authorization`-header check and the actual
 * payload → `NormalizedStoreEvent` translation. Only `StorePurchasesService` is
 * mocked — its own behaviour is covered in store-purchases.service.spec.ts.
 */

import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import type { Request } from 'express';

import { RedisService } from '../../common/services/redis.service';
import { AuditService } from '../audit/audit.service';
import { RevenueCatService } from './revenuecat.service';
import { STORE_PURCHASE_PROVIDER } from './store-purchase-provider.interface';
import { StorePurchasesService } from './store-purchases.service';
import { StoreWebhookController } from './store-webhook.controller';

const AUTH_TOKEN = 'rc_webhook_secret_value';
const ORG_ID = '11111111-1111-4111-8111-111111111111';

function body(overrides: Record<string, unknown> = {}) {
  return {
    api_version: '1.0',
    event: {
      id: 'rc_evt_1',
      type: 'INITIAL_PURCHASE',
      app_user_id: ORG_ID,
      product_id: 'com.libertasian.pro.monthly',
      entitlement_ids: ['pro'],
      period_type: 'NORMAL',
      environment: 'PRODUCTION',
      store: 'APP_STORE',
      transaction_id: 'txn_1',
      original_transaction_id: 'orig_1',
      purchased_at_ms: 1754006400000,
      expiration_at_ms: 1756684800000,
      ...overrides,
    },
  };
}

/**
 * `null` means "send no Authorization header at all" — deliberately not
 * `undefined`, because an explicit `undefined` would fall back to the default
 * parameter and quietly test the happy path instead.
 */
function reqWith(payload: unknown, authorization: string | null = AUTH_TOKEN) {
  return {
    rawBody: Buffer.from(JSON.stringify(payload)),
    headers: authorization === null ? {} : { authorization },
  } as unknown as RawBodyRequest<Request>;
}

describe('StoreWebhookController', () => {
  let controller: StoreWebhookController;
  let storePurchasesService: { handleStoreEvent: jest.Mock };
  let audit: { log: jest.Mock };
  let store: Map<string, string>;

  beforeEach(async () => {
    store = new Map();
    storePurchasesService = {
      handleStoreEvent: jest.fn().mockResolvedValue({ received: true, status: 'processed' }),
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StoreWebhookController],
      providers: [
        RevenueCatService,
        { provide: STORE_PURCHASE_PROVIDER, useExisting: RevenueCatService },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, fallback?: string) =>
              key === 'REVENUECAT_WEBHOOK_AUTH_TOKEN' ? AUTH_TOKEN : (fallback ?? ''),
            ),
          },
        },
        { provide: StorePurchasesService, useValue: storePurchasesService },
        { provide: AuditService, useValue: audit },
        {
          provide: RedisService,
          useValue: {
            get: jest.fn(async (k: string) => store.get(k) ?? null),
            set: jest.fn(async (k: string, v: string) => {
              store.set(k, v);
            }),
            del: jest.fn(async (k: string) => {
              store.delete(k);
            }),
          },
        },
      ],
    }).compile();

    controller = module.get(StoreWebhookController);
  });

  // ======================================================================
  // Webhook authentication (D4)
  // ======================================================================

  describe('authorization', () => {
    it('accepts the correct Authorization header', async () => {
      await expect(controller.handleStoreWebhook('revenuecat', reqWith(body()))).resolves.toEqual({
        received: true,
      });
      expect(storePurchasesService.handleStoreEvent).toHaveBeenCalledTimes(1);
    });

    it('rejects a MISSING Authorization header', async () => {
      await expect(
        controller.handleStoreWebhook('revenuecat', reqWith(body(), null)),
      ).rejects.toThrow(BadRequestException);
      expect(storePurchasesService.handleStoreEvent).not.toHaveBeenCalled();
    });

    it('rejects a WRONG Authorization header', async () => {
      await expect(
        controller.handleStoreWebhook('revenuecat', reqWith(body(), 'not-the-secret')),
      ).rejects.toThrow(BadRequestException);
      expect(storePurchasesService.handleStoreEvent).not.toHaveBeenCalled();
    });

    it('distinguishes missing from invalid in the 400 message', async () => {
      // Two distinct messages, matching the existing gateway webhook
      // controller. Neither reveals the expected value.
      await expect(
        controller.handleStoreWebhook('revenuecat', reqWith(body(), null)),
      ).rejects.toThrow(/Missing webhook authorization header/);
      await expect(
        controller.handleStoreWebhook('revenuecat', reqWith(body(), 'wrong')),
      ).rejects.toThrow(/Invalid webhook authorization/);
    });

    it('rejects a header of the same length but different bytes', async () => {
      // Guards the timing-safe comparison: a same-length value must not slip
      // through a length-only check.
      const sameLength = 'x'.repeat(AUTH_TOKEN.length);
      await expect(
        controller.handleStoreWebhook('revenuecat', reqWith(body(), sameLength)),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects EVERY webhook when no secret is configured', async () => {
      // A missing secret must CLOSE the endpoint, not open it. There is
      // deliberately no Joi default that would make this a working credential.
      const module: TestingModule = await Test.createTestingModule({
        controllers: [StoreWebhookController],
        providers: [
          RevenueCatService,
          { provide: STORE_PURCHASE_PROVIDER, useExisting: RevenueCatService },
          { provide: ConfigService, useValue: { get: jest.fn(() => '') } },
          { provide: StorePurchasesService, useValue: storePurchasesService },
          { provide: AuditService, useValue: audit },
          {
            provide: RedisService,
            useValue: { get: jest.fn(), set: jest.fn(), del: jest.fn() },
          },
        ],
      }).compile();
      const unconfigured = module.get(StoreWebhookController);

      await expect(
        unconfigured.handleStoreWebhook('revenuecat', reqWith(body(), 'anything')),
      ).rejects.toThrow(BadRequestException);
      expect(storePurchasesService.handleStoreEvent).not.toHaveBeenCalled();
    });

    it('rejects a missing body before doing anything else', async () => {
      await expect(
        controller.handleStoreWebhook('revenuecat', {
          rawBody: undefined,
          headers: { authorization: AUTH_TOKEN },
        } as unknown as RawBodyRequest<Request>),
      ).rejects.toThrow(/Missing request body/);
    });
  });

  // ======================================================================
  // Routing (D4)
  // ======================================================================

  describe('routing', () => {
    it('404s an unknown conduit slug rather than verifying with the wrong adapter', async () => {
      await expect(
        controller.handleStoreWebhook('stripe', reqWith(body())),
      ).rejects.toThrow(NotFoundException);
    });

    it('is mounted away from billing/webhooks so the gateway route cannot swallow it', () => {
      // D4: WebhookController is @Controller('billing/webhooks') with
      // @Post(':provider') and 404s any slug that is not the bound
      // PAYMENT_PROVIDER. Mounting here would be a runtime-only collision.
      expect(Reflect.getMetadata('path', StoreWebhookController)).toBe('store/webhooks');
    });
  });

  // ======================================================================
  // Idempotency, hot path
  // ======================================================================

  describe('idempotency', () => {
    it('short-circuits a replay on the Redis hot path', async () => {
      await controller.handleStoreWebhook('revenuecat', reqWith(body()));
      await controller.handleStoreWebhook('revenuecat', reqWith(body()));
      expect(storePurchasesService.handleStoreEvent).toHaveBeenCalledTimes(1);
    });

    it('drops the hot key on failure so the conduit retry can re-process', async () => {
      storePurchasesService.handleStoreEvent.mockRejectedValueOnce(new Error('db down'));

      await expect(
        controller.handleStoreWebhook('revenuecat', reqWith(body())),
      ).rejects.toThrow('db down');

      // The retry must reach the service, not be deduplicated away.
      await controller.handleStoreWebhook('revenuecat', reqWith(body()));
      expect(storePurchasesService.handleStoreEvent).toHaveBeenCalledTimes(2);
    });

    it('acknowledges an event with no id rather than making the conduit retry it', async () => {
      const result = await controller.handleStoreWebhook(
        'revenuecat',
        reqWith(body({ id: undefined })),
      );
      expect(result).toEqual({ received: true });
      expect(storePurchasesService.handleStoreEvent).not.toHaveBeenCalled();
    });
  });

  // ======================================================================
  // Audit
  // ======================================================================

  describe('audit', () => {
    it('writes billing.webhook.revenuecat.<event> with PII-free metadata', async () => {
      await controller.handleStoreWebhook('revenuecat', reqWith(body()));

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          actorType: 'system',
          action: 'billing.webhook.revenuecat.initial_purchase',
          entityType: 'store_webhook_event',
          entityId: 'rc_evt_1',
        }),
      );
      const metadata = audit.log.mock.calls[0][0].metadata as Record<string, unknown>;
      // The App User ID is an org uuid (D11), so there is no email anywhere in
      // the payload — but assert the audit carries no free-text user fields
      // regardless.
      expect(Object.keys(metadata).sort()).toEqual([
        'cancelReason',
        'detail',
        'environment',
        'expirationReason',
        'outcome',
        'periodType',
        'productId',
        'providerEventName',
        'rcEventId',
        'rcOriginalTransactionId',
        'store',
      ]);
    });

    it('does not audit an event whose processing threw', async () => {
      storePurchasesService.handleStoreEvent.mockRejectedValueOnce(new Error('db down'));
      await expect(
        controller.handleStoreWebhook('revenuecat', reqWith(body())),
      ).rejects.toThrow();
      expect(audit.log).not.toHaveBeenCalled();
    });
  });
});
