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
  useShares,
  useCreateShare,
  useUpdateShare,
  useRevokeShare,
} from './use-shares';

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

describe('useShares', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    mockPatch.mockReset();
    mockDelete.mockReset();
  });

  it('fetches shares for a specific entity', async () => {
    mockGet.mockResolvedValueOnce({
      success: true,
      data: [{ id: 's1', permission: 'read', entityType: 'matter', entityId: 'm1' }],
    });

    const { result } = renderHook(
      () => useShares({ entityType: 'matter', entityId: 'm1' }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith('/shares', {
      params: { entityType: 'matter', entityId: 'm1' },
    });
  });

  it('is disabled when entityType is missing', () => {
    const { result } = renderHook(
      () => useShares({ entityId: 'm1' }),
      { wrapper: createWrapper() },
    );

    expect(result.current.isFetching).toBe(false);
  });

  it('is disabled when entityId is missing', () => {
    const { result } = renderHook(
      () => useShares({ entityType: 'matter' }),
      { wrapper: createWrapper() },
    );

    expect(result.current.isFetching).toBe(false);
  });
});

describe('useCreateShare', () => {
  beforeEach(() => mockPost.mockReset());

  it('creates a share via POST', async () => {
    mockPost.mockResolvedValueOnce({
      success: true,
      data: { id: 's1', shareToken: 'tok123' },
    });

    const { result } = renderHook(() => useCreateShare(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({
        entityType: 'matter',
        entityId: 'm1',
        permission: 'read',
        targetUserId: 'u2',
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockPost).toHaveBeenCalledWith('/shares', {
      entityType: 'matter',
      entityId: 'm1',
      permission: 'read',
      targetUserId: 'u2',
    });
  });
});

describe('useUpdateShare', () => {
  beforeEach(() => mockPatch.mockReset());

  it('updates a share via PATCH', async () => {
    mockPatch.mockResolvedValueOnce({
      success: true,
      data: { id: 's1', permission: 'write' },
    });

    const { result } = renderHook(() => useUpdateShare(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate({ id: 's1', permission: 'write' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockPatch).toHaveBeenCalledWith('/shares/s1', { permission: 'write' });
  });
});

describe('useRevokeShare', () => {
  beforeEach(() => mockDelete.mockReset());

  it('revokes a share via DELETE', async () => {
    mockDelete.mockResolvedValueOnce({ success: true });

    const { result } = renderHook(() => useRevokeShare(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      result.current.mutate('s1');
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockDelete).toHaveBeenCalledWith('/shares/s1');
  });
});
