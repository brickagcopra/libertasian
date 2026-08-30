import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/services/redis.service';
import { AuditService } from '../audit/audit.service';
import { SubscriptionsService } from './subscriptions.service';
import { EntitlementService } from './entitlement.service';

describe('EntitlementService', () => {
  let service: EntitlementService;
  let prisma: {
    entitlementOverride: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };
  let redis: jest.Mocked<Pick<RedisService, 'get' | 'set' | 'del'>>;
  let subscriptions: jest.Mocked<Pick<SubscriptionsService, 'getEntitlements'>>;
  let audit: jest.Mocked<Pick<AuditService, 'log'>>;

  const mockBaseEntitlements = {
    aiAnswers: 15,
    searchQueries: 50,
    digestsPerMonth: 3,
    cameraScansPerMonth: 3,
    offlineReading: false,
  };

  beforeEach(async () => {
    prisma = {
      entitlementOverride: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EntitlementService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
        {
          provide: RedisService,
          useValue: {
            get: jest.fn().mockResolvedValue(null),
            set: jest.fn(),
            del: jest.fn(),
          },
        },
        {
          provide: SubscriptionsService,
          useValue: {
            getEntitlements: jest.fn().mockResolvedValue(mockBaseEntitlements),
          },
        },
        {
          provide: AuditService,
          useValue: {
            log: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<EntitlementService>(EntitlementService);
    redis = module.get(RedisService);
    subscriptions = module.get(SubscriptionsService);
    audit = module.get(AuditService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ---- resolveEffectiveEntitlements ----

  describe('resolveEffectiveEntitlements', () => {
    it('should return base entitlements when no overrides exist', async () => {
      const result = await service.resolveEffectiveEntitlements('org-1');

      expect(result).toEqual(mockBaseEntitlements);
      expect(subscriptions.getEntitlements).toHaveBeenCalledWith('org-1', null);
    });

    it('should return cached result if available', async () => {
      const cached = { aiAnswers: 65 };
      redis.get.mockResolvedValue(JSON.stringify(cached));

      const result = await service.resolveEffectiveEntitlements('org-1');

      expect(result).toEqual(cached);
      expect(subscriptions.getEntitlements).not.toHaveBeenCalled();
    });

    it('should cache the resolved entitlements in Redis with 2min TTL', async () => {
      await service.resolveEffectiveEntitlements('org-1');

      expect(redis.set).toHaveBeenCalledWith(
        'cache:entitlements:org-1:none',
        JSON.stringify(mockBaseEntitlements),
        120,
      );
    });

    it('should add bonus_credit values to base (additive)', async () => {
      prisma.entitlementOverride.findMany.mockResolvedValue([
        {
          entitlementKey: 'aiAnswers',
          overrideType: 'bonus_credit',
          numericValue: 50,
          booleanValue: null,
        },
      ]);

      const result = await service.resolveEffectiveEntitlements('org-1');

      expect(result.aiAnswers).toBe(65); // 15 + 50
    });

    it('should add promo values to base (additive)', async () => {
      prisma.entitlementOverride.findMany.mockResolvedValue([
        {
          entitlementKey: 'digestsPerMonth',
          overrideType: 'promo',
          numericValue: 10,
          booleanValue: null,
        },
      ]);

      const result = await service.resolveEffectiveEntitlements('org-1');

      expect(result.digestsPerMonth).toBe(13); // 3 + 10
    });

    it('should stack multiple bonuses additively', async () => {
      prisma.entitlementOverride.findMany.mockResolvedValue([
        {
          entitlementKey: 'aiAnswers',
          overrideType: 'bonus_credit',
          numericValue: 20,
          booleanValue: null,
        },
        {
          entitlementKey: 'aiAnswers',
          overrideType: 'promo',
          numericValue: 30,
          booleanValue: null,
        },
      ]);

      const result = await service.resolveEffectiveEntitlements('org-1');

      expect(result.aiAnswers).toBe(65); // 15 + 20 + 30
    });

    it('should replace base with admin_override (not additive)', async () => {
      prisma.entitlementOverride.findMany.mockResolvedValue([
        {
          entitlementKey: 'aiAnswers',
          overrideType: 'admin_override',
          numericValue: 999,
          booleanValue: null,
        },
      ]);

      const result = await service.resolveEffectiveEntitlements('org-1');

      expect(result.aiAnswers).toBe(999);
    });

    it('should handle boolean admin_override', async () => {
      prisma.entitlementOverride.findMany.mockResolvedValue([
        {
          entitlementKey: 'offlineReading',
          overrideType: 'admin_override',
          numericValue: null,
          booleanValue: true,
        },
      ]);

      const result = await service.resolveEffectiveEntitlements('org-1');

      expect(result.offlineReading).toBe(true);
    });

    it('should treat bonus on unlimited (-1) as no-op', async () => {
      subscriptions.getEntitlements.mockResolvedValue({
        aiAnswers: -1, // unlimited
        searchQueries: -1,
      });

      prisma.entitlementOverride.findMany.mockResolvedValue([
        {
          entitlementKey: 'aiAnswers',
          overrideType: 'bonus_credit',
          numericValue: 50,
          booleanValue: null,
        },
      ]);

      const result = await service.resolveEffectiveEntitlements('org-1');

      expect(result.aiAnswers).toBe(-1); // still unlimited, bonus is no-op
    });

    it('should handle boolean bonus (enable feature)', async () => {
      prisma.entitlementOverride.findMany.mockResolvedValue([
        {
          entitlementKey: 'offlineReading',
          overrideType: 'bonus_credit',
          numericValue: null,
          booleanValue: true,
        },
      ]);

      const result = await service.resolveEffectiveEntitlements('org-1');

      expect(result.offlineReading).toBe(true);
    });
  });

  // ---- getActiveOverrides ----

  describe('getActiveOverrides', () => {
    it('should query for active, non-revoked, started, non-expired overrides', async () => {
      await service.getActiveOverrides('org-1');

      expect(prisma.entitlementOverride.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: 'org-1',
            isActive: true,
            revokedAt: null,
          }),
        }),
      );
    });

    it('should order by createdAt ascending', async () => {
      await service.getActiveOverrides('org-1');

      expect(prisma.entitlementOverride.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { createdAt: 'asc' },
        }),
      );
    });
  });

  // ---- getActiveBonuses ----

  describe('getActiveBonuses', () => {
    it('should return slim projection of active overrides', async () => {
      prisma.entitlementOverride.findMany.mockResolvedValue([
        {
          id: 'ov-1',
          entitlementKey: 'aiAnswers',
          overrideType: 'bonus_credit',
          numericValue: 50,
          booleanValue: null,
          reason: 'Promo campaign',
          sourceType: 'promotion',
          expiresAt: new Date('2026-06-01'),
        },
      ]);

      const bonuses = await service.getActiveBonuses('org-1');

      expect(bonuses).toEqual([
        {
          id: 'ov-1',
          entitlementKey: 'aiAnswers',
          overrideType: 'bonus_credit',
          numericValue: 50,
          booleanValue: null,
          reason: 'Promo campaign',
          sourceType: 'promotion',
          expiresAt: '2026-06-01T00:00:00.000Z',
        },
      ]);
    });

    it('should return null expiresAt for non-expiring bonuses', async () => {
      prisma.entitlementOverride.findMany.mockResolvedValue([
        {
          id: 'ov-2',
          entitlementKey: 'digestsPerMonth',
          overrideType: 'admin_override',
          numericValue: 100,
          booleanValue: null,
          reason: 'VIP customer',
          sourceType: 'admin',
          expiresAt: null,
        },
      ]);

      const bonuses = await service.getActiveBonuses('org-1');

      expect(bonuses[0]!.expiresAt).toBeNull();
    });
  });

  // ---- grantBonus ----

  describe('grantBonus', () => {
    const grantParams = {
      organizationId: 'org-1',
      entitlementKey: 'aiAnswers',
      overrideType: 'bonus_credit' as const,
      numericValue: 50,
      reason: 'Customer appreciation',
      sourceType: 'admin' as const,
      startsAt: new Date('2026-01-01'),
      expiresAt: new Date('2026-06-01'),
      createdByUserId: 'admin-1',
    };

    it('should create an override record', async () => {
      prisma.entitlementOverride.create.mockResolvedValue({ id: 'ov-1', ...grantParams });

      await service.grantBonus(grantParams);

      expect(prisma.entitlementOverride.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: 'org-1',
          entitlementKey: 'aiAnswers',
          overrideType: 'bonus_credit',
          numericValue: 50,
        }),
      });
    });

    it('should invalidate entitlement cache after grant', async () => {
      prisma.entitlementOverride.create.mockResolvedValue({ id: 'ov-1' });

      await service.grantBonus(grantParams);

      expect(redis.del).toHaveBeenCalledWith('cache:entitlements:org-1:ios');
      expect(redis.del).toHaveBeenCalledWith('cache:entitlements:org-1:android');
      expect(redis.del).toHaveBeenCalledWith('cache:entitlements:org-1:none');
    });

    it('should write audit log after grant', async () => {
      prisma.entitlementOverride.create.mockResolvedValue({ id: 'ov-1' });

      await service.grantBonus(grantParams);

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'entitlement_override.grant',
          entityType: 'EntitlementOverride',
          entityId: 'ov-1',
          actorUserId: 'admin-1',
        }),
      );
    });

    it('should use system actor type for system source', async () => {
      prisma.entitlementOverride.create.mockResolvedValue({ id: 'ov-1' });

      await service.grantBonus({ ...grantParams, sourceType: 'system' });

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          actorType: 'system',
        }),
      );
    });
  });

  // ---- revokeBonus ----

  describe('revokeBonus', () => {
    it('should set isActive=false and record revocation details', async () => {
      prisma.entitlementOverride.findUnique.mockResolvedValue({
        id: 'ov-1',
        organizationId: 'org-1',
        entitlementKey: 'aiAnswers',
        overrideType: 'bonus_credit',
      });
      prisma.entitlementOverride.update.mockResolvedValue({ id: 'ov-1', isActive: false });

      await service.revokeBonus('ov-1', 'admin-1', 'No longer needed');

      expect(prisma.entitlementOverride.update).toHaveBeenCalledWith({
        where: { id: 'ov-1' },
        data: expect.objectContaining({
          isActive: false,
          revokedByUserId: 'admin-1',
          revokeReason: 'No longer needed',
        }),
      });
    });

    it('should invalidate entitlement cache after revoke', async () => {
      prisma.entitlementOverride.findUnique.mockResolvedValue({
        id: 'ov-1',
        organizationId: 'org-1',
        entitlementKey: 'aiAnswers',
        overrideType: 'bonus_credit',
      });
      prisma.entitlementOverride.update.mockResolvedValue({ id: 'ov-1' });

      await service.revokeBonus('ov-1', 'admin-1', 'Revoked');

      expect(redis.del).toHaveBeenCalledWith('cache:entitlements:org-1:ios');
      expect(redis.del).toHaveBeenCalledWith('cache:entitlements:org-1:android');
      expect(redis.del).toHaveBeenCalledWith('cache:entitlements:org-1:none');
    });

    it('should write audit log after revoke', async () => {
      prisma.entitlementOverride.findUnique.mockResolvedValue({
        id: 'ov-1',
        organizationId: 'org-1',
        entitlementKey: 'aiAnswers',
        overrideType: 'bonus_credit',
      });
      prisma.entitlementOverride.update.mockResolvedValue({ id: 'ov-1' });

      await service.revokeBonus('ov-1', 'admin-1', 'Revoked');

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'entitlement_override.revoke',
          entityType: 'EntitlementOverride',
          entityId: 'ov-1',
        }),
      );
    });

    it('should throw NotFoundException for non-existent override', async () => {
      prisma.entitlementOverride.findUnique.mockResolvedValue(null);

      await expect(
        service.revokeBonus('ov-nonexistent', 'admin-1', 'Revoked'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ---- getOverrideHistory ----

  describe('getOverrideHistory', () => {
    it('should return paginated results with hasNext indicator', async () => {
      const items = Array.from({ length: 21 }, (_, i) => ({
        id: `ov-${i}`,
        entitlementKey: 'aiAnswers',
      }));
      prisma.entitlementOverride.findMany.mockResolvedValue(items);

      const result = await service.getOverrideHistory('org-1', { limit: 20 });

      expect(result.data).toHaveLength(20);
      expect(result.hasNext).toBe(true);
      expect(result.nextCursor).toBe('ov-19');
    });

    it('should return hasNext=false when fewer results than limit', async () => {
      prisma.entitlementOverride.findMany.mockResolvedValue([
        { id: 'ov-1', entitlementKey: 'aiAnswers' },
      ]);

      const result = await service.getOverrideHistory('org-1', { limit: 20 });

      expect(result.data).toHaveLength(1);
      expect(result.hasNext).toBe(false);
      expect(result.nextCursor).toBeNull();
    });

    it('should use cursor when provided', async () => {
      prisma.entitlementOverride.findMany.mockResolvedValue([]);

      await service.getOverrideHistory('org-1', { limit: 10, cursor: 'ov-5' });

      expect(prisma.entitlementOverride.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 1,
          cursor: { id: 'ov-5' },
        }),
      );
    });

    it('should default to limit=20 when not provided', async () => {
      prisma.entitlementOverride.findMany.mockResolvedValue([]);

      await service.getOverrideHistory('org-1');

      expect(prisma.entitlementOverride.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 21, // 20 + 1
        }),
      );
    });
  });

  // ---- getEffectiveLimit ----

  describe('getEffectiveLimit', () => {
    it('should return the effective limit for a single quota type', async () => {
      const result = await service.getEffectiveLimit('org-1', 'aiAnswers');

      expect(result).toBe(15);
    });

    it('should return 0 for undefined quota types', async () => {
      const result = await service.getEffectiveLimit('org-1', 'nonExistentKey');

      expect(result).toBe(0);
    });
  });

  // ---- invalidateEntitlementCache ----

  describe('invalidateEntitlementCache', () => {
    it('should delete the Redis cache key for the org', async () => {
      await service.invalidateEntitlementCache('org-1');

      expect(redis.del).toHaveBeenCalledWith('cache:entitlements:org-1:ios');
      expect(redis.del).toHaveBeenCalledWith('cache:entitlements:org-1:android');
      expect(redis.del).toHaveBeenCalledWith('cache:entitlements:org-1:none');
    });

    it('should clear every platform variant and nothing else', async () => {
      await service.invalidateEntitlementCache('org-1');

      // Exactly three named DELs. Asserted as a count so that adding a variant
      // without adding it to ENTITLEMENT_CACHE_PLATFORMS — which would leave a
      // stale entitlement served for the full TTL after a grant or purchase —
      // fails here rather than in production.
      expect(redis.del).toHaveBeenCalledTimes(3);
    });
  });

  // ---- platform-keyed cache isolation ----

  describe('entitlement cache is keyed by platform', () => {
    /**
     * Entitlements became platform-dependent when the paywall started gating on
     * purchase capability (`isPaywallEnforcedForRequest`). An org-only cache key
     * would let the FIRST client to warm the cache decide the answer every other
     * client sees for the next 120s: an iOS user's gated result served to a web
     * user, or a web user's ungated result served to iOS. Both directions are
     * wrong, and the 402 direction is the one App Review rejects for.
     */
    it('does not serve an ios-platform entry to a header-less caller', async () => {
      const iosEntitlements = { ...mockBaseEntitlements, aiAnswers: 1 };

      // Only the ios variant is warm.
      redis.get.mockImplementation(async (key: string) =>
        key === 'cache:entitlements:org-1:ios'
          ? JSON.stringify(iosEntitlements)
          : null,
      );

      const headerless = await service.resolveEffectiveEntitlements('org-1', null);

      // Must MISS the ios entry and resolve from source, not inherit aiAnswers: 1.
      expect(headerless).toEqual(mockBaseEntitlements);
      expect(subscriptions.getEntitlements).toHaveBeenCalledWith('org-1', null);
    });

    it('reads and writes a distinct key per platform', async () => {
      await service.resolveEffectiveEntitlements('org-1', 'ios');
      await service.resolveEffectiveEntitlements('org-1', 'android');
      await service.resolveEffectiveEntitlements('org-1', null);

      expect(redis.get).toHaveBeenCalledWith('cache:entitlements:org-1:ios');
      expect(redis.get).toHaveBeenCalledWith('cache:entitlements:org-1:android');
      expect(redis.get).toHaveBeenCalledWith('cache:entitlements:org-1:none');

      expect(redis.set).toHaveBeenCalledWith(
        'cache:entitlements:org-1:ios',
        expect.any(String),
        120,
      );
      expect(redis.set).toHaveBeenCalledWith(
        'cache:entitlements:org-1:none',
        expect.any(String),
        120,
      );
    });

    it('threads the platform through to getEntitlements', async () => {
      await service.resolveEffectiveEntitlements('org-1', 'ios');

      // The platform must reach the layer that actually decides enforcement.
      // Keying the cache correctly is useless if every variant resolves from
      // the same platform-blind source.
      expect(subscriptions.getEntitlements).toHaveBeenCalledWith('org-1', 'ios');
    });
  });
});
