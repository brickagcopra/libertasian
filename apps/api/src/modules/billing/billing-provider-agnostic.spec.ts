import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CouponService } from '../coupons/coupon.service';
import { PricingEngineService } from '../pricing/pricing-engine.service';
import { PromotionService } from '../promotions/promotion.service';
import { EntitlementService } from '../subscriptions/entitlement.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { SubscriptionLifecycleService } from '../subscriptions/subscription-lifecycle.service';
import { UsageQuotaService } from '../subscriptions/usage-quota.service';
import { NotificationsService } from '../notifications/notifications.service';
import { BillingService } from './billing.service';
import {
  PAYMENT_PROVIDER,
  PaymentProviderError,
  type CreateCustomerParams,
  type CreateInvoiceParams,
  type CreateSubscriptionSessionParams,
  type NormalizedWebhookEvent,
  type PaymentProvider,
  type ProviderCustomer,
  type ProviderInvoice,
  type ProviderSubscription,
  type ProviderSubscriptionSession,
  type WebhookVerification,
} from './payment-provider.interface';

/**
 * THE PROOF THAT THE ABSTRACTION IS REAL.
 *
 * This file imports NOTHING from `xendit.service.ts` — no service, no types, no
 * event-name constants. It drives BillingService against a hand-written
 * `FakeGateway` that implements `PaymentProvider` and speaks a deliberately
 * un-Xendit-like dialect (different id prefixes, a different checkout host).
 *
 * If a future change leaks a gateway-specific field, endpoint or event string
 * back into BillingService, this spec stops compiling or stops passing. Adding
 * PayMongo / Maya / Dragonpay should require no edit here at all.
 */
class FakeGateway implements PaymentProvider {
  readonly slug = 'fakepay';

  customers: CreateCustomerParams[] = [];
  sessions: CreateSubscriptionSessionParams[] = [];
  cancelled: string[] = [];
  /** Set to a reference id to make the next createCustomer 409 as a duplicate. */
  duplicateFor: string | null = null;
  existingCustomer: ProviderCustomer | null = null;

  async createCustomer(params: CreateCustomerParams): Promise<ProviderCustomer> {
    if (this.duplicateFor === params.referenceId) {
      throw new PaymentProviderError(this.slug, 409, 'DUPLICATE_ERROR');
    }
    this.customers.push(params);
    return { id: `fp_cus_${this.customers.length}`, referenceId: params.referenceId };
  }

  async getCustomerByReferenceId(): Promise<ProviderCustomer | null> {
    return this.existingCustomer;
  }

  async createSubscriptionSession(
    params: CreateSubscriptionSessionParams,
  ): Promise<ProviderSubscriptionSession> {
    this.sessions.push(params);
    return {
      sessionId: 'fp_sess_1',
      checkoutUrl: 'https://pay.fakepay.test/checkout/fp_sess_1',
      referenceId: params.referenceId,
    };
  }

  async retrieveSubscription(id: string): Promise<ProviderSubscription> {
    return { id, status: 'ACTIVE' };
  }

  async cancelSubscription(id: string): Promise<ProviderSubscription> {
    this.cancelled.push(id);
    return { id, status: 'INACTIVE' };
  }

  async createInvoice(params: CreateInvoiceParams): Promise<ProviderInvoice> {
    return {
      id: 'fp_inv_1',
      externalId: params.externalId,
      invoiceUrl: 'https://pay.fakepay.test/i/fp_inv_1',
      status: 'PENDING',
      amount: params.amount,
      currency: params.currency,
      description: params.description,
    };
  }

  async retrieveInvoice(id: string): Promise<ProviderInvoice> {
    return {
      id,
      externalId: 'ext',
      invoiceUrl: `https://pay.fakepay.test/i/${id}`,
      status: 'PAID',
      amount: 999,
      currency: 'PHP',
      description: 'x',
    };
  }

  verifyWebhookSignature(): WebhookVerification {
    return 'valid';
  }

  parseWebhookEvent(rawBody: string): NormalizedWebhookEvent {
    const body = JSON.parse(rawBody) as { id: string };
    return {
      provider: this.slug,
      providerEventName: 'charge_ok',
      idempotencyScope: 'invoice',
      auditSuffix: 'charge_ok',
      entityId: body.id,
      auditMetadata: {},
      type: 'payment.succeeded',
      data: { id: body.id },
    };
  }
}

