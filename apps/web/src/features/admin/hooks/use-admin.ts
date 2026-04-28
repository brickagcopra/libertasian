'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type {
  CorpusHealth,
  Source,
  SourceDetail,
  SourceEndpoint,
  IngestionJob,
  ReviewDigest,
  EditorialFlag,
  CreateSourceInput,
  UpdateSourceInput,
  CreateEndpointInput,
  UpdateEndpointInput,
  SourceHealthReport,
  CoverageGapItem,
  StalenessReportItem,
  DocumentSimilarityItem,
  DuplicateStats,
  DetectionResult,
  ReviewQueueItem,
  ReviewQueueStats,
  BatchReviewResult,
  DoctrineListItem,
  DoctrineDetail,
  DoctrineLinkListItem,
  DoctrineExtractionResult,
  GraphVisualizationData,
  UnresolvedCitationItem,
  CaseCodalLinkItem,
  CaseCodalSuggestion,
  BatchAssignResult,
  EnhancedCoverageGapItem,
  BarSubjectCoverage,
  IngestionTrendPoint,
  SourceGapDrilldown,
  ClassificationReviewItem,
  ClassificationReviewStats,
  IngestionPipelineStats,
  IngestionJobHistoryItem,
  IngestionCandidateItem,
  EndpointStatusItem,
  AdminDigestDetail,
  AutoPromoteStatusResponse,
  AutoPromoteSweepResponse,
  BackfillCitationsResponse,
  BackfillMissingDerivativesResponse,
  CitationsBackfillPlanResponse,
  MissingDerivativesPlanResponse,
  MissingDerivativeType,
} from '../types';

// ---- Corpus Health ----

export function useCorpusHealth() {
  return useQuery({
    queryKey: ['admin', 'corpus-health'],
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; data: CorpusHealth }>(
        '/admin/corpus-health',
      );
      return res.data;
    },
  });
}

// ---- Sources ----

export function useSources() {
  return useQuery({
    queryKey: ['admin', 'sources'],
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; data: Source[] }>('/admin/sources');
      return res.data;
    },
  });
}

export function useSource(id: string) {
  return useQuery({
    queryKey: ['admin', 'source', id],
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; data: SourceDetail }>(
        `/admin/sources/${id}`,
      );
      return res.data;
    },
    enabled: !!id,
  });
}

export function useCreateSource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: CreateSourceInput) => {
      const res = await apiClient.post<{ success: boolean; data: Source }>('/admin/sources', data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'sources'] });
    },
  });
}

export function useUpdateSource(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: UpdateSourceInput) => {
      const res = await apiClient.patch<{ success: boolean; data: Source }>(
        `/admin/sources/${id}`,
        data,
      );
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'sources'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'source', id] });
    },
  });
}

// ---- Source Endpoints ----

export function useCreateEndpoint(sourceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: CreateEndpointInput) => {
      const res = await apiClient.post<{ success: boolean; data: SourceEndpoint }>(
        `/admin/sources/${sourceId}/endpoints`,
        data,
      );
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'source', sourceId] });
    },
  });
}

export function useUpdateEndpoint(sourceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      endpointId,
      data,
    }: {
      endpointId: string;
      data: UpdateEndpointInput;
    }) => {
      const res = await apiClient.patch<{ success: boolean; data: SourceEndpoint }>(
        `/admin/sources/${sourceId}/endpoints/${endpointId}`,
        data,
      );
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'source', sourceId] });
    },
  });
}

