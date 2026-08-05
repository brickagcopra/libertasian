import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PlansService } from '../plans/plans.service';
import { SubscriptionsService } from './subscriptions.service';
import {
  type SideEffect,
  SideEffectType,
  SubscriptionAction,
  SubscriptionState,
  type TransitionResult,
  type TransitionSuccess,
  transition,
  isAccessibleState,
} from './subscription-state-machine';

// ---- Public Types ----

export interface ExecuteTransitionParams {
  subscriptionId: string;
  action: SubscriptionAction;
  actorUserId?: string;
  actorType: 'user' | 'admin' | 'system';
  reason?: string;
  metadata?: Record<string, unknown>;
}

export interface TransitionExecutionResult {
  success: true;
  subscriptionId: string;
  fromState: SubscriptionState;
  toState: SubscriptionState;
  action: SubscriptionAction;
}

// ---- Service ----

@Injectable()
export class SubscriptionLifecycleService {
  private readonly logger = new Logger(SubscriptionLifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly plansService: PlansService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Execute a subscription state transition with guard checks and side effects.
   *
   * 1. Load subscription from DB
   * 2. Validate transition via pure state machine
   * 3. Evaluate guard conditions
   * 4. Update status in DB (within Prisma transaction)
   * 5. Execute declared side effects
   */
  async executeTransition(params: ExecuteTransitionParams): Promise<TransitionExecutionResult> {
    const { subscriptionId, action, actorUserId, actorType, reason, metadata } = params;

    // 1. Load subscription
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
    });

    if (!subscription) {
      throw new NotFoundException(`Subscription not found: ${subscriptionId}`);
    }

    const currentState = subscription.status as SubscriptionState;

    // 2. Validate transition
    const result: TransitionResult = transition(currentState, action);

    if (!result.success) {
      throw new BadRequestException(result.error);
    }

    const successResult = result as TransitionSuccess;

    // 3. Evaluate guard conditions
    await this.evaluateGuards(subscription, action, params);

    // 4. Update status in Prisma transaction + execute DB side effects
    await this.prisma.$transaction(async (tx) => {
      // Update subscription status
      const updateData: Prisma.SubscriptionUpdateInput = {
        status: successResult.toState,
      };

      // Set canceledAt for cancel-related transitions
      if (
        action === SubscriptionAction.REQUEST_CANCEL ||
        action === SubscriptionAction.CANCEL_IMMEDIATELY
      ) {
        updateData.canceledAt = new Date();
      }

      // Clear cancelAtPeriodEnd when undoing cancel
      if (action === SubscriptionAction.UNDO_CANCEL) {
        updateData.cancelAtPeriodEnd = false;
        updateData.canceledAt = null;
      }

      // Set cancelAtPeriodEnd for request cancel
      if (action === SubscriptionAction.REQUEST_CANCEL) {
        updateData.cancelAtPeriodEnd = true;
      }

      await tx.subscription.update({
        where: { id: subscriptionId },
        data: updateData,
      });

      // Execute transactional side effects
      await this.executeTransactionalSideEffects(
        tx,
        subscription,
        successResult,
        params,
      );
    });

    // 5. Execute non-transactional side effects (notifications, events)
    await this.executeAsyncSideEffects(subscription, successResult, params);

    this.logger.log(
      `Subscription ${subscriptionId}: ${currentState} → ${successResult.toState} via ${action}`,
    );

