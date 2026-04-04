import { renderHook, waitFor, act } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import {
  useReviewQueue, useReviewStats, useSubmitReview,
  useAssignReviewer, useUnassignReviewer, useBatchApprove, useBatchReject,
} from './use-admin-review';

jest.mock('../../../lib/api-client', () => ({
  apiClient: { get: jest.fn(), post: jest.fn() },
}));

const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;
const mockPost = apiClient.post as jest.MockedFunction<typeof apiClient.post>;

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => jest.clearAllMocks());

describe('useReviewQueue', () => {
  it('fetches queue with no filters', async () => {
    mockGet.mockResolvedValueOnce({ data: [{ id: 'rq1' }], meta: { hasNext: false } });
    const { result } = renderHook(() => useReviewQueue(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/admin/digests/review-queue', { params: {} });
  });

  it('passes filters', async () => {
    mockGet.mockResolvedValueOnce({ data: [], meta: { hasNext: false } });
    renderHook(
      () => useReviewQueue({ reviewStatus: 'pending', sourceOrigin: 'scan', limit: 10 }),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(mockGet).toHaveBeenCalledWith('/admin/digests/review-queue', {
      params: { reviewStatus: 'pending', sourceOrigin: 'scan', limit: '10' },
    });
  });

  it('transforms response', async () => {
    mockGet.mockResolvedValueOnce({ data: [{ id: 'rq1' }], meta: { hasNext: true } });
    const { result } = renderHook(() => useReviewQueue(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      items: [{ id: 'rq1' }],
      meta: { hasNext: true },
    });
  });
});

describe('useReviewStats', () => {
  it('fetches stats', async () => {
    mockGet.mockResolvedValueOnce({ data: { pending: 5, approved: 20, rejected: 2 } });
    const { result } = renderHook(() => useReviewStats(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/admin/digests/review-stats');
  });
});

describe('useSubmitReview', () => {
  it('submits approve verdict', async () => {
    mockPost.mockResolvedValueOnce({ data: { id: 'rq1', status: 'approved' } });
    const { result } = renderHook(() => useSubmitReview(), { wrapper: createWrapper() });
    await act(async () => {
      result.current.mutate({ id: 'rq1', verdict: 'approve', notes: 'Looks good' });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/admin/digests/rq1/review', {
      verdict: 'approve', notes: 'Looks good',
    });
  });

  it('submits reject verdict', async () => {
    mockPost.mockResolvedValueOnce({ data: { id: 'rq1', status: 'rejected' } });
    const { result } = renderHook(() => useSubmitReview(), { wrapper: createWrapper() });
    await act(async () => {
      result.current.mutate({ id: 'rq1', verdict: 'reject' });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/admin/digests/rq1/review', {
      verdict: 'reject', notes: undefined,
    });
  });
});

describe('useAssignReviewer', () => {
  it('assigns reviewer', async () => {
    mockPost.mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useAssignReviewer(), { wrapper: createWrapper() });
    await act(async () => {
      result.current.mutate({ id: 'rq1', reviewerUserId: 'u1' });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/admin/digests/rq1/assign', { reviewerUserId: 'u1' });
  });
});

describe('useUnassignReviewer', () => {
  it('unassigns reviewer', async () => {
    mockPost.mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useUnassignReviewer(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate({ id: 'rq1' }); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/admin/digests/rq1/unassign');
  });
});

describe('useBatchApprove', () => {
  it('batch approves digests', async () => {
    mockPost.mockResolvedValueOnce({ data: { approved: 3, failed: 0 } });
    const { result } = renderHook(() => useBatchApprove(), { wrapper: createWrapper() });
    await act(async () => {
      result.current.mutate({ digestIds: ['d1', 'd2', 'd3'] });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/admin/digests/batch-approve', {
      digestIds: ['d1', 'd2', 'd3'],
    });
  });
});

describe('useBatchReject', () => {
  it('batch rejects with reason', async () => {
    mockPost.mockResolvedValueOnce({ data: { rejected: 2, failed: 0 } });
    const { result } = renderHook(() => useBatchReject(), { wrapper: createWrapper() });
    await act(async () => {
      result.current.mutate({ digestIds: ['d1', 'd2'], reason: 'Low quality' });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/admin/digests/batch-reject', {
      digestIds: ['d1', 'd2'], reason: 'Low quality',
    });
  });

  it('batch rejects without reason', async () => {
    mockPost.mockResolvedValueOnce({ data: { rejected: 1, failed: 0 } });
    const { result } = renderHook(() => useBatchReject(), { wrapper: createWrapper() });
    await act(async () => {
      result.current.mutate({ digestIds: ['d1'] });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/admin/digests/batch-reject', {
      digestIds: ['d1'], reason: undefined,
    });
  });
});
