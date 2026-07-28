import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { FeatureFlagService } from '../feature-flags/feature-flags.service';
import { PlansService } from '../plans/plans.service';
import { ACCESSIBLE_STATE_VALUES } from './subscription-state-machine';

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
  documentUploadsPerMonth?: number;
  maxResearchWorkspaces?: number;
  maxApiKeys?: number;
  // When true, public read endpoints expose at most one item per corpus type.
  previewOnly?: boolean;
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
   * Get the subscription that currently grants the organization its tier.
   *
   * Resolves against ACCESSIBLE_STATES, not the literal string 'active'.
   * Filtering on 'active' alone dropped TRIALING, PAST_DUE, GRACE_PERIOD,
   * CANCELLING, COMPLIMENTARY and MIGRATING rows on the floor, so an org that
   * cancelled at period end lost its paid tier the instant the state machine
   * moved it to CANCELLING — despite having paid through currentPeriodEnd.
   * PROVISIONING stays excluded (it is absent from ACCESSIBLE_STATES).
   *
   * Ordering is unchanged: newest row wins. A paid row does NOT outrank a
   * newer free row — see createFreeFallback, which no longer creates a
   * competing free row while an accessible one exists.
   */
  async getActiveSubscription(organizationId: string) {
    return this.prisma.subscription.findFirst({
      where: { organizationId, status: { in: ACCESSIBLE_STATE_VALUES } },
      // `id` is a deterministic tiebreaker: two rows created in the same
      // transaction can share a createdAt, and tier resolution must not be
      // nondeterministic.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  /**
   * True when the org already holds a subscription in an accessible state.
   *
   * Guards free-tier fallback creation. A fallback row is stamped with the
   * current timestamp, so it wins the createdAt-desc ordering in
   * getActiveSubscription and silently demotes a still-valid paid or
   * complimentary subscription to free.
   */
  async hasAccessibleSubscription(organizationId: string): Promise<boolean> {
    const existing = await this.prisma.subscription.findFirst({
      where: { organizationId, status: { in: ACCESSIBLE_STATE_VALUES } },
      select: { id: true },
    });
    return existing !== null;
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
          documentUploadsPerMonth: 0,
          maxResearchWorkspaces: 0,
          maxApiKeys: 0,
          previewOnly: true,
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
          documentUploadsPerMonth: 0,
          maxResearchWorkspaces: 0,
          maxApiKeys: 0,
          previewOnly: false,
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
          documentUploadsPerMonth: -1,
          maxResearchWorkspaces: 3,
          maxApiKeys: 0,
          previewOnly: false,
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
          documentUploadsPerMonth: -1,
          maxResearchWorkspaces: 20,
          maxApiKeys: 0,
          previewOnly: false,
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
          documentUploadsPerMonth: -1,
          maxResearchWorkspaces: -1,
          maxApiKeys: 10,
          previewOnly: false,
        };
      default:
        return this.getDefaultEntitlements('free');
    }
  }
}
