// ─── Research Workspace Types ──────────────────────────────

// ─── Context Structures ────────────────────────────────────

export interface ResearchContextJson {
  pinnedDocumentIds: string[];
  pinnedSectionIds: string[];
  notes: string;
}

export interface ResearchQueryResponse {
  answer: string;
  followUpSuggestions: string[];
  error?: boolean;
}

export interface CitationRef {
  sourceId: string;
  sectionId: string | null;
  text: string;
}

// ─── List / Detail ─────────────────────────────────────────

export interface ResearchWorkspaceListItem {
  id: string;
  title: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  queryCount: number;
}

export interface ResearchWorkspaceDetail extends ResearchWorkspaceListItem {
  contextJson: ResearchContextJson;
  userId: string;
  organizationId: string;
}

export interface ResearchQueryListItem {
  id: string;
  query: string;
  responseJson: ResearchQueryResponse | null;
  citationsJson: CitationRef[];
  createdAt: string;
}

// ─── API Responses ─────────────────────────────────────────

export interface WorkspaceListResponse {
  success: boolean;
  data: ResearchWorkspaceListItem[];
  meta: {
    hasNext: boolean;
    nextCursor?: string;
    limit: number;
  };
}

export interface WorkspaceDetailResponse {
  success: boolean;
  data: ResearchWorkspaceDetail;
}

export interface QueryListResponse {
  success: boolean;
  data: ResearchQueryListItem[];
  meta: {
    hasNext: boolean;
    nextCursor?: string;
    limit: number;
  };
}

export interface QueryCreateResponse {
  success: boolean;
  data: ResearchQueryListItem;
}

// ─── Input Types ───────────────────────────────────────────

export interface CreateWorkspaceInput {
  title: string;
  description?: string;
  pinnedDocumentIds?: string[];
}

export interface UpdateWorkspaceInput {
  title?: string;
  description?: string;
  pinnedDocumentIds?: string[];
  pinnedSectionIds?: string[];
  notes?: string;
}

export interface AskQueryInput {
  query: string;
}

// ─── Filter Types ──────────────────────────────────────────

export interface WorkspaceFilters {
  cursor?: string;
  limit?: number;
}
