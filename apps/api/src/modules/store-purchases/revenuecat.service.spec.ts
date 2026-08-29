/**
 * The conduit adapter: payload → `NormalizedStoreEvent`, and the one outbound
 * call.
 *
 * These are the only tests in this module that know a RevenueCat event-name
 * string. Everything downstream is conduit-neutral by construction, and if that
 * ever stops being true these tests are where it will show.
 */

import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import { RevenueCatService } from './revenuecat.service';

const AUTH_TOKEN = 'rc_secret';
const ORG_ID = '11111111-1111-4111-8111-111111111111';

function raw(event: Record<string, unknown>): string {
  return JSON.stringify({ api_version: '1.0', event });
}

describe('RevenueCatService', () => {
  let service: RevenueCatService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RevenueCatService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, fallback?: string) => {
              if (key === 'REVENUECAT_WEBHOOK_AUTH_TOKEN') return AUTH_TOKEN;
              if (key === 'REVENUECAT_API_KEY') return 'sk_test';
              if (key === 'REVENUECAT_API_URL') return 'https://api.revenuecat.test';
              return fallback ?? '';
            }),
          },
        },
      ],
    }).compile();

    service = module.get(RevenueCatService);
  });

  describe('verifyWebhookAuthorization', () => {
    it.each([
      [{ authorization: AUTH_TOKEN }, 'valid'],
      [{ Authorization: AUTH_TOKEN }, 'valid'],
      [{}, 'missing'],
      [{ authorization: 'wrong' }, 'invalid'],
      [{ authorization: '' }, 'missing'],
    ])('%j → %s', (headers, expected) => {
      expect(service.verifyWebhookAuthorization(headers as Record<string, string>)).toBe(expected);
    });

    it('does not read the raw body — there is no signature over it', () => {
      // RevenueCat authenticates with a configured header value, NOT an HMAC.
      // The method takes only headers, which is the point of naming it
      // `verifyWebhookAuthorization` rather than `verifyWebhookSignature`.
      expect(service.verifyWebhookAuthorization.length).toBe(1);
    });
  });

  describe('parseStoreEvent', () => {
    it.each([
      ['INITIAL_PURCHASE', 'purchase.initial'],
      ['RENEWAL', 'purchase.renewed'],
      ['CANCELLATION', 'purchase.cancelled'],
      ['UNCANCELLATION', 'purchase.uncancelled'],
      ['BILLING_ISSUE', 'purchase.billing_issue'],
      ['EXPIRATION', 'purchase.expired'],
      ['PRODUCT_CHANGE', 'purchase.product_changed'],
      ['SUBSCRIPTION_PAUSED', 'purchase.paused'],
      ['SUBSCRIPTION_EXTENDED', 'purchase.extended'],
      ['TRANSFER', 'purchase.transferred'],
      ['TEMPORARY_ENTITLEMENT_GRANT', 'purchase.temporary_grant'],
      ['REFUND_REVERSED', 'purchase.refund_reversed'],
      ['TEST', 'informational'],
      ['EXPERIMENT_ENROLLMENT', 'informational'],
      ['SUBSCRIBER_ALIAS', 'informational'],
      ['NON_RENEWING_PURCHASE', 'informational'],
      ['INVOICE_ISSUANCE', 'informational'],
      ['PURCHASE_REDEEMED', 'informational'],
      ['PRICE_INCREASE_CONSENT_REQUESTED', 'informational'],
      ['VIRTUAL_CURRENCY_TRANSACTION', 'informational'],
      ['SOMETHING_NEW_REVENUECAT_ADDED', 'unknown'],
    ])('maps %s → %s', (rcType, expected) => {
      expect(service.parseStoreEvent(raw({ id: 'e', type: rcType })).type).toBe(expected);
    });

    it('normalises an INITIAL_PURCHASE in full', () => {
      const event = service.parseStoreEvent(
        raw({
          id: 'rc_evt_1',
          type: 'INITIAL_PURCHASE',
          app_user_id: ORG_ID,
          aliases: [ORG_ID, 'anon_1'],
          product_id: 'com.libertasian.pro.monthly',
          entitlement_ids: ['pro'],
          period_type: 'TRIAL',
          environment: 'SANDBOX',
          store: 'PLAY_STORE',
          transaction_id: 'txn_1',
          original_transaction_id: 'orig_1',
          store_transaction_id: 'GPA.1234-5678-9012-34567',
          purchased_at_ms: 1754006400000,
          expiration_at_ms: 1756684800000,
        }),
      );

      expect(event).toMatchObject({
        conduit: 'revenuecat',
        eventId: 'rc_evt_1',
        providerEventName: 'INITIAL_PURCHASE',
        type: 'purchase.initial',
        store: 'play_store',
        environment: 'sandbox',
        appUserId: ORG_ID,
        aliases: [ORG_ID, 'anon_1'],
        productId: 'com.libertasian.pro.monthly',
        entitlementIds: ['pro'],
        periodType: 'TRIAL',
        transactionId: 'txn_1',
        originalTransactionId: 'orig_1',
        storeTransactionId: 'GPA.1234-5678-9012-34567',
      });
      expect(event.purchasedAt).toEqual(new Date(1754006400000));
      expect(event.expiresAt).toEqual(new Date(1756684800000));
    });

    it('defaults an unrecognised environment to production, never to sandbox', () => {
      // Failing open on `environment` would let a malformed event skip D10's
      // guard. Anything that is not explicitly SANDBOX is treated as the real
      // thing, so the guard applies.
      expect(service.parseStoreEvent(raw({ id: 'e', type: 'TEST' })).environment).toBe('production');
      expect(
        service.parseStoreEvent(raw({ id: 'e', type: 'TEST', environment: 'nonsense' })).environment,
      ).toBe('production');
      expect(
        service.parseStoreEvent(raw({ id: 'e', type: 'TEST', environment: 'sandbox' })).environment,
      ).toBe('sandbox');
    });

    it('upper-cases cancel and expiration reasons so the resolver can compare them', () => {
      const event = service.parseStoreEvent(
        raw({
          id: 'e',
          type: 'CANCELLATION',
          cancel_reason: 'customer_support',
          expiration_reason: 'billing_error',
        }),
      );
      expect(event.cancelReason).toBe('CUSTOMER_SUPPORT');
      expect(event.expirationReason).toBe('BILLING_ERROR');
    });

    it('maps MAC_APP_STORE onto app_store and an unknown store to null', () => {
      expect(service.parseStoreEvent(raw({ id: 'e', type: 'TEST', store: 'MAC_APP_STORE' })).store).toBe(
        'app_store',
      );
      expect(service.parseStoreEvent(raw({ id: 'e', type: 'TEST', store: 'AMAZON' })).store).toBeNull();
    });

    it('reads the deprecated singular entitlement_id when the plural is absent', () => {
      expect(
        service.parseStoreEvent(raw({ id: 'e', type: 'TEST', entitlement_id: 'pro' })).entitlementIds,
      ).toEqual(['pro']);
    });

    it('carries transfer participants through', () => {
      const event = service.parseStoreEvent(
        raw({
          id: 'e',
          type: 'TRANSFER',
          transferred_from: ['org-a'],
          transferred_to: ['org-b'],
        }),
      );
      expect(event.transferredFrom).toEqual(['org-a']);
      expect(event.transferredTo).toEqual(['org-b']);
    });

    it('rejects a malformed body rather than producing a half-parsed event', () => {
      expect(() => service.parseStoreEvent('{not json')).toThrow(/Malformed/);
    });

    it('produces PII-free audit metadata', () => {
      // The App User ID is an org uuid (D11), so there is nothing to redact —
      // but the audit payload must still carry only ids, slugs and statuses.
      const event = service.parseStoreEvent(
        raw({
          id: 'rc_evt_1',
          type: 'INITIAL_PURCHASE',
          app_user_id: ORG_ID,
          product_id: 'com.libertasian.pro.monthly',
          subscriber_attributes: { $email: { value: 'someone@example.com' } },
        }),
      );

      const serialised = JSON.stringify(event.auditMetadata);
      expect(serialised).not.toContain('@');
      expect(serialised).not.toContain('subscriber_attributes');
    });
  });

  describe('fetchSubscriberSnapshot', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('pulls the subscriber and normalises its entitlements', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          subscriber: {
            entitlements: {
              pro: {
                product_identifier: 'com.libertasian.pro.monthly',
                expires_date: '2026-09-01T00:00:00Z',
              },
            },
            subscriptions: {
              'com.libertasian.pro.monthly': {
                store: 'APP_STORE',
                period_type: 'normal',
                is_sandbox: false,
              },
            },
          },
        }),
      } as unknown as Response);

      const snapshot = await service.fetchSubscriberSnapshot(ORG_ID);

      expect(snapshot).toEqual({
        appUserId: ORG_ID,
        entitlements: [
          {
            id: 'pro',
            productId: 'com.libertasian.pro.monthly',
            store: 'app_store',
            expiresAt: new Date('2026-09-01T00:00:00Z'),
            willRenew: true,
            periodType: 'NORMAL',
            environment: 'production',
          },
        ],
      });
      expect(global.fetch).toHaveBeenCalledWith(
        `https://api.revenuecat.test/v1/subscribers/${ORG_ID}`,
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('marks a sandbox subscription so the caller can refuse it (D10)', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          subscriber: {
            entitlements: { pro: { product_identifier: 'p', expires_date: '2026-09-01T00:00:00Z' } },
            subscriptions: { p: { store: 'APP_STORE', is_sandbox: true } },
          },
        }),
      } as unknown as Response);

      const snapshot = await service.fetchSubscriberSnapshot(ORG_ID);
      expect(snapshot.entitlements[0]?.environment).toBe('sandbox');
    });

    it('reports willRenew=false once the store has seen an unsubscribe or a billing issue', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          subscriber: {
            entitlements: { pro: { product_identifier: 'p', expires_date: '2026-09-01T00:00:00Z' } },
            subscriptions: { p: { store: 'APP_STORE', unsubscribe_detected_at: '2026-08-20T00:00:00Z' } },
          },
        }),
      } as unknown as Response);

      const snapshot = await service.fetchSubscriberSnapshot(ORG_ID);
      expect(snapshot.entitlements[0]?.willRenew).toBe(false);
    });

    it('throws on a non-2xx rather than reporting an empty entitlement set', async () => {
      // An empty set means "revoke". A failed fetch must never be mistaken for
      // one, or an outage at the conduit would cancel every subscriber.
      jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 503 } as Response);
      await expect(service.fetchSubscriberSnapshot(ORG_ID)).rejects.toThrow(/503/);
    });

    it('refuses to call out with no API key configured', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          RevenueCatService,
          { provide: ConfigService, useValue: { get: jest.fn(() => '') } },
        ],
      }).compile();

      await expect(
        module.get(RevenueCatService).fetchSubscriberSnapshot(ORG_ID),
      ).rejects.toThrow(/REVENUECAT_API_KEY/);
    });
  });
});
