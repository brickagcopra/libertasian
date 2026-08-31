import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/services/redis.service';
import type { ClientPlatform } from '../../common/config/store-availability';
import { getRequestPlatform } from '../../common/context/request-context';
import { AuditService } from '../audit/audit.service';
import {
  SubscriptionsService,
  type SubscriptionEntitlements,
} from './subscriptions.service';

const ENTITLEMENT_CACHE_PREFIX = 'cache:entitlements:';
const ENTITLEMENT_CACHE_TTL = 120; // 2 minutes

/**
 * The cache-key suffix for a platform. `null` (web, no header, unrecognised
 * value) is spelled 'none' rather than left empty so every key has the same
 * shape and no two variants can collide.
 */
function platformKeyPart(platform: ClientPlatform | null): string {
  return platform ?? 'none';
}

/**
 * Every platform variant a cache key can exist under.
 *
 * `invalidateEntitlementCache` deletes all of them by name. This list is
 * ENUMERATED ON PURPOSE — do NOT replace it with `KEYS` or `SCAN`. `KEYS` is
 * O(n) over the whole keyspace and blocks the single-threaded Redis this
 * process shares with BullMQ; `SCAN` is cursor-based and can miss a key that is
 * written mid-iteration, which is exactly the write pattern an invalidation
 * races against. Three named `DEL`s are cheap, exact, and cannot stall prod.
 *
 * If `ClientPlatform` ever gains a member, add it here. The type is small and
 * closed for precisely this reason.
 */
const ENTITLEMENT_CACHE_PLATFORMS: readonly (ClientPlatform | null)[] = [
  'ios',
  'android',
  null,
];

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
   *
   * `platform` is an OVERRIDE. Omit it and the platform is read from the
   * request-scoped context (see `SubscriptionsService.getEntitlements` for the
   * full rationale); an explicit `null` means "not enforced" and wins.
   */
  async resolveEffectiveEntitlements(
    organizationId: string,
    platform?: ClientPlatform | null,
  ): Promise<SubscriptionEntitlements> {
    // Resolved ONCE here and passed down concretely, so the cache key and the
    // entitlements written under it can never be computed for two different
    // platforms within one call.
    const resolvedPlatform =
      platform === undefined ? getRequestPlatform() : platform;

    // THE PLATFORM IS PART OF THE KEY, and must stay that way. Entitlements are
    // platform-dependent now (see `isPaywallEnforcedForRequest`): the same org
    // resolves to a gated result for a purchase-capable iOS client and an
    // ungated one for web or an older build. An org-only key would serve one
    // of those answers to the other for the full 120s TTL — gating a web user
    // who cannot buy, or un-gating an iOS user who can, depending purely on
    // which client happened to warm the cache first.
    const cacheKey = `${ENTITLEMENT_CACHE_PREFIX}${organizationId}:${platformKeyPart(resolvedPlatform)}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as SubscriptionEntitlements;
    }

    const base = await this.getBaseEntitlements(organizationId, resolvedPlatform);
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
   *
   * `platform` is an OVERRIDE; omit it to read the request-scoped context.
   * Resolved here rather than left to `getEntitlements` so that a caller
   * passing nothing and a caller passing an explicit value take the same path.
   */
  async getBaseEntitlements(
    organizationId: string,
    platform?: ClientPlatform | null,
  ): Promise<SubscriptionEntitlements> {
    const resolvedPlatform =
      platform === undefined ? getRequestPlatform() : platform;
    return this.subscriptions.getEntitlements(organizationId, resolvedPlatform);
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
   * Invalidate the entitlement cache for an organization, across EVERY platform
   * variant.
   *
   * Clearing only one variant would leave the others serving pre-change
   * entitlements for up to the 120s TTL — so a grant, revoke, or store purchase
   * would appear to apply on one client and not another. See
   * `ENTITLEMENT_CACHE_PLATFORMS` for why the variants are enumerated rather
   * than matched with KEYS/SCAN.
   */
  async invalidateEntitlementCache(organizationId: string): Promise<void> {
    await Promise.all(
      ENTITLEMENT_CACHE_PLATFORMS.map((platform) =>
        this.redis.del(
          `${ENTITLEMENT_CACHE_PREFIX}${organizationId}:${platformKeyPart(platform)}`,
        ),
      ),
    );
  }
}