describe('BillingService against a non-Xendit PaymentProvider', () => {
  let service: BillingService;
  let gateway: FakeGateway;
  let prisma: {
    subscription: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      delete: jest.Mock;
    };
    user: { findUnique: jest.Mock };
    paymentMethod: { upsert: jest.Mock; findFirst: jest.Mock };
    subscriptionLifecycleEvent: { updateMany: jest.Mock; create: jest.Mock };
  };
  let subscriptionsService: {
    getActiveSubscription: jest.Mock;
    getDefaultEntitlements: jest.Mock;
    hasAccessibleSubscription: jest.Mock;
  };
  let lifecycleService: { executeTransition: jest.Mock };

  beforeEach(async () => {
    gateway = new FakeGateway();

    prisma = {
      subscription: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'sub-local-1' }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        delete: jest.fn().mockResolvedValue({}),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ email: 'a@b.test', fullName: 'A B' }),
      },
      paymentMethod: {
        upsert: jest.fn().mockResolvedValue({}),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      subscriptionLifecycleEvent: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({}),
      },
    };

    subscriptionsService = {
      getActiveSubscription: jest.fn().mockResolvedValue(null),
      getDefaultEntitlements: jest.fn().mockReturnValue({}),
      hasAccessibleSubscription: jest.fn().mockResolvedValue(false),
    };
    lifecycleService = { executeTransition: jest.fn().mockResolvedValue({ success: true }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: PAYMENT_PROVIDER, useValue: gateway },
        { provide: PrismaService, useValue: prisma },
        { provide: SubscriptionsService, useValue: subscriptionsService },
        { provide: AuditService, useValue: { log: jest.fn().mockResolvedValue(undefined) } },
        {
          provide: PricingEngineService,
          useValue: {
            calculatePriceBreakdown: jest.fn().mockResolvedValue({
              planName: 'Pro',
              planId: 'plan-1',
              finalAmount: 99900,
              currency: 'PHP',
              couponCode: null,
              promotionId: null,
            }),
          },
        },
        { provide: CouponService, useValue: {} },
        { provide: PromotionService, useValue: {} },
        { provide: SubscriptionLifecycleService, useValue: lifecycleService },
        { provide: NotificationsService, useValue: {} },
        {
          provide: EntitlementService,
          useValue: { invalidateEntitlementCache: jest.fn().mockResolvedValue(undefined) },
        },
        { provide: UsageQuotaService, useValue: {} },
      ],
    }).compile();

    service = module.get(BillingService);
  });

  const dto = {
    planCode: 'pro',
    billingPeriod: 'monthly' as const,
    successUrl: 'https://app.test/ok',
    cancelUrl: 'https://app.test/no',
  };

  it('creates a checkout using only the port, returning the gateway’s own URL', async () => {
    const result = await service.createCheckout('org-1', dto as never, 'user-1');

    expect(result.checkoutUrl).toBe('https://pay.fakepay.test/checkout/fp_sess_1');
    expect(result.checkoutSessionId).toBe('fp_sess_1');
    expect(gateway.sessions).toHaveLength(1);
    expect(gateway.sessions[0]).toEqual(
      expect.objectContaining({
        customerId: 'fp_cus_1',
        // Whole currency units, not centavos — the port's contract.
        amount: 999,
        interval: 'MONTH',
        intervalCount: 1,
      }),
    );
  });

  it('stamps the provider discriminator from the adapter, not a hardcoded string', async () => {
    await service.createCheckout('org-1', dto as never, 'user-1');

    expect(prisma.subscription.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ provider: 'fakepay', providerCustomerId: 'fp_cus_1' }),
      }),
    );
  });

  it('recovers from a duplicate-customer 409 via the neutral PaymentProviderError', async () => {
    gateway.duplicateFor = 'org-1';
    gateway.existingCustomer = null;
    // First lookup misses, create 409s, the retry lookup wins the race.
    jest
      .spyOn(gateway, 'getCustomerByReferenceId')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'fp_cus_raced', referenceId: 'org-1' });

    const result = await service.createCheckout('org-1', dto as never, 'user-1');

    expect(result.checkoutSessionId).toBe('fp_sess_1');
    expect(gateway.sessions[0]?.customerId).toBe('fp_cus_raced');
  });

  it('cancels through the port when the row carries a gateway plan id', async () => {
    subscriptionsService.getActiveSubscription.mockResolvedValue({
      id: 'sub-1',
      planCode: 'pro',
      status: 'active',
      cancelAtPeriodEnd: false,
      currentPeriodEnd: new Date('2026-09-01T00:00:00Z'),
      providerSubscriptionId: 'fp_plan_1',
    });

    await service.cancelSubscription('org-1', 'user-1', true);

    expect(gateway.cancelled).toEqual(['fp_plan_1']);
  });

  it('routes a normalized subscription.activated payload with no gateway-specific fields', async () => {
    prisma.subscription.findFirst.mockResolvedValue(null);
    prisma.subscription.findUnique.mockResolvedValue({
      id: '6d5a4e3c-2b1f-4a8e-9c7d-5e4f3a2b1c0d',
      organizationId: 'org-1',
      planCode: 'pro',
      billingPeriod: 'monthly',
      status: 'provisioning',
      cancelAtPeriodEnd: false,
      provider: 'fakepay',
      providerSubscriptionId: null,
    });

    await service.handleSubscriptionActivated({
      id: 'fp_plan_1',
      planId: 'fp_plan_1',
      referenceId: '6d5a4e3c-2b1f-4a8e-9c7d-5e4f3a2b1c0d',
      paymentMethodId: 'fp_pm_1',
      paymentMethodType: 'EWALLET',
    });

    expect(prisma.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ providerSubscriptionId: 'fp_plan_1' }),
      }),
    );
    // The saved instrument is persisted under the ACTIVE provider's slug.
    expect(prisma.paymentMethod.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { providerPaymentMethodId: 'fp_pm_1' },
        create: expect.objectContaining({ provider: 'fakepay', type: 'gcash' }),
      }),
    );
    expect(lifecycleService.executeTransition).toHaveBeenCalled();
  });
});
