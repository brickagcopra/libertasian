import { renderHook, waitFor, act } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import { useBookmarks, useCreateBookmark, useDeleteBookmark } from './use-bookmarks';

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

describe('useBookmarks', () => {
  it('fetches list with no filters', async () => {
    mockGet.mockResolvedValueOnce({ data: [{ id: 'bk1' }], meta: { hasNext: false } });
    const { result } = renderHook(() => useBookmarks(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/bookmarks', { params: {} });
  });

  it('passes filters', async () => {
    mockGet.mockResolvedValueOnce({ data: [], meta: { hasNext: false } });
    renderHook(
      () => useBookmarks({ legalDocumentId: 'doc1', cursor: 'c1', limit: 5 }),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(mockGet).toHaveBeenCalledWith('/bookmarks', {
      params: { legalDocumentId: 'doc1', cursor: 'c1', limit: '5' },
    });
  });
});

describe('useCreateBookmark', () => {
  it('posts bookmark', async () => {
    mockPost.mockResolvedValueOnce({ id: 'bk2', legalDocumentId: 'doc1' });
    const { result } = renderHook(() => useCreateBookmark(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate({ legalDocumentId: 'doc1' } as never); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/bookmarks', { legalDocumentId: 'doc1' });
  });
});

describe('useDeleteBookmark', () => {
  it('deletes by id', async () => {
    mockDelete.mockResolvedValueOnce({ message: 'Deleted' });
    const { result } = renderHook(() => useDeleteBookmark(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate('bk1'); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockDelete).toHaveBeenCalledWith('/bookmarks/bk1');
  });
});
