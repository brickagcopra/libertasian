import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/services/redis.service';
import { AuditService } from '../audit/audit.service';
import {
  SubscriptionsService,
  type SubscriptionEntitlements,
} from './subscriptions.service';

const ENTITLEMENT_CACHE_PREFIX = 'cache:entitlements:';
const ENTITLEMENT_CACHE_TTL = 120; // 2 minutes

export interface ActiveBonus {
  id: string;
  entitlementKey: string;
  overrideType: string;
  numericValue: number | null;
  booleanValue: boolean | null;
  reason: string;
  sourceType: string;
  expiresAt: string | null;
}

export interface GrantBonusParams {
  organizationId: string;
  entitlementKey: string;
  overrideType: 'bonus_credit' | 'admin_override' | 'promo';
  numericValue?: number;
  booleanValue?: boolean;
  reason: string;
  sourceType: 'admin' | 'coupon' | 'promotion' | 'system';
  sourceId?: string;
  startsAt: Date;
  expiresAt?: Date;
  createdByUserId: string;
  metadata?: Record<string, unknown>;
}

export interface OverrideHistoryParams {
  limit?: number;
  cursor?: string;
}

@Injectable()
export class EntitlementService {
  private readonly logger = new Logger(EntitlementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly subscriptions: SubscriptionsService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Resolve effective entitlements: base plan + active overrides.
   * Cached in Redis for 2 minutes.
   *
   * Merge semantics:
   * - bonus_credit / promo: additive (base 15 + bonus 50 = 65)
   * - admin_override: replaces base value entirely
   * - Bonuses on unlimited (-1) are no-ops
   */
  async resolveEffectiveEntitlements(
    organizationId: string,
  ): Promise<SubscriptionEntitlements> {
    const cacheKey = `${ENTITLEMENT_CACHE_PREFIX}${organizationId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as SubscriptionEntitlements;
    }

    const base = await this.getBaseEntitlements(organizationId);
    const overrides = await this.getActiveOverrides(organizationId);

    const effective = { ...base };

    for (const override of overrides) {
      const key = override.entitlementKey as keyof SubscriptionEntitlements;
      const baseValue = base[key];

      if (override.overrideType === 'admin_override') {
        // Admin override replaces the base value entirely
        if (override.numericValue !== null) {
          (effective as Record<string, unknown>)[key] = override.numericValue;
        } else if (override.booleanValue !== null) {
          (effective as Record<string, unknown>)[key] = override.booleanValue;
        }
      } else {
        // bonus_credit / promo: additive for numeric values
        if (override.numericValue !== null && typeof baseValue === 'number') {
          const currentValue = (effective as Record<string, unknown>)[key] as number;
          // If current effective value is unlimited (-1), bonus is a no-op
          if (currentValue === -1) {
            continue;
          }
          (effective as Record<string, number>)[key] = currentValue + override.numericValue;
        } else if (override.booleanValue !== null) {
          // Boolean bonuses just enable the feature
          (effective as Record<string, unknown>)[key] = override.booleanValue;
        }
      }
    }

    await this.redis.set(cacheKey, JSON.stringify(effective), ENTITLEMENT_CACHE_TTL);

    return effective;
  }

  /**
   * Get base entitlements from the subscription plan (delegates to SubscriptionsService).
   */
  async getBaseEntitlements(
    organizationId: string,
  ): Promise<SubscriptionEntitlements> {
    return this.subscriptions.getEntitlements(organizationId);
  }

  /**
   * Get all active, non-expired, non-revoked overrides that have started.
   */
  async getActiveOverrides(organizationId: string) {
    const now = new Date();
    return this.prisma.entitlementOverride.findMany({
      where: {
        organizationId,
        isActive: true,
        revokedAt: null,
        startsAt: { lte: now },
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: now } },
        ],
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Get active bonuses as a slim projection for user-facing API.
   */
  async getActiveBonuses(organizationId: string): Promise<ActiveBonus[]> {
    const overrides = await this.getActiveOverrides(organizationId);
    return overrides.map((o) => ({
      id: o.id,
      entitlementKey: o.entitlementKey,
      overrideType: o.overrideType,
      numericValue: o.numericValue,
      booleanValue: o.booleanValue,
      reason: o.reason,
      sourceType: o.sourceType,
      expiresAt: o.expiresAt?.toISOString() ?? null,
    }));
  }

  /**
   * Grant a bonus/override. Creates a record, invalidates cache, and writes audit log.
   */
  async grantBonus(params: GrantBonusParams) {
    const override = await this.prisma.entitlementOverride.create({
      data: {
        organizationId: params.organizationId,
        entitlementKey: params.entitlementKey,
        overrideType: params.overrideType,
        numericValue: params.numericValue ?? null,
        booleanValue: params.booleanValue ?? null,
        reason: params.reason,
        sourceType: params.sourceType,
        sourceId: params.sourceId ?? null,
        startsAt: params.startsAt,
        expiresAt: params.expiresAt ?? null,
        createdByUserId: params.createdByUserId,
        metadataJson: (params.metadata ?? {}) as Record<string, string | number | boolean>,
      },
    });

    await this.invalidateEntitlementCache(params.organizationId);

    await this.audit.log({
      organizationId: params.organizationId,
      actorUserId: params.createdByUserId,
      actorType: params.sourceType === 'system' ? 'system' : 'admin',
      action: 'entitlement_override.grant',
      entityType: 'EntitlementOverride',
      entityId: override.id,
      metadata: {
        entitlementKey: params.entitlementKey,
        overrideType: params.overrideType,
        numericValue: params.numericValue ?? null,
        booleanValue: params.booleanValue ?? null,
        sourceType: params.sourceType,
        sourceId: params.sourceId ?? null,
        reason: params.reason,
      },
    });

    return override;
  }

  /**
   * Revoke a bonus/override. Sets isActive=false, records revocation details,
   * invalidates cache, and writes audit log.
   */
  async revokeBonus(
    overrideId: string,
    revokedByUserId: string,
    reason: string,
  ) {
    const existing = await this.prisma.entitlementOverride.findUnique({
      where: { id: overrideId },
    });

    if (!existing) {
      throw new NotFoundException(`Entitlement override ${overrideId} not found`);
    }

    const override = await this.prisma.entitlementOverride.update({
      where: { id: overrideId },
      data: {
        isActive: false,
        revokedAt: new Date(),
        revokedByUserId,
        revokeReason: reason,
      },
    });

    await this.invalidateEntitlementCache(existing.organizationId);

    await this.audit.log({
      organizationId: existing.organizationId,
      actorUserId: revokedByUserId,
      actorType: 'admin',
      action: 'entitlement_override.revoke',
      entityType: 'EntitlementOverride',
      entityId: overrideId,
      metadata: {
        entitlementKey: existing.entitlementKey,
        overrideType: existing.overrideType,
        reason,
      },
    });

    return override;
  }

  /**
   * Cursor-paginated override history (includes revoked/expired).
   */
  async getOverrideHistory(
    organizationId: string,
    params: OverrideHistoryParams = {},
  ) {
    const limit = params.limit ?? 20;
    const items = await this.prisma.entitlementOverride.findMany({
      where: { organizationId },
      take: limit + 1,
      ...(params.cursor && { skip: 1, cursor: { id: params.cursor } }),
      orderBy: { createdAt: 'desc' },
    });

    const hasNext = items.length > limit;
    const data = hasNext ? items.slice(0, limit) : items;
    const lastItem = data[data.length - 1];
    const nextCursor = hasNext && lastItem ? lastItem.id : null;

    return { data, nextCursor, hasNext };
  }

  /**
   * Get the effective limit for a single quota key (used by UsageQuotaService).
   */
  async getEffectiveLimit(
    organizationId: string,
    quotaType: string,
  ): Promise<number> {
    const entitlements = await this.resolveEffectiveEntitlements(organizationId);
    return (entitlements as Record<string, unknown>)[quotaType] as number ?? 0;
  }

  /**
   * Invalidate the entitlement cache for an organization.
   */
  async invalidateEntitlementCache(organizationId: string): Promise<void> {
    const cacheKey = `${ENTITLEMENT_CACHE_PREFIX}${organizationId}`;
    await this.redis.del(cacheKey);
  }
}