export function useDeleteEndpoint(sourceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (endpointId: string) => {
      await apiClient.delete(`/admin/sources/${sourceId}/endpoints/${endpointId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'source', sourceId] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'sources'] });
    },
  });
}

// ---- Fetch Trigger ----

export function useTriggerFetch(sourceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<{ success: boolean; data: IngestionJob }>(
        `/admin/sources/${sourceId}/fetch`,
      );
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'ingestion-jobs'] });
    },
  });
}

// ---- Ingestion Jobs ----

export function useIngestionJobs(sourceId?: string) {
  return useQuery({
    queryKey: ['admin', 'ingestion-jobs', sourceId],
    queryFn: async () => {
      const params = sourceId ? { sourceId } : undefined;
      const res = await apiClient.get<{ success: boolean; data: IngestionJob[] }>(
        '/admin/ingestion-jobs',
        { params },
      );
      return res.data;
    },
  });
}

// ---- Review Queue ----

export function useReviewQueue(cursor?: string) {
  return useQuery({
    queryKey: ['admin', 'review-queue', cursor],
    queryFn: async () => {
      const params = cursor ? { cursor } : undefined;
      const res = await apiClient.get<{
        success: boolean;
        data: ReviewDigest[];
        meta: { hasNext: boolean; nextCursor?: string };
      }>('/admin/review-queue', { params });
      return { items: res.data, meta: res.meta };
    },
  });
}

export function useApproveDigest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes?: string }) => {
      await apiClient.post(`/admin/review-queue/${id}/approve`, { notes });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'review-queue'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'corpus-health'] });
    },
  });
}

export function useRejectDigest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes?: string }) => {
      await apiClient.post(`/admin/review-queue/${id}/reject`, { notes });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'review-queue'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'corpus-health'] });
    },
  });
}

// ---- Editorial Flags ----

export function useEditorialFlags(status?: string) {
  return useQuery({
    queryKey: ['admin', 'editorial-flags', status],
    queryFn: async () => {
      const params = status ? { status } : undefined;
      const res = await apiClient.get<{ success: boolean; data: EditorialFlag[] }>(
        '/admin/editorial-flags',
        { params },
      );
      return res.data;
    },
  });
}

// ---- Source Health (Phase 5) ----

export function useSourceHealthReports() {
  return useQuery({
    queryKey: ['admin', 'source-health'],
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; data: SourceHealthReport[] }>(
        '/admin/sources/health',
      );
      return res.data;
    },
  });
}

export function useRecomputeAllSourceHealth() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<{ success: boolean; data: SourceHealthReport[] }>(
        '/admin/sources/health/recompute',
      );
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'source-health'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'corpus-health'] });
    },
  });
}

export function useCoverageGaps() {
  return useQuery({
    queryKey: ['admin', 'coverage-gaps'],
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; data: CoverageGapItem[] }>(
        '/admin/coverage-gaps',
      );
      return res.data;
    },
  });
}

export function useStalenessReport(staleDays?: number) {
  return useQuery({
    queryKey: ['admin', 'staleness-report', staleDays],
    queryFn: async () => {
      const params = staleDays ? { staleDays: String(staleDays) } : undefined;
      const res = await apiClient.get<{ success: boolean; data: StalenessReportItem[] }>(
        '/admin/staleness-report',
        { params },
      );
      return res.data;
    },
  });
}

// ---- Enhanced Coverage Gap Analysis ----

export function useEnhancedCoverageGaps(params?: {
  dimension?: string;
  status?: string;
  minDocCount?: number;
  dateFrom?: string;
  dateTo?: string;
  sortBy?: string;
  sortDir?: string;
}) {
  return useQuery({
    queryKey: ['admin', 'coverage-gaps-enhanced', params],
    queryFn: async () => {
      const qp: Record<string, string> = {};
      if (params?.dimension) qp['dimension'] = params.dimension;
      if (params?.status) qp['status'] = params.status;
      if (params?.minDocCount) qp['minDocCount'] = String(params.minDocCount);
      if (params?.dateFrom) qp['dateFrom'] = params.dateFrom;
      if (params?.dateTo) qp['dateTo'] = params.dateTo;
      if (params?.sortBy) qp['sortBy'] = params.sortBy;
      if (params?.sortDir) qp['sortDir'] = params.sortDir;
      const res = await apiClient.get<{
        success: boolean;
        data: Record<string, EnhancedCoverageGapItem[]>;
      }>('/admin/coverage-gaps/enhanced', { params: qp });
      return res.data;
    },
  });
}

export function useBarSubjectCoverage() {
  return useQuery({
    queryKey: ['admin', 'bar-subject-coverage'],
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; data: BarSubjectCoverage[] }>(
        '/admin/coverage-gaps/bar-subjects',
      );
      return res.data;
    },
  });
}

export function useIngestionTrends(params?: {
  interval?: string;
  periods?: number;
  documentType?: string;
  sourceId?: string;
}) {
  return useQuery({
    queryKey: ['admin', 'ingestion-trends', params],
    queryFn: async () => {
      const qp: Record<string, string> = {};
      if (params?.interval) qp['interval'] = params.interval;
      if (params?.periods) qp['periods'] = String(params.periods);
      if (params?.documentType) qp['documentType'] = params.documentType;
      if (params?.sourceId) qp['sourceId'] = params.sourceId;
      const res = await apiClient.get<{ success: boolean; data: IngestionTrendPoint[] }>(
        '/admin/coverage-gaps/trends',
        { params: qp },
      );
      return res.data;
    },
  });
}

export function useSourceGapDrilldown(sourceId: string | null) {
  return useQuery({
    queryKey: ['admin', 'source-gap-drilldown', sourceId],
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; data: SourceGapDrilldown }>(
        `/admin/coverage-gaps/source/${sourceId}`,
      );
      return res.data;
    },
    enabled: !!sourceId,
  });
}

export function useExportCoverageGaps() {
  return useMutation({
    mutationFn: async (params?: { format?: string; dimension?: string; status?: string }) => {
      const qp: Record<string, string> = {};
      if (params?.format) qp['format'] = params.format;
      if (params?.dimension) qp['dimension'] = params.dimension;
      if (params?.status) qp['status'] = params.status;
      await apiClient.download('/admin/coverage-gaps/export', {
        params: qp,
        filename: `coverage-gaps.${params?.format === 'json' ? 'json' : 'csv'}`,
      });
    },
  });
}

// ---- Duplicates (Phase 5) ----

export function useDuplicates(params?: {
  status?: string;
  similarityType?: string;
  cursor?: string;
  limit?: number;
}) {
  return useQuery({
    queryKey: ['admin', 'duplicates', params],
    queryFn: async () => {
      const queryParams: Record<string, string> = {};
      if (params?.status) queryParams['status'] = params.status;
      if (params?.similarityType) queryParams['similarityType'] = params.similarityType;
      if (params?.cursor) queryParams['cursor'] = params.cursor;
      if (params?.limit) queryParams['limit'] = String(params.limit);

      const res = await apiClient.get<{
        success: boolean;
        data: DocumentSimilarityItem[];
        meta: { hasNext: boolean; nextCursor?: string; limit: number };
      }>('/admin/duplicates', { params: queryParams });
      return { items: res.data, meta: res.meta };
    },
  });
}

export function useDuplicateStats() {
  return useQuery({
    queryKey: ['admin', 'duplicate-stats'],
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; data: DuplicateStats }>(
        '/admin/duplicates/stats',
      );
      return res.data;
    },
  });
}

export function useRunDuplicateDetection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (type?: 'checksum' | 'title' | 'citation') => {
      const endpoint = type
        ? `/admin/duplicates/detect/${type}`
        : '/admin/duplicates/detect';
      const res = await apiClient.post<{ success: boolean; data: DetectionResult }>(endpoint);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'duplicates'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'duplicate-stats'] });
    },
  });
}

export function useMergeDuplicate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, keepDocumentId }: { id: string; keepDocumentId: string }) => {
      const res = await apiClient.post<{
        success: boolean;
        data: { keptDocumentId: string; archivedDocumentId: string };
      }>(`/admin/duplicates/${id}/merge`, { keepDocumentId });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'duplicates'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'duplicate-stats'] });
    },
  });
}

export function useDismissDuplicate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.post(`/admin/duplicates/${id}/dismiss`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'duplicates'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'duplicate-stats'] });
    },
  });
}

// ---- Enhanced Review Queue (Phase 5) ----

export function useEnhancedReviewQueue(params?: {
  reviewStatus?: string;
  sourceOrigin?: string;
  minConfidence?: number;
  maxConfidence?: number;
  assignedTo?: string;
  sortBy?: string;
  sortDir?: string;
  cursor?: string;
  limit?: number;
}) {
  return useQuery({
    queryKey: ['admin', 'enhanced-review-queue', params],
    queryFn: async () => {
      const queryParams: Record<string, string> = {};
      if (params?.reviewStatus) queryParams['reviewStatus'] = params.reviewStatus;
      if (params?.sourceOrigin) queryParams['sourceOrigin'] = params.sourceOrigin;
      if (params?.minConfidence !== undefined) queryParams['minConfidence'] = String(params.minConfidence);
      if (params?.maxConfidence !== undefined) queryParams['maxConfidence'] = String(params.maxConfidence);
      if (params?.assignedTo) queryParams['assignedTo'] = params.assignedTo;
      if (params?.sortBy) queryParams['sortBy'] = params.sortBy;
      if (params?.sortDir) queryParams['sortDir'] = params.sortDir;
      if (params?.cursor) queryParams['cursor'] = params.cursor;
      if (params?.limit) queryParams['limit'] = String(params.limit);

      const res = await apiClient.get<{
        success: boolean;
        data: ReviewQueueItem[];
        meta: { hasNext: boolean; nextCursor?: string; limit: number };
      }>('/admin/digests/review-queue', { params: queryParams });
      return { items: res.data, meta: res.meta };
    },
  });
}

export function useReviewQueueStats() {
  return useQuery({
    queryKey: ['admin', 'review-stats'],
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; data: ReviewQueueStats }>(
        '/admin/digests/review-stats',
      );
      return res.data;
    },
  });
}

export function useAdminDigest(id: string) {
  return useQuery({
    queryKey: ['admin', 'digest', id],
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; data: AdminDigestDetail }>(
        `/admin/digests/${id}`,
      );
      return res.data;
    },
    enabled: !!id,
  });
}

export function useSubmitReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      verdict,
      notes,
      truthfulnessScore,
      completenessScore,
      citationAccuracyScore,
    }: {
      id: string;
      verdict: string;
      notes?: string;
      truthfulnessScore?: number;
      completenessScore?: number;
      citationAccuracyScore?: number;
    }) => {
      const res = await apiClient.post<{
        success: boolean;
        data: { digestId: string; reviewId: string; newStatus: string; verdict: string };
      }>(`/admin/digests/${id}/review`, { verdict, notes, truthfulnessScore, completenessScore, citationAccuracyScore });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'enhanced-review-queue'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'review-stats'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'corpus-health'] });
    },
  });
}

export function useAssignReviewer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reviewerUserId }: { id: string; reviewerUserId: string }) => {
      await apiClient.post(`/admin/digests/${id}/assign`, { reviewerUserId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'enhanced-review-queue'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'review-stats'] });
    },
  });
}

export function useBatchApprove() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ digestIds, notes }: { digestIds: string[]; notes?: string }) => {
      const res = await apiClient.post<{ success: boolean; data: BatchReviewResult }>(
        '/admin/digests/batch-approve',
        { digestIds, notes },
      );
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'enhanced-review-queue'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'review-stats'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'corpus-health'] });
    },
  });
}

export function useBatchReject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ digestIds, reason }: { digestIds: string[]; reason?: string }) => {
      const res = await apiClient.post<{ success: boolean; data: BatchReviewResult }>(
        '/admin/digests/batch-reject',
        { digestIds, reason },
      );
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'enhanced-review-queue'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'review-stats'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'corpus-health'] });
    },
  });
}

// ---- Doctrines (Phase 5 Batch 6) ----

export function useDoctrines(params?: {
  doctrineType?: string;
  reviewStatus?: string;
  cursor?: string;
  limit?: number;
}) {
  return useQuery({
    queryKey: ['admin', 'doctrines', params],
    queryFn: async () => {
      const queryParams: Record<string, string> = {};
      if (params?.doctrineType) queryParams['doctrineType'] = params.doctrineType;
      if (params?.reviewStatus) queryParams['reviewStatus'] = params.reviewStatus;
      if (params?.cursor) queryParams['cursor'] = params.cursor;
      if (params?.limit) queryParams['limit'] = String(params.limit);

      const res = await apiClient.get<{
        success: boolean;
        data: DoctrineListItem[];
        meta: { hasNext: boolean; nextCursor?: string; limit: number };
      }>('/admin/doctrines', { params: queryParams });
      return { items: res.data, meta: res.meta };
    },
  });
}

export function useDoctrine(id: string) {
  return useQuery({
    queryKey: ['admin', 'doctrine', id],
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; data: DoctrineDetail }>(
        `/admin/doctrines/${id}`,
      );
      return res.data;
    },
    enabled: !!id,
  });
}

export function useDoctrineLinks(doctrineId: string) {
  return useQuery({
    queryKey: ['admin', 'doctrine-links', doctrineId],
    queryFn: async () => {
      const res = await apiClient.get<{
        success: boolean;
        data: { linksFrom: DoctrineLinkListItem[]; linksTo: DoctrineLinkListItem[] };
      }>(`/admin/doctrines/${doctrineId}/links`);
      return res.data;
    },
    enabled: !!doctrineId,
  });
}

export function useCreateDoctrine() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      text: string;
      doctrineType: string;
      legalDocumentId?: string;
      digestId?: string;
      confidence?: number;
    }) => {
      const res = await apiClient.post<{ success: boolean; data: DoctrineDetail }>(
        '/admin/doctrines',
        data,
      );
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'doctrines'] });
    },
  });
}

export function useUpdateDoctrine() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: { text?: string; doctrineType?: string; confidence?: number };
    }) => {
      const res = await apiClient.patch<{ success: boolean; data: DoctrineDetail }>(
        `/admin/doctrines/${id}`,
        data,
      );
      return res.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'doctrines'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'doctrine', variables.id] });
    },
  });
}

export function useDeleteDoctrine() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/admin/doctrines/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'doctrines'] });
    },
  });
}

export function useApproveDoctrine() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiClient.post<{ success: boolean; data: DoctrineDetail }>(
        `/admin/doctrines/${id}/approve`,
      );
      return res.data;
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'doctrines'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'doctrine', id] });
    },
  });
}

export function useRejectDoctrine() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiClient.post<{ success: boolean; data: DoctrineDetail }>(
        `/admin/doctrines/${id}/reject`,
      );
      return res.data;
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'doctrines'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'doctrine', id] });
    },
  });
}

export function useExtractDoctrines() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (documentId: string) => {
      const res = await apiClient.post<{ success: boolean; data: DoctrineExtractionResult }>(
        `/admin/doctrines/extract`,
        { legalDocumentId: documentId },
      );
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'doctrines'] });
    },
  });
}

export function useCreateDoctrineLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      fromDoctrineId: string;
      toDoctrineId: string;
      linkType: string;
      confidence?: number;
    }) => {
      const res = await apiClient.post<{ success: boolean; data: DoctrineLinkListItem }>(
        '/admin/doctrines/links',
        data,
      );
      return res.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'doctrine-links', variables.fromDoctrineId] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'doctrine', variables.fromDoctrineId] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'doctrine-links', variables.toDoctrineId] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'doctrine', variables.toDoctrineId] });
    },
  });
}

export function useDeleteDoctrineLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (linkId: string) => {
      await apiClient.delete(`/admin/doctrines/links/${linkId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'doctrine-links'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'doctrines'] });
    },
  });
}

