import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { FeatureFlagService } from '../feature-flags/feature-flags.service';
import { PlansService } from '../plans/plans.service';

/**
 * LEGACY FALLBACK — Tier hierarchy: higher index = higher tier.
 * Used for meetsMinimumTier() comparisons. When DB plans are enabled,
 * prefer Plan.displayOrder for tier ordering.
 */
const TIER_HIERARCHY: Record<string, number> = {
  free: 0,
  edu: 1,
  pro: 2,
  team: 3,
  enterprise: 4,
};

export interface SubscriptionEntitlements {
  aiAnswers?: number;
  searchQueries?: number;
  digestsPerMonth?: number;
  cameraScansPerMonth?: number;
  maxMatters?: number;
  offlineReading?: boolean;
  teamCollaboration?: boolean;
  auditLogs?: boolean;
  editorialTools?: boolean;
  // Phase 6 — Advanced AI Workflows
  memoDraftingPerMonth?: number;
  pleadingAssistancePerMonth?: number;
  caseComparisonPerMonth?: number;
  timelineGenerationPerMonth?: number;
  hearingPrepPerMonth?: number;
  contradictionDetectionPerMonth?: number;
  maxResearchWorkspaces?: number;
  maxApiKeys?: number;
}

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly plansService: PlansService,
    private readonly featureFlagService: FeatureFlagService,
  ) {}

  /**
   * Get the active subscription for an organization.
   */
  async getActiveSubscription(organizationId: string) {
    return this.prisma.subscription.findFirst({
      where: { organizationId, status: 'active' },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get the plan code (tier) for an organization.
   */
  async getPlanCode(organizationId: string): Promise<string> {
    const sub = await this.getActiveSubscription(organizationId);
    return sub?.planCode ?? 'free';
  }

  /**
   * Check if a tier meets the required minimum tier.
   * Returns true if currentTier >= requiredTier in the hierarchy.
   */
  static meetsMinimumTier(currentTier: string, requiredTier: string): boolean {
    const currentLevel = TIER_HIERARCHY[currentTier] ?? 0;
    const requiredLevel = TIER_HIERARCHY[requiredTier] ?? 0;
    return currentLevel >= requiredLevel;
  }

  /**
   * Get entitlements for a subscription.
   *
   * When the `billing.db_plans` feature flag is ON, entitlements are
   * resolved from PlanEntitlement DB rows via PlansService.
   * When OFF, falls back to hardcoded defaults for full backward compatibility.
   *
   * In both cases, per-subscription overrides from entitlementsJson are merged on top.
   */
  async getEntitlements(organizationId: string): Promise<SubscriptionEntitlements> {
    const sub = await this.getActiveSubscription(organizationId);
    const planCode = sub?.planCode ?? 'free';

    // Check if DB-driven plans are enabled
    const useDbPlans = await this.featureFlagService.isEnabled(
      'billing.db_plans',
      organizationId,
      planCode,
    );

    let defaults: SubscriptionEntitlements;
    if (useDbPlans) {
      try {
        defaults = await this.plansService.resolveEntitlements(planCode);
      } catch {
        // Fall back to hardcoded if plan not found in DB
        this.logger.warn(
          `DB plan resolution failed for "${planCode}", falling back to hardcoded defaults`,
        );
        defaults = this.getDefaultEntitlements(planCode);
      }
    } else {
      defaults = this.getDefaultEntitlements(planCode);
    }

    if (!sub) {
      return defaults;
    }

    // Merge stored per-subscription overrides on top of defaults
    const stored = (sub.entitlementsJson ?? {}) as Record<string, unknown>;
    return { ...defaults, ...stored };
  }

  /**
   * LEGACY FALLBACK — Get default entitlements for a plan code.
   * Used when feature flag `billing.db_plans` is OFF or DB lookup fails.
   * Must stay in sync with PlanEntitlement seed values in `prisma/seeds/plan-seed.ts`.
   */
  getDefaultEntitlements(planCode: string): SubscriptionEntitlements {
    switch (planCode) {
      case 'free':
        return {
          aiAnswers: 15,
          searchQueries: 50,
          digestsPerMonth: 3,
          cameraScansPerMonth: 3,
          maxMatters: 0,
          offlineReading: false,
          teamCollaboration: false,
          auditLogs: false,
          editorialTools: false,
          memoDraftingPerMonth: 0,
          pleadingAssistancePerMonth: 0,
          caseComparisonPerMonth: 0,
          timelineGenerationPerMonth: 0,
          hearingPrepPerMonth: 0,
          contradictionDetectionPerMonth: 0,
          maxResearchWorkspaces: 0,
          maxApiKeys: 0,
        };
      case 'edu':
        return {
          aiAnswers: 100,
          searchQueries: -1, // unlimited
          digestsPerMonth: 30,
          cameraScansPerMonth: 10,
          maxMatters: 0,
          offlineReading: true,
          teamCollaboration: false,
          auditLogs: false,
          editorialTools: false,
          memoDraftingPerMonth: 0,
          pleadingAssistancePerMonth: 0,
          caseComparisonPerMonth: 0,
          timelineGenerationPerMonth: 0,
          hearingPrepPerMonth: 0,
          contradictionDetectionPerMonth: 0,
          maxResearchWorkspaces: 0,
          maxApiKeys: 0,
        };
      case 'pro':
        return {
          aiAnswers: -1, // unlimited
          searchQueries: -1,
          digestsPerMonth: -1,
          cameraScansPerMonth: -1,
          maxMatters: 20,
          offlineReading: true,
          teamCollaboration: false,
          auditLogs: false,
          editorialTools: false,
          memoDraftingPerMonth: 20,
          pleadingAssistancePerMonth: 10,
          caseComparisonPerMonth: 10,
          timelineGenerationPerMonth: 20,
          hearingPrepPerMonth: 0,
          contradictionDetectionPerMonth: 0,
          maxResearchWorkspaces: 3,
          maxApiKeys: 0,
        };
      case 'team':
        return {
          aiAnswers: -1,
          searchQueries: -1,
          digestsPerMonth: -1,
          cameraScansPerMonth: -1,
          maxMatters: -1, // unlimited
          offlineReading: true,
          teamCollaboration: true,
          auditLogs: true,
          editorialTools: false,
          memoDraftingPerMonth: -1,
          pleadingAssistancePerMonth: -1,
          caseComparisonPerMonth: -1,
          timelineGenerationPerMonth: -1,
          hearingPrepPerMonth: 10,
          contradictionDetectionPerMonth: 5,
          maxResearchWorkspaces: 20,
          maxApiKeys: 0,
        };
      case 'enterprise':
        return {
          aiAnswers: -1,
          searchQueries: -1,
          digestsPerMonth: -1,
          cameraScansPerMonth: -1,
          maxMatters: -1,
          offlineReading: true,
          teamCollaboration: true,
          auditLogs: true,
          editorialTools: true,
          memoDraftingPerMonth: -1,
          pleadingAssistancePerMonth: -1,
          caseComparisonPerMonth: -1,
          timelineGenerationPerMonth: -1,
          hearingPrepPerMonth: -1,
          contradictionDetectionPerMonth: -1,
          maxResearchWorkspaces: -1,
          maxApiKeys: 10,
        };
      default:
        return this.getDefaultEntitlements('free');
    }
  }
}
