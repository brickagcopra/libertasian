import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PricingEngineService } from '../pricing/pricing-engine.service';
import { CouponService } from '../coupons/coupon.service';
import { PromotionService } from '../promotions/promotion.service';
import { EntitlementService } from '../subscriptions/entitlement.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SubscriptionLifecycleService } from '../subscriptions/subscription-lifecycle.service';
import { SubscriptionAction } from '../subscriptions/subscription-state-machine';
import { BillingService } from './billing.service';
import { XenditService } from './xendit.service';

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

  const mockTransactionClient = {
    payment: { update: jest.fn() },
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
            },
            invoice: {
              findMany: jest.fn(),
              findFirst: jest.fn(),
            },
            subscription: {
              update: jest.fn(),
              updateMany: jest.fn(),
              create: jest.fn(),
            },
            organization: {
              findUnique: jest.fn(),
            },
            checkoutPriceSnapshot: {
              create: jest.fn(),
              findUnique: jest.fn(),
            },
            $transaction: jest.fn(),
          },
        },
        {
          provide: XenditService,
          useValue: {
            createInvoice: jest.fn(),
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

    it('should create checkout session for new subscription', async () => {
      subscriptionsService.getActiveSubscription.mockResolvedValue(null as never);
      pricingEngine.calculatePriceBreakdown.mockResolvedValue({ ...mockBreakdown } as never);
      xenditService.createInvoice.mockResolvedValue({
        id: 'inv_test_123',
        external_id: 'ext-uuid-123',
        invoice_url: 'https://checkout.xendit.co/inv_test_123',
        status: 'PENDING',
        amount: 999,
        currency: 'PHP',
        description: 'LIBERTASIAN Pro Plan — Monthly',
      });
      (prisma.payment.create as jest.Mock).mockResolvedValue(mockPayment);
      (prisma.checkoutPriceSnapshot.create as jest.Mock).mockResolvedValue({ id: 'snap-1' });

      const result = await service.createCheckout('org-1', dto, 'user-1');

      expect(result).toHaveProperty('checkoutUrl');
      expect(result).toHaveProperty('checkoutSessionId');
      expect(result).toHaveProperty('paymentId');
      expect(pricingEngine.calculatePriceBreakdown).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 'org-1',
          userId: 'user-1',
          planCode: 'pro',
          billingPeriod: 'monthly',
        }),
      );
      expect(xenditService.createInvoice).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 999,
          currency: 'PHP',
          description: 'LIBERTASIAN Pro Plan — Monthly',
        }),
      );
      expect(prisma.checkoutPriceSnapshot.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            paymentId: 'pay-1',
            planCode: 'pro',
            basePriceAmount: 99900,
            finalAmount: 99900,
          }),
        }),
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'billing.checkout_created',
          entityType: 'payment',
        }),
      );
    });

    it('should create checkout for annual billing', async () => {
      const annualBreakdown = {
        ...mockBreakdown,
        basePriceAmount: 999000,
        finalAmount: 999000,
        billingPeriod: 'annual',
        lineItems: [
          {
            type: 'base_price',
            label: 'Pro Plan — Annual',
            amount: 999000,
            referenceId: null,
            referenceCode: 'pro',
            metadata: { source: 'hardcoded' },
          },
        ],
      };
      pricingEngine.calculatePriceBreakdown.mockResolvedValue(annualBreakdown as never);
      subscriptionsService.getActiveSubscription.mockResolvedValue(null as never);
      xenditService.createInvoice.mockResolvedValue({
        id: 'inv_annual',
        external_id: 'ext-annual',
        invoice_url: 'https://checkout.xendit.co/inv_annual',
        status: 'PENDING',
        amount: 9990,
        currency: 'PHP',
        description: 'LIBERTASIAN Pro Plan — Annual',
      });
      (prisma.payment.create as jest.Mock).mockResolvedValue({ ...mockPayment, id: 'pay-annual' });
      (prisma.checkoutPriceSnapshot.create as jest.Mock).mockResolvedValue({ id: 'snap-2' });

      await service.createCheckout('org-1', { ...dto, billingPeriod: 'annual' }, 'user-1');

      expect(xenditService.createInvoice).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 9990 }),
      );
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
      xenditService.createInvoice.mockResolvedValue({
        id: 'inv_coupon',
        external_id: 'ext-coupon',
        invoice_url: 'https://checkout.xendit.co/inv_coupon',
        status: 'PENDING',
        amount: 799,
        currency: 'PHP',
        description: 'LIBERTASIAN Pro Plan — Monthly',
      });
      (prisma.payment.create as jest.Mock).mockResolvedValue({
        ...mockPayment,
        id: 'pay-coupon',
        amount: 79920,
      });
      (prisma.checkoutPriceSnapshot.create as jest.Mock).mockResolvedValue({ id: 'snap-coupon' });

      await service.createCheckout('org-1', dto, 'user-1');

      expect(couponService.reserveCoupon).toHaveBeenCalledWith(
        'SAVE20',
        'org-1',
        'user-1',
        'pro',
        'monthly',
      );
      expect(xenditService.createInvoice).toHaveBeenCalledWith(
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

    it('should include couponRedemptionId in payment metadata', async () => {
      pricingEngine.calculatePriceBreakdown.mockResolvedValue({ ...breakdownWithCoupon } as never);
      couponService.reserveCoupon.mockResolvedValue({ id: 'redemption-2' } as never);
      subscriptionsService.getActiveSubscription.mockResolvedValue(null as never);
      xenditService.createInvoice.mockResolvedValue({
        id: 'inv_meta',
        external_id: 'ext-meta',
        invoice_url: 'https://checkout.xendit.co/inv_meta',
        status: 'PENDING',
        amount: 799,
        currency: 'PHP',
        description: 'LIBERTASIAN Pro Plan — Monthly',
      });
      (prisma.payment.create as jest.Mock).mockResolvedValue({
        ...mockPayment,
        id: 'pay-meta',
      });
      (prisma.checkoutPriceSnapshot.create as jest.Mock).mockResolvedValue({ id: 'snap-meta' });

      await service.createCheckout('org-1', dto, 'user-1');

      expect(prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            metadata: expect.objectContaining({
              couponRedemptionId: 'redemption-2',
            }),
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

  describe('createCheckout — userId in payment metadata', () => {
    const dto = {
      planCode: 'pro',
      billingPeriod: 'monthly' as const,
      successUrl: 'https://app.com/success',
      cancelUrl: 'https://app.com/cancel',
    };

    it('should include userId in payment metadata', async () => {
      pricingEngine.calculatePriceBreakdown.mockResolvedValue({ ...mockBreakdown } as never);
      subscriptionsService.getActiveSubscription.mockResolvedValue(null as never);
      xenditService.createInvoice.mockResolvedValue({
        id: 'inv_meta_user',
        external_id: 'ext-meta-user',
        invoice_url: 'https://checkout.xendit.co/inv_meta_user',
        status: 'PENDING',
        amount: 999,
        currency: 'PHP',
        description: 'LIBERTASIAN Pro Plan — Monthly',
      });
      (prisma.payment.create as jest.Mock).mockResolvedValue(mockPayment);
      (prisma.checkoutPriceSnapshot.create as jest.Mock).mockResolvedValue({ id: 'snap-1' });

      await service.createCheckout('org-1', dto, 'user-1');

      expect(prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            metadata: expect.objectContaining({
              userId: 'user-1',
            }),
          }),
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

    it('should use DB price when pricing engine returns database source', async () => {
      const dbBreakdown = {
        ...mockBreakdown,
        basePriceAmount: 89900,
        finalAmount: 89900,
        planName: 'Professional',
        planId: 'plan-db-1',
        lineItems: [
          {
            type: 'base_price',
            label: 'Professional Plan — Monthly',
            amount: 89900,
            referenceId: 'plan-db-1',
            referenceCode: 'pro',
            metadata: { source: 'database' },
          },
        ],
      };
      pricingEngine.calculatePriceBreakdown.mockResolvedValue(dbBreakdown as never);
      subscriptionsService.getActiveSubscription.mockResolvedValue(null as never);
      xenditService.createInvoice.mockResolvedValue({
        id: 'inv_db_1',
        external_id: 'ext-db-1',
        invoice_url: 'https://checkout.xendit.co/inv_db_1',
        status: 'PENDING',
        amount: 899,
        currency: 'PHP',
        description: 'LIBERTASIAN Professional Plan — Monthly',
      });
      (prisma.payment.create as jest.Mock).mockResolvedValue({
        ...mockPayment,
        amount: 89900,
      });
      (prisma.checkoutPriceSnapshot.create as jest.Mock).mockResolvedValue({ id: 'snap-db' });

      await service.createCheckout('org-1', dto, 'user-1');

      expect(xenditService.createInvoice).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 899,
          description: 'LIBERTASIAN Professional Plan — Monthly',
        }),
      );
    });

    it('should include planId in metadata when pricing engine returns planId', async () => {
      const dbBreakdown = {
        ...mockBreakdown,
        planId: 'plan-db-1',
        planName: 'Professional',
      };
      pricingEngine.calculatePriceBreakdown.mockResolvedValue(dbBreakdown as never);
      subscriptionsService.getActiveSubscription.mockResolvedValue(null as never);
      xenditService.createInvoice.mockResolvedValue({
        id: 'inv_db_3',
        external_id: 'ext-db-3',
        invoice_url: 'https://checkout.xendit.co/inv_db_3',
        status: 'PENDING',
        amount: 999,
        currency: 'PHP',
        description: 'LIBERTASIAN Professional Plan — Monthly',
      });
      (prisma.payment.create as jest.Mock).mockResolvedValue(mockPayment);
      (prisma.checkoutPriceSnapshot.create as jest.Mock).mockResolvedValue({ id: 'snap-db3' });

      await service.createCheckout('org-1', dto, 'user-1');

      expect(xenditService.createInvoice).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            planId: 'plan-db-1',
          }),
        }),
      );
    });

    it('should use hardcoded pricing when pricing engine returns hardcoded source', async () => {
      pricingEngine.calculatePriceBreakdown.mockResolvedValue({ ...mockBreakdown } as never);
      subscriptionsService.getActiveSubscription.mockResolvedValue(null as never);
      xenditService.createInvoice.mockResolvedValue({
        id: 'inv_hardcoded',
        external_id: 'ext-hardcoded',
        invoice_url: 'https://checkout.xendit.co/inv_hardcoded',
        status: 'PENDING',
        amount: 999,
        currency: 'PHP',
        description: 'LIBERTASIAN Pro Plan — Monthly',
      });
      (prisma.payment.create as jest.Mock).mockResolvedValue(mockPayment);
      (prisma.checkoutPriceSnapshot.create as jest.Mock).mockResolvedValue({ id: 'snap-hc' });

      await service.createCheckout('org-1', dto, 'user-1');

      expect(xenditService.createInvoice).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 999,
          description: 'LIBERTASIAN Pro Plan — Monthly',
        }),
      );
    });

    it('should create CheckoutPriceSnapshot with full breakdown data', async () => {
      const fullBreakdown = {
        ...mockBreakdown,
        couponId: 'coupon-1',
        couponCode: 'SAVE10',
        couponDiscountAmount: 9990,
        totalDiscountAmount: 9990,
        finalAmount: 89910,
        lineItems: [
          {
            type: 'base_price',
            label: 'Pro Plan — Monthly',
            amount: 99900,
            referenceId: null,
            referenceCode: 'pro',
            metadata: { source: 'hardcoded' },
          },
          {
            type: 'coupon_discount',
            label: 'Coupon: SAVE10',
            amount: -9990,
            referenceId: 'coupon-1',
            referenceCode: 'SAVE10',
            metadata: { discountType: 'percentage', discountValue: 10 },
          },
        ],
      };
      pricingEngine.calculatePriceBreakdown.mockResolvedValue(fullBreakdown as never);
      couponService.reserveCoupon.mockResolvedValue({ id: 'redemption-snap' } as never);
      subscriptionsService.getActiveSubscription.mockResolvedValue(null as never);
      xenditService.createInvoice.mockResolvedValue({
        id: 'inv_snap',
        external_id: 'ext-snap',
        invoice_url: 'https://checkout.xendit.co/inv_snap',
        status: 'PENDING',
        amount: 899,
        currency: 'PHP',
        description: 'LIBERTASIAN Pro Plan — Monthly',
      });
      (prisma.payment.create as jest.Mock).mockResolvedValue({
        ...mockPayment,
        id: 'pay-snap',
      });
      (prisma.checkoutPriceSnapshot.create as jest.Mock).mockResolvedValue({ id: 'snap-full' });

      await service.createCheckout(
        'org-1',
        { ...dto, couponCode: 'SAVE10' },
        'user-1',
      );

      expect(prisma.checkoutPriceSnapshot.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            paymentId: 'pay-snap',
            organizationId: 'org-1',
            planCode: 'pro',
            basePriceAmount: 99900,
            couponId: 'coupon-1',
            couponCode: 'SAVE10',
            couponDiscountAmount: 9990,
            totalDiscountAmount: 9990,
            finalAmount: 89910,
            currency: 'PHP',
            discountsStacked: false,
            priceSource: 'hardcoded',
          }),
        }),
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
