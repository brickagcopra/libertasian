import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    download: vi.fn(),
  },
}));

import { apiClient } from '@/lib/api-client';
import {
  useCorpusHealth,
  useSources,
  useSource,
  useCreateSource,
  useUpdateSource,
  useCreateEndpoint,
  useUpdateEndpoint,
  useDeleteEndpoint,
  useTriggerFetch,
  useIngestionJobs,
  useReviewQueue,
  useApproveDigest,
  useRejectDigest,
  useEditorialFlags,
  useSourceHealthReports,
  useRecomputeAllSourceHealth,
  useCoverageGaps,
  useStalenessReport,
  useEnhancedCoverageGaps,
  useBarSubjectCoverage,
  useIngestionTrends,
  useSourceGapDrilldown,
  useExportCoverageGaps,
  useDuplicates,
  useDuplicateStats,
  useRunDuplicateDetection,
  useMergeDuplicate,
  useDismissDuplicate,
  useEnhancedReviewQueue,
  useReviewQueueStats,
  useSubmitReview,
  useAssignReviewer,
  useBatchApprove,
  useBatchReject,
  useDoctrines,
  useDoctrine,
  useDoctrineLinks,
  useCreateDoctrine,
  useUpdateDoctrine,
  useDeleteDoctrine,
  useApproveDoctrine,
  useRejectDoctrine,
  useExtractDoctrines,
  useCreateDoctrineLink,
  useDeleteDoctrineLink,
  useGraphNetwork,
  useGraphCites,
  useGraphCitedBy,
  useGraphChain,
  useCodalLinks,
  useUnresolvedCitations,
  useTriggerCitationResolution,
  useResolveCitation,
  useCreateCaseCodalLink,
  useDeleteCaseCodalLink,
  useListCaseCodalLinks,
  useUpdateCaseCodalLink,
  useSuggestCaseCodalLinks,
  useBatchAssign,
  useUnassignReviewer,
} from './use-admin';

const mockGet = vi.mocked(apiClient.get);
const mockPost = vi.mocked(apiClient.post);
const mockPatch = vi.mocked(apiClient.patch);
const mockDelete = vi.mocked(apiClient.delete);
const mockDownload = vi.mocked(apiClient.download);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe('Corpus Health', () => {
  beforeEach(() => mockGet.mockReset());

  it('useCorpusHealth fetches corpus health', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: { totalDocuments: 100 } });
    const { result } = renderHook(() => useCorpusHealth(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/admin/corpus-health');
  });
});

describe('Sources', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    mockPatch.mockReset();
  });

  it('useSources fetches all sources', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [{ id: 's1', name: 'SC' }] });
    const { result } = renderHook(() => useSources(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/admin/sources');
  });

  it('useSource fetches a single source', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: { id: 's1', name: 'SC' } });
    const { result } = renderHook(() => useSource('s1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/admin/sources/s1');
  });

  it('useSource disabled when id is empty', () => {
    const { result } = renderHook(() => useSource(''), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('useCreateSource creates via POST', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: { id: 's1' } });
    const { result } = renderHook(() => useCreateSource(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({ name: 'New Source', url: 'https://example.com', sourceType: 'official' } as never);
    });
    expect(mockPost).toHaveBeenCalledWith('/admin/sources', expect.objectContaining({ name: 'New Source' }));
  });

  it('useUpdateSource patches via PATCH', async () => {
    mockPatch.mockResolvedValueOnce({ success: true, data: { id: 's1' } });
    const { result } = renderHook(() => useUpdateSource('s1'), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({ name: 'Updated' } as never);
    });
    expect(mockPatch).toHaveBeenCalledWith('/admin/sources/s1', expect.objectContaining({ name: 'Updated' }));
  });
});

