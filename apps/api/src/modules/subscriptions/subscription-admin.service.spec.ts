import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { SubscriptionAdminService } from './subscription-admin.service';
import { SubscriptionLifecycleService } from './subscription-lifecycle.service';
import { ProrationService } from './proration.service';
import { SubscriptionAction, SubscriptionState } from './subscription-state-machine';

describe('SubscriptionAdminService', () => {
  let service: SubscriptionAdminService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let lifecycleService: jest.Mocked<SubscriptionLifecycleService>;
  let prorationService: jest.Mocked<ProrationService>;

  const mockSubscription = {
    id: 'sub-1',
    organizationId: 'org-1',
    planCode: 'pro',
    planId: 'plan-1',
    status: 'active',
    billingPeriod: 'monthly',
    currentPeriodStart: new Date('2026-01-01'),
    currentPeriodEnd: new Date('2026-02-01'),
    createdAt: new Date('2025-06-01'),
    organization: { id: 'org-1', name: 'Test Org', slug: 'test-org' },
    plan: { id: 'plan-1', name: 'Pro', code: 'pro' },
  };

  const mockProration = {
    creditAmount: 5000,
    chargeAmount: 15000,
    netAmount: 10000,
    currency: 'PHP',
    daysRemaining: 15,
    totalDays: 30,
    currentDailyRate: 333,
    newDailyRate: 1000,
  };

  beforeEach(async () => {
    prisma = {
      subscription: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      subscriptionHistory: {
        findMany: jest.fn(),
        create: jest.fn(),
      },
      subscriptionMigration: {
        findMany: jest.fn(),
        create: jest.fn(),
      },
      subscriptionLifecycleEvent: {
        updateMany: jest.fn(),
      },
      trialRecord: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn((fn: (tx: any) => Promise<any>) => fn(prisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionAdminService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: SubscriptionLifecycleService,
          useValue: { executeTransition: jest.fn() },
        },
        {
          provide: ProrationService,
          useValue: { calculateProration: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<SubscriptionAdminService>(SubscriptionAdminService);
    lifecycleService = module.get(SubscriptionLifecycleService);
    prorationService = module.get(ProrationService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ========== listSubscriptions ==========

  describe('listSubscriptions', () => {
    it('should return paginated subscriptions with default limit', async () => {
      const items = Array.from({ length: 21 }, (_, i) => ({
        ...mockSubscription,
        id: `sub-${i}`,
      }));
      prisma.subscription.findMany.mockResolvedValue(items);

      const result = await service.listSubscriptions({});

      expect(prisma.subscription.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 21,
          orderBy: { createdAt: 'desc' },
        }),
      );
      expect(result.data).toHaveLength(20);
      expect(result.hasNext).toBe(true);
      expect(result.nextCursor).toBe('sub-19');
    });

    it('should return hasNext false when fewer items than limit', async () => {
      prisma.subscription.findMany.mockResolvedValue([mockSubscription]);

      const result = await service.listSubscriptions({ limit: 20 });

      expect(result.data).toHaveLength(1);
      expect(result.hasNext).toBe(false);
      expect(result.nextCursor).toBeNull();
    });

    it('should apply status filter', async () => {
      prisma.subscription.findMany.mockResolvedValue([]);

      await service.listSubscriptions({ status: 'active' });

      expect(prisma.subscription.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'active' }),
        }),
      );
    });

    it('should apply planCode filter', async () => {
      prisma.subscription.findMany.mockResolvedValue([]);

      await service.listSubscriptions({ planCode: 'pro' });

      expect(prisma.subscription.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ planCode: 'pro' }),
        }),
      );
    });

    it('should apply organizationId filter', async () => {
      prisma.subscription.findMany.mockResolvedValue([]);

      await service.listSubscriptions({ organizationId: 'org-1' });

      expect(prisma.subscription.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organizationId: 'org-1' }),
        }),
      );
    });

    it('should apply search filter on organization name', async () => {
      prisma.subscription.findMany.mockResolvedValue([]);

      await service.listSubscriptions({ search: 'Test' });

      expect(prisma.subscription.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organization: { name: { contains: 'Test', mode: 'insensitive' } },
          }),
        }),
      );
    });

    it('should use cursor for pagination', async () => {
      prisma.subscription.findMany.mockResolvedValue([]);

      await service.listSubscriptions({ cursor: 'sub-5' });

      expect(prisma.subscription.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 1,
          cursor: { id: 'sub-5' },
        }),
      );
    });

    it('should include organization and plan data', async () => {
      prisma.subscription.findMany.mockResolvedValue([]);

      await service.listSubscriptions({});

      expect(prisma.subscription.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            organization: { select: { id: true, name: true, slug: true } },
            plan: { select: { id: true, name: true, code: true } },
          }),
        }),
      );
    });

    it('should respect custom limit', async () => {
      prisma.subscription.findMany.mockResolvedValue([]);

      await service.listSubscriptions({ limit: 50 });

      expect(prisma.subscription.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 51 }),
      );
    });
  });

  // ========== getSubscriptionDetail ==========

  describe('getSubscriptionDetail', () => {
    it('should return subscription with all includes and valid actions', async () => {
      const detailSub = {
        ...mockSubscription,
        status: 'active',
        history: [],
        trialRecords: [],
        complimentaryAccess: [],
        migrationsFrom: [],
        migrationsTo: [],
        lifecycleEvents: [],
      };
      prisma.subscription.findUnique.mockResolvedValue(detailSub);

      const result = await service.getSubscriptionDetail('sub-1');

      expect(result.validActions).toBeDefined();
      expect(Array.isArray(result.validActions)).toBe(true);
      expect(result.organization).toEqual({ id: 'org-1', name: 'Test Org', slug: 'test-org' });
    });

    it('should throw NotFoundException for missing subscription', async () => {
      prisma.subscription.findUnique.mockResolvedValue(null);

      await expect(service.getSubscriptionDetail('sub-missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should include pending lifecycle events only', async () => {
      prisma.subscription.findUnique.mockResolvedValue({
        ...mockSubscription,
        status: 'active',
        history: [],
        trialRecords: [],
        complimentaryAccess: [],
        migrationsFrom: [],
        migrationsTo: [],
        lifecycleEvents: [],
      });

      await service.getSubscriptionDetail('sub-1');

      expect(prisma.subscription.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            lifecycleEvents: expect.objectContaining({
              where: { status: 'pending' },
            }),
          }),
        }),
      );
    });

    it('should limit history to 10 entries', async () => {
      prisma.subscription.findUnique.mockResolvedValue({
        ...mockSubscription,
        status: 'active',
        history: [],
        trialRecords: [],
        complimentaryAccess: [],
        migrationsFrom: [],
        migrationsTo: [],
        lifecycleEvents: [],
      });

      await service.getSubscriptionDetail('sub-1');

      expect(prisma.subscription.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            history: expect.objectContaining({ take: 10 }),
          }),
        }),
      );
    });
  });

  // ========== getSubscriptionHistory ==========

  describe('getSubscriptionHistory', () => {
    it('should return paginated history', async () => {
      prisma.subscription.findUnique.mockResolvedValue({ id: 'sub-1' });
      const items = Array.from({ length: 21 }, (_, i) => ({
        id: `hist-${i}`,
        action: 'ACTIVATE',
        createdAt: new Date(),
      }));
      prisma.subscriptionHistory.findMany.mockResolvedValue(items);

      const result = await service.getSubscriptionHistory('sub-1', {});

      expect(result.data).toHaveLength(20);
      expect(result.hasNext).toBe(true);
      expect(result.nextCursor).toBe('hist-19');
    });

    it('should throw NotFoundException for missing subscription', async () => {
      prisma.subscription.findUnique.mockResolvedValue(null);

      await expect(
        service.getSubscriptionHistory('sub-missing', {}),
      ).rejects.toThrow(NotFoundException);
    });

    it('should apply action filter', async () => {
      prisma.subscription.findUnique.mockResolvedValue({ id: 'sub-1' });
      prisma.subscriptionHistory.findMany.mockResolvedValue([]);

      await service.getSubscriptionHistory('sub-1', { action: 'ACTIVATE' });

      expect(prisma.subscriptionHistory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ action: 'ACTIVATE' }),
        }),
      );
    });

    it('should apply actorType filter', async () => {
      prisma.subscription.findUnique.mockResolvedValue({ id: 'sub-1' });
      prisma.subscriptionHistory.findMany.mockResolvedValue([]);

      await service.getSubscriptionHistory('sub-1', { actorType: 'admin' });

      expect(prisma.subscriptionHistory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ actorType: 'admin' }),
        }),
      );
    });

    it('should use cursor for pagination', async () => {
      prisma.subscription.findUnique.mockResolvedValue({ id: 'sub-1' });
      prisma.subscriptionHistory.findMany.mockResolvedValue([]);

      await service.getSubscriptionHistory('sub-1', { cursor: 'hist-5' });

      expect(prisma.subscriptionHistory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 1,
          cursor: { id: 'hist-5' },
        }),
      );
    });
  });

  // ========== getSubscriptionMigrations ==========

  describe('getSubscriptionMigrations', () => {
    it('should return paginated migrations', async () => {
      prisma.subscription.findUnique.mockResolvedValue({ id: 'sub-1' });
      const items = Array.from({ length: 21 }, (_, i) => ({
        id: `mig-${i}`,
        direction: 'upgrade',
        createdAt: new Date(),
      }));
      prisma.subscriptionMigration.findMany.mockResolvedValue(items);

      const result = await service.getSubscriptionMigrations('sub-1', {});

      expect(result.data).toHaveLength(20);
      expect(result.hasNext).toBe(true);
    });

    it('should throw NotFoundException for missing subscription', async () => {
      prisma.subscription.findUnique.mockResolvedValue(null);

      await expect(
        service.getSubscriptionMigrations('sub-missing', {}),
      ).rejects.toThrow(NotFoundException);
    });

    it('should query both fromSubscriptionId and toSubscriptionId', async () => {
      prisma.subscription.findUnique.mockResolvedValue({ id: 'sub-1' });
      prisma.subscriptionMigration.findMany.mockResolvedValue([]);

      await service.getSubscriptionMigrations('sub-1', {});

      expect(prisma.subscriptionMigration.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { fromSubscriptionId: 'sub-1' },
              { toSubscriptionId: 'sub-1' },
            ],
          },
        }),
      );
    });

    it('should use cursor for pagination', async () => {
      prisma.subscription.findUnique.mockResolvedValue({ id: 'sub-1' });
      prisma.subscriptionMigration.findMany.mockResolvedValue([]);

      await service.getSubscriptionMigrations('sub-1', { cursor: 'mig-3' });

      expect(prisma.subscriptionMigration.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 1,
          cursor: { id: 'mig-3' },
        }),
      );
    });

    it('should respect custom limit', async () => {
      prisma.subscription.findUnique.mockResolvedValue({ id: 'sub-1' });
      prisma.subscriptionMigration.findMany.mockResolvedValue([]);

      await service.getSubscriptionMigrations('sub-1', { limit: 10 });

      expect(prisma.subscriptionMigration.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 11 }),
      );
    });
  });

  // ========== forceCancelSubscription ==========

  describe('forceCancelSubscription', () => {
    it('should call lifecycleService.executeTransition with CANCEL_IMMEDIATELY', async () => {
      prisma.subscription.findUnique.mockResolvedValue({
        id: 'sub-1',
        status: 'active',
      });
      const mockResult = {
        success: true as const,
        subscriptionId: 'sub-1',
        fromState: SubscriptionState.ACTIVE,
        toState: SubscriptionState.CANCELLED,
        action: SubscriptionAction.CANCEL_IMMEDIATELY,
      };
      lifecycleService.executeTransition.mockResolvedValue(mockResult);

      const result = await service.forceCancelSubscription(
        'sub-1',
        'admin-1',
        'TOS violation',
      );

      expect(lifecycleService.executeTransition).toHaveBeenCalledWith({
        subscriptionId: 'sub-1',
        action: SubscriptionAction.CANCEL_IMMEDIATELY,
        actorUserId: 'admin-1',
        actorType: 'admin',
        reason: 'TOS violation',
      });
      expect(result).toEqual(mockResult);
    });

    it('should throw NotFoundException for missing subscription', async () => {
      prisma.subscription.findUnique.mockResolvedValue(null);

      await expect(
        service.forceCancelSubscription('sub-missing', 'admin-1', 'reason'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException for already cancelled subscription', async () => {
      prisma.subscription.findUnique.mockResolvedValue({
        id: 'sub-1',
        status: SubscriptionState.CANCELLED,
      });

      await expect(
        service.forceCancelSubscription('sub-1', 'admin-1', 'reason'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for terminated subscription', async () => {
      prisma.subscription.findUnique.mockResolvedValue({
        id: 'sub-1',
        status: SubscriptionState.TERMINATED,
      });

      await expect(
        service.forceCancelSubscription('sub-1', 'admin-1', 'reason'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should allow force-cancel for trialing subscription', async () => {
      prisma.subscription.findUnique.mockResolvedValue({
        id: 'sub-1',
        status: SubscriptionState.TRIALING,
      });
      lifecycleService.executeTransition.mockResolvedValue({
        success: true as const,
        subscriptionId: 'sub-1',
        fromState: SubscriptionState.TRIALING,
        toState: SubscriptionState.CANCELLED,
        action: SubscriptionAction.CANCEL_IMMEDIATELY,
      });

      await service.forceCancelSubscription('sub-1', 'admin-1', 'reason');

      expect(lifecycleService.executeTransition).toHaveBeenCalled();
    });
  });

  // ========== extendTrial ==========

  describe('extendTrial', () => {
    const mockTrialRecord = {
      id: 'trial-1',
      subscriptionId: 'sub-1',
      trialEndsAt: new Date('2026-02-01'),
      trialDurationDays: 14,
      status: 'active',
    };

    it('should extend trial and return updated dates', async () => {
      prisma.subscription.findUnique.mockResolvedValue({
        id: 'sub-1',
        status: SubscriptionState.TRIALING,
        organizationId: 'org-1',
      });
      prisma.trialRecord.findFirst.mockResolvedValue(mockTrialRecord);

      const result = await service.extendTrial('sub-1', 14, 'admin-1');

      expect(result.subscriptionId).toBe('sub-1');
      expect(result.extensionDays).toBe(14);
      expect(result.newDurationDays).toBe(28);
      expect(result.previousTrialEndsAt).toEqual(new Date('2026-02-01'));
      expect(result.newTrialEndsAt).toEqual(new Date('2026-02-15'));
    });

    it('should throw NotFoundException for missing subscription', async () => {
      prisma.subscription.findUnique.mockResolvedValue(null);

      await expect(
        service.extendTrial('sub-missing', 14, 'admin-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException for non-trialing subscription', async () => {
      prisma.subscription.findUnique.mockResolvedValue({
        id: 'sub-1',
        status: SubscriptionState.ACTIVE,
        organizationId: 'org-1',
      });

      await expect(
        service.extendTrial('sub-1', 14, 'admin-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException for missing trial record', async () => {
      prisma.subscription.findUnique.mockResolvedValue({
        id: 'sub-1',
        status: SubscriptionState.TRIALING,
        organizationId: 'org-1',
      });
      prisma.trialRecord.findFirst.mockResolvedValue(null);

      await expect(
        service.extendTrial('sub-1', 14, 'admin-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should update trial record within transaction', async () => {
      prisma.subscription.findUnique.mockResolvedValue({
        id: 'sub-1',
        status: SubscriptionState.TRIALING,
        organizationId: 'org-1',
      });
      prisma.trialRecord.findFirst.mockResolvedValue(mockTrialRecord);

      await service.extendTrial('sub-1', 7, 'admin-1');

      expect(prisma.trialRecord.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'trial-1' },
          data: expect.objectContaining({
            trialDurationDays: 21,
          }),
        }),
      );
    });

    it('should update subscription trialEnd within transaction', async () => {
      prisma.subscription.findUnique.mockResolvedValue({
        id: 'sub-1',
        status: SubscriptionState.TRIALING,
        organizationId: 'org-1',
      });
      prisma.trialRecord.findFirst.mockResolvedValue(mockTrialRecord);

      await service.extendTrial('sub-1', 7, 'admin-1');

      expect(prisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sub-1' },
          data: expect.objectContaining({
            trialEnd: new Date('2026-02-08'),
          }),
        }),
      );
    });

    it('should reschedule pending trial_expiry event', async () => {
      prisma.subscription.findUnique.mockResolvedValue({
        id: 'sub-1',
        status: SubscriptionState.TRIALING,
        organizationId: 'org-1',
      });
      prisma.trialRecord.findFirst.mockResolvedValue(mockTrialRecord);

      await service.extendTrial('sub-1', 7, 'admin-1');

      expect(prisma.subscriptionLifecycleEvent.updateMany).toHaveBeenCalledWith({
        where: {
          subscriptionId: 'sub-1',
          eventType: 'trial_expiry',
          status: 'pending',
        },
        data: {
          scheduledAt: new Date('2026-02-08'),
        },
      });
    });

    it('should write history entry with EXTEND_TRIAL action', async () => {
      prisma.subscription.findUnique.mockResolvedValue({
        id: 'sub-1',
        status: SubscriptionState.TRIALING,
        organizationId: 'org-1',
      });
      prisma.trialRecord.findFirst.mockResolvedValue(mockTrialRecord);

      await service.extendTrial('sub-1', 7, 'admin-1');

      expect(prisma.subscriptionHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          subscriptionId: 'sub-1',
          organizationId: 'org-1',
          action: 'EXTEND_TRIAL',
          fromState: SubscriptionState.TRIALING,
          toState: SubscriptionState.TRIALING,
          actorUserId: 'admin-1',
          actorType: 'admin',
        }),
      });
    });
  });

  // ========== changeBillingPeriod ==========

  describe('changeBillingPeriod', () => {
    const activeSub = {
      id: 'sub-1',
      status: SubscriptionState.ACTIVE,
      organizationId: 'org-1',
      planCode: 'pro',
      billingPeriod: 'monthly',
      currentPeriodStart: new Date('2026-01-01'),
      currentPeriodEnd: new Date('2026-02-01'),
    };

    it('should change billing period and return result', async () => {
      prisma.subscription.findUnique.mockResolvedValue(activeSub);
      prorationService.calculateProration.mockResolvedValue(mockProration);

      const result = await service.changeBillingPeriod(
        'sub-1',
        'annual',
        'admin-1',
      );

      expect(result.subscriptionId).toBe('sub-1');
      expect(result.fromBillingPeriod).toBe('monthly');
      expect(result.toBillingPeriod).toBe('annual');
      expect(result.proration).toEqual(mockProration);
    });

    it('should throw NotFoundException for missing subscription', async () => {
      prisma.subscription.findUnique.mockResolvedValue(null);

      await expect(
        service.changeBillingPeriod('sub-missing', 'annual', 'admin-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException for non-active subscription', async () => {
      prisma.subscription.findUnique.mockResolvedValue({
        ...activeSub,
        status: SubscriptionState.TRIALING,
      });

      await expect(
        service.changeBillingPeriod('sub-1', 'annual', 'admin-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when already on the same billing period', async () => {
      prisma.subscription.findUnique.mockResolvedValue(activeSub);

      await expect(
        service.changeBillingPeriod('sub-1', 'monthly', 'admin-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should calculate proration when period dates exist', async () => {
      prisma.subscription.findUnique.mockResolvedValue(activeSub);
      prorationService.calculateProration.mockResolvedValue(mockProration);

      await service.changeBillingPeriod('sub-1', 'annual', 'admin-1');

      expect(prorationService.calculateProration).toHaveBeenCalledWith({
        organizationId: 'org-1',
        currentPlanCode: 'pro',
        newPlanCode: 'pro',
        billingPeriod: 'annual',
        currentPeriodStart: activeSub.currentPeriodStart,
        currentPeriodEnd: activeSub.currentPeriodEnd,
      });
    });

    it('should skip proration when period dates are null', async () => {
      prisma.subscription.findUnique.mockResolvedValue({
        ...activeSub,
        currentPeriodStart: null,
        currentPeriodEnd: null,
      });

      const result = await service.changeBillingPeriod(
        'sub-1',
        'annual',
        'admin-1',
      );

      expect(prorationService.calculateProration).not.toHaveBeenCalled();
      expect(result.proration).toBeNull();
    });

    it('should update subscription billing period', async () => {
      prisma.subscription.findUnique.mockResolvedValue(activeSub);
      prorationService.calculateProration.mockResolvedValue(mockProration);

      await service.changeBillingPeriod('sub-1', 'annual', 'admin-1');

      expect(prisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sub-1' },
          data: expect.objectContaining({
            billingPeriod: 'annual',
          }),
        }),
      );
    });

    it('should create migration record with upgrade direction for monthly→annual', async () => {
      prisma.subscription.findUnique.mockResolvedValue(activeSub);
      prorationService.calculateProration.mockResolvedValue(mockProration);

      await service.changeBillingPeriod('sub-1', 'annual', 'admin-1');

      expect(prisma.subscriptionMigration.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          direction: 'upgrade',
          fromBillingPeriod: 'monthly',
          toBillingPeriod: 'annual',
          proratedCreditAmount: 5000,
          proratedChargeAmount: 15000,
          netAmount: 10000,
        }),
      });
    });

    it('should create migration record with downgrade direction for annual→monthly', async () => {
      prisma.subscription.findUnique.mockResolvedValue({
        ...activeSub,
        billingPeriod: 'annual',
      });
      prorationService.calculateProration.mockResolvedValue(mockProration);

      await service.changeBillingPeriod('sub-1', 'monthly', 'admin-1');

      expect(prisma.subscriptionMigration.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          direction: 'downgrade',
          fromBillingPeriod: 'annual',
          toBillingPeriod: 'monthly',
        }),
      });
    });

    it('should write history entry with CHANGE_BILLING_PERIOD action', async () => {
      prisma.subscription.findUnique.mockResolvedValue(activeSub);
      prorationService.calculateProration.mockResolvedValue(mockProration);

      await service.changeBillingPeriod('sub-1', 'annual', 'admin-1');

      expect(prisma.subscriptionHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'CHANGE_BILLING_PERIOD',
          fromState: SubscriptionState.ACTIVE,
          toState: SubscriptionState.ACTIVE,
          actorUserId: 'admin-1',
          actorType: 'admin',
        }),
      });
    });

    it('should reschedule renewal event', async () => {
      prisma.subscription.findUnique.mockResolvedValue(activeSub);
      prorationService.calculateProration.mockResolvedValue(mockProration);

      await service.changeBillingPeriod('sub-1', 'annual', 'admin-1');

      expect(prisma.subscriptionLifecycleEvent.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            subscriptionId: 'sub-1',
            eventType: 'renewal',
            status: 'pending',
          },
        }),
      );
    });
  });
});
