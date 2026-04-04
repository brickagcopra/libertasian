import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SubscriptionLifecycleService } from './subscription-lifecycle.service';
import { SubscriptionsService } from './subscriptions.service';
import { ProrationService, type ProrationResult } from './proration.service';
import { SubscriptionAction, SubscriptionState } from './subscription-state-machine';

// ---- Result Types ----

export interface TrialStartResult {
  subscriptionId: string;
  planCode: string;
  trialEndsAt: Date;
  status: string;
}

export interface TrialConvertResult {
  subscriptionId: string;
  planCode: string;
  billingPeriod: string;
  currentPeriodEnd: Date;
  status: string;
}

export interface PlanChangeResult {
  subscriptionId: string;
  fromPlanCode: string;
  toPlanCode: string;
  direction: 'upgrade' | 'downgrade';
  proration: ProrationResult;
  effectiveAt: Date;
  status: string;
}

export interface PauseResult {
  subscriptionId: string;
  pausedAt: Date;
  status: string;
}

export interface ResumeResult {
  subscriptionId: string;
  resumedAt: Date;
  status: string;
}

export interface ComplimentaryGrantResult {
  subscriptionId: string;
  complimentaryAccessId: string;
  planCode: string;
  organizationId: string;
  status: string;
}

export interface ComplimentaryRevokeResult {
  subscriptionId: string;
  complimentaryAccessId: string;
  status: string;
}

export interface ReactivateResult {
  subscriptionId: string;
  planCode: string;
  status: string;
}

// ---- Service ----

@Injectable()
export class SubscriptionOperationsService {
  private readonly logger = new Logger(SubscriptionOperationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycleService: SubscriptionLifecycleService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly prorationService: ProrationService,
    private readonly auditService: AuditService,
  ) {}

  // ---- Trial Operations ----

  /**
   * Start a trial for an organization on a specific plan.
   * Creates a PROVISIONING subscription then transitions to TRIALING.
   */
  async startTrial(
    organizationId: string,
    planCode: string,
    userId: string,
  ): Promise<TrialStartResult> {
    // Verify no active paid subscription
    const existingSub = await this.subscriptionsService.getActiveSubscription(organizationId);
    if (existingSub && existingSub.planCode !== 'free') {
      throw new BadRequestException(
        'Cannot start a trial while on an active paid subscription',
      );
    }

    // Create provisioning subscription
    const entitlements = this.subscriptionsService.getDefaultEntitlements(planCode);
    const subscription = await this.prisma.subscription.create({
      data: {
        organizationId,
        planCode,
        status: SubscriptionState.PROVISIONING,
        billingPeriod: 'monthly',
        seats: 1,
        entitlementsJson: entitlements as unknown as Prisma.InputJsonValue,
      },
    });

    // Transition PROVISIONING → TRIALING
    await this.lifecycleService.executeTransition({
      subscriptionId: subscription.id,
      action: SubscriptionAction.START_TRIAL,
      actorUserId: userId,
      actorType: 'user',
      metadata: { planCode },
    });

    // Fetch the updated subscription for trial end date
    const updated = await this.prisma.subscription.findUniqueOrThrow({
      where: { id: subscription.id },
    });

    // Get trial record for the trial end date
    const trialRecord = await this.prisma.trialRecord.findFirst({
      where: { subscriptionId: subscription.id, status: 'active' },
    });

    return {
      subscriptionId: subscription.id,
      planCode,
      trialEndsAt: trialRecord?.trialEndsAt ?? new Date(),
      status: updated.status,
    };
  }