describe('Source Endpoints', () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockPatch.mockReset();
    mockDelete.mockReset();
  });

  it('useCreateEndpoint creates via POST', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: { id: 'ep1' } });
    const { result } = renderHook(() => useCreateEndpoint('s1'), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({ url: '/path', method: 'GET' } as never);
    });
    expect(mockPost).toHaveBeenCalledWith('/admin/sources/s1/endpoints', expect.any(Object));
  });

  it('useUpdateEndpoint patches via PATCH', async () => {
    mockPatch.mockResolvedValueOnce({ success: true, data: { id: 'ep1' } });
    const { result } = renderHook(() => useUpdateEndpoint('s1'), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({ endpointId: 'ep1', data: { url: '/new' } as never });
    });
    expect(mockPatch).toHaveBeenCalledWith('/admin/sources/s1/endpoints/ep1', expect.any(Object));
  });

  it('useDeleteEndpoint deletes via DELETE', async () => {
    mockDelete.mockResolvedValueOnce({ success: true });
    const { result } = renderHook(() => useDeleteEndpoint('s1'), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync('ep1');
    });
    expect(mockDelete).toHaveBeenCalledWith('/admin/sources/s1/endpoints/ep1');
  });
});

describe('Fetch Trigger', () => {
  beforeEach(() => mockPost.mockReset());

  it('useTriggerFetch triggers POST', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: { id: 'job1' } });
    const { result } = renderHook(() => useTriggerFetch('s1'), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync();
    });
    expect(mockPost).toHaveBeenCalledWith('/admin/sources/s1/fetch');
  });
});

describe('Ingestion Jobs', () => {
  beforeEach(() => mockGet.mockReset());

  it('useIngestionJobs fetches all jobs', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [{ id: 'j1' }] });
    const { result } = renderHook(() => useIngestionJobs(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/admin/ingestion-jobs', { params: undefined });
  });

  it('useIngestionJobs filters by sourceId', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });
    renderHook(() => useIngestionJobs('s1'), { wrapper: createWrapper() });
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/admin/ingestion-jobs', { params: { sourceId: 's1' } }));
  });
});

describe('Review Queue', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
  });

  it('useReviewQueue fetches review items', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [{ id: 'd1' }], meta: { hasNext: false } });
    const { result } = renderHook(() => useReviewQueue(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/admin/review-queue', { params: undefined });
  });

  it('useReviewQueue with cursor', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [], meta: { hasNext: false } });
    renderHook(() => useReviewQueue('c1'), { wrapper: createWrapper() });
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/admin/review-queue', { params: { cursor: 'c1' } }));
  });

  it('useApproveDigest approves via POST', async () => {
    mockPost.mockResolvedValueOnce({ success: true });
    const { result } = renderHook(() => useApproveDigest(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({ id: 'd1', notes: 'LGTM' });
    });
    expect(mockPost).toHaveBeenCalledWith('/admin/review-queue/d1/approve', { notes: 'LGTM' });
  });

  it('useRejectDigest rejects via POST', async () => {
    mockPost.mockResolvedValueOnce({ success: true });
    const { result } = renderHook(() => useRejectDigest(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({ id: 'd1', notes: 'Bad quality' });
    });
    expect(mockPost).toHaveBeenCalledWith('/admin/review-queue/d1/reject', { notes: 'Bad quality' });
  });
});

describe('Editorial Flags', () => {
  beforeEach(() => mockGet.mockReset());

  it('useEditorialFlags fetches flags', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [{ id: 'f1' }] });
    const { result } = renderHook(() => useEditorialFlags(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/admin/editorial-flags', { params: undefined });
  });

  it('useEditorialFlags with status filter', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });
    renderHook(() => useEditorialFlags('open'), { wrapper: createWrapper() });
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/admin/editorial-flags', { params: { status: 'open' } }));
  });
});

describe('Source Health', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
  });

  it('useSourceHealthReports fetches reports', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [{ sourceId: 's1' }] });
    const { result } = renderHook(() => useSourceHealthReports(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/admin/sources/health');
  });

  it('useRecomputeAllSourceHealth triggers POST', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: [] });
    const { result } = renderHook(() => useRecomputeAllSourceHealth(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync();
    });
    expect(mockPost).toHaveBeenCalledWith('/admin/sources/health/recompute');
  });

  it('useCoverageGaps fetches gaps', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [{ documentType: 'statute' }] });
    const { result } = renderHook(() => useCoverageGaps(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/admin/coverage-gaps');
  });

  it('useStalenessReport fetches staleness data', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [] });
    const { result } = renderHook(() => useStalenessReport(30), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/admin/staleness-report', { params: { staleDays: '30' } });
  });
});

