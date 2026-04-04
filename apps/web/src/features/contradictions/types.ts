// ─── Contradiction Detection Types ──────────────────────────

export type ContradictionScope = 'selected' | 'topic_based';
export type ContradictionSeverity = 'low' | 'medium' | 'high' | 'critical';
export type ContradictionStatus = 'pending' | 'generating' | 'completed' | 'failed';

// ─── Result Structures ─────────────────────────────────────

export interface ContradictionItem {
  documentAId: string;
  documentATitle: string;
  documentAPassage: string;
  documentBId: string;
  documentBTitle: string;
  documentBPassage: string;
  description: string;
  severity: ContradictionSeverity;
  doctrineArea: string | null;
}

export interface ContradictionReportResult {
  contradictions: ContradictionItem[];
  summary: string;
  documentsAnalyzed: number;
}

// ─── List / Detail ─────────────────────────────────────────

export interface ContradictionReportListItem {
  id: string;
  documentIds: string[];
  scope: string;
  topic: string | null;
  status: string;
  createdAt: string;
}

export interface ContradictionReportDetail extends ContradictionReportListItem {
  resultJson: ContradictionReportResult | null;
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

export interface ContradictionListResponse {
  success: boolean;
  data: ContradictionReportListItem[];
  meta: PaginationMeta;
}

export interface ContradictionDetailResponse {
  success: boolean;
  data: ContradictionReportDetail;
}

// ─── Input Types ───────────────────────────────────────────

export interface GenerateContradictionInput {
  documentIds: string[];
  scope?: string;
  topic?: string;
}

// ─── Filter Types ──────────────────────────────────────────

export interface ContradictionFilters {
  status?: string;
  scope?: string;
  cursor?: string;
  limit?: number;
}

// ─── Display Helpers ───────────────────────────────────────

export const CONTRADICTION_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  generating: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
};

export const CONTRADICTION_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  generating: 'Analyzing...',
  completed: 'Completed',
  failed: 'Failed',
};

export const SEVERITY_COLORS: Record<string, string> = {
  low: 'bg-blue-100 text-blue-700',
  medium: 'bg-yellow-100 text-yellow-700',
  high: 'bg-orange-100 text-orange-700',
  critical: 'bg-red-100 text-red-700',
};

export const SEVERITY_LABELS: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

export const SCOPE_LABELS: Record<string, string> = {
  selected: 'Selected Documents',
  topic_based: 'Topic-Based',
};
