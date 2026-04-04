import { renderHook, waitFor, act } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import { useGenerateDigest } from './use-generate-digest';

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

describe('useGenerateDigest', () => {
  it('posts with uploadId and digestType', async () => {
    mockPost.mockResolvedValueOnce({ data: { id: 'd1', title: 'Digest' } });
    const { result } = renderHook(() => useGenerateDigest(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate({ uploadId: 'u1', digestType: 'case_digest' }); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/uploads/u1/generate-digest', { digestType: 'case_digest' });
  });

  it('posts without digestType', async () => {
    mockPost.mockResolvedValueOnce({ data: { id: 'd2' } });
    const { result } = renderHook(() => useGenerateDigest(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate({ uploadId: 'u1' }); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/uploads/u1/generate-digest', undefined);
  });

  it('handles errors', async () => {
    mockPost.mockRejectedValueOnce(new Error('fail'));
    const { result } = renderHook(() => useGenerateDigest(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate({ uploadId: 'u1' }); });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