describe('Enhanced Coverage Gap Analysis', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockDownload.mockReset();
  });

  it('useEnhancedCoverageGaps with params', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: { court: [] } });
    renderHook(
      () => useEnhancedCoverageGaps({ dimension: 'court', status: 'critical' }),
      { wrapper: createWrapper() },
    );
    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith('/admin/coverage-gaps/enhanced', {
        params: { dimension: 'court', status: 'critical' },
      }),
    );
  });

  it('useBarSubjectCoverage fetches bar subject coverage', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [{ subject: 'Criminal Law' }] });
    const { result } = renderHook(() => useBarSubjectCoverage(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/admin/coverage-gaps/bar-subjects');
  });

  it('useIngestionTrends with params', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [{ period: '2026-01' }] });
    renderHook(
      () => useIngestionTrends({ interval: 'monthly', periods: 12 }),
      { wrapper: createWrapper() },
    );
    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith('/admin/coverage-gaps/trends', {
        params: { interval: 'monthly', periods: '12' },
      }),
    );
  });

  it('useSourceGapDrilldown fetches drilldown', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: { sourceId: 's1' } });
    const { result } = renderHook(() => useSourceGapDrilldown('s1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/admin/coverage-gaps/source/s1');
  });

  it('useSourceGapDrilldown disabled when null', () => {
    const { result } = renderHook(() => useSourceGapDrilldown(null), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('useExportCoverageGaps downloads file', async () => {
    mockDownload.mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useExportCoverageGaps(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({ format: 'csv', dimension: 'court' });
    });
    expect(mockDownload).toHaveBeenCalledWith('/admin/coverage-gaps/export', {
      params: { format: 'csv', dimension: 'court' },
      filename: 'coverage-gaps.csv',
    });
  });
});

describe('Duplicates', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
  });

  it('useDuplicates fetches duplicates', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [{ id: 'dup1' }], meta: { hasNext: false } });
    const { result } = renderHook(() => useDuplicates(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/admin/duplicates', { params: {} });
  });

  it('useDuplicates with filters', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [], meta: { hasNext: false } });
    renderHook(
      () => useDuplicates({ status: 'pending', similarityType: 'title', limit: 10 }),
      { wrapper: createWrapper() },
    );
    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith('/admin/duplicates', {
        params: { status: 'pending', similarityType: 'title', limit: '10' },
      }),
    );
  });

  it('useDuplicateStats fetches stats', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: { total: 10, pending: 5 } });
    const { result } = renderHook(() => useDuplicateStats(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/admin/duplicates/stats');
  });

  it('useRunDuplicateDetection runs detection', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: { found: 3 } });
    const { result } = renderHook(() => useRunDuplicateDetection(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync('checksum');
    });
    expect(mockPost).toHaveBeenCalledWith('/admin/duplicates/detect/checksum');
  });

  it('useRunDuplicateDetection without type', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: { found: 5 } });
    const { result } = renderHook(() => useRunDuplicateDetection(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync(undefined);
    });
    expect(mockPost).toHaveBeenCalledWith('/admin/duplicates/detect');
  });

  it('useMergeDuplicate merges via POST', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: { keptDocumentId: 'd1', archivedDocumentId: 'd2' } });
    const { result } = renderHook(() => useMergeDuplicate(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({ id: 'dup1', keepDocumentId: 'd1' });
    });
    expect(mockPost).toHaveBeenCalledWith('/admin/duplicates/dup1/merge', { keepDocumentId: 'd1' });
  });

  it('useDismissDuplicate dismisses via POST', async () => {
    mockPost.mockResolvedValueOnce({ success: true });
    const { result } = renderHook(() => useDismissDuplicate(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync('dup1');
    });
    expect(mockPost).toHaveBeenCalledWith('/admin/duplicates/dup1/dismiss');
  });
});

