/**
 * StorePurchasesService — everything §4.1's table cannot express on its own:
 * idempotency, sandbox isolation, the two double-billing guards, the org rule,
 * the transfer's unique-constraint trap, and the entitlement-cache invariant.
 *
 * Tested entirely against SYNTHETIC RevenueCat payloads. No store account
 * exists, and none is needed: the adapter's job is to turn a payload into a
 * `NormalizedStoreEvent`, and everything below that line is ours.
 */

import { ConflictException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EntitlementService } from '../subscriptions/entitlement.service';
import { SubscriptionLifecycleService } from '../subscriptions/subscription-lifecycle.service';
import {
  SubscriptionAction,
  SubscriptionState,
} from '../subscriptions/subscription-state-machine';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { STORE_PURCHASE_PROVIDER } from './store-purchase-provider.interface';
import type { NormalizedStoreEvent } from './store-purchase-provider.interface';
import { StorePurchasesService } from './store-purchases.service';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const SUB_ID = '44444444-4444-4444-8444-444444444444';

/** A synthetic normalized event. Defaults describe a healthy pro monthly buy. */
function evt(overrides: Partial<NormalizedStoreEvent> = {}): NormalizedStoreEvent {
  return {
    conduit: 'revenuecat',
    eventId: 'rc_evt_1',
    providerEventName: 'INITIAL_PURCHASE',
    type: 'purchase.initial',
    store: 'app_store',
    environment: 'production',
    appUserId: ORG_ID,
    aliases: [],
    productId: 'com.libertasian.pro.monthly',
    entitlementIds: ['pro'],
    periodType: 'NORMAL',
    transactionId: 'txn_1',
    originalTransactionId: 'orig_1',
    storeTransactionId: null,
    purchasedAt: new Date('2026-08-01T00:00:00Z'),
    expiresAt: new Date('2026-09-01T00:00:00Z'),
    cancelReason: null,
    expirationReason: null,
    transferredFrom: [],
    transferredTo: [],
    auditMetadata: { rcEventId: 'rc_evt_1' },
    ...overrides,
  };
}

/** A P2002 the way Prisma raises it on the rc_event_id unique index. */
function uniqueViolation(target: string) {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target: [target] },
  });
}

