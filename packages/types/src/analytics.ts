// ==========================================================================
// Analytics & User Behavior Monitoring Types
// Shared between apps/api, apps/web, apps/mobile
// ==========================================================================

// ---------------------------------------------------------------------------
// Event Categories
// ---------------------------------------------------------------------------

export type AnalyticsEventCategory =
  | 'search'
  | 'ai_answer'
  | 'digest'
  | 'scan'
  | 'study'
  | 'workspace'
  | 'auth'
  | 'billing'
  | 'navigation'
  | 'admin';

export type AnalyticsDeviceType = 'web' | 'ios' | 'android';

// ---------------------------------------------------------------------------
// Client-side tracking API
// ---------------------------------------------------------------------------

export interface TrackEventPayload {
  eventName: string;
  sessionId?: string;
  deviceType?: AnalyticsDeviceType;
  properties: Record<string, unknown>;
  durationMs?: number;
}

export interface TrackBatchPayload {
  events: TrackEventPayload[];
}

export interface StartSessionPayload {
  deviceType?: AnalyticsDeviceType;
  entryPath?: string;
  referrer?: string;
  properties?: Record<string, unknown>;
}

export interface StartSessionResponse {
  sessionId: string;
}

export interface HeartbeatPayload {
  sessionId: string;
  currentPath?: string;
}

export interface EndSessionPayload {
  sessionId: string;
}

// ---------------------------------------------------------------------------
// Dashboard Query
// ---------------------------------------------------------------------------

export interface AnalyticsDashboardQuery {
  from?: string; // YYYY-MM-DD
  to?: string;
  granularity?: 'day' | 'week' | 'month';
  dimension?: 'plan' | 'device' | 'subject';
  organizationId?: string;
}

// ---------------------------------------------------------------------------
// Dashboard Response Types
// ---------------------------------------------------------------------------

export interface AnalyticsDailyAggregateRow {
  id: string;
  date: string;
  metricName: string;
  dimension: string | null;
  metricValue: number;
  uniqueUsers: number;
  organizationId: string | null;
}

export interface AnalyticsFunnelStepRow {
  id: string;
  funnelName: string;
  stepName: string;
  stepOrder: number;
  date: string;
  enteredCount: number;
  completedCount: number;
  droppedCount: number;
  medianTimeSeconds: number | null;
}

export interface AnalyticsRetentionCohortRow {
  id: string;
  cohortWeek: string;
  retentionWeek: number;
  userCount: number;
  returningCount: number;
  retentionRate: number;
  planSegment: string | null;
}

export interface AnalyticsOverviewResponse {
  metrics: AnalyticsDailyAggregateRow[];
  dateRange: { from: string; to: string };
}

export interface AnalyticsFunnelResponse {
  funnelName: string;
  steps: AnalyticsFunnelStepRow[];
  dateRange: { from: string; to: string };
}

export interface AnalyticsRetentionResponse {
  cohorts: AnalyticsRetentionCohortRow[];
  dateRange: { from: string; to: string };
}

export interface AnalyticsRealtimeSnapshot {
  activeSessionCount: number;
  recentEventCount: number;
  eventsPerMinute: number;
  recentEvents: Array<{
    id: string;
    eventName: string;
    eventCategory: string;
    deviceType: string | null;
    createdAt: string;
    userId: string | null; // anonymized: "usr_a1b2..."
  }>;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Funnel Names
// ---------------------------------------------------------------------------

export type AnalyticsFunnelName =
  | 'signup_to_activation'
  | 'free_to_paid'
  | 'scan_to_digest'
  | 'search_to_answer';
