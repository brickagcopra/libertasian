import { RbacCacheService } from './rbac-cache.service';

describe('RbacCacheService', () => {
  let service: RbacCacheService;
  let redis: {
    get: jest.Mock;
    set: jest.Mock;
    del: jest.Mock;
    getClient: jest.Mock;
  };
  let prisma: {
    organizationMember: { findMany: jest.Mock };
    memberRole: { findMany: jest.Mock };
  };
  let redisClient: { del: jest.Mock };

  beforeEach(() => {
    redisClient = { del: jest.fn().mockResolvedValue(1) };
    redis = {
      get: jest.fn(),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(1),
      getClient: jest.fn().mockReturnValue(redisClient),
    };
    prisma = {
      organizationMember: { findMany: jest.fn() },
      memberRole: { findMany: jest.fn() },
    };

    service = new RbacCacheService(redis as never, prisma as never);
  });

  // --------------------------------------------------------------------------
  // getCachedPermissions
  // --------------------------------------------------------------------------

  describe('getCachedPermissions', () => {
    it('should return null on cache miss', async () => {
      redis.get.mockResolvedValue(null);
      const result = await service.getCachedPermissions('member-1');
      expect(result).toBeNull();
      expect(redis.get).toHaveBeenCalledWith('rbac:perms:member-1');
    });

    it('should return parsed permissions on cache hit', async () => {
      redis.get.mockResolvedValue(JSON.stringify(['documents:read', 'documents:create']));
      const result = await service.getCachedPermissions('member-1');
      expect(result).toEqual(['documents:read', 'documents:create']);
    });

    it('should handle corrupted JSON (delete key, return null)', async () => {
      redis.get.mockResolvedValue('not valid json {{{');
      const result = await service.getCachedPermissions('member-1');
      expect(result).toBeNull();
      expect(redis.del).toHaveBeenCalledWith('rbac:perms:member-1');
    });
  });

  // --------------------------------------------------------------------------
  // setCachedPermissions
  // --------------------------------------------------------------------------

  describe('setCachedPermissions', () => {
    it('should store JSON with correct TTL (300s)', async () => {
      await service.setCachedPermissions('member-1', ['documents:read']);
      expect(redis.set).toHaveBeenCalledWith(
        'rbac:perms:member-1',
        JSON.stringify(['documents:read']),
        300,
      );
    });

    it('should use correct key prefix rbac:perms:{memberId}', async () => {
      await service.setCachedPermissions('abc-123', ['admin:dashboard']);
      expect(redis.set).toHaveBeenCalledWith(
        'rbac:perms:abc-123',
        expect.any(String),
        300,
      );
    });
  });

  // --------------------------------------------------------------------------
  // invalidateForMember
  // --------------------------------------------------------------------------

  describe('invalidateForMember', () => {
    it('should delete correct Redis key', async () => {
      await service.invalidateForMember('member-42');
      expect(redis.del).toHaveBeenCalledWith('rbac:perms:member-42');
    });
  });

  // --------------------------------------------------------------------------
  // invalidateForOrg
  // --------------------------------------------------------------------------

  describe('invalidateForOrg', () => {
    it('should query org members and delete all their cache keys', async () => {
      prisma.organizationMember.findMany.mockResolvedValue([
        { id: 'member-1' },
        { id: 'member-2' },
        { id: 'member-3' },
      ]);

      await service.invalidateForOrg('org-1');

      expect(prisma.organizationMember.findMany).toHaveBeenCalledWith({
        where: { organizationId: 'org-1', status: 'active' },
        select: { id: true },
      });
      expect(redisClient.del).toHaveBeenCalledWith(
        'rbac:perms:member-1',
        'rbac:perms:member-2',
        'rbac:perms:member-3',
      );
    });

    it('should handle empty member list gracefully', async () => {
      prisma.organizationMember.findMany.mockResolvedValue([]);
      await service.invalidateForOrg('org-empty');
      expect(redisClient.del).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // invalidateForRole
  // --------------------------------------------------------------------------

  describe('invalidateForRole', () => {
    it('should query role members and delete all their cache keys', async () => {
      prisma.memberRole.findMany.mockResolvedValue([
        { organizationMemberId: 'member-a' },
        { organizationMemberId: 'member-b' },
      ]);

      await service.invalidateForRole('role-def-1');

      expect(prisma.memberRole.findMany).toHaveBeenCalledWith({
        where: { roleDefinitionId: 'role-def-1' },
        select: { organizationMemberId: true },
      });
      expect(redisClient.del).toHaveBeenCalledWith(
        'rbac:perms:member-a',
        'rbac:perms:member-b',
      );
    });

    it('should handle empty member list gracefully', async () => {
      prisma.memberRole.findMany.mockResolvedValue([]);
      await service.invalidateForRole('role-no-members');
      expect(redisClient.del).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // Key prefix consistency
  // --------------------------------------------------------------------------

  describe('key prefix consistency', () => {
    it('all methods should use rbac:perms: prefix', async () => {
      redis.get.mockResolvedValue(null);
      prisma.organizationMember.findMany.mockResolvedValue([{ id: 'm1' }]);
      prisma.memberRole.findMany.mockResolvedValue([{ organizationMemberId: 'm2' }]);

      await service.getCachedPermissions('test');
      await service.setCachedPermissions('test', []);
      await service.invalidateForMember('test');
      await service.invalidateForOrg('org-1');
      await service.invalidateForRole('role-1');

      // Verify all Redis calls use the prefix
      const allCalls = [
        ...redis.get.mock.calls.map((c: string[]) => c[0]),
        ...redis.set.mock.calls.map((c: string[]) => c[0]),
        ...redis.del.mock.calls.map((c: string[]) => c[0]),
        ...redisClient.del.mock.calls.flat(),
      ];

      for (const key of allCalls) {
        expect(key).toMatch(/^rbac:perms:/);
      }
    });
  });
});
