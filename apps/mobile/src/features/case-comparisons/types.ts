// ─── Case Comparison Types ─────────────────────────────────

export type ComparisonType = 'full' | 'doctrine_only' | 'facts_only' | 'ruling_only';

export type ComparisonStatus = 'pending' | 'generating' | 'completed' | 'failed';

// ─── Structured Output ─────────────────────────────────────

export interface CitationRef {
  sourceId: string;
  sectionId?: string | null;
  text: string;
}

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

export interface ComparisonListResponse {
  success: boolean;
  data: CaseComparisonListItem[];
  meta: {
    hasNext: boolean;
    nextCursor?: string;
    limit: number;
  };
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
