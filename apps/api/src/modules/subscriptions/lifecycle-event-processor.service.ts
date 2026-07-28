import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  describePaymentMethod,
  formatBillingDate,
  formatPhpAmount,
} from '../notifications/notification-format.util';
import { SubscriptionsService } from './subscriptions.service';
import {
  SubscriptionLifecycleService,
  type ExecuteTransitionParams,
} from './subscription-lifecycle.service';
import { SubscriptionAction, SubscriptionState } from './subscription-state-machine';

/** Maps lifecycle event types to the subscription action + required source state. */
const EVENT_TYPE_MAP: Record<
  string,
  { action: SubscriptionAction; expectedStates: SubscriptionState[] }
> = {
  cancellation_end: {
    action: SubscriptionAction.CANCEL_IMMEDIATELY,
    expectedStates: [SubscriptionState.CANCELLING],
  },
  renewal: {
    action: SubscriptionAction.RENEW,
    expectedStates: [SubscriptionState.ACTIVE],
  },
  trial_expiry: {
    action: SubscriptionAction.EXPIRE_TRIAL,
    expectedStates: [SubscriptionState.TRIALING],
  },
  grace_period_end: {
    action: SubscriptionAction.SUSPEND,
    expectedStates: [SubscriptionState.GRACE_PERIOD],
  },
};

/** Shape of a due event as claimed by the 60s poll loop. */
interface DueLifecycleEvent {
  id: string;
  eventType: string;
  attempts: number;
  maxAttempts: number;
  metadataJson?: Prisma.JsonValue;
  subscription: {
    id: string;
    status: string;
    organizationId: string;
    planCode: string;
    xenditSubscriptionId: string | null;
  };
}

