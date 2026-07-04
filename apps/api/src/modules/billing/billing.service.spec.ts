import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PricingEngineService } from '../pricing/pricing-engine.service';
import { CouponService } from '../coupons/coupon.service';
import { PromotionService } from '../promotions/promotion.service';
import { EntitlementService } from '../subscriptions/entitlement.service';
import { UsageQuotaService } from '../subscriptions/usage-quota.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SubscriptionLifecycleService } from '../subscriptions/subscription-lifecycle.service';
import { SubscriptionAction } from '../subscriptions/subscription-state-machine';
import { BillingService } from './billing.service';
import { XenditApiError, XenditService } from './xendit.service';

describe('BillingService', () => {
  let service: BillingService;
  let prisma: jest.Mocked<PrismaService>;
  let xenditService: jest.Mocked<XenditService>;
  let subscriptionsService: jest.Mocked<SubscriptionsService>;
  let auditService: jest.Mocked<AuditService>;
  let pricingEngine: jest.Mocked<PricingEngineService>;
  let couponService: jest.Mocked<CouponService>;
  let promotionService: jest.Mocked<PromotionService>;

  const mockSubscription = {
    id: 'sub-1',
    organizationId: 'org-1',
    planCode: 'pro',
    status: 'active',
    billingPeriod: 'monthly',
    currentPeriodStart: new Date(),
    currentPeriodEnd: new Date(),
    seats: 1,
    entitlementsJson: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    cancelAtPeriodEnd: false,
    canceledAt: null,
  };

  const mockPayment = {
    id: 'pay-1',
    organizationId: 'org-1',
    xenditInvoiceId: 'inv_test_123',
    amount: 99900,
    currency: 'PHP',
    status: 'pending',
    paymentType: 'subscription',
    description: 'LIBERTASIAN Pro Plan — Monthly',
    metadata: { planCode: 'pro', billingPeriod: 'monthly', xenditInvoiceId: 'inv_test_123' },
    createdAt: new Date(),
    updatedAt: new Date(),
    paidAt: null,
    failedAt: null,
    failureReason: null,
    subscriptionId: null,
  };

  /** Default PriceBreakdown returned by the mock pricingEngine */
  const mockBreakdown = {
    basePriceAmount: 99900,
    couponId: null,
    couponCode: null,
    couponDiscountAmount: 0,
    promotionId: null,
    promotionDiscountAmount: 0,
    totalDiscountAmount: 0,
    finalAmount: 99900,
    currency: 'PHP',
    planCode: 'pro',
    billingPeriod: 'monthly',
    planName: 'Pro',
    planId: null,
    discountsStacked: false,
    lineItems: [
      {
        type: 'base_price',
        label: 'Pro Plan — Monthly',
        amount: 99900,
        referenceId: null,
        referenceCode: 'pro',
        metadata: { source: 'hardcoded' },
      },
    ],
    calculatedAt: new Date().toISOString(),
  };

  let lifecycleService: jest.Mocked<SubscriptionLifecycleService>;
  let entitlementService: jest.Mocked<EntitlementService>;
  let usageQuotaService: jest.Mocked<UsageQuotaService>;
  let notificationsService: jest.Mocked<NotificationsService>;

  const mockTransactionClient = {
    payment: { update: jest.fn(), create: jest.fn().mockResolvedValue({ id: 'pay-cycle-1' }) },
    subscription: { updateMany: jest.fn(), create: jest.fn().mockResolvedValue({ id: 'sub-new' }), update: jest.fn() },
    invoice: { create: jest.fn() },
    checkoutPriceSnapshot: { findUnique: jest.fn().mockResolvedValue(null) },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        {
          provide: PrismaService,
          useValue: {
            payment: {
              create: jest.fn(),
              findUnique: jest.fn(),
              update: jest.fn(),
            },
            paymentMethod: {
              findMany: jest.fn(),
              findFirst: jest.fn(),
              update: jest.fn(),
              updateMany: jest.fn(),
              upsert: jest.fn(),
            },
            invoice: {
              findMany: jest.fn(),
              findFirst: jest.fn(),
            },
            subscription: {
              findFirst: jest.fn(),
              findUnique: jest.fn(),
              update: jest.fn(),
              updateMany: jest.fn(),
              create: jest.fn().mockResolvedValue({ id: 'sub-prov', organizationId: 'org-1' }),
              delete: jest.fn().mockResolvedValue({ id: 'sub-prov' }),
            },
            user: {
              findUnique: jest.fn().mockResolvedValue({ email: 'u@example.com', fullName: 'U' }),
            },
            organization: {
              findUnique: jest.fn(),
            },
            checkoutPriceSnapshot: {
              create: jest.fn(),
              findUnique: jest.fn(),
            },
            subscriptionLifecycleEvent: {
              updateMany: jest.fn().mockResolvedValue({ count: 0 }),
              create: jest.fn().mockResolvedValue({ id: 'evt-reminder-1' }),
            },
            $transaction: jest.fn(),
          },
        },
        {
          provide: XenditService,
          useValue: {
            createInvoice: jest.fn(),
            createCustomer: jest.fn().mockResolvedValue({ id: 'cust-1', reference_id: 'org-1' }),
            getCustomerByReferenceId: jest.fn().mockResolvedValue(null),
            createSubscriptionSession: jest.fn().mockResolvedValue({
              payment_session_id: 'ps-1',
              payment_link_url: 'https://checkout.xendit.co/sessions/ps-1',
              reference_id: 'sub-prov',
            }),
            retrieveSubscription: jest.fn(),
            cancelSubscription: jest.fn().mockResolvedValue({ id: 'repl_1', status: 'INACTIVE' }),
          },
        },
        {
          provide: SubscriptionsService,
          useValue: {
            getActiveSubscription: jest.fn(),
            getDefaultEntitlements: jest.fn(),
          },
        },
        {
          provide: AuditService,
          useValue: {
            log: jest.fn(),
          },
        },
        {
          provide: PricingEngineService,
          useValue: {
            calculatePriceBreakdown: jest.fn().mockResolvedValue({ ...mockBreakdown }),
          },
        },
        {
          provide: CouponService,
          useValue: {
            reserveCoupon: jest.fn(),
            finalizeCoupon: jest.fn(),
            rollbackCoupon: jest.fn(),
          },
        },
        {
          provide: PromotionService,
          useValue: {
            applyPromotion: jest.fn().mockResolvedValue({ success: true, redemptionId: 'pr-1' }),
          },
        },
        {
          provide: SubscriptionLifecycleService,
          useValue: {
            executeTransition: jest.fn().mockResolvedValue({ success: true }),
          },
        },
        {
          provide: NotificationsService,
          useValue: {
            sendPaymentReceipt: jest.fn().mockResolvedValue(undefined),
            sendPaymentFailed: jest.fn().mockResolvedValue(undefined),
            sendSubscriptionConfirmation: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: EntitlementService,
          useValue: {
            invalidateEntitlementCache: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: UsageQuotaService,
          useValue: {
            resetQuotasForBillingCycle: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get<BillingService>(BillingService);
    prisma = module.get(PrismaService);
    xenditService = module.get(XenditService);
    subscriptionsService = module.get(SubscriptionsService);
    auditService = module.get(AuditService);
    pricingEngine = module.get(PricingEngineService);
    couponService = module.get(CouponService);
    promotionService = module.get(PromotionService);
    lifecycleService = module.get(SubscriptionLifecycleService);
    entitlementService = module.get(EntitlementService);
    usageQuotaService = module.get(UsageQuotaService);
    notificationsService = module.get(NotificationsService);
  });

  // ---- getSubscription ----

  describe('getSubscription', () => {
    it('should return active subscription', async () => {
      subscriptionsService.getActiveSubscription.mockResolvedValue(mockSubscription as never);

      const result = await service.getSubscription('org-1');
      expect(result).toEqual(mockSubscription);
    });

    it('should throw NotFoundException when no active subscription', async () => {
      subscriptionsService.getActiveSubscription.mockResolvedValue(null as never);

      await expect(service.getSubscription('org-1')).rejects.toThrow(NotFoundException);
    });
  });

  // ---- createCheckout ----

  describe('createCheckout', () => {
    const dto = {
      planCode: 'pro',
      billingPeriod: 'monthly' as const,
      successUrl: 'https://app.com/success',
      cancelUrl: 'https://app.com/cancel',
    };

    it('should create a recurring subscription session for a new subscription', async () => {
      subscriptionsService.getActiveSubscription.mockResolvedValue(null as never);
      pricingEngine.calculatePriceBreakdown.mockResolvedValue({ ...mockBreakdown } as never);
      subscriptionsService.getDefaultEntitlements.mockReturnValue({} as never);

      const result = await service.createCheckout('org-1', dto, 'user-1');

      expect(result).toHaveProperty('checkoutUrl', 'https://checkout.xendit.co/sessions/ps-1');
      expect(result).toHaveProperty('checkoutSessionId', 'ps-1');
      expect(result).toHaveProperty('subscriptionId');
      // provisioning subscription created up-front with the resolved customer
      expect(prisma.subscription.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            planCode: 'pro',
            status: 'provisioning',
            xenditCustomerId: 'cust-1',
          }),
        }),
      );
      // recurring session created (amount in WHOLE PHP), not a one-time invoice
      expect(xenditService.createSubscriptionSession).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 999,
          currency: 'PHP',
          interval: 'MONTH',
          intervalCount: 1,
        }),
      );
      expect(xenditService.createInvoice).not.toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'billing.checkout_created',
          entityType: 'subscription',
        }),
      );
    });

    it('should create an annual subscription session with YEAR interval', async () => {
      const annualBreakdown = {
        ...mockBreakdown,
        basePriceAmount: 999000,
        finalAmount: 999000,
        billingPeriod: 'annual',
      };
      pricingEngine.calculatePriceBreakdown.mockResolvedValue(annualBreakdown as never);
      subscriptionsService.getActiveSubscription.mockResolvedValue(null as never);
      subscriptionsService.getDefaultEntitlements.mockReturnValue({} as never);

      await service.createCheckout('org-1', { ...dto, billingPeriod: 'annual' }, 'user-1');

      expect(xenditService.createSubscriptionSession).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 9990, interval: 'YEAR' }),
      );
    });

    it('should reuse an existing org Xendit customer instead of creating a new one', async () => {
      subscriptionsService.getActiveSubscription.mockResolvedValue(null as never);
      subscriptionsService.getDefaultEntitlements.mockReturnValue({} as never);
      (prisma.subscription.findFirst as jest.Mock).mockResolvedValue({ xenditCustomerId: 'cust-existing' });

      await service.createCheckout('org-1', dto, 'user-1');

      expect(xenditService.createCustomer).not.toHaveBeenCalled();
      expect(xenditService.createSubscriptionSession).toHaveBeenCalledWith(
        expect.objectContaining({ customerId: 'cust-existing' }),
      );
    });

    it('should roll back the provisioning subscription if the Xendit session fails', async () => {
      subscriptionsService.getActiveSubscription.mockResolvedValue(null as never);
      subscriptionsService.getDefaultEntitlements.mockReturnValue({} as never);
      xenditService.createSubscriptionSession.mockRejectedValueOnce(new Error('xendit down'));

      await expect(service.createCheckout('org-1', dto, 'user-1')).rejects.toThrow('xendit down');
      expect(prisma.subscription.delete).toHaveBeenCalledWith({ where: { id: 'sub-prov' } });
    });

    it('should reuse an existing remote Xendit customer when the local pointer is lost', async () => {
      // Local DB miss (e.g. rollback deleted the row holding xenditCustomerId)
      // but the customer still exists at Xendit under reference_id = org id.
      subscriptionsService.getActiveSubscription.mockResolvedValue(null as never);
      subscriptionsService.getDefaultEntitlements.mockReturnValue({} as never);
      (xenditService.getCustomerByReferenceId as jest.Mock).mockResolvedValue({
        id: 'cust-remote',
        reference_id: 'org-1',
      });

      await service.createCheckout('org-1', dto, 'user-1');

      expect(xenditService.getCustomerByReferenceId).toHaveBeenCalledWith('org-1');
      expect(xenditService.createCustomer).not.toHaveBeenCalled();
      expect(xenditService.createSubscriptionSession).toHaveBeenCalledWith(
        expect.objectContaining({ customerId: 'cust-remote' }),
      );
    });

    it('should recover from a DUPLICATE_ERROR 409 on customer create via the reference_id lookup', async () => {
      // Race: the GET missed but a concurrent checkout created the customer
      // before our POST landed.
      subscriptionsService.getActiveSubscription.mockResolvedValue(null as never);
      subscriptionsService.getDefaultEntitlements.mockReturnValue({} as never);
      (xenditService.getCustomerByReferenceId as jest.Mock)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'cust-dup', reference_id: 'org-1' });
      (xenditService.createCustomer as jest.Mock).mockRejectedValue(
        new XenditApiError(409, 'DUPLICATE_ERROR'),
      );

      await service.createCheckout('org-1', dto, 'user-1');

      expect(xenditService.getCustomerByReferenceId).toHaveBeenCalledTimes(2);
      expect(xenditService.createSubscriptionSession).toHaveBeenCalledWith(
        expect.objectContaining({ customerId: 'cust-dup' }),
      );
    });

    it('should still create a fresh customer when neither DB nor Xendit has one', async () => {
      subscriptionsService.getActiveSubscription.mockResolvedValue(null as never);
      subscriptionsService.getDefaultEntitlements.mockReturnValue({} as never);

      await service.createCheckout('org-1', dto, 'user-1');

      expect(xenditService.getCustomerByReferenceId).toHaveBeenCalledTimes(1);
      expect(xenditService.createCustomer).toHaveBeenCalledWith(
        expect.objectContaining({ referenceId: 'org-1' }),
      );
      expect(xenditService.createSubscriptionSession).toHaveBeenCalledWith(
        expect.objectContaining({ customerId: 'cust-1' }),
      );
    });

    it('should bubble non-duplicate customer create errors', async () => {
      subscriptionsService.getActiveSubscription.mockResolvedValue(null as never);
      subscriptionsService.getDefaultEntitlements.mockReturnValue({} as never);
      (xenditService.createCustomer as jest.Mock).mockRejectedValue(
        new XenditApiError(500, 'SERVER_ERROR'),
      );

      await expect(service.createCheckout('org-1', dto, 'user-1')).rejects.toThrow(
        'Xendit API error: 500',
      );
      // No fallback GET for non-duplicate failures.
      expect(xenditService.getCustomerByReferenceId).toHaveBeenCalledTimes(1);
    });

    it('should throw BadRequestException for invalid plan code', async () => {
      pricingEngine.calculatePriceBreakdown.mockRejectedValue(
        new BadRequestException('Invalid plan code: invalid'),
      );

      await expect(
        service.createCheckout('org-1', { ...dto, planCode: 'invalid' }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for downgrade', async () => {
      pricingEngine.calculatePriceBreakdown.mockResolvedValue({
        ...mockBreakdown,
        planCode: 'edu',
        planName: 'Edu',
        basePriceAmount: 29900,
        finalAmount: 29900,
      } as never);
      subscriptionsService.getActiveSubscription.mockResolvedValue({
        ...mockSubscription,
        planCode: 'enterprise',
      } as never);

      await expect(
        service.createCheckout('org-1', { ...dto, planCode: 'edu' }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should allow upgrade from edu to pro', async () => {
      pricingEngine.calculatePriceBreakdown.mockResolvedValue({ ...mockBreakdown } as never);
      subscriptionsService.getActiveSubscription.mockResolvedValue({
        ...mockSubscription,
        planCode: 'edu',
      } as never);
      xenditService.createInvoice.mockResolvedValue({
        id: 'inv_upgrade',
        external_id: 'ext-upgrade',
        invoice_url: 'https://checkout.xendit.co/inv_upgrade',
        status: 'PENDING',
        amount: 999,
        currency: 'PHP',
        description: 'LIBERTASIAN Pro Plan — Monthly',
      });
      (prisma.payment.create as jest.Mock).mockResolvedValue({
        ...mockPayment,
        paymentType: 'upgrade',
      });
      (prisma.checkoutPriceSnapshot.create as jest.Mock).mockResolvedValue({ id: 'snap-3' });

      const result = await service.createCheckout('org-1', dto, 'user-1');
      expect(result).toHaveProperty('checkoutUrl');
    });

    it('should call pricingEngine.calculatePriceBreakdown with couponCode and promotionId', async () => {
      const dtoWithDiscounts = {
        ...dto,
        couponCode: 'LAUNCH20',
        promotionId: 'promo-1',
      };
      const breakdownWithDiscounts = {
        ...mockBreakdown,
        couponId: 'coupon-1',
        couponCode: 'LAUNCH20',
        couponDiscountAmount: 19980,
        promotionId: 'promo-1',
        promotionDiscountAmount: 10000,
        totalDiscountAmount: 29980,
        finalAmount: 69920,
        discountsStacked: true,
        lineItems: [
          ...mockBreakdown.lineItems,
          {
            type: 'coupon_discount',
            label: 'Coupon: LAUNCH20',
            amount: -19980,
            referenceId: 'coupon-1',
            referenceCode: 'LAUNCH20',
            metadata: { discountType: 'percentage', discountValue: 20 },
          },
          {
            type: 'promotion_discount',
            label: 'Promotion discount',
            amount: -10000,
            referenceId: 'promo-1',
            referenceCode: null,
            metadata: { discountType: 'fixed_amount', discountValue: 10000 },
          },
        ],
      };
      pricingEngine.calculatePriceBreakdown.mockResolvedValue(breakdownWithDiscounts as never);
      couponService.reserveCoupon.mockResolvedValue({ id: 'redemption-1' } as never);
      subscriptionsService.getActiveSubscription.mockResolvedValue(null as never);
      xenditService.createInvoice.mockResolvedValue({
        id: 'inv_discounted',
        external_id: 'ext-discounted',
        invoice_url: 'https://checkout.xendit.co/inv_discounted',
        status: 'PENDING',
        amount: 699,
        currency: 'PHP',
        description: 'LIBERTASIAN Pro Plan — Monthly',
      });
      (prisma.payment.create as jest.Mock).mockResolvedValue({
        ...mockPayment,
        id: 'pay-discounted',
        amount: 69920,
      });
      (prisma.checkoutPriceSnapshot.create as jest.Mock).mockResolvedValue({ id: 'snap-4' });

      await service.createCheckout('org-1', dtoWithDiscounts, 'user-1');

      expect(pricingEngine.calculatePriceBreakdown).toHaveBeenCalledWith(
        expect.objectContaining({
          couponCode: 'LAUNCH20',
          promotionId: 'promo-1',
        }),
      );
    });
  });

  // ---- createCheckout — coupon flow ----

  describe('createCheckout — coupon flow', () => {
    const dto = {
      planCode: 'pro',
      billingPeriod: 'monthly' as const,
      successUrl: 'https://app.com/success',
      cancelUrl: 'https://app.com/cancel',
      couponCode: 'SAVE20',
    };

    const breakdownWithCoupon = {
      ...mockBreakdown,
      couponId: 'coupon-1',
      couponCode: 'SAVE20',
      couponDiscountAmount: 19980,
      totalDiscountAmount: 19980,
      finalAmount: 79920,
    };

    it('should reserve coupon when couponCode results in a coupon in breakdown', async () => {
      pricingEngine.calculatePriceBreakdown.mockResolvedValue({ ...breakdownWithCoupon } as never);
      couponService.reserveCoupon.mockResolvedValue({ id: 'redemption-1' } as never);
      subscriptionsService.getActiveSubscription.mockResolvedValue(null as never);
      subscriptionsService.getDefaultEntitlements.mockReturnValue({} as never);

      await service.createCheckout('org-1', dto, 'user-1');

      expect(couponService.reserveCoupon).toHaveBeenCalledWith(
        'SAVE20',
        'org-1',
        'user-1',
        'pro',
        'monthly',
      );
      // discounted amount in WHOLE PHP (79920 centavos → 799), coupon redemption
      // carried in the session metadata
      expect(xenditService.createSubscriptionSession).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 799,
          metadata: expect.objectContaining({
            couponRedemptionId: 'redemption-1',
          }),
        }),
      );
    });

    it('should not reserve coupon when breakdown has no couponCode', async () => {
      // Even if dto has couponCode, if pricing engine says coupon is invalid
      // (couponCode is null in breakdown), no reservation should occur
      pricingEngine.calculatePriceBreakdown.mockResolvedValue({ ...mockBreakdown } as never);
      subscriptionsService.getActiveSubscription.mockResolvedValue(null as never);
      xenditService.createInvoice.mockResolvedValue({
        id: 'inv_no_coupon',
        external_id: 'ext-no-coupon',
        invoice_url: 'https://checkout.xendit.co/inv_no_coupon',
        status: 'PENDING',
        amount: 999,
        currency: 'PHP',
        description: 'LIBERTASIAN Pro Plan — Monthly',
      });
      (prisma.payment.create as jest.Mock).mockResolvedValue(mockPayment);
      (prisma.checkoutPriceSnapshot.create as jest.Mock).mockResolvedValue({ id: 'snap-no-coupon' });

      await service.createCheckout('org-1', dto, 'user-1');

      expect(couponService.reserveCoupon).not.toHaveBeenCalled();
    });

    it('should include couponRedemptionId in the session metadata', async () => {
      pricingEngine.calculatePriceBreakdown.mockResolvedValue({ ...breakdownWithCoupon } as never);
      couponService.reserveCoupon.mockResolvedValue({ id: 'redemption-2' } as never);
      subscriptionsService.getActiveSubscription.mockResolvedValue(null as never);
      subscriptionsService.getDefaultEntitlements.mockReturnValue({} as never);

      await service.createCheckout('org-1', dto, 'user-1');

      expect(xenditService.createSubscriptionSession).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            couponRedemptionId: 'redemption-2',
          }),
        }),
      );
    });
  });

  // ---- handlePaymentSuccess ----

  describe('handlePaymentSuccess', () => {
    it('should process successful payment and create subscription', async () => {
      (prisma.payment.findUnique as jest.Mock).mockResolvedValue(mockPayment);
      (prisma.$transaction as jest.Mock).mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
        await cb(mockTransactionClient);
      });
      subscriptionsService.getDefaultEntitlements.mockReturnValue({} as never);
      (prisma.invoice as unknown as { findFirst: jest.Mock }).findFirst = jest.fn().mockResolvedValue(null);
      // Mock subscription.findFirst for the post-transaction lifecycle call
      (prisma.subscription as unknown as { findFirst: jest.Mock }).findFirst = jest.fn().mockResolvedValue({
        id: 'sub-new',
        organizationId: 'org-1',
        status: 'provisioning',
      });

      await service.handlePaymentSuccess({ id: 'inv_test_123' });

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(lifecycleService.executeTransition).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'billing.payment_succeeded',
        }),
      );
    });

    it('should finalize coupon on payment success when couponRedemptionId in metadata', async () => {
      const paymentWithCoupon = {
        ...mockPayment,
        metadata: {
          planCode: 'pro',
          billingPeriod: 'monthly',
          xenditInvoiceId: 'inv_test_123',
          couponRedemptionId: 'redemption-1',
        },
      };
      (prisma.payment.findUnique as jest.Mock).mockResolvedValue(paymentWithCoupon);
      (prisma.$transaction as jest.Mock).mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
        await cb(mockTransactionClient);
      });
      subscriptionsService.getDefaultEntitlements.mockReturnValue({} as never);
      (prisma.invoice as unknown as { findFirst: jest.Mock }).findFirst = jest.fn().mockResolvedValue(null);
      (prisma.subscription as unknown as { findFirst: jest.Mock }).findFirst = jest.fn().mockResolvedValue({
        id: 'sub-new',
        organizationId: 'org-1',
        status: 'provisioning',
      });
      (prisma.checkoutPriceSnapshot as unknown as { findUnique: jest.Mock }).findUnique = jest.fn().mockResolvedValue({
        couponDiscountAmount: 19980,
      });
      couponService.finalizeCoupon.mockResolvedValue({} as never);

      await service.handlePaymentSuccess({ id: 'inv_test_123' });

      expect(couponService.finalizeCoupon).toHaveBeenCalledWith(
        'redemption-1',
        paymentWithCoupon.id, // subscriptionId (payment.id used as proxy)
        paymentWithCoupon.id, // paymentId
        19980,
      );
    });

    it('should not finalize coupon when no couponRedemptionId in metadata', async () => {
      (prisma.payment.findUnique as jest.Mock).mockResolvedValue(mockPayment);
      (prisma.$transaction as jest.Mock).mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
        await cb(mockTransactionClient);
      });
      subscriptionsService.getDefaultEntitlements.mockReturnValue({} as never);
      (prisma.invoice as unknown as { findFirst: jest.Mock }).findFirst = jest.fn().mockResolvedValue(null);
      (prisma.subscription as unknown as { findFirst: jest.Mock }).findFirst = jest.fn().mockResolvedValue({
        id: 'sub-new',
        organizationId: 'org-1',
        status: 'provisioning',
      });

      await service.handlePaymentSuccess({ id: 'inv_test_123' });

      expect(couponService.finalizeCoupon).not.toHaveBeenCalled();
    });

    it('should be idempotent for already-succeeded payments', async () => {
      (prisma.payment.findUnique as jest.Mock).mockResolvedValue({
        ...mockPayment,
        status: 'succeeded',
      });

      await service.handlePaymentSuccess({ id: 'inv_test_123' });

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('should handle missing payment gracefully', async () => {
      (prisma.payment.findUnique as jest.Mock).mockResolvedValue(null);

      await service.handlePaymentSuccess({ id: 'inv_unknown' });

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  // ---- handlePaymentFailed ----

  describe('handlePaymentFailed', () => {
    it('should mark payment as failed', async () => {
      (prisma.payment.findUnique as jest.Mock).mockResolvedValue(mockPayment);
      (prisma.payment.update as jest.Mock).mockResolvedValue({ ...mockPayment, status: 'failed' });

      await service.handlePaymentFailed({
        id: 'inv_test_123',
        failure_reason: 'Card declined',
      });

      expect(prisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'failed',
            failureReason: 'Card declined',
          }),
        }),
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'billing.payment_failed',
        }),
      );
    });

    it('should rollback coupon on payment failure when couponRedemptionId in metadata', async () => {
      const paymentWithCoupon = {
        ...mockPayment,
        metadata: {
          planCode: 'pro',
          billingPeriod: 'monthly',
          xenditInvoiceId: 'inv_test_123',
          couponRedemptionId: 'redemption-1',
        },
      };
      (prisma.payment.findUnique as jest.Mock).mockResolvedValue(paymentWithCoupon);
      (prisma.payment.update as jest.Mock).mockResolvedValue({ ...paymentWithCoupon, status: 'failed' });
      couponService.rollbackCoupon.mockResolvedValue({} as never);

      await service.handlePaymentFailed({
        id: 'inv_test_123',
        failure_reason: 'Card declined',
      });

      expect(couponService.rollbackCoupon).toHaveBeenCalledWith('redemption-1');
    });

    it('should not rollback coupon when no couponRedemptionId in metadata', async () => {
      (prisma.payment.findUnique as jest.Mock).mockResolvedValue(mockPayment);
      (prisma.payment.update as jest.Mock).mockResolvedValue({ ...mockPayment, status: 'failed' });

      await service.handlePaymentFailed({
        id: 'inv_test_123',
        failure_reason: 'Card declined',
      });

      expect(couponService.rollbackCoupon).not.toHaveBeenCalled();
    });

    it('should be idempotent for already-failed payments', async () => {
      (prisma.payment.findUnique as jest.Mock).mockResolvedValue({
        ...mockPayment,
        status: 'failed',
      });

      await service.handlePaymentFailed({ id: 'inv_test_123' });

      expect(prisma.payment.update).not.toHaveBeenCalled();
    });

    it('should ignore EXPIRED webhook for already-succeeded payments', async () => {
      (prisma.payment.findUnique as jest.Mock).mockResolvedValue({
        ...mockPayment,
        status: 'succeeded',
      });

      await service.handlePaymentFailed({ id: 'inv_test_123' });

      expect(prisma.payment.update).not.toHaveBeenCalled();
    });

    it('should handle missing payment gracefully', async () => {
      (prisma.payment.findUnique as jest.Mock).mockResolvedValue(null);

      await service.handlePaymentFailed({ id: 'inv_unknown' });

      expect(prisma.payment.update).not.toHaveBeenCalled();
    });
  });

  // ---- cancelSubscription ----

  describe('cancelSubscription', () => {
    it('should cancel at period end', async () => {
      subscriptionsService.getActiveSubscription.mockResolvedValue(mockSubscription as never);

      const result = await service.cancelSubscription('org-1', 'user-1', true);

      expect(result.cancelAtPeriodEnd).toBe(true);
      expect(lifecycleService.executeTransition).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriptionId: 'sub-1',
          action: 'REQUEST_CANCEL',
          actorUserId: 'user-1',
          actorType: 'user',
        }),
      );
    });

    it('should cancel immediately and create free subscription', async () => {
      subscriptionsService.getActiveSubscription.mockResolvedValue(mockSubscription as never);
      subscriptionsService.getDefaultEntitlements.mockReturnValue({} as never);
      // Mock subscription.create for the free subscription fallback
      (prisma.subscription as unknown as { create: jest.Mock }).create = jest.fn().mockResolvedValue({
        id: 'sub-free',
      });

      const result = await service.cancelSubscription('org-1', 'user-1', false);

      expect(result.cancelAtPeriodEnd).toBe(false);
      expect(lifecycleService.executeTransition).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CANCEL_IMMEDIATELY',
        }),
      );
    });

    it('should throw NotFoundException when no subscription', async () => {
      subscriptionsService.getActiveSubscription.mockResolvedValue(null as never);

      await expect(service.cancelSubscription('org-1', 'user-1', true)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException for free plan', async () => {
      subscriptionsService.getActiveSubscription.mockResolvedValue({
        ...mockSubscription,
        planCode: 'free',
      } as never);

      await expect(service.cancelSubscription('org-1', 'user-1', true)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ---- Payment Methods ----

  describe('listPaymentMethods', () => {
    it('should return active payment methods', async () => {
      const methods = [{ id: 'pm-1', type: 'card', brand: 'visa', last4: '4242' }];
      (prisma.paymentMethod.findMany as jest.Mock).mockResolvedValue(methods);

      const result = await service.listPaymentMethods('org-1');
      expect(result).toEqual(methods);
      expect(prisma.paymentMethod.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: 'org-1', isActive: true },
        }),
      );
    });
  });

  describe('setDefaultPaymentMethod', () => {
    it('should set payment method as default', async () => {
      (prisma.paymentMethod.findFirst as jest.Mock).mockResolvedValue({
        id: 'pm-1',
        organizationId: 'org-1',
        isActive: true,
      });
      (prisma.$transaction as jest.Mock).mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
        await cb({
          paymentMethod: {
            updateMany: jest.fn(),
            update: jest.fn(),
          },
        });
      });

      const result = await service.setDefaultPaymentMethod('org-1', 'pm-1', 'user-1');
      expect(result.message).toBe('Default payment method updated');
      expect(auditService.log).toHaveBeenCalled();
    });

    it('should throw NotFoundException for missing payment method', async () => {
      (prisma.paymentMethod.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.setDefaultPaymentMethod('org-1', 'pm-nonexistent', 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deletePaymentMethod', () => {
    it('should soft-delete payment method', async () => {
      (prisma.paymentMethod.findFirst as jest.Mock).mockResolvedValue({
        id: 'pm-1',
        organizationId: 'org-1',
        isActive: true,
      });
      (prisma.paymentMethod.update as jest.Mock).mockResolvedValue({ id: 'pm-1', isActive: false });

      const result = await service.deletePaymentMethod('org-1', 'pm-1', 'user-1');
      expect(result.message).toBe('Payment method removed');
      expect(prisma.paymentMethod.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { isActive: false },
        }),
      );
    });

    it('should throw NotFoundException for missing payment method', async () => {
      (prisma.paymentMethod.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.deletePaymentMethod('org-1', 'pm-x', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ---- Invoices ----

  describe('listInvoices', () => {
    it('should return paginated invoices', async () => {
      const invoices = Array.from({ length: 3 }, (_, i) => ({
        id: `inv-${i}`,
        invoiceNumber: `INV-2026-03-0000${i + 1}`,
        amount: 99900,
        currency: 'PHP',
        status: 'paid',
        createdAt: new Date(),
      }));
      (prisma.invoice.findMany as jest.Mock).mockResolvedValue(invoices);

      const result = await service.listInvoices('org-1');
      expect(result.items).toHaveLength(3);
      expect(result.meta.hasNext).toBe(false);
    });

    it('should handle pagination with cursor', async () => {
      const invoices = Array.from({ length: 21 }, (_, i) => ({
        id: `inv-${i}`,
        invoiceNumber: `INV-2026-03-0000${i + 1}`,
      }));
      (prisma.invoice.findMany as jest.Mock).mockResolvedValue(invoices);

      const result = await service.listInvoices('org-1', undefined, 20);
      expect(result.items).toHaveLength(20);
      expect(result.meta.hasNext).toBe(true);
      expect(result.meta.nextCursor).toBeDefined();
    });
  });

  describe('getInvoice', () => {
    it('should return invoice by id', async () => {
      const invoice = { id: 'inv-1', organizationId: 'org-1', invoiceNumber: 'INV-2026-03-00001' };
      (prisma.invoice.findFirst as jest.Mock).mockResolvedValue(invoice);

      const result = await service.getInvoice('org-1', 'inv-1');
      expect(result).toEqual(invoice);
    });

    it('should throw NotFoundException for missing invoice', async () => {
      (prisma.invoice.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.getInvoice('org-1', 'inv-x')).rejects.toThrow(NotFoundException);
    });
  });

  // ---- previewCheckout ----

  describe('previewCheckout', () => {
    const previewDto = {
      planCode: 'pro',
      billingPeriod: 'monthly' as const,
    };

    it('should return price breakdown without creating any records', async () => {
      pricingEngine.calculatePriceBreakdown.mockResolvedValue({ ...mockBreakdown } as never);
      subscriptionsService.getActiveSubscription.mockResolvedValue(null as never);

      const result = await service.previewCheckout('org-1', previewDto, 'user-1');

      expect(result.basePriceAmount).toBe(99900);
      expect(result.finalAmount).toBe(99900);
      expect(result.planCode).toBe('pro');
      expect(result.isNewSubscription).toBe(true);
      expect(result.isUpgrade).toBe(false);
      expect(result.isDowngrade).toBe(false);
      expect(result.currentPlanCode).toBe('free');
      // Ensure no payment or snapshot was created
      expect(prisma.payment.create).not.toHaveBeenCalled();
      expect(prisma.checkoutPriceSnapshot.create).not.toHaveBeenCalled();
      expect(xenditService.createInvoice).not.toHaveBeenCalled();
    });

    it('should detect upgrade from edu to pro', async () => {
      pricingEngine.calculatePriceBreakdown.mockResolvedValue({ ...mockBreakdown } as never);
      subscriptionsService.getActiveSubscription.mockResolvedValue({
        ...mockSubscription,
        planCode: 'edu',
      } as never);

      const result = await service.previewCheckout('org-1', previewDto, 'user-1');

      expect(result.isUpgrade).toBe(true);
      expect(result.isDowngrade).toBe(false);
      expect(result.isNewSubscription).toBe(false);
      expect(result.currentPlanCode).toBe('edu');
    });

    it('should detect downgrade from enterprise to pro', async () => {
      pricingEngine.calculatePriceBreakdown.mockResolvedValue({ ...mockBreakdown } as never);
      subscriptionsService.getActiveSubscription.mockResolvedValue({
        ...mockSubscription,
        planCode: 'enterprise',
      } as never);

      const result = await service.previewCheckout('org-1', previewDto, 'user-1');

      expect(result.isUpgrade).toBe(false);
      expect(result.isDowngrade).toBe(true);
      expect(result.isNewSubscription).toBe(false);
      expect(result.currentPlanCode).toBe('enterprise');
    });

    it('should detect same plan (not upgrade, not downgrade)', async () => {
      pricingEngine.calculatePriceBreakdown.mockResolvedValue({ ...mockBreakdown } as never);
      subscriptionsService.getActiveSubscription.mockResolvedValue({
        ...mockSubscription,
        planCode: 'pro',
      } as never);

      const result = await service.previewCheckout('org-1', previewDto, 'user-1');

      expect(result.isUpgrade).toBe(false);
      expect(result.isDowngrade).toBe(false);
      expect(result.isNewSubscription).toBe(false);
    });

    it('should pass couponCode and promotionId to pricing engine', async () => {
      const dtoWithDiscounts = {
        ...previewDto,
        couponCode: 'LAUNCH20',
        promotionId: 'promo-1',
      };
      const discountBreakdown = {
        ...mockBreakdown,
        couponId: 'coupon-1',
        couponCode: 'LAUNCH20',
        couponDiscountAmount: 19980,
        promotionId: 'promo-1',
        promotionDiscountAmount: 10000,
        totalDiscountAmount: 29980,
        finalAmount: 69920,
        discountsStacked: true,
      };
      pricingEngine.calculatePriceBreakdown.mockResolvedValue(discountBreakdown as never);
      subscriptionsService.getActiveSubscription.mockResolvedValue(null as never);

      const result = await service.previewCheckout('org-1', dtoWithDiscounts, 'user-1');

      expect(pricingEngine.calculatePriceBreakdown).toHaveBeenCalledWith(
        expect.objectContaining({
          couponCode: 'LAUNCH20',
          promotionId: 'promo-1',
        }),
      );
      expect(result.finalAmount).toBe(69920);
      expect(result.couponDiscountAmount).toBe(19980);
      expect(result.promotionDiscountAmount).toBe(10000);
      expect(result.discountsStacked).toBe(true);
    });

    it('should handle pricing engine errors gracefully', async () => {
      pricingEngine.calculatePriceBreakdown.mockRejectedValue(
        new BadRequestException('Invalid plan code: invalid'),
      );

      await expect(
        service.previewCheckout('org-1', { ...previewDto, planCode: 'invalid' }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should treat free plan as new subscription', async () => {
      pricingEngine.calculatePriceBreakdown.mockResolvedValue({ ...mockBreakdown } as never);
      subscriptionsService.getActiveSubscription.mockResolvedValue({
        ...mockSubscription,
        planCode: 'free',
      } as never);

      const result = await service.previewCheckout('org-1', previewDto, 'user-1');

      expect(result.isNewSubscription).toBe(true);
    });
  });

  // ---- handlePaymentSuccess — invoice line items from snapshot ----

  describe('handlePaymentSuccess — invoice from snapshot', () => {
    it('should use snapshot line items when snapshot exists', async () => {
      const snapshotData = {
        paymentId: 'pay-1',
        planName: 'Pro',
        billingPeriod: 'monthly',
        basePriceAmount: 99900,
        couponCode: 'SAVE20',
        couponDiscountAmount: 19980,
        promotionDiscountAmount: 0,
        finalAmount: 79920,
        lineItemsJson: [],
      };

      (prisma.payment.findUnique as jest.Mock).mockResolvedValue(mockPayment);
      mockTransactionClient.checkoutPriceSnapshot.findUnique.mockResolvedValue(snapshotData);
      (prisma.$transaction as jest.Mock).mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
        await cb(mockTransactionClient);
      });
      subscriptionsService.getDefaultEntitlements.mockReturnValue({} as never);
      (prisma.invoice as unknown as { findFirst: jest.Mock }).findFirst = jest.fn().mockResolvedValue(null);
      (prisma.subscription as unknown as { findFirst: jest.Mock }).findFirst = jest.fn().mockResolvedValue({
        id: 'sub-new',
        organizationId: 'org-1',
        status: 'provisioning',
      });

      await service.handlePaymentSuccess({ id: 'inv_test_123' });

      // Verify invoice.create was called within the transaction
      expect(mockTransactionClient.invoice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            lineItemsJson: expect.arrayContaining([
              expect.objectContaining({
                description: 'Pro Plan — Monthly',
                unitAmount: 99900,
              }),
              expect.objectContaining({
                description: 'Coupon discount (SAVE20)',
                unitAmount: -19980,
              }),
            ]),
          }),
        }),
      );
    });

    it('should fall back to basic line items when no snapshot', async () => {
      (prisma.payment.findUnique as jest.Mock).mockResolvedValue(mockPayment);
      mockTransactionClient.checkoutPriceSnapshot.findUnique.mockResolvedValue(null);
      (prisma.$transaction as jest.Mock).mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
        await cb(mockTransactionClient);
      });
      subscriptionsService.getDefaultEntitlements.mockReturnValue({} as never);
      (prisma.invoice as unknown as { findFirst: jest.Mock }).findFirst = jest.fn().mockResolvedValue(null);
      (prisma.subscription as unknown as { findFirst: jest.Mock }).findFirst = jest.fn().mockResolvedValue({
        id: 'sub-new',
        organizationId: 'org-1',
        status: 'provisioning',
      });

      await service.handlePaymentSuccess({ id: 'inv_test_123' });

      expect(mockTransactionClient.invoice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            lineItemsJson: [
              expect.objectContaining({
                description: mockPayment.description,
                quantity: 1,
                unitAmount: mockPayment.amount,
                totalAmount: mockPayment.amount,
              }),
            ],
          }),
        }),
      );
    });

    it('should include promotion discount line item when promotion applied', async () => {
      const snapshotWithPromo = {
        paymentId: 'pay-1',
        planName: 'Pro',
        billingPeriod: 'monthly',
        basePriceAmount: 99900,
        couponCode: null,
        couponDiscountAmount: 0,
        promotionDiscountAmount: 15000,
        finalAmount: 84900,
        lineItemsJson: [],
      };

      (prisma.payment.findUnique as jest.Mock).mockResolvedValue(mockPayment);
      mockTransactionClient.checkoutPriceSnapshot.findUnique.mockResolvedValue(snapshotWithPromo);
      (prisma.$transaction as jest.Mock).mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
        await cb(mockTransactionClient);
      });
      subscriptionsService.getDefaultEntitlements.mockReturnValue({} as never);
      (prisma.invoice as unknown as { findFirst: jest.Mock }).findFirst = jest.fn().mockResolvedValue(null);
      (prisma.subscription as unknown as { findFirst: jest.Mock }).findFirst = jest.fn().mockResolvedValue({
        id: 'sub-new',
        organizationId: 'org-1',
        status: 'provisioning',
      });

      await service.handlePaymentSuccess({ id: 'inv_test_123' });

      expect(mockTransactionClient.invoice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            lineItemsJson: expect.arrayContaining([
              expect.objectContaining({
                description: 'Pro Plan — Monthly',
              }),
              expect.objectContaining({
                description: 'Promotion discount',
                unitAmount: -15000,
              }),
            ]),
          }),
        }),
      );
    });
  });

  // ---- handlePaymentSuccess — promotion redemption ----

  describe('handlePaymentSuccess — promotion redemption', () => {
    it('should record promotion redemption when promotionId in metadata', async () => {
      const paymentWithPromo = {
        ...mockPayment,
        metadata: {
          planCode: 'pro',
          billingPeriod: 'monthly',
          xenditInvoiceId: 'inv_test_123',
          userId: 'user-1',
          promotionId: 'promo-1',
        },
      };
      (prisma.payment.findUnique as jest.Mock).mockResolvedValue(paymentWithPromo);
      mockTransactionClient.checkoutPriceSnapshot.findUnique.mockResolvedValue(null);
      (prisma.$transaction as jest.Mock).mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
        await cb(mockTransactionClient);
      });
      subscriptionsService.getDefaultEntitlements.mockReturnValue({} as never);
      (prisma.invoice as unknown as { findFirst: jest.Mock }).findFirst = jest.fn().mockResolvedValue(null);
      (prisma.subscription as unknown as { findFirst: jest.Mock }).findFirst = jest.fn().mockResolvedValue({
        id: 'sub-new',
        organizationId: 'org-1',
        status: 'provisioning',
      });
      promotionService.applyPromotion.mockResolvedValue({ success: true } as never);

      await service.handlePaymentSuccess({ id: 'inv_test_123' });

      expect(promotionService.applyPromotion).toHaveBeenCalledWith(
        expect.objectContaining({
          promotionId: 'promo-1',
          organizationId: 'org-1',
          userId: 'user-1',
          planCode: 'pro',
          billingPeriod: 'monthly',
          subscriptionId: 'sub-new',
          paymentId: paymentWithPromo.id,
        }),
      );
    });

    it('should not record promotion when no promotionId in metadata', async () => {
      (prisma.payment.findUnique as jest.Mock).mockResolvedValue(mockPayment);
      mockTransactionClient.checkoutPriceSnapshot.findUnique.mockResolvedValue(null);
      (prisma.$transaction as jest.Mock).mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
        await cb(mockTransactionClient);
      });
      subscriptionsService.getDefaultEntitlements.mockReturnValue({} as never);
      (prisma.invoice as unknown as { findFirst: jest.Mock }).findFirst = jest.fn().mockResolvedValue(null);
      (prisma.subscription as unknown as { findFirst: jest.Mock }).findFirst = jest.fn().mockResolvedValue({
        id: 'sub-new',
        organizationId: 'org-1',
        status: 'provisioning',
      });

      await service.handlePaymentSuccess({ id: 'inv_test_123' });

      expect(promotionService.applyPromotion).not.toHaveBeenCalled();
    });

    it('should handle promotion recording failure gracefully', async () => {
      const paymentWithPromo = {
        ...mockPayment,
        metadata: {
          planCode: 'pro',
          billingPeriod: 'monthly',
          xenditInvoiceId: 'inv_test_123',
          userId: 'user-1',
          promotionId: 'promo-1',
        },
      };
      (prisma.payment.findUnique as jest.Mock).mockResolvedValue(paymentWithPromo);
      mockTransactionClient.checkoutPriceSnapshot.findUnique.mockResolvedValue(null);
      (prisma.$transaction as jest.Mock).mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
        await cb(mockTransactionClient);
      });
      subscriptionsService.getDefaultEntitlements.mockReturnValue({} as never);
      (prisma.invoice as unknown as { findFirst: jest.Mock }).findFirst = jest.fn().mockResolvedValue(null);
      (prisma.subscription as unknown as { findFirst: jest.Mock }).findFirst = jest.fn().mockResolvedValue({
        id: 'sub-new',
        organizationId: 'org-1',
        status: 'provisioning',
      });
      promotionService.applyPromotion.mockRejectedValue(new Error('Promo limit reached'));

      // Should not throw — promotion failure is non-blocking
      await expect(
        service.handlePaymentSuccess({ id: 'cs_test_123' }),
      ).resolves.not.toThrow();

      expect(promotionService.applyPromotion).toHaveBeenCalled();
    });
  });

  // ---- createCheckout — userId in metadata ----

  describe('createCheckout — userId in session metadata', () => {
    const dto = {
      planCode: 'pro',
      billingPeriod: 'monthly' as const,
      successUrl: 'https://app.com/success',
      cancelUrl: 'https://app.com/cancel',
    };

    it('should include userId in the session metadata', async () => {
      pricingEngine.calculatePriceBreakdown.mockResolvedValue({ ...mockBreakdown } as never);
      subscriptionsService.getActiveSubscription.mockResolvedValue(null as never);
      subscriptionsService.getDefaultEntitlements.mockReturnValue({} as never);

      await service.createCheckout('org-1', dto, 'user-1');

      expect(xenditService.createSubscriptionSession).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ userId: 'user-1' }),
        }),
      );
    });
  });

  // ---- PricingEngine-driven Pricing ----

  describe('createCheckout — pricing engine integration', () => {
    const dto = {
      planCode: 'pro',
      billingPeriod: 'monthly' as const,
      successUrl: 'https://app.com/success',
      cancelUrl: 'https://app.com/cancel',
    };

    it('should use the DB price (whole PHP) for the recurring session amount', async () => {
      const dbBreakdown = {
        ...mockBreakdown,
        basePriceAmount: 89900,
        finalAmount: 89900,
        planName: 'Professional',
        planId: 'plan-db-1',
      };
      pricingEngine.calculatePriceBreakdown.mockResolvedValue(dbBreakdown as never);
      subscriptionsService.getActiveSubscription.mockResolvedValue(null as never);
      subscriptionsService.getDefaultEntitlements.mockReturnValue({} as never);

      await service.createCheckout('org-1', dto, 'user-1');

      expect(xenditService.createSubscriptionSession).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 899 }),
      );
    });

    it('should include planId in the session metadata when present', async () => {
      const dbBreakdown = {
        ...mockBreakdown,
        planId: 'plan-db-1',
        planName: 'Professional',
      };
      pricingEngine.calculatePriceBreakdown.mockResolvedValue(dbBreakdown as never);
      subscriptionsService.getActiveSubscription.mockResolvedValue(null as never);
      subscriptionsService.getDefaultEntitlements.mockReturnValue({} as never);

      await service.createCheckout('org-1', dto, 'user-1');

      expect(xenditService.createSubscriptionSession).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ planId: 'plan-db-1' }),
        }),
      );
    });

    it('should NOT create a one-time invoice for plan purchases', async () => {
      pricingEngine.calculatePriceBreakdown.mockResolvedValue({ ...mockBreakdown } as never);
      subscriptionsService.getActiveSubscription.mockResolvedValue(null as never);
      subscriptionsService.getDefaultEntitlements.mockReturnValue({} as never);

      await service.createCheckout('org-1', dto, 'user-1');

      expect(xenditService.createInvoice).not.toHaveBeenCalled();
      expect(xenditService.createSubscriptionSession).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 999 }),
      );
    });
  });

  // ---- Recurring webhook handlers ----

  describe('recurring webhook handlers', () => {
    const provisioningSub = {
      id: 'sub-1',
      organizationId: 'org-1',
      planCode: 'pro',
      billingPeriod: 'monthly',
      status: 'provisioning',
      xenditSubscriptionId: null,
      currentPeriodEnd: null,
    };

    const activeSub = {
      ...provisioningSub,
      status: 'active',
      xenditSubscriptionId: 'repl_1',
      currentPeriodEnd: new Date('2026-07-01T00:00:00Z'),
    };

    beforeEach(() => {
      subscriptionsService.getDefaultEntitlements.mockReturnValue({} as never);
      // mockTransactionClient is module-level — clear accumulated calls so each
      // test reads its own tx invocations.
      mockTransactionClient.payment.create.mockClear();
      mockTransactionClient.payment.update.mockClear();
      mockTransactionClient.subscription.update.mockClear();
      mockTransactionClient.invoice.create.mockClear();
      (prisma.$transaction as jest.Mock).mockImplementation(
        async (cb: (tx: unknown) => Promise<void>) => cb(mockTransactionClient),
      );
    });

    describe('handleSubscriptionActivated', () => {
      it('links by reference_id, sets the repl_ id + period, and ACTIVATEs', async () => {
        // not found by xenditSubscriptionId, found by reference_id
        (prisma.subscription.findFirst as jest.Mock).mockResolvedValue(null);
        (prisma.subscription.findUnique as jest.Mock).mockResolvedValue(provisioningSub);

        await service.handleSubscriptionActivated({
          id: 'repl_1',
          recurring_plan_id: 'repl_1',
          reference_id: 'sub-1',
          status: 'ACTIVE',
        });

        expect(prisma.subscription.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'sub-1' },
            data: expect.objectContaining({ xenditSubscriptionId: 'repl_1' }),
          }),
        );
        expect(lifecycleService.executeTransition).toHaveBeenCalledWith(
          expect.objectContaining({ subscriptionId: 'sub-1', action: SubscriptionAction.ACTIVATE }),
        );
        expect(entitlementService.invalidateEntitlementCache).toHaveBeenCalledWith('org-1');
      });

      it('opens the period (currentPeriodStart) but does NOT set currentPeriodEnd — cycle.succeeded owns the advance', async () => {
        (prisma.subscription.findFirst as jest.Mock).mockResolvedValue(null);
        (prisma.subscription.findUnique as jest.Mock).mockResolvedValue(provisioningSub);

        await service.handleSubscriptionActivated({
          id: 'repl_1',
          recurring_plan_id: 'repl_1',
          reference_id: 'sub-1',
          status: 'ACTIVE',
        });

        const updateArgs = (prisma.subscription.update as jest.Mock).mock.calls[0][0];
        expect(updateArgs.data.currentPeriodStart).toBeInstanceOf(Date);
        // The double-advance fix: activation must NOT set currentPeriodEnd, so
        // the first recurring.cycle.succeeded advances it exactly one period.
        expect(updateArgs.data).not.toHaveProperty('currentPeriodEnd');
      });

      it('is idempotent when the subscription is already active', async () => {
        (prisma.subscription.findFirst as jest.Mock).mockResolvedValue(activeSub);

        await service.handleSubscriptionActivated({ id: 'repl_1', reference_id: 'sub-1' });

        expect(lifecycleService.executeTransition).not.toHaveBeenCalled();
      });
    });

    describe('handleCycleSucceeded', () => {
      it('records the cycle payment and advances the period by exactly one cycle', async () => {
        (prisma.subscription.findFirst as jest.Mock).mockResolvedValue(activeSub);
        (prisma.payment.findUnique as jest.Mock).mockResolvedValue(null); // not seen before

        await service.handleCycleSucceeded({
          id: 'cycle_1',
          recurring_plan_id: 'repl_1',
          amount: 999,
          currency: 'PHP',
        });

        // payment recorded with centavos amount (999 PHP → 99900)
        expect(mockTransactionClient.payment.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ xenditInvoiceId: 'cycle_1', amount: 99900, status: 'succeeded' }),
          }),
        );
        // period advanced exactly one month from the prior end (anchor),
        // computed the same way the implementation does (tz-independent).
        const updateArgs = (mockTransactionClient.subscription.update as jest.Mock).mock.calls[0][0];
        const priorEnd = new Date('2026-07-01T00:00:00Z');
        expect(updateArgs.data.currentPeriodStart).toEqual(priorEnd);
        const expectedEnd = new Date(priorEnd);
        expectedEnd.setMonth(expectedEnd.getMonth() + 1);
        expect(updateArgs.data.currentPeriodEnd).toEqual(expectedEnd);
        expect(usageQuotaService.resetQuotasForBillingCycle).toHaveBeenCalledWith('org-1');
      });

      it('first cycle (currentPeriodEnd null after activation) sets end to now + one period exactly once', async () => {
        // After the double-advance fix, activation leaves currentPeriodEnd null.
        (prisma.subscription.findFirst as jest.Mock).mockResolvedValue({
          ...activeSub,
          currentPeriodEnd: null,
        });
        (prisma.payment.findUnique as jest.Mock).mockResolvedValue(null);

        const before = new Date();
        await service.handleCycleSucceeded({
          id: 'cycle_first',
          recurring_plan_id: 'repl_1',
          amount: 999,
          currency: 'PHP',
        });
        const after = new Date();

        expect(mockTransactionClient.payment.create).toHaveBeenCalledTimes(1);
        const updateArgs = (mockTransactionClient.subscription.update as jest.Mock).mock.calls[0][0];
        const start: Date = updateArgs.data.currentPeriodStart;
        const end: Date = updateArgs.data.currentPeriodEnd;
        // Period anchored on "now" (fallback), not left null, and advanced by
        // exactly ONE month — not two.
        expect(start.getTime()).toBeGreaterThanOrEqual(before.getTime());
        expect(start.getTime()).toBeLessThanOrEqual(after.getTime());
        const expectedEnd = new Date(start);
        expectedEnd.setMonth(expectedEnd.getMonth() + 1);
        // Within a small tolerance: anchor and start are separate `new Date()`
        // reads a few ms apart when the prior end was null.
        expect(Math.abs(end.getTime() - expectedEnd.getTime())).toBeLessThan(1000);
      });

      it('is idempotent on replay — already-recorded cycle does NOT advance the period (no double-charge)', async () => {
        (prisma.subscription.findFirst as jest.Mock).mockResolvedValue(activeSub);
        (prisma.payment.findUnique as jest.Mock).mockResolvedValue({ id: 'pay-existing' });

        await service.handleCycleSucceeded({ id: 'cycle_1', recurring_plan_id: 'repl_1', amount: 999 });

        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(usageQuotaService.resetQuotasForBillingCycle).not.toHaveBeenCalled();
      });

      it('recovers a past_due subscription to active via RENEW', async () => {
        (prisma.subscription.findFirst as jest.Mock).mockResolvedValue({
          ...activeSub,
          status: 'past_due',
        });
        (prisma.payment.findUnique as jest.Mock).mockResolvedValue(null);

        await service.handleCycleSucceeded({ id: 'cycle_2', recurring_plan_id: 'repl_1', amount: 999 });

        expect(lifecycleService.executeTransition).toHaveBeenCalledWith(
          expect.objectContaining({ subscriptionId: 'sub-1', action: SubscriptionAction.RENEW }),
        );
      });
    });

    describe('handleCycleFailed', () => {
      it('moves an active subscription to past_due via PAYMENT_FAILED', async () => {
        (prisma.subscription.findFirst as jest.Mock).mockResolvedValue(activeSub);

        await service.handleCycleFailed({ id: 'cycle_3', recurring_plan_id: 'repl_1' });

        expect(lifecycleService.executeTransition).toHaveBeenCalledWith(
          expect.objectContaining({ subscriptionId: 'sub-1', action: SubscriptionAction.PAYMENT_FAILED }),
        );
      });

      it('enqueues the payment-failed email with amount, retry date and grace note', async () => {
        (prisma.subscription.findFirst as jest.Mock).mockResolvedValue(activeSub);
        (prisma.organization.findUnique as jest.Mock).mockResolvedValue({
          id: 'org-1',
          billingOwner: { email: 'owner@example.com', fullName: 'Owner' },
        });

        await service.handleCycleFailed({ id: 'cycle_3', recurring_plan_id: 'repl_1', amount: 999 });

        expect(notificationsService.sendPaymentFailed).toHaveBeenCalledWith(
          expect.objectContaining({
            email: 'owner@example.com',
            amount: 'PHP 999.00',
            retryDate: expect.any(String),
            graceNote: expect.stringContaining('grace period'),
          }),
        );
      });

      it('never fails the webhook when the failed-cycle email cannot be enqueued', async () => {
        (prisma.subscription.findFirst as jest.Mock).mockResolvedValue(activeSub);
        (prisma.organization.findUnique as jest.Mock).mockResolvedValue({
          id: 'org-1',
          billingOwner: { email: 'owner@example.com', fullName: 'Owner' },
        });
        notificationsService.sendPaymentFailed.mockRejectedValue(new Error('smtp down'));

        await expect(
          service.handleCycleFailed({ id: 'cycle_3', recurring_plan_id: 'repl_1', amount: 999 }),
        ).resolves.toBeUndefined();
      });
    });

    describe('handleCycleSucceeded — recurring receipt email', () => {
      const billingOwnerOrg = {
        id: 'org-1',
        billingOwner: { email: 'owner@example.com', fullName: 'Owner' },
      };

      beforeEach(() => {
        (prisma.subscription.findFirst as jest.Mock).mockResolvedValue(activeSub);
        (prisma.payment.findUnique as jest.Mock).mockResolvedValue(null);
        (prisma.organization.findUnique as jest.Mock).mockResolvedValue(billingOwnerOrg);
        (prisma.paymentMethod.findFirst as jest.Mock).mockResolvedValue({
          type: 'card',
          brand: 'Visa',
          last4: '4242',
        });
      });

      it('creates a paid Invoice row covering the new period', async () => {
        await service.handleCycleSucceeded({
          id: 'cycle_1',
          recurring_plan_id: 'repl_1',
          amount: 999,
          currency: 'PHP',
        });

        const priorEnd = new Date('2026-07-01T00:00:00Z');
        const expectedEnd = new Date(priorEnd);
        expectedEnd.setMonth(expectedEnd.getMonth() + 1);
        expect(mockTransactionClient.invoice.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              status: 'paid',
              amount: 99900,
              paymentId: 'pay-cycle-1',
              invoiceNumber: expect.stringMatching(/^INV-/),
              billingPeriodStart: priorEnd,
              billingPeriodEnd: expectedEnd,
            }),
          }),
        );
      });

      it('enqueues the receipt with period covered, next billing date and instrument', async () => {
        await service.handleCycleSucceeded({
          id: 'cycle_1',
          recurring_plan_id: 'repl_1',
          amount: 999,
          currency: 'PHP',
        });

        expect(notificationsService.sendPaymentReceipt).toHaveBeenCalledWith(
          expect.objectContaining({
            email: 'owner@example.com',
            amount: '999.00',
            currency: 'PHP',
            paymentMethod: 'Visa •••• 4242',
            invoiceNumber: expect.stringMatching(/^INV-/),
            planName: 'pro',
            billingPeriodLabel: expect.stringContaining('–'),
            nextBillingDate: expect.any(String),
          }),
        );
      });

      it('never fails the webhook when the receipt email cannot be enqueued', async () => {
        notificationsService.sendPaymentReceipt.mockRejectedValue(new Error('smtp down'));

        await expect(
          service.handleCycleSucceeded({ id: 'cycle_1', recurring_plan_id: 'repl_1', amount: 999 }),
        ).resolves.toBeUndefined();

        // The money-critical work still happened.
        expect(mockTransactionClient.payment.create).toHaveBeenCalledTimes(1);
      });
    });

    describe('renewal reminder scheduling (T-3d)', () => {
      const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

      it('handleSubscriptionActivated schedules a reminder ~3 days before the estimated period end', async () => {
        (prisma.subscription.findFirst as jest.Mock).mockResolvedValue(null);
        (prisma.subscription.findUnique as jest.Mock).mockResolvedValue(provisioningSub);

        const before = new Date();
        await service.handleSubscriptionActivated({
          id: 'repl_1',
          recurring_plan_id: 'repl_1',
          reference_id: 'sub-1',
          status: 'ACTIVE',
        });

        expect(prisma.subscriptionLifecycleEvent.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              subscriptionId: 'sub-1',
              organizationId: 'org-1',
              eventType: 'renewal_reminder',
              status: 'pending',
            }),
          }),
        );
        // Estimated period end = now + 1 month; reminder at end − 3d.
        const createArgs = (prisma.subscriptionLifecycleEvent.create as jest.Mock).mock.calls[0][0];
        const expectedEnd = new Date(before);
        expectedEnd.setMonth(expectedEnd.getMonth() + 1);
        const expectedAt = expectedEnd.getTime() - THREE_DAYS_MS;
        expect(Math.abs(createArgs.data.scheduledAt.getTime() - expectedAt)).toBeLessThan(5000);
      });

      it('handleCycleSucceeded re-schedules: cancels the pending reminder and creates one at newPeriodEnd − 3d', async () => {
        (prisma.subscription.findFirst as jest.Mock).mockResolvedValue(activeSub);
        (prisma.payment.findUnique as jest.Mock).mockResolvedValue(null);

        await service.handleCycleSucceeded({
          id: 'cycle_1',
          recurring_plan_id: 'repl_1',
          amount: 999,
          currency: 'PHP',
        });

        // Prior pending reminders are cancelled (one pending reminder per sub).
        expect(prisma.subscriptionLifecycleEvent.updateMany).toHaveBeenCalledWith({
          where: { subscriptionId: 'sub-1', eventType: 'renewal_reminder', status: 'pending' },
          data: { status: 'cancelled' },
        });

        // New reminder at exactly newPeriodEnd − 3 days, period stamped in metadata.
        const priorEnd = new Date('2026-07-01T00:00:00Z');
        const newEnd = new Date(priorEnd);
        newEnd.setMonth(newEnd.getMonth() + 1);
        expect(prisma.subscriptionLifecycleEvent.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            subscriptionId: 'sub-1',
            eventType: 'renewal_reminder',
            status: 'pending',
            scheduledAt: new Date(newEnd.getTime() - THREE_DAYS_MS),
            metadataJson: { periodEnd: newEnd.toISOString() },
          }),
        });
      });

      it('does NOT schedule a reminder when cancelAtPeriodEnd is set (no charge will occur)', async () => {
        (prisma.subscription.findFirst as jest.Mock).mockResolvedValue({
          ...activeSub,
          cancelAtPeriodEnd: true,
        });
        (prisma.payment.findUnique as jest.Mock).mockResolvedValue(null);

        await service.handleCycleSucceeded({ id: 'cycle_1', recurring_plan_id: 'repl_1', amount: 999 });

        expect(prisma.subscriptionLifecycleEvent.create).not.toHaveBeenCalled();
      });

      it('cancelSubscription cancels any pending renewal reminder', async () => {
        subscriptionsService.getActiveSubscription.mockResolvedValue(activeSub as never);
        (prisma.organization.findUnique as jest.Mock).mockResolvedValue(null);

        await service.cancelSubscription('org-1', 'user-1', true);

        expect(prisma.subscriptionLifecycleEvent.updateMany).toHaveBeenCalledWith({
          where: { subscriptionId: 'sub-1', eventType: 'renewal_reminder', status: 'pending' },
          data: { status: 'cancelled' },
        });
      });

      it('handlePlanDeactivated cancels any pending renewal reminder', async () => {
        (prisma.subscription.findFirst as jest.Mock).mockResolvedValue(activeSub);

        await service.handlePlanDeactivated({ id: 'repl_1' });

        expect(prisma.subscriptionLifecycleEvent.updateMany).toHaveBeenCalledWith({
          where: { subscriptionId: 'sub-1', eventType: 'renewal_reminder', status: 'pending' },
          data: { status: 'cancelled' },
        });
      });
    });

    describe('handlePlanDeactivated', () => {
      it('cancels immediately and creates the free fallback', async () => {
        (prisma.subscription.findFirst as jest.Mock).mockResolvedValue(activeSub);

        await service.handlePlanDeactivated({ id: 'repl_1' });

        expect(lifecycleService.executeTransition).toHaveBeenCalledWith(
          expect.objectContaining({ subscriptionId: 'sub-1', action: SubscriptionAction.CANCEL_IMMEDIATELY }),
        );
        expect(prisma.subscription.create).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ planCode: 'free' }) }),
        );
        expect(entitlementService.invalidateEntitlementCache).toHaveBeenCalledWith('org-1');
      });
    });

    it('cancelSubscription deactivates the Xendit plan in addition to the internal transition', async () => {
      subscriptionsService.getActiveSubscription.mockResolvedValue(activeSub as never);
      (prisma.organization.findUnique as jest.Mock).mockResolvedValue(null);

      await service.cancelSubscription('org-1', 'user-1', false);

      expect(xenditService.cancelSubscription).toHaveBeenCalledWith('repl_1');
      expect(lifecycleService.executeTransition).toHaveBeenCalledWith(
        expect.objectContaining({ action: SubscriptionAction.CANCEL_IMMEDIATELY }),
      );
    });
  });

  // ---- handleRefundSucceeded ----

  describe('handleRefundSucceeded', () => {
    /** A payment funding the org's current active subscription. */
    const refundablePayment = {
      ...mockPayment,
      id: 'pay-refund',
      amount: 99900, // centavos
      status: 'succeeded',
      subscriptionId: 'sub-1',
      refundId: null,
      refundedAt: null,
      refundedAmount: null,
      refundReason: null,
    };

    /** refund.succeeded payload `data` — amount is WHOLE PHP (999.00). */
    const fullRefundData = {
      id: 'refund_abc',
      invoice_id: 'inv_test_123',
      amount: 999,
      currency: 'PHP',
      status: 'SUCCEEDED',
      reason: 'DUPLICATE',
    };

    beforeEach(() => {
      (prisma.$transaction as jest.Mock).mockImplementation(
        async (cb: (tx: unknown) => Promise<void>) => {
          await cb(mockTransactionClient);
        },
      );
      subscriptionsService.getDefaultEntitlements.mockReturnValue({} as never);
      (prisma.subscription.create as jest.Mock).mockResolvedValue({ id: 'sub-free' });
    });

    it('full refund of the current active subscription cancels it and drops to free', async () => {
      (prisma.payment.findUnique as jest.Mock).mockResolvedValue(refundablePayment);
      subscriptionsService.getActiveSubscription.mockResolvedValue({
        id: 'sub-1',
        organizationId: 'org-1',
      } as never);

      await service.handleRefundSucceeded(fullRefundData);

      // payment marked refunded with centavos-converted amount (999 PHP → 99900)
      expect(mockTransactionClient.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pay-refund' },
          data: expect.objectContaining({
            status: 'refunded',
            refundedAmount: 99900,
            refundId: 'refund_abc',
            refundReason: 'DUPLICATE',
          }),
        }),
      );
      // subscription cancelled immediately
      expect(lifecycleService.executeTransition).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriptionId: 'sub-1',
          action: SubscriptionAction.CANCEL_IMMEDIATELY,
          actorType: 'system',
          metadata: expect.objectContaining({ reason: 'refund', refundId: 'refund_abc' }),
        }),
      );
      // free fallback created + cache invalidated
      expect(prisma.subscription.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ planCode: 'free' }) }),
      );
      expect(entitlementService.invalidateEntitlementCache).toHaveBeenCalledWith('org-1');
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'billing.payment_refunded' }),
      );
    });

    it('partial refund records only — no entitlement change', async () => {
      (prisma.payment.findUnique as jest.Mock).mockResolvedValue(refundablePayment);

      await service.handleRefundSucceeded({ ...fullRefundData, amount: 500 }); // 500 PHP < 999

      expect(mockTransactionClient.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'refunded', refundedAmount: 50000 }),
        }),
      );
      expect(lifecycleService.executeTransition).not.toHaveBeenCalled();
      expect(prisma.subscription.create).not.toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'billing.payment_refunded',
          metadata: expect.objectContaining({ fullRefund: false }),
        }),
      );
    });

    it('is idempotent on replay of an already-refunded payment', async () => {
      (prisma.payment.findUnique as jest.Mock).mockResolvedValue({
        ...refundablePayment,
        status: 'refunded',
        refundId: 'refund_abc',
      });

      await service.handleRefundSucceeded(fullRefundData);

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(lifecycleService.executeTransition).not.toHaveBeenCalled();
    });

    it('returns gracefully without throwing for an unknown invoice_id', async () => {
      (prisma.payment.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.handleRefundSucceeded({ ...fullRefundData, invoice_id: 'inv_unknown' }),
      ).resolves.toBeUndefined();

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('does not cancel when the refunded payment is not the current active subscription', async () => {
      (prisma.payment.findUnique as jest.Mock).mockResolvedValue(refundablePayment);
      // Org's current active sub is a different one (e.g. already upgraded).
      subscriptionsService.getActiveSubscription.mockResolvedValue({
        id: 'sub-other',
        organizationId: 'org-1',
      } as never);

      await service.handleRefundSucceeded(fullRefundData);

      expect(lifecycleService.executeTransition).not.toHaveBeenCalled();
      expect(prisma.subscription.create).not.toHaveBeenCalled();
      // still recorded the refund
      expect(mockTransactionClient.payment.update).toHaveBeenCalled();
    });
  });
});
