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
  useFlashcardSets,
  useFlashcardSet,
  useCreateFlashcardSet,
  useUpdateFlashcardSet,
  useDeleteFlashcardSet,
} from './use-flashcard-sets';

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

const mockSet = {
  id: 'fs1',
  title: 'Constitutional Law Set',
  barSubject: 'political_law',
  visibility: 'private',
  cardCount: 10,
  createdAt: '2026-01-01T00:00:00Z',
};

describe('useFlashcardSets', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    mockPatch.mockReset();
    mockDelete.mockReset();
  });

  it('fetches flashcard sets with default limit', async () => {
    mockGet.mockResolvedValueOnce({
      success: true,
      data: [mockSet],
      meta: { hasNext: false, nextCursor: null },
    });

    const { result } = renderHook(() => useFlashcardSets(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith('/study/flashcard-sets', {
      params: { limit: '20' },
    });
    expect(result.current.data?.data).toHaveLength(1);
  });

  it('passes barSubject, visibility, and cursor params', async () => {
    mockGet.mockResolvedValueOnce({
      success: true,
      data: [],
      meta: { hasNext: false, nextCursor: null },
    });

    const { result } = renderHook(
      () =>
        useFlashcardSets({
          barSubject: 'civil_law',
          visibility: 'org',
          cursor: 'xyz',
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith('/study/flashcard-sets', {
      params: {
        limit: '20',
        barSubject: 'civil_law',
        visibility: 'org',
        cursor: 'xyz',
      },
    });
  });

  it('omits undefined optional params', async () => {
    mockGet.mockResolvedValueOnce({
      success: true,
      data: [],
      meta: { hasNext: false, nextCursor: null },
    });

    const { result } = renderHook(() => useFlashcardSets(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const callParams = mockGet.mock.calls[0]?.[1] as { params: Record<string, string> };
    expect(callParams.params).toEqual({ limit: '20' });
  });
});

describe('useFlashcardSet', () => {
  beforeEach(() => mockGet.mockReset());

  it('fetches a single flashcard set by id', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: mockSet });

    const { result } = renderHook(() => useFlashcardSet('fs1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith('/study/flashcard-sets/fs1');
    expect(result.current.data).toEqual(mockSet);
  });

  it('is disabled when id is empty', () => {
    const { result } = renderHook(() => useFlashcardSet(''), {
      wrapper: createWrapper(),
    });

    expect(result.current.isFetching).toBe(false);
    expect(mockGet).not.toHaveBeenCalled();
  });
});

describe('useCreateFlashcardSet', () => {
  beforeEach(() => mockPost.mockReset());

  it('creates a flashcard set via POST', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: mockSet });

    const { result } = renderHook(() => useCreateFlashcardSet(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({
        title: 'Constitutional Law Set',
        barSubject: 'political_law',
        visibility: 'private',
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockPost).toHaveBeenCalledWith('/study/flashcard-sets', {
      title: 'Constitutional Law Set',
      barSubject: 'political_law',
      visibility: 'private',
    });
  });

  it('handles creation error', async () => {
    mockPost.mockRejectedValueOnce(new Error('Validation failed'));

    const { result } = renderHook(() => useCreateFlashcardSet(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({ title: '', barSubject: '', visibility: 'private' });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Validation failed');
  });
});

describe('useUpdateFlashcardSet', () => {
  beforeEach(() => mockPatch.mockReset());

  it('updates a flashcard set via PATCH', async () => {
    mockPatch.mockResolvedValueOnce({
      success: true,
      data: { ...mockSet, title: 'Updated Title' },
    });

    const { result } = renderHook(() => useUpdateFlashcardSet(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({
        id: 'fs1',
        data: { title: 'Updated Title' },
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockPatch).toHaveBeenCalledWith('/study/flashcard-sets/fs1', {
      title: 'Updated Title',
    });
  });
});

describe('useDeleteFlashcardSet', () => {
  beforeEach(() => mockDelete.mockReset());

  it('deletes a flashcard set via DELETE', async () => {
    mockDelete.mockResolvedValueOnce({ success: true });

    const { result } = renderHook(() => useDeleteFlashcardSet(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate('fs1');
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockDelete).toHaveBeenCalledWith('/study/flashcard-sets/fs1');
  });
});
