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
import { useMyExpertVerification, useSubmitExpertVerification } from './use-expert-verification';

const mockGet = vi.mocked(apiClient.get);
const mockPost = vi.mocked(apiClient.post);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

const mockVerification = {
  id: 'ev1',
  userId: 'u1',
  expertiseType: 'lawyer' as const,
  credentialDetails: 'Roll of Attorneys #12345',
  status: 'approved' as const,
  reviewedAt: '2026-01-15T00:00:00Z',
  reviewerUserId: 'admin1',
  createdAt: '2026-01-01T00:00:00Z',
};

describe('useMyExpertVerification', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
  });

  it('fetches current user expert verification', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: mockVerification });

    const { result } = renderHook(() => useMyExpertVerification(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith('/community/expert-verification/me');
    expect(result.current.data?.data?.expertiseType).toBe('lawyer');
    expect(result.current.data?.data?.status).toBe('approved');
  });

  it('returns null when no verification exists', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: null });

    const { result } = renderHook(() => useMyExpertVerification(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.data).toBeNull();
  });

  it('handles API error', async () => {
    mockGet.mockRejectedValueOnce(new Error('Unauthorized'));

    const { result } = renderHook(() => useMyExpertVerification(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useSubmitExpertVerification', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
  });

  it('submits expert verification with expertise type', async () => {
    const pending = { ...mockVerification, status: 'pending' as const, reviewedAt: null };
    mockPost.mockResolvedValueOnce({ success: true, data: pending });

    const { result } = renderHook(() => useSubmitExpertVerification(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        expertiseType: 'lawyer',
      });
    });

    expect(mockPost).toHaveBeenCalledWith('/community/expert-verification', {
      expertiseType: 'lawyer',
    });
  });

  it('submits with optional credential details', async () => {
    mockPost.mockResolvedValueOnce({
      success: true,
      data: { ...mockVerification, status: 'pending', reviewedAt: null },
    });

    const { result } = renderHook(() => useSubmitExpertVerification(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        expertiseType: 'law_professor',
        credentialDetails: 'UP College of Law, 15 years',
      });
    });

    expect(mockPost).toHaveBeenCalledWith('/community/expert-verification', {
      expertiseType: 'law_professor',
      credentialDetails: 'UP College of Law, 15 years',
    });
  });

  it('supports all expertise types', async () => {
    const types = ['lawyer', 'law_professor', 'judge_retired', 'legal_researcher'] as const;

    for (const expertiseType of types) {
      mockPost.mockResolvedValueOnce({
        success: true,
        data: { ...mockVerification, expertiseType, status: 'pending' },
      });

      const { result } = renderHook(() => useSubmitExpertVerification(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.mutateAsync({ expertiseType });
      });
    }

    expect(mockPost).toHaveBeenCalledTimes(4);
  });

  it('handles conflict error (already pending)', async () => {
    mockPost.mockRejectedValueOnce(new Error('Conflict'));

    const { result } = renderHook(() => useSubmitExpertVerification(), {
      wrapper: createWrapper(),
    });

    await expect(
      act(async () => {
        await result.current.mutateAsync({ expertiseType: 'lawyer' });
      }),
    ).rejects.toThrow('Conflict');
  });
});