// ---- Knowledge Graph (Phase 5 Batch 6) ----

export function useGraphNetwork(documentId: string, depth?: number) {
  return useQuery({
    queryKey: ['admin', 'graph-network', documentId, depth],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (depth !== undefined) params['depth'] = String(depth);
      const res = await apiClient.get<{ success: boolean; data: GraphVisualizationData }>(
        `/admin/knowledge-graph/${documentId}/network`,
        { params },
      );
      return res.data;
    },
    enabled: !!documentId,
  });
}

export function useGraphCites(documentId: string, depth?: number) {
  return useQuery({
    queryKey: ['admin', 'graph-cites', documentId, depth],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (depth !== undefined) params['depth'] = String(depth);
      const res = await apiClient.get<{ success: boolean; data: GraphVisualizationData }>(
        `/admin/knowledge-graph/${documentId}/cites`,
        { params },
      );
      return res.data;
    },
    enabled: !!documentId,
  });
}

export function useGraphCitedBy(documentId: string, depth?: number) {
  return useQuery({
    queryKey: ['admin', 'graph-cited-by', documentId, depth],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (depth !== undefined) params['depth'] = String(depth);
      const res = await apiClient.get<{ success: boolean; data: GraphVisualizationData }>(
        `/admin/knowledge-graph/${documentId}/cited-by`,
        { params },
      );
      return res.data;
    },
    enabled: !!documentId,
  });
}