@Injectable()
export class LifecycleEventProcessorService {
  private readonly logger = new Logger(LifecycleEventProcessorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycleService: SubscriptionLifecycleService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Poll for due lifecycle events every 60 seconds.
   * Claims up to 20 events per cycle, processes each independently.
   */
  @Cron('*/60 * * * * *')
  async processDueEvents(): Promise<void> {
    const now = new Date();

    // Find pending events that are due
    const dueEvents = await this.prisma.subscriptionLifecycleEvent.findMany({
      where: {
        status: 'pending',
        scheduledAt: { lte: now },
      },
      orderBy: { scheduledAt: 'asc' },
      take: 20,
      include: {
        subscription: {
          select: {
            id: true,
            status: true,
            organizationId: true,
            planCode: true,
            xenditSubscriptionId: true,
          },
        },
      },
    });

    if (dueEvents.length === 0) return;

    this.logger.log(`Processing ${dueEvents.length} due lifecycle event(s)`);

    for (const event of dueEvents) {
      await this.processEvent(event);
    }
  }

  /**
   * Recover stale events stuck in 'processing' for more than 5 minutes.
   * Runs every 5 minutes.
   */
  @Cron('0 */5 * * * *')
  async recoverStaleEvents(): Promise<void> {
    const staleThreshold = new Date(Date.now() - 5 * 60 * 1000);

    const result = await this.prisma.subscriptionLifecycleEvent.updateMany({
      where: {
        status: 'processing',
        updatedAt: { lt: staleThreshold },
      },
      data: { status: 'pending' },
    });

    if (result.count > 0) {
      this.logger.warn(`Reset ${result.count} stale lifecycle event(s) from processing to pending`);
    }
  }

  // ---- Private ----

  private async processEvent(event: DueLifecycleEvent): Promise<void> {
    // RENEWAL REMINDER: an email-only event — no state transition. Handled by
    // its own path (guards + idempotency-per-period live there).
    if (event.eventType === 'renewal_reminder') {
      await this.processRenewalReminderEvent(event);
      return;
    }

    const mapping = EVENT_TYPE_MAP[event.eventType];
    if (!mapping) {
      this.logger.warn(
        `Unknown lifecycle event type: ${event.eventType} (event ${event.id})`,
      );
      await this.markFailed(event.id, `Unknown event type: ${event.eventType}`);
      return;
    }

    // DOUBLE-RENEWAL GUARD: Xendit-native subscriptions are renewed by Xendit's
    // own billing cycle (driven through the cycle.succeeded webhook, which
    // advances currentPeriodEnd). The internal `renewal` event must NEVER also
    // fire RENEW for these subs — that would double-advance the period (and the
    // RENEW path here charges no one anyway). Treat it as a completed no-op.
    if (event.eventType === 'renewal' && event.subscription.xenditSubscriptionId) {
      this.logger.log(
        `Skipping internal renewal for Xendit-backed subscription ${event.subscription.id} ` +
          `(event ${event.id}) — Xendit drives the billing cycle`,
      );
      await this.markCompleted(event.id);
      return;
    }

    // Claim the event: set to processing and increment attempts
    const claimed = await this.claimEvent(event.id, event.attempts);
    if (!claimed) return; // Another instance claimed it

    try {
      // Validate subscription is in the expected state
      const currentState = event.subscription.status as SubscriptionState;
      if (!mapping.expectedStates.includes(currentState)) {
        this.logger.warn(
          `Lifecycle event ${event.id} (${event.eventType}): subscription ${event.subscription.id} ` +
          `is in state ${currentState}, expected ${mapping.expectedStates.join('|')}. Marking completed (no-op).`,
        );
        await this.markCompleted(event.id);
        return;
      }

      // Execute the state transition
      const transitionParams: ExecuteTransitionParams = {
        subscriptionId: event.subscription.id,
        action: mapping.action,
        actorType: 'system',
        reason: `Lifecycle event: ${event.eventType}`,
      };

      await this.lifecycleService.executeTransition(transitionParams);

      // Post-transition: create free-tier fallback for cancellation_end
      if (event.eventType === 'cancellation_end') {
        await this.createFreeTierFallback(event.subscription.organizationId);
      }

      await this.markCompleted(event.id);

      this.logger.log(
        `Lifecycle event ${event.id} (${event.eventType}) processed: ` +
        `subscription ${event.subscription.id} transitioned via ${mapping.action}`,
      );
    } catch (error) {
      await this.recordFailureOrRetry(event, error);
    }
  }

  /**
   * Send the T-3d renewal reminder email scheduled by BillingService.
   *
   * Guards (all no-op complete, never send):
   * - subscription must still be ACTIVE
   * - subscription must be Xendit-backed (Xendit drives the upcoming charge)
   * - subscription must NOT be cancelAtPeriodEnd (no charge will occur)
   * - the reminder for this billing period must not have been sent already
   *   (idempotent per period via the periodEnd stamped in event metadata)
   */
  private async processRenewalReminderEvent(event: DueLifecycleEvent): Promise<void> {
    const claimed = await this.claimEvent(event.id, event.attempts);
    if (!claimed) return; // Another instance claimed it

    try {
      // Re-read the subscription for fresh state (the claim loop's snapshot may
      // be stale by the time this runs).
      const sub = await this.prisma.subscription.findUnique({
        where: { id: event.subscription.id },
        select: {
          id: true,
          organizationId: true,
          planCode: true,
          planId: true,
          status: true,
          billingPeriod: true,
          currentPeriodEnd: true,
          cancelAtPeriodEnd: true,
          xenditSubscriptionId: true,
        },
      });

      const now = new Date();
      if (
        !sub ||
        sub.status !== SubscriptionState.ACTIVE ||
        !sub.xenditSubscriptionId ||
        sub.cancelAtPeriodEnd ||
        !sub.currentPeriodEnd ||
        sub.currentPeriodEnd <= now
      ) {
        this.logger.log(
          `Renewal reminder ${event.id}: subscription ${event.subscription.id} not eligible ` +
            `(status=${sub?.status ?? 'missing'}, cancelAtPeriodEnd=${sub?.cancelAtPeriodEnd ?? 'n/a'}) — no-op`,
        );
        await this.markCompleted(event.id);
        return;
      }

      // IDEMPOTENCY per billing period: if a reminder for the same periodEnd
      // was already completed, do not send again.
      const meta = (event.metadataJson ?? {}) as Record<string, unknown>;
      const periodKey =
        typeof meta['periodEnd'] === 'string'
          ? meta['periodEnd']
          : sub.currentPeriodEnd.toISOString();
      const alreadySent = await this.prisma.subscriptionLifecycleEvent.findFirst({
        where: {
          subscriptionId: sub.id,
          eventType: 'renewal_reminder',
          status: 'completed',
          id: { not: event.id },
          metadataJson: { path: ['periodEnd'], equals: periodKey },
        },
        select: { id: true },
      });
      if (alreadySent) {
        this.logger.log(
          `Renewal reminder ${event.id}: already sent for subscription ${sub.id} period ${periodKey} — no-op`,
        );
        await this.markCompleted(event.id);
        return;
      }

      const org = await this.prisma.organization.findUnique({
        where: { id: sub.organizationId },
        select: { billingOwner: { select: { email: true, fullName: true } } },
      });
      if (!org?.billingOwner) {
        this.logger.warn(
          `Renewal reminder ${event.id}: org ${sub.organizationId} has no billing owner — no-op`,
        );
        await this.markCompleted(event.id);
        return;
      }

      // Plan display name + exact renewal amount (PlanPrice first, last
      // succeeded Payment as fallback).
      const plan = await this.findPlanWithPrice(sub);
      let amountCentavos = plan?.prices[0]?.amount ?? null;
      if (amountCentavos == null) {
        const lastPayment = await this.prisma.payment.findFirst({
          where: { subscriptionId: sub.id, status: 'succeeded' },
          orderBy: { paidAt: 'desc' },
          select: { amount: true },
        });
        amountCentavos = lastPayment?.amount ?? null;
      }
      if (amountCentavos == null) {
        // Card-network best practice requires the exact amount — do not send a
        // reminder we cannot price.
        this.logger.warn(
          `Renewal reminder ${event.id}: no price or prior payment for subscription ${sub.id} — no-op`,
        );
        await this.markCompleted(event.id);
        return;
      }

      const pm =
        (await this.prisma.paymentMethod.findFirst({
          where: { organizationId: sub.organizationId, isActive: true, isDefault: true },
        })) ??
        (await this.prisma.paymentMethod.findFirst({
          where: { organizationId: sub.organizationId, isActive: true },
          orderBy: { createdAt: 'desc' },
        }));

      await this.notificationsService.sendRenewalReminder({
        email: org.billingOwner.email,
        userName: org.billingOwner.fullName ?? 'User',
        planName: plan?.displayName ?? sub.planCode,
        billingPeriod: sub.billingPeriod,
        amount: formatPhpAmount(amountCentavos),
        chargeDate: formatBillingDate(sub.currentPeriodEnd),
        paymentMethod: describePaymentMethod(pm),
      });

      await this.markCompleted(event.id);
      this.logger.log(
        `Renewal reminder ${event.id} sent for subscription ${sub.id} (charge date ${periodKey})`,
      );
    } catch (error) {
      await this.recordFailureOrRetry(event, error);
    }
  }

  /** Resolve the sub's Plan (with the active price for its billing interval). */
  private async findPlanWithPrice(sub: {
    planId: string | null;
    planCode: string;
    billingPeriod: string;
  }) {
    const priceInclude = {
      prices: {
        where: { billingInterval: sub.billingPeriod, isActive: true },
        take: 1,
      },
    };
    if (sub.planId) {
      return this.prisma.plan.findUnique({
        where: { id: sub.planId },
        include: priceInclude,
      });
    }
    return this.prisma.plan.findUnique({
      where: { code: sub.planCode },
      include: priceInclude,
    });
  }

  /** Shared retry/permanent-failure bookkeeping for a claimed event. */
  private async recordFailureOrRetry(
    event: { id: string; eventType: string; attempts: number; maxAttempts: number },
    error: unknown,
  ): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const newAttempts = event.attempts + 1;

    if (newAttempts >= event.maxAttempts) {
      await this.markFailed(event.id, errorMessage);
      this.logger.error(
        `Lifecycle event ${event.id} (${event.eventType}) failed permanently ` +
        `after ${newAttempts} attempts: ${errorMessage}`,
      );
    } else {
      // Reset to pending for retry
      await this.prisma.subscriptionLifecycleEvent.update({
        where: { id: event.id },
        data: { status: 'pending', lastError: errorMessage },
      });
      this.logger.warn(
        `Lifecycle event ${event.id} (${event.eventType}) failed (attempt ${newAttempts}/${event.maxAttempts}): ${errorMessage}`,
      );
    }
  }

