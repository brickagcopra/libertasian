import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';

import { RedisService } from '../../common/services/redis.service';
import { PrismaService } from '../../prisma/prisma.service';

/** Cache TTL for feature flag data in Redis (seconds) */
const FF_CACHE_TTL = 300; // 5 minutes

/** Cache key prefix for individual flags */
const FF_CACHE_PREFIX = 'cache:ff:';

/** Cache key for the full flag map */
const FF_ALL_CACHE_KEY = 'cache:ff:__all__';

export interface FeatureFlagEvaluation {
  key: string;
  enabled: boolean;
  reason: 'global_disabled' | 'global_enabled' | 'rollout_excluded' | 'rollout_included' | 'org_allowlist' | 'plan_override' | 'not_found';
}

@Injectable()
export class FeatureFlagService {
  private readonly logger = new Logger(FeatureFlagService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // ---- Evaluation ----

  /**
   * Evaluate whether a feature flag is enabled for a given context.
   *
   * Evaluation order:
   * 1. If flag doesn't exist → disabled
   * 2. If flag.enabled is false → disabled (global kill switch)
   * 3. If orgId is in allowedOrgIds → enabled (targeted rollout)
   * 4. If planCode is provided and PlanFeatureFlag exists → use plan-level override
   * 5. If rolloutPercentage < 100 → hash orgId to determine inclusion
   * 6. Otherwise → enabled
   */
  async isEnabled(
    flagKey: string,
    orgId?: string,
    planCode?: string,
  ): Promise<boolean> {
    const evaluation = await this.evaluate(flagKey, orgId, planCode);
    return evaluation.enabled;
  }

  /**
   * Full evaluation with reason tracking (useful for debugging/logging).
   */
  async evaluate(
    flagKey: string,
    orgId?: string,
    planCode?: string,
  ): Promise<FeatureFlagEvaluation> {
    // 1. Load flag from cache or DB
    const flag = await this.getFlag(flagKey);
    if (!flag) {
      return { key: flagKey, enabled: false, reason: 'not_found' };
    }

    // 2. Global kill switch
    if (!flag.enabled) {
      return { key: flagKey, enabled: false, reason: 'global_disabled' };
    }

    // 3. Organization allowlist (targeted rollout)
    if (orgId) {
      const allowedOrgIds = flag.allowedOrgIds as string[];
      if (allowedOrgIds && allowedOrgIds.length > 0) {
        if (allowedOrgIds.includes(orgId)) {
          return { key: flagKey, enabled: true, reason: 'org_allowlist' };
        }
        // If allowlist is set but org is not in it, continue to other checks
      }
    }

    // 4. Plan-level override
    if (planCode) {
      const planOverride = await this.getPlanFlagOverride(flagKey, planCode);
      if (planOverride !== null) {
        return {
          key: flagKey,
          enabled: planOverride,
          reason: 'plan_override',
        };
      }
    }

    // 5. Rollout percentage
    if (flag.rolloutPercentage < 100) {
      if (!orgId) {
        // No org context — treat as excluded from partial rollout
        return { key: flagKey, enabled: false, reason: 'rollout_excluded' };
      }

      const included = this.isInRollout(flagKey, orgId, flag.rolloutPercentage);
      return {
        key: flagKey,
        enabled: included,
        reason: included ? 'rollout_included' : 'rollout_excluded',
      };
    }

    // 6. Fully enabled
    return { key: flagKey, enabled: true, reason: 'global_enabled' };
  }

  // ---- Bulk Evaluation ----

  /**
   * Evaluate all flags for a given context (useful for frontend config).
   */
  async evaluateAll(
    orgId?: string,
    planCode?: string,
  ): Promise<Record<string, boolean>> {
    const flags = await this.getAllFlags();
    const result: Record<string, boolean> = {};

    for (const flag of flags) {
      const evaluation = await this.evaluate(flag.key, orgId, planCode);
      result[flag.key] = evaluation.enabled;
    }

    return result;
  }

  // ---- Data Access ----

  /**
   * Get all feature flags (cached).
   */
  async getAllFlags() {
    const cached = await this.redis.get(FF_ALL_CACHE_KEY);
    if (cached) {
      return JSON.parse(cached) as {
        key: string;
        enabled: boolean;
        rolloutPercentage: number;
        allowedOrgIds: unknown;
        description: string | null;
      }[];
    }

    const flags = await this.prisma.featureFlag.findMany({
      select: {
        key: true,
        enabled: true,
        rolloutPercentage: true,
        allowedOrgIds: true,
        description: true,
      },
    });

    await this.redis.set(FF_ALL_CACHE_KEY, JSON.stringify(flags), FF_CACHE_TTL);
    return flags;
  }

  // ---- Cache Invalidation ----

  /**
   * Invalidate feature flag caches. Call after flag changes.
   */
  async invalidateCache(flagKey?: string): Promise<void> {
    await this.redis.del(FF_ALL_CACHE_KEY);
    if (flagKey) {
      await this.redis.del(`${FF_CACHE_PREFIX}${flagKey}`);
    }
    this.logger.debug(`Feature flag cache invalidated${flagKey ? ` for ${flagKey}` : ' (all)'}`);
  }

  // ---- Private Helpers ----

  /**
   * Get a single flag from cache or DB.
   */
  private async getFlag(flagKey: string) {
    const cacheKey = `${FF_CACHE_PREFIX}${flagKey}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      // Cached 'null' means flag doesn't exist
      if (cached === '__null__') return null;
      return JSON.parse(cached) as {
        key: string;
        enabled: boolean;
        rolloutPercentage: number;
        allowedOrgIds: unknown;
      };
    }

    const flag = await this.prisma.featureFlag.findUnique({
      where: { key: flagKey },
      select: {
        key: true,
        enabled: true,
        rolloutPercentage: true,
        allowedOrgIds: true,
      },
    });

    // Cache the result (including null to avoid repeated DB misses)
    await this.redis.set(
      cacheKey,
      flag ? JSON.stringify(flag) : '__null__',
      FF_CACHE_TTL,
    );

    return flag;
  }

  /**
   * Get plan-level feature flag override.
   * Returns true/false if a PlanFeatureFlag row exists, null if not.
   */
  private async getPlanFlagOverride(
    flagKey: string,
    planCode: string,
  ): Promise<boolean | null> {
    const cacheKey = `cache:pff:${planCode}:${flagKey}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      if (cached === '__null__') return null;
      return cached === 'true';
    }

    // Look up the plan by code, then check PlanFeatureFlag
    const plan = await this.prisma.plan.findUnique({
      where: { code: planCode },
      select: { id: true },
    });

    if (!plan) {
      await this.redis.set(cacheKey, '__null__', FF_CACHE_TTL);
      return null;
    }

    const planFlag = await this.prisma.planFeatureFlag.findUnique({
      where: {
        planId_flagKey: { planId: plan.id, flagKey },
      },
      select: { enabled: true },
    });

    if (!planFlag) {
      await this.redis.set(cacheKey, '__null__', FF_CACHE_TTL);
      return null;
    }

    await this.redis.set(cacheKey, String(planFlag.enabled), FF_CACHE_TTL);
    return planFlag.enabled;
  }

  /**
   * Deterministic rollout check using a hash of flagKey + orgId.
   * Ensures consistent behavior for the same org across evaluations.
   */
  private isInRollout(flagKey: string, orgId: string, percentage: number): boolean {
    const hash = createHash('sha256')
      .update(`${flagKey}:${orgId}`)
      .digest('hex');
    // Use first 8 hex chars (32 bits) for a uniform distribution
    const value = parseInt(hash.substring(0, 8), 16);
    const bucket = value % 100;
    return bucket < percentage;
  }
}