describe('Enhanced Review Queue', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
  });

  it('useEnhancedReviewQueue fetches items', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [{ id: 'rq1' }], meta: { hasNext: false } });
    const { result } = renderHook(() => useEnhancedReviewQueue(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/admin/digests/review-queue', { params: {} });
  });

  it('useEnhancedReviewQueue with filters', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [], meta: { hasNext: false } });
    renderHook(
      () => useEnhancedReviewQueue({ reviewStatus: 'pending', minConfidence: 0.5, sortBy: 'confidence' }),
      { wrapper: createWrapper() },
    );
    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith('/admin/digests/review-queue', {
        params: { reviewStatus: 'pending', minConfidence: '0.5', sortBy: 'confidence' },
      }),
    );
  });

  it('useReviewQueueStats fetches stats', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: { pending: 10 } });
    const { result } = renderHook(() => useReviewQueueStats(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/admin/digests/review-stats');
  });

  it('useSubmitReview submits review via POST', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: { digestId: 'd1', reviewId: 'r1', newStatus: 'approved', verdict: 'approve' } });
    const { result } = renderHook(() => useSubmitReview(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        id: 'd1',
        verdict: 'approve',
        truthfulnessScore: 5,
        completenessScore: 4,
        citationAccuracyScore: 5,
      });
    });
    expect(mockPost).toHaveBeenCalledWith('/admin/digests/d1/review', {
      verdict: 'approve',
      notes: undefined,
      truthfulnessScore: 5,
      completenessScore: 4,
      citationAccuracyScore: 5,
    });
  });

  it('useAssignReviewer assigns via POST', async () => {
    mockPost.mockResolvedValueOnce({ success: true });
    const { result } = renderHook(() => useAssignReviewer(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({ id: 'd1', reviewerUserId: 'u1' });
    });
    expect(mockPost).toHaveBeenCalledWith('/admin/digests/d1/assign', { reviewerUserId: 'u1' });
  });

  it('useBatchApprove batch approves via POST', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: { processed: 3 } });
    const { result } = renderHook(() => useBatchApprove(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({ digestIds: ['d1', 'd2', 'd3'], notes: 'All good' });
    });
    expect(mockPost).toHaveBeenCalledWith('/admin/digests/batch-approve', {
      digestIds: ['d1', 'd2', 'd3'],
      notes: 'All good',
    });
  });

  it('useBatchReject batch rejects via POST', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: { processed: 2 } });
    const { result } = renderHook(() => useBatchReject(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({ digestIds: ['d4', 'd5'], reason: 'Low quality' });
    });
    expect(mockPost).toHaveBeenCalledWith('/admin/digests/batch-reject', {
      digestIds: ['d4', 'd5'],
      reason: 'Low quality',
    });
  });
});

