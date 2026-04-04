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

export interface PaginationMeta {
  hasNext: boolean;
  nextCursor?: string;
  limit: number;
}

export interface TimelineListResponse {
  success: boolean;
  data: CaseTimelineListItem[];
  meta: PaginationMeta;
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

export const TIMELINE_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  generating: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
};

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

export const EVENT_TYPE_COLORS: Record<string, string> = {
  filing: 'bg-blue-100 text-blue-700',
  decision: 'bg-purple-100 text-purple-700',
  legislation: 'bg-green-100 text-green-700',
  amendment: 'bg-orange-100 text-orange-700',
  enforcement: 'bg-red-100 text-red-700',
  other: 'bg-gray-100 text-gray-700',
};
