import type { PrismaClient } from '@prisma/client';

/**
 * Plan seed data — mirrors existing hardcoded values from:
 * - billing.service.ts  → PLAN_PRICING (prices in centavos)
 * - subscriptions.service.ts → TIER_HIERARCHY + getDefaultEntitlements()
 * - web types.ts → PLANS array (frontend display data)
 *
 * Idempotent: uses upsert on unique plan.code.
 */

interface PlanSeedData {
  code: string;
  name: string;
  displayName: string;
  description: string;
  type: string;
  category: string;
  isActive: boolean;
  isVisible: boolean;
  displayOrder: number;
  trialEnabled: boolean;
  trialDurationDays: number;
  gracePeriodDays: number;
  defaultSeats: number;
  maxSeats: number | null;
  isFeatured: boolean;
  featuredLabel: string | null;
  ctaText: string | null;
  highlightColor: string | null;
  prices: { billingInterval: string; amount: number }[];
  entitlements: { key: string; valueType: string; numericValue?: number; booleanValue?: boolean; description: string }[];
}

const PLAN_SEEDS: PlanSeedData[] = [
  {
    code: 'free',
    name: 'Free',
    displayName: 'Free',
    description: 'Browse public legal corpus with basic AI credits',
    type: 'free',
    category: 'free',
    isActive: true,
    isVisible: true,
    displayOrder: 0,
    trialEnabled: false,
    trialDurationDays: 0,
    gracePeriodDays: 0,
    defaultSeats: 1,
    maxSeats: 1,
    isFeatured: false,
    featuredLabel: null,
    ctaText: null,
    highlightColor: null,
    prices: [
      { billingInterval: 'monthly', amount: 0 },
      { billingInterval: 'annual', amount: 0 },
    ],
    entitlements: [
      { key: 'aiAnswers', valueType: 'numeric', numericValue: 15, description: '15 AI answer credits' },
      { key: 'searchQueries', valueType: 'numeric', numericValue: 50, description: 'Limited search queries' },
      { key: 'digestsPerMonth', valueType: 'numeric', numericValue: 3, description: 'Browse public legal corpus' },
      { key: 'cameraScansPerMonth', valueType: 'numeric', numericValue: 3, description: 'OCR preview (no saved digests)' },
      { key: 'maxMatters', valueType: 'numeric', numericValue: 0, description: 'Maximum active matters' },
      { key: 'offlineReading', valueType: 'boolean', booleanValue: false, description: 'Offline reading access' },
      { key: 'teamCollaboration', valueType: 'boolean', booleanValue: false, description: 'Team collaboration features' },
      { key: 'auditLogs', valueType: 'boolean', booleanValue: false, description: 'Audit log access' },
      { key: 'editorialTools', valueType: 'boolean', booleanValue: false, description: 'Editorial ingestion tools' },
      { key: 'memoDraftingPerMonth', valueType: 'numeric', numericValue: 0, description: 'Memo drafting per month' },
      { key: 'pleadingAssistancePerMonth', valueType: 'numeric', numericValue: 0, description: 'Pleading assistance per month' },
      { key: 'caseComparisonPerMonth', valueType: 'numeric', numericValue: 0, description: 'Case comparisons per month' },
      { key: 'timelineGenerationPerMonth', valueType: 'numeric', numericValue: 0, description: 'Timeline generations per month' },
      { key: 'hearingPrepPerMonth', valueType: 'numeric', numericValue: 0, description: 'Hearing prep packs per month' },
      { key: 'contradictionDetectionPerMonth', valueType: 'numeric', numericValue: 0, description: 'Contradiction detections per month' },
      { key: 'documentUploadsPerMonth', valueType: 'numeric', numericValue: 0, description: 'Document uploads' },
      { key: 'maxResearchWorkspaces', valueType: 'numeric', numericValue: 0, description: 'Maximum research workspaces' },
      { key: 'maxApiKeys', valueType: 'numeric', numericValue: 0, description: 'Maximum API keys' },
      { key: 'previewOnly', valueType: 'boolean', booleanValue: true, description: 'Public read endpoints return one item per corpus type' },
    ],
  },
  {
    code: 'edu',
    name: 'Edu',
    displayName: 'Edu',
    description: 'For law students and bar reviewees — unlimited search, AI answers, study tools',
    type: 'standard',
    category: 'student',
    isActive: true,
    isVisible: true,
    displayOrder: 1,
    trialEnabled: true,
    trialDurationDays: 7,
    gracePeriodDays: 3,
    defaultSeats: 1,
    maxSeats: 1,
    isFeatured: false,
    featuredLabel: null,
    ctaText: null,
    highlightColor: null,
    prices: [
      { billingInterval: 'monthly', amount: 29900 },
      { billingInterval: 'annual', amount: 299000 },
    ],
    entitlements: [
      { key: 'aiAnswers', valueType: 'numeric', numericValue: 100, description: 'AI answers (ALAC/IRAC/bar modes)' },
      { key: 'searchQueries', valueType: 'unlimited', description: 'Unlimited search' },
      { key: 'digestsPerMonth', valueType: 'numeric', numericValue: 30, description: 'Reviewer packs & digest library' },
      { key: 'cameraScansPerMonth', valueType: 'numeric', numericValue: 10, description: 'Camera scan digests (10/month)' },
      { key: 'maxMatters', valueType: 'numeric', numericValue: 0, description: 'Maximum active matters' },
      { key: 'offlineReading', valueType: 'boolean', booleanValue: true, description: 'Offline mobile reading' },
      { key: 'teamCollaboration', valueType: 'boolean', booleanValue: false, description: 'Team collaboration features' },
      { key: 'auditLogs', valueType: 'boolean', booleanValue: false, description: 'Audit log access' },
      { key: 'editorialTools', valueType: 'boolean', booleanValue: false, description: 'Editorial ingestion tools' },
      { key: 'memoDraftingPerMonth', valueType: 'numeric', numericValue: 0, description: 'Memo drafting per month' },
      { key: 'pleadingAssistancePerMonth', valueType: 'numeric', numericValue: 0, description: 'Pleading assistance per month' },
      { key: 'caseComparisonPerMonth', valueType: 'numeric', numericValue: 0, description: 'Case comparisons per month' },
      { key: 'timelineGenerationPerMonth', valueType: 'numeric', numericValue: 0, description: 'Timeline generations per month' },
      { key: 'hearingPrepPerMonth', valueType: 'numeric', numericValue: 0, description: 'Hearing prep packs per month' },
      { key: 'contradictionDetectionPerMonth', valueType: 'numeric', numericValue: 0, description: 'Contradiction detections per month' },
      { key: 'documentUploadsPerMonth', valueType: 'numeric', numericValue: 0, description: 'Document uploads' },
      { key: 'maxResearchWorkspaces', valueType: 'numeric', numericValue: 0, description: 'Maximum research workspaces' },
      { key: 'maxApiKeys', valueType: 'numeric', numericValue: 0, description: 'Maximum API keys' },
      { key: 'codalReader', valueType: 'boolean', booleanValue: true, description: 'Codal reader with offline access' },
      { key: 'flashcardGeneration', valueType: 'boolean', booleanValue: true, description: 'Flashcard generation' },
      { key: 'studyProgressTracking', valueType: 'boolean', booleanValue: true, description: 'Study progress tracking' },
      { key: 'previewOnly', valueType: 'boolean', booleanValue: false, description: 'Public read endpoints return one item per corpus type' },
    ],
  },
  {
    code: 'pro',
    name: 'Pro',
    displayName: 'Pro',
    description: 'For solo lawyers and legal researchers — unlimited AI, memo drafting, case tools',
    type: 'standard',
    category: 'individual',
    isActive: true,
    isVisible: true,
    displayOrder: 2,
    trialEnabled: true,
    trialDurationDays: 14,
    gracePeriodDays: 3,
    defaultSeats: 1,
    maxSeats: 1,
    isFeatured: true,
    featuredLabel: 'Most Popular',
    ctaText: null,
    highlightColor: null,
    prices: [
      { billingInterval: 'monthly', amount: 99900 },
      { billingInterval: 'annual', amount: 999000 },
    ],
    entitlements: [
      { key: 'aiAnswers', valueType: 'unlimited', description: 'Unlimited AI answers & digests' },
      { key: 'searchQueries', valueType: 'unlimited', description: 'Everything in Edu' },
      { key: 'digestsPerMonth', valueType: 'unlimited', description: 'Unlimited camera scan digests' },
      { key: 'cameraScansPerMonth', valueType: 'unlimited', description: 'Memo drafting assistance' },
      { key: 'maxMatters', valueType: 'numeric', numericValue: 20, description: 'Up to 20 active matters' },
      { key: 'offlineReading', valueType: 'boolean', booleanValue: true, description: 'Bookmarks, annotations, highlights' },
      { key: 'teamCollaboration', valueType: 'boolean', booleanValue: false, description: 'Team collaboration features' },
      { key: 'auditLogs', valueType: 'boolean', booleanValue: false, description: 'Audit log access' },
      { key: 'editorialTools', valueType: 'boolean', booleanValue: false, description: 'Editorial ingestion tools' },
      { key: 'memoDraftingPerMonth', valueType: 'numeric', numericValue: 20, description: 'Case comparison' },
      { key: 'pleadingAssistancePerMonth', valueType: 'numeric', numericValue: 10, description: 'Pleading assistance per month' },
      { key: 'caseComparisonPerMonth', valueType: 'numeric', numericValue: 10, description: 'Document uploads' },
      { key: 'timelineGenerationPerMonth', valueType: 'numeric', numericValue: 20, description: 'Timeline generations per month' },
      { key: 'hearingPrepPerMonth', valueType: 'numeric', numericValue: 0, description: 'Hearing prep packs per month' },
      { key: 'contradictionDetectionPerMonth', valueType: 'numeric', numericValue: 0, description: 'Contradiction detections per month' },
      { key: 'documentUploadsPerMonth', valueType: 'unlimited', description: 'Document uploads' },
      { key: 'maxResearchWorkspaces', valueType: 'numeric', numericValue: 3, description: 'Maximum research workspaces' },
      { key: 'maxApiKeys', valueType: 'numeric', numericValue: 0, description: 'Maximum API keys' },
      { key: 'previewOnly', valueType: 'boolean', booleanValue: false, description: 'Public read endpoints return one item per corpus type' },
    ],
  },
  {
    code: 'team',
    name: 'Team',
    displayName: 'Team',
    description: 'For small law firms — shared workspace, collaboration, role-based access',
    type: 'team',
    category: 'team',
    isActive: true,
    isVisible: true,
    displayOrder: 3,
    trialEnabled: true,
    trialDurationDays: 14,
    gracePeriodDays: 5,
    defaultSeats: 10,
    maxSeats: 50,
    isFeatured: false,
    featuredLabel: null,
    ctaText: null,
    highlightColor: null,
    prices: [
      { billingInterval: 'monthly', amount: 249900 },
      { billingInterval: 'annual', amount: 2499000 },
    ],
    entitlements: [
      { key: 'aiAnswers', valueType: 'unlimited', description: 'Everything in Pro (per seat)' },
      { key: 'searchQueries', valueType: 'unlimited', description: 'Unlimited search queries' },
      { key: 'digestsPerMonth', valueType: 'unlimited', description: 'Unlimited digest generations' },
      { key: 'cameraScansPerMonth', valueType: 'unlimited', description: 'Unlimited camera scans' },
      { key: 'maxMatters', valueType: 'unlimited', description: 'Unlimited matters' },
      { key: 'offlineReading', valueType: 'boolean', booleanValue: true, description: 'Offline reading access' },
      { key: 'teamCollaboration', valueType: 'boolean', booleanValue: true, description: 'Team-shared workspace' },
      { key: 'auditLogs', valueType: 'boolean', booleanValue: true, description: 'Audit logs' },
      { key: 'editorialTools', valueType: 'boolean', booleanValue: false, description: 'Editorial ingestion tools' },
      { key: 'memoDraftingPerMonth', valueType: 'unlimited', description: 'Collaboration & activity feed' },
      { key: 'pleadingAssistancePerMonth', valueType: 'unlimited', description: 'Role-based access control' },
      { key: 'caseComparisonPerMonth', valueType: 'unlimited', description: 'Task management & calendar' },
      { key: 'timelineGenerationPerMonth', valueType: 'unlimited', description: 'Unlimited timeline generations' },
      { key: 'hearingPrepPerMonth', valueType: 'numeric', numericValue: 10, description: 'Client-safe workspaces' },
      { key: 'contradictionDetectionPerMonth', valueType: 'numeric', numericValue: 5, description: 'Contradiction detections per month' },
      { key: 'documentUploadsPerMonth', valueType: 'unlimited', description: 'Document uploads' },
      { key: 'maxResearchWorkspaces', valueType: 'numeric', numericValue: 20, description: 'Maximum research workspaces' },
      { key: 'maxApiKeys', valueType: 'numeric', numericValue: 0, description: 'Maximum API keys' },
      { key: 'previewOnly', valueType: 'boolean', booleanValue: false, description: 'Public read endpoints return one item per corpus type' },
    ],
  },
  {
    code: 'enterprise',
    name: 'Enterprise',
    displayName: 'Enterprise',
    description: 'For large firms and institutions — editorial tools, API access, dedicated support',
    type: 'enterprise',
    category: 'enterprise',
    isActive: true,
    isVisible: true,
    displayOrder: 4,
    trialEnabled: false,
    trialDurationDays: 0,
    gracePeriodDays: 7,
    defaultSeats: 50,
    maxSeats: null,
    isFeatured: false,
    featuredLabel: null,
    ctaText: null,
    highlightColor: null,
    prices: [
      { billingInterval: 'monthly', amount: 499900 },
      { billingInterval: 'annual', amount: 4999000 },
    ],
    entitlements: [
      { key: 'aiAnswers', valueType: 'unlimited', description: 'Everything in Team' },
      { key: 'searchQueries', valueType: 'unlimited', description: 'Unlimited search queries' },
      { key: 'digestsPerMonth', valueType: 'unlimited', description: 'Publish to shared corpus' },
      { key: 'cameraScansPerMonth', valueType: 'unlimited', description: 'Unlimited camera scans' },
      { key: 'maxMatters', valueType: 'unlimited', description: 'Unlimited active matters' },
      { key: 'offlineReading', valueType: 'boolean', booleanValue: true, description: 'Offline reading access' },
      { key: 'teamCollaboration', valueType: 'boolean', booleanValue: true, description: 'Team collaboration features' },
      { key: 'auditLogs', valueType: 'boolean', booleanValue: true, description: 'Corpus health monitoring' },
      { key: 'editorialTools', valueType: 'boolean', booleanValue: true, description: 'Editorial ingestion tools' },
      { key: 'memoDraftingPerMonth', valueType: 'unlimited', description: 'Unlimited memo drafting' },
      { key: 'pleadingAssistancePerMonth', valueType: 'unlimited', description: 'Unlimited pleading assistance' },
      { key: 'caseComparisonPerMonth', valueType: 'unlimited', description: 'Unlimited case comparisons' },
      { key: 'timelineGenerationPerMonth', valueType: 'unlimited', description: 'Unlimited timeline generations' },
      { key: 'hearingPrepPerMonth', valueType: 'unlimited', description: 'Unlimited hearing prep packs' },
      { key: 'contradictionDetectionPerMonth', valueType: 'unlimited', description: 'Unlimited contradiction detections' },
      { key: 'documentUploadsPerMonth', valueType: 'unlimited', description: 'Document uploads' },
      { key: 'maxResearchWorkspaces', valueType: 'unlimited', description: 'Unlimited research workspaces' },
      { key: 'maxApiKeys', valueType: 'numeric', numericValue: 10, description: 'API access (up to 10 keys)' },
      { key: 'dedicatedSupport', valueType: 'boolean', booleanValue: true, description: 'Dedicated support' },
      { key: 'customIntegrations', valueType: 'boolean', booleanValue: true, description: 'Custom integrations' },
      { key: 'previewOnly', valueType: 'boolean', booleanValue: false, description: 'Public read endpoints return one item per corpus type' },
    ],
  },
];

