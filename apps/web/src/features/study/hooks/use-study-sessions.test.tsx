import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

import { apiClient } from '@/lib/api-client';
import {
  useStudyStats,
  useStartStudySession,
  useEndStudySession,
} from './use-study-sessions';

const mockGet = vi.mocked(apiClient.get);
const mockPost = vi.mocked(apiClient.post);

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

describe('useStudyStats', () => {
  beforeEach(() => mockGet.mockReset());

  it('fetches study stats', async () => {
    const stats = {
      streak: { currentStreak: 5, longestStreak: 12, lastStudyDate: '2026-03-22' },
      totalStudyTimeMinutes: 450,
      subjectBreakdown: [
        { subject: 'civil_law', timeMinutes: 120 },
        { subject: 'criminal_law', timeMinutes: 100 },
      ],
    };
    mockGet.mockResolvedValueOnce({ success: true, data: stats });

    const { result } = renderHook(() => useStudyStats(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith('/study/stats');
    expect(result.current.data).toEqual(stats);
  });

  it('handles error state', async () => {
    mockGet.mockRejectedValueOnce(new Error('Server error'));

    const { result } = renderHook(() => useStudyStats(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useStartStudySession', () => {
  beforeEach(() => mockPost.mockReset());

  it('starts a study session via POST', async () => {
    const session = {
      id: 'sess1',
      barSubject: 'civil_law',
      sessionType: 'flashcard_review',
      startedAt: '2026-03-22T10:00:00Z',
    };
    mockPost.mockResolvedValueOnce({ success: true, data: session });

    const { result } = renderHook(() => useStartStudySession(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({
        barSubject: 'civil_law',
        sessionType: 'flashcard_review',
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockPost).toHaveBeenCalledWith('/study/sessions/start', {
      barSubject: 'civil_law',
      sessionType: 'flashcard_review',
    });
    expect(result.current.data).toEqual(session);
  });

  it('handles start session error', async () => {
    mockPost.mockRejectedValueOnce(new Error('Already in session'));

    const { result } = renderHook(() => useStartStudySession(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({
        barSubject: 'civil_law',
        sessionType: 'flashcard_review',
      });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useEndStudySession', () => {
  beforeEach(() => mockPost.mockReset());

  it('ends a study session via POST', async () => {
    const session = {
      id: 'sess1',
      barSubject: 'civil_law',
      sessionType: 'flashcard_review',
      startedAt: '2026-03-22T10:00:00Z',
      endedAt: '2026-03-22T10:30:00Z',
      durationMinutes: 30,
    };
    mockPost.mockResolvedValueOnce({ success: true, data: session });

    const { result } = renderHook(() => useEndStudySession(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({
        sessionId: 'sess1',
        input: { cardsReviewed: 20, correctCount: 15 },
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockPost).toHaveBeenCalledWith('/study/sessions/sess1/end', {
      cardsReviewed: 20,
      correctCount: 15,
    });
    expect(result.current.data).toEqual(session);
  });

  it('handles end session error', async () => {
    mockPost.mockRejectedValueOnce(new Error('Session not found'));

    const { result } = renderHook(() => useEndStudySession(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({
        sessionId: 'missing',
        input: { cardsReviewed: 0, correctCount: 0 },
      });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
