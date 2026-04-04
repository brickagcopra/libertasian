import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PlansService } from '../plans/plans.service';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionLifecycleService } from './subscription-lifecycle.service';
import { SubscriptionAction, SubscriptionState } from './subscription-state-machine';

describe('SubscriptionLifecycleService', () => {
  let service: SubscriptionLifecycleService;
  let prisma: jest.Mocked<PrismaService>;
  let auditService: jest.Mocked<AuditService>;
  let plansService: jest.Mocked<PlansService>;
  let eventEmitter: jest.Mocked<EventEmitter2>;

  const mockSubscription = {
    id: 'sub-1',
    organizationId: 'org-1',
    planCode: 'pro',
    planId: null,
    status: SubscriptionState.ACTIVE,
    billingPeriod: 'monthly',
    currentPeriodStart: new Date(),
    currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
    seats: 1,
    entitlementsJson: {},
    xenditSubscriptionId: null,
    cancelAtPeriodEnd: false,
    canceledAt: null,
    trialStart: null,
    trialEnd: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockTransactionClient = {
    subscription: { update: jest.fn(), findUnique: jest.fn() },
    subscriptionHistory: { create: jest.fn() },
    subscriptionLifecycleEvent: { create: jest.fn(), updateMany: jest.fn() },
    trialRecord: { create: jest.fn(), updateMany: jest.fn() },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionLifecycleService,
        {
          provide: PrismaService,
          useValue: {
            subscription: { findUnique: jest.fn() },
            trialRecord: { findUnique: jest.fn() },
            $transaction: jest.fn(),
          },
        },
        {
          provide: AuditService,
          useValue: { log: jest.fn() },
        },
        {
          provide: SubscriptionsService,
          useValue: {
            getActiveSubscription: jest.fn(),
            getDefaultEntitlements: jest.fn(),
          },
        },
        {
          provide: PlansService,
          useValue: { findByCode: jest.fn() },
        },
        {
          provide: EventEmitter2,
          useValue: { emit: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<SubscriptionLifecycleService>(SubscriptionLifecycleService);
    prisma = module.get(PrismaService);
    auditService = module.get(AuditService);
    plansService = module.get(PlansService);
    eventEmitter = module.get(EventEmitter2);

    // Default: subscription found, transaction executes
    (prisma.subscription.findUnique as jest.Mock).mockResolvedValue(mockSubscription);
    (prisma.$transaction as jest.Mock).mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
      await fn(mockTransactionClient);
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ====================================================================
  // Happy Path Transitions
  // ====================================================================

  describe('happy path transitions', () => {
    it('ACTIVE → RENEW → ACTIVE', async () => {
      const result = await service.executeTransition({
        subscriptionId: 'sub-1',
        action: SubscriptionAction.RENEW,
        actorType: 'system',
      });

      expect(result.success).toBe(true);
      expect(result.fromState).toBe(SubscriptionState.ACTIVE);
      expect(result.toState).toBe(SubscriptionState.ACTIVE);
      expect(result.action).toBe(SubscriptionAction.RENEW);
    });

    it('ACTIVE → PAYMENT_FAILED → PAST_DUE', async () => {
      const result = await service.executeTransition({
        subscriptionId: 'sub-1',
        action: SubscriptionAction.PAYMENT_FAILED,
        actorType: 'system',
      });

      expect(result.toState).toBe(SubscriptionState.PAST_DUE);
    });

    it('ACTIVE → REQUEST_CANCEL → CANCELLING', async () => {
      const result = await service.executeTransition({
        subscriptionId: 'sub-1',
        action: SubscriptionAction.REQUEST_CANCEL,
        actorUserId: 'user-1',
        actorType: 'user',
      });

      expect(result.toState).toBe(SubscriptionState.CANCELLING);
    });

    it('ACTIVE → CANCEL_IMMEDIATELY → CANCELLED', async () => {
      const result = await service.executeTransition({
        subscriptionId: 'sub-1',
        action: SubscriptionAction.CANCEL_IMMEDIATELY,
        actorUserId: 'user-1',
        actorType: 'user',
      });

      expect(result.toState).toBe(SubscriptionState.CANCELLED);
    });

    it('PROVISIONING → ACTIVATE → ACTIVE', async () => {
      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue({
        ...mockSubscription,
        status: SubscriptionState.PROVISIONING,
      });

      const result = await service.executeTransition({
        subscriptionId: 'sub-1',
        action: SubscriptionAction.ACTIVATE,
        actorType: 'system',
      });

      expect(result.fromState).toBe(SubscriptionState.PROVISIONING);
      expect(result.toState).toBe(SubscriptionState.ACTIVE);
    });

    it('CANCELLING → UNDO_CANCEL → ACTIVE', async () => {
      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue({
        ...mockSubscription,
        status: SubscriptionState.CANCELLING,
      });

      const result = await service.executeTransition({
        subscriptionId: 'sub-1',
        action: SubscriptionAction.UNDO_CANCEL,
        actorUserId: 'user-1',
        actorType: 'user',
      });

      expect(result.toState).toBe(SubscriptionState.ACTIVE);
    });

    it('PAST_DUE → ENTER_GRACE_PERIOD → GRACE_PERIOD', async () => {
      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue({
        ...mockSubscription,
        status: SubscriptionState.PAST_DUE,
      });

      const result = await service.executeTransition({
        subscriptionId: 'sub-1',
        action: SubscriptionAction.ENTER_GRACE_PERIOD,
        actorType: 'system',
      });

      expect(result.toState).toBe(SubscriptionState.GRACE_PERIOD);
    });

    it('GRACE_PERIOD → SUSPEND → SUSPENDED (admin)', async () => {
      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue({
        ...mockSubscription,
        status: SubscriptionState.GRACE_PERIOD,
      });

      const result = await service.executeTransition({
        subscriptionId: 'sub-1',
        action: SubscriptionAction.SUSPEND,
        actorUserId: 'admin-1',
        actorType: 'admin',
      });

      expect(result.toState).toBe(SubscriptionState.SUSPENDED);
    });

    it('SUSPENDED → REACTIVATE → ACTIVE', async () => {
      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue({
        ...mockSubscription,
        status: SubscriptionState.SUSPENDED,
      });

      const result = await service.executeTransition({
        subscriptionId: 'sub-1',
        action: SubscriptionAction.REACTIVATE,
        actorUserId: 'user-1',
        actorType: 'user',
      });

      expect(result.toState).toBe(SubscriptionState.ACTIVE);
    });

    it('ACTIVE → UPGRADE → MIGRATING (with valid target plan)', async () => {
      const result = await service.executeTransition({
        subscriptionId: 'sub-1',
        action: SubscriptionAction.UPGRADE,
        actorUserId: 'user-1',
        actorType: 'user',
        metadata: { targetPlanCode: 'team' },
      });

      expect(result.toState).toBe(SubscriptionState.MIGRATING);
    });

    it('ACTIVE → DOWNGRADE → MIGRATING (with valid target plan)', async () => {
      const result = await service.executeTransition({
        subscriptionId: 'sub-1',
        action: SubscriptionAction.DOWNGRADE,
        actorUserId: 'user-1',
        actorType: 'user',
        metadata: { targetPlanCode: 'edu' },
      });

      expect(result.toState).toBe(SubscriptionState.MIGRATING);
    });

    it('ACTIVE → TERMINATE → TERMINATED (admin)', async () => {
      const result = await service.executeTransition({
        subscriptionId: 'sub-1',
        action: SubscriptionAction.TERMINATE,
        actorUserId: 'admin-1',
        actorType: 'admin',
        reason: 'TOS violation',
      });

      expect(result.toState).toBe(SubscriptionState.TERMINATED);
    });

    it('PROVISIONING → GRANT_COMPLIMENTARY → COMPLIMENTARY (admin)', async () => {
      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue({
        ...mockSubscription,
        status: SubscriptionState.PROVISIONING,
      });

      const result = await service.executeTransition({
        subscriptionId: 'sub-1',
        action: SubscriptionAction.GRANT_COMPLIMENTARY,
        actorUserId: 'admin-1',
        actorType: 'admin',
        reason: 'Partner agreement',
      });

      expect(result.toState).toBe(SubscriptionState.COMPLIMENTARY);
    });

    it('COMPLIMENTARY → REVOKE_COMPLIMENTARY → CANCELLED (admin)', async () => {
      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue({
        ...mockSubscription,
        status: SubscriptionState.COMPLIMENTARY,
      });

      const result = await service.executeTransition({
        subscriptionId: 'sub-1',
        action: SubscriptionAction.REVOKE_COMPLIMENTARY,
        actorUserId: 'admin-1',
        actorType: 'admin',
        reason: 'Partnership ended',
      });

      expect(result.toState).toBe(SubscriptionState.CANCELLED);
    });
  });

  // ====================================================================
  // Trial Flow
  // ====================================================================

  describe('trial flow', () => {
    it('PROVISIONING → START_TRIAL → TRIALING (plan has trial)', async () => {
      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue({
        ...mockSubscription,
        status: SubscriptionState.PROVISIONING,
      });
      (prisma.trialRecord.findUnique as jest.Mock).mockResolvedValue(null);
      (plansService.findByCode as jest.Mock).mockResolvedValue({
        trialEnabled: true,
        trialDurationDays: 14,
      });

      const result = await service.executeTransition({
        subscriptionId: 'sub-1',
        action: SubscriptionAction.START_TRIAL,
        actorType: 'system',
        metadata: { planCode: 'pro' },
      });

      expect(result.toState).toBe(SubscriptionState.TRIALING);
    });

    it('creates trial record on START_TRIAL', async () => {
      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue({
        ...mockSubscription,
        status: SubscriptionState.PROVISIONING,
      });
      (prisma.trialRecord.findUnique as jest.Mock).mockResolvedValue(null);
      (plansService.findByCode as jest.Mock).mockResolvedValue({
        trialEnabled: true,
        trialDurationDays: 14,
      });

      await service.executeTransition({
        subscriptionId: 'sub-1',
        action: SubscriptionAction.START_TRIAL,
        actorType: 'system',
        metadata: { planCode: 'pro' },
      });

      expect(mockTransactionClient.trialRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            subscriptionId: 'sub-1',
            organizationId: 'org-1',
            planCode: 'pro',
            status: 'active',
            trialDurationDays: 14,
          }),
        }),
      );
    });
  });

  // ====================================================================
  // Guard Failures
  // ====================================================================

  describe('guard failures', () => {
    it('throws NotFoundException if subscription not found', async () => {
      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.executeTransition({
          subscriptionId: 'nonexistent',
          action: SubscriptionAction.ACTIVATE,
          actorType: 'system',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException for invalid state transition', async () => {
      // ACTIVE → START_TRIAL is not a valid transition
      await expect(
        service.executeTransition({
          subscriptionId: 'sub-1',
          action: SubscriptionAction.START_TRIAL,
          actorType: 'system',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('blocks re-trial for same plan+org', async () => {
      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue({
        ...mockSubscription,
        status: SubscriptionState.PROVISIONING,
      });
      (prisma.trialRecord.findUnique as jest.Mock).mockResolvedValue({
        id: 'trial-1',
        status: 'expired',
      });

      await expect(
        service.executeTransition({
          subscriptionId: 'sub-1',
          action: SubscriptionAction.START_TRIAL,
          actorType: 'system',
          metadata: { planCode: 'pro' },
        }),
      ).rejects.toThrow('Organization has already used a trial for this plan');
    });

    it('blocks trial when plan has trial disabled', async () => {
      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue({
        ...mockSubscription,
        status: SubscriptionState.PROVISIONING,
      });
      (prisma.trialRecord.findUnique as jest.Mock).mockResolvedValue(null);
      (plansService.findByCode as jest.Mock).mockResolvedValue({
        trialEnabled: false,
        trialDurationDays: 0,
      });

      await expect(
        service.executeTransition({
          subscriptionId: 'sub-1',
          action: SubscriptionAction.START_TRIAL,
          actorType: 'system',
          metadata: { planCode: 'pro' },
        }),
      ).rejects.toThrow('does not support trials');
    });

    it('blocks SUSPEND by non-admin user', async () => {
      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue({
        ...mockSubscription,
        status: SubscriptionState.GRACE_PERIOD,
      });

      await expect(
        service.executeTransition({
          subscriptionId: 'sub-1',
          action: SubscriptionAction.SUSPEND,
          actorUserId: 'user-1',
          actorType: 'user',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('blocks TERMINATE by non-admin user', async () => {
      await expect(
        service.executeTransition({
          subscriptionId: 'sub-1',
          action: SubscriptionAction.TERMINATE,
          actorUserId: 'user-1',
          actorType: 'user',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('blocks GRANT_COMPLIMENTARY by non-admin', async () => {
      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue({
        ...mockSubscription,
        status: SubscriptionState.PROVISIONING,
      });

      await expect(
        service.executeTransition({
          subscriptionId: 'sub-1',
          action: SubscriptionAction.GRANT_COMPLIMENTARY,
          actorType: 'system',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('blocks REVOKE_COMPLIMENTARY by non-admin', async () => {
      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue({
        ...mockSubscription,
        status: SubscriptionState.COMPLIMENTARY,
      });

      await expect(
        service.executeTransition({
          subscriptionId: 'sub-1',
          action: SubscriptionAction.REVOKE_COMPLIMENTARY,
          actorType: 'user',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('blocks UPGRADE without targetPlanCode', async () => {
      await expect(
        service.executeTransition({
          subscriptionId: 'sub-1',
          action: SubscriptionAction.UPGRADE,
          actorType: 'user',
        }),
      ).rejects.toThrow('targetPlanCode is required');
    });

    it('blocks UPGRADE when target is not higher tier', async () => {
      await expect(
        service.executeTransition({
          subscriptionId: 'sub-1',
          action: SubscriptionAction.UPGRADE,
          actorType: 'user',
          metadata: { targetPlanCode: 'edu' }, // edu < pro
        }),
      ).rejects.toThrow('is not an upgrade');
    });

    it('blocks DOWNGRADE without targetPlanCode', async () => {
      await expect(
        service.executeTransition({
          subscriptionId: 'sub-1',
          action: SubscriptionAction.DOWNGRADE,
          actorType: 'user',
        }),
      ).rejects.toThrow('targetPlanCode is required');
    });

    it('blocks DOWNGRADE when target is not lower tier', async () => {
      await expect(
        service.executeTransition({
          subscriptionId: 'sub-1',
          action: SubscriptionAction.DOWNGRADE,
          actorType: 'user',
          metadata: { targetPlanCode: 'team' }, // team > pro
        }),
      ).rejects.toThrow('is not a downgrade');
    });

    it('ACTIVE → PAUSE → SUSPENDED (user)', async () => {
      const result = await service.executeTransition({
        subscriptionId: 'sub-1',
        action: SubscriptionAction.PAUSE,
        actorUserId: 'user-1',
        actorType: 'user',
      });

      expect(result.toState).toBe(SubscriptionState.SUSPENDED);
    });

    it('blocks PAUSE for free plan', async () => {
      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue({
        ...mockSubscription,
        planCode: 'free',
        status: SubscriptionState.ACTIVE,
      });

      await expect(
        service.executeTransition({
          subscriptionId: 'sub-1',
          action: SubscriptionAction.PAUSE,
          actorUserId: 'user-1',
          actorType: 'user',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('blocks PAUSE after billing period has ended', async () => {
      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue({
        ...mockSubscription,
        status: SubscriptionState.ACTIVE,
        currentPeriodEnd: new Date(Date.now() - 24 * 60 * 60 * 1000), // yesterday
      });

      await expect(
        service.executeTransition({
          subscriptionId: 'sub-1',
          action: SubscriptionAction.PAUSE,
          actorUserId: 'user-1',
          actorType: 'user',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('blocks UNDO_CANCEL after period end', async () => {
      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue({
        ...mockSubscription,
        status: SubscriptionState.CANCELLING,
        currentPeriodEnd: new Date(Date.now() - 24 * 60 * 60 * 1000), // yesterday
      });

      await expect(
        service.executeTransition({
          subscriptionId: 'sub-1',
          action: SubscriptionAction.UNDO_CANCEL,
          actorType: 'user',
        }),
      ).rejects.toThrow('Cannot undo cancellation after billing period has ended');
    });
  });

  // ====================================================================
  // Side Effect Execution
  // ====================================================================

  describe('side effect execution', () => {
    it('writes audit log on transition', async () => {
      await service.executeTransition({
        subscriptionId: 'sub-1',
        action: SubscriptionAction.RENEW,
        actorType: 'system',
      });

      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 'org-1',
          actorType: 'system',
          action: 'subscription.renew',
          entityType: 'subscription',
          entityId: 'sub-1',
        }),
      );
    });

    it('writes history log in transaction', async () => {
      await service.executeTransition({
        subscriptionId: 'sub-1',
        action: SubscriptionAction.PAYMENT_FAILED,
        actorType: 'system',
      });

      expect(mockTransactionClient.subscriptionHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            subscriptionId: 'sub-1',
            organizationId: 'org-1',
            action: SubscriptionAction.PAYMENT_FAILED,
            fromState: SubscriptionState.ACTIVE,
            toState: SubscriptionState.PAST_DUE,
          }),
        }),
      );
    });

    it('emits notification event on PAYMENT_FAILED', async () => {
      await service.executeTransition({
        subscriptionId: 'sub-1',
        action: SubscriptionAction.PAYMENT_FAILED,
        actorType: 'system',
      });

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'subscription.notification',
        expect.objectContaining({
          subscriptionId: 'sub-1',
          template: 'payment_failed',
        }),
      );
    });

    it('emits entitlements_changed event when UPDATE_ENTITLEMENTS side effect fires', async () => {
      await service.executeTransition({
        subscriptionId: 'sub-1',
        action: SubscriptionAction.CANCEL_IMMEDIATELY,
        actorType: 'user',
        actorUserId: 'user-1',
      });

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'subscription.entitlements_changed',
        expect.objectContaining({
          subscriptionId: 'sub-1',
          organizationId: 'org-1',
        }),
      );
    });

    it('schedules lifecycle event on RENEW', async () => {
      await service.executeTransition({
        subscriptionId: 'sub-1',
        action: SubscriptionAction.RENEW,
        actorType: 'system',
      });

      expect(mockTransactionClient.subscriptionLifecycleEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            subscriptionId: 'sub-1',
            eventType: 'renewal',
            status: 'pending',
          }),
        }),
      );
    });

    it('cancels scheduled events on TERMINATE', async () => {
      await service.executeTransition({
        subscriptionId: 'sub-1',
        action: SubscriptionAction.TERMINATE,
        actorType: 'admin',
        actorUserId: 'admin-1',
      });

      expect(mockTransactionClient.subscriptionLifecycleEvent.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            subscriptionId: 'sub-1',
            status: 'pending',
          }),
          data: { status: 'cancelled' },
        }),
      );
    });

    it('updates subscription status in transaction', async () => {
      await service.executeTransition({
        subscriptionId: 'sub-1',
        action: SubscriptionAction.PAYMENT_FAILED,
        actorType: 'system',
      });

      expect(mockTransactionClient.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sub-1' },
          data: expect.objectContaining({
            status: SubscriptionState.PAST_DUE,
          }),
        }),
      );
    });

    it('sets cancelAtPeriodEnd on REQUEST_CANCEL', async () => {
      await service.executeTransition({
        subscriptionId: 'sub-1',
        action: SubscriptionAction.REQUEST_CANCEL,
        actorType: 'user',
        actorUserId: 'user-1',
      });

      expect(mockTransactionClient.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            cancelAtPeriodEnd: true,
            canceledAt: expect.any(Date),
          }),
        }),
      );
    });

    it('clears cancelAtPeriodEnd on UNDO_CANCEL', async () => {
      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue({
        ...mockSubscription,
        status: SubscriptionState.CANCELLING,
        cancelAtPeriodEnd: true,
      });

      await service.executeTransition({
        subscriptionId: 'sub-1',
        action: SubscriptionAction.UNDO_CANCEL,
        actorType: 'user',
        actorUserId: 'user-1',
      });

      expect(mockTransactionClient.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            cancelAtPeriodEnd: false,
            canceledAt: null,
          }),
        }),
      );
    });
  });

  // ====================================================================
  // Transaction Rollback
  // ====================================================================

  describe('transaction rollback', () => {
    it('propagates error when transaction fails', async () => {
      (prisma.$transaction as jest.Mock).mockRejectedValue(new Error('DB error'));

      await expect(
        service.executeTransition({
          subscriptionId: 'sub-1',
          action: SubscriptionAction.RENEW,
          actorType: 'system',
        }),
      ).rejects.toThrow('DB error');
    });

    it('does not emit async side effects when transaction fails', async () => {
      (prisma.$transaction as jest.Mock).mockRejectedValue(new Error('DB error'));

      try {
        await service.executeTransition({
          subscriptionId: 'sub-1',
          action: SubscriptionAction.RENEW,
          actorType: 'system',
        });
      } catch {
        // expected
      }

      // Audit log and notification are async side effects — should not fire
      expect(auditService.log).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });
});
