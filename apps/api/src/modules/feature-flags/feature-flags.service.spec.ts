import { Test, TestingModule } from '@nestjs/testing';

import { RedisService } from '../../common/services/redis.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FeatureFlagService } from './feature-flags.service';

describe('FeatureFlagService', () => {
  let service: FeatureFlagService;
  let prisma: jest.Mocked<PrismaService>;
  let redis: jest.Mocked<RedisService>;

  const mockFlag = {
    key: 'billing.db_plans',
    enabled: true,
    rolloutPercentage: 100,
    allowedOrgIds: [],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeatureFlagService,
        {
          provide: PrismaService,
          useValue: {
            featureFlag: {
              findUnique: jest.fn(),
              findMany: jest.fn(),
            },
            plan: {
              findUnique: jest.fn(),
            },
            planFeatureFlag: {
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

    service = module.get<FeatureFlagService>(FeatureFlagService);
    prisma = module.get(PrismaService);
    redis = module.get(RedisService);
  });

  // ---- isEnabled ----

  describe('isEnabled', () => {
    it('should return false when flag does not exist', async () => {
      (prisma.featureFlag.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await service.isEnabled('nonexistent');
      expect(result).toBe(false);
    });

    it('should return false when flag is globally disabled', async () => {
      (prisma.featureFlag.findUnique as jest.Mock).mockResolvedValue({
        ...mockFlag,
        enabled: false,
      });

      const result = await service.isEnabled('billing.db_plans');
      expect(result).toBe(false);
    });

    it('should return true when flag is fully enabled (100% rollout)', async () => {
      (prisma.featureFlag.findUnique as jest.Mock).mockResolvedValue(mockFlag);

      const result = await service.isEnabled('billing.db_plans');
      expect(result).toBe(true);
    });

    it('should use cached flag when available', async () => {
      redis.get.mockResolvedValue(JSON.stringify(mockFlag));

      const result = await service.isEnabled('billing.db_plans');
      expect(result).toBe(true);
      expect(prisma.featureFlag.findUnique).not.toHaveBeenCalled();
    });

    it('should handle cached null (flag does not exist)', async () => {
      redis.get.mockResolvedValue('__null__');

      const result = await service.isEnabled('nonexistent');
      expect(result).toBe(false);
      expect(prisma.featureFlag.findUnique).not.toHaveBeenCalled();
    });
  });

  // ---- evaluate ----

  describe('evaluate', () => {
    it('should return not_found reason when flag missing', async () => {
      (prisma.featureFlag.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await service.evaluate('missing');
      expect(result.enabled).toBe(false);
      expect(result.reason).toBe('not_found');
    });

    it('should return global_disabled when flag is off', async () => {
      (prisma.featureFlag.findUnique as jest.Mock).mockResolvedValue({
        ...mockFlag,
        enabled: false,
      });

      const result = await service.evaluate('billing.db_plans');
      expect(result.enabled).toBe(false);
      expect(result.reason).toBe('global_disabled');
    });

    it('should return org_allowlist when org is in allowed list', async () => {
      (prisma.featureFlag.findUnique as jest.Mock).mockResolvedValue({
        ...mockFlag,
        allowedOrgIds: ['org-allowed'],
      });

      const result = await service.evaluate('billing.db_plans', 'org-allowed');
      expect(result.enabled).toBe(true);
      expect(result.reason).toBe('org_allowlist');
    });

    it('should check plan override when planCode is provided', async () => {
      (prisma.featureFlag.findUnique as jest.Mock).mockResolvedValue({
        ...mockFlag,
        rolloutPercentage: 0, // Would be excluded by rollout
      });
      (prisma.plan.findUnique as jest.Mock).mockResolvedValue({ id: 'plan-1' });
      (prisma.planFeatureFlag.findUnique as jest.Mock).mockResolvedValue({
        enabled: true,
      });

      const result = await service.evaluate('billing.db_plans', 'org-1', 'pro');
      expect(result.enabled).toBe(true);
      expect(result.reason).toBe('plan_override');
    });

    it('should respect rollout percentage', async () => {
      (prisma.featureFlag.findUnique as jest.Mock).mockResolvedValue({
        ...mockFlag,
        rolloutPercentage: 50,
        allowedOrgIds: [],
      });

      // The result depends on the hash, but should be deterministic
      const result1 = await service.evaluate('billing.db_plans', 'org-a');
      const result2 = await service.evaluate('billing.db_plans', 'org-a');
      // Same org should get same result (deterministic)
      expect(result1.enabled).toBe(result2.enabled);
    });

    it('should exclude from rollout when no orgId', async () => {
      (prisma.featureFlag.findUnique as jest.Mock).mockResolvedValue({
        ...mockFlag,
        rolloutPercentage: 50,
        allowedOrgIds: [],
      });

      const result = await service.evaluate('billing.db_plans');
      expect(result.enabled).toBe(false);
      expect(result.reason).toBe('rollout_excluded');
    });

    it('should return global_enabled for 100% rollout', async () => {
      (prisma.featureFlag.findUnique as jest.Mock).mockResolvedValue(mockFlag);

      const result = await service.evaluate('billing.db_plans');
      expect(result.enabled).toBe(true);
      expect(result.reason).toBe('global_enabled');
    });
  });

  // ---- evaluateAll ----

  describe('evaluateAll', () => {
    it('should evaluate all flags and return a map', async () => {
      redis.get.mockResolvedValueOnce(
        JSON.stringify([
          { key: 'billing.db_plans', enabled: true, rolloutPercentage: 100, allowedOrgIds: [] },
          { key: 'billing.coupons_enabled', enabled: false, rolloutPercentage: 100, allowedOrgIds: [] },
        ]),
      );
      // For individual flag evaluations
      redis.get
        .mockResolvedValueOnce(JSON.stringify({ key: 'billing.db_plans', enabled: true, rolloutPercentage: 100, allowedOrgIds: [] }))
        .mockResolvedValueOnce(JSON.stringify({ key: 'billing.coupons_enabled', enabled: false, rolloutPercentage: 100, allowedOrgIds: [] }));

      const result = await service.evaluateAll();
      expect(result['billing.db_plans']).toBe(true);
      expect(result['billing.coupons_enabled']).toBe(false);
    });
  });

  // ---- getAllFlags ----

  describe('getAllFlags', () => {
    it('should return cached flags when available', async () => {
      const flags = [{ key: 'flag1', enabled: true, rolloutPercentage: 100, allowedOrgIds: [], description: null }];
      redis.get.mockResolvedValue(JSON.stringify(flags));

      const result = await service.getAllFlags();
      expect(result).toEqual(flags);
      expect(prisma.featureFlag.findMany).not.toHaveBeenCalled();
    });

    it('should query DB and cache when no cache', async () => {
      redis.get.mockResolvedValue(null);
      const flags = [{ key: 'flag1', enabled: true, rolloutPercentage: 100, allowedOrgIds: [], description: null }];
      (prisma.featureFlag.findMany as jest.Mock).mockResolvedValue(flags);

      const result = await service.getAllFlags();
      expect(result).toEqual(flags);
      expect(redis.set).toHaveBeenCalledWith(
        'cache:ff:__all__',
        expect.any(String),
        300,
      );
    });
  });

  // ---- invalidateCache ----

  describe('invalidateCache', () => {
    it('should delete all flags cache', async () => {
      await service.invalidateCache();
      expect(redis.del).toHaveBeenCalledWith('cache:ff:__all__');
    });

    it('should delete specific flag cache when key provided', async () => {
      await service.invalidateCache('billing.db_plans');
      expect(redis.del).toHaveBeenCalledWith('cache:ff:__all__');
      expect(redis.del).toHaveBeenCalledWith('cache:ff:billing.db_plans');
    });
  });

  // ---- Plan-level override caching ----

  describe('plan-level override', () => {
    it('should cache plan override result', async () => {
      (prisma.featureFlag.findUnique as jest.Mock).mockResolvedValue({
        ...mockFlag,
        rolloutPercentage: 0,
      });
      // First call: no cache for plan flag
      redis.get
        .mockResolvedValueOnce(null) // flag cache miss
        .mockResolvedValueOnce(null); // plan flag cache miss

      (prisma.plan.findUnique as jest.Mock).mockResolvedValue({ id: 'plan-pro' });
      (prisma.planFeatureFlag.findUnique as jest.Mock).mockResolvedValue({ enabled: true });

      await service.evaluate('billing.db_plans', 'org-1', 'pro');

      // Should have cached the plan flag override
      expect(redis.set).toHaveBeenCalledWith(
        'cache:pff:pro:billing.db_plans',
        'true',
        300,
      );
    });

    it('should use cached plan override', async () => {
      redis.get
        .mockResolvedValueOnce(JSON.stringify({ ...mockFlag, rolloutPercentage: 0 })) // flag cache hit
        .mockResolvedValueOnce('true'); // plan flag cache hit

      const result = await service.evaluate('billing.db_plans', 'org-1', 'pro');
      expect(result.enabled).toBe(true);
      expect(result.reason).toBe('plan_override');
      expect(prisma.planFeatureFlag.findUnique).not.toHaveBeenCalled();
    });

    it('should handle cached null for plan override (no PlanFeatureFlag row)', async () => {
      redis.get
        .mockResolvedValueOnce(JSON.stringify({ ...mockFlag, rolloutPercentage: 0 }))
        .mockResolvedValueOnce('__null__'); // No plan flag exists

      const result = await service.evaluate('billing.db_plans', 'org-1', 'pro');
      expect(result.enabled).toBe(false);
      expect(result.reason).toBe('rollout_excluded');
    });
  });
});
