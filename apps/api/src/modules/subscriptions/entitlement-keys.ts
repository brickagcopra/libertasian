import type { SubscriptionEntitlements } from './subscriptions.service';

/**
 * The canonical entitlement/quota key vocabulary.
 *
 * Lives in its own file, not in `usage-quota.service.ts`, ONLY to break a
 * cycle: `usage-quota.service` imports `EntitlementService`, and
 * `EntitlementService` needs this list to validate admin writes to
 * `subscriptions.entitlements_json`. `usage-quota.service` re-exports
 * everything here, so every existing import of `QuotaType` /
 * `ALL_QUOTA_TYPES` from that module keeps working and there is still exactly
 * one definition.
 */
export type QuotaType =
  | 'aiAnswers'
  | 'searchQueries'
  | 'digestsPerMonth'
  | 'cameraScansPerMonth'
  | 'memoDraftingPerMonth'
  | 'pleadingAssistancePerMonth'
  | 'caseComparisonPerMonth'
  | 'timelineGenerationPerMonth'
  | 'hearingPrepPerMonth'
  | 'contradictionDetectionPerMonth'
  | 'documentUploadsPerMonth';

export const ALL_QUOTA_TYPES: QuotaType[] = [
  'aiAnswers',
  'searchQueries',
  'digestsPerMonth',
  'cameraScansPerMonth',
  'memoDraftingPerMonth',
  'pleadingAssistancePerMonth',
  'caseComparisonPerMonth',
  'timelineGenerationPerMonth',
  'hearingPrepPerMonth',
  'contradictionDetectionPerMonth',
  'documentUploadsPerMonth',
];

type NonQuotaEntitlementKey = Exclude<keyof SubscriptionEntitlements, QuotaType>;

/**
 * Entitlement keys that are NOT metered quotas: caps and feature flags.
 *
 * A `Record` and not an array on purpose — TypeScript rejects this object if a
 * key of `SubscriptionEntitlements` is missing AND if a key that is not one is
 * added. Adding a field to that interface therefore fails the build here until
 * it is classified, rather than quietly becoming a key the admin panel cannot
 * write.
 */
const NON_QUOTA_ENTITLEMENT_KEYS: Record<NonQuotaEntitlementKey, true> = {
  maxMatters: true,
  offlineReading: true,
  teamCollaboration: true,
  auditLogs: true,
  editorialTools: true,
  maxResearchWorkspaces: true,
  maxApiKeys: true,
  previewOnly: true,
};

/**
 * THE canonical entitlement key list. Every admin write to
 * `subscriptions.entitlements_json` is validated against this set, so a typo
 * ('aiAnswer', 'ai_answers') is rejected at the API boundary instead of being
 * persisted as a key nothing ever reads — which is indistinguishable, from the
 * panel, from a quota that was set and had no effect.
 *
 * Clearing is deliberately NOT validated against this list: a key already
 * stored on a row is always removable, including junk that predates the list.
 */
export const CANONICAL_ENTITLEMENT_KEYS: readonly string[] = [
  ...ALL_QUOTA_TYPES,
  ...Object.keys(NON_QUOTA_ENTITLEMENT_KEYS),
];

export function isCanonicalEntitlementKey(key: string): boolean {
  return CANONICAL_ENTITLEMENT_KEYS.includes(key);
}
