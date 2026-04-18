import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { RedisService } from '../../common/services/redis.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PlansService } from './plans.service';

describe('PlansService', () => {
  let service: PlansService;
  let prisma: jest.Mocked<PrismaService>;
  let redis: jest.Mocked<RedisService>;

  const mockPlan = {
    id: 'plan-1',
    code: 'pro',
    name: 'Pro',
    displayName: 'Pro',
    description: 'For professionals',
    type: 'standard',
    category: 'individual',
    isActive: true,
    isVisible: true,
    displayOrder: 2,
    trialEnabled: true,
    trialDurationDays: 14,
    gracePeriodDays: 3,
    autoRenewRequired: true,
    adminOnlyAssignment: false,
    inviteOnly: false,
    eligibleSegments: [],
    defaultSeats: 1,
    maxSeats: 1,
    internalNotes: null,
    isArchived: false,
    isLegacy: false,
    legacyMappingCode: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    prices: [
      { id: 'price-1', planId: 'plan-1', billingInterval: 'monthly', amount: 99900, currency: 'PHP', isActive: true, createdAt: new Date(), updatedAt: new Date() },
    ],
    entitlements: [
      { id: 'ent-1', planId: 'plan-1', key: 'aiAnswers', valueType: 'unlimited', numericValue: null, booleanValue: null, description: 'Unlimited AI answers' },
      { id: 'ent-2', planId: 'plan-1', key: 'maxMatters', valueType: 'numeric', numericValue: 20, booleanValue: null, description: 'Maximum matters' },
      { id: 'ent-3', planId: 'plan-1', key: 'offlineReading', valueType: 'boolean', numericValue: null, booleanValue: true, description: 'Offline reading' },
    ],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlansService,
        {
          provide: PrismaService,
          useValue: {
            plan: {
              findMany: jest.fn(),
              findUnique: jest.fn(),
            },
            organization: {
              findUnique: jest.fn(),
            },
          },
        },
        {
          provide: RedisService,
          useValue: {
            get: jest.fn().mockResolvedValue(null),
            set: jest.fn().mockResolvedValue(undefined),
            del: jest.fn().mockResolvedValue(1),
          },
        },
      ],
    }).compile();

    service = module.get<PlansService>(PlansService);
    prisma = module.get(PrismaService);
    redis = module.get(RedisService);
  });

  // ---- findAll ----

  describe('findAll', () => {
    it('should return all active non-archived plans', async () => {
      (prisma.plan.findMany as jest.Mock).mockResolvedValue([mockPlan]);

      const plans = await service.findAll();
      expect(plans).toHaveLength(1);
      expect(prisma.plan.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { isActive: true, isArchived: false },
          orderBy: { displayOrder: 'asc' },
        }),
      );
    });
  });

  // ---- findVisible ----

  describe('findVisible', () => {
    it('should return cached visible plans when available', async () => {
      redis.get.mockResolvedValue(JSON.stringify([mockPlan]));

      const plans = await service.findVisible();
      expect(plans).toHaveLength(1);
      expect(prisma.plan.findMany).not.toHaveBeenCalled();
    });

    it('should query DB and cache when no cache', async () => {
      redis.get.mockResolvedValue(null);
      (prisma.plan.findMany as jest.Mock).mockResolvedValue([mockPlan]);

      const plans = await service.findVisible();
      expect(plans).toHaveLength(1);
      expect(redis.set).toHaveBeenCalledWith(
        'cache:plans:visible',
        expect.any(String),
        300,
      );
    });
  });

  // ---- findByCode ----

  describe('findByCode', () => {
    it('should return cached plan when available', async () => {
      redis.get.mockResolvedValue(JSON.stringify(mockPlan));

      const plan = await service.findByCode('pro');
      expect(plan.code).toBe('pro');
      expect(prisma.plan.findUnique).not.toHaveBeenCalled();
    });

    it('should query DB and cache when no cache', async () => {
      redis.get.mockResolvedValue(null);
      (prisma.plan.findUnique as jest.Mock).mockResolvedValue(mockPlan);

      const plan = await service.findByCode('pro');
      expect(plan.code).toBe('pro');
      expect(redis.set).toHaveBeenCalledWith(
        'cache:plan:pro',
        expect.any(String),
        300,
      );
    });

    it('should throw NotFoundException when plan not found', async () => {
      redis.get.mockResolvedValue(null);
      (prisma.plan.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.findByCode('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  // ---- entitlementsFromRows ----

  describe('entitlementsFromRows', () => {
    it('should convert unlimited valueType to -1', () => {
      const rows = [
        { id: 'e1', planId: 'p1', key: 'aiAnswers', valueType: 'unlimited', numericValue: null, booleanValue: null, description: '' },
      ];

      const ent = service.entitlementsFromRows(rows);
      expect(ent.aiAnswers).toBe(-1);
    });

    it('should convert numeric valueType to number', () => {
      const rows = [
        { id: 'e1', planId: 'p1', key: 'maxMatters', valueType: 'numeric', numericValue: 20, booleanValue: null, description: '' },
      ];

      const ent = service.entitlementsFromRows(rows);
      expect(ent.maxMatters).toBe(20);
    });

    it('should convert boolean valueType', () => {
      const rows = [
        { id: 'e1', planId: 'p1', key: 'offlineReading', valueType: 'boolean', numericValue: null, booleanValue: true, description: '' },
      ];

      const ent = service.entitlementsFromRows(rows);
      expect(ent.offlineReading).toBe(true);
    });

    it('should default numeric to 0 when null', () => {
      const rows = [
        { id: 'e1', planId: 'p1', key: 'maxMatters', valueType: 'numeric', numericValue: null, booleanValue: null, description: '' },
      ];

      const ent = service.entitlementsFromRows(rows);
      expect(ent.maxMatters).toBe(0);
    });

    it('should default boolean to false when null', () => {
      const rows = [
        { id: 'e1', planId: 'p1', key: 'offlineReading', valueType: 'boolean', numericValue: null, booleanValue: null, description: '' },
      ];

      const ent = service.entitlementsFromRows(rows);
      expect(ent.offlineReading).toBe(false);
    });
  });

  // ---- resolveEntitlements ----

  describe('resolveEntitlements', () => {
    it('should resolve entitlements from plan code', async () => {
      redis.get.mockResolvedValue(null);
      (prisma.plan.findUnique as jest.Mock).mockResolvedValue(mockPlan);

      const ent = await service.resolveEntitlements('pro');
      expect(ent.aiAnswers).toBe(-1); // unlimited
      expect(ent.maxMatters).toBe(20);
      expect(ent.offlineReading).toBe(true);
    });
  });

  // ---- getTierLevel ----

  describe('getTierLevel', () => {
    it('should return correct levels', () => {
      expect(service.getTierLevel('free')).toBe(0);
      expect(service.getTierLevel('edu')).toBe(1);
      expect(service.getTierLevel('pro')).toBe(2);
      expect(service.getTierLevel('team')).toBe(3);
      expect(service.getTierLevel('enterprise')).toBe(4);
    });

    it('should return 0 for unknown tiers', () => {
      expect(service.getTierLevel('unknown')).toBe(0);
    });
  });

  // ---- comparePlans ----

  describe('comparePlans', () => {
    it('should identify upgrade', async () => {
      const freePlan = {
        ...mockPlan,
        code: 'free',
        entitlements: [
          { id: 'e1', planId: 'p1', key: 'aiAnswers', valueType: 'numeric', numericValue: 15, booleanValue: null, description: '' },
        ],
      };
      const proPlan = {
        ...mockPlan,
        code: 'pro',
        entitlements: [
          { id: 'e2', planId: 'p2', key: 'aiAnswers', valueType: 'unlimited', numericValue: null, booleanValue: null, description: '' },
        ],
      };

      redis.get
        .mockResolvedValueOnce(JSON.stringify(freePlan))
        .mockResolvedValueOnce(JSON.stringify(proPlan));

      const result = await service.comparePlans('free', 'pro');
      expect(result.direction).toBe('upgrade');
      expect(result.changedEntitlements).toContainEqual({
        key: 'aiAnswers',
        from: '15',
        to: 'unlimited',
      });
    });

    it('should identify downgrade', async () => {
      const proPlan = { ...mockPlan, code: 'pro', entitlements: [] };
      const freePlan = { ...mockPlan, code: 'free', entitlements: [] };

      redis.get
        .mockResolvedValueOnce(JSON.stringify(proPlan))
        .mockResolvedValueOnce(JSON.stringify(freePlan));

      const result = await service.comparePlans('pro', 'free');
      expect(result.direction).toBe('downgrade');
    });

    it('should identify same tier', async () => {
      redis.get
        .mockResolvedValueOnce(JSON.stringify(mockPlan))
        .mockResolvedValueOnce(JSON.stringify(mockPlan));

      const result = await service.comparePlans('pro', 'pro');
      expect(result.direction).toBe('same');
    });
  });

  // ---- checkEligibility ----

  describe('checkEligibility', () => {
    it('should return eligible for active public plan', async () => {
      redis.get.mockResolvedValue(JSON.stringify(mockPlan));

      const result = await service.checkEligibility('pro', 'org-1');
      expect(result.eligible).toBe(true);
    });

    it('should return ineligible for archived plan', async () => {
      const archivedPlan = { ...mockPlan, isArchived: true };
      redis.get.mockResolvedValue(JSON.stringify(archivedPlan));

      const result = await service.checkEligibility('pro', 'org-1');
      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('archived');
    });

    it('should return ineligible for admin-only plan', async () => {
      const adminPlan = { ...mockPlan, adminOnlyAssignment: true };
      redis.get.mockResolvedValue(JSON.stringify(adminPlan));

      const result = await service.checkEligibility('pro', 'org-1');
      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('administrator');
    });

    it('should return ineligible for invite-only plan', async () => {
      const invitePlan = { ...mockPlan, inviteOnly: true };
      redis.get.mockResolvedValue(JSON.stringify(invitePlan));

      const result = await service.checkEligibility('pro', 'org-1');
      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('invite-only');
    });

    it('should check segment eligibility when segments are defined', async () => {
      const segmentPlan = { ...mockPlan, eligibleSegments: ['law_student'] };
      redis.get.mockResolvedValue(JSON.stringify(segmentPlan));
      (prisma.organization.findUnique as jest.Mock).mockResolvedValue({ type: 'firm' });

      const result = await service.checkEligibility('pro', 'org-1');
      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('law_student');
    });
  });

  // ---- Display flag fields ----

  describe('display flag fields', () => {
    const featuredPlan = {
      ...mockPlan,
      isFeatured: true,
      featuredLabel: 'Best Value',
      ctaText: 'Subscribe Now',
      highlightColor: 'emerald',
    };

    it('findVisible() should return plans with display flag fields', async () => {
      redis.get.mockResolvedValue(null);
      (prisma.plan.findMany as jest.Mock).mockResolvedValue([featuredPlan]);

      const plans = await service.findVisible();
      expect(plans).toHaveLength(1);
      const plan = plans[0]!;
      expect(plan.isFeatured).toBe(true);
      expect(plan.featuredLabel).toBe('Best Value');
      expect(plan.ctaText).toBe('Subscribe Now');
      expect(plan.highlightColor).toBe('emerald');
    });

    it('findVisible() caches plans with display flag fields', async () => {
      redis.get.mockResolvedValue(null);
      (prisma.plan.findMany as jest.Mock).mockResolvedValue([featuredPlan]);

      await service.findVisible();
      expect(redis.set).toHaveBeenCalledWith(
        'cache:plans:visible',
        expect.stringContaining('"isFeatured":true'),
        300,
      );
    });

    it('findVisible() returns cached plans with display flag fields', async () => {
      redis.get.mockResolvedValue(JSON.stringify([featuredPlan]));

      const plans = await service.findVisible();
      const plan = plans[0]!;
      expect(plan.isFeatured).toBe(true);
      expect(plan.featuredLabel).toBe('Best Value');
    });
  });

  // ---- invalidateCache ----

  describe('invalidateCache', () => {
    it('should delete visible plans cache', async () => {
      await service.invalidateCache();
      expect(redis.del).toHaveBeenCalledWith('cache:plans:visible');
    });

    it('should delete specific plan cache when code provided', async () => {
      await service.invalidateCache('pro');
      expect(redis.del).toHaveBeenCalledWith('cache:plans:visible');
      expect(redis.del).toHaveBeenCalledWith('cache:plan:pro');
    });
  });
});