    return {
      success: true,
      subscriptionId,
      fromState: currentState,
      toState: successResult.toState,
      action,
    };
  }

  // ---- Guard Conditions ----

  private async evaluateGuards(
    subscription: { id: string; organizationId: string; planCode: string; status: string; cancelAtPeriodEnd: boolean; currentPeriodEnd: Date | null },
    action: SubscriptionAction,
    params: ExecuteTransitionParams,
  ): Promise<void> {
    switch (action) {
      case SubscriptionAction.START_TRIAL: {
        // Guard: no existing TrialRecord for org+plan
        const existingTrial = await this.prisma.trialRecord.findUnique({
          where: {
            organizationId_planCode: {
              organizationId: subscription.organizationId,
              planCode: params.metadata?.['planCode'] as string ?? subscription.planCode,
            },
          },
        });
        if (existingTrial) {
          throw new BadRequestException(
            'Organization has already used a trial for this plan',
          );
        }

        // Guard: plan has trial enabled
        const planCode = params.metadata?.['planCode'] as string ?? subscription.planCode;
        try {
          const plan = await this.plansService.findByCode(planCode);
          if (!plan.trialEnabled) {
            throw new BadRequestException(`Plan "${planCode}" does not support trials`);
          }
        } catch (err) {
          if (err instanceof BadRequestException) throw err;
          throw new BadRequestException(`Plan "${planCode}" not found`);
        }
        break;
      }

      case SubscriptionAction.SUSPEND:
      case SubscriptionAction.TERMINATE: {
        // Guard: actor must be admin or system
        if (params.actorType === 'user') {
          throw new ForbiddenException(
            `Only admin or system can perform ${action}`,
          );
        }
        break;
      }

      case SubscriptionAction.GRANT_COMPLIMENTARY: {
        // Guard: actor must be admin
        if (params.actorType !== 'admin') {
          throw new ForbiddenException(
            'Only admin can grant complimentary access',
          );
        }
        break;
      }

      case SubscriptionAction.REVOKE_COMPLIMENTARY: {
        // Guard: actor must be admin
        if (params.actorType !== 'admin') {
          throw new ForbiddenException(
            'Only admin can revoke complimentary access',
          );
        }
        break;
      }

      case SubscriptionAction.UPGRADE: {
        // Guard: target plan tier > current tier
        const targetPlanCode = params.metadata?.['targetPlanCode'] as string | undefined;
        if (!targetPlanCode) {
          throw new BadRequestException('targetPlanCode is required for upgrade');
        }
        if (!this.isTierHigher(targetPlanCode, subscription.planCode)) {
          throw new BadRequestException(
            `Plan "${targetPlanCode}" is not an upgrade from "${subscription.planCode}"`,
          );
        }
        break;
      }

      case SubscriptionAction.DOWNGRADE: {
        // Guard: target plan tier < current tier
        const targetPlanCode = params.metadata?.['targetPlanCode'] as string | undefined;
        if (!targetPlanCode) {
          throw new BadRequestException('targetPlanCode is required for downgrade');
        }
        if (!this.isTierHigher(subscription.planCode, targetPlanCode)) {
          throw new BadRequestException(
            `Plan "${targetPlanCode}" is not a downgrade from "${subscription.planCode}"`,
          );
        }
        break;
      }

      case SubscriptionAction.PAUSE: {
        // Guard: cannot pause a free plan
        if (subscription.planCode === 'free') {
          throw new BadRequestException('Cannot pause a free plan');
        }
        // Guard: billing period must not have ended
        if (
          subscription.currentPeriodEnd &&
          new Date() > subscription.currentPeriodEnd
        ) {
          throw new BadRequestException(
            'Cannot pause subscription after billing period has ended',
          );
        }
        break;
      }

      case SubscriptionAction.UNDO_CANCEL: {
        // Guard: subscription period hasn't ended yet
        if (
          subscription.currentPeriodEnd &&
          new Date() > subscription.currentPeriodEnd
        ) {
          throw new BadRequestException(
            'Cannot undo cancellation after billing period has ended',
          );
        }
        break;
      }

      default:
        // No additional guards for other actions
        break;
    }
  }

  // ---- Side Effect Execution (transactional) ----

  private async executeTransactionalSideEffects(
    tx: Prisma.TransactionClient,
    subscription: { id: string; organizationId: string; planCode: string; status: string },
    result: TransitionSuccess,
    params: ExecuteTransitionParams,
  ): Promise<void> {
    for (const effect of result.sideEffects) {
      switch (effect.type) {
        case SideEffectType.HISTORY_LOG:
          await this.writeHistoryLog(tx, subscription, result, params);
          break;

        case SideEffectType.SCHEDULE_EVENT:
          await this.scheduleEvent(tx, subscription, effect);
          break;

        case SideEffectType.CANCEL_SCHEDULED_EVENT:
          await this.cancelScheduledEvents(tx, subscription, effect);
          break;

        case SideEffectType.UPDATE_TRIAL_RECORD:
          await this.updateTrialRecord(tx, subscription, result, params, effect);
          break;

        default:
          // Other side effects (AUDIT_LOG, SEND_NOTIFICATION, etc.) handled outside tx
          break;
      }
    }
  }

  // ---- Side Effect Execution (async, non-transactional) ----

  private async executeAsyncSideEffects(
    subscription: { id: string; organizationId: string; planCode: string; status: string },
    result: TransitionSuccess,
    params: ExecuteTransitionParams,
  ): Promise<void> {
    for (const effect of result.sideEffects) {
      switch (effect.type) {
        case SideEffectType.AUDIT_LOG:
          await this.auditService.log({
            organizationId: subscription.organizationId,
            actorUserId: params.actorUserId,
            actorType: params.actorType,
            action: `subscription.${result.action.toLowerCase()}`,
            entityType: 'subscription',
            entityId: subscription.id,
            metadata: {
              fromState: result.fromState,
              toState: result.toState,
              ...(params.reason && { reason: params.reason }),
              ...(params.metadata ?? {}),
            },
          });
          break;

        case SideEffectType.SEND_NOTIFICATION:
          this.eventEmitter.emit('subscription.notification', {
            subscriptionId: subscription.id,
            organizationId: subscription.organizationId,
            template: effect.payload?.['template'],
            fromState: result.fromState,
            toState: result.toState,
            action: result.action,
          });
          break;

        case SideEffectType.UPDATE_ENTITLEMENTS:
          this.eventEmitter.emit('subscription.entitlements_changed', {
            subscriptionId: subscription.id,
            organizationId: subscription.organizationId,
            newState: result.toState,
            hasAccess: isAccessibleState(result.toState),
          });
          break;

        case SideEffectType.RESET_QUOTAS:
          this.eventEmitter.emit('subscription.quotas_reset', {
            subscriptionId: subscription.id,
            organizationId: subscription.organizationId,
          });
          break;

        case SideEffectType.CREATE_MIGRATION_RECORD:
          this.eventEmitter.emit('subscription.migration_started', {
            subscriptionId: subscription.id,
            organizationId: subscription.organizationId,
            metadata: params.metadata,
          });
          break;

        case SideEffectType.PRORATE_PAYMENT:
          this.eventEmitter.emit('subscription.proration_needed', {
            subscriptionId: subscription.id,
            organizationId: subscription.organizationId,
            metadata: params.metadata,
          });
          break;

        case SideEffectType.CREATE_INVOICE:
          this.eventEmitter.emit('subscription.invoice_needed', {
            subscriptionId: subscription.id,
            organizationId: subscription.organizationId,
            action: result.action,
          });
          break;

        default:
          break;
      }
    }
  }

  // ---- Side Effect Helpers ----

  private async writeHistoryLog(
    tx: Prisma.TransactionClient,
    subscription: { id: string; organizationId: string; planCode: string },
    result: TransitionSuccess,
    params: ExecuteTransitionParams,
  ): Promise<void> {
    await tx.subscriptionHistory.create({
      data: {
        subscriptionId: subscription.id,
        organizationId: subscription.organizationId,
        action: result.action,
        fromState: result.fromState,
        toState: result.toState,
        fromPlanCode: subscription.planCode,
        toPlanCode: (params.metadata?.['targetPlanCode'] as string) ?? subscription.planCode,
        reason: params.reason,
        actorUserId: params.actorUserId,
        actorType: params.actorType,
        metadataJson: (params.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });
  }

  private async scheduleEvent(
    tx: Prisma.TransactionClient,
    subscription: { id: string; organizationId: string; providerSubscriptionId?: string | null },
    effect: SideEffect,
  ): Promise<void> {
    const eventType = effect.payload?.['eventType'] as string;

    // DOUBLE-RENEWAL GUARD (defense-in-depth): never schedule the internal
    // `renewal` event for a gateway-backed subscription. The gateway drives the cycle
    // via webhooks; the LifecycleEventProcessor also no-ops any renewal event
    // that slips through, but skipping it here avoids accumulating dead events.
    if (eventType === 'renewal' && subscription.providerSubscriptionId) {
      this.logger.log(
        `Not scheduling internal renewal for gateway-backed subscription ${subscription.id}`,
      );
      return;
    }

    const scheduledAt = await this.calculateScheduledTime(tx, eventType, subscription.id);

    await tx.subscriptionLifecycleEvent.create({
      data: {
        subscriptionId: subscription.id,
        organizationId: subscription.organizationId,
        eventType,
        status: 'pending',
        scheduledAt,
      },
    });
  }

  private async cancelScheduledEvents(
    tx: Prisma.TransactionClient,
    subscription: { id: string },
    effect: SideEffect,
  ): Promise<void> {
    const eventType = effect.payload?.['eventType'] as string;

    const where: Prisma.SubscriptionLifecycleEventWhereInput = {
      subscriptionId: subscription.id,
      status: 'pending',
    };

    // 'all' means cancel all pending events for this subscription
    if (eventType !== 'all') {
      where.eventType = eventType;
    }

    await tx.subscriptionLifecycleEvent.updateMany({
      where,
      data: { status: 'cancelled' },
    });
  }

  private async updateTrialRecord(
    tx: Prisma.TransactionClient,
    subscription: { id: string; organizationId: string; planCode: string },
    result: TransitionSuccess,
    params: ExecuteTransitionParams,
    effect: SideEffect,
  ): Promise<void> {
    const trialStatus = effect.payload?.['status'] as string;

    if (trialStatus === 'active') {
      // Creating a new trial record
      const planCode = (params.metadata?.['planCode'] as string) ?? subscription.planCode;

      let trialDurationDays = 14; // default
      try {
        const plan = await this.plansService.findByCode(planCode);
        if (plan.trialDurationDays > 0) {
          trialDurationDays = plan.trialDurationDays;
        }
      } catch (err) {
        this.logger.warn(
          `Trial-duration plan lookup failed for planCode=${planCode} (using 14-day default): ${err instanceof Error ? err.message : String(err)}`,
        );
        // Use default
      }

      const now = new Date();
      const trialEndsAt = new Date(now);
      trialEndsAt.setDate(trialEndsAt.getDate() + trialDurationDays);

      await tx.trialRecord.create({
        data: {
          organizationId: subscription.organizationId,
          subscriptionId: subscription.id,
          planCode,
          trialStartedAt: now,
          trialEndsAt,
          trialDurationDays,
          status: 'active',
        },
      });
    } else if (trialStatus === 'converted') {
      await tx.trialRecord.updateMany({
        where: {
          subscriptionId: subscription.id,
          status: 'active',
        },
        data: {
          status: 'converted',
          convertedAt: new Date(),
          convertedToPlanCode: (params.metadata?.['targetPlanCode'] as string) ?? subscription.planCode,
        },
      });
    } else if (trialStatus === 'expired') {
      await tx.trialRecord.updateMany({
        where: {
          subscriptionId: subscription.id,
          status: 'active',
        },
        data: {
          status: 'expired',
          expiredAt: new Date(),
        },
      });
    } else if (trialStatus === 'cancelled') {
      await tx.trialRecord.updateMany({
        where: {
          subscriptionId: subscription.id,
          status: 'active',
        },
        data: {
          status: 'cancelled',
          cancelledAt: new Date(),
        },
      });
    }
  }

  private async calculateScheduledTime(
    tx: Prisma.TransactionClient,
    eventType: string,
    subscriptionId: string,
  ): Promise<Date> {
    const sub = await tx.subscription.findUnique({
      where: { id: subscriptionId },
      select: { currentPeriodEnd: true, trialEnd: true },
    });

    switch (eventType) {
      case 'cancellation_end':
      case 'renewal':
        return sub?.currentPeriodEnd ?? new Date(Date.now() + 30 * 86400000);
      case 'trial_expiry':
        return sub?.trialEnd ?? new Date(Date.now() + 14 * 86400000);
      case 'grace_period_end':
        return new Date((sub?.currentPeriodEnd?.getTime() ?? Date.now()) + 7 * 86400000);
      default:
        return new Date(Date.now() + 30 * 86400000);
    }
  }

  // ---- Helpers ----

  private isTierHigher(higherPlan: string, lowerPlan: string): boolean {
    const hierarchy: Record<string, number> = {
      free: 0,
      edu: 1,
      pro: 2,
      team: 3,
      enterprise: 4,
    };
    return (hierarchy[higherPlan] ?? 0) > (hierarchy[lowerPlan] ?? 0);
  }
}
