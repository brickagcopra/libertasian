import { renderHook, waitFor, act } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import { useMatterComments, useCreateMatterComment, useDeleteMatterComment } from './use-matter-comments';

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

describe('useMatterComments', () => {
  it('fetches comments for a matter', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [{ id: 'c1', body: 'Comment' }] });
    const { result } = renderHook(() => useMatterComments('m1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/matters/m1/comments');
  });

  it('is disabled when matterId is null', () => {
    const { result } = renderHook(() => useMatterComments(null), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useCreateMatterComment', () => {
  it('posts comment', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: { id: 'c2', body: 'New' } });
    const { result } = renderHook(() => useCreateMatterComment(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate({ matterId: 'm1', body: 'New comment' }); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/matters/m1/comments', { body: 'New comment' });
  });
});

describe('useDeleteMatterComment', () => {
  it('deletes comment', async () => {
    mockDelete.mockResolvedValueOnce({ success: true });
    const { result } = renderHook(() => useDeleteMatterComment(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate({ matterId: 'm1', commentId: 'c1' }); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockDelete).toHaveBeenCalledWith('/matters/m1/comments/c1');
  });

  it('handles errors', async () => {
    mockDelete.mockRejectedValueOnce(new Error('fail'));
    const { result } = renderHook(() => useDeleteMatterComment(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate({ matterId: 'm1', commentId: 'c1' }); });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
