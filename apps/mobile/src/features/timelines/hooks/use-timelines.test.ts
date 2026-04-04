import { renderHook, waitFor, act } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import { useTimelines, useTimeline, useGenerateTimeline, useDeleteTimeline } from './use-timelines';

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

describe('useTimelines', () => {
  it('fetches list', async () => {
    mockGet.mockResolvedValueOnce({ data: [{ id: 'tl1' }], meta: { hasNext: false } });
    const { result } = renderHook(() => useTimelines(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/timelines', { params: {} });
  });

  it('passes filters', async () => {
    mockGet.mockResolvedValueOnce({ data: [], meta: { hasNext: false } });
    renderHook(() => useTimelines({ status: 'completed', matterId: 'm1' }), { wrapper: createWrapper() });
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(mockGet).toHaveBeenCalledWith('/timelines', { params: { status: 'completed', matterId: 'm1' } });
  });
});

describe('useTimeline', () => {
  it('fetches single timeline', async () => {
    mockGet.mockResolvedValueOnce({ data: { id: 'tl1', status: 'completed' } });
    const { result } = renderHook(() => useTimeline('tl1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('is disabled when id is empty', () => {
    const { result } = renderHook(() => useTimeline(''), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useGenerateTimeline', () => {
  it('posts correctly', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: { id: 'tl2' } });
    const { result } = renderHook(() => useGenerateTimeline(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate({ matterId: 'm1' } as never); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/timelines/generate', expect.anything());
  });
});

describe('useDeleteTimeline', () => {
  it('deletes by id', async () => {
    mockDelete.mockResolvedValueOnce({ success: true });
    const { result } = renderHook(() => useDeleteTimeline(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate('tl1'); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockDelete).toHaveBeenCalledWith('/timelines/tl1');
  });
});
