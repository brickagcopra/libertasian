import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    patch: vi.fn(),
  },
}));

import { apiClient } from '@/lib/api-client';
import {
  useStudyProgressList,
  useStudyProgress,
  useUpsertStudyProgress,
} from './use-study-progress';

const mockGet = vi.mocked(apiClient.get);
const mockPatch = vi.mocked(apiClient.patch);

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

const mockProgress = {
  id: 'sp1',
  entityType: 'flashcard_set',
  entityId: 'fs1',
  completionPercentage: 75,
  lastStudiedAt: '2026-03-20T10:00:00Z',
};

describe('useStudyProgressList', () => {
  beforeEach(() => mockGet.mockReset());

  it('fetches all study progress entries', async () => {
    mockGet.mockResolvedValueOnce({
      success: true,
      data: [mockProgress],
    });

    const { result } = renderHook(() => useStudyProgressList(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith('/study/progress');
    expect(result.current.data?.data).toHaveLength(1);
  });

  it('handles error state', async () => {
    mockGet.mockRejectedValueOnce(new Error('Unauthorized'));

    const { result } = renderHook(() => useStudyProgressList(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useStudyProgress', () => {
  beforeEach(() => mockGet.mockReset());

  it('fetches progress for a specific entity', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: mockProgress });

    const { result } = renderHook(
      () => useStudyProgress('flashcard_set', 'fs1'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith('/study/progress/flashcard_set/fs1');
    expect(result.current.data).toEqual(mockProgress);
  });

  it('is disabled when entityType is empty', () => {
    const { result } = renderHook(() => useStudyProgress('', 'fs1'), {
      wrapper: createWrapper(),
    });

    expect(result.current.isFetching).toBe(false);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('is disabled when entityId is empty', () => {
    const { result } = renderHook(
      () => useStudyProgress('flashcard_set', ''),
      { wrapper: createWrapper() },
    );

    expect(result.current.isFetching).toBe(false);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('encodes entityType with special characters', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: mockProgress });

    const { result } = renderHook(
      () => useStudyProgress('reviewer pack', 'rp1'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith('/study/progress/reviewer%20pack/rp1');
  });
});

describe('useUpsertStudyProgress', () => {
  beforeEach(() => mockPatch.mockReset());

  it('upserts study progress via PATCH', async () => {
    mockPatch.mockResolvedValueOnce({
      success: true,
      data: { ...mockProgress, completionPercentage: 90 },
    });

    const { result } = renderHook(() => useUpsertStudyProgress(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({
        entityType: 'flashcard_set',
        entityId: 'fs1',
        data: { completionPercentage: 90 },
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockPatch).toHaveBeenCalledWith(
      '/study/progress/flashcard_set/fs1',
      { completionPercentage: 90 },
    );
  });

  it('handles upsert error', async () => {
    mockPatch.mockRejectedValueOnce(new Error('Bad request'));

    const { result } = renderHook(() => useUpsertStudyProgress(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({
        entityType: 'flashcard_set',
        entityId: 'fs1',
        data: { completionPercentage: -1 },
      });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
