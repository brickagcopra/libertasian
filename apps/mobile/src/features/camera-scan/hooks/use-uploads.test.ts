import { renderHook, waitFor, act } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import { useUploads, useDeleteUpload } from './use-uploads';

jest.mock('../../../lib/api-client', () => ({
  apiClient: { get: jest.fn(), delete: jest.fn() },
}));

const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;
const mockDelete = apiClient.delete as jest.MockedFunction<typeof apiClient.delete>;

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => jest.clearAllMocks());

describe('useUploads', () => {
  it('fetches uploads with default params', async () => {
    mockGet.mockResolvedValueOnce({ data: [{ id: 'u1' }], meta: { hasNext: false, nextCursor: null } });
    const { result } = renderHook(() => useUploads(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/uploads', { params: { limit: '20' } });
  });

  it('passes filters as query params', async () => {
    mockGet.mockResolvedValueOnce({ data: [], meta: { hasNext: false, nextCursor: null } });
    renderHook(() => useUploads({ uploadType: 'camera_scan' as never, processingStatus: 'completed' as never, limit: 10 }), { wrapper: createWrapper() });
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(mockGet).toHaveBeenCalledWith('/uploads', {
      params: expect.objectContaining({ uploadType: 'camera_scan', processingStatus: 'completed', limit: '10' }),
    });
  });

  it('flattens pages into uploads', async () => {
    mockGet.mockResolvedValueOnce({ data: [{ id: 'u1' }, { id: 'u2' }], meta: { hasNext: false, nextCursor: null } });
    const { result } = renderHook(() => useUploads(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.uploads).toHaveLength(2);
  });
});

describe('useDeleteUpload', () => {
  it('deletes by id', async () => {
    mockDelete.mockResolvedValueOnce({ success: true });
    const { result } = renderHook(() => useDeleteUpload(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate('u1'); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockDelete).toHaveBeenCalledWith('/uploads/u1');
  });
});
