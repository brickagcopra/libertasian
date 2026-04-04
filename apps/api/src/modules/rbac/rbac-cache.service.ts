import { Injectable, Logger } from '@nestjs/common';

import { RedisService } from '../../common/services/redis.service';
import { PrismaService } from '../../prisma/prisma.service';

/** Redis key prefix for RBAC permission caches */
const KEY_PREFIX = 'rbac:perms:';
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
