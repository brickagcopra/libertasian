import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { RedisService } from '../../common/services/redis.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PlansService } from './plans.service';

describe('PlansService — CRUD Operations', () => {
  let service: PlansService;
  let prisma: jest.Mocked<PrismaService>;
  let redis: jest.Mocked<RedisService>;

  const mockPlan = {
    id: 'plan-1',
    code: 'pro',
    name: 'Pro',
    displayName: 'Professional',
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
              create: jest.fn(),
              update: jest.fn(),
            },
            planPrice: {
              findUnique: jest.fn(),
              findFirst: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
            },
            planEntitlement: {
              findUnique: jest.fn(),
              findFirst: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
            },
            subscription: {
              count: jest.fn(),
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

  // ---- findAllAdmin ----

  describe('findAllAdmin', () => {
    it('should return all plans including archived/inactive', async () => {
      (prisma.plan.findMany as jest.Mock).mockResolvedValue([mockPlan]);

      const plans = await service.findAllAdmin();
      expect(plans).toHaveLength(1);
      expect(prisma.plan.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: { prices: true, entitlements: true },
        }),
      );
      // Should NOT filter by isActive or isArchived
      expect(prisma.plan.findMany).toHaveBeenCalledWith(
        expect.not.objectContaining({ where: expect.anything() }),
      );
    });
  });

  // ---- create ----

  describe('create', () => {
    const createDto = {
      code: 'new_plan',
      name: 'New Plan',
      type: 'standard',
    };

    it('should create a new plan', async () => {
      (prisma.plan.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.plan.create as jest.Mock).mockResolvedValue({
        ...mockPlan,
        code: 'new_plan',
        name: 'New Plan',
      });

      const plan = await service.create(createDto);
      expect(plan.code).toBe('new_plan');
      expect(prisma.plan.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ code: 'new_plan', name: 'New Plan' }),
        }),
      );
      expect(redis.del).toHaveBeenCalledWith('cache:plans:visible');
    });

    it('should throw ConflictException for duplicate code', async () => {
      (prisma.plan.findUnique as jest.Mock).mockResolvedValue(mockPlan);

      await expect(service.create({ ...createDto, code: 'pro' })).rejects.toThrow(
        ConflictException,
      );
    });

    it('should set defaults for optional boolean fields', async () => {
      (prisma.plan.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.plan.create as jest.Mock).mockResolvedValue(mockPlan);

      await service.create(createDto);
      expect(prisma.plan.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            isActive: true,
            isVisible: true,
            trialEnabled: false,
            autoRenewRequired: true,
            adminOnlyAssignment: false,
            inviteOnly: false,
          }),
        }),
      );
    });

    it('should persist display flag fields when provided', async () => {
      const createWithFlags = {
        ...createDto,
        isFeatured: true,
        featuredLabel: 'Best Value',
        ctaText: 'Subscribe Now',
        highlightColor: 'emerald',
      };
      (prisma.plan.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.plan.create as jest.Mock).mockResolvedValue({
        ...mockPlan,
        ...createWithFlags,
      });

      await service.create(createWithFlags);
      expect(prisma.plan.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            isFeatured: true,
            featuredLabel: 'Best Value',
            ctaText: 'Subscribe Now',
            highlightColor: 'emerald',
          }),
        }),
      );
    });

    it('should default isFeatured to false when not provided', async () => {
      (prisma.plan.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.plan.create as jest.Mock).mockResolvedValue(mockPlan);

      await service.create(createDto);
      expect(prisma.plan.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            isFeatured: false,
          }),
        }),
      );
    });
  });

  // ---- update ----

  describe('update', () => {
    it('should update an existing plan', async () => {
      (prisma.plan.findUnique as jest.Mock).mockResolvedValue(mockPlan);
      (prisma.plan.update as jest.Mock).mockResolvedValue({ ...mockPlan, name: 'Updated Pro' });

      const plan = await service.update('plan-1', { name: 'Updated Pro' });
      expect(plan.name).toBe('Updated Pro');
      expect(redis.del).toHaveBeenCalledWith('cache:plan:pro');
    });

    it('should throw NotFoundException for missing plan', async () => {
      (prisma.plan.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.update('missing', { name: 'X' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should check for code conflict when code changes', async () => {
      (prisma.plan.findUnique as jest.Mock)
        .mockResolvedValueOnce(mockPlan) // existing plan
        .mockResolvedValueOnce({ id: 'other', code: 'edu' }); // conflict

      await expect(
        service.update('plan-1', { code: 'edu' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should allow updating to same code without conflict', async () => {
      (prisma.plan.findUnique as jest.Mock).mockResolvedValue(mockPlan);
      (prisma.plan.update as jest.Mock).mockResolvedValue(mockPlan);

      const plan = await service.update('plan-1', { code: 'pro' });
      expect(plan.code).toBe('pro');
    });

    it('should persist display flag fields', async () => {
      (prisma.plan.findUnique as jest.Mock).mockResolvedValue(mockPlan);
      (prisma.plan.update as jest.Mock).mockResolvedValue({
        ...mockPlan,
        isFeatured: true,
        featuredLabel: 'Top Pick',
        ctaText: 'Upgrade Now',
        highlightColor: 'amber',
      });

      const plan = await service.update('plan-1', {
        isFeatured: true,
        featuredLabel: 'Top Pick',
        ctaText: 'Upgrade Now',
        highlightColor: 'amber',
      });
      expect(plan.isFeatured).toBe(true);
      expect(plan.featuredLabel).toBe('Top Pick');
      expect(plan.ctaText).toBe('Upgrade Now');
      expect(plan.highlightColor).toBe('amber');
      expect(prisma.plan.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            isFeatured: true,
            featuredLabel: 'Top Pick',
            ctaText: 'Upgrade Now',
            highlightColor: 'amber',
          }),
        }),
      );
    });

    it('should invalidate both old and new code caches on code change', async () => {
      (prisma.plan.findUnique as jest.Mock)
        .mockResolvedValueOnce(mockPlan) // existing
        .mockResolvedValueOnce(null); // no conflict
      (prisma.plan.update as jest.Mock).mockResolvedValue({ ...mockPlan, code: 'pro_v2' });

      await service.update('plan-1', { code: 'pro_v2' });
      expect(redis.del).toHaveBeenCalledWith('cache:plan:pro');
      expect(redis.del).toHaveBeenCalledWith('cache:plan:pro_v2');
    });
  });

  // ---- archive ----

  describe('archive', () => {
    it('should archive a plan with no active subscriptions', async () => {
      (prisma.plan.findUnique as jest.Mock).mockResolvedValue(mockPlan);
      (prisma.subscription.count as jest.Mock).mockResolvedValue(0);
      (prisma.plan.update as jest.Mock).mockResolvedValue({
        ...mockPlan,
        isArchived: true,
        isActive: false,
        isVisible: false,
      });

      const plan = await service.archive('plan-1');
      expect(plan.isArchived).toBe(true);
      expect(prisma.plan.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { isArchived: true, isActive: false, isVisible: false },
        }),
      );
    });

    it('should throw NotFoundException for missing plan', async () => {
      (prisma.plan.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.archive('missing')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when active subscriptions exist', async () => {
      (prisma.plan.findUnique as jest.Mock).mockResolvedValue(mockPlan);
      (prisma.subscription.count as jest.Mock).mockResolvedValue(3);

      await expect(service.archive('plan-1')).rejects.toThrow(BadRequestException);
    });
  });

  // ---- createPrice ----

  describe('createPrice', () => {
    const priceDto = {
      billingInterval: 'annual',
      amount: 999000,
    };

    it('should create a price for an existing plan', async () => {
      (prisma.plan.findUnique as jest.Mock).mockResolvedValue(mockPlan);
      (prisma.planPrice.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.planPrice.create as jest.Mock).mockResolvedValue({
        id: 'price-2',
        planId: 'plan-1',
        ...priceDto,
        currency: 'PHP',
        isActive: true,
      });

      const price = await service.createPrice('plan-1', priceDto);
      expect(price.id).toBe('price-2');
      expect(redis.del).toHaveBeenCalledWith('cache:plan:pro');
    });

    it('should throw NotFoundException for missing plan', async () => {
      (prisma.plan.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.createPrice('missing', priceDto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ConflictException for duplicate interval+currency', async () => {
      (prisma.plan.findUnique as jest.Mock).mockResolvedValue(mockPlan);
      (prisma.planPrice.findUnique as jest.Mock).mockResolvedValue({
        id: 'price-existing',
      });

      await expect(service.createPrice('plan-1', priceDto)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should use PHP as default currency', async () => {
      (prisma.plan.findUnique as jest.Mock).mockResolvedValue(mockPlan);
      (prisma.planPrice.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.planPrice.create as jest.Mock).mockResolvedValue({
        id: 'price-2',
        planId: 'plan-1',
        ...priceDto,
        currency: 'PHP',
        isActive: true,
      });

      await service.createPrice('plan-1', priceDto);
      expect(prisma.planPrice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ currency: 'PHP' }),
        }),
      );
    });
  });

  // ---- updatePrice ----

  describe('updatePrice', () => {
    it('should update an existing price', async () => {
      (prisma.planPrice.findFirst as jest.Mock).mockResolvedValue({
        id: 'price-1',
        planId: 'plan-1',
        plan: { code: 'pro' },
      });
      (prisma.planPrice.update as jest.Mock).mockResolvedValue({
        id: 'price-1',
        amount: 89900,
      });

      const price = await service.updatePrice('plan-1', 'price-1', { amount: 89900 });
      expect(price.amount).toBe(89900);
    });

    it('should throw NotFoundException for missing price', async () => {
      (prisma.planPrice.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.updatePrice('plan-1', 'missing', { amount: 89900 }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ---- deactivatePrice ----

  describe('deactivatePrice', () => {
    it('should deactivate a price', async () => {
      (prisma.planPrice.findFirst as jest.Mock).mockResolvedValue({
        id: 'price-1',
        planId: 'plan-1',
        plan: { code: 'pro' },
      });
      (prisma.planPrice.update as jest.Mock).mockResolvedValue({
        id: 'price-1',
        isActive: false,
      });

      const price = await service.deactivatePrice('plan-1', 'price-1');
      expect(price.isActive).toBe(false);
    });
  });

  // ---- createEntitlement ----

  describe('createEntitlement', () => {
    const entDto = {
      key: 'searchQueries',
      valueType: 'numeric',
      numericValue: 50,
    };

    it('should create an entitlement for an existing plan', async () => {
      (prisma.plan.findUnique as jest.Mock).mockResolvedValue(mockPlan);
      (prisma.planEntitlement.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.planEntitlement.create as jest.Mock).mockResolvedValue({
        id: 'ent-new',
        planId: 'plan-1',
        ...entDto,
      });

      const ent = await service.createEntitlement('plan-1', entDto);
      expect(ent.key).toBe('searchQueries');
    });

    it('should throw NotFoundException for missing plan', async () => {
      (prisma.plan.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.createEntitlement('missing', entDto),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException for duplicate key', async () => {
      (prisma.plan.findUnique as jest.Mock).mockResolvedValue(mockPlan);
      (prisma.planEntitlement.findUnique as jest.Mock).mockResolvedValue({
        id: 'ent-existing',
      });

      await expect(
        service.createEntitlement('plan-1', entDto),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ---- updateEntitlement ----

  describe('updateEntitlement', () => {
    it('should update an existing entitlement', async () => {
      (prisma.planEntitlement.findFirst as jest.Mock).mockResolvedValue({
        id: 'ent-1',
        planId: 'plan-1',
        key: 'aiAnswers',
      });
      (prisma.plan.findUnique as jest.Mock).mockResolvedValue({ code: 'pro' });
      (prisma.planEntitlement.update as jest.Mock).mockResolvedValue({
        id: 'ent-1',
        numericValue: 200,
      });

      const ent = await service.updateEntitlement('plan-1', 'ent-1', {
        numericValue: 200,
      });
      expect(ent.numericValue).toBe(200);
    });

    it('should throw NotFoundException for missing entitlement', async () => {
      (prisma.planEntitlement.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.updateEntitlement('plan-1', 'missing', { numericValue: 200 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should check for key conflict when key changes', async () => {
      (prisma.planEntitlement.findFirst as jest.Mock).mockResolvedValue({
        id: 'ent-1',
        planId: 'plan-1',
        key: 'aiAnswers',
      });
      (prisma.planEntitlement.findUnique as jest.Mock).mockResolvedValue({
        id: 'ent-other',
      });

      await expect(
        service.updateEntitlement('plan-1', 'ent-1', { key: 'searchQueries' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ---- triggerWebRevalidation ----

  describe('triggerWebRevalidation', () => {
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
      globalThis.fetch = jest.fn().mockResolvedValue({ ok: true });
      process.env['WEB_BASE_URL'] = 'http://localhost:3000';
      process.env['REVALIDATION_SECRET'] = 'test-secret';
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
      delete process.env['WEB_BASE_URL'];
      delete process.env['REVALIDATION_SECRET'];
    });

    it('should call revalidation endpoint after create', async () => {
      (prisma.plan.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.plan.create as jest.Mock).mockResolvedValue(mockPlan);

      await service.create({ code: 'test', name: 'Test', type: 'standard' });

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/internal/revalidate-pricing',
        expect.objectContaining({
          method: 'POST',
          headers: { 'x-revalidation-secret': 'test-secret' },
        }),
      );
    });

    it('should call revalidation endpoint after update', async () => {
      (prisma.plan.findUnique as jest.Mock).mockResolvedValue(mockPlan);
      (prisma.plan.update as jest.Mock).mockResolvedValue(mockPlan);

      await service.update('plan-1', { name: 'Updated' });

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/internal/revalidate-pricing',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('should not call revalidation when env vars are missing', async () => {
      delete process.env['WEB_BASE_URL'];
      delete process.env['REVALIDATION_SECRET'];

      (prisma.plan.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.plan.create as jest.Mock).mockResolvedValue(mockPlan);

      await service.create({ code: 'test', name: 'Test', type: 'standard' });

      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('should not throw when revalidation fetch fails', async () => {
      (globalThis.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

      (prisma.plan.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.plan.create as jest.Mock).mockResolvedValue(mockPlan);

      // Should not throw — fire-and-forget
      await expect(
        service.create({ code: 'test', name: 'Test', type: 'standard' }),
      ).resolves.toBeDefined();
    });
  });

  // ---- deleteEntitlement ----

  describe('deleteEntitlement', () => {
    it('should delete an existing entitlement', async () => {
      (prisma.planEntitlement.findFirst as jest.Mock).mockResolvedValue({
        id: 'ent-1',
        planId: 'plan-1',
      });
      (prisma.plan.findUnique as jest.Mock).mockResolvedValue({ code: 'pro' });
      (prisma.planEntitlement.delete as jest.Mock).mockResolvedValue({});

      await service.deleteEntitlement('plan-1', 'ent-1');
      expect(prisma.planEntitlement.delete).toHaveBeenCalledWith({
        where: { id: 'ent-1' },
      });
    });

    it('should throw NotFoundException for missing entitlement', async () => {
      (prisma.planEntitlement.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.deleteEntitlement('plan-1', 'missing'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