  /**
   * Convert an active trial to a paid subscription.
   */
  async convertTrial(
    subscriptionId: string,
    organizationId: string,
    billingPeriod: string,
    userId: string,
  ): Promise<TrialConvertResult> {
    const subscription = await this.getSubscriptionOrThrow(subscriptionId, organizationId);

    if (subscription.status !== SubscriptionState.TRIALING) {
      throw new BadRequestException('Subscription is not in a trial state');
    }

    // Calculate period dates
    const now = new Date();
    const periodEnd = new Date(now);
    if (billingPeriod === 'annual') {
      periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    } else {
      periodEnd.setMonth(periodEnd.getMonth() + 1);
    }

    // Update billing period and period dates before transition
    await this.prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        billingPeriod,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
      },
    });

    // Transition TRIALING → ACTIVE
    await this.lifecycleService.executeTransition({
      subscriptionId,
      action: SubscriptionAction.CONVERT_TRIAL,
      actorUserId: userId,
      actorType: 'user',
      metadata: { billingPeriod, targetPlanCode: subscription.planCode },
    });

    return {
      subscriptionId,
      planCode: subscription.planCode,
      billingPeriod,
      currentPeriodEnd: periodEnd,
      status: SubscriptionState.ACTIVE,
    };
  }

  /**
   * Force-expire a trial (admin/system operation).
   */
  async expireTrial(
    subscriptionId: string,
    actorUserId: string,
    actorType: 'admin' | 'system',
    reason?: string,
  ): Promise<{ subscriptionId: string; status: string }> {
    await this.lifecycleService.executeTransition({
      subscriptionId,
      action: SubscriptionAction.EXPIRE_TRIAL,
      actorUserId,
      actorType,
      reason: reason ?? 'Trial expired',
    });

    return { subscriptionId, status: SubscriptionState.TRIAL_EXPIRED };
  }

  // ---- Plan Change Operations ----

  /**
   * Upgrade to a higher-tier plan. Immediate proration applied.
   */
  async upgradePlan(
    organizationId: string,
    targetPlanCode: string,
    billingPeriod: string | undefined,
    userId: string,
  ): Promise<PlanChangeResult> {
    const subscription = await this.getActiveSubscriptionOrThrow(organizationId);

    const effectiveBillingPeriod = billingPeriod ?? subscription.billingPeriod;

    // Calculate proration
    const proration = await this.prorationService.calculateProration({
      organizationId,
      currentPlanCode: subscription.planCode,
      newPlanCode: targetPlanCode,
      billingPeriod: effectiveBillingPeriod as 'monthly' | 'annual',
      currentPeriodStart: subscription.currentPeriodStart ?? new Date(),
      currentPeriodEnd: subscription.currentPeriodEnd ?? new Date(),
    });

    // Transition ACTIVE → MIGRATING
    await this.lifecycleService.executeTransition({
      subscriptionId: subscription.id,
      action: SubscriptionAction.UPGRADE,
      actorUserId: userId,
      actorType: 'user',
      metadata: {
        targetPlanCode,
        billingPeriod: effectiveBillingPeriod,
        proration,
      },
    });

    // For upgrades: apply immediately
    // Create the migration record
    const now = new Date();
    const periodEnd = new Date(now);
    if (effectiveBillingPeriod === 'annual') {
      periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    } else {
      periodEnd.setMonth(periodEnd.getMonth() + 1);
    }

    const migration = await this.prisma.subscriptionMigration.create({
      data: {
        organizationId,
        fromSubscriptionId: subscription.id,
        toSubscriptionId: subscription.id,
        fromPlanCode: subscription.planCode,
        toPlanCode: targetPlanCode,
        direction: 'upgrade',
        fromBillingPeriod: subscription.billingPeriod,
        toBillingPeriod: effectiveBillingPeriod,
        proratedCreditAmount: proration.creditAmount,
        proratedChargeAmount: proration.chargeAmount,
        netAmount: proration.netAmount,
        effectiveAt: now,
        status: 'completed',
        initiatedByUserId: userId,
        metadataJson: { proration } as unknown as Prisma.InputJsonValue,
      },
    });

    // Update the subscription to the new plan immediately
    const entitlements = this.subscriptionsService.getDefaultEntitlements(targetPlanCode);
    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        planCode: targetPlanCode,
        billingPeriod: effectiveBillingPeriod,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        entitlementsJson: entitlements as unknown as Prisma.InputJsonValue,
      },
    });

    // Transition MIGRATING → ACTIVE
    await this.lifecycleService.executeTransition({
      subscriptionId: subscription.id,
      action: SubscriptionAction.ACTIVATE,
      actorUserId: userId,
      actorType: 'user',
      metadata: {
        targetPlanCode,
        migrationId: migration.id,
      },
    });

    return {
      subscriptionId: subscription.id,
      fromPlanCode: subscription.planCode,
      toPlanCode: targetPlanCode,
      direction: 'upgrade',
      proration,
      effectiveAt: now,
      status: SubscriptionState.ACTIVE,
    };
  }

  /**
   * Downgrade to a lower-tier plan.
   * By default, takes effect at end of current period.
   * Admin can force immediate downgrade via `immediate` flag.
   */
  async downgradePlan(
    organizationId: string,
    targetPlanCode: string,
    billingPeriod: string | undefined,
    immediate: boolean,
    userId: string,
    actorType: 'user' | 'admin' = 'user',
  ): Promise<PlanChangeResult> {
    const subscription = await this.getActiveSubscriptionOrThrow(organizationId);

    const effectiveBillingPeriod = billingPeriod ?? subscription.billingPeriod;

    // Calculate proration
    const proration = await this.prorationService.calculateProration({
      organizationId,
      currentPlanCode: subscription.planCode,
      newPlanCode: targetPlanCode,
      billingPeriod: effectiveBillingPeriod as 'monthly' | 'annual',
      currentPeriodStart: subscription.currentPeriodStart ?? new Date(),
      currentPeriodEnd: subscription.currentPeriodEnd ?? new Date(),
    });

    const effectiveAt = immediate
      ? new Date()
      : subscription.currentPeriodEnd ?? new Date();

    // Transition ACTIVE → MIGRATING
    await this.lifecycleService.executeTransition({
      subscriptionId: subscription.id,
      action: SubscriptionAction.DOWNGRADE,
      actorUserId: userId,
      actorType,
      metadata: {
        targetPlanCode,
        billingPeriod: effectiveBillingPeriod,
        immediate,
        proration,
      },
    });

    // Create migration record
    const migration = await this.prisma.subscriptionMigration.create({
      data: {
        organizationId,
        fromSubscriptionId: subscription.id,
        toSubscriptionId: subscription.id,
        fromPlanCode: subscription.planCode,
        toPlanCode: targetPlanCode,
        direction: 'downgrade',
        fromBillingPeriod: subscription.billingPeriod,
        toBillingPeriod: effectiveBillingPeriod,
        proratedCreditAmount: proration.creditAmount,
        proratedChargeAmount: proration.chargeAmount,
        netAmount: proration.netAmount,
        effectiveAt,
        status: immediate ? 'completed' : 'pending',
        initiatedByUserId: userId,
        metadataJson: { proration, immediate } as unknown as Prisma.InputJsonValue,
      },
    });

    if (immediate) {
      // Apply downgrade immediately
      const entitlements = this.subscriptionsService.getDefaultEntitlements(targetPlanCode);
      await this.prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          planCode: targetPlanCode,
          billingPeriod: effectiveBillingPeriod,
          entitlementsJson: entitlements as unknown as Prisma.InputJsonValue,
        },
      });

      // Transition MIGRATING → ACTIVE
      await this.lifecycleService.executeTransition({
        subscriptionId: subscription.id,
        action: SubscriptionAction.ACTIVATE,
        actorUserId: userId,
        actorType,
        metadata: {
          targetPlanCode,
          migrationId: migration.id,
        },
      });

      return {
        subscriptionId: subscription.id,
        fromPlanCode: subscription.planCode,
        toPlanCode: targetPlanCode,
        direction: 'downgrade',
        proration,
        effectiveAt,
        status: SubscriptionState.ACTIVE,
      };
    }

    // End-of-period downgrade: stay in MIGRATING until lifecycle event fires
    return {
      subscriptionId: subscription.id,
      fromPlanCode: subscription.planCode,
      toPlanCode: targetPlanCode,
      direction: 'downgrade',
      proration,
      effectiveAt,
      status: SubscriptionState.MIGRATING,
    };
  }

  // ---- Pause / Resume ----

  /**
   * Pause an active subscription (user-initiated).
   * Distinct from system SUSPEND — uses PAUSE action.
   */
  async pauseSubscription(
    subscriptionId: string,
    organizationId: string,
    userId: string,
    reason?: string,
  ): Promise<PauseResult> {
    await this.getSubscriptionOrThrow(subscriptionId, organizationId);

    await this.lifecycleService.executeTransition({
      subscriptionId,
      action: SubscriptionAction.PAUSE,
      actorUserId: userId,
      actorType: 'user',
      reason: reason ?? 'User paused subscription',
    });

    return {
      subscriptionId,
      pausedAt: new Date(),
      status: SubscriptionState.SUSPENDED,
    };
  }

  /**
   * Resume a paused (suspended) subscription.
   */
  async resumeSubscription(
    subscriptionId: string,
    organizationId: string,
    userId: string,
  ): Promise<ResumeResult> {
    const subscription = await this.getSubscriptionOrThrow(subscriptionId, organizationId);

    if (subscription.status !== SubscriptionState.SUSPENDED) {
      throw new BadRequestException('Subscription is not paused/suspended');
    }

    await this.lifecycleService.executeTransition({
      subscriptionId,
      action: SubscriptionAction.REACTIVATE,
      actorUserId: userId,
      actorType: 'user',
      reason: 'User resumed subscription',
    });

    return {
      subscriptionId,
      resumedAt: new Date(),
      status: SubscriptionState.ACTIVE,
    };
  }

  // ---- Complimentary Access ----

  /**
   * Grant complimentary access to an organization (admin only).
   */
  async grantComplimentary(
    organizationId: string,
    planCode: string,
    reason: string,
    grantedByUserId: string,
    endsAt?: string,
  ): Promise<ComplimentaryGrantResult> {
    // Create provisioning subscription
    const entitlements = this.subscriptionsService.getDefaultEntitlements(planCode);
    const subscription = await this.prisma.subscription.create({
      data: {
        organizationId,
        planCode,
        status: SubscriptionState.PROVISIONING,
        billingPeriod: 'monthly',
        seats: 1,
        entitlementsJson: entitlements as unknown as Prisma.InputJsonValue,
      },
    });

    // Transition PROVISIONING → COMPLIMENTARY
    await this.lifecycleService.executeTransition({
      subscriptionId: subscription.id,
      action: SubscriptionAction.GRANT_COMPLIMENTARY,
      actorUserId: grantedByUserId,
      actorType: 'admin',
      reason,
      metadata: { planCode, endsAt },
    });

    // Create ComplimentaryAccess record
    const complimentaryAccess = await this.prisma.complimentaryAccess.create({
      data: {
        organizationId,
        subscriptionId: subscription.id,
        planCode,
        grantedByUserId,
        reason,
        startsAt: new Date(),
        endsAt: endsAt ? new Date(endsAt) : null,
        status: 'active',
      },
    });

    return {
      subscriptionId: subscription.id,
      complimentaryAccessId: complimentaryAccess.id,
      planCode,
      organizationId,
      status: SubscriptionState.COMPLIMENTARY,
    };
  }

  /**
   * Revoke complimentary access (admin only).
   */
  async revokeComplimentary(
    subscriptionId: string,
    revokedByUserId: string,
    reason: string,
  ): Promise<ComplimentaryRevokeResult> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
    });

    if (!subscription) {
      throw new NotFoundException(`Subscription not found: ${subscriptionId}`);
    }

    if (subscription.status !== SubscriptionState.COMPLIMENTARY) {
      throw new BadRequestException('Subscription is not complimentary');
    }

    // Transition COMPLIMENTARY → CANCELLED
    await this.lifecycleService.executeTransition({
      subscriptionId,
      action: SubscriptionAction.REVOKE_COMPLIMENTARY,
      actorUserId: revokedByUserId,
      actorType: 'admin',
      reason,
    });

    // Update ComplimentaryAccess record
    const complimentaryAccess = await this.prisma.complimentaryAccess.findFirst({
      where: { subscriptionId, status: 'active' },
    });

    if (complimentaryAccess) {
      await this.prisma.complimentaryAccess.update({
        where: { id: complimentaryAccess.id },
        data: {
          status: 'revoked',
          revokedAt: new Date(),
          revokedByUserId,
          revokeReason: reason,
        },
      });
    }

    return {
      subscriptionId,
      complimentaryAccessId: complimentaryAccess?.id ?? '',
      status: SubscriptionState.CANCELLED,
    };
  }

  // ---- Reactivation ----

  /**
   * Reactivate a cancelled subscription.
   */
  async reactivateSubscription(
    subscriptionId: string,
    organizationId: string,
    userId: string,
  ): Promise<ReactivateResult> {
    const subscription = await this.getSubscriptionOrThrow(subscriptionId, organizationId);

    if (subscription.status !== SubscriptionState.CANCELLED) {
      throw new BadRequestException('Subscription is not cancelled');
    }

    // Set new period dates
    const now = new Date();
    const periodEnd = new Date(now);
    if (subscription.billingPeriod === 'annual') {
      periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    } else {
      periodEnd.setMonth(periodEnd.getMonth() + 1);
    }

    await this.prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
        canceledAt: null,
      },
    });

    await this.lifecycleService.executeTransition({
      subscriptionId,
      action: SubscriptionAction.REACTIVATE,
      actorUserId: userId,
      actorType: 'user',
      reason: 'User reactivated subscription',
    });

    return {
      subscriptionId,
      planCode: subscription.planCode,
      status: SubscriptionState.ACTIVE,
    };
  }

  // ---- Private Helpers ----

  private async getSubscriptionOrThrow(subscriptionId: string, organizationId: string) {
    const subscription = await this.prisma.subscription.findFirst({
      where: { id: subscriptionId, organizationId },
    });

    if (!subscription) {
      throw new NotFoundException(`Subscription not found: ${subscriptionId}`);
    }

    return subscription;
  }

  private async getActiveSubscriptionOrThrow(organizationId: string) {
    const subscription = await this.subscriptionsService.getActiveSubscription(organizationId);

    if (!subscription) {
      throw new NotFoundException('No active subscription found');
    }

    return subscription;
  }
}
