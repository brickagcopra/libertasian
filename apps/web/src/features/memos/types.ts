// ─── Memo Types ─────────────────────────────────────────────

export type MemoType =
  | 'legal_opinion'
  | 'case_analysis'
  | 'statutory_analysis'
  | 'comparative'
  | 'research_summary';

export type MemoStatus = 'pending' | 'generating' | 'completed' | 'failed';

// ─── Structured Output ──────────────────────────────────────

export interface CitationRef {
  sourceId: string;
  sectionId?: string | null;
  text: string;
}

export interface MemoSection {
  heading: string;
  content: string;
  citations: CitationRef[];
}

export interface MemoStructuredOutput {
  title: string;
  summary: string;
  sections: MemoSection[];
  conclusion: string;
}

// ─── List / Detail ──────────────────────────────────────────

export interface MemoListItem {
  id: string;
  query: string;
  memoType: string;
  status: string;
  confidenceScore: number | null;
  createdAt: string;
  updatedAt: string;
  matterId: string | null;
  matter?: { id: string; title: string } | null;
}

export interface MemoDetail extends MemoListItem {
  structuredOutput: MemoStructuredOutput | null;
  citationsJson: CitationRef[];
  modelRunId: string | null;
  userId: string;
  organizationId: string;
}

// ─── API Responses ──────────────────────────────────────────

export interface PaginationMeta {
  hasNext: boolean;
  nextCursor?: string;
  limit: number;
}

export interface MemoListResponse {
  success: boolean;
  data: MemoListItem[];
  meta: PaginationMeta;
}

export interface MemoDetailResponse {
  success: boolean;
  data: MemoDetail;
}

// ─── Input Types ────────────────────────────────────────────

export interface GenerateMemoInput {
  query: string;
  memoType: string;
  matterId?: string;
}

// ─── Filter Types ───────────────────────────────────────────

export interface MemoFilters {
  memoType?: string;
  status?: string;
  matterId?: string;
  cursor?: string;
  limit?: number;
}

// ─── Display Helpers ────────────────────────────────────────

export const MEMO_TYPE_LABELS: Record<string, string> = {
  legal_opinion: 'Legal Opinion',
  case_analysis: 'Case Analysis',
  statutory_analysis: 'Statutory Analysis',
  comparative: 'Comparative',
  research_summary: 'Research Summary',
};

export const MEMO_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  generating: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
};
