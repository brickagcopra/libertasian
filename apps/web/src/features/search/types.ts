export interface SearchFilters {
  query: string;
  documentType?: string;
  court?: string;
  ponente?: string;
  grNo?: string;
  dateFrom?: string;
  dateTo?: string;
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

export interface SearchMeta {
  total: number;
  maxScore: number | null;
  page: number;
  limit: number;
  timedOut: boolean;
}

export interface SearchResponse {
  success: boolean;
  data: SearchResultItem[];
  meta: SearchMeta;
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

export interface AiAnswerResponse {
  answer: string;
  sources: AiAnswerSource[];
  confidence: number;
  abstained: boolean;
  abstention_reason?: string;
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
