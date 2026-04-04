// Re-export from billing module for backward compatibility
export type {
  SubscriptionDetail as SubscriptionInfo,
  SubscriptionResponse,
} from '../billing/types';
export { PLAN_LABELS, TIER_ORDER } from '../billing/types';
export type { PlanInfo } from '../billing/types';

// Legacy type alias
export type PlanCode = 'free' | 'edu' | 'pro' | 'team' | 'enterprise';

// Legacy interfaces re-exported from new billing types
export type {
  QuotaUsageItem as SubscriptionUsage,
} from '../billing/types';

// Legacy entitlements interface kept for existing consumers
export interface SubscriptionEntitlements {
  aiAnswers: number;
  searchQueries: number;
  digestsPerMonth: number;
  cameraScansPerMonth: number;
  maxMatters: number;
  offlineReading: boolean;
  teamCollaboration: boolean;
  auditLogs: boolean;
  editorialTools: boolean;
}
