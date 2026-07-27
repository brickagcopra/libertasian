export interface SearchFilters {
  query: string;
  /**
   * Single value, comma list, or array — the API DTO normalises all three to
   * `string[]`. The filter chips send the full array of concrete types in a
   * group (see `features/search/document-types.ts`).
   */
  documentType?: string | string[];
  court?: string;
  ponente?: string;
  grNo?: string;
  dateFrom?: string;
  dateTo?: string;
  barSubjectCode?: string;
  publishedOnly?: boolean;
  page?: number;
  limit?: number;
}

export interface SearchResultSource {
  document_id: string;
  title: string;
  short_title?: string;
  citation_text?: string;
  document_type: string;
  court?: string;
  ponente?: string;
  gr_no?: string;
  docket_no?: string;
  is_official: boolean;
  is_published: boolean;
  decision_date?: string;
  created_at: string;
  bar_subjects?: string[];
  topics?: string[];
  section_id?: string;
  section_type?: string;
}

export interface SearchResultItem {
  id: string;
  score: number;
  source: SearchResultSource;
  highlights?: {
    plain_text?: string[];
    section_text?: string[];
    title?: string[];
  };
}

export interface SearchResponse {
  success: boolean;
  data: SearchResultItem[];
  meta: {
    total: number;
    page: number;
    limit: number;
    hasNext: boolean;
  };
}

export interface SuggestionItem {
  id: string;
  title: string;
  citationText: string | null;
  documentType: string;
}

// --- AI Answer Types ---

export interface AiAnswerSource {
  document_id: string;
  title: string;
  citation_text?: string;
  court?: string;
  gr_no?: string;
  section_id?: string;
  section_type?: string;
  relevance_score: number;
  passage_text: string;
}

export interface AiAnswerChunk {
  type: 'text' | 'metadata' | 'done' | 'error';
  content?: string;
  sources?: AiAnswerSource[];
  confidence?: number;
  abstained?: boolean;
  abstention_reason?: string;
  message?: string;
}

// --- Digest Types for Search ---

export interface SearchDigestItem {
  id: string;
  title: string;
  summary?: string | null;
  digestType: string;
  confidenceScore?: number | null;
  reviewStatus: string;
  visibility: string;
  createdAt: string;
  legalDocument?: {
    id: string;
    title: string;
    shortTitle?: string | null;
    citationText?: string | null;
    grNo?: string | null;
    court?: string | null;
    decisionDate?: string | null;
    documentType?: string | null;
  } | null;
}

// --- Tab Types ---

export type SearchTab = 'fulltext' | 'ai-summary' | 'digests';