  /**
   * Atomically claim an event by setting status to 'processing' and incrementing attempts.
   * Returns false if the event was already claimed by another instance.
   */
  private async claimEvent(eventId: string, currentAttempts: number): Promise<boolean> {
    const result = await this.prisma.subscriptionLifecycleEvent.updateMany({
      where: {
        id: eventId,
        status: 'pending',
        attempts: currentAttempts,
      },
      data: {
        status: 'processing',
        attempts: currentAttempts + 1,
      },
    });
    return result.count > 0;
  }

  private async markCompleted(eventId: string): Promise<void> {
    await this.prisma.subscriptionLifecycleEvent.update({
      where: { id: eventId },
      data: { status: 'completed', processedAt: new Date(), lastError: null },
    });
  }

  private async markFailed(eventId: string, error: string): Promise<void> {
    await this.prisma.subscriptionLifecycleEvent.update({
      where: { id: eventId },
      data: { status: 'failed', lastError: error },
    });
  }

  /**
   * NO-OP when the org still holds any subscription in an accessible state.
   * The fallback row is dated now and would win the createdAt-desc ordering in
   * getActiveSubscription, demoting a live paid or complimentary subscription
   * to free.
   */
  private async createFreeTierFallback(organizationId: string): Promise<void> {
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
    this.logger.log(`Created free-tier fallback subscription for org ${organizationId}`);
  }
}
