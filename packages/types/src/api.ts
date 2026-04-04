import type { CitationRef } from './legal';

export interface PaginatedResponse<T> {
  data: T[];
  cursor: string | null;
  hasNext: boolean;
  total?: number;
}

export interface ApiErrorResponse {
  statusCode: number;
  message: string;
  error: string;
  timestamp: string;
  path: string;
}

export interface HealthCheckResponse {
  status: 'ok' | 'error';
  timestamp: string;
  services: Record<string, ServiceHealth>;
}

export interface ServiceHealth {
  status: 'up' | 'down';
  latencyMs?: number;
  message?: string;
}

export enum SearchIntent {
  CASE_SEARCH = 'case_search',
  STATUTE_SEARCH = 'statute_search',
  LEGAL_QUESTION = 'legal_question',
  CITATION_LOOKUP = 'citation_lookup',
  TOPIC_BROWSE = 'topic_browse',
}

export interface SearchRequest {
  query: string;
  intent?: SearchIntent;
  filters?: SearchFilters;
  cursor?: string;
  limit?: number;
}

export interface SearchFilters {
  documentType?: string[];
  court?: string[];
  dateFrom?: string;
  dateTo?: string;
  sourceAuthority?: string[];
}

export interface AiAnswerChunk {
  type: 'text' | 'citation' | 'done' | 'error';
  content: string;
  citationRef?: CitationRef;
}
