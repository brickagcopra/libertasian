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

/**
 * Payload the rag-service nests under `metadata` on `metadata` and `done`
 * frames (`services/rag-service/src/answer/service.py:240-320`). The NestJS
 * gateway pipes those bytes through verbatim.
 */
export interface AiAnswerChunkMetadata {
  intent?: string;
  passages_used?: number;
  passages_available?: number;
  sources?: AiAnswerSource[];
  confidence?: number;
  confidence_level?: string;
  abstained?: boolean;
  abstention_reason?: string;
  /**
   * Only on a TERMINAL abstention (post-generation, scoped answers with no
   * valid citation). The text already streamed is unsupported and must be
   * replaced by this, not appended to — see `service.py:295-310`.
   */
  abstention_text?: string;
  valid_citations?: number;
  total_citations?: number;
}

/**
 * One SSE frame.
 *
 * The flat fields are the shape of the NON-streaming `POST /ai-answers`
 * response and are kept as a fallback: the stream nests the same values under
 * `metadata`. Reading only the flat ones left sources, confidence and
 * abstention permanently undefined on every streamed answer.
 */
export interface AiAnswerChunk {
  type: 'text' | 'metadata' | 'done' | 'error';
  content?: string;
  metadata?: AiAnswerChunkMetadata;
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
