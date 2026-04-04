import { renderHook, waitFor, act } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import { useComparisons, useComparison, useGenerateComparison, useDeleteComparison } from './use-case-comparisons';

jest.mock('../../../lib/api-client', () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));

const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;
const mockPost = apiClient.post as jest.MockedFunction<typeof apiClient.post>;
const mockDelete = apiClient.delete as jest.MockedFunction<typeof apiClient.delete>;

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => jest.clearAllMocks());

describe('useComparisons', () => {
  it('fetches list', async () => {
    mockGet.mockResolvedValueOnce({ data: [{ id: 'cc1' }], meta: { hasNext: false } });
    const { result } = renderHook(() => useComparisons(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/case-comparisons', { params: {} });
  });

  it('passes filters', async () => {
    mockGet.mockResolvedValueOnce({ data: [], meta: { hasNext: false } });
    renderHook(() => useComparisons({ status: 'completed', matterId: 'm1' }), { wrapper: createWrapper() });
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(mockGet).toHaveBeenCalledWith('/case-comparisons', { params: { status: 'completed', matterId: 'm1' } });
  });
});

describe('useComparison', () => {
  it('fetches single comparison', async () => {
    mockGet.mockResolvedValueOnce({ data: { id: 'cc1', status: 'completed' } });
    const { result } = renderHook(() => useComparison('cc1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/case-comparisons/cc1');
  });

  it('is disabled when id is empty', () => {
    const { result } = renderHook(() => useComparison(''), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('is disabled when enabled=false', () => {
    const { result } = renderHook(() => useComparison('cc1', false), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useGenerateComparison', () => {
  it('posts correctly', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: { id: 'cc2' } });
    const { result } = renderHook(() => useGenerateComparison(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate({ documentIds: ['d1', 'd2'] } as never); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/case-comparisons/generate', expect.objectContaining({ documentIds: ['d1', 'd2'] }));
  });
});

describe('useDeleteComparison', () => {
  it('deletes by id', async () => {
    mockDelete.mockResolvedValueOnce({ success: true });
    const { result } = renderHook(() => useDeleteComparison(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate('cc1'); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockDelete).toHaveBeenCalledWith('/case-comparisons/cc1');
  });
});
