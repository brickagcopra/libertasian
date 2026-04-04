import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

import { apiClient } from '@/lib/api-client';
import {
  useFlashcards,
  useCreateFlashcard,
  useUpdateFlashcard,
  useDeleteFlashcard,
} from './use-flashcards';

const mockGet = vi.mocked(apiClient.get);
const mockPost = vi.mocked(apiClient.post);
const mockPatch = vi.mocked(apiClient.patch);
const mockDelete = vi.mocked(apiClient.delete);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

const mockCard = {
  id: 'fc1',
  front: 'What is due process?',
  back: 'No person shall be deprived of life, liberty, or property without due process of law.',
  cardType: 'definition',
  ordering: 1,
};

describe('useFlashcards', () => {
  beforeEach(() => mockGet.mockReset());

  it('fetches flashcards for a given set id', async () => {
    mockGet.mockResolvedValueOnce({
      success: true,
      data: [mockCard],
    });

    const { result } = renderHook(() => useFlashcards('set1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith('/study/flashcard-sets/set1/flashcards');
    expect(result.current.data?.data).toHaveLength(1);
  });

  it('is disabled when setId is empty', () => {
    const { result } = renderHook(() => useFlashcards(''), {
      wrapper: createWrapper(),
    });

    expect(result.current.isFetching).toBe(false);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('handles error state', async () => {
    mockGet.mockRejectedValueOnce(new Error('Not found'));

    const { result } = renderHook(() => useFlashcards('missing'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useCreateFlashcard', () => {
  beforeEach(() => mockPost.mockReset());

  it('creates a flashcard via POST', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: mockCard });

    const { result } = renderHook(() => useCreateFlashcard(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({
        setId: 'set1',
        data: {
          front: 'What is due process?',
          back: 'No person shall be deprived...',
          cardType: 'definition',
        },
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockPost).toHaveBeenCalledWith(
      '/study/flashcard-sets/set1/flashcards',
      {
        front: 'What is due process?',
        back: 'No person shall be deprived...',
        cardType: 'definition',
      },
    );
  });
});

describe('useUpdateFlashcard', () => {
  beforeEach(() => mockPatch.mockReset());

  it('updates a flashcard via PATCH', async () => {
    mockPatch.mockResolvedValueOnce({
      success: true,
      data: { ...mockCard, front: 'Updated question' },
    });

    const { result } = renderHook(() => useUpdateFlashcard(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({
        id: 'fc1',
        setId: 'set1',
        data: { front: 'Updated question' },
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockPatch).toHaveBeenCalledWith('/study/flashcards/fc1', {
      front: 'Updated question',
    });
  });
});

describe('useDeleteFlashcard', () => {
  beforeEach(() => mockDelete.mockReset());

  it('deletes a flashcard via DELETE', async () => {
    mockDelete.mockResolvedValueOnce({ success: true });

    const { result } = renderHook(() => useDeleteFlashcard(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({ id: 'fc1', setId: 'set1' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockDelete).toHaveBeenCalledWith('/study/flashcards/fc1');
  });
});
