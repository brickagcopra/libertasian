import { renderHook, waitFor, act } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import { useHearingPreps, useHearingPrep, useGenerateHearingPrep, useDeleteHearingPrep } from './use-hearing-prep';

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

describe('useHearingPreps', () => {
  it('fetches list', async () => {
    mockGet.mockResolvedValueOnce({ data: [{ id: 'hp1' }], meta: { hasNext: false } });
    const { result } = renderHook(() => useHearingPreps(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/hearing-prep', { params: {} });
  });

  it('passes filters', async () => {
    mockGet.mockResolvedValueOnce({ data: [], meta: { hasNext: false } });
    renderHook(() => useHearingPreps({ status: 'completed', matterId: 'm1' }), { wrapper: createWrapper() });
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(mockGet).toHaveBeenCalledWith('/hearing-prep', { params: { status: 'completed', matterId: 'm1' } });
  });
});

describe('useHearingPrep', () => {
  it('fetches single prep', async () => {
    mockGet.mockResolvedValueOnce({ data: { id: 'hp1', status: 'completed' } });
    const { result } = renderHook(() => useHearingPrep('hp1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('is disabled when id is empty', () => {
    const { result } = renderHook(() => useHearingPrep(''), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useGenerateHearingPrep', () => {
  it('posts correctly', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: { id: 'hp2' } });
    const { result } = renderHook(() => useGenerateHearingPrep(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate({ matterId: 'm1' } as never); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/hearing-prep/generate', expect.anything());
  });
});

describe('useDeleteHearingPrep', () => {
  it('deletes by id', async () => {
    mockDelete.mockResolvedValueOnce({ success: true });
    const { result } = renderHook(() => useDeleteHearingPrep(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate('hp1'); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockDelete).toHaveBeenCalledWith('/hearing-prep/hp1');
  });
});
