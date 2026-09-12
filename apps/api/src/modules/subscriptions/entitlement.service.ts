import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../common/services/redis.service';
import type { ClientPlatform } from '../../common/config/store-availability';
import { getRequestPlatform } from '../../common/context/request-context';
import { AuditService } from '../audit/audit.service';
import {
  CANONICAL_ENTITLEMENT_KEYS,
  isCanonicalEntitlementKey,
} from './entitlement-keys';
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

/**
 * Which of the three layers decides a key when the paywall is enforced.
 *
 * Structural, not inferred from the resolved number: `EntitlementService`
 * applies overrides last and `SubscriptionsService` merges stored values over
 * plan defaults, so the winner is determined by which layers carry the key —
 * not by which value happens to match. Two layers holding the same number must
 * still report the higher one as the winner, or clearing it would look safe
 * when it is not.
 */
export type EntitlementLayer = 'plan' | 'subscription' | 'override';

/** 'web' is the wire spelling of the `null` (no in-app store) platform. */
export type EntitlementPlatform = 'web' | 'ios' | 'android';

export interface EffectiveEntitlementRow {
  key: string;
  /** What the plan grants. `null` when the plan defines no such key. */
  planValue: unknown;
  /** What `subscriptions.entitlements_json` stores. `null` when absent. */
  storedValue: unknown;
  /** True when the key is PRESENT in entitlements_json (a stored `null`/0 is not "absent"). */
  hasStoredValue: boolean;
  activeOverrides: ActiveBonus[];
  /** What a client on this platform actually resolves to, right now. */
  effectiveValue: unknown;
  winningLayer: EntitlementLayer;
  /** A stored value that disagrees with the plan — the /pricing-vs-reality bug. */
  conflictsWithPlan: boolean;
}

export interface EffectiveEntitlementReport {
  subscriptionId: string;
  organizationId: string;
  planCode: string;
  platform: EntitlementPlatform;
  /**
   * False when this platform cannot buy anything, in which case
   * `getEntitlements` short-circuits to the not-enforced fallback and NONE of
   * the three layers is consulted. `winningLayer` then describes what would win
   * if it were enforced; `effectiveValue` still shows what the user gets today.
   */
  paywallEnforced: boolean;
  /**
   * False when this subscription row is not the one the org currently resolves
   * against (a cancelled row, or an older row outranked by a newer one). The
   * effective column then belongs to `resolvedSubscriptionId`, not to this row.
   */
  isResolvedSubscription: boolean;
  resolvedSubscriptionId: string | null;
  keys: EffectiveEntitlementRow[];
}

export interface StoredEntitlementKeyStats {
  /** How many subscriptions store ANY value for this key. */
  count: number;
  /** Distinct stored values, most common first — the prune button needs a value. */
  values: { value: unknown; count: number }[];
}

export interface PruneEntitlementsJsonResult {
  key: string;
  valueEquals: unknown;
  affectedCount: number;
  subscriptionIds: string[];
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

  // ---- Admin: effective entitlements report ----

