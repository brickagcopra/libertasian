import { renderHook, waitFor, act } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';

import { useMyVote, useUpsertVote, useRemoveVote } from './use-community-votes';

jest.mock('../../../lib/api-client', () => ({
  apiClient: {
    get: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;
const mockPut = apiClient.put as jest.MockedFunction<typeof apiClient.put>;
const mockDelete = apiClient.delete as jest.MockedFunction<typeof apiClient.delete>;

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

const mockVoteResponse = {
  success: true,
  data: {
    id: 'v-1',
    userId: 'u-1',
    entityType: 'digest',
    entityId: 'd-1',
    voteType: 'up' as const,
    createdAt: '2026-03-01T00:00:00Z',
    updatedAt: '2026-03-01T00:00:00Z',
  },
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('useMyVote', () => {
  it('fetches user vote from the correct endpoint', async () => {
    // apiClient returns the UNWRAPPED body — unwrapEnvelope already ran.
    mockGet.mockResolvedValueOnce(mockVoteResponse.data);

    const { result } = renderHook(
      () => useMyVote('digest', 'd-1'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith('/community/votes/mine/digest/d-1');
  });

  it('returns null vote data when no vote exists', async () => {
    mockGet.mockResolvedValueOnce(null);

    const { result } = renderHook(
      () => useMyVote('digest', 'd-2'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('is disabled when entityId is empty', () => {
    const { result } = renderHook(
      () => useMyVote('digest', ''),
      { wrapper: createWrapper() },
    );

    expect(result.current.fetchStatus).toBe('idle');
    expect(mockGet).not.toHaveBeenCalled();
  });
});

describe('useUpsertVote', () => {
  it('puts upvote to the correct endpoint', async () => {
    mockPut.mockResolvedValueOnce(mockVoteResponse);

    const { result } = renderHook(() => useUpsertVote(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({
        entityType: 'digest',
        entityId: 'd-1',
        voteType: 'up',
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockPut).toHaveBeenCalledWith(
      '/community/votes/digest/d-1',
      { voteType: 'up' },
    );
  });

  it('puts downvote correctly', async () => {
    const downvoteResponse = {
      ...mockVoteResponse,
      data: { ...mockVoteResponse.data, voteType: 'down' as const },
    };
    mockPut.mockResolvedValueOnce(downvoteResponse);

    const { result } = renderHook(() => useUpsertVote(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({
        entityType: 'digest',
        entityId: 'd-1',
        voteType: 'down',
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockPut).toHaveBeenCalledWith(
      '/community/votes/digest/d-1',
      { voteType: 'down' },
    );
  });

  it('handles mutation error', async () => {
    mockPut.mockRejectedValueOnce(new Error('Forbidden'));

    const { result } = renderHook(() => useUpsertVote(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({
        entityType: 'digest',
        entityId: 'd-1',
        voteType: 'up',
      });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useRemoveVote', () => {
  it('deletes vote from the correct endpoint', async () => {
    mockDelete.mockResolvedValueOnce({ success: true });

    const { result } = renderHook(() => useRemoveVote(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({ entityType: 'digest', entityId: 'd-1' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockDelete).toHaveBeenCalledWith('/community/votes/digest/d-1');
  });

  it('handles delete error', async () => {
    mockDelete.mockRejectedValueOnce(new Error('Not found'));

    const { result } = renderHook(() => useRemoveVote(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({ entityType: 'digest', entityId: 'd-999' });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