export function useGraphChain(documentId: string, depth?: number) {
  return useQuery({
    queryKey: ['admin', 'graph-chain', documentId, depth],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (depth !== undefined) params['depth'] = String(depth);
      const res = await apiClient.get<{ success: boolean; data: GraphVisualizationData }>(
        `/admin/knowledge-graph/${documentId}/chain`,
        { params },
      );
      return res.data;
    },
    enabled: !!documentId,
  });
}

export function useCodalLinks(documentId: string) {
  return useQuery({
    queryKey: ['admin', 'codal-links', documentId],
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; data: CaseCodalLinkItem[] }>(
        `/admin/knowledge-graph/${documentId}/codal-links`,
      );
      return res.data;
    },
    enabled: !!documentId,
  });
}

export function useUnresolvedCitations(params?: {
  cursor?: string;
  limit?: number;
}) {
  return useQuery({
    queryKey: ['admin', 'unresolved-citations', params],
    queryFn: async () => {
      const queryParams: Record<string, string> = {};
      if (params?.cursor) queryParams['cursor'] = params.cursor;
      if (params?.limit) queryParams['limit'] = String(params.limit);

      const res = await apiClient.get<{
        success: boolean;
        data: UnresolvedCitationItem[];
        meta: { hasNext: boolean; nextCursor?: string; limit: number };
      }>('/admin/knowledge-graph/unresolved-citations', { params: queryParams });
      return { items: res.data, meta: res.meta };
    },
  });
}

