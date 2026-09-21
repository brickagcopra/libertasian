import { Injectable, Logger } from '@nestjs/common';

import { RedisService } from '../../common/services/redis.service';
import { PrismaService } from '../../prisma/prisma.service';

/** Redis key prefix for TENANT (org-member-keyed) RBAC permission caches */
const KEY_PREFIX = 'rbac:perms:';
/**
 * Redis key prefix for PLATFORM (user-keyed) permission caches.
 *
 * Deliberately distinct from KEY_PREFIX: the two caches are keyed on
 * different id spaces (organization_members.id vs users.id). A shared prefix
 * would let a member id and a user id collide and hand one subject the
 * other's permission set.
 */
const PLATFORM_KEY_PREFIX = 'rbac:pperms:';
/** TTL for cached permission sets (5 minutes) */
const CACHE_TTL_SECONDS = 300;

@Injectable()
export class RbacCacheService {
  private readonly logger = new Logger(RbacCacheService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  // -----------------------------------------------------------------------
  // Core cache operations
  // -----------------------------------------------------------------------

  /**
   * Get cached effective permission codes for an organization member.
   * Returns null on cache miss.
   */
  async getCachedPermissions(memberId: string): Promise<string[] | null> {
    const raw = await this.redis.get(`${KEY_PREFIX}${memberId}`);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as string[];
    } catch {
      await this.redis.del(`${KEY_PREFIX}${memberId}`);
      return null;
    }
  }

  /**
   * Store resolved permission codes for an organization member.
   */
  async setCachedPermissions(memberId: string, permissions: string[]): Promise<void> {
    await this.redis.set(
      `${KEY_PREFIX}${memberId}`,
      JSON.stringify(permissions),
      CACHE_TTL_SECONDS,
    );
  }

  // -----------------------------------------------------------------------
  // Platform (user-keyed) cache operations
  // -----------------------------------------------------------------------

  /**
   * Get cached platform permission codes for a user.
   * Returns null on cache miss.
   */
  async getCachedPlatformPermissions(userId: string): Promise<string[] | null> {
    const raw = await this.redis.get(`${PLATFORM_KEY_PREFIX}${userId}`);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as string[];
    } catch {
      await this.redis.del(`${PLATFORM_KEY_PREFIX}${userId}`);
      return null;
    }
  }

  /** Store resolved platform permission codes for a user. */
  async setCachedPlatformPermissions(
    userId: string,
    permissions: string[],
  ): Promise<void> {
    await this.redis.set(
      `${PLATFORM_KEY_PREFIX}${userId}`,
      JSON.stringify(permissions),
      CACHE_TTL_SECONDS,
    );
  }

  /** Invalidate the platform permission cache for a single user. */
  async invalidatePlatformForUser(userId: string): Promise<void> {
    await this.redis.del(`${PLATFORM_KEY_PREFIX}${userId}`);
    this.logger.debug(`Platform cache invalidated for user ${userId}`);
  }

  /**
   * Invalidate platform caches for every user holding a role definition.
   * Used when a platform role's permissions change — the holders' cached sets
   * are stale the moment the role is edited.
   */
  async invalidatePlatformForRole(roleDefinitionId: string): Promise<void> {
    const grants = await this.prisma.platformRoleGrant.findMany({
      where: { roleDefinitionId },
      select: { userId: true },
    });

    if (grants.length > 0) {
      const client = this.redis.getClient();
      const keys = [
        ...new Set(grants.map((g) => `${PLATFORM_KEY_PREFIX}${g.userId}`)),
      ];
      await client.del(...keys);
    }

    this.logger.debug(
      `Platform cache invalidated for ${grants.length} holder(s) of role ${roleDefinitionId}`,
    );
  }

  // -----------------------------------------------------------------------
  // Invalidation
  // -----------------------------------------------------------------------

  /** Invalidate the permission cache for a single member. */
  async invalidateForMember(memberId: string): Promise<void> {
    await this.redis.del(`${KEY_PREFIX}${memberId}`);
    this.logger.debug(`Cache invalidated for member ${memberId}`);
  }

  /**
   * Invalidate permission caches for ALL members in an organization.
   * Used when a role definition or role→permission mapping changes.
   */
  async invalidateForOrg(organizationId: string): Promise<void> {
    const members = await this.prisma.organizationMember.findMany({
      where: { organizationId, status: 'active' },
      select: { id: true },
    });

    const client = this.redis.getClient();
    if (members.length > 0) {
      const keys = members.map((m) => `${KEY_PREFIX}${m.id}`);
      await client.del(...keys);
    }

    this.logger.debug(
      `Cache invalidated for ${members.length} members in org ${organizationId}`,
    );
  }

  /**
   * Invalidate caches for all members holding a specific role definition.
   * Used when a role's permissions change.
   */
  async invalidateForRole(roleDefinitionId: string): Promise<void> {
    const memberRoles = await this.prisma.memberRole.findMany({
      where: { roleDefinitionId },
      select: { organizationMemberId: true },
    });

    if (memberRoles.length > 0) {
      const client = this.redis.getClient();
      const keys = memberRoles.map((mr) => `${KEY_PREFIX}${mr.organizationMemberId}`);
      await client.del(...keys);
    }

    this.logger.debug(
      `Cache invalidated for ${memberRoles.length} members holding role ${roleDefinitionId}`,
    );
  }
}
