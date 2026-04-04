// ---- Doctrine Types (Mobile) ----

export interface DoctrineListItem {
  id: string;
  text: string;
  normalizedText: string | null;
  doctrineType: string;
  confidence: number | null;
  reviewStatus: string;
  createdAt: string;
  legalDocumentId: string | null;
  legalDocument?: {
    id: string;
    title: string;
    citationText: string | null;
    grNo: string | null;
  } | null;
}

export interface DoctrineDetail extends DoctrineListItem {
  updatedAt: string;
  digestId: string | null;
  sourceSectionId: string | null;
  legalDocument?: {
    id: string;
    title: string;
    citationText: string | null;
    grNo: string | null;
    court: string | null;
    decisionDate: string | null;
  } | null;
  digest?: {
    id: string;
    title: string;
  } | null;
  sourceSection?: {
    id: string;
    sectionType: string;
    sectionLabel: string | null;
  } | null;
  linksFrom?: DoctrineLinkListItem[];
  linksTo?: DoctrineLinkListItem[];
}

export interface DoctrineLinkListItem {
  id: string;
  fromDoctrineId: string;
  toDoctrineId: string;
  linkType: string;
  confidence: number | null;
}

// ---- Review Queue Types (Mobile) ----

export interface ReviewQueueItem {
  id: string;
  title: string;
  digestType: string;
  sourceOrigin: string;
  reviewStatus: string;
  confidenceScore: number | null;
  visibility: string;
  assignedReviewerUserId: string | null;
  userId: string | null;
  organizationId: string | null;
  createdAt: string;
  updatedAt: string;
  legalDocument?: {
    id: string;
    title: string;
    shortTitle: string | null;
    citationText: string | null;
    grNo: string | null;
    court: string | null;
    decisionDate: string | null;
    documentType: string;
  } | null;
  assignedReviewer?: {
    id: string;
    fullName: string | null;
  } | null;
  _count?: {
    reviews: number;
  };
}

export interface ReviewQueueStats {
  total: number;
  byStatus: Array<{ status: string; count: number }>;
  bySourceOrigin: Array<{ sourceOrigin: string; count: number }>;
  unassigned: number;
  avgConfidence: number | null;
  avgTimeToReviewHours: number | null;
  perReviewer: Array<{
    reviewerUserId: string;
    reviewerName: string | null;
    assigned: number;
    reviewed: number;
  }>;
}

export interface BatchReviewResult {
  processed: number;
  digestIds: string[];
}

export interface SubmitReviewResult {
  digestId: string;
  reviewId: string;
  newStatus: string;
  verdict: string;
}

export interface ReviewQueueFilters {
  reviewStatus?: string;
  sourceOrigin?: string;
  cursor?: string;
  limit?: number;
}

// ---- Generic Response Types ----

export interface PaginatedResponse<T> {
  success: true;
  data: T[];
  meta: {
    cursor: string | null;
    hasMore: boolean;
    total: number;
  };
}

export interface ApiResponse<T> {
  success: true;
  data: T;
}
