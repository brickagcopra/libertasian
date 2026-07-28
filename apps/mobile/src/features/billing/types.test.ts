import {
  isPlanCardBullet,
  planDetailToPlanInfo,
  type PlanDetail,
  type PlanEntitlementDetail,
} from './types';

function ent(
  partial: Partial<PlanEntitlementDetail> & { key: string },
): PlanEntitlementDetail {
  return {
    id: `ent-${partial.key}`,
    valueType: 'boolean',
    numericValue: null,
    booleanValue: null,
    description: null,
    ...partial,
  };
}

/**
 * Mirrors the free tier's entitlement rows in
 * apps/api/prisma/seeds/plan-seed.ts — every key carries a description, so
 * an unfiltered bullet list renders a green check next to features the plan
 * does not have.
 */
const FREE_ENTITLEMENTS: PlanEntitlementDetail[] = [
  ent({ key: 'aiAnswers', valueType: 'numeric', numericValue: 15, description: '15 AI answer credits' }),
  ent({ key: 'searchQueries', valueType: 'numeric', numericValue: 50, description: 'Search queries (50/day)' }),
  ent({ key: 'digestsPerMonth', valueType: 'numeric', numericValue: 3, description: 'Case digests (3/month)' }),
  ent({ key: 'maxMatters', valueType: 'numeric', numericValue: 0, description: 'Active matters' }),
  ent({ key: 'offlineReading', valueType: 'boolean', booleanValue: false, description: 'Offline reading' }),
  ent({ key: 'teamCollaboration', valueType: 'boolean', booleanValue: false, description: 'Team collaboration' }),
  ent({ key: 'auditLogs', valueType: 'boolean', booleanValue: false, description: 'Audit logs' }),
  ent({ key: 'editorialTools', valueType: 'boolean', booleanValue: false, description: 'Editorial ingestion tools' }),
  ent({ key: 'memoDraftingPerMonth', valueType: 'numeric', numericValue: 0, description: 'Memo drafting' }),
  ent({ key: 'maxApiKeys', valueType: 'numeric', numericValue: 0, description: 'API keys' }),
  ent({ key: 'previewOnly', valueType: 'boolean', booleanValue: true, description: 'Preview-only public corpus access' }),
];

function planWith(entitlements: PlanEntitlementDetail[], code = 'free'): PlanDetail {
  return {
    id: `plan-${code}`,
    code,
    name: code,
    displayName: code,
    description: null,
    type: 'standard',
    category: 'individual',
    isActive: true,
    isVisible: true,
    displayOrder: 0,
    trialEnabled: false,
    trialDurationDays: 0,
    defaultSeats: 1,
    maxSeats: 1,
    prices: [],
    entitlements,
  };
}

describe('isPlanCardBullet', () => {
  it('keeps entitlements the plan actually grants', () => {
    expect(isPlanCardBullet(ent({ key: 'aiAnswers', valueType: 'numeric', numericValue: 15, description: '15 AI answer credits' }))).toBe(true);
    expect(isPlanCardBullet(ent({ key: 'offlineReading', booleanValue: true, description: 'Offline reading' }))).toBe(true);
    expect(isPlanCardBullet(ent({ key: 'searchQueries', valueType: 'unlimited', description: 'Unlimited search' }))).toBe(true);
  });

  it('drops zero-valued numerics', () => {
    expect(isPlanCardBullet(ent({ key: 'maxMatters', valueType: 'numeric', numericValue: 0, description: 'Active matters' }))).toBe(false);
  });

  it('drops false booleans', () => {
    expect(isPlanCardBullet(ent({ key: 'auditLogs', booleanValue: false, description: 'Audit logs' }))).toBe(false);
  });

  it('drops previewOnly even when true — it is a cap, not a benefit', () => {
    expect(isPlanCardBullet(ent({ key: 'previewOnly', booleanValue: true, description: 'Preview-only public corpus access' }))).toBe(false);
  });

  it('drops entitlements with no description', () => {
    expect(isPlanCardBullet(ent({ key: 'someInternalKey', booleanValue: true }))).toBe(false);
  });
});

describe('planDetailToPlanInfo — free plan bullets', () => {
  const features = planDetailToPlanInfo(planWith(FREE_ENTITLEMENTS)).features;

  it.each([
    'Memo drafting',
    'Audit logs',
    'Team collaboration',
    'API keys',
    'Preview-only public corpus access',
    'Active matters',
    'Offline reading',
    'Editorial ingestion tools',
  ])('does not list %s', (label) => {
    expect(features).not.toContain(label);
  });

  it('still lists what Free does include', () => {
    expect(features).toEqual([
      '15 AI answer credits',
      'Search queries (50/day)',
      'Case digests (3/month)',
    ]);
  });
});

describe('planDetailToPlanInfo — paid plan bullets', () => {
  it('lists a granted boolean and drops the ones still off', () => {
    const features = planDetailToPlanInfo(
      planWith(
        [
          ent({ key: 'offlineReading', booleanValue: true, description: 'Offline mobile reading' }),
          ent({ key: 'teamCollaboration', booleanValue: false, description: 'Team collaboration' }),
          ent({ key: 'previewOnly', booleanValue: false, description: 'Preview-only public corpus access' }),
        ],
        'edu',
      ),
    ).features;

    expect(features).toEqual(['Offline mobile reading']);
  });
});
