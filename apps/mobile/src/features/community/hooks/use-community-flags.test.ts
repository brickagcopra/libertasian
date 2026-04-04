import { renderHook, waitFor, act } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';

import {
  useCreateFlag,
  useMyExpertVerification,
  useSubmitExpertVerification,
} from './use-community-flags';

jest.mock('../../../lib/api-client', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;
const mockPost = apiClient.post as jest.MockedFunction<typeof apiClient.post>;

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('useCreateFlag', () => {
  it('posts flag data with reason only', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: { id: 'flag-1' } });

    const { result } = renderHook(() => useCreateFlag(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({
        entityType: 'digest',
        entityId: 'd-1',
        reason: 'spam',
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockPost).toHaveBeenCalledWith('/community/flags', {
      entityType: 'digest',
      entityId: 'd-1',
      reason: 'spam',
    });
  });

  it('posts flag data with details', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: { id: 'flag-2' } });

    const { result } = renderHook(() => useCreateFlag(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({
        entityType: 'flashcard_set',
        entityId: 'fs-1',
        reason: 'inaccurate',
        details: 'The answers are wrong',
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockPost).toHaveBeenCalledWith('/community/flags', {
      entityType: 'flashcard_set',
      entityId: 'fs-1',
      reason: 'inaccurate',
      details: 'The answers are wrong',
    });
  });

  it('supports all flag reasons', async () => {
    const reasons = ['spam', 'inappropriate', 'copyright', 'inaccurate', 'other'] as const;

    for (const reason of reasons) {
      mockPost.mockResolvedValueOnce({ success: true, data: { id: `flag-${reason}` } });

      const { result } = renderHook(() => useCreateFlag(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        result.current.mutate({
          entityType: 'community_rating',
          entityId: 'cr-1',
          reason,
        });
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
    }
  });

  it('handles mutation error', async () => {
    mockPost.mockRejectedValueOnce(new Error('Server error'));

    const { result } = renderHook(() => useCreateFlag(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({
        entityType: 'digest',
        entityId: 'd-1',
        reason: 'spam',
      });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useMyExpertVerification', () => {
  it('fetches expert verification status', async () => {
    const mockVerification = {
      success: true,
      data: {
        id: 'ev-1',
        userId: 'u-1',
        expertiseType: 'lawyer' as const,
        credentialDetails: 'Roll No. 12345',
        status: 'approved' as const,
        reviewNote: null,
        reviewedAt: '2026-03-01T00:00:00Z',
        createdAt: '2026-02-01T00:00:00Z',
        updatedAt: '2026-03-01T00:00:00Z',
      },
    };
    mockGet.mockResolvedValueOnce(mockVerification);

    const { result } = renderHook(() => useMyExpertVerification(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith('/community/expert-verification/me');
    expect(result.current.data?.data?.expertiseType).toBe('lawyer');
  });

  it('returns null when no verification exists', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: null });

    const { result } = renderHook(() => useMyExpertVerification(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data).toBeNull();
  });
});

describe('useSubmitExpertVerification', () => {
  it('submits expert verification with expertise type', async () => {
    const mockResponse = {
      success: true,
      data: {
        id: 'ev-new',
        userId: 'u-1',
        expertiseType: 'law_professor' as const,
        credentialDetails: 'University of the Philippines',
        status: 'pending' as const,
        reviewNote: null,
        reviewedAt: null,
        createdAt: '2026-03-22T00:00:00Z',
        updatedAt: '2026-03-22T00:00:00Z',
      },
    };
    mockPost.mockResolvedValueOnce(mockResponse);

    const { result } = renderHook(() => useSubmitExpertVerification(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({
        expertiseType: 'law_professor',
        credentialDetails: 'University of the Philippines',
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockPost).toHaveBeenCalledWith('/community/expert-verification', {
      expertiseType: 'law_professor',
      credentialDetails: 'University of the Philippines',
    });
  });

  it('handles conflict error (already submitted)', async () => {
    mockPost.mockRejectedValueOnce(new Error('Conflict'));

    const { result } = renderHook(() => useSubmitExpertVerification(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({ expertiseType: 'lawyer' });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('submits without credential details', async () => {
    mockPost.mockResolvedValueOnce({
      success: true,
      data: {
        id: 'ev-2',
        userId: 'u-1',
        expertiseType: 'legal_researcher',
        credentialDetails: null,
        status: 'pending',
        reviewNote: null,
        reviewedAt: null,
        createdAt: '2026-03-22T00:00:00Z',
        updatedAt: '2026-03-22T00:00:00Z',
      },
    });

    const { result } = renderHook(() => useSubmitExpertVerification(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({ expertiseType: 'legal_researcher' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockPost).toHaveBeenCalledWith('/community/expert-verification', {
      expertiseType: 'legal_researcher',
    });
  });
});
