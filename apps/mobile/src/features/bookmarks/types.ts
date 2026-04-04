export interface Bookmark {
  id: string;
  userId: string;
  legalDocumentId: string;
  legalDocumentSectionId: string | null;
  note: string | null;
  createdAt: string;
  legalDocument?: {
    id: string;
    title: string;
    shortTitle: string | null;
    citationText: string | null;
    grNo: string | null;
    court: string | null;
    documentType: string;
    decisionDate: string | null;
  };
}

export interface BookmarksResponse {
  data: Bookmark[];
  cursor: string | null;
  hasNext: boolean;
}

export interface CreateBookmarkRequest {
  legalDocumentId: string;
  legalDocumentSectionId?: string;
  note?: string;
}

export interface BookmarkFilters {
  cursor?: string;
  limit?: number;
  legalDocumentId?: string;
}
