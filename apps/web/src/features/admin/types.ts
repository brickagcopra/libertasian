// ---- Source Registry ----

export interface Source {
  id: string;
  name: string;
  type: string;
  domain: string | null;
  trustLevel: string;
  enabled: boolean;
  fetchStrategy: string;
  createdAt: string;
  updatedAt: string;
  endpoints: SourceEndpointSummary[];
  _count: { legalDocuments: number; endpoints: number; ingestionJobs: number };
}

export interface SourceDetail {
  id: string;
  name: string;
  type: string;
  domain: string | null;
  trustLevel: string;
  enabled: boolean;
  fetchStrategy: string;
  createdAt: string;
  updatedAt: string;
  endpoints: SourceEndpoint[];
  _count: { legalDocuments: number; ingestionJobs: number };
}

export interface SourceEndpointSummary {
  id: string;
  endpointUrl: string;
  parserType: string;
  status: string;
  lastFetchedAt: string | null;
  lastSuccessAt: string | null;
}

export interface SourceEndpoint {
  id: string;
  sourceId: string;
  endpointUrl: string;
  parserType: string;
  contentTypeHint: string | null;
  scheduleCron: string | null;
  status: string;
  lastFetchedAt: string | null;
  lastSuccessAt: string | null;
}

export interface CreateSourceInput {
  name: string;
  type: string;
  domain?: string;
  trustLevel?: string;
  enabled?: boolean;
  fetchStrategy?: string;
}

export interface UpdateSourceInput {
  name?: string;
  type?: string;
  domain?: string;
  trustLevel?: string;
  enabled?: boolean;
  fetchStrategy?: string;
}

export interface CreateEndpointInput {
  endpointUrl: string;
  parserType: string;
  contentTypeHint?: string;
  scheduleCron?: string;
  status?: string;
}

export interface UpdateEndpointInput {
  endpointUrl?: string;
  parserType?: string;
  contentTypeHint?: string;
  scheduleCron?: string;
  status?: string;
}

// ---- Ingestion Jobs ----

export interface IngestionJob {
  id: string;
  sourceId: string;
  sourceEndpointId: string | null;
  jobType: string;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  recordsFound: number | null;
  recordsCreated: number | null;
  recordsUpdated: number | null;
  errorsJson: unknown;
  source: { id: string; name: string };
  sourceEndpoint: { id: string; endpointUrl: string } | null;
}

// ---- Review Queue ----

export interface ReviewDigest {
  id: string;
  legalDocumentId: string | null;
  sourceOrigin: string;
  title: string;
  digestType: string;
  facts: string | null;
  issues: string | null;
  ruling: string | null;
  doctrine: string | null;
  dispositive: string | null;
  confidenceScore: number | null;
  reviewStatus: string;
  visibility: string;
  createdAt: string;
  legalDocument: {
    id: string;
    title: string;
    citationText: string | null;
    grNo: string | null;
  } | null;
  user: { id: string; fullName: string } | null;
}

// ---- Editorial Flags ----

export interface EditorialFlag {
  id: string;
  legalDocumentId: string | null;
  digestId: string | null;
  flagType: string;
  severity: string;
  details: string | null;
  status: string;
  createdAt: string;
  legalDocument: { id: string; title: string; citationText: string | null } | null;
  digest: { id: string; title: string } | null;
}

// ---- Corpus Health ----

export interface CorpusHealth {
  corpus: {
    total: number;
    published: number;
    draft: number;
    needsReview: number;
    quarantined: number;
  };
  documentsByType: Array<{ type: string; count: number }>;
  sources: Array<{
    id: string;
    name: string;
    type: string;
    trustLevel: string;
    documentCount: number;
    endpoints: Array<{
      lastFetchedAt: string | null;
      lastSuccessAt: string | null;
      status: string;
    }>;
  }>;
  reviewQueue: {
    pendingDigests: number;
    openFlags: number;
  };
}

// ---- Source Health (Phase 5) ----

export interface SourceHealthComponents {
  endpointAvailability: number;
  fetchSuccessRate: number;
  documentQuality: number;
  freshness: number;
}

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

export interface CoverageGapItem {
  dimension: string;
  value: string;
  documentCount: number;
  latestDate: string | null;
}

