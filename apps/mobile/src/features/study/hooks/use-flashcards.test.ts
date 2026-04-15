import { renderHook, waitFor, act } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import { useFlashcards, useCreateFlashcard, useUpdateFlashcard, useDeleteFlashcard } from './use-flashcards';

jest.mock('../../../lib/api-client', () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;
const mockPost = apiClient.post as jest.MockedFunction<typeof apiClient.post>;
const mockPatch = apiClient.patch as jest.MockedFunction<typeof apiClient.patch>;
const mockDelete = apiClient.delete as jest.MockedFunction<typeof apiClient.delete>;

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => jest.clearAllMocks());

describe('useFlashcards', () => {
  it('fetches cards for a set', async () => {
    mockGet.mockResolvedValueOnce([{ id: 'c1', front: 'Q', back: 'A' }]);
    const { result } = renderHook(() => useFlashcards('set-1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/study/flashcard-sets/set-1/flashcards');
  });

  it('is disabled when setId is empty', () => {
    const { result } = renderHook(() => useFlashcards(''), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useCreateFlashcard', () => {
  it('posts to correct endpoint', async () => {
    mockPost.mockResolvedValueOnce({ id: 'c2', front: 'Q2', back: 'A2' });
    const { result } = renderHook(() => useCreateFlashcard('set-1'), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate({ front: 'Q2', back: 'A2', sourceType: 'manual' }); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/study/flashcard-sets/set-1/flashcards', expect.objectContaining({ front: 'Q2' }));
  });
});

describe('useUpdateFlashcard', () => {
  it('patches by card id', async () => {
    mockPatch.mockResolvedValueOnce({ id: 'c1', front: 'Updated' });
    const { result } = renderHook(() => useUpdateFlashcard('set-1'), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate({ id: 'c1', input: { front: 'Updated' } }); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPatch).toHaveBeenCalledWith('/study/flashcards/c1', { front: 'Updated' });
  });
});

describe('useDeleteFlashcard', () => {
  it('deletes by card id', async () => {
    mockDelete.mockResolvedValueOnce({ success: true });
    const { result } = renderHook(() => useDeleteFlashcard('set-1'), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate('c1'); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockDelete).toHaveBeenCalledWith('/study/flashcards/c1');
  });
});
