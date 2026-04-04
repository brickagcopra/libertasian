// ─── Case Comparison Types ─────────────────────────────────

export type ComparisonType = 'full' | 'doctrine_only' | 'facts_only' | 'ruling_only';

export type ComparisonStatus = 'pending' | 'generating' | 'completed' | 'failed';

// ─── Citation Ref ──────────────────────────────────────────

export interface CitationRef {
  sourceId: string;
  sectionId?: string | null;
  text: string;
}

// ─── Result Structures ─────────────────────────────────────

export interface ComparisonDocumentSummary {
  documentId: string;
  title: string;
  citationText: string | null;
  court: string | null;
  decisionDate: string | null;
}

export interface ComparisonDimensionEntry {
  documentId: string;
  content: string;
  citations: CitationRef[];
}

export interface ComparisonDimension {
  dimension: string;
  entries: ComparisonDimensionEntry[];
  analysis: string;
}

export interface ComparisonResult {
  documents: ComparisonDocumentSummary[];
  dimensions: ComparisonDimension[];
  overallAnalysis: string;
}

// ─── List / Detail ─────────────────────────────────────────

export interface CaseComparisonListItem {
  id: string;
  documentIds: string[];
  comparisonType: string;
  status: string;
  createdAt: string;
  matterId: string | null;
  matter?: { id: string; title: string } | null;
}

export interface CaseComparisonDetail extends CaseComparisonListItem {
  resultJson: ComparisonResult | null;
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

export interface ComparisonListResponse {
  success: boolean;
  data: CaseComparisonListItem[];
  meta: PaginationMeta;
}

export interface ComparisonDetailResponse {
  success: boolean;
  data: CaseComparisonDetail;
}

// ─── Input Types ───────────────────────────────────────────

export interface GenerateComparisonInput {
  documentIds: string[];
  comparisonType: ComparisonType;
  matterId?: string;
}

// ─── Filter Types ──────────────────────────────────────────

export interface ComparisonFilters {
  comparisonType?: string;
  status?: string;
  matterId?: string;
  cursor?: string;
  limit?: number;
}

// ─── Display Helpers ───────────────────────────────────────

export const COMPARISON_TYPE_LABELS: Record<string, string> = {
  full: 'Full Comparison',
  doctrine_only: 'Doctrine Only',
  facts_only: 'Facts Only',
  ruling_only: 'Ruling Only',
};

export const COMPARISON_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  generating: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
};