  /**
   * Per-key breakdown of the three layers that decide a quota, for one
   * subscription and one client platform.
   *
   * The effective column comes from `resolveEffectiveEntitlements` — the same
   * call the request path makes — and is NOT recomputed here. Re-deriving
   * precedence for the panel is how a panel starts lying: the moment the two
   * implementations disagree, the screen an admin trusts stops describing what
   * a user gets. Everything else in a row (plan, stored, overrides) is raw
   * input, shown so the admin can see WHICH layer produced that number.
   */
  async getEffectiveEntitlementReport(
    subscriptionId: string,
    platform: ClientPlatform | null,
  ): Promise<EffectiveEntitlementReport> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      select: {
        id: true,
        organizationId: true,
        planCode: true,
        entitlementsJson: true,
      },
    });

    if (!subscription) {
      throw new NotFoundException(`Subscription ${subscriptionId} not found`);
    }

    const organizationId = subscription.organizationId;

    const [planDefaults, overrides, effective, resolvedSub] = await Promise.all([
      this.subscriptions.resolvePlanDefaults(
        organizationId,
        subscription.planCode,
      ),
      this.getActiveBonuses(organizationId),
      this.resolveEffectiveEntitlements(organizationId, platform),
      this.subscriptions.getActiveSubscription(organizationId),
    ]);

    const stored = this.readStoredEntitlements(subscription.entitlementsJson);
    const planRecord = planDefaults as Record<string, unknown>;
    const effectiveRecord = effective as Record<string, unknown>;

    const overridesByKey = new Map<string, ActiveBonus[]>();
    for (const override of overrides) {
      const list = overridesByKey.get(override.entitlementKey) ?? [];
      list.push(override);
      overridesByKey.set(override.entitlementKey, list);
    }

    // Canonical keys first, then anything a layer actually carries that the
    // canonical list does not know about — a legacy or misspelled stored key is
    // exactly what an admin needs to SEE in order to clear it.
    const keyOrder: string[] = [...CANONICAL_ENTITLEMENT_KEYS];
    for (const key of [
      ...Object.keys(planRecord),
      ...Object.keys(stored),
      ...overridesByKey.keys(),
    ]) {
      if (!keyOrder.includes(key)) keyOrder.push(key);
    }

    const keys: EffectiveEntitlementRow[] = keyOrder.map((key) => {
      const hasStoredValue = Object.prototype.hasOwnProperty.call(stored, key);
      const storedValue = hasStoredValue ? stored[key] : null;
      const planValue = Object.prototype.hasOwnProperty.call(planRecord, key)
        ? planRecord[key]
        : null;
      const activeOverrides = overridesByKey.get(key) ?? [];

      const winningLayer: EntitlementLayer =
        activeOverrides.length > 0
          ? 'override'
          : hasStoredValue
            ? 'subscription'
            : 'plan';

      return {
        key,
        planValue,
        storedValue,
        hasStoredValue,
        activeOverrides,
        effectiveValue: Object.prototype.hasOwnProperty.call(
          effectiveRecord,
          key,
        )
          ? effectiveRecord[key]
          : null,
        winningLayer,
        // Only a value that is actually STORED can contradict the plan. A key
        // the plan does not define is not a contradiction, it is an extension.
        conflictsWithPlan:
          hasStoredValue && planValue !== null && storedValue !== planValue,
      };
    });

    return {
      subscriptionId: subscription.id,
      organizationId,
      planCode: subscription.planCode,
      platform: platform ?? 'web',
      paywallEnforced: this.subscriptions.isPaywallEnforcedFor(platform),
      isResolvedSubscription: resolvedSub?.id === subscription.id,
      resolvedSubscriptionId: resolvedSub?.id ?? null,
      keys,
    };
  }

  // ---- Admin: entitlements_json writes ----

  /**
   * Set (or replace) keys in one subscription's `entitlements_json`.
   *
   * A MERGE, not a replace of the whole object: an admin fixing `aiAnswers`
   * must not silently drop a complimentary `maxMatters` sitting in the same
   * blob. Removing a key is `clearSubscriptionEntitlement`, which is explicit.
   */
  async setSubscriptionEntitlements(
    subscriptionId: string,
    values: Record<string, unknown>,
    actorUserId: string,
  ) {
    const unknownKeys = Object.keys(values).filter(
      (key) => !isCanonicalEntitlementKey(key),
    );
    if (unknownKeys.length > 0) {
      throw new BadRequestException(
        `Unknown entitlement key(s): ${unknownKeys.join(', ')}`,
      );
    }

    const subscription = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      select: { id: true, organizationId: true, entitlementsJson: true },
    });
    if (!subscription) {
      throw new NotFoundException(`Subscription ${subscriptionId} not found`);
    }

    const before = this.readStoredEntitlements(subscription.entitlementsJson);
    const after = { ...before, ...values };

    const updated = await this.prisma.subscription.update({
      where: { id: subscriptionId },
      data: { entitlementsJson: after as Prisma.InputJsonValue },
    });

    await this.invalidateEntitlementCache(subscription.organizationId);

    await this.audit.log({
      organizationId: subscription.organizationId,
      actorUserId,
      actorType: 'admin',
      action: 'subscription.entitlements_json_set',
      entityType: 'subscription',
      entityId: subscriptionId,
      metadata: { keys: Object.keys(values), before, after },
    });

    return updated;
  }

  /**
   * Remove ONE key from a subscription's `entitlements_json`, so the key falls
   * back to whatever the plan grants.
   *
   * Not validated against the canonical list on purpose — see
   * CANONICAL_ENTITLEMENT_KEYS. A key that is already stored is always
   * removable; refusing to clear junk would strand it permanently.
   */
  async clearSubscriptionEntitlement(
    subscriptionId: string,
    key: string,
    actorUserId: string,
  ) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      select: { id: true, organizationId: true, entitlementsJson: true },
    });
    if (!subscription) {
      throw new NotFoundException(`Subscription ${subscriptionId} not found`);
    }

    const before = this.readStoredEntitlements(subscription.entitlementsJson);
    if (!Object.prototype.hasOwnProperty.call(before, key)) {
      throw new NotFoundException(
        `Subscription ${subscriptionId} stores no entitlement "${key}"`,
      );
    }

    const after = { ...before };
    delete after[key];

    const updated = await this.prisma.subscription.update({
      where: { id: subscriptionId },
      data: { entitlementsJson: after as Prisma.InputJsonValue },
    });

    await this.invalidateEntitlementCache(subscription.organizationId);

    await this.audit.log({
      organizationId: subscription.organizationId,
      actorUserId,
      actorType: 'admin',
      action: 'subscription.entitlements_json_clear',
      entityType: 'subscription',
      entityId: subscriptionId,
      metadata: { key, clearedValue: before[key] ?? null, before, after },
    });

    return updated;
  }

  /**
   * Clear `key` from EVERY subscription whose stored value for it equals
   * `valueEquals`.
   *
   * Exact-value matched, never "clear this key everywhere". The 9 free rows
   * carrying `aiAnswers: 0` from the paid era are junk; a row deliberately
   * storing `aiAnswers: 500` as a complimentary grant is not, and the two are
   * only distinguishable by value.
   *
   * One audit row per subscription. A single summary row would make the blast
   * radius of a bulk edit unauditable per tenant.
   */
  async pruneSubscriptionEntitlementKey(
    key: string,
    valueEquals: unknown,
    actorUserId: string,
  ): Promise<PruneEntitlementsJsonResult> {
    // `key` is matched against stored data, so it is NOT restricted to the
    // canonical list — the junk worth pruning is precisely what may not be on
    // it. It is still length-capped by the DTO.
    //
    // Read every row and match in JS rather than pushing `key` into a Prisma
    // JSON `path` filter. The filter's null semantics (JSON null vs absent vs
    // DB null) differ from the `hasOwnProperty` + `===` test below, and a bulk
    // clear that selects a slightly different set than it reports is worse than
    // a scan. `subscriptions` is a per-org table in the low thousands and this
    // runs on an admin button press, not a request path.
    const candidates = await this.prisma.subscription.findMany({
      select: { id: true, organizationId: true, entitlementsJson: true },
    });

    const affected: string[] = [];

    for (const candidate of candidates) {
      const before = this.readStoredEntitlements(candidate.entitlementsJson);
      if (!Object.prototype.hasOwnProperty.call(before, key)) continue;
      // Strict equality: 0 must not match false, and 15 must not match '15'.
      if (before[key] !== valueEquals) continue;

      const after = { ...before };
      delete after[key];

      await this.prisma.subscription.update({
        where: { id: candidate.id },
        data: { entitlementsJson: after as Prisma.InputJsonValue },
      });

      await this.invalidateEntitlementCache(candidate.organizationId);

      await this.audit.log({
        organizationId: candidate.organizationId,
        actorUserId,
        actorType: 'admin',
        action: 'subscription.entitlements_json_prune',
        entityType: 'subscription',
        entityId: candidate.id,
        metadata: { key, clearedValue: valueEquals, before, after },
      });

      affected.push(candidate.id);
    }

    return {
      key,
      valueEquals,
      affectedCount: affected.length,
      subscriptionIds: affected,
    };
  }

  /**
   * How many subscriptions store their own value for each entitlement key,
   * and what those values are.
   *
   * Drives the "N subscriptions override this key" line on the plan editor —
   * the screen where the contradiction between what /pricing advertises and
   * what accounts actually resolve to becomes visible at all.
   *
   * `planCode` narrows to the subscriptions the plan being edited governs; a
   * stored `aiAnswers: 0` on a pro row says nothing about the free plan.
   */
  async countStoredEntitlementKeys(
    planCode?: string,
  ): Promise<Record<string, StoredEntitlementKeyStats>> {
    const rows = await this.prisma.subscription.findMany({
      where: planCode ? { planCode } : {},
      select: { entitlementsJson: true },
    });

    const byKey = new Map<
      string,
      Map<string, { value: unknown; count: number }>
    >();

    for (const row of rows) {
      const stored = this.readStoredEntitlements(row.entitlementsJson);
      for (const [key, value] of Object.entries(stored)) {
        const values = byKey.get(key) ?? new Map();
        // Bucketed by JSON spelling so 0 and false stay distinct.
        const bucketKey = JSON.stringify(value ?? null);
        const bucket = values.get(bucketKey) ?? { value, count: 0 };
        bucket.count += 1;
        values.set(bucketKey, bucket);
        byKey.set(key, values);
      }
    }

    const result: Record<string, StoredEntitlementKeyStats> = {};
    for (const [key, values] of byKey) {
      const buckets = [...values.values()].sort((a, b) => b.count - a.count);
      result[key] = {
        count: buckets.reduce((sum, b) => sum + b.count, 0),
        values: buckets,
      };
    }
    return result;
  }

  /**
   * Read `entitlements_json` as a plain object.
   *
   * The column is `Json` and defaults to `{}`, but Prisma types it wide enough
   * to be an array, a scalar or JSON null. Anything that is not an object is
   * treated as "stores nothing" rather than spread into a row of numeric keys.
   */
  private readStoredEntitlements(value: unknown): Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }
    return { ...(value as Record<string, unknown>) };
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
