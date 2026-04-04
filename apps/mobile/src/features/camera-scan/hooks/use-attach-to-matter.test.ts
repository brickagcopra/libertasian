import { renderHook, waitFor, act } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import { useAttachToMatter } from './use-attach-to-matter';

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

describe('useAttachToMatter', () => {
  it('posts with all params', async () => {
    mockPost.mockResolvedValueOnce({ data: { id: 'md1' } });
    const { result } = renderHook(() => useAttachToMatter(), { wrapper: createWrapper() });
    await act(async () => {
      result.current.mutate({ uploadId: 'u1', matterId: 'm1', title: 'Scan A', role: 'evidence' });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/uploads/u1/attach-to-matter', {
      matterId: 'm1', title: 'Scan A', role: 'evidence',
    });
  });

  it('posts with required params only', async () => {
    mockPost.mockResolvedValueOnce({ data: { id: 'md2' } });
    const { result } = renderHook(() => useAttachToMatter(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate({ uploadId: 'u1', matterId: 'm1' }); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/uploads/u1/attach-to-matter', { matterId: 'm1' });
  });

  it('handles errors', async () => {
    mockPost.mockRejectedValueOnce(new Error('fail'));
    const { result } = renderHook(() => useAttachToMatter(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate({ uploadId: 'u1', matterId: 'm1' }); });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