export interface StalenessReportItem {
  sourceId: string;
  sourceName: string;
  type: string;
  enabled: boolean;
  lastFetchedAt: string | null;
  daysSinceLastFetch: number | null;
  documentCount: number;
}

// ---- Enhanced Coverage Gap Analysis ----

export interface EnhancedCoverageGapItem {
  dimension: string;
  value: string;
  documentCount: number;
  latestDate: string | null;
  staleDays: number | null;
  gapScore: number;
}

export interface BarSubjectCoverage {
  subject: string;
  code: string;
  documentCount: number;
  latestDate: string | null;
  coverageScore: number;
}

export interface IngestionTrendPoint {
  period: string;
  periodLabel: string;
  documentCount: number;
  cumulativeCount: number;
}

export interface SourceGapDrilldown {
  sourceId: string;
  sourceName: string;
  healthScore: number | null;
  byDocumentType: { documentType: string; count: number }[];
  byCourt: { court: string; count: number }[];
  lastFetchedAt: string | null;
  totalDocuments: number;
}

// ---- Duplicates (Phase 5) ----

export interface DocumentSimilarityItem {
  id: string;
  documentAId: string;
  documentBId: string;
  similarityScore: number;
  similarityType: string;
  status: string;
  classificationTier: string | null;
  classificationConfidence: number | null;
  classificationMetadataJson: Record<string, unknown> | null;
  canonicalDocumentId: string | null;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
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

export interface DuplicateStats {
  total: number;
  pending: number;
  merged: number;
  dismissed: number;
  autoDismissed: number;
  byType: Array<{ type: string; count: number }>;
  byTier: Array<{ tier: string | null; count: number }>;
}

export interface DetectionResult {
  pairsCreated: number;
  similarityType: string;
  duration: number;
}

// ---- Classification Review ----

export interface ClassificationReviewItem {
  id: string;
  title: string;
  documentType: string;
  court: string | null;
  grNo: string | null;
  createdAt: string;
  tagMaps: Array<{
    id: string;
    isPrimary: boolean;
    confidence: number | null;
    classifiedBy: string;
    reviewStatus: string;
    tag: {
      id: string;
      code: string;
      name: string;
      tagType: string;
    };
  }>;
}

export interface ClassificationReviewStats {
  needsReview: number;
  auto: number;
  confirmed: number;
  rejected: number;
}

// ---- Ingestion Pipeline Dashboard ----

export interface IngestionPipelineStats {
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  successRate: number | null;
  avgDurationMs: number | null;
  documentsCreated: number;
  documentsSkipped: number;
  documentsDuplicate: number;
  documentsIngested: number;
  activeEndpoints: number;
}

export interface IngestionJobHistoryItem {
  id: string;
  sourceId: string;
  sourceEndpointId: string | null;
  jobType: string;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  recordsFound: number;
  recordsCreated: number;
  recordsUpdated: number;
  recordsSkipped: number;
  recordsDuplicate: number;
  durationMs: number | null;
  triggerType: string;
  errorsJson: unknown;
  source: { id: string; name: string; type: string };
  sourceEndpoint: { id: string; endpointUrl: string; parserType: string } | null;
}

export interface IngestionCandidateItem {
  id: string;
  sourceId: string;
  detectedUrl: string | null;
  detectedTitle: string | null;
  detectedDocumentType: string | null;
  checksum: string | null;
  status: string;
  dedupClassification: string | null;
  dedupConfidence: number | null;
  matchedDocumentId: string | null;
  ingestionJobId: string | null;
  processedAt: string | null;
  createdAt: string;
  matchedDocument: {
    id: string;
    title: string;
    citationText: string | null;
    grNo: string | null;
  } | null;
}

export interface EndpointStatusItem {
  id: string;
  endpointUrl: string;
  parserType: string;
  contentTypeHint: string | null;
  scheduleCron: string | null;
  status: string;
  lastFetchedAt: string | null;
  lastSuccessAt: string | null;
  source: { id: string; name: string; type: string; enabled: boolean };
  fetchSuccessRate: number | null;
  recentJobs: Array<{
    id: string;
    status: string;
    startedAt: string | null;
    finishedAt: string | null;
    recordsFound: number;
    recordsCreated: number;
    durationMs: number | null;
  }>;
}

// ---- Enhanced Review Queue (Phase 5) ----

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

// ---- Doctrines (Phase 5 Batch 6) ----

export interface DoctrineListItem {
  id: string;
  text: string;
  normalizedText: string | null;
  doctrineType: string;
  confidence: number | null;
  reviewStatus: string;
  createdAt: string;
  updatedAt: string;
  legalDocumentId: string | null;
  digestId: string | null;
  legalDocument?: {
    id: string;
    title: string;
    citationText: string | null;
    grNo: string | null;
  } | null;
}

export interface DoctrineDetail {
  id: string;
  text: string;
  normalizedText: string | null;
  doctrineType: string;
  confidence: number | null;
  reviewStatus: string;
  createdAt: string;
  updatedAt: string;
  legalDocumentId: string | null;
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
  createdAt: string;
  fromDoctrine?: {
    id: string;
    text: string;
    doctrineType: string;
  };
  toDoctrine?: {
    id: string;
    text: string;
    doctrineType: string;
  };
}

export interface DoctrineExtractionResult {
  documentId: string;
  documentTitle: string;
  doctrinesExtracted: number;
  status: 'queued' | 'processing' | 'completed';
}

// ---- Knowledge Graph Visualization (Phase 5 Batch 6) ----

export interface GraphVisualizationNode {
  id: string;
  title: string;
  shortTitle: string | null;
  citationText: string | null;
  grNo: string | null;
  documentType: string;
  court: string | null;
  decisionDate: string | null;
}

export interface GraphVisualizationEdge {
  id: string;
  fromDocumentId: string;
  toDocumentId: string;
  citationText: string;
  citationType: string;
  confidence: number | null;
}

export interface GraphVisualizationData {
  nodes: GraphVisualizationNode[];
  edges: GraphVisualizationEdge[];
}

export interface UnresolvedCitationItem {
  id: string;
  fromDocumentId: string;
  citationText: string;
  citationType: string;
  normalizedCitation: string | null;
  confidence: number | null;
  createdAt: string;
  fromDocument?: {
    id: string;
    title: string;
    citationText: string | null;
    grNo: string | null;
    documentType: string;
  };
}

export interface CaseCodalLinkItem {
  id: string;
  caseDocumentId: string;
  codalDocumentId: string;
  codalSectionId: string | null;
  linkType: string;
  notes: string | null;
  confidence: number | null;
  createdAt: string;
  caseDocument?: {
    id: string;
    title: string;
    citationText: string | null;
    grNo: string | null;
  };
  codalDocument?: {
    id: string;
    title: string;
    citationText: string | null;
  };
}

export interface CaseCodalSuggestion {
  caseDocumentId: string;
  codalDocumentId: string;
  codalSectionId: string | null;
  suggestedLinkType: string;
  confidence: number;
  reasoning: string;
  caseDocument?: {
    id: string;
    title: string;
    grNo: string | null;
  };
  codalDocument?: {
    id: string;
    title: string;
    citationText: string | null;
  };
}

export interface BatchAssignResult {
  processed: number;
  digestIds: string[];
}

// ---- Backfill Orchestration ----

export interface BackfillBatch {
  id: string;
  sourceId: string;
  sourceEndpointId?: string;
  name: string;
  description?: string;
  yearStart: number;
  yearEnd: number;
  monthStart?: number;
  monthEnd?: number;
  status: string;
  budgetCeilingUsd: number;
  budgetConsumedUsd: number;
  candidatesDiscovered: number;
  candidatesProcessed: number;
  candidatesSkipped: number;
  candidatesFailed: number;
  documentsCreated: number;
  documentsUpdated: number;
  startedAt?: string;
  finishedAt?: string;
  lastTickAt?: string;
  adminNotes?: string;
  createdAt: string;
  updatedAt: string;
  source?: { id: string; name: string };
}

// ---- Budget Management (§7.2) ----

export interface BudgetSnapshot {
  monthlyCeiling: number;
  dailyCeiling: number | null;
  monthSpend: number;
  daySpend: number;
  monthUtilizationPercent: number;
  dayUtilizationPercent: number | null;
  month: string;
  day: string;
}

export interface LedgerScopeSummary {
  scope: string;
  totalAmountUsd: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalRequests: number;
}

export interface LedgerMonthSummary {
  periodYearMonth: string;
  totalAmountUsd: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalRequests: number;
}

export interface BudgetCurrentResponse {
  snapshot: BudgetSnapshot;
  byScope: LedgerScopeSummary[];
}

// ---- Golden Sets (PR 4.1) ----

export interface GoldenSetEntry {
  id: string;
  goldenSetType: string;
  sourceDocumentId: string | null;
  referenceDataJson: Record<string, unknown>;
  status: string;
  reviewNotes: string | null;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  sourceDocument?: {
    id: string;
    title: string;
    citationText: string | null;
  } | null;
  reviewedByUser?: {
    id: string;
    fullName: string;
  } | null;
}

export interface EvaluationRun {
  id: string;
  goldenSetType: string;
  promptTemplateVersion: string;
  modelName: string;
  totalEntries: number;
  passingEntries: number;
  passRate: number;
  scoreDetailsJson: Record<string, unknown>;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  createdAt: string;
}

export interface GoldenSetStats {
  caseDigest: { total: number; approved: number; pending: number };
  subjectClassification: { total: number; approved: number; pending: number };
  mcqQuestion: { total: number; approved: number; pending: number };
}

// ---- Derivatives Admin (PR 6.1) ----

export interface DerivativeTypeStats {
  derivativeType: string;
  totalArtifacts: number;
  pendingJobs: number;
  failedJobs: number;
  completedJobs: number;
  spendThisMonth: number;
}

export interface DerivativeStatsResponse {
  byType: DerivativeTypeStats[];
  globalEnabled: boolean;
  typesEnabled: Record<string, boolean>;
}

export interface DerivativeJob {
  id: string;
  derivativeType: string;
  status: string;
  sourceDocumentId?: string;
  sourceDocument?: { id: string; title: string };
  promptTemplateVersion?: string;
  modelName?: string;
  tokensIn: number;
  tokensOut: number;
  estimatedCostUsd: number;
  errorJson?: Record<string, unknown>;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
}

export interface EnqueueResult {
  enqueuedCount: number;
  estimatedCostUsd: number;
  jobIds: string[];
}

export interface DerivativeSettings {
  enabled: boolean;
  typesEnabled: Record<string, boolean>;
}

export interface AdminDigestDetail {
  id: string;
  title: string;
  digestType: string;
  sourceOrigin: string;
  facts: string | null;
  issues: string | null;
  ruling: string | null;
  doctrine: string | null;
  dispositive: string | null;
  summary: string | null;
  petitionerArguments: string | null;
  respondentArguments: string | null;
  confidenceScore: number | null;
  reviewStatus: string;
  visibility: string;
  citedAuthoritiesJson: unknown;
  createdAt: string;
  legalDocument: {
    id: string;
    title: string;
    shortTitle: string | null;
    citationText: string | null;
    grNo: string | null;
    court: string | null;
    decisionDate: string | null;
    documentType: string;
    ponente: string | null;
  } | null;
  reviews: Array<{
    id: string;
    verdict: string;
    notes: string | null;
    truthfulnessScore: number | null;
    completenessScore: number | null;
    citationAccuracyScore: number | null;
    createdAt: string;
    reviewer: { id: string; fullName: string | null } | null;
  }>;
  derivativeGenerationJob: {
    id: string;
    derivativeType: string;
    modelName: string | null;
    promptTemplateVersion: string | null;
    startedAt: string | null;
    finishedAt: string | null;
    tokensIn: number;
    tokensOut: number;
    estimatedCostUsd: number;
  } | null;
  _count: {
    doctrineExtracts: number;
    editorialFlags: number;
  };
}

export interface JobDigestResponse {
  jobStatus: string;
  digest: AdminDigestDetail | null;
}

export interface JobDoctrineItem {
  id: string;
  text: string;
  doctrineType: string | null;
  confidence: number | null;
  reviewStatus: string;
  createdAt: string;
}

export interface JobDoctrinesResponse {
  jobStatus: string;
  doctrines: JobDoctrineItem[];
}
