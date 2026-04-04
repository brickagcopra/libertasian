// =====================================================================
// Editorial Intelligence Types — Phase 5 Batch 3
// =====================================================================

// ---- Duplicate Detection ----

/** Status of a document similarity pair. */
export enum DuplicateStatus {
  PENDING = 'pending',
  MERGED = 'merged',
  DISMISSED = 'dismissed',
}

/** How the similarity was detected. */
export enum SimilarityType {
  CHECKSUM = 'checksum',
  TITLE = 'title',
  CITATION = 'citation',
}

/** A document similarity pair returned by the API. */
export interface DocumentSimilarityItem {
  id: string;
  documentAId: string;
  documentBId: string;
  similarityScore: number;
  similarityType: string;
  status: string;
  createdAt: string;
  documentA?: {
    id: string;
    title: string;
    citationText: string | null;
    grNo: string | null;
    documentType: string;
    court: string | null;
    checksum: string | null;
  };
  documentB?: {
    id: string;
    title: string;
    citationText: string | null;
    grNo: string | null;
    documentType: string;
    court: string | null;
    checksum: string | null;
  };
}

/** Stats summary for duplicate pairs. */
export interface DuplicateStats {
  total: number;
  pending: number;
  merged: number;
  dismissed: number;
  byType: {
    type: string;
    count: number;
  }[];
}

/** Result of a detection run. */
export interface DetectionResult {
  pairsCreated: number;
  similarityType: string;
  duration: number;
}

// ---- Source Health ----

/** Weighted health score components for a source. */
export interface SourceHealthComponents {
  endpointAvailability: number;
  fetchSuccessRate: number;
  documentQuality: number;
  freshness: number;
}

/** Full source health report. */
export interface SourceHealthReport {
  sourceId: string;
  sourceName: string;
  healthScore: number;
  components: SourceHealthComponents;
  lastHealthCheckAt: string | null;
  enabled: boolean;
  documentCount: number;
  endpointCount: number;
}

/** Coverage gap entry. */
export interface CoverageGapItem {
  dimension: string;
  value: string;
  documentCount: number;
  latestDate: string | null;
}

/** Staleness report entry. */
export interface StalenessReportItem {
  sourceId: string;
  sourceName: string;
  type: string;
  enabled: boolean;
  lastFetchedAt: string | null;
  daysSinceLastFetch: number | null;
  documentCount: number;
}

// ---- Digest Review Queue ----

/** A single item in the admin review queue. */
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

/** Aggregate statistics for the review queue. */
export interface ReviewQueueStats {
  total: number;
  byStatus: {
    status: string;
    count: number;
  }[];
  bySourceOrigin: {
    sourceOrigin: string;
    count: number;
  }[];
  unassigned: number;
  avgConfidence: number | null;
  avgTimeToReviewHours: number | null;
  perReviewer: {
    reviewerUserId: string;
    reviewerName: string | null;
    assigned: number;
    reviewed: number;
  }[];
}

/** Result of a single review submission. */
export interface ReviewSubmissionResult {
  digestId: string;
  reviewId: string;
  newStatus: string;
  verdict: string;
}

/** Result of a batch review operation. */
export interface BatchReviewResult {
  processed: number;
  digestIds: string[];
}

// ---- Enhanced Coverage Gap Analysis ----

/** Enhanced coverage gap item with gap scoring and staleness data. */
export interface EnhancedCoverageGapItem {
  dimension: string;
  value: string;
  documentCount: number;
  latestDate: string | null;
  staleDays: number | null;
  gapScore: number;
}

/** Bar subject coverage with progress score. */
export interface BarSubjectCoverage {
  subject: string;
  code: string;
  documentCount: number;
  latestDate: string | null;
  coverageScore: number;
}

/** A single data point in an ingestion trend time series. */
export interface IngestionTrendPoint {
  period: string;
  periodLabel: string;
  documentCount: number;
  cumulativeCount: number;
}

/** Source-level gap drilldown with breakdowns by documentType and court. */
export interface SourceGapDrilldown {
  sourceId: string;
  sourceName: string;
  healthScore: number | null;
  byDocumentType: { documentType: string; count: number }[];
  byCourt: { court: string; count: number }[];
  lastFetchedAt: string | null;
  totalDocuments: number;
}