describe('Doctrines', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    mockPatch.mockReset();
    mockDelete.mockReset();
  });

  it('useDoctrines fetches doctrines', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [{ id: 'doc1' }], meta: { hasNext: false } });
    const { result } = renderHook(() => useDoctrines(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/admin/doctrines', { params: {} });
  });

  it('useDoctrines with filters', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [], meta: { hasNext: false } });
    renderHook(
      () => useDoctrines({ doctrineType: 'ratio_decidendi', reviewStatus: 'approved' }),
      { wrapper: createWrapper() },
    );
    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith('/admin/doctrines', {
        params: { doctrineType: 'ratio_decidendi', reviewStatus: 'approved' },
      }),
    );
  });

  it('useDoctrine fetches a single doctrine', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: { id: 'doc1', text: 'Test doctrine' } });
    const { result } = renderHook(() => useDoctrine('doc1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/admin/doctrines/doc1');
  });

  it('useDoctrine disabled when id is empty', () => {
    const { result } = renderHook(() => useDoctrine(''), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('useDoctrineLinks fetches links', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: { linksFrom: [], linksTo: [] } });
    const { result } = renderHook(() => useDoctrineLinks('doc1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/admin/doctrines/doc1/links');
  });

  it('useCreateDoctrine creates via POST', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: { id: 'doc2' } });
    const { result } = renderHook(() => useCreateDoctrine(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({ text: 'New doctrine', doctrineType: 'ratio_decidendi' });
    });
    expect(mockPost).toHaveBeenCalledWith('/admin/doctrines', {
      text: 'New doctrine',
      doctrineType: 'ratio_decidendi',
    });
  });

  it('useUpdateDoctrine patches via PATCH', async () => {
    mockPatch.mockResolvedValueOnce({ success: true, data: { id: 'doc1' } });
    const { result } = renderHook(() => useUpdateDoctrine(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({ id: 'doc1', data: { text: 'Updated' } });
    });
    expect(mockPatch).toHaveBeenCalledWith('/admin/doctrines/doc1', { text: 'Updated' });
  });

  it('useDeleteDoctrine deletes via DELETE', async () => {
    mockDelete.mockResolvedValueOnce({ success: true });
    const { result } = renderHook(() => useDeleteDoctrine(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync('doc1');
    });
    expect(mockDelete).toHaveBeenCalledWith('/admin/doctrines/doc1');
  });

  it('useApproveDoctrine approves via POST', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: { id: 'doc1' } });
    const { result } = renderHook(() => useApproveDoctrine(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync('doc1');
    });
    expect(mockPost).toHaveBeenCalledWith('/admin/doctrines/doc1/approve');
  });

  it('useRejectDoctrine rejects via POST', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: { id: 'doc1' } });
    const { result } = renderHook(() => useRejectDoctrine(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync('doc1');
    });
    expect(mockPost).toHaveBeenCalledWith('/admin/doctrines/doc1/reject');
  });

  it('useExtractDoctrines extracts via POST', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: { extracted: 3 } });
    const { result } = renderHook(() => useExtractDoctrines(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync('ld1');
    });
    expect(mockPost).toHaveBeenCalledWith('/admin/doctrines/extract', { legalDocumentId: 'ld1' });
  });

  it('useCreateDoctrineLink creates link via POST', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: { id: 'link1' } });
    const { result } = renderHook(() => useCreateDoctrineLink(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        fromDoctrineId: 'doc1',
        toDoctrineId: 'doc2',
        linkType: 'supersedes',
      });
    });
    expect(mockPost).toHaveBeenCalledWith('/admin/doctrines/links', {
      fromDoctrineId: 'doc1',
      toDoctrineId: 'doc2',
      linkType: 'supersedes',
    });
  });

  it('useDeleteDoctrineLink deletes via DELETE', async () => {
    mockDelete.mockResolvedValueOnce({ success: true });
    const { result } = renderHook(() => useDeleteDoctrineLink(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync('link1');
    });
    expect(mockDelete).toHaveBeenCalledWith('/admin/doctrines/links/link1');
  });
});

describe('Knowledge Graph', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    mockDelete.mockReset();
    mockPatch.mockReset();
  });

  it('useGraphNetwork fetches network', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: { nodes: [], edges: [] } });
    const { result } = renderHook(() => useGraphNetwork('ld1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/admin/knowledge-graph/ld1/network', { params: {} });
  });

  it('useGraphNetwork with depth', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: { nodes: [], edges: [] } });
    renderHook(() => useGraphNetwork('ld1', 3), { wrapper: createWrapper() });
    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith('/admin/knowledge-graph/ld1/network', { params: { depth: '3' } }),
    );
  });

  it('useGraphNetwork disabled when empty id', () => {
    const { result } = renderHook(() => useGraphNetwork(''), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('useGraphCites fetches cites', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: { nodes: [], edges: [] } });
    const { result } = renderHook(() => useGraphCites('ld1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/admin/knowledge-graph/ld1/cites', { params: {} });
  });

  it('useGraphCitedBy fetches cited-by', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: { nodes: [], edges: [] } });
    const { result } = renderHook(() => useGraphCitedBy('ld1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/admin/knowledge-graph/ld1/cited-by', { params: {} });
  });

  it('useGraphChain fetches chain', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: { nodes: [], edges: [] } });
    const { result } = renderHook(() => useGraphChain('ld1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/admin/knowledge-graph/ld1/chain', { params: {} });
  });

  it('useCodalLinks fetches codal links', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [{ id: 'cl1' }] });
    const { result } = renderHook(() => useCodalLinks('ld1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/admin/knowledge-graph/ld1/codal-links');
  });

  it('useUnresolvedCitations fetches unresolved citations', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [{ id: 'uc1' }], meta: { hasNext: false } });
    const { result } = renderHook(() => useUnresolvedCitations(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/admin/knowledge-graph/unresolved-citations', { params: {} });
  });

  it('useTriggerCitationResolution triggers via POST', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: { documentId: 'ld1', unresolvedCitationCount: 3, status: 'processing' } });
    const { result } = renderHook(() => useTriggerCitationResolution(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync('ld1');
    });
    expect(mockPost).toHaveBeenCalledWith('/admin/knowledge-graph/ld1/resolve-citations');
  });

  it('useResolveCitation resolves via POST', async () => {
    mockPost.mockResolvedValueOnce({ success: true });
    const { result } = renderHook(() => useResolveCitation(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({ citationId: 'cit1', targetDocumentId: 'ld2' });
    });
    expect(mockPost).toHaveBeenCalledWith('/admin/knowledge-graph/citations/cit1/resolve', {
      targetDocumentId: 'ld2',
    });
  });

  it('useCreateCaseCodalLink creates via POST', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: { id: 'ccl1' } });
    const { result } = renderHook(() => useCreateCaseCodalLink(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        caseDocumentId: 'ld1',
        codalDocumentId: 'ld2',
        linkType: 'interprets',
      });
    });
    expect(mockPost).toHaveBeenCalledWith('/admin/knowledge-graph/codal-links', {
      caseDocumentId: 'ld1',
      codalDocumentId: 'ld2',
      linkType: 'interprets',
    });
  });

  it('useDeleteCaseCodalLink deletes via DELETE', async () => {
    mockDelete.mockResolvedValueOnce({ success: true });
    const { result } = renderHook(() => useDeleteCaseCodalLink(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync('ccl1');
    });
    expect(mockDelete).toHaveBeenCalledWith('/admin/knowledge-graph/codal-links/ccl1');
  });
});

