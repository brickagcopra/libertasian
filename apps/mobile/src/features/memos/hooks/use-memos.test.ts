import { renderHook, waitFor, act } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import { useMemos, useMemo, useGenerateMemo, useDeleteMemo } from './use-memos';

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

describe('useMemos', () => {
  it('fetches list', async () => {
    mockGet.mockResolvedValueOnce({ data: [{ id: 'me1' }], meta: { hasNext: false } });
    const { result } = renderHook(() => useMemos(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/memos', { params: {} });
  });

  it('passes filters', async () => {
    mockGet.mockResolvedValueOnce({ data: [], meta: { hasNext: false } });
    renderHook(() => useMemos({ memoType: 'legal_opinion', status: 'completed' }), { wrapper: createWrapper() });
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(mockGet).toHaveBeenCalledWith('/memos', { params: { memoType: 'legal_opinion', status: 'completed' } });
  });
});

describe('useMemo (hook)', () => {
  it('fetches single memo', async () => {
    mockGet.mockResolvedValueOnce({ data: { id: 'me1', status: 'completed' } });
    const { result } = renderHook(() => useMemo('me1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('is disabled when id is empty', () => {
    const { result } = renderHook(() => useMemo(''), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useGenerateMemo', () => {
  it('posts correctly', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: { id: 'me2' } });
    const { result } = renderHook(() => useGenerateMemo(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate({ matterId: 'm1', query: 'Draft memo' } as never); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/memos/generate', expect.anything());
  });
});

describe('useDeleteMemo', () => {
  it('deletes by id', async () => {
    mockDelete.mockResolvedValueOnce({ success: true });
    const { result } = renderHook(() => useDeleteMemo(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate('me1'); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockDelete).toHaveBeenCalledWith('/memos/me1');
  });
});
