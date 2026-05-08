export interface SearchFilters {
  query: string;
  documentType?: string;
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

export interface SearchHighlight {
  field: string;
  fragments: string[];
}

export interface SearchResultItem {
  id: string;
  title: string;
  shortTitle: string | null;
  citationText: string | null;
  grNo: string | null;
  court: string | null;
  ponente: string | null;
  decisionDate: string | null;
  documentType: string;
  isOfficial: boolean;
  score: number;
  highlights: SearchHighlight[];
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
