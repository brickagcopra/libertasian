import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SubscriptionLifecycleService } from './subscription-lifecycle.service';
import { SubscriptionsService } from './subscriptions.service';
import { ProrationService } from './proration.service';
import { SubscriptionOperationsService } from './subscription-operations.service';
import { SubscriptionAction, SubscriptionState } from './subscription-state-machine';

describe('SubscriptionOperationsService', () => {
  let service: SubscriptionOperationsService;
  let prisma: jest.Mocked<PrismaService>;
  let lifecycleService: jest.Mocked<SubscriptionLifecycleService>;
  let subscriptionsService: jest.Mocked<SubscriptionsService>;
  let prorationService: jest.Mocked<ProrationService>;

  const orgId = 'org-1';
  const userId = 'user-1';
  const adminId = 'admin-1';
  const subId = 'sub-1';

  const mockSubscription = {
    id: subId,
    organizationId: orgId,
    planCode: 'pro',
    planId: null,
    status: SubscriptionState.ACTIVE,
    billingPeriod: 'monthly',
    currentPeriodStart: new Date('2026-03-01'),
    currentPeriodEnd: new Date('2026-03-31'),
    seats: 1,
    entitlementsJson: {},
    providerSubscriptionId: null,
    cancelAtPeriodEnd: false,
    canceledAt: null,
    trialStart: null,
    trialEnd: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockProration = {
    creditAmount: 49950,
    chargeAmount: 124950,
    netAmount: 75000,
    currency: 'PHP',
    daysRemaining: 15,
    totalDays: 30,
    currentDailyRate: 3330,
    newDailyRate: 8330,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionOperationsService,
        {
          provide: PrismaService,
          useValue: {
            subscription: {
              create: jest.fn(),
              findFirst: jest.fn(),
              findUnique: jest.fn(),
              findUniqueOrThrow: jest.fn(),
              update: jest.fn(),
            },
            trialRecord: { findFirst: jest.fn() },
            subscriptionMigration: { create: jest.fn() },
            complimentaryAccess: {
              create: jest.fn(),
              findFirst: jest.fn(),
              update: jest.fn(),
            },
          },
        },
        {
          provide: SubscriptionLifecycleService,
          useValue: { executeTransition: jest.fn() },
        },
        {
          provide: SubscriptionsService,
          useValue: {
            getActiveSubscription: jest.fn(),
            getDefaultEntitlements: jest.fn().mockReturnValue({ ai_answers: 200 }),
          },
        },
        {
          provide: ProrationService,
          useValue: { calculateProration: jest.fn() },
        },
        {
          provide: AuditService,
          useValue: { log: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<SubscriptionOperationsService>(SubscriptionOperationsService);
    prisma = module.get(PrismaService);
    lifecycleService = module.get(SubscriptionLifecycleService);
    subscriptionsService = module.get(SubscriptionsService);
    prorationService = module.get(ProrationService);

    // Common mocks
    (lifecycleService.executeTransition as jest.Mock).mockResolvedValue({
      success: true,
      fromState: SubscriptionState.ACTIVE,
      toState: SubscriptionState.ACTIVE,
      action: SubscriptionAction.RENEW,
      sideEffects: [],
    });
    (prorationService.calculateProration as jest.Mock).mockResolvedValue(mockProration);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ====================================================================
  // startTrial
  // ====================================================================

  describe('startTrial', () => {
    beforeEach(() => {
      (subscriptionsService.getActiveSubscription as jest.Mock).mockResolvedValue(null);
      (prisma.subscription.create as jest.Mock).mockResolvedValue({
        ...mockSubscription,
        id: 'new-sub-1',
        status: SubscriptionState.PROVISIONING,
      });
      (prisma.subscription.findUniqueOrThrow as jest.Mock).mockResolvedValue({
        ...mockSubscription,
        id: 'new-sub-1',
        status: SubscriptionState.TRIALING,
      });
      (prisma.trialRecord.findFirst as jest.Mock).mockResolvedValue({
        trialEndsAt: new Date('2026-04-01'),
      });
    });

    it('creates subscription and transitions to TRIALING', async () => {
      const result = await service.startTrial(orgId, 'pro', userId);

      expect(prisma.subscription.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organizationId: orgId,
            planCode: 'pro',
            status: SubscriptionState.PROVISIONING,
          }),
        }),
      );
      expect(lifecycleService.executeTransition).toHaveBeenCalledWith(
        expect.objectContaining({
          action: SubscriptionAction.START_TRIAL,
          actorUserId: userId,
        }),
      );
      expect(result.subscriptionId).toBe('new-sub-1');
      expect(result.planCode).toBe('pro');
      expect(result.status).toBe(SubscriptionState.TRIALING);
    });

    it('returns trial end date from trialRecord', async () => {
      const result = await service.startTrial(orgId, 'pro', userId);

      expect(result.trialEndsAt).toEqual(new Date('2026-04-01'));
    });

    it('throws if user already has active paid subscription', async () => {
      (subscriptionsService.getActiveSubscription as jest.Mock).mockResolvedValue({
        ...mockSubscription,
        planCode: 'pro',
      });

      await expect(service.startTrial(orgId, 'pro', userId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('allows trial if existing subscription is free', async () => {
      (subscriptionsService.getActiveSubscription as jest.Mock).mockResolvedValue({
        ...mockSubscription,
        planCode: 'free',
      });

      const result = await service.startTrial(orgId, 'pro', userId);
      expect(result.subscriptionId).toBe('new-sub-1');
    });
  });

  // ====================================================================
  // convertTrial
  // ====================================================================

  describe('convertTrial', () => {
    beforeEach(() => {
      (prisma.subscription.findFirst as jest.Mock).mockResolvedValue({
        ...mockSubscription,
        status: SubscriptionState.TRIALING,
      });
      (prisma.subscription.update as jest.Mock).mockResolvedValue({});
    });

    it('converts trial to active with monthly billing', async () => {
      const result = await service.convertTrial(subId, orgId, 'monthly', userId);

      expect(prisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: subId },
          data: expect.objectContaining({ billingPeriod: 'monthly' }),
        }),
      );
      expect(lifecycleService.executeTransition).toHaveBeenCalledWith(
        expect.objectContaining({
          action: SubscriptionAction.CONVERT_TRIAL,
        }),
      );
      expect(result.status).toBe(SubscriptionState.ACTIVE);
      expect(result.billingPeriod).toBe('monthly');
    });

    it('converts trial to active with annual billing', async () => {
      const result = await service.convertTrial(subId, orgId, 'annual', userId);

      expect(result.billingPeriod).toBe('annual');
      expect(result.currentPeriodEnd.getTime()).toBeGreaterThan(Date.now());
    });

    it('throws if subscription is not in TRIALING state', async () => {
      (prisma.subscription.findFirst as jest.Mock).mockResolvedValue({
        ...mockSubscription,
        status: SubscriptionState.ACTIVE,
      });

      await expect(
        service.convertTrial(subId, orgId, 'monthly', userId),
      ).rejects.toThrow('not in a trial state');
    });

    it('throws if subscription not found', async () => {
      (prisma.subscription.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.convertTrial(subId, orgId, 'monthly', userId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ====================================================================
  // expireTrial
  // ====================================================================

  describe('expireTrial', () => {
    it('transitions subscription to TRIAL_EXPIRED', async () => {
      const result = await service.expireTrial(subId, adminId, 'admin', 'Expired by admin');

      expect(lifecycleService.executeTransition).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriptionId: subId,
          action: SubscriptionAction.EXPIRE_TRIAL,
          actorUserId: adminId,
          actorType: 'admin',
          reason: 'Expired by admin',
        }),
      );
      expect(result.status).toBe(SubscriptionState.TRIAL_EXPIRED);
    });

    it('uses default reason when none provided', async () => {
      await service.expireTrial(subId, adminId, 'system');

      expect(lifecycleService.executeTransition).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: 'Trial expired',
        }),
      );
    });
  });

  // ====================================================================
  // upgradePlan
  // ====================================================================

  describe('upgradePlan', () => {
    beforeEach(() => {
      (subscriptionsService.getActiveSubscription as jest.Mock).mockResolvedValue(mockSubscription);
      (prisma.subscriptionMigration.create as jest.Mock).mockResolvedValue({ id: 'mig-1' });
      (prisma.subscription.update as jest.Mock).mockResolvedValue({});
    });

    it('upgrades plan with proration and transitions through MIGRATING → ACTIVE', async () => {
      const result = await service.upgradePlan(orgId, 'team', undefined, userId);

      // Should calculate proration
      expect(prorationService.calculateProration).toHaveBeenCalledWith(
        expect.objectContaining({
          currentPlanCode: 'pro',
          newPlanCode: 'team',
          billingPeriod: 'monthly',
        }),
      );

      // Two transitions: ACTIVE → MIGRATING, then MIGRATING → ACTIVE
      expect(lifecycleService.executeTransition).toHaveBeenCalledTimes(2);
      expect(lifecycleService.executeTransition).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ action: SubscriptionAction.UPGRADE }),
      );
      expect(lifecycleService.executeTransition).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ action: SubscriptionAction.ACTIVATE }),
      );

      expect(result.direction).toBe('upgrade');
      expect(result.fromPlanCode).toBe('pro');
      expect(result.toPlanCode).toBe('team');
      expect(result.proration).toEqual(mockProration);
      expect(result.status).toBe(SubscriptionState.ACTIVE);
    });

    it('creates migration record with proration details', async () => {
      await service.upgradePlan(orgId, 'team', undefined, userId);

      expect(prisma.subscriptionMigration.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            fromPlanCode: 'pro',
            toPlanCode: 'team',
            direction: 'upgrade',
            proratedCreditAmount: mockProration.creditAmount,
            proratedChargeAmount: mockProration.chargeAmount,
            netAmount: mockProration.netAmount,
            status: 'completed',
          }),
        }),
      );
    });

    it('uses override billing period when provided', async () => {
      await service.upgradePlan(orgId, 'team', 'annual', userId);

      expect(prorationService.calculateProration).toHaveBeenCalledWith(
        expect.objectContaining({ billingPeriod: 'annual' }),
      );
    });

    it('throws if no active subscription', async () => {
      (subscriptionsService.getActiveSubscription as jest.Mock).mockResolvedValue(null);

      await expect(
        service.upgradePlan(orgId, 'team', undefined, userId),
      ).rejects.toThrow(NotFoundException);
    });

    it('updates subscription with new plan entitlements', async () => {
      await service.upgradePlan(orgId, 'team', undefined, userId);

      expect(prisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            planCode: 'team',
            entitlementsJson: { ai_answers: 200 },
          }),
        }),
      );
    });
  });

  // ====================================================================
  // downgradePlan
  // ====================================================================

  describe('downgradePlan', () => {
    beforeEach(() => {
      (subscriptionsService.getActiveSubscription as jest.Mock).mockResolvedValue(mockSubscription);
      (prisma.subscriptionMigration.create as jest.Mock).mockResolvedValue({ id: 'mig-2' });
      (prisma.subscription.update as jest.Mock).mockResolvedValue({});
    });

    it('schedules end-of-period downgrade by default', async () => {
      const result = await service.downgradePlan(orgId, 'edu', undefined, false, userId);

      expect(prisma.subscriptionMigration.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            direction: 'downgrade',
            status: 'pending',
          }),
        }),
      );

      // Only 1 transition: ACTIVE → MIGRATING (no immediate ACTIVATE)
      expect(lifecycleService.executeTransition).toHaveBeenCalledTimes(1);
      expect(result.status).toBe(SubscriptionState.MIGRATING);
      expect(result.direction).toBe('downgrade');
    });

    it('applies immediate downgrade when flag is set', async () => {
      const result = await service.downgradePlan(orgId, 'edu', undefined, true, userId);

      expect(prisma.subscriptionMigration.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'completed',
          }),
        }),
      );

      // Two transitions: ACTIVE → MIGRATING, MIGRATING → ACTIVE
      expect(lifecycleService.executeTransition).toHaveBeenCalledTimes(2);
      expect(prisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ planCode: 'edu' }),
        }),
      );
      expect(result.status).toBe(SubscriptionState.ACTIVE);
    });

    it('calculates proration for downgrade', async () => {
      await service.downgradePlan(orgId, 'edu', undefined, false, userId);

      expect(prorationService.calculateProration).toHaveBeenCalledWith(
        expect.objectContaining({
          currentPlanCode: 'pro',
          newPlanCode: 'edu',
        }),
      );
    });

    it('throws if no active subscription', async () => {
      (subscriptionsService.getActiveSubscription as jest.Mock).mockResolvedValue(null);

      await expect(
        service.downgradePlan(orgId, 'edu', undefined, false, userId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ====================================================================
  // pauseSubscription
  // ====================================================================

  describe('pauseSubscription', () => {
    beforeEach(() => {
      (prisma.subscription.findFirst as jest.Mock).mockResolvedValue(mockSubscription);
    });

    it('pauses an active subscription', async () => {
      const result = await service.pauseSubscription(subId, orgId, userId, 'Going on vacation');

      expect(lifecycleService.executeTransition).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriptionId: subId,
          action: SubscriptionAction.PAUSE,
          actorUserId: userId,
          actorType: 'user',
          reason: 'Going on vacation',
        }),
      );
      expect(result.status).toBe(SubscriptionState.SUSPENDED);
      expect(result.pausedAt).toBeInstanceOf(Date);
    });

    it('uses default reason when none provided', async () => {
      await service.pauseSubscription(subId, orgId, userId);

      expect(lifecycleService.executeTransition).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: 'User paused subscription',
        }),
      );
    });

    it('throws if subscription not found', async () => {
      (prisma.subscription.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.pauseSubscription(subId, orgId, userId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ====================================================================
  // resumeSubscription
  // ====================================================================

  describe('resumeSubscription', () => {
    beforeEach(() => {
      (prisma.subscription.findFirst as jest.Mock).mockResolvedValue({
        ...mockSubscription,
        status: SubscriptionState.SUSPENDED,
      });
    });

    it('resumes a suspended subscription', async () => {
      const result = await service.resumeSubscription(subId, orgId, userId);

      expect(lifecycleService.executeTransition).toHaveBeenCalledWith(
        expect.objectContaining({
          subscriptionId: subId,
          action: SubscriptionAction.REACTIVATE,
          actorUserId: userId,
          reason: 'User resumed subscription',
        }),
      );
      expect(result.status).toBe(SubscriptionState.ACTIVE);
      expect(result.resumedAt).toBeInstanceOf(Date);
    });

    it('throws if subscription is not SUSPENDED', async () => {
      (prisma.subscription.findFirst as jest.Mock).mockResolvedValue(mockSubscription);

      await expect(
        service.resumeSubscription(subId, orgId, userId),
      ).rejects.toThrow('not paused/suspended');
    });

    it('throws if subscription not found', async () => {
      (prisma.subscription.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.resumeSubscription(subId, orgId, userId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ====================================================================
  // grantComplimentary
  // ====================================================================

  describe('grantComplimentary', () => {
    beforeEach(() => {
      (prisma.subscription.create as jest.Mock).mockResolvedValue({
        ...mockSubscription,
        id: 'comp-sub-1',
        status: SubscriptionState.PROVISIONING,
      });
      (prisma.complimentaryAccess.create as jest.Mock).mockResolvedValue({
        id: 'comp-1',
      });
    });

    it('creates subscription and complimentary access record', async () => {
      const result = await service.grantComplimentary(
        orgId,
        'pro',
        'Partner deal',
        adminId,
      );

      expect(prisma.subscription.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organizationId: orgId,
            planCode: 'pro',
            status: SubscriptionState.PROVISIONING,
          }),
        }),
      );
      expect(lifecycleService.executeTransition).toHaveBeenCalledWith(
        expect.objectContaining({
          action: SubscriptionAction.GRANT_COMPLIMENTARY,
          actorType: 'admin',
        }),
      );
      expect(prisma.complimentaryAccess.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organizationId: orgId,
            planCode: 'pro',
            grantedByUserId: adminId,
            reason: 'Partner deal',
            status: 'active',
          }),
        }),
      );
      expect(result.status).toBe(SubscriptionState.COMPLIMENTARY);
      expect(result.complimentaryAccessId).toBe('comp-1');
    });

    it('handles optional endsAt date', async () => {
      await service.grantComplimentary(
        orgId,
        'pro',
        'Temporary access',
        adminId,
        '2026-06-01',
      );

      expect(prisma.complimentaryAccess.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            endsAt: new Date('2026-06-01'),
          }),
        }),
      );
    });

    it('sets endsAt to null when not provided', async () => {
      await service.grantComplimentary(orgId, 'pro', 'Permanent', adminId);

      expect(prisma.complimentaryAccess.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            endsAt: null,
          }),
        }),
      );
    });
  });

  // ====================================================================
  // revokeComplimentary
  // ====================================================================

  describe('revokeComplimentary', () => {
    beforeEach(() => {
      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue({
        ...mockSubscription,
        status: SubscriptionState.COMPLIMENTARY,
      });
      (prisma.complimentaryAccess.findFirst as jest.Mock).mockResolvedValue({
        id: 'comp-1',
        status: 'active',
      });
      (prisma.complimentaryAccess.update as jest.Mock).mockResolvedValue({});
    });

    it('revokes complimentary access and cancels subscription', async () => {
      const result = await service.revokeComplimentary(subId, adminId, 'Partnership ended');

      expect(lifecycleService.executeTransition).toHaveBeenCalledWith(
        expect.objectContaining({
          action: SubscriptionAction.REVOKE_COMPLIMENTARY,
          actorType: 'admin',
          reason: 'Partnership ended',
        }),
      );
      expect(prisma.complimentaryAccess.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'comp-1' },
          data: expect.objectContaining({
            status: 'revoked',
            revokedByUserId: adminId,
            revokeReason: 'Partnership ended',
          }),
        }),
      );
      expect(result.status).toBe(SubscriptionState.CANCELLED);
      expect(result.complimentaryAccessId).toBe('comp-1');
    });

    it('throws if subscription not found', async () => {
      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.revokeComplimentary(subId, adminId, 'reason'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws if subscription is not complimentary', async () => {
      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue(mockSubscription);

      await expect(
        service.revokeComplimentary(subId, adminId, 'reason'),
      ).rejects.toThrow('not complimentary');
    });

    it('handles missing complimentary access record gracefully', async () => {
      (prisma.complimentaryAccess.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await service.revokeComplimentary(subId, adminId, 'reason');

      expect(prisma.complimentaryAccess.update).not.toHaveBeenCalled();
      expect(result.complimentaryAccessId).toBe('');
    });
  });

  // ====================================================================
  // reactivateSubscription
  // ====================================================================

  describe('reactivateSubscription', () => {
    beforeEach(() => {
      (prisma.subscription.findFirst as jest.Mock).mockResolvedValue({
        ...mockSubscription,
        status: SubscriptionState.CANCELLED,
      });
      (prisma.subscription.update as jest.Mock).mockResolvedValue({});
    });

    it('reactivates a cancelled subscription with new period', async () => {
      const result = await service.reactivateSubscription(subId, orgId, userId);

      expect(prisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: subId },
          data: expect.objectContaining({
            cancelAtPeriodEnd: false,
            canceledAt: null,
          }),
        }),
      );
      expect(lifecycleService.executeTransition).toHaveBeenCalledWith(
        expect.objectContaining({
          action: SubscriptionAction.REACTIVATE,
          reason: 'User reactivated subscription',
        }),
      );
      expect(result.status).toBe(SubscriptionState.ACTIVE);
      expect(result.planCode).toBe('pro');
    });

    it('throws if subscription is not CANCELLED', async () => {
      (prisma.subscription.findFirst as jest.Mock).mockResolvedValue(mockSubscription);

      await expect(
        service.reactivateSubscription(subId, orgId, userId),
      ).rejects.toThrow('not cancelled');
    });

    it('throws if subscription not found', async () => {
      (prisma.subscription.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.reactivateSubscription(subId, orgId, userId),
      ).rejects.toThrow(NotFoundException);
    });

    it('sets annual period end for annual billing', async () => {
      (prisma.subscription.findFirst as jest.Mock).mockResolvedValue({
        ...mockSubscription,
        status: SubscriptionState.CANCELLED,
        billingPeriod: 'annual',
      });

      await service.reactivateSubscription(subId, orgId, userId);

      const updateCall = (prisma.subscription.update as jest.Mock).mock.calls[0][0];
      const periodEnd: Date = updateCall.data.currentPeriodEnd;
      const periodStart: Date = updateCall.data.currentPeriodStart;

      // Annual: period end should be ~1 year from start
      const diffMs = periodEnd.getTime() - periodStart.getTime();
      const diffDays = diffMs / (24 * 60 * 60 * 1000);
      expect(diffDays).toBeGreaterThanOrEqual(360);
      expect(diffDays).toBeLessThanOrEqual(370);
    });
  });
});
