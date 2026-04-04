import { renderHook, waitFor, act } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import { useContradictions, useContradiction, useGenerateContradiction, useDeleteContradiction } from './use-contradictions';

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

describe('useContradictions', () => {
  it('fetches list', async () => {
    mockGet.mockResolvedValueOnce({ data: [{ id: 'cr1' }], meta: { hasNext: false } });
    const { result } = renderHook(() => useContradictions(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/contradictions', { params: {} });
  });

  it('passes filters', async () => {
    mockGet.mockResolvedValueOnce({ data: [], meta: { hasNext: false } });
    renderHook(() => useContradictions({ status: 'completed', scope: 'intra_document' }), { wrapper: createWrapper() });
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(mockGet).toHaveBeenCalledWith('/contradictions', { params: { status: 'completed', scope: 'intra_document' } });
  });
});

describe('useContradiction', () => {
  it('fetches single report', async () => {
    mockGet.mockResolvedValueOnce({ data: { id: 'cr1', status: 'completed' } });
    const { result } = renderHook(() => useContradiction('cr1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('is disabled when id is empty', () => {
    const { result } = renderHook(() => useContradiction(''), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useGenerateContradiction', () => {
  it('posts correctly', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: { id: 'cr2' } });
    const { result } = renderHook(() => useGenerateContradiction(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate({ documentIds: ['d1'] } as never); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/contradictions/generate', expect.anything());
  });
});

describe('useDeleteContradiction', () => {
  it('deletes by id', async () => {
    mockDelete.mockResolvedValueOnce({ success: true });
    const { result } = renderHook(() => useDeleteContradiction(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate('cr1'); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockDelete).toHaveBeenCalledWith('/contradictions/cr1');
  });
});