export function useTriggerCitationResolution() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (documentId: string) => {
      const res = await apiClient.post<{
        success: boolean;
        data: { documentId: string; documentTitle: string; unresolvedCitationCount: number; status: string };
      }>(`/admin/knowledge-graph/${documentId}/resolve-citations`);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'unresolved-citations'] });
    },
  });
}

export function useResolveCitation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ citationId, targetDocumentId }: { citationId: string; targetDocumentId: string }) => {
      await apiClient.post(`/admin/knowledge-graph/citations/${citationId}/resolve`, {
        targetDocumentId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'unresolved-citations'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'graph-network'] });
    },
  });
}

export function useCreateCaseCodalLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      caseDocumentId: string;
      codalDocumentId: string;
      codalSectionId?: string;
      linkType: string;
      notes?: string;
    }) => {
      const res = await apiClient.post<{ success: boolean; data: CaseCodalLinkItem }>(
        '/admin/knowledge-graph/codal-links',
        data,
      );
      return res.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'codal-links', variables.caseDocumentId] });
    },
  });
}

export function useDeleteCaseCodalLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (linkId: string) => {
      await apiClient.delete(`/admin/knowledge-graph/codal-links/${linkId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'codal-links'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'case-codal-links'] });
    },
  });
}

// ---- Case-Codal Links List / Update / Suggest (Phase 5 Completion) ----

export function useListCaseCodalLinks(params?: {
  caseDocumentId?: string;
  codalDocumentId?: string;
  linkType?: string;
  cursor?: string;
  limit?: number;
}) {
  return useQuery({
    queryKey: ['admin', 'case-codal-links', params],
    queryFn: async () => {
      const queryParams: Record<string, string> = {};
      if (params?.caseDocumentId) queryParams['caseDocumentId'] = params.caseDocumentId;
      if (params?.codalDocumentId) queryParams['codalDocumentId'] = params.codalDocumentId;
      if (params?.linkType) queryParams['linkType'] = params.linkType;
      if (params?.cursor) queryParams['cursor'] = params.cursor;
      if (params?.limit) queryParams['limit'] = String(params.limit);

      const res = await apiClient.get<{
        success: boolean;
        data: CaseCodalLinkItem[];
        meta: { hasNext: boolean; nextCursor?: string; limit: number };
      }>('/admin/knowledge-graph/case-codal-links', { params: queryParams });
      return { items: res.data, meta: res.meta };
    },
  });
}

export function useUpdateCaseCodalLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: { linkType?: string; notes?: string; confidence?: number };
    }) => {
      const res = await apiClient.patch<{ success: boolean; data: CaseCodalLinkItem }>(
        `/admin/knowledge-graph/case-codal-links/${id}`,
        data,
      );
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'case-codal-links'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'codal-links'] });
    },
  });
}

export function useSuggestCaseCodalLinks() {
  return useMutation({
    mutationFn: async (documentId: string) => {
      const res = await apiClient.post<{ success: boolean; data: CaseCodalSuggestion[] }>(
        `/admin/knowledge-graph/suggest-case-codal/${documentId}`,
      );
      return res.data;
    },
  });
}

// ---- Batch Assign / Unassign (Phase 5 Completion) ----

export function useBatchAssign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      digestIds,
      reviewerUserId,
    }: {
      digestIds: string[];
      reviewerUserId: string;
    }) => {
      const res = await apiClient.post<{ success: boolean; data: BatchAssignResult }>(
        '/admin/digests/batch-assign',
        { digestIds, reviewerUserId },
      );
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'enhanced-review-queue'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'review-stats'] });
    },
  });
}

export function useUnassignReviewer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.post(`/admin/digests/${id}/unassign`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'enhanced-review-queue'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'review-stats'] });
    },
  });
}

// ---- Classification Review ----

export function useClassificationReviewQueue(params?: {
  reviewStatus?: string;
  subjectCode?: string;
  cursor?: string;
  limit?: string;
}) {
  return useQuery({
    queryKey: ['admin', 'classification-review', params],
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      if (params?.reviewStatus) searchParams.set('reviewStatus', params.reviewStatus);
      if (params?.subjectCode) searchParams.set('subjectCode', params.subjectCode);
      if (params?.cursor) searchParams.set('cursor', params.cursor);
      if (params?.limit) searchParams.set('limit', params.limit);

      const res = await apiClient.get<{
        success: boolean;
        data: ClassificationReviewItem[];
        meta: { hasNext: boolean; nextCursor?: string; count: number };
      }>(`/admin/classification/review-queue?${searchParams.toString()}`);
      return { items: res.data, meta: res.meta };
    },
  });
}

export function useClassificationStats() {
  return useQuery({
    queryKey: ['admin', 'classification-stats'],
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; data: ClassificationReviewStats }>(
        '/admin/classification/stats',
      );
      return res.data;
    },
  });
}

export function useConfirmClassification() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { documentId: string; tagId: string }) => {
      await apiClient.post('/admin/classification/confirm', params);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'classification-review'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'classification-stats'] });
    },
  });
}

export function useRejectClassification() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { documentId: string; tagId: string }) => {
      await apiClient.post('/admin/classification/reject', params);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'classification-review'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'classification-stats'] });
    },
  });
}

export function useOverrideClassification() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      documentId: string;
      primaryTagId: string;
      secondaryTagIds: string[];
    }) => {
      await apiClient.post('/admin/classification/override', params);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'classification-review'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'classification-stats'] });
    },
  });
}

export function useResolveDuplicate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { id: string; action: string; keepDocumentId: string }) => {
      await apiClient.post(`/admin/duplicates/${params.id}/resolve`, {
        action: params.action,
        keepDocumentId: params.keepDocumentId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'duplicates'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'duplicate-stats'] });
    },
  });
}

export function useDuplicateReviewQueue(params?: { cursor?: string; limit?: number }) {
  return useQuery({
    queryKey: ['admin', 'duplicate-review-queue', params],
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      if (params?.cursor) searchParams.set('cursor', params.cursor);
      if (params?.limit) searchParams.set('limit', String(params.limit));

      const res = await apiClient.get<{
        success: boolean;
        data: DocumentSimilarityItem[];
        meta: { hasNext: boolean; nextCursor?: string; limit: number };
      }>(`/admin/duplicates/review-queue?${searchParams.toString()}`);
      return { items: res.data, meta: res.meta };
    },
  });
}

// ---- Ingestion Pipeline Dashboard ----

export function useIngestionPipelineStats(period?: string) {
  return useQuery({
    queryKey: ['admin', 'ingestion-dashboard', period],
    queryFn: async () => {
      const params = period ? `?period=${period}` : '';
      const res = await apiClient.get<{ success: boolean; data: IngestionPipelineStats }>(
        `/admin/ingestion/dashboard${params}`,
      );
      return res.data;
    },
  });
}

export function useIngestionJobHistory(params?: {
  sourceId?: string;
  status?: string;
  triggerType?: string;
  cursor?: string;
  limit?: number;
}) {
  return useQuery({
    queryKey: ['admin', 'ingestion-jobs', params],
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      if (params?.sourceId) searchParams.set('sourceId', params.sourceId);
      if (params?.status) searchParams.set('status', params.status);
      if (params?.triggerType) searchParams.set('triggerType', params.triggerType);
      if (params?.cursor) searchParams.set('cursor', params.cursor);
      if (params?.limit) searchParams.set('limit', String(params.limit));

      const res = await apiClient.get<{
        success: boolean;
        data: IngestionJobHistoryItem[];
        meta: { hasNext: boolean; nextCursor?: string; limit: number };
      }>(`/admin/ingestion/jobs?${searchParams.toString()}`);
      return { items: res.data, meta: res.meta };
    },
  });
}

export function useIngestionCandidates(jobId: string, cursor?: string) {
  return useQuery({
    queryKey: ['admin', 'ingestion-candidates', jobId, cursor],
    queryFn: async () => {
      const params = cursor ? `?cursor=${cursor}` : '';
      const res = await apiClient.get<{
        success: boolean;
        data: IngestionCandidateItem[];
        meta: { hasNext: boolean; nextCursor?: string; limit: number };
      }>(`/admin/ingestion/jobs/${jobId}/candidates${params}`);
      return { items: res.data, meta: res.meta };
    },
    enabled: !!jobId,
  });
}

export function useEndpointStatus() {
  return useQuery({
    queryKey: ['admin', 'ingestion-endpoints'],
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; data: EndpointStatusItem[] }>(
        '/admin/ingestion/endpoints',
      );
      return res.data;
    },
  });
}

// ---- Pipeline Operations Console ----

export function useDispatchCitationsBackfill() {
  return useMutation({
    mutationFn: async (input: { limit?: number }) => {
      const res = await apiClient.post<{
        success: boolean;
        data: BackfillCitationsResponse;
      }>('/admin/citations/backfill', input);
      return res.data;
    },
  });
}

export const CITATIONS_BACKFILL_PLAN_QUERY_KEY = [
  'admin',
  'citations-backfill-plan',
] as const;

export function useCitationsBackfillPlan(opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: CITATIONS_BACKFILL_PLAN_QUERY_KEY,
    queryFn: async () => {
      const res = await apiClient.get<{
        success: boolean;
        data: CitationsBackfillPlanResponse;
      }>('/admin/citations/backfill/plan');
      return res.data;
    },
    enabled: opts?.enabled ?? true,
    staleTime: 30_000,
  });
}

export interface PerTypeLimit {
  type: MissingDerivativeType;
  limit?: number;
}

export function useBackfillMissingDerivatives() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      types?: string[];
      limit?: number;
      perTypeLimits?: PerTypeLimit[];
    }) => {
      const res = await apiClient.post<{
        success: boolean;
        data: BackfillMissingDerivativesResponse;
      }>('/admin/derivatives/backfill-missing', input);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'corpus-health'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'derivative-stats'] });
      queryClient.invalidateQueries({
        queryKey: MISSING_DERIVATIVES_PLAN_QUERY_KEY,
      });
    },
  });
}

export const MISSING_DERIVATIVES_PLAN_QUERY_KEY = [
  'admin',
  'missing-derivatives-plan',
] as const;

export function useMissingDerivativesPlan(opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: MISSING_DERIVATIVES_PLAN_QUERY_KEY,
    queryFn: async () => {
      const res = await apiClient.get<{
        success: boolean;
        data: MissingDerivativesPlanResponse;
      }>('/admin/derivatives/backfill-missing/plan');
      return res.data;
    },
    enabled: opts?.enabled ?? true,
    staleTime: 30_000,
  });
}

export function useTriggerAutoPromoteSweep() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<{
        success: boolean;
        data: AutoPromoteSweepResponse;
      }>('/admin/auto-promote/sweep');
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'auto-promote-status'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'corpus-health'] });
    },
  });
}

export function useAutoPromoteStatus() {
  return useQuery({
    queryKey: ['admin', 'auto-promote-status'],
    queryFn: async () => {
      const res = await apiClient.get<{
        success: boolean;
        data: AutoPromoteStatusResponse;
      }>('/admin/auto-promote/status');
      return res.data;
    },
  });
}
