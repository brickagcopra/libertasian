import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
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

@Injectable()
export class LifecycleEventProcessorService {
  private readonly logger = new Logger(LifecycleEventProcessorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycleService: SubscriptionLifecycleService,
    private readonly subscriptionsService: SubscriptionsService,
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

  private async processEvent(
    event: {
      id: string;
      eventType: string;
      attempts: number;
      maxAttempts: number;
      subscription: {
        id: string;
        status: string;
        organizationId: string;
        planCode: string;
      };
    },
  ): Promise<void> {
    const mapping = EVENT_TYPE_MAP[event.eventType];
    if (!mapping) {
      this.logger.warn(
        `Unknown lifecycle event type: ${event.eventType} (event ${event.id})`,
      );
      await this.markFailed(event.id, `Unknown event type: ${event.eventType}`);
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

  private async createFreeTierFallback(organizationId: string): Promise<void> {
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
