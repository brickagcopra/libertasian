import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { SubscriptionLifecycleService } from './subscription-lifecycle.service';
import { ProrationService } from './proration.service';
import {
  SubscriptionAction,
  SubscriptionState,
  getValidActions,
} from './subscription-state-machine';

// ---- Param Types ----

export interface ListSubscriptionsParams {
  status?: string;
  planCode?: string;
  organizationId?: string;
  search?: string;
  limit?: number;
  cursor?: string;
}

export interface ListHistoryParams {
  action?: string;
  actorType?: string;
  limit?: number;
  cursor?: string;
}

export interface ListMigrationsParams {
  limit?: number;
  cursor?: string;
}

// ---- Service ----

@Injectable()
export class SubscriptionAdminService {
  private readonly logger = new Logger(SubscriptionAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycleService: SubscriptionLifecycleService,
    private readonly prorationService: ProrationService,
  ) {}

  /**
   * List subscriptions with optional filters and cursor pagination.
   */
  async listSubscriptions(params: ListSubscriptionsParams) {
    const limit = params.limit ?? 20;

    const where: Prisma.SubscriptionWhereInput = {};
    if (params.status) where.status = params.status;
    if (params.planCode) where.planCode = params.planCode;
    if (params.organizationId) where.organizationId = params.organizationId;
    if (params.search) {
      where.organization = {
        name: { contains: params.search, mode: 'insensitive' },
      };
    }

    const items = await this.prisma.subscription.findMany({
      where,
      take: limit + 1,
      ...(params.cursor && { skip: 1, cursor: { id: params.cursor } }),
      orderBy: { createdAt: 'desc' },
      include: {
        organization: { select: { id: true, name: true, slug: true } },
        plan: { select: { id: true, name: true, code: true } },
      },
    });

    const hasNext = items.length > limit;
    const data = hasNext ? items.slice(0, limit) : items;
    const lastItem = data[data.length - 1];
    const nextCursor = hasNext && lastItem ? lastItem.id : null;

    return { data, nextCursor, hasNext };
  }

  /**
   * Get full subscription detail including recent history, migrations,
   * trial records, complimentary access, pending events, and valid actions.
   */
  async getSubscriptionDetail(id: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id },
      include: {
        organization: { select: { id: true, name: true, slug: true } },
        plan: { select: { id: true, name: true, code: true } },
        history: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        trialRecords: {
          orderBy: { createdAt: 'desc' },
        },
        complimentaryAccess: {
          orderBy: { createdAt: 'desc' },
        },
        migrationsFrom: {
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
        migrationsTo: {
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
        lifecycleEvents: {
          where: { status: 'pending' },
          orderBy: { scheduledAt: 'asc' },
        },
      },
    });

    if (!subscription) {
      throw new NotFoundException(`Subscription ${id} not found`);
    }

    const validActions = getValidActions(
      subscription.status as SubscriptionState,
    );

