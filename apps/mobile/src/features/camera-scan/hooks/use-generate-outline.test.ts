import { renderHook, waitFor, act } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import { useGenerateOutlineFromScan } from './use-generate-outline';

jest.mock('../../../lib/api-client', () => ({
  apiClient: { post: jest.fn() },
}));

const mockPost = apiClient.post as jest.MockedFunction<typeof apiClient.post>;

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => jest.clearAllMocks());

describe('useGenerateOutlineFromScan', () => {
  it('posts with outlineType', async () => {
    mockPost.mockResolvedValueOnce({ data: { outline: [] } });
    const { result } = renderHook(() => useGenerateOutlineFromScan(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate({ uploadId: 'u1', outlineType: 'detailed' }); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/uploads/u1/generate-outline', { outlineType: 'detailed' });
  });

  it('posts without outlineType', async () => {
    mockPost.mockResolvedValueOnce({ data: { outline: [] } });
    const { result } = renderHook(() => useGenerateOutlineFromScan(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate({ uploadId: 'u1' }); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/uploads/u1/generate-outline', {});
  });

  it('handles errors', async () => {
    mockPost.mockRejectedValueOnce(new Error('fail'));
    const { result } = renderHook(() => useGenerateOutlineFromScan(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate({ uploadId: 'u1' }); });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
