import { randomUUID } from 'crypto';

import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CouponService } from '../coupons/coupon.service';
import { PricingEngineService } from '../pricing/pricing-engine.service';
import { PromotionService } from '../promotions/promotion.service';
import { EntitlementService } from '../subscriptions/entitlement.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { SubscriptionLifecycleService } from '../subscriptions/subscription-lifecycle.service';
import { SubscriptionAction, SubscriptionState } from '../subscriptions/subscription-state-machine';
import { NotificationsService } from '../notifications/notifications.service';
import { XenditService } from './xendit.service';
import type { CreateCheckoutDto, PreviewCheckoutDto } from './dto';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly xenditService: XenditService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly auditService: AuditService,
    private readonly pricingEngine: PricingEngineService,
    private readonly couponService: CouponService,
    private readonly promotionService: PromotionService,
    private readonly lifecycleService: SubscriptionLifecycleService,
    private readonly notificationsService: NotificationsService,
    private readonly entitlementService: EntitlementService,
  ) {}

  // ---- Subscription ----

  async getSubscription(organizationId: string) {
    const sub = await this.subscriptionsService.getActiveSubscription(organizationId);
    if (!sub) {
      throw new NotFoundException('No active subscription found');
    }
    return sub;
  }

  // ---- Checkout Preview ----

  async previewCheckout(
    organizationId: string,
    dto: PreviewCheckoutDto,
    userId: string,
  ) {
    // Calculate full price breakdown without creating any records
    const breakdown = await this.pricingEngine.calculatePriceBreakdown({
      organizationId,
      userId,
      planCode: dto.planCode,
      billingPeriod: dto.billingPeriod,
      couponCode: dto.couponCode,
      promotionId: dto.promotionId,
    });

    // Check if this would be an upgrade or new subscription
    const currentSub = await this.subscriptionsService.getActiveSubscription(
      organizationId,
    );
    const isUpgrade = currentSub
      ? this.isUpgrade(currentSub.planCode, dto.planCode)
      : false;
    const isDowngrade = currentSub
      ? !this.isUpgrade(currentSub.planCode, dto.planCode) &&
        currentSub.planCode !== dto.planCode
      : false;

    return {
      ...breakdown,
      currentPlanCode: currentSub?.planCode ?? 'free',
      isUpgrade,
      isDowngrade,
      isNewSubscription: !currentSub || currentSub.planCode === 'free',
    };
  }

  // ---- Checkout ----

  async createCheckout(
    organizationId: string,
    dto: CreateCheckoutDto,
    userId: string,
  ) {
    // 1. Calculate full price breakdown (base + coupon + promotion)
    const breakdown = await this.pricingEngine.calculatePriceBreakdown({
      organizationId,
      userId,
      planCode: dto.planCode,
      billingPeriod: dto.billingPeriod,
      couponCode: dto.couponCode,
      promotionId: dto.promotionId,
    });

    // Prevent downgrade via checkout — check current plan
    const currentSub = await this.subscriptionsService.getActiveSubscription(
      organizationId,
    );
    if (currentSub && !this.isUpgrade(currentSub.planCode, dto.planCode)) {
      throw new BadRequestException(
        'Cannot downgrade via checkout. Contact support for plan changes.',
      );
    }

    // 2. Reserve coupon if applied
    let couponRedemptionId: string | null = null;
    if (breakdown.couponCode) {
      const redemption = await this.couponService.reserveCoupon(
        breakdown.couponCode,
        organizationId,
        userId,
        dto.planCode,
        dto.billingPeriod,
      );
      couponRedemptionId = redemption.id;
    }

    const periodLabel = dto.billingPeriod === 'annual' ? 'Annual' : 'Monthly';
    const description = `LIBERTASIAN ${breakdown.planName} Plan — ${periodLabel}`;

    // 3. Create Xendit invoice with final amount
    // Xendit expects whole currency units (PHP), our DB stores centavos → divide by 100
    const externalId = randomUUID();
    const invoice = await this.xenditService.createInvoice({
      amount: Math.round(breakdown.finalAmount / 100),
      currency: breakdown.currency,
      description,
      externalId,
      metadata: {
        organizationId,
        userId,
        planCode: dto.planCode,
        billingPeriod: dto.billingPeriod,
        ...(breakdown.planId && { planId: breakdown.planId }),
        ...(couponRedemptionId && { couponRedemptionId }),
        ...(breakdown.promotionId && { promotionId: breakdown.promotionId }),
      },
      successRedirectUrl: dto.successUrl,
      failureRedirectUrl: dto.cancelUrl,
    });

    // 4. Create local Payment record
    const payment = await this.prisma.payment.create({
      data: {
        organizationId,
        xenditInvoiceId: invoice.id,
        amount: breakdown.finalAmount,
        currency: breakdown.currency,
        status: 'pending',
        paymentType: currentSub ? 'upgrade' : 'subscription',
        description,
        metadata: {
          planCode: dto.planCode,
          billingPeriod: dto.billingPeriod,
          xenditInvoiceId: invoice.id,
          externalId,
          userId,
          ...(breakdown.planId && { planId: breakdown.planId }),
          ...(couponRedemptionId && { couponRedemptionId }),
          ...(breakdown.promotionId && { promotionId: breakdown.promotionId }),
        },
      },
    });

    // 5. Create CheckoutPriceSnapshot for audit trail
    await this.prisma.checkoutPriceSnapshot.create({
      data: {
        paymentId: payment.id,
        organizationId,
        planCode: breakdown.planCode,
        planId: breakdown.planId,
        planName: breakdown.planName,
        billingPeriod: breakdown.billingPeriod,
        basePriceAmount: breakdown.basePriceAmount,
        couponId: breakdown.couponId,
        couponCode: breakdown.couponCode,
        couponDiscountAmount: breakdown.couponDiscountAmount,
        promotionId: breakdown.promotionId,
        promotionDiscountAmount: breakdown.promotionDiscountAmount,
        totalDiscountAmount: breakdown.totalDiscountAmount,
        finalAmount: breakdown.finalAmount,
        currency: breakdown.currency,
        discountsStacked: breakdown.discountsStacked,
        priceSource: breakdown.lineItems[0]?.metadata?.['source'] === 'database' ? 'database' : 'hardcoded',
        lineItemsJson: breakdown.lineItems as unknown as Prisma.InputJsonValue,
      },
    });

    await this.auditService.log({
      organizationId,
      actorUserId: userId,
      actorType: 'user',
      action: 'billing.checkout_created',
      entityType: 'payment',
      entityId: payment.id,
      metadata: {
        planCode: dto.planCode,
        billingPeriod: dto.billingPeriod,
        finalAmount: breakdown.finalAmount,
        couponCode: breakdown.couponCode,
        promotionId: breakdown.promotionId,
      },
    });

    return {
      checkoutUrl: invoice.invoice_url,
      checkoutSessionId: invoice.id,
      paymentId: payment.id,
    };
  }

  // ---- Webhook Handlers ----

  async handlePaymentSuccess(xenditData: Record<string, unknown>) {
    const xenditInvoiceId = xenditData['id'] as string;

    // Find the corresponding payment record
    const payment = await this.prisma.payment.findUnique({
      where: { xenditInvoiceId },
    });

    if (!payment) {
      this.logger.warn(
        `Payment not found for Xendit invoice: ${xenditInvoiceId}`,
      );
      return;
    }

    if (payment.status === 'succeeded') {
      this.logger.log(`Payment already processed: ${payment.id}`);
      return; // Idempotent
    }

    const metadata = (payment.metadata ?? {}) as Record<string, string>;
    const planCode = metadata['planCode'] ?? 'pro';
    const billingPeriod = metadata['billingPeriod'] ?? 'monthly';
    const planId = metadata['planId'] ?? null;
    const couponRedemptionId = metadata['couponRedemptionId'] ?? null;
    const promotionId = metadata['promotionId'] ?? null;

    const now = new Date();
    const periodEnd = new Date(now);
    if (billingPeriod === 'annual') {
      periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    } else {
      periodEnd.setMonth(periodEnd.getMonth() + 1);
    }

    // Use a transaction for atomicity
    await this.prisma.$transaction(async (tx) => {
      // Mark payment as succeeded
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: 'succeeded', paidAt: now },
      });

      // Deactivate existing subscriptions
      await tx.subscription.updateMany({
        where: { organizationId: payment.organizationId, status: 'active' },
        data: { status: 'expired' },
      });

      // Create new active subscription
      const entitlements = this.subscriptionsService.getDefaultEntitlements(planCode);
      const subscription = await tx.subscription.create({
        data: {
          organizationId: payment.organizationId,
          planCode,
          ...(planId && { planId }),
          status: 'active',
          billingPeriod,
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          seats: this.getSeatsForPlan(planCode),
          entitlementsJson: entitlements as unknown as Prisma.InputJsonValue,
        },
      });

      // Update payment with subscription reference
      await tx.payment.update({
        where: { id: payment.id },
        data: { subscriptionId: subscription.id },
      });

      // Create invoice — use snapshot line items if available
      const invoiceNumber = await this.generateInvoiceNumber();
      const snapshot = await tx.checkoutPriceSnapshot.findUnique({
        where: { paymentId: payment.id },
      });

      const invoiceLineItems = snapshot
        ? this.buildInvoiceLineItems(snapshot)
        : [
            {
              description: payment.description,
              quantity: 1,
              unitAmount: payment.amount,
              totalAmount: payment.amount,
            },
          ];

      await tx.invoice.create({
        data: {
          organizationId: payment.organizationId,
          subscriptionId: subscription.id,
          paymentId: payment.id,
          invoiceNumber,
          amount: payment.amount,
          currency: payment.currency,
          status: 'paid',
          description: payment.description,
          lineItemsJson: invoiceLineItems as unknown as Prisma.InputJsonValue,
          billingPeriodStart: now,
          billingPeriodEnd: periodEnd,
          paidAt: now,
        },
      });

      // Transition the new subscription via state machine
      // (subscription was created as 'active' above, but we record the
      // lifecycle transition for audit trail / side effects)
      await tx.subscription.update({
        where: { id: subscription.id },
        data: { status: SubscriptionState.PROVISIONING },
      });
    });

    // Finalize coupon redemption if applicable
    if (couponRedemptionId) {
      try {
        const couponSnapshot = await this.prisma.checkoutPriceSnapshot.findUnique({
          where: { paymentId: payment.id },
          select: { couponDiscountAmount: true },
        });
        await this.couponService.finalizeCoupon(
          couponRedemptionId,
          payment.id, // subscriptionId will be linked via payment
          payment.id,
          couponSnapshot?.couponDiscountAmount ?? 0,
        );
      } catch (err) {
        this.logger.error(`Failed to finalize coupon redemption ${couponRedemptionId}`, err);
      }
    }

    // Execute the lifecycle transition outside the main transaction.
    // Find the newly created subscription to get its ID for the lifecycle call.
    const newSub = await this.prisma.subscription.findFirst({
      where: {
        organizationId: payment.organizationId,
        status: SubscriptionState.PROVISIONING,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (newSub) {
      await this.lifecycleService.executeTransition({
        subscriptionId: newSub.id,
        action: SubscriptionAction.ACTIVATE,
        actorType: 'system',
        metadata: { planCode, billingPeriod, paymentId: payment.id },
      });

      // Invalidate cached entitlements so the new plan limits take effect immediately
      await this.entitlementService.invalidateEntitlementCache(payment.organizationId);
    }

    // Record promotion redemption if applicable
    if (promotionId && newSub) {
      try {
        await this.promotionService.applyPromotion({
          promotionId,
          organizationId: payment.organizationId,
          userId: metadata['userId'] ?? '',
          planCode,
          billingPeriod,
          subscriptionId: newSub.id,
          paymentId: payment.id,
        });
      } catch (err) {
        this.logger.error(
          `Failed to record promotion redemption ${promotionId} for org ${payment.organizationId}`,
          err,
        );
      }
    }

    await this.auditService.log({
      organizationId: payment.organizationId,
      actorType: 'system',
      action: 'billing.payment_succeeded',
      entityType: 'payment',
      entityId: payment.id,
      metadata: { planCode, billingPeriod, amount: payment.amount },
    });

    this.logger.log(
      `Payment succeeded for org ${payment.organizationId}: ${planCode} (${billingPeriod})`,
    );

    // Send payment notification emails
    try {
      const org = await this.prisma.organization.findUnique({
        where: { id: payment.organizationId },
        include: { billingOwner: true },
      });
      if (org?.billingOwner) {
        const user = org.billingOwner;
        const amountFormatted = (payment.amount / 100).toFixed(2);
        const invoice = await this.prisma.invoice.findFirst({
          where: { subscriptionId: newSub?.id },
          orderBy: { createdAt: 'desc' },
        });

        await this.notificationsService.sendPaymentReceipt({
          email: user.email,
          userName: user.fullName ?? 'User',
          amount: amountFormatted,
          currency: payment.currency ?? 'PHP',
          paymentMethod: (metadata['paymentMethod'] as string) ?? 'Card',
          invoiceNumber: invoice?.invoiceNumber ?? payment.id,
          date: new Date().toLocaleDateString('en-PH'),
          planName: planCode,
        });

        if (newSub) {
          await this.notificationsService.sendSubscriptionConfirmation({
            email: user.email,
            userName: user.fullName ?? 'User',
            planName: planCode,
            billingPeriod: billingPeriod ?? 'monthly',
            features: [],
            nextBillingDate: newSub.currentPeriodEnd
              ? new Date(newSub.currentPeriodEnd).toLocaleDateString('en-PH')
              : 'N/A',
          });
        }
      }
    } catch (err) {
      this.logger.error(`Failed to send payment success notifications: ${err}`);
    }
  }

  async handlePaymentFailed(xenditData: Record<string, unknown>) {
    const xenditInvoiceId = xenditData['id'] as string;

    const payment = await this.prisma.payment.findUnique({
      where: { xenditInvoiceId },
    });

    if (!payment) {
      this.logger.warn(
        `Payment not found for failed Xendit invoice: ${xenditInvoiceId}`,
      );
      return;
    }

    if (payment.status === 'failed') {
      return; // Idempotent
    }

    if (payment.status === 'succeeded') {
      this.logger.warn(
        `Ignoring EXPIRED webhook for already-succeeded payment: ${payment.id}`,
      );
      return;
    }

    await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: 'failed',
        failedAt: new Date(),
        failureReason:
          (xenditData['failure_reason'] as string) ?? 'Payment failed',
      },
    });

    // Rollback coupon reservation if applicable
    const metadata = (payment.metadata ?? {}) as Record<string, string>;
    const couponRedemptionId = metadata['couponRedemptionId'] ?? null;
    if (couponRedemptionId) {
      try {
        await this.couponService.rollbackCoupon(couponRedemptionId);
      } catch (err) {
        this.logger.error(`Failed to rollback coupon redemption ${couponRedemptionId}`, err);
      }
    }

    // Transition active subscription to PAST_DUE via state machine
    if (payment.subscriptionId) {
      try {
        await this.lifecycleService.executeTransition({
          subscriptionId: payment.subscriptionId,
          action: SubscriptionAction.PAYMENT_FAILED,
          actorType: 'system',
          reason: 'Payment failed',
          metadata: { paymentId: payment.id },
        });
      } catch (err) {
        this.logger.warn(
          `Could not transition subscription ${payment.subscriptionId} on payment failure: ${err}`,
        );
      }
    }

    await this.auditService.log({
      organizationId: payment.organizationId,
      actorType: 'system',
      action: 'billing.payment_failed',
      entityType: 'payment',
      entityId: payment.id,
    });

    this.logger.warn(`Payment failed for org ${payment.organizationId}: ${payment.id}`);

    // Send payment failure notification
    try {
      const org = await this.prisma.organization.findUnique({
        where: { id: payment.organizationId },
        include: { billingOwner: true },
      });
      if (org?.billingOwner) {
        const user = org.billingOwner;
        const amountFormatted = `PHP ${(payment.amount / 100).toFixed(2)}`;
        const retryDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toLocaleDateString('en-PH');

        await this.notificationsService.sendPaymentFailed({
          email: user.email,
          userName: user.fullName ?? 'User',
          amount: amountFormatted,
          retryDate,
        });
      }
    } catch (err) {
      this.logger.error(`Failed to send payment failure notification: ${err}`);
    }
  }

  // ---- Cancel Subscription ----

  async cancelSubscription(
    organizationId: string,
    userId: string,
    cancelAtPeriodEnd: boolean,
  ) {
    const sub = await this.subscriptionsService.getActiveSubscription(
      organizationId,
    );
    if (!sub) {
      throw new NotFoundException('No active subscription to cancel');
    }

    if (sub.planCode === 'free') {
      throw new BadRequestException('Cannot cancel a free plan');
    }

    const action = cancelAtPeriodEnd
      ? SubscriptionAction.REQUEST_CANCEL
      : SubscriptionAction.CANCEL_IMMEDIATELY;

    await this.lifecycleService.executeTransition({
      subscriptionId: sub.id,
      action,
      actorUserId: userId,
      actorType: 'user',
      reason: cancelAtPeriodEnd ? 'User requested cancel at period end' : 'User requested immediate cancel',
      metadata: { previousPlan: sub.planCode },
    });

    // If immediate cancel, create free subscription fallback
    if (!cancelAtPeriodEnd) {
      const freeEntitlements = this.subscriptionsService.getDefaultEntitlements('free');
      await this.prisma.subscription.create({
        data: {
          organizationId,
          planCode: 'free',
          status: 'active',
          seats: 1,
          entitlementsJson: freeEntitlements as unknown as Prisma.InputJsonValue,
        },
      });
    }

    // Send cancellation notification email
    try {
      const org = await this.prisma.organization.findUnique({
        where: { id: organizationId },
        include: { billingOwner: true },
      });
      if (org?.billingOwner) {
        const user = org.billingOwner;
        await this.notificationsService.sendSubscriptionCancelled({
          email: user.email,
          userName: user.fullName ?? 'User',
          planName: sub.planCode,
          endDate: sub.currentPeriodEnd
            ? new Date(sub.currentPeriodEnd).toLocaleDateString('en-PH', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })
            : 'N/A',
          isImmediate: !cancelAtPeriodEnd,
        });
      }
    } catch (err) {
      this.logger.error(`Failed to send cancellation notification: ${err}`);
    }

    return {
      message: cancelAtPeriodEnd
        ? 'Subscription will be cancelled at end of billing period'
        : 'Subscription cancelled immediately',
      cancelAtPeriodEnd,
    };
  }

  // ---- Payment Methods ----

  async listPaymentMethods(organizationId: string) {
    return this.prisma.paymentMethod.findMany({
      where: { organizationId, isActive: true },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        type: true,
        brand: true,
        last4: true,
        expiryMonth: true,
        expiryYear: true,
        billingEmail: true,
        isDefault: true,
        isActive: true,
        createdAt: true,
      },
    });
  }

  async setDefaultPaymentMethod(
    organizationId: string,
    paymentMethodId: string,
    userId: string,
  ) {
    const pm = await this.prisma.paymentMethod.findFirst({
      where: { id: paymentMethodId, organizationId, isActive: true },
    });

    if (!pm) {
      throw new NotFoundException('Payment method not found');
    }

    await this.prisma.$transaction(async (tx) => {
      // Unset all defaults for this org
      await tx.paymentMethod.updateMany({
        where: { organizationId, isDefault: true },
        data: { isDefault: false },
      });
      // Set new default
      await tx.paymentMethod.update({
        where: { id: paymentMethodId },
        data: { isDefault: true },
      });
    });

    await this.auditService.log({
      organizationId,
      actorUserId: userId,
      actorType: 'user',
      action: 'billing.default_payment_method_set',
      entityType: 'payment_method',
      entityId: paymentMethodId,
    });

    return { message: 'Default payment method updated' };
  }

  async deletePaymentMethod(
    organizationId: string,
    paymentMethodId: string,
    userId: string,
  ) {
    const pm = await this.prisma.paymentMethod.findFirst({
      where: { id: paymentMethodId, organizationId, isActive: true },
    });

    if (!pm) {
      throw new NotFoundException('Payment method not found');
    }

    // Soft delete
    await this.prisma.paymentMethod.update({
      where: { id: paymentMethodId },
      data: { isActive: false },
    });

    await this.auditService.log({
      organizationId,
      actorUserId: userId,
      actorType: 'user',
      action: 'billing.payment_method_deleted',
      entityType: 'payment_method',
      entityId: paymentMethodId,
    });

    return { message: 'Payment method removed' };
  }

  // ---- Invoices ----

  async listInvoices(
    organizationId: string,
    cursor?: string,
    limit = 20,
  ) {
    const invoices = await this.prisma.invoice.findMany({
      where: { organizationId },
      take: limit + 1,
      ...(cursor && { skip: 1, cursor: { id: cursor } }),
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        invoiceNumber: true,
        amount: true,
        currency: true,
        status: true,
        description: true,
        lineItemsJson: true,
        billingPeriodStart: true,
        billingPeriodEnd: true,
        dueDate: true,
        paidAt: true,
        createdAt: true,
      },
    });

    const hasNext = invoices.length > limit;
    const items = hasNext ? invoices.slice(0, limit) : invoices;
    const lastItem = items[items.length - 1];
    const nextCursor = hasNext && lastItem ? lastItem.id : undefined;

    return {
      items,
      meta: { hasNext, nextCursor },
    };
  }

  async getInvoice(organizationId: string, invoiceId: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, organizationId },
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    return invoice;
  }

  // ---- Helpers ----

  private async generateInvoiceNumber(): Promise<string> {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');

    // Find last invoice this month
    const lastInvoice = await this.prisma.invoice.findFirst({
      where: {
        invoiceNumber: { startsWith: `INV-${yyyy}-${mm}` },
      },
      orderBy: { invoiceNumber: 'desc' },
    });

    let seq = 1;
    if (lastInvoice) {
      const parts = lastInvoice.invoiceNumber.split('-');
      const lastSeq = parseInt(parts[3] ?? '0', 10);
      seq = lastSeq + 1;
    }

    return `INV-${yyyy}-${mm}-${String(seq).padStart(5, '0')}`;
  }

  private isUpgrade(currentPlan: string, newPlan: string): boolean {
    const hierarchy: Record<string, number> = {
      free: 0,
      edu: 1,
      pro: 2,
      team: 3,
      enterprise: 4,
    };
    return (hierarchy[newPlan] ?? 0) > (hierarchy[currentPlan] ?? 0);
  }

  private getSeatsForPlan(planCode: string): number {
    switch (planCode) {
      case 'free':
        return 1;
      case 'edu':
        return 1;
      case 'pro':
        return 1;
      case 'team':
        return 10;
      case 'enterprise':
        return 50;
      default:
        return 1;
    }
  }

  /**
   * Build invoice-friendly line items from a CheckoutPriceSnapshot.
   * Translates PriceLineItem[] into invoice format with descriptions and amounts.
   */
  private buildInvoiceLineItems(snapshot: {
    planName: string;
    billingPeriod: string;
    basePriceAmount: number;
    couponCode: string | null;
    couponDiscountAmount: number;
    promotionDiscountAmount: number;
    finalAmount: number;
    lineItemsJson: unknown;
  }) {
    const items: Array<{
      description: string;
      quantity: number;
      unitAmount: number;
      totalAmount: number;
    }> = [];

    const periodLabel = snapshot.billingPeriod === 'annual' ? 'Annual' : 'Monthly';

    // Base plan line item
    items.push({
      description: `${snapshot.planName} Plan — ${periodLabel}`,
      quantity: 1,
      unitAmount: snapshot.basePriceAmount,
      totalAmount: snapshot.basePriceAmount,
    });

    // Coupon discount line item
    if (snapshot.couponDiscountAmount > 0) {
      items.push({
        description: snapshot.couponCode
          ? `Coupon discount (${snapshot.couponCode})`
          : 'Coupon discount',
        quantity: 1,
        unitAmount: -snapshot.couponDiscountAmount,
        totalAmount: -snapshot.couponDiscountAmount,
      });
    }

    // Promotion discount line item
    if (snapshot.promotionDiscountAmount > 0) {
      items.push({
        description: 'Promotion discount',
        quantity: 1,
        unitAmount: -snapshot.promotionDiscountAmount,
        totalAmount: -snapshot.promotionDiscountAmount,
      });
    }

    return items;
  }
}
