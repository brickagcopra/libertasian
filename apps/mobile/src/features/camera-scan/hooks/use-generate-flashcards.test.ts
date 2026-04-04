import { renderHook, waitFor, act } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import { useGenerateFlashcardsFromScan } from './use-generate-flashcards';

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

describe('useGenerateFlashcardsFromScan', () => {
  it('posts with all params', async () => {
    mockPost.mockResolvedValueOnce({ data: { cardsGenerated: 5 } });
    const { result } = renderHook(() => useGenerateFlashcardsFromScan(), { wrapper: createWrapper() });
    await act(async () => {
      result.current.mutate({
        uploadId: 'u1', flashcardSetId: 'fs-1', cardType: 'definition', count: 10, barSubject: 'civil_law',
      });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/uploads/u1/generate-flashcards', {
      flashcardSetId: 'fs-1', cardType: 'definition', count: 10, barSubject: 'civil_law',
    });
  });

  it('posts with required params only', async () => {
    mockPost.mockResolvedValueOnce({ data: { cardsGenerated: 3 } });
    const { result } = renderHook(() => useGenerateFlashcardsFromScan(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate({ uploadId: 'u1', flashcardSetId: 'fs-1' }); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/uploads/u1/generate-flashcards', { flashcardSetId: 'fs-1' });
  });

  it('handles errors', async () => {
    mockPost.mockRejectedValueOnce(new Error('fail'));
    const { result } = renderHook(() => useGenerateFlashcardsFromScan(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate({ uploadId: 'u1', flashcardSetId: 'fs-1' }); });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