    return { ...subscription, validActions };
  }

  /**
   * Cursor-paginated subscription history with optional filters.
   */
  async getSubscriptionHistory(id: string, params: ListHistoryParams) {
    const limit = params.limit ?? 20;

    // Verify subscription exists
    const exists = await this.prisma.subscription.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!exists) {
      throw new NotFoundException(`Subscription ${id} not found`);
    }

    const where: Prisma.SubscriptionHistoryWhereInput = {
      subscriptionId: id,
    };
    if (params.action) where.action = params.action;
    if (params.actorType) where.actorType = params.actorType;

    const items = await this.prisma.subscriptionHistory.findMany({
      where,
      take: limit + 1,
      ...(params.cursor && { skip: 1, cursor: { id: params.cursor } }),
      orderBy: { createdAt: 'desc' },
    });

    const hasNext = items.length > limit;
    const data = hasNext ? items.slice(0, limit) : items;
    const lastItem = data[data.length - 1];
    const nextCursor = hasNext && lastItem ? lastItem.id : null;

    return { data, nextCursor, hasNext };
  }

  /**
   * Cursor-paginated migrations where the subscription appears as source or target.
   */
  async getSubscriptionMigrations(id: string, params: ListMigrationsParams) {
    const limit = params.limit ?? 20;

    // Verify subscription exists
    const exists = await this.prisma.subscription.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!exists) {
      throw new NotFoundException(`Subscription ${id} not found`);
    }

    const items = await this.prisma.subscriptionMigration.findMany({
      where: {
        OR: [
          { fromSubscriptionId: id },
          { toSubscriptionId: id },
        ],
      },
      take: limit + 1,
      ...(params.cursor && { skip: 1, cursor: { id: params.cursor } }),
      orderBy: { createdAt: 'desc' },
    });

    const hasNext = items.length > limit;
    const data = hasNext ? items.slice(0, limit) : items;
    const lastItem = data[data.length - 1];
    const nextCursor = hasNext && lastItem ? lastItem.id : null;

    return { data, nextCursor, hasNext };
  }

  /**
   * Admin force-cancel a subscription immediately.
   */
  async forceCancelSubscription(
    id: string,
    adminUserId: string,
    reason: string,
  ) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id },
      select: { id: true, status: true },
    });

    if (!subscription) {
      throw new NotFoundException(`Subscription ${id} not found`);
    }

    const terminalStatuses = [
      SubscriptionState.CANCELLED,
      SubscriptionState.TERMINATED,
    ];
    if (terminalStatuses.includes(subscription.status as SubscriptionState)) {
      throw new BadRequestException(
        `Subscription is already ${subscription.status}`,
      );
    }

    return this.lifecycleService.executeTransition({
      subscriptionId: id,
      action: SubscriptionAction.CANCEL_IMMEDIATELY,
      actorUserId: adminUserId,
      actorType: 'admin',
      reason,
    });
  }

  /**
   * Extend a trial subscription's end date.
   */
  async extendTrial(id: string, extensionDays: number, adminUserId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id },
      select: { id: true, status: true, organizationId: true },
    });

    if (!subscription) {
      throw new NotFoundException(`Subscription ${id} not found`);
    }

    if (subscription.status !== SubscriptionState.TRIALING) {
      throw new BadRequestException(
        `Cannot extend trial: subscription is ${subscription.status}, not trialing`,
      );
    }

    // Find the active trial record
    const trialRecord = await this.prisma.trialRecord.findFirst({
      where: { subscriptionId: id, status: 'active' },
    });

    if (!trialRecord) {
      throw new NotFoundException(
        `No active trial record found for subscription ${id}`,
      );
    }

    const newTrialEndsAt = new Date(trialRecord.trialEndsAt);
    newTrialEndsAt.setDate(newTrialEndsAt.getDate() + extensionDays);

    const newDurationDays = trialRecord.trialDurationDays + extensionDays;

    // Update trial record + subscription + reschedule lifecycle event + write history
    await this.prisma.$transaction(async (tx) => {
      // 1. Update trial record
      await tx.trialRecord.update({
        where: { id: trialRecord.id },
        data: {
          trialEndsAt: newTrialEndsAt,
          trialDurationDays: newDurationDays,
        },
      });

      // 2. Update subscription trial end
      await tx.subscription.update({
        where: { id },
        data: { trialEnd: newTrialEndsAt },
      });

      // 3. Reschedule pending trial_expiry lifecycle event
      await tx.subscriptionLifecycleEvent.updateMany({
        where: {
          subscriptionId: id,
          eventType: 'trial_expiry',
          status: 'pending',
        },
        data: {
          scheduledAt: newTrialEndsAt,
        },
      });

      // 4. Write history entry
      await tx.subscriptionHistory.create({
        data: {
          subscriptionId: id,
          organizationId: subscription.organizationId,
          action: 'EXTEND_TRIAL',
          fromState: SubscriptionState.TRIALING,
          toState: SubscriptionState.TRIALING,
          actorUserId: adminUserId,
          actorType: 'admin',
          metadataJson: {
            extensionDays,
            previousTrialEndsAt: trialRecord.trialEndsAt.toISOString(),
            newTrialEndsAt: newTrialEndsAt.toISOString(),
            newDurationDays,
          },
        },
      });
    });

    return {
      subscriptionId: id,
      extensionDays,
      previousTrialEndsAt: trialRecord.trialEndsAt,
      newTrialEndsAt,
      newDurationDays,
    };
  }

  /**
   * Change billing period (monthly ↔ annual) for an active subscription.
   */
  async changeBillingPeriod(
    id: string,
    newBillingPeriod: 'monthly' | 'annual',
    adminUserId: string,
  ) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        organizationId: true,
        planCode: true,
        billingPeriod: true,
        currentPeriodStart: true,
        currentPeriodEnd: true,
      },
    });

    if (!subscription) {
      throw new NotFoundException(`Subscription ${id} not found`);
    }

    if (subscription.status !== SubscriptionState.ACTIVE) {
      throw new BadRequestException(
        `Cannot change billing period: subscription is ${subscription.status}, not active`,
      );
    }

    if (subscription.billingPeriod === newBillingPeriod) {
      throw new BadRequestException(
        `Subscription is already on ${newBillingPeriod} billing`,
      );
    }

    const oldBillingPeriod = subscription.billingPeriod;

    // Calculate proration if mid-cycle
    let proration = null;
    if (subscription.currentPeriodStart && subscription.currentPeriodEnd) {
      proration = await this.prorationService.calculateProration({
        organizationId: subscription.organizationId,
        currentPlanCode: subscription.planCode,
        newPlanCode: subscription.planCode,
        billingPeriod: newBillingPeriod,
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd,
      });
    }

    // Calculate new period end based on new billing period
    const now = new Date();
    const newPeriodEnd = new Date(now);
    if (newBillingPeriod === 'annual') {
      newPeriodEnd.setFullYear(newPeriodEnd.getFullYear() + 1);
    } else {
      newPeriodEnd.setMonth(newPeriodEnd.getMonth() + 1);
    }

    await this.prisma.$transaction(async (tx) => {
      // 1. Update subscription billing period
      await tx.subscription.update({
        where: { id },
        data: {
          billingPeriod: newBillingPeriod,
          currentPeriodStart: now,
          currentPeriodEnd: newPeriodEnd,
        },
      });

      // 2. Create migration record
      await tx.subscriptionMigration.create({
        data: {
          organizationId: subscription.organizationId,
          fromSubscriptionId: id,
          toSubscriptionId: id,
          fromPlanCode: subscription.planCode,
          toPlanCode: subscription.planCode,
          direction: newBillingPeriod === 'annual' ? 'upgrade' : 'downgrade',
          fromBillingPeriod: oldBillingPeriod,
          toBillingPeriod: newBillingPeriod,
          proratedCreditAmount: proration?.creditAmount ?? 0,
          proratedChargeAmount: proration?.chargeAmount ?? 0,
          netAmount: proration?.netAmount ?? 0,
          effectiveAt: now,
          status: 'completed',
          initiatedByUserId: adminUserId,
          metadataJson: {
            adminAction: true,
            ...(proration && { proration: proration as unknown as Prisma.InputJsonValue }),
          } as Prisma.InputJsonValue,
        },
      });

      // 3. Write history entry
      await tx.subscriptionHistory.create({
        data: {
          subscriptionId: id,
          organizationId: subscription.organizationId,
          action: 'CHANGE_BILLING_PERIOD',
          fromState: SubscriptionState.ACTIVE,
          toState: SubscriptionState.ACTIVE,
          actorUserId: adminUserId,
          actorType: 'admin',
          metadataJson: {
            fromBillingPeriod: oldBillingPeriod,
            toBillingPeriod: newBillingPeriod,
            ...(proration && { proration: proration as unknown as Prisma.InputJsonValue }),
          } as Prisma.InputJsonValue,
        },
      });

      // 4. Reschedule renewal event
      await tx.subscriptionLifecycleEvent.updateMany({
        where: {
          subscriptionId: id,
          eventType: 'renewal',
          status: 'pending',
        },
        data: {
          scheduledAt: newPeriodEnd,
        },
      });
    });

    return {
      subscriptionId: id,
      fromBillingPeriod: oldBillingPeriod,
      toBillingPeriod: newBillingPeriod,
      newPeriodStart: now,
      newPeriodEnd,
      proration,
    };
  }
}