describe('StorePurchasesService', () => {
  let service: StorePurchasesService;
  let prisma: {
    organization: { findUnique: jest.Mock };
    organizationMember: { count: jest.Mock };
    subscription: {
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
    };
    subscriptionLifecycleEvent: { updateMany: jest.Mock };
    storePurchase: {
      upsert: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      findFirst: jest.Mock;
    };
    storeWebhookEvent: { create: jest.Mock; update: jest.Mock; findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  let lifecycle: { executeTransition: jest.Mock };
  let entitlements: { invalidateEntitlementCache: jest.Mock };
  let audit: { log: jest.Mock };
  let storeProvider: { slug: string; fetchSubscriberSnapshot: jest.Mock };
  let nodeEnv: string;

  /** Transaction client handed to $transaction callbacks. */
  let txClient: Record<string, unknown>;

  beforeEach(async () => {
    nodeEnv = 'production';

    prisma = {
      organization: { findUnique: jest.fn().mockResolvedValue({ id: ORG_ID }) },
      organizationMember: { count: jest.fn().mockResolvedValue(1) },
      subscription: {
        create: jest.fn().mockResolvedValue({ id: SUB_ID }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      subscriptionLifecycleEvent: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      storePurchase: {
        upsert: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      storeWebhookEvent: {
        create: jest.fn().mockResolvedValue({ id: 'evt-row-1' }),
        update: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn(),
    };

    txClient = {
      subscription: {
        create: jest.fn().mockResolvedValue({ id: SUB_ID }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(txClient),
    );

    lifecycle = { executeTransition: jest.fn().mockResolvedValue({ success: true }) };
    entitlements = { invalidateEntitlementCache: jest.fn().mockResolvedValue(undefined) };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    storeProvider = {
      slug: 'revenuecat',
      fetchSubscriberSnapshot: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorePurchasesService,
        { provide: STORE_PURCHASE_PROVIDER, useValue: storeProvider },
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: SubscriptionLifecycleService, useValue: lifecycle },
        { provide: EntitlementService, useValue: entitlements },
        {
          provide: SubscriptionsService,
          useValue: {
            getDefaultEntitlements: jest.fn().mockReturnValue({}),
            hasAccessibleSubscription: jest.fn().mockResolvedValue(false),
          },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn((key: string) => (key === 'NODE_ENV' ? nodeEnv : undefined)) },
        },
      ],
    }).compile();

    service = module.get(StorePurchasesService);
  });

  /** Put the org on an existing store subscription in `status`. */
  function withStoreSubscription(status: SubscriptionState, extra: Record<string, unknown> = {}) {
    prisma.subscription.findFirst.mockImplementation(async (args: { where: { provider?: unknown } }) => {
      const wantsStore =
        JSON.stringify(args.where.provider ?? '').includes('app_store');
      return wantsStore
        ? {
            id: SUB_ID,
            organizationId: ORG_ID,
            planCode: 'pro',
            status,
            provider: 'app_store',
            providerSubscriptionId: 'orig_1',
            currentPeriodEnd: new Date('2026-09-01T00:00:00Z'),
            cancelAtPeriodEnd: false,
            ...extra,
          }
        : null;
    });
  }

  // ======================================================================
  // Idempotency — §9
  // ======================================================================

  describe('idempotency', () => {
    it('acknowledges a replayed rc_event_id as a no-op, and the UNIQUE index is what enforces it', async () => {
      // The durable check is the insert itself, not a preceding read: a
      // read-then-write would let two concurrent deliveries of the same event
      // both through. So the P2002 from the unique index on
      // store_webhook_events.rc_event_id IS the idempotency mechanism.
      prisma.storeWebhookEvent.create.mockRejectedValueOnce(uniqueViolation('rc_event_id'));
      prisma.storeWebhookEvent.findUnique.mockResolvedValueOnce({
        id: 'evt-row-1',
        processedAt: new Date(),
      });

      const result = await service.handleStoreEvent(evt());

      expect(result).toEqual({ received: true, status: 'duplicate' });
      // The whole point: nothing downstream ran a second time.
      expect(lifecycle.executeTransition).not.toHaveBeenCalled();
      expect(prisma.subscription.create).not.toHaveBeenCalled();
      expect(entitlements.invalidateEntitlementCache).not.toHaveBeenCalled();
    });

    it('re-processes a conflicting event whose previous attempt never completed', async () => {
      // A row with processed_at IS NULL is a FAILED ATTEMPT, not a duplicate.
      // Treating it as one would silently drop the very event the conduit is
      // retrying because we asked it to.
      prisma.storeWebhookEvent.create.mockRejectedValueOnce(uniqueViolation('rc_event_id'));
      prisma.storeWebhookEvent.findUnique.mockResolvedValueOnce({
        id: 'evt-row-1',
        processedAt: null,
      });

      const result = await service.handleStoreEvent(evt());

      expect(result.status).toBe('processed');
      expect(lifecycle.executeTransition).toHaveBeenCalled();
    });

    it('records the event BEFORE processing, so a failure is still on the record', async () => {
      lifecycle.executeTransition.mockRejectedValue(new Error('db down'));

      await expect(service.handleStoreEvent(evt())).rejects.toThrow('db down');

      expect(prisma.storeWebhookEvent.create).toHaveBeenCalled();
      // The failure reason is written, and processed_at stays NULL so the
      // conduit's retry can re-process rather than being deduplicated away.
      expect(prisma.storeWebhookEvent.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { processingError: 'db down' } }),
      );
    });

    it('rethrows a non-P2002 database error rather than treating it as a duplicate', async () => {
      prisma.storeWebhookEvent.create.mockRejectedValueOnce(new Error('connection refused'));
      await expect(service.handleStoreEvent(evt())).rejects.toThrow('connection refused');
    });
  });

  // ======================================================================
  // D10 — sandbox isolation
  // ======================================================================

  describe('sandbox isolation (D10)', () => {
    it('NEVER grants production entitlement from a sandbox event', async () => {
      nodeEnv = 'production';

      const result = await service.handleStoreEvent(evt({ environment: 'sandbox' }));

      expect(result).toEqual({ received: true, status: 'ignored_sandbox' });
      expect(prisma.subscription.create).not.toHaveBeenCalled();
      expect(lifecycle.executeTransition).not.toHaveBeenCalled();
      expect(entitlements.invalidateEntitlementCache).not.toHaveBeenCalled();
    });

    it('still persists the sandbox event and returns 200 rather than making the conduit retry', async () => {
      nodeEnv = 'production';
      await service.handleStoreEvent(evt({ environment: 'sandbox' }));

      expect(prisma.storeWebhookEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ environment: 'sandbox' }) }),
      );
      expect(prisma.storeWebhookEvent.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ processedAt: expect.any(Date) }) }),
      );
    });

    it('ignores a sandbox EXPIRATION too — a sandbox event may not revoke either', async () => {
      nodeEnv = 'production';
      withStoreSubscription(SubscriptionState.ACTIVE);

      const result = await service.handleStoreEvent(
        evt({ type: 'purchase.expired', environment: 'sandbox', providerEventName: 'EXPIRATION' }),
      );

      expect(result.status).toBe('ignored_sandbox');
      expect(lifecycle.executeTransition).not.toHaveBeenCalled();
    });

    it('applies the mirror rule: a production event is ignored outside production', async () => {
      nodeEnv = 'development';

      const result = await service.handleStoreEvent(evt({ environment: 'production' }));

      expect(result).toEqual({ received: true, status: 'ignored_production' });
      expect(prisma.subscription.create).not.toHaveBeenCalled();
    });

    it('processes a sandbox event normally outside production', async () => {
      nodeEnv = 'development';
      const result = await service.handleStoreEvent(evt({ environment: 'sandbox' }));
      expect(result.status).toBe('processed');
    });
  });

  // ======================================================================
  // D7 — the product map is the enforcement point
  // ======================================================================

  describe('product mapping (D7)', () => {
    it('records and REFUSES an event whose product id is not in the map', async () => {
      const result = await service.handleStoreEvent(
        evt({ productId: 'com.libertasian.enterprise.monthly' }),
      );

      expect(result).toEqual({ received: true, status: 'unmapped_product' });
      expect(prisma.subscription.create).not.toHaveBeenCalled();
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'billing.iap.unmapped_product' }),
      );
    });

    it('cannot be made to grant team or enterprise by any product id', async () => {
      // The structural guarantee: no entry in STORE_PRODUCT_MAP resolves to
      // team or enterprise, so no store event — however malformed or hostile —
      // can unlock them.
      for (const productId of [
        'com.libertasian.team.monthly',
        'com.libertasian.enterprise.annual',
        'team',
        'enterprise',
        '../pro.monthly',
      ]) {
        prisma.subscription.create.mockClear();
        const result = await service.handleStoreEvent(evt({ productId, eventId: `e_${productId}` }));
        expect(result.status).toBe('unmapped_product');
        expect(prisma.subscription.create).not.toHaveBeenCalled();
      }
    });

    it.each([
      ['com.libertasian.pro.monthly', 'pro', 'monthly'],
      ['com.libertasian.pro.annual', 'pro', 'annual'],
      ['com.libertasian.edu.monthly', 'edu', 'monthly'],
      ['com.libertasian.edu.annual', 'edu', 'annual'],
    ])('creates a %s subscription as %s/%s', async (productId, planCode, billingPeriod) => {
      await service.handleStoreEvent(evt({ productId }));

      expect(prisma.subscription.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ planCode, billingPeriod, provider: 'app_store' }),
        }),
      );
    });
  });

  // ======================================================================
  // INITIAL_PURCHASE — the created row
  // ======================================================================

  describe('INITIAL_PURCHASE', () => {
    it('creates the row in provisioning and only then activates it', async () => {
      await service.handleStoreEvent(evt());

      // PROVISIONING is deliberately absent from ACCESSIBLE_STATES: a row that
      // has not been through the transition must never resolve to its tier.
      expect(prisma.subscription.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: SubscriptionState.PROVISIONING }),
        }),
      );
      expect(lifecycle.executeTransition).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriptionId: SUB_ID,
          action: SubscriptionAction.ACTIVATE,
          actorType: 'system',
        }),
      );
    });

    it('stores the App User ID as providerCustomerId and the original transaction as providerSubscriptionId (D11)', async () => {
      await service.handleStoreEvent(evt());

      expect(prisma.subscription.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            providerCustomerId: ORG_ID,
            providerSubscriptionId: 'orig_1',
          }),
        }),
      );
    });

    it('invalidates the entitlement cache after granting', async () => {
      await service.handleStoreEvent(evt());
      expect(entitlements.invalidateEntitlementCache).toHaveBeenCalledWith(ORG_ID);
    });

    it('writes the store_purchases row with plan and period denormalised', async () => {
      await service.handleStoreEvent(evt({ productId: 'com.libertasian.edu.annual' }));

      expect(prisma.storePurchase.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { store_rcTransactionId: { store: 'app_store', rcTransactionId: 'txn_1' } },
          create: expect.objectContaining({
            planCode: 'edu',
            billingPeriod: 'annual',
            environment: 'production',
            appUserId: ORG_ID,
            status: 'active',
          }),
        }),
      );
    });

    it('records an unresolvable app_user_id rather than dropping the event', async () => {
      prisma.organization.findUnique.mockResolvedValue(null);

      const result = await service.handleStoreEvent(evt({ appUserId: OTHER_ORG_ID }));

      expect(result).toEqual({ received: true, status: 'unresolved_org' });
      expect(prisma.storeWebhookEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ organizationId: null }) }),
      );
    });

    it('records a non-uuid app_user_id as unresolvable without hitting the database', async () => {
      const result = await service.handleStoreEvent(evt({ appUserId: 'not-a-uuid' }));
      expect(result.status).toBe('unresolved_org');
      expect(prisma.organization.findUnique).not.toHaveBeenCalled();
    });
  });

  // ======================================================================
  // Finding (f) — the trial expiry backstop
  // ======================================================================

  describe('trial purchases — finding (f)', () => {
    it('schedules trial_expiry a day PAST the store expiry so the store always wins', async () => {
      // The trial_expiry scheduled event is ours; the trial is the store's. Our
      // job could otherwise fire first — clock skew, or a store-side extension
      // — and expire a trial the store still considers live.
      const expiresAt = new Date('2026-09-01T00:00:00Z');
      await service.handleStoreEvent(evt({ periodType: 'TRIAL', expiresAt }));

      const created = prisma.subscription.create.mock.calls[0][0].data;
      expect(created.trialEnd.getTime()).toBe(expiresAt.getTime() + 24 * 60 * 60 * 1000);
      expect(created.trialStart).toEqual(new Date('2026-08-01T00:00:00Z'));
      expect(lifecycle.executeTransition).toHaveBeenCalledWith(
        expect.objectContaining({ action: SubscriptionAction.START_TRIAL }),
      );
    });

    it('honours the purchase as ACTIVE when our own trial guard refuses START_TRIAL', async () => {
      // The store has already granted the trial. A guard failure must not 500
      // the webhook and strand a subscriber on `provisioning`, which grants
      // nothing.
      lifecycle.executeTransition
        .mockRejectedValueOnce(new Error('Organization has already used a trial for this plan'))
        .mockResolvedValueOnce({ success: true });

      const result = await service.handleStoreEvent(evt({ periodType: 'TRIAL' }));

      expect(result.status).toBe('processed');
      expect(lifecycle.executeTransition).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ action: SubscriptionAction.ACTIVATE }),
      );
    });

    it('does NOT swallow a failure on a non-trial activation', async () => {
      lifecycle.executeTransition.mockRejectedValue(new Error('boom'));
      await expect(service.handleStoreEvent(evt())).rejects.toThrow('boom');
    });
  });

  // ======================================================================
  // §6.1 — web subscription exists, the store purchase wins
  // ======================================================================

  describe('double-billing guard §6.1 (store purchase arrives with a live web sub)', () => {
    beforeEach(() => {
      prisma.subscription.findFirst.mockImplementation(
        async (args: { where: { provider?: { in?: string[] } } }) => {
          const providers = args.where.provider?.in ?? [];
          if (providers.includes('xendit')) {
            return {
              id: 'web-sub-1',
              organizationId: ORG_ID,
              planCode: 'pro',
              status: SubscriptionState.ACTIVE,
              provider: 'xendit',
              providerSubscriptionId: 'xnd_1',
              currentPeriodEnd: new Date('2026-09-15T00:00:00Z'),
              cancelAtPeriodEnd: false,
            };
          }
          return null;
        },
      );
    });

    it('HONOURS the store purchase and stops the web subscription renewing', async () => {
      // The store charge is irreversible by us; the web charge is ours and we
      // can stop it. Cancelling the reversible one is the only choice that does
      // not require the user to file a store refund request.
      const result = await service.handleStoreEvent(evt());

      expect(result.status).toBe('processed');
      expect(lifecycle.executeTransition).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriptionId: 'web-sub-1',
          action: SubscriptionAction.REQUEST_CANCEL,
        }),
      );
      // And the store subscription was still created.
      expect(prisma.subscription.create).toHaveBeenCalled();
    });

    it('audits billing.iap.double_subscription_detected with BOTH subscription ids', async () => {
      await service.handleStoreEvent(evt());

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'billing.iap.double_subscription_detected',
          organizationId: ORG_ID,
          metadata: expect.objectContaining({
            webSubscriptionId: 'web-sub-1',
            webProvider: 'xendit',
          }),
        }),
      );
    });

    it('still honours the store purchase when the web sub cannot be REQUEST_CANCELled', async () => {
      // REQUEST_CANCEL is legal only from ACTIVE. A past_due or already-
      // cancelling web row must not fail a purchase that is already paid for.
      lifecycle.executeTransition.mockImplementation(
        async ({ subscriptionId }: { subscriptionId: string }) => {
          if (subscriptionId === 'web-sub-1') throw new Error('Invalid transition');
          return { success: true };
        },
      );

      const result = await service.handleStoreEvent(evt());

      expect(result.status).toBe('processed');
      expect(prisma.subscription.create).toHaveBeenCalled();
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'billing.iap.double_subscription_detected' }),
      );
    });

    it('does not automate a refund of the web subscription remainder', async () => {
      await service.handleStoreEvent(evt());
      // Deliberate: an automated refund path is a larger attack surface than a
      // support queue, and these cases are rare.
      const actions = lifecycle.executeTransition.mock.calls.map((c) => c[0].action);
      expect(actions).not.toContain(SubscriptionAction.CANCEL_IMMEDIATELY);
    });
  });

  // ======================================================================
  // §5.2 — the org grant rule
  // ======================================================================

  describe('multi-member orgs (§5.2)', () => {
    it('HONOURS an INITIAL_PURCHASE for a multi-member org and raises the alert', async () => {
      // Refusing entitlement for a completed store purchase is the one failure
      // mode that gets an app pulled. The money is already taken and cannot be
      // returned by us.
      prisma.organizationMember.count.mockResolvedValue(5);

      const result = await service.handleStoreEvent(evt());

      expect(result.status).toBe('processed');
      expect(prisma.subscription.create).toHaveBeenCalled();
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'billing.iap.multi_member_grant',
          metadata: expect.objectContaining({ memberCount: 5, planCode: 'pro' }),
        }),
      );
    });

    it('does not raise the alert for a single-member org', async () => {
      await service.handleStoreEvent(evt());
      expect(audit.log).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'billing.iap.multi_member_grant' }),
      );
    });
  });

  describe('purchase-intent (§5.2 guards / §6.1)', () => {
    beforeEach(() => {
      prisma.organization.findUnique.mockResolvedValue({
        id: ORG_ID,
        billingOwnerUserId: USER_ID,
      });
    });

    it('returns the App User ID and the four sellable products', async () => {
      const result = await service.createPurchaseIntent(ORG_ID, USER_ID);

      // D11 — the client calls logIn(organizationId).
      expect(result.appUserId).toBe(ORG_ID);
      expect(result.products.map((p) => p.productId).sort()).toEqual([
        'com.libertasian.edu.annual',
        'com.libertasian.edu.monthly',
        'com.libertasian.pro.annual',
        'com.libertasian.pro.monthly',
      ]);
      // team and enterprise are absent by construction, not by filtering.
      expect(result.products.every((p) => p.planCode === 'pro' || p.planCode === 'edu')).toBe(true);
    });

    it('403s a member who is not the billing owner (guard 1)', async () => {
      // An IAP is charged to ONE person's store account and refundable only by
      // them, but it grants the whole tenant.
      await expect(service.createPurchaseIntent(ORG_ID, OTHER_ORG_ID)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('409 multi_member_org for an org with more than one active member (guard 2)', async () => {
      // pro is maxSeats: 1, and so is edu. A multi-member org on either is a
      // state web checkout would not have sold.
      prisma.organizationMember.count.mockResolvedValue(2);

      await expect(service.createPurchaseIntent(ORG_ID, USER_ID)).rejects.toMatchObject({
        response: { code: 'multi_member_org' },
      });
    });

    it('409 already_subscribed_elsewhere when a web subscription is live (§6.1)', async () => {
      prisma.subscription.findFirst.mockResolvedValue({ id: 'web-sub-1', provider: 'xendit' });

      await expect(service.createPurchaseIntent(ORG_ID, USER_ID)).rejects.toMatchObject({
        response: { code: 'already_subscribed_elsewhere' },
      });
    });

    it('checks the owner before anything else', async () => {
      // A non-owner in a multi-member org gets 403, not 409: the more specific
      // refusal, and the one that does not leak the org's billing state.
      prisma.organizationMember.count.mockResolvedValue(5);
      await expect(service.createPurchaseIntent(ORG_ID, OTHER_ORG_ID)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.organizationMember.count).not.toHaveBeenCalled();
    });

    it('rejects an unknown organization', async () => {
      prisma.organization.findUnique.mockResolvedValue(null);
      await expect(service.createPurchaseIntent(ORG_ID, USER_ID)).rejects.toThrow(
        /Organization not found/,
      );
    });
  });

  // ======================================================================
  // RENEWAL — D8's one hard requirement
  // ======================================================================

  describe('RENEWAL', () => {
    beforeEach(() => withStoreSubscription(SubscriptionState.ACTIVE));

    it('writes planCode from STORE_PRODUCT_MAP, not from the existing row (D8)', async () => {
      // A handler that only updated billing_period would leave an edu
      // subscriber who upgraded to pro on edu indefinitely.
      await service.handleStoreEvent(
        evt({
          type: 'purchase.renewed',
          providerEventName: 'RENEWAL',
          productId: 'com.libertasian.pro.annual',
          eventId: 'rc_evt_renew',
        }),
      );

      expect(prisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: SUB_ID },
          data: expect.objectContaining({ planCode: 'pro', billingPeriod: 'annual' }),
        }),
      );
    });

    it('writes the new period BEFORE the transition', async () => {
      // ORDER MATTERS: UNDO_CANCEL (the CANCELLING renewal path) guards on
      // currentPeriodEnd not having passed, and RENEW's SCHEDULE_EVENT side
      // effect reads the same column.
      const order: string[] = [];
      prisma.subscription.update.mockImplementation(async () => {
        order.push('period');
        return {};
      });
      lifecycle.executeTransition.mockImplementation(async () => {
        order.push('transition');
        return { success: true };
      });

      await service.handleStoreEvent(
        evt({ type: 'purchase.renewed', providerEventName: 'RENEWAL', eventId: 'rc_evt_renew2' }),
      );

      expect(order).toEqual(['period', 'transition']);
    });

    it('renews a CANCELLING subscription back to active via UNDO_CANCEL', async () => {
      withStoreSubscription(SubscriptionState.CANCELLING);

      await service.handleStoreEvent(
        evt({ type: 'purchase.renewed', providerEventName: 'RENEWAL', eventId: 'rc_evt_renew3' }),
      );

      expect(lifecycle.executeTransition).toHaveBeenCalledWith(
        expect.objectContaining({ action: SubscriptionAction.UNDO_CANCEL }),
      );
    });

    it('invalidates the entitlement cache after the renewal', async () => {
      await service.handleStoreEvent(
        evt({ type: 'purchase.renewed', providerEventName: 'RENEWAL', eventId: 'rc_evt_renew4' }),
      );
      expect(entitlements.invalidateEntitlementCache).toHaveBeenCalledWith(ORG_ID);
    });
  });

  // ======================================================================
  // EXPIRATION and refunds — §8
  // ======================================================================

  describe('EXPIRATION and refund clawback (§8)', () => {
    beforeEach(() => withStoreSubscription(SubscriptionState.ACTIVE));

    it('cancels immediately, creates the free fallback and drops renewal reminders', async () => {
      await service.handleStoreEvent(
        evt({ type: 'purchase.expired', providerEventName: 'EXPIRATION', eventId: 'rc_exp_1' }),
      );

      expect(lifecycle.executeTransition).toHaveBeenCalledWith(
        expect.objectContaining({ action: SubscriptionAction.CANCEL_IMMEDIATELY }),
      );
      expect(prisma.subscription.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ planCode: 'free' }) }),
      );
      expect(prisma.subscriptionLifecycleEvent.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ eventType: 'renewal_reminder', status: 'pending' }),
          data: { status: 'cancelled' },
        }),
      );
      expect(entitlements.invalidateEntitlementCache).toHaveBeenCalledWith(ORG_ID);
    });

    it('marks the store_purchases row refunded on a CUSTOMER_SUPPORT cancellation', async () => {
      await service.handleStoreEvent(
        evt({
          type: 'purchase.cancelled',
          providerEventName: 'CANCELLATION',
          cancelReason: 'CUSTOMER_SUPPORT',
          eventId: 'rc_refund_1',
        }),
      );

      expect(prisma.storePurchase.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { store: 'app_store', rcOriginalTransactionId: 'orig_1' },
          data: expect.objectContaining({ status: 'refunded', refundedAt: expect.any(Date) }),
        }),
      );
    });

    it('reverses the clawback on REFUND_REVERSED', async () => {
      withStoreSubscription(SubscriptionState.CANCELLED);

      await service.handleStoreEvent(
        evt({
          type: 'purchase.refund_reversed',
          providerEventName: 'REFUND_REVERSED',
          eventId: 'rc_rev_1',
        }),
      );

      expect(lifecycle.executeTransition).toHaveBeenCalledWith(
        expect.objectContaining({ action: SubscriptionAction.REACTIVATE }),
      );
      expect(prisma.storePurchase.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'active', refundedAt: null } }),
      );
    });

    it('skips the free fallback when the org still holds an accessible subscription', async () => {
      // The fallback row is dated now, so it would win the createdAt-desc
      // ordering and demote a still-live subscription to free.
      const subs = service as unknown as {
        subscriptionsService: { hasAccessibleSubscription: jest.Mock };
      };
      subs.subscriptionsService.hasAccessibleSubscription.mockResolvedValue(true);

      await service.handleStoreEvent(
        evt({ type: 'purchase.expired', providerEventName: 'EXPIRATION', eventId: 'rc_exp_2' }),
      );

      expect(prisma.subscription.create).not.toHaveBeenCalled();
    });
  });

  // ======================================================================
  // §4.2 no-ops, at the service level
  // ======================================================================

  describe('no-ops reach the database as no-ops', () => {
    it('finding (a): records auto_renew=false without changing state', async () => {
      withStoreSubscription(SubscriptionState.TRIALING);
      prisma.storePurchase.findFirst.mockResolvedValue({ id: 'sp-1', metadataJson: {} });

      const result = await service.handleStoreEvent(
        evt({
          type: 'purchase.cancelled',
          providerEventName: 'CANCELLATION',
          cancelReason: 'UNSUBSCRIBE',
          eventId: 'rc_cancel_trial',
        }),
      );

      expect(result).toEqual({
        received: true,
        status: 'noop',
        detail: 'cancellation_during_trial',
      });
      expect(lifecycle.executeTransition).not.toHaveBeenCalled();
      expect(prisma.storePurchase.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            metadataJson: expect.objectContaining({ auto_renew: false }),
          }),
        }),
      );
    });

    it('finding (b): CANCELLATION/BILLING_ERROR touches nothing', async () => {
      withStoreSubscription(SubscriptionState.PAST_DUE);

      const result = await service.handleStoreEvent(
        evt({
          type: 'purchase.cancelled',
          providerEventName: 'CANCELLATION',
          cancelReason: 'BILLING_ERROR',
          eventId: 'rc_be_1',
        }),
      );

      expect(result.detail).toBe('billing_error_owned_by_expiration');
      expect(lifecycle.executeTransition).not.toHaveBeenCalled();
      expect(prisma.subscription.update).not.toHaveBeenCalled();
    });

    it('finding (c): a repeat BILLING_ISSUE touches nothing', async () => {
      withStoreSubscription(SubscriptionState.PAST_DUE);

      const result = await service.handleStoreEvent(
        evt({
          type: 'purchase.billing_issue',
          providerEventName: 'BILLING_ISSUE',
          eventId: 'rc_bi_2',
        }),
      );

      expect(result.detail).toBe('billing_issue_already_recorded');
      expect(lifecycle.executeTransition).not.toHaveBeenCalled();
    });

    it('finding (d): PRODUCT_CHANGE records the pending product and transitions nothing', async () => {
      withStoreSubscription(SubscriptionState.ACTIVE);
      prisma.storePurchase.findFirst.mockResolvedValue({ id: 'sp-1', metadataJson: {} });

      await service.handleStoreEvent(
        evt({
          type: 'purchase.product_changed',
          providerEventName: 'PRODUCT_CHANGE',
          productId: 'com.libertasian.pro.annual',
          eventId: 'rc_pc_1',
        }),
      );

      expect(lifecycle.executeTransition).not.toHaveBeenCalled();
      expect(prisma.storePurchase.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            metadataJson: expect.objectContaining({
              pending_product_id: 'com.libertasian.pro.annual',
            }),
          }),
        }),
      );
    });

    it('finding (e): SUBSCRIPTION_PAUSED never suspends a paid-through subscriber', async () => {
      withStoreSubscription(SubscriptionState.ACTIVE);

      const result = await service.handleStoreEvent(
        evt({
          type: 'purchase.paused',
          providerEventName: 'SUBSCRIPTION_PAUSED',
          eventId: 'rc_pause_1',
        }),
      );

      expect(result.detail).toBe('pause_deferred_to_expiration');
      expect(lifecycle.executeTransition).not.toHaveBeenCalled();
      expect(prisma.subscription.update).not.toHaveBeenCalled();
    });

    it('TEMPORARY_ENTITLEMENT_GRANT never creates a subscription', async () => {
      // It is RevenueCat covering its own outage, not evidence of a purchase.
      const result = await service.handleStoreEvent(
        evt({
          type: 'purchase.temporary_grant',
          providerEventName: 'TEMPORARY_ENTITLEMENT_GRANT',
          eventId: 'rc_temp_1',
        }),
      );

      expect(result.detail).toBe('temporary_grant_never_creates');
      expect(prisma.subscription.create).not.toHaveBeenCalled();
    });

    it('acknowledges an informational event with no state change', async () => {
      withStoreSubscription(SubscriptionState.ACTIVE);

      const result = await service.handleStoreEvent(
        evt({ type: 'informational', providerEventName: 'TEST', eventId: 'rc_test_1' }),
      );

      expect(result).toEqual({ received: true, status: 'noop', detail: 'informational' });
      expect(lifecycle.executeTransition).not.toHaveBeenCalled();
    });
  });

  // ======================================================================
  // §5.3 — TRANSFER
  // ======================================================================

  describe('TRANSFER (§5.3)', () => {
    it('clears the losing row providerSubscriptionId IN THE SAME TRANSACTION as the gaining write', async () => {
      // providerSubscriptionId is globally @unique. This is called out in the
      // design as the single most likely implementation bug in the whole thing:
      // without the clearing, the gaining write violates the constraint.
      prisma.subscription.findFirst.mockResolvedValue(null);

      await service.handleStoreEvent(
        evt({
          type: 'purchase.transferred',
          providerEventName: 'TRANSFER',
          eventId: 'rc_xfer_1',
          transferredFrom: [OTHER_ORG_ID],
          transferredTo: [ORG_ID],
        }),
      );

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const tx = txClient as { subscription: { updateMany: jest.Mock; create: jest.Mock } };
      expect(tx.subscription.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ providerSubscriptionId: 'orig_1' }),
          data: { providerSubscriptionId: null },
        }),
      );
      expect(tx.subscription.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organizationId: ORG_ID,
            providerSubscriptionId: 'orig_1',
          }),
        }),
      );
    });

    it('revokes on the losing org and audits BOTH orgs', async () => {
      prisma.organization.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({
        id: where.id,
      }));
      prisma.subscription.findFirst.mockImplementation(
        async (args: { where: { organizationId?: string; provider?: unknown } }) => {
          if (args.where.organizationId === OTHER_ORG_ID) {
            return {
              id: 'losing-sub',
              organizationId: OTHER_ORG_ID,
              planCode: 'pro',
              status: SubscriptionState.ACTIVE,
              provider: 'app_store',
              providerSubscriptionId: 'orig_1',
              currentPeriodEnd: new Date('2026-09-01T00:00:00Z'),
              cancelAtPeriodEnd: false,
            };
          }
          return null;
        },
      );

      await service.handleStoreEvent(
        evt({
          type: 'purchase.transferred',
          providerEventName: 'TRANSFER',
          eventId: 'rc_xfer_2',
          transferredFrom: [OTHER_ORG_ID],
          transferredTo: [ORG_ID],
        }),
      );

      expect(lifecycle.executeTransition).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriptionId: 'losing-sub',
          action: SubscriptionAction.CANCEL_IMMEDIATELY,
        }),
      );
      const actions = audit.log.mock.calls.map((c) => c[0].action);
      expect(actions).toContain('billing.iap.transfer_out');
      expect(actions).toContain('billing.iap.transfer_in');
      expect(entitlements.invalidateEntitlementCache).toHaveBeenCalledWith(OTHER_ORG_ID);
      expect(entitlements.invalidateEntitlementCache).toHaveBeenCalledWith(ORG_ID);
    });

    it('marks the store_purchases row transferred with the gaining org', async () => {
      await service.handleStoreEvent(
        evt({
          type: 'purchase.transferred',
          providerEventName: 'TRANSFER',
          eventId: 'rc_xfer_3',
          transferredTo: [ORG_ID],
        }),
      );

      expect(prisma.storePurchase.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'transferred',
            transferredToOrgId: ORG_ID,
            transferredAt: expect.any(Date),
          }),
        }),
      );
    });

    it('records the event when the gaining org is unresolvable rather than throwing', async () => {
      prisma.organization.findUnique.mockResolvedValue(null);

      const result = await service.handleStoreEvent(
        evt({
          type: 'purchase.transferred',
          providerEventName: 'TRANSFER',
          eventId: 'rc_xfer_4',
          appUserId: OTHER_ORG_ID,
          transferredTo: [OTHER_ORG_ID],
        }),
      );

      expect(result.status).toBe('unresolved_org');
    });
  });

  // ======================================================================
  // §9 — the pull path
  // ======================================================================

  describe('reconciliation pull (§9 / D12)', () => {
    const future = new Date(Date.now() + 30 * 86400000);

    it('grants when the store says entitled and we do not', async () => {
      storeProvider.fetchSubscriberSnapshot.mockResolvedValue({
        appUserId: ORG_ID,
        entitlements: [
          {
            id: 'pro',
            productId: 'com.libertasian.pro.monthly',
            store: 'app_store',
            expiresAt: future,
            willRenew: true,
            periodType: 'NORMAL',
            environment: 'production',
          },
        ],
      });

      const result = await service.syncFromStore(ORG_ID);

      expect(result.status).toBe('processed');
      expect(prisma.subscription.create).toHaveBeenCalled();
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'billing.iap.reconciliation_drift',
          metadata: expect.objectContaining({ direction: 'granting' }),
        }),
      );
    });

    it('revokes when the store says not entitled and we still grant', async () => {
      withStoreSubscription(SubscriptionState.ACTIVE);
      storeProvider.fetchSubscriberSnapshot.mockResolvedValue({
        appUserId: ORG_ID,
        entitlements: [],
      });

      const result = await service.syncFromStore(ORG_ID);

      expect(result.status).toBe('processed');
      expect(lifecycle.executeTransition).toHaveBeenCalledWith(
        expect.objectContaining({ action: SubscriptionAction.CANCEL_IMMEDIATELY }),
      );
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ direction: 'revoking' }),
        }),
      );
    });

    it('NEVER grants production entitlement from a sandbox snapshot (D10 on the pull path)', async () => {
      // Otherwise a sandbox tester's restore grants production entitlement
      // through the back door — the webhook guard closed the front one.
      nodeEnv = 'production';
      storeProvider.fetchSubscriberSnapshot.mockResolvedValue({
        appUserId: ORG_ID,
        entitlements: [
          {
            id: 'pro',
            productId: 'com.libertasian.pro.monthly',
            store: 'app_store',
            expiresAt: future,
            willRenew: true,
            periodType: 'NORMAL',
            environment: 'sandbox',
          },
        ],
      });

      const result = await service.syncFromStore(ORG_ID);

      expect(result).toEqual({ received: true, status: 'noop', detail: 'in_sync' });
      expect(prisma.subscription.create).not.toHaveBeenCalled();
    });

    it('ignores an entitlement whose product is not in STORE_PRODUCT_MAP', async () => {
      storeProvider.fetchSubscriberSnapshot.mockResolvedValue({
        appUserId: ORG_ID,
        entitlements: [
          {
            id: 'enterprise',
            productId: 'com.libertasian.enterprise.monthly',
            store: 'app_store',
            expiresAt: future,
            willRenew: true,
            periodType: 'NORMAL',
            environment: 'production',
          },
        ],
      });

      const result = await service.syncFromStore(ORG_ID);

      expect(result.detail).toBe('in_sync');
      expect(prisma.subscription.create).not.toHaveBeenCalled();
    });

    it('reconciles a moved period end without changing state', async () => {
      withStoreSubscription(SubscriptionState.ACTIVE);
      const moved = new Date('2026-10-01T00:00:00Z');
      storeProvider.fetchSubscriberSnapshot.mockResolvedValue({
        appUserId: ORG_ID,
        entitlements: [
          {
            id: 'pro',
            productId: 'com.libertasian.pro.monthly',
            store: 'app_store',
            expiresAt: moved,
            willRenew: true,
            periodType: 'NORMAL',
            environment: 'production',
          },
        ],
      });

      const result = await service.syncFromStore(ORG_ID);

      expect(result.detail).toBe('period_reconciled');
      expect(prisma.subscription.update).toHaveBeenCalledWith({
        where: { id: SUB_ID },
        data: { currentPeriodEnd: moved },
      });
      expect(lifecycle.executeTransition).not.toHaveBeenCalled();
    });

    it('reports in_sync when nothing drifted', async () => {
      withStoreSubscription(SubscriptionState.ACTIVE);
      storeProvider.fetchSubscriberSnapshot.mockResolvedValue({
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

      const result = await service.syncFromStore(ORG_ID);
      expect(result).toEqual({ received: true, status: 'noop', detail: 'in_sync' });
    });

    it('does not let one org failure end the nightly sweep', async () => {
      prisma.subscription.findMany.mockResolvedValue([
        { organizationId: ORG_ID },
        { organizationId: OTHER_ORG_ID },
      ]);
      storeProvider.fetchSubscriberSnapshot
        .mockRejectedValueOnce(new Error('conduit 503'))
        .mockResolvedValueOnce({ appUserId: OTHER_ORG_ID, entitlements: [] });

      const result = await service.reconcileAllStoreSubscriptions();

      expect(result.checked).toBe(2);
      expect(storeProvider.fetchSubscriberSnapshot).toHaveBeenCalledTimes(2);
    });
  });
});
