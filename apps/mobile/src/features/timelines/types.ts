// ─── Timeline Types ──────────────────────────────────────

export type TimelineEventType =
  | 'filing'
  | 'decision'
  | 'legislation'
  | 'amendment'
  | 'enforcement'
  | 'other';

export type TimelineStatus = 'pending' | 'generating' | 'completed' | 'failed';

// ─── Result Structures ─────────────────────────────────────

export interface TimelineEvent {
  date: string;
  label: string;
  description: string;
  sourceDocumentId: string | null;
  sourceSectionId: string | null;
  eventType: TimelineEventType;
}

export interface TimelineResult {
  events: TimelineEvent[];
  summary: string;
}

// ─── List / Detail ─────────────────────────────────────────

export interface CaseTimelineListItem {
  id: string;
  title: string;
  documentIds: string[];
  status: string;
  createdAt: string;
  matterId: string | null;
  matter?: { id: string; title: string } | null;
}

export interface CaseTimelineDetail extends CaseTimelineListItem {
  timelineJson: TimelineResult | null;
  modelRunId: string | null;
  userId: string;
  organizationId: string;
  updatedAt: string;
}

// ─── API Responses ─────────────────────────────────────────

export interface TimelineListResponse {
  success: boolean;
  data: CaseTimelineListItem[];
  meta: {
    hasNext: boolean;
    nextCursor?: string;
    limit: number;
  };
}

export interface TimelineDetailResponse {
  success: boolean;
  data: CaseTimelineDetail;
}

// ─── Input Types ───────────────────────────────────────────

export interface GenerateTimelineInput {
  title: string;
  documentIds: string[];
  matterId?: string;
}

// ─── Filter Types ──────────────────────────────────────────

export interface TimelineFilters {
  status?: string;
  matterId?: string;
  cursor?: string;
  limit?: number;
}

// ─── Display Helpers ───────────────────────────────────────

export const TIMELINE_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  generating: 'Generating...',
  completed: 'Completed',
  failed: 'Failed',
};

export const EVENT_TYPE_LABELS: Record<string, string> = {
  filing: 'Filing',
  decision: 'Decision',
  legislation: 'Legislation',
  amendment: 'Amendment',
  enforcement: 'Enforcement',
  other: 'Other',
};
