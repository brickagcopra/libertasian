// Re-export from billing module for backward compatibility
export type {
  SubscriptionDetail as SubscriptionInfo,
  SubscriptionResponse,
} from '../billing/types';

// Legacy type alias — plan codes as they arrive from the API. Not display
// text: nothing in the UI renders a tier name (App Review 2.1(b)).
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
