import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    post: vi.fn(),
  },
}));

import { apiClient } from '@/lib/api-client';
import { useCreateFlag } from './use-community-flags';

const mockPost = vi.mocked(apiClient.post);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe('useCreateFlag', () => {
  beforeEach(() => mockPost.mockReset());

  it('submits a flag with reason', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: { id: 'f1' } });

    const { result } = renderHook(() => useCreateFlag(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        entityType: 'flashcard_set',
        entityId: 'fs1',
        reason: 'spam',
      });
    });

    expect(mockPost).toHaveBeenCalledWith('/community/flags', {
      entityType: 'flashcard_set',
      entityId: 'fs1',
      reason: 'spam',
    });
  });

  it('submits a flag with reason and details', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: { id: 'f2' } });

    const { result } = renderHook(() => useCreateFlag(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        entityType: 'digest',
        entityId: 'd1',
        reason: 'inaccurate',
        details: 'Contains incorrect ruling information',
      });
    });

    expect(mockPost).toHaveBeenCalledWith('/community/flags', {
      entityType: 'digest',
      entityId: 'd1',
      reason: 'inaccurate',
      details: 'Contains incorrect ruling information',
    });
  });

  it('handles API error', async () => {
    mockPost.mockRejectedValueOnce(new Error('Server error'));

    const { result } = renderHook(() => useCreateFlag(), {
      wrapper: createWrapper(),
    });

    await expect(
      act(async () => {
        await result.current.mutateAsync({
          entityType: 'flashcard_set',
          entityId: 'fs1',
          reason: 'spam',
        });
      }),
    ).rejects.toThrow('Server error');
  });

  it('supports all flag reasons', async () => {
    const reasons = ['spam', 'inappropriate', 'copyright', 'inaccurate', 'other'] as const;

    for (const reason of reasons) {
      mockPost.mockResolvedValueOnce({ success: true, data: { id: `f-${reason}` } });

      const { result } = renderHook(() => useCreateFlag(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.mutateAsync({
          entityType: 'reviewer_pack',
          entityId: 'rp1',
          reason,
        });
      });
    }

    expect(mockPost).toHaveBeenCalledTimes(5);
  });
});