const FEATURE_FLAG_SEEDS = [
  { key: 'billing.db_plans', enabled: false, description: 'DB-driven plans vs hardcoded fallback' },
  { key: 'billing.coupons_enabled', enabled: false, description: 'Coupon system availability' },
  { key: 'billing.promotions_enabled', enabled: false, description: 'Promotions engine availability' },
  { key: 'billing.pricing_engine', enabled: false, description: 'Central pricing engine for checkout' },
  { key: 'billing.admin_panel', enabled: false, description: 'Billing admin panel visibility' },
  { key: 'billing.subscription_lifecycle', enabled: false, description: 'Extended subscription lifecycle states' },
];

export async function seedPlans(prisma: PrismaClient): Promise<void> {
  console.log('\n  Seeding plans, prices, and entitlements...');

  for (const planSeed of PLAN_SEEDS) {
    // Upsert Plan
    const plan = await prisma.plan.upsert({
      where: { code: planSeed.code },
      update: {
        name: planSeed.name,
        displayName: planSeed.displayName,
        description: planSeed.description,
        type: planSeed.type,
        category: planSeed.category,
        isActive: planSeed.isActive,
        isVisible: planSeed.isVisible,
        displayOrder: planSeed.displayOrder,
        trialEnabled: planSeed.trialEnabled,
        trialDurationDays: planSeed.trialDurationDays,
        gracePeriodDays: planSeed.gracePeriodDays,
        defaultSeats: planSeed.defaultSeats,
        maxSeats: planSeed.maxSeats,
        isFeatured: planSeed.isFeatured,
        featuredLabel: planSeed.featuredLabel,
        ctaText: planSeed.ctaText,
        highlightColor: planSeed.highlightColor,
      },
      create: {
        code: planSeed.code,
        name: planSeed.name,
        displayName: planSeed.displayName,
        description: planSeed.description,
        type: planSeed.type,
        category: planSeed.category,
        isActive: planSeed.isActive,
        isVisible: planSeed.isVisible,
        displayOrder: planSeed.displayOrder,
        trialEnabled: planSeed.trialEnabled,
        trialDurationDays: planSeed.trialDurationDays,
        gracePeriodDays: planSeed.gracePeriodDays,
        defaultSeats: planSeed.defaultSeats,
        maxSeats: planSeed.maxSeats,
        isFeatured: planSeed.isFeatured,
        featuredLabel: planSeed.featuredLabel,
        ctaText: planSeed.ctaText,
        highlightColor: planSeed.highlightColor,
      },
    });

    // Upsert PlanPrices
    for (const price of planSeed.prices) {
      await prisma.planPrice.upsert({
        where: {
          planId_billingInterval_currency: {
            planId: plan.id,
            billingInterval: price.billingInterval,
            currency: 'PHP',
          },
        },
        update: { amount: price.amount, isActive: true },
        create: {
          planId: plan.id,
          billingInterval: price.billingInterval,
          amount: price.amount,
          currency: 'PHP',
          isActive: true,
        },
      });
    }

    // Upsert PlanEntitlements
    for (const ent of planSeed.entitlements) {
      await prisma.planEntitlement.upsert({
        where: {
          planId_key: { planId: plan.id, key: ent.key },
        },
        update: {
          valueType: ent.valueType,
          numericValue: ent.numericValue ?? null,
          booleanValue: ent.booleanValue ?? null,
          description: ent.description,
        },
        create: {
          planId: plan.id,
          key: ent.key,
          valueType: ent.valueType,
          numericValue: ent.numericValue ?? null,
          booleanValue: ent.booleanValue ?? null,
          description: ent.description,
        },
      });
    }

    console.log(`    Plan: ${planSeed.code} (${planSeed.prices.length} prices, ${planSeed.entitlements.length} entitlements)`);
  }

  // Link existing subscriptions to Plan records by planCode
  console.log('\n  Linking existing subscriptions to Plan records...');
  const plans = await prisma.plan.findMany({ select: { id: true, code: true } });
  const planCodeToId = new Map(plans.map((p) => [p.code, p.id]));

  for (const [code, planId] of planCodeToId) {
    const result = await prisma.subscription.updateMany({
      where: { planCode: code, planId: null },
      data: { planId },
    });
    if (result.count > 0) {
      console.log(`    Linked ${result.count} subscription(s) with planCode="${code}" to Plan.id`);
    }
  }

  console.log(`\n  ${PLAN_SEEDS.length} plans seeded.`);
}

export async function seedFeatureFlags(prisma: PrismaClient): Promise<void> {
  console.log('\n  Seeding feature flags...');

  for (const flag of FEATURE_FLAG_SEEDS) {
    await prisma.featureFlag.upsert({
      where: { key: flag.key },
      update: { description: flag.description },
      create: {
        key: flag.key,
        enabled: flag.enabled,
        rolloutPercentage: 100,
        allowedOrgIds: [],
        description: flag.description,
      },
    });
    console.log(`    Flag: ${flag.key} (default: ${flag.enabled})`);
  }

  console.log(`  ${FEATURE_FLAG_SEEDS.length} feature flags seeded.`);
}
