import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
  },
}));

import { apiClient } from '@/lib/api-client';
import { useOrgMembers } from './use-org-members';

const mockGet = vi.mocked(apiClient.get);

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

describe('useOrgMembers', () => {
  beforeEach(() => mockGet.mockReset());

  it('fetches organization members by orgId', async () => {
    const members = [
      {
        id: 'om1',
        userId: 'u1',
        role: 'admin',
        status: 'active',
        user: { id: 'u1', fullName: 'Juan Dela Cruz', email: 'juan@example.com' },
      },
      {
        id: 'om2',
        userId: 'u2',
        role: 'member',
        status: 'active',
        user: { id: 'u2', fullName: 'Maria Santos', email: 'maria@example.com' },
      },
    ];
    mockGet.mockResolvedValueOnce({ success: true, data: members });

    const { result } = renderHook(() => useOrgMembers('org1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith('/organizations/org1/members');
    expect(result.current.data).toEqual(members);
  });

  it('is disabled when orgId is null', () => {
    const { result } = renderHook(() => useOrgMembers(null), {
      wrapper: createWrapper(),
    });

    expect(result.current.isFetching).toBe(false);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('handles error state', async () => {
    mockGet.mockRejectedValueOnce(new Error('Forbidden'));

    const { result } = renderHook(() => useOrgMembers('org1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