describe('Case-Codal Links List/Update/Suggest', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    mockPatch.mockReset();
  });

  it('useListCaseCodalLinks fetches links', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [{ id: 'ccl1' }], meta: { hasNext: false } });
    const { result } = renderHook(() => useListCaseCodalLinks(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/admin/knowledge-graph/case-codal-links', { params: {} });
  });

  it('useListCaseCodalLinks with filters', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [], meta: { hasNext: false } });
    renderHook(
      () => useListCaseCodalLinks({ linkType: 'interprets', limit: 20 }),
      { wrapper: createWrapper() },
    );
    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith('/admin/knowledge-graph/case-codal-links', {
        params: { linkType: 'interprets', limit: '20' },
      }),
    );
  });

  it('useUpdateCaseCodalLink patches via PATCH', async () => {
    mockPatch.mockResolvedValueOnce({ success: true, data: { id: 'ccl1' } });
    const { result } = renderHook(() => useUpdateCaseCodalLink(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({ id: 'ccl1', data: { linkType: 'applies', confidence: 0.9 } });
    });
    expect(mockPatch).toHaveBeenCalledWith('/admin/knowledge-graph/case-codal-links/ccl1', {
      linkType: 'applies',
      confidence: 0.9,
    });
  });

  it('useSuggestCaseCodalLinks suggests via POST', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: [{ codalDocumentId: 'ld2', confidence: 0.85 }] });
    const { result } = renderHook(() => useSuggestCaseCodalLinks(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync('ld1');
    });
    expect(mockPost).toHaveBeenCalledWith('/admin/knowledge-graph/suggest-case-codal/ld1');
  });
});

describe('Batch Assign/Unassign', () => {
  beforeEach(() => mockPost.mockReset());

  it('useBatchAssign assigns reviewers via POST', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: { assigned: 3 } });
    const { result } = renderHook(() => useBatchAssign(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({ digestIds: ['d1', 'd2', 'd3'], reviewerUserId: 'u1' });
    });
    expect(mockPost).toHaveBeenCalledWith('/admin/digests/batch-assign', {
      digestIds: ['d1', 'd2', 'd3'],
      reviewerUserId: 'u1',
    });
  });

  it('useUnassignReviewer unassigns via POST', async () => {
    mockPost.mockResolvedValueOnce({ success: true });
    const { result } = renderHook(() => useUnassignReviewer(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync('d1');
    });
    expect(mockPost).toHaveBeenCalledWith('/admin/digests/d1/unassign');
  });
});
