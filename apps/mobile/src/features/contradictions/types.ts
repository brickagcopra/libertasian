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

export interface ContradictionListResponse {
  success: boolean;
  data: ContradictionReportListItem[];
  meta: {
    hasNext: boolean;
    nextCursor?: string;
    limit: number;
  };
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

export const CONTRADICTION_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  generating: 'Analyzing...',
  completed: 'Completed',
  failed: 'Failed',
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
