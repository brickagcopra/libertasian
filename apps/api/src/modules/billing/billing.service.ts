import { randomUUID } from 'crypto';

import {
  BadRequestException,
  Inject,
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
import { UsageQuotaService } from '../subscriptions/usage-quota.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  describePaymentMethod,
  formatBillingDate,
  formatPhpAmount,
} from '../notifications/notification-format.util';
import {
  PAYMENT_PROVIDER,
  PaymentProviderError,
  type PaymentEventData,
  type PaymentProvider,
  type RefundEventData,
  type SubscriptionEventData,
} from './payment-provider.interface';
import type { CreateCheckoutDto, PreviewCheckoutDto } from './dto';

/** Renewal reminders go out 3 days before the scheduled charge (T-3d). */
const RENEWAL_REMINDER_LEAD_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Canonical UUID shape (8-4-4-4-12 hex). Gateway "test webhook" payloads (and
 * malformed events) carry a non-UUID reference_id (e.g. "test-reference-id");
 * passing one to findUnique on the UUID `id` column throws P2023, the handler
 * 500s, and the gateway retries the event forever.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_PROVIDER)
    private readonly paymentProvider: PaymentProvider,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly auditService: AuditService,
    private readonly pricingEngine: PricingEngineService,
    private readonly couponService: CouponService,
    private readonly promotionService: PromotionService,
    private readonly lifecycleService: SubscriptionLifecycleService,
    private readonly notificationsService: NotificationsService,
    private readonly entitlementService: EntitlementService,
    private readonly usageQuotaService: UsageQuotaService,
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

    // Prevent downgrade via checkout — check current plan.
    //
    // A subscription the user has ALREADY elected to end must not gate their
    // next one. Before getActiveSubscription resolved accessible states, a
    // cancelling org returned no row here and any checkout was allowed.
    // Without this exemption, widening the status set silently blocks a
    // cancelling pro user from re-subscribing on edu — or re-buying the same
    // plan — until their period ends, and sends them to support instead.
    // Conditions are inlined rather than hoisted into a boolean so TypeScript
    // narrows `currentSub` to non-null for the isUpgrade call.
    const currentSub = await this.subscriptionsService.getActiveSubscription(
      organizationId,
    );
    if (
      currentSub &&
      !currentSub.cancelAtPeriodEnd &&
      currentSub.status !== SubscriptionState.CANCELLING &&
      !this.isUpgrade(currentSub.planCode, dto.planCode)
    ) {
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

    // 3. Resolve (or create) the gateway Customer for the org. Reuse the
    //    customer id from any prior subscription so re-subscriptions map to one
    //    customer.
    const providerCustomerId = await this.resolveProviderCustomer(organizationId, userId);

    // 4. Create the local Subscription up-front in `provisioning`. The gateway
    //    plan's reference_id is this row's id, so the `subscription.activated`
    //    webhook can link back deterministically.
    const provisioningEntitlements =
      this.subscriptionsService.getDefaultEntitlements(dto.planCode);
    const subscription = await this.prisma.subscription.create({
      data: {
        organizationId,
        planCode: dto.planCode,
        ...(breakdown.planId && { planId: breakdown.planId }),
        status: SubscriptionState.PROVISIONING,
        billingPeriod: dto.billingPeriod,
        seats: this.getSeatsForPlan(dto.planCode),
        provider: this.paymentProvider.slug,
        providerCustomerId,
        entitlementsJson: provisioningEntitlements as unknown as Prisma.InputJsonValue,
      },
    });

    // 5. Create the gateway's SUBSCRIPTION-mode payment session (auto-debit).
    //    The gateway owns scheduling, retries and dunning thereafter. Its
    //    recurring-plan id is NOT known yet — it arrives on
    //    `subscription.activated` and is linked back via reference_id (this
    //    subscription's id). Amount is whole PHP (centavos / 100).
    let session;
    try {
      session = await this.paymentProvider.createSubscriptionSession({
        referenceId: subscription.id,
        customerId: providerCustomerId,
        amount: Math.round(breakdown.finalAmount / 100),
        currency: breakdown.currency,
        interval: dto.billingPeriod === 'annual' ? 'YEAR' : 'MONTH',
        intervalCount: 1,
        description,
        successReturnUrl: dto.successUrl,
        cancelReturnUrl: dto.cancelUrl,
        metadata: {
          organizationId,
          userId,
          planCode: dto.planCode,
          billingPeriod: dto.billingPeriod,
          subscriptionId: subscription.id,
          ...(breakdown.planId && { planId: breakdown.planId }),
          ...(couponRedemptionId && { couponRedemptionId }),
          ...(breakdown.promotionId && { promotionId: breakdown.promotionId }),
        },
      });
    } catch (err) {
      // Roll back the provisioning row so a failed gateway call doesn't leave
      // an orphaned subscription behind.
      await this.prisma.subscription.delete({ where: { id: subscription.id } }).catch(() => undefined);
      throw err;
    }

    // Persist the gateway subscription id when the gateway supplied one at
    // session creation (PayMongo). Xendit leaves it undefined — its
    // recurring-plan id only arrives on activation — so nothing is written
    // and its behaviour is byte-identical to before.
    if (session.providerSubscriptionId) {
      await this.prisma.subscription.update({
        where: { id: subscription.id },
        data: { providerSubscriptionId: session.providerSubscriptionId },
      });
    }

    await this.auditService.log({
      organizationId,
      actorUserId: userId,
      actorType: 'user',
      action: 'billing.checkout_created',
      entityType: 'subscription',
      entityId: subscription.id,
      metadata: {
        planCode: dto.planCode,
        billingPeriod: dto.billingPeriod,
        finalAmount: breakdown.finalAmount,
        couponCode: breakdown.couponCode,
        promotionId: breakdown.promotionId,
        // Audit metadata key retained verbatim so historical rows stay queryable.
        xenditSessionId: session.sessionId,
      },
    });

    return {
      checkoutUrl: session.checkoutUrl,
      checkoutSessionId: session.sessionId,
      subscriptionId: subscription.id,
    };
  }

  /**
   * Return the org's gateway Customer id, creating one if none exists yet.
   * The id is stored on every Subscription row, so we read it back from the
   * most recent row that has one.
   *
   * The local pointer can be lost — e.g. a failed checkout rolls back the only
   * provisioning row holding providerCustomerId — while the remote customer
   * still exists. reference_id is unique at the gateway, so a blind re-POST
   * 409s with DUPLICATE_ERROR. Resolution is therefore idempotent: local DB →
   * remote lookup by reference_id → create, with a 409 on create falling back
   * to the remote lookup (a concurrent checkout may win the create race).
   */
  private async resolveProviderCustomer(
    organizationId: string,
    userId: string,
  ): Promise<string> {
    const existing = await this.prisma.subscription.findFirst({
      where: { organizationId, providerCustomerId: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { providerCustomerId: true },
    });
    if (existing?.providerCustomerId) {
      return existing.providerCustomerId;
    }

    const remote = await this.paymentProvider.getCustomerByReferenceId(organizationId);
    if (remote) {
      return remote.id;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, fullName: true },
    });
    try {
      const customer = await this.paymentProvider.createCustomer({
        referenceId: organizationId,
        email: user?.email,
        givenNames: user?.fullName ?? undefined,
      });
      return customer.id;
    } catch (err) {
      if (this.isDuplicateCustomerError(err)) {
        const raced = await this.paymentProvider.getCustomerByReferenceId(organizationId);
        if (raced) {
          this.logger.warn(
            `Gateway customer for org ${organizationId} already existed (DUPLICATE_ERROR) — reusing ${raced.id}`,
          );
          return raced.id;
        }
      }
      throw err;
    }
  }

  /** A `createCustomer` rejection because the reference_id is already used. */
  private isDuplicateCustomerError(err: unknown): boolean {
    return (
      err instanceof PaymentProviderError &&
      (err.errorCode === 'DUPLICATE_ERROR' || err.status === 409)
    );
  }

  // ---- Webhook Handlers ----

  async handlePaymentSuccess(event: PaymentEventData) {
    const providerInvoiceId = event.id;

    // Find the corresponding payment record
    const payment = await this.prisma.payment.findUnique({
      where: { providerInvoiceId },
    });

    if (!payment) {
      this.logger.warn(
        `Payment not found for gateway invoice: ${providerInvoiceId}`,
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

  async handlePaymentFailed(event: PaymentEventData) {
    const providerInvoiceId = event.id;

    const payment = await this.prisma.payment.findUnique({
      where: { providerInvoiceId },
    });

    if (!payment) {
      this.logger.warn(
        `Payment not found for failed gateway invoice: ${providerInvoiceId}`,
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
        failureReason: event.failureReason ?? 'Payment failed',
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

  /**
   * Handle a `refund.succeeded` webhook.
   *
   * Refunds are initiated manually from the gateway dashboard — we only REACT
   * here. This method is deliberately tolerant: it never throws for
   * unactionable payloads (unknown invoice, already-processed) because a thrown
   * error makes the gateway retry the webhook indefinitely.
   */
  async handleRefundSucceeded(data: RefundEventData) {
    const refundId = data.id;

    // LINKAGE: invoice-originated refunds carry the invoice id, which maps to
    // Payment.providerInvoiceId.
    // TODO(recurring): after the gateway-native recurring migration, refunds
    //   will instead carry paymentRequestId — also match Payment on that
    //   field (Payment will gain a payment-request linkage column then).
    const invoiceId = data.invoiceId;
    if (!invoiceId) {
      this.logger.warn(
        `Refund ${refundId}: no invoice_id on payload — cannot link to a Payment, skipping`,
      );
      return;
    }

    const payment = await this.prisma.payment.findUnique({
      where: { providerInvoiceId: invoiceId },
    });

    if (!payment) {
      // Do NOT throw — that triggers infinite gateway retries for a refund we
      // can't act on (e.g. an invoice that predates this system).
      this.logger.warn(
        `Refund ${refundId}: no Payment found for invoice ${invoiceId}, skipping`,
      );
      return;
    }

    // IDEMPOTENCY: a replayed refund webhook for an already-refunded payment.
    if (payment.status === 'refunded' && payment.refundId === refundId) {
      this.logger.log(`Refund ${refundId} already processed for payment ${payment.id}`);
      return;
    }

    // UNIT GOTCHA: the original invoice amount was sent to the gateway in WHOLE
    // PHP (createCheckout divides centavos by 100). The refund webhook `amount` is
    // likewise whole PHP → multiply by 100 to store centavos matching
    // Payment.amount.
    const refundedAmount = Math.round(Number(data.amount) * 100);
    const isFullRefund = refundedAmount >= payment.amount;

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: 'refunded',
          refundedAt: new Date(),
          refundedAmount,
          refundId,
          refundReason: data.reason ?? null,
        },
      });
    });

    // SUBSCRIPTION IMPACT: a FULL refund of the payment that funds the org's
    // CURRENT active subscription revokes access immediately. A PARTIAL refund
    // records the money movement only — entitlements are unchanged.
    if (isFullRefund && payment.subscriptionId) {
      const activeSub = await this.subscriptionsService.getActiveSubscription(
        payment.organizationId,
      );
      if (activeSub && activeSub.id === payment.subscriptionId) {
        try {
          await this.lifecycleService.executeTransition({
            subscriptionId: payment.subscriptionId,
            action: SubscriptionAction.CANCEL_IMMEDIATELY,
            actorType: 'system',
            reason: 'refund',
            metadata: { reason: 'refund', refundId },
          });

          // CANCEL_IMMEDIATELY moves the sub to CANCELLED but does not create a
          // free-tier row; mirror cancelSubscription() so the org lands on free
          // instead of having no active subscription at all. Routed through
          // createFreeFallback so the "don't clobber an accessible row" guard
          // applies here too — a refund on one subscription must not demote a
          // second, still-valid one.
          await this.createFreeFallback(payment.organizationId);

          // Invalidate cached entitlements so revoked limits take effect now.
          await this.entitlementService.invalidateEntitlementCache(
            payment.organizationId,
          );
        } catch (err) {
          this.logger.error(
            `Refund ${refundId}: failed to cancel subscription ${payment.subscriptionId}`,
            err,
          );
        }
      } else {
        this.logger.log(
          `Refund ${refundId}: payment ${payment.id} is not tied to the org's current active subscription — recording refund only`,
        );
      }
    }

    // TODO(accounting): emit a REFUND journal entry (debit 4910 Refunds /
    //   credit 2150 Customer Credits). The chart-of-accounts + REFUND journal
    //   source already exist; a follow-up PR will wire this in.

    await this.auditService.log({
      organizationId: payment.organizationId,
      actorType: 'system',
      action: 'billing.payment_refunded',
      entityType: 'payment',
      entityId: payment.id,
      // PII-safe: ids + amounts only.
      metadata: {
        refundId,
        refundedAmount,
        fullRefund: isFullRefund,
        currency: data.currency,
      },
    });

    this.logger.log(
      `Refund ${refundId} processed for org ${payment.organizationId}: ` +
        `${isFullRefund ? 'full' : 'partial'} (${refundedAmount} centavos)`,
    );
  }

  // ---- Recurring subscription webhook handlers ----

  /**
   * `subscription.activated` — the customer authorised the plan and the first
   * charge cleared. Move the provisioning Subscription → active.
   */
  async handleSubscriptionActivated(data: SubscriptionEventData) {
    const sub = await this.findSubscriptionForPlan(data);
    if (!sub) {
      this.logger.warn(`plan.activated: no Subscription for plan ${data.id}, skipping`);
      return;
    }

    if (sub.status === SubscriptionState.ACTIVE) {
      this.logger.log(`plan.activated: subscription ${sub.id} already active (idempotent)`);
      return;
    }

    const now = new Date();
    const planId = data.planId ?? data.id;

    await this.prisma.subscription.update({
      where: { id: sub.id },
      data: {
        // Capture the gateway's recurring-plan id now (not known at checkout time).
        providerSubscriptionId: sub.providerSubscriptionId ?? planId,
        // Open the first period at activation but DO NOT set currentPeriodEnd
        // here. `subscription.cycle.succeeded` is the sole owner of
        // currentPeriodEnd: the gateway emits it for the immediate
        // (activation) charge too, and handleCycleSucceeded's anchor falls back
        // to `now` when currentPeriodEnd is null — so the first cycle correctly
        // sets now + 1 period. Setting it here as well would net TWO periods for
        // the first cycle (activation advance + cycle.succeeded advance).
        currentPeriodStart: now,
      },
    });

    // provisioning → active (idempotency above guards against re-activation).
    await this.lifecycleService.executeTransition({
      subscriptionId: sub.id,
      action: SubscriptionAction.ACTIVATE,
      actorType: 'system',
      // Persisted verbatim into subscription_history — unchanged by this refactor.
      reason: 'Xendit recurring plan activated',
      // Audit metadata key retained verbatim so historical rows stay queryable.
      metadata: { xenditSubscriptionId: data.id },
    });

    // Persist the saved instrument if the gateway supplied one.
    await this.persistPaymentMethod(sub.organizationId, data);

    // Schedule the T-3d renewal reminder. currentPeriodEnd is not known yet
    // (cycle.succeeded owns it), so estimate one billing period from now; the
    // activation charge's cycle.succeeded re-schedules with the exact date.
    await this.scheduleRenewalReminder(sub, this.addBillingPeriod(now, sub.billingPeriod));

    await this.entitlementService.invalidateEntitlementCache(sub.organizationId);

    await this.auditService.log({
      organizationId: sub.organizationId,
      actorType: 'system',
      action: 'billing.subscription_activated',
      entityType: 'subscription',
      entityId: sub.id,
      metadata: { xenditSubscriptionId: data.id, planCode: sub.planCode },
    });

    this.logger.log(`Subscription ${sub.id} activated via gateway plan ${data.id}`);
  }

  /**
   * `subscription.cycle.succeeded` — a billing cycle was charged. Idempotently
   * record the Payment, advance the period by exactly one cycle, reset usage
   * quotas, and recover the sub from past_due if needed.
   *
   * Idempotency is anchored on the cycle id (stored as the Payment's external
   * id): a replayed webhook finds the existing Payment and returns BEFORE
   * advancing the period — this is the guard against double-advance / double
   * charge.
   */
  async handleCycleSucceeded(data: SubscriptionEventData) {
    const sub = await this.findSubscriptionForPlan(data);
    if (!sub) {
      this.logger.warn(`cycle.succeeded: no Subscription for plan ${data.planId ?? data.id}, skipping`);
      return;
    }

    // IDEMPOTENCY: the cycle/charge id is unique per cycle.
    const cycleChargeId = data.id;
    const existing = await this.prisma.payment.findUnique({
      where: { providerInvoiceId: cycleChargeId },
    });
    if (existing) {
      this.logger.log(`cycle.succeeded: payment ${cycleChargeId} already recorded — skipping period advance`);
      return;
    }

    const amountCentavos = Math.round(Number(data.amount ?? 0) * 100);
    // Advance from the existing period end (anchor) to avoid drift; fall back to
    // now for the very first cycle if the period was not yet set.
    const anchor = sub.currentPeriodEnd ?? new Date();
    const newPeriodStart = sub.currentPeriodEnd ?? new Date();
    const newPeriodEnd = this.addBillingPeriod(anchor, sub.billingPeriod);

    const invoiceNumber = await this.generateInvoiceNumber();

    await this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          organizationId: sub.organizationId,
          subscriptionId: sub.id,
          provider: sub.provider,
          providerInvoiceId: cycleChargeId,
          amount: amountCentavos,
          currency: data.currency ?? 'PHP',
          status: 'succeeded',
          paymentType: 'subscription',
          description: `Recurring cycle — ${sub.planCode}`,
          paidAt: new Date(),
          // Payment.metadata keys retained verbatim — this JSON is read back by
          // reporting, so the refactor must not reshape it.
          metadata: {
            xenditSubscriptionId: sub.providerSubscriptionId,
            cycleId: cycleChargeId,
          },
        },
      });

      // Recurring cycles get a real Invoice row too, so the billing history
      // (and the receipt email's invoice number) reference a retrievable record.
      await tx.invoice.create({
        data: {
          organizationId: sub.organizationId,
          subscriptionId: sub.id,
          paymentId: payment.id,
          invoiceNumber,
          amount: amountCentavos,
          currency: data.currency ?? 'PHP',
          status: 'paid',
          description: `Recurring cycle — ${sub.planCode}`,
          lineItemsJson: [
            {
              description: `${sub.planCode} Plan — ${sub.billingPeriod === 'annual' ? 'Annual' : 'Monthly'} renewal`,
              quantity: 1,
              unitAmount: amountCentavos,
              totalAmount: amountCentavos,
            },
          ] as unknown as Prisma.InputJsonValue,
          billingPeriodStart: newPeriodStart,
          billingPeriodEnd: newPeriodEnd,
          paidAt: new Date(),
        },
      });

      await tx.subscription.update({
        where: { id: sub.id },
        data: { currentPeriodStart: newPeriodStart, currentPeriodEnd: newPeriodEnd },
      });
    });

    // Re-schedule the T-3d renewal reminder against the fresh period end
    // (cancels any pending reminder first — one pending reminder per sub).
    await this.scheduleRenewalReminder(sub, newPeriodEnd);

    // Reset usage quotas for the new period.
    try {
      await this.usageQuotaService.resetQuotasForBillingCycle(sub.organizationId);
    } catch (err) {
      this.logger.error(`Failed to reset quotas for org ${sub.organizationId} after cycle`, err);
    }

    // If we were past_due / in grace, a successful charge recovers us to active.
    if (
      sub.status === SubscriptionState.PAST_DUE ||
      sub.status === SubscriptionState.GRACE_PERIOD
    ) {
      try {
        await this.lifecycleService.executeTransition({
          subscriptionId: sub.id,
          action: SubscriptionAction.RENEW,
          actorType: 'system',
          // Persisted verbatim into subscription_history — unchanged by this refactor.
          reason: 'Xendit cycle succeeded — recovered from past_due',
          metadata: { cycleId: cycleChargeId },
        });
      } catch (err) {
        this.logger.warn(`Could not recover subscription ${sub.id} from ${sub.status}: ${err}`);
      }
    }

    await this.auditService.log({
      organizationId: sub.organizationId,
      actorType: 'system',
      action: 'billing.cycle_succeeded',
      entityType: 'subscription',
      entityId: sub.id,
      metadata: { cycleId: cycleChargeId, amount: amountCentavos },
    });

    this.logger.log(
      `Cycle ${cycleChargeId} recorded for subscription ${sub.id}; period advanced to ${newPeriodEnd.toISOString()}`,
    );

    // Fire-and-forget recurring receipt — a mail failure must never fail the
    // webhook (the gateway would retry, and the idempotency guard above would then
    // skip the period advance but the charge is already recorded).
    try {
      const org = await this.prisma.organization.findUnique({
        where: { id: sub.organizationId },
        include: { billingOwner: true },
      });
      if (org?.billingOwner) {
        const pm = await this.findDefaultPaymentMethod(sub.organizationId);
        await this.notificationsService.sendPaymentReceipt({
          email: org.billingOwner.email,
          userName: org.billingOwner.fullName ?? 'User',
          amount: formatPhpAmount(amountCentavos),
          currency: data.currency ?? 'PHP',
          paymentMethod: describePaymentMethod(pm),
          invoiceNumber,
          date: formatBillingDate(new Date()),
          planName: sub.planCode,
          billingPeriodLabel: `${formatBillingDate(newPeriodStart)} – ${formatBillingDate(newPeriodEnd)}`,
          nextBillingDate: formatBillingDate(newPeriodEnd),
        });
      }
    } catch (err) {
      // PII-safe: ids only, no email address.
      this.logger.error(
        `cycle.succeeded: failed to enqueue receipt email for subscription ${sub.id}: ${err}`,
      );
    }
  }

  /**
   * `subscription.cycle.failed` — the gateway's auto-debit (and its own
   * retries) failed. Move to past_due; the existing grace_period / suspend
   * lifecycle events take over dunning fallback from there.
   */
  async handleCycleFailed(data: SubscriptionEventData) {
    const sub = await this.findSubscriptionForPlan(data);
    if (!sub) {
      this.logger.warn(`cycle.failed: no Subscription for plan ${data.planId ?? data.id}, skipping`);
      return;
    }

    if (sub.status !== SubscriptionState.ACTIVE) {
      this.logger.log(`cycle.failed: subscription ${sub.id} not active (${sub.status}) — no transition`);
      return;
    }

    try {
      await this.lifecycleService.executeTransition({
        subscriptionId: sub.id,
        action: SubscriptionAction.PAYMENT_FAILED,
        actorType: 'system',
        // Persisted verbatim into subscription_history — unchanged by this refactor.
        reason: 'Xendit recurring cycle failed',
        metadata: { cycleId: data.id },
      });
    } catch (err) {
      this.logger.warn(`Could not transition subscription ${sub.id} to past_due: ${err}`);
    }

    await this.auditService.log({
      organizationId: sub.organizationId,
      actorType: 'system',
      action: 'billing.cycle_failed',
      entityType: 'subscription',
      entityId: sub.id,
      metadata: { cycleId: data.id },
    });

    // Fire-and-forget failed-cycle notice — a mail failure must never fail the
    // webhook handler.
    try {
      const org = await this.prisma.organization.findUnique({
        where: { id: sub.organizationId },
        include: { billingOwner: true },
      });
      if (org?.billingOwner) {
        const amountCentavos = await this.resolveCycleAmountCentavos(sub, data);
        await this.notificationsService.sendPaymentFailed({
          email: org.billingOwner.email,
          userName: org.billingOwner.fullName ?? 'User',
          amount:
            amountCentavos != null
              ? `PHP ${formatPhpAmount(amountCentavos)}`
              : 'your subscription renewal',
          retryDate: formatBillingDate(new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)),
          graceNote:
            'Your plan access continues during the grace period while we retry the charge.',
        });
      }
    } catch (err) {
      // PII-safe: ids only, no email address.
      this.logger.error(
        `cycle.failed: failed to enqueue payment-failed email for subscription ${sub.id}: ${err}`,
      );
    }
  }

  /**
   * `subscription.deactivated` — the plan was deactivated at the gateway (e.g.
   * exhausted dunning, or our own cancel call). Cancel + downgrade to free.
   */
  async handlePlanDeactivated(data: SubscriptionEventData) {
    const sub = await this.findSubscriptionForPlan(data);
    if (!sub) {
      this.logger.warn(`plan.inactivated: no Subscription for plan ${data.id}, skipping`);
      return;
    }

    if (
      sub.status === SubscriptionState.CANCELLED ||
      sub.status === SubscriptionState.EXPIRED
    ) {
      this.logger.log(`plan.inactivated: subscription ${sub.id} already terminal (${sub.status})`);
      return;
    }

    try {
      await this.lifecycleService.executeTransition({
        subscriptionId: sub.id,
        action: SubscriptionAction.CANCEL_IMMEDIATELY,
        actorType: 'system',
        // Persisted verbatim into subscription_history — unchanged by this refactor.
        reason: 'Xendit recurring plan deactivated',
        metadata: { xenditSubscriptionId: data.id },
      });
      await this.createFreeFallback(sub.organizationId);
      await this.entitlementService.invalidateEntitlementCache(sub.organizationId);
    } catch (err) {
      this.logger.error(`Failed to downgrade subscription ${sub.id} on plan deactivation`, err);
    }

    // No further charges will occur — drop any pending renewal reminder.
    await this.cancelPendingRenewalReminders(sub.id);

    await this.auditService.log({
      organizationId: sub.organizationId,
      actorType: 'system',
      action: 'billing.subscription_deactivated',
      entityType: 'subscription',
      entityId: sub.id,
      metadata: { xenditSubscriptionId: data.id },
    });
  }

  /** Link a subscription webhook back to a local Subscription row. */
  private async findSubscriptionForPlan(data: SubscriptionEventData) {
    const planId = data.planId ?? data.id;
    // Prefer the plan id; fall back to our reference_id (the local sub id).
    const bySubId = await this.prisma.subscription.findFirst({
      where: { providerSubscriptionId: planId },
    });
    if (bySubId) return bySubId;
    if (data.referenceId) {
      if (UUID_RE.test(data.referenceId)) {
        return this.prisma.subscription.findUnique({ where: { id: data.referenceId } });
      }
      // Non-UUID reference_id (gateway test webhook or malformed event): treat
      // as "no matching subscription" so the handler returns 200 and the
      // gateway stops retrying, instead of P2023 → 500 → infinite retries.
      this.logger.warn(
        `Recurring webhook carried non-UUID reference_id (event object ${planId ?? 'unknown'}); dropping — likely a gateway test event`,
      );
    }
    return null;
  }

  /** Persist the saved card / e-wallet instrument from an activation payload. */
  private async persistPaymentMethod(organizationId: string, data: SubscriptionEventData) {
    const pmId = data.paymentMethodId;
    if (!pmId) return;

    const type = (data.paymentMethodType ?? 'card').toLowerCase();
    try {
      await this.prisma.paymentMethod.upsert({
        where: { providerPaymentMethodId: pmId },
        create: {
          organizationId,
          provider: this.paymentProvider.slug,
          providerPaymentMethodId: pmId,
          type: type.includes('ewallet') ? 'gcash' : 'card',
          isDefault: true,
          isActive: true,
        },
        update: { isActive: true },
      });
    } catch (err) {
      this.logger.warn(`Could not persist payment method ${pmId} for org ${organizationId}: ${err}`);
    }
  }

  /**
   * Create the free-tier fallback subscription after an immediate cancel.
   *
   * NO-OP when the org still holds any subscription in an accessible state.
   * The fallback row is dated now, so it would otherwise win the
   * createdAt-desc ordering in getActiveSubscription and demote a live paid,
   * trialing or complimentary subscription to free.
   */
  private async createFreeFallback(organizationId: string) {
    if (await this.subscriptionsService.hasAccessibleSubscription(organizationId)) {
      this.logger.log(
        `Free-tier fallback skipped for org ${organizationId}: an accessible subscription already exists`,
      );
      return;
    }

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

  /**
   * (Re-)schedule the T-3d renewal reminder for a gateway-backed subscription.
   * Cancels any pending reminder first, so exactly one reminder is pending per
   * subscription (idempotent per billing period — the period end is stamped
   * into the event metadata and checked again at send time by the processor).
   * Never throws: a scheduling failure must not fail the webhook handler.
   */
  private async scheduleRenewalReminder(
    sub: { id: string; organizationId: string; cancelAtPeriodEnd: boolean },
    periodEnd: Date,
  ): Promise<void> {
    try {
      // A sub winding down at period end will not be charged again — no reminder.
      if (sub.cancelAtPeriodEnd) return;

      const scheduledAt = new Date(periodEnd.getTime() - RENEWAL_REMINDER_LEAD_MS);

      await this.prisma.subscriptionLifecycleEvent.updateMany({
        where: { subscriptionId: sub.id, eventType: 'renewal_reminder', status: 'pending' },
        data: { status: 'cancelled' },
      });
      await this.prisma.subscriptionLifecycleEvent.create({
        data: {
          subscriptionId: sub.id,
          organizationId: sub.organizationId,
          eventType: 'renewal_reminder',
          status: 'pending',
          scheduledAt,
          metadataJson: { periodEnd: periodEnd.toISOString() } as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Could not schedule renewal reminder for subscription ${sub.id}: ${err}`,
      );
    }
  }

  /** Cancel any pending renewal reminders (on cancel/deactivation). Never throws. */
  private async cancelPendingRenewalReminders(subscriptionId: string): Promise<void> {
    try {
      await this.prisma.subscriptionLifecycleEvent.updateMany({
        where: { subscriptionId, eventType: 'renewal_reminder', status: 'pending' },
        data: { status: 'cancelled' },
      });
    } catch (err) {
      this.logger.warn(
        `Could not cancel pending renewal reminders for subscription ${subscriptionId}: ${err}`,
      );
    }
  }

  /** The org's default (or most recent) active saved payment instrument. */
  private async findDefaultPaymentMethod(organizationId: string) {
    const byDefault = await this.prisma.paymentMethod.findFirst({
      where: { organizationId, isActive: true, isDefault: true },
    });
    if (byDefault) return byDefault;
    return this.prisma.paymentMethod.findFirst({
      where: { organizationId, isActive: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Best-effort amount (centavos) for a failed cycle: the webhook amount when
   * present, else the last succeeded payment on this subscription.
   */
  private async resolveCycleAmountCentavos(
    sub: { id: string },
    data: SubscriptionEventData,
  ): Promise<number | null> {
    if (data.amount != null && Number.isFinite(Number(data.amount))) {
      // Recurring payloads carry whole PHP.
      return Math.round(Number(data.amount) * 100);
    }
    const lastPayment = await this.prisma.payment.findFirst({
      where: { subscriptionId: sub.id, status: 'succeeded' },
      orderBy: { paidAt: 'desc' },
      select: { amount: true },
    });
    return lastPayment?.amount ?? null;
  }

  /** Add one billing period (month/year) to a date. */
  private addBillingPeriod(from: Date, billingPeriod: string): Date {
    const d = new Date(from);
    if (billingPeriod === 'annual') {
      d.setFullYear(d.getFullYear() + 1);
    } else {
      d.setMonth(d.getMonth() + 1);
    }
    return d;
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

    // Idempotent no-op: the caller asked to cancel at period end and the row is
    // ALREADY scheduled to do exactly that. CANCELLING has no REQUEST_CANCEL
    // edge, so falling through would issue a redundant gateway deactivate and
    // then 400 out of the state machine. A repeated cancel is a normal
    // double-submit, not an error.
    // Only the cancelAtPeriodEnd branch returns early — CANCELLING ->
    // CANCEL_IMMEDIATELY IS valid (subscription-state-machine.ts:297) and is a
    // legitimate escalation from a scheduled cancel to an immediate one.
    if (cancelAtPeriodEnd && sub.status === SubscriptionState.CANCELLING) {
      this.logger.log(
        `cancelSubscription: subscription ${sub.id} is already CANCELLING; returning existing row`,
      );
      return sub;
    }

    const action = cancelAtPeriodEnd
      ? SubscriptionAction.REQUEST_CANCEL
      : SubscriptionAction.CANCEL_IMMEDIATELY;

    // Deactivate the gateway's recurring plan so NO further auto-debit occurs,
    // in both modes. The cancelAtPeriodEnd vs immediate distinction is about OUR
    // entitlement state (REQUEST_CANCEL keeps access until currentPeriodEnd;
    // CANCEL_IMMEDIATELY revokes now), not about the gateway continuing to charge.
    if (sub.providerSubscriptionId) {
      try {
        await this.paymentProvider.cancelSubscription(sub.providerSubscriptionId);
      } catch (err) {
        // Don't block our own cancellation if the gateway is unreachable; the
        // plan can be reconciled later and internal state is the source of truth.
        this.logger.error(
          `Failed to deactivate gateway plan ${sub.providerSubscriptionId} for subscription ${sub.id}`,
          err,
        );
      }
    }

    await this.lifecycleService.executeTransition({
      subscriptionId: sub.id,
      action,
      actorUserId: userId,
      actorType: 'user',
      reason: cancelAtPeriodEnd ? 'User requested cancel at period end' : 'User requested immediate cancel',
      metadata: { previousPlan: sub.planCode },
    });

    // No further charges will occur in either cancel mode — drop any pending
    // renewal reminder so the user is not reminded of a charge that won't happen.
    await this.cancelPendingRenewalReminders(sub.id);

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
