import { renderHook, waitFor } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../../../lib/api-client', () => {
  class MockApiClientError extends Error {
    statusCode: number;
    serverMessage: string;
    constructor(statusCode: number, message: string) {
      super(message);
      this.name = 'ApiClientError';
      this.statusCode = statusCode;
      this.serverMessage = message;
    }
  }
  return {
    apiClient: { get: jest.fn() },
    ApiClientError: MockApiClientError,
  };
});

import { apiClient, ApiClientError } from '../../../lib/api-client';
import { useCanUseOffline } from './use-can-use-offline';

const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => jest.clearAllMocks());

describe('useCanUseOffline', () => {
  it('does not lock while the subscription query is loading (fail-open)', () => {
    mockGet.mockReturnValue(new Promise(() => {})); // never resolves
    const { result } = renderHook(() => useCanUseOffline(), {
      wrapper: createWrapper(),
    });
    expect(result.current.locked).toBe(false);
  });

  it('locks free plan orgs', async () => {
    mockGet.mockResolvedValueOnce({ planCode: 'free', status: 'active' });
    const { result } = renderHook(() => useCanUseOffline(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.locked).toBe(true));
  });

  it('treats a 404 (no subscription record) as the free tier and locks', async () => {
    mockGet.mockRejectedValueOnce(
      new ApiClientError(404, 'No active subscription found'),
    );
    const { result } = renderHook(() => useCanUseOffline(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.locked).toBe(true));
  });

  it('does not lock on non-404 errors (fail-open)', async () => {
    mockGet.mockRejectedValueOnce(new ApiClientError(500, 'Server error'));
    const { result } = renderHook(() => useCanUseOffline(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    await waitFor(() => expect(result.current.locked).toBe(false));
  });

  it('does not lock active edu plan orgs (offlineReading starts at edu)', async () => {
    mockGet.mockResolvedValueOnce({ planCode: 'edu', status: 'active' });
    const { result } = renderHook(() => useCanUseOffline(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    await waitFor(() => expect(result.current.locked).toBe(false));
  });

  it('does not lock trialing pro plan orgs', async () => {
    mockGet.mockResolvedValueOnce({ planCode: 'pro', status: 'trialing' });
    const { result } = renderHook(() => useCanUseOffline(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    await waitFor(() => expect(result.current.locked).toBe(false));
  });

  it('locks edu plan orgs with a non-active subscription', async () => {
    mockGet.mockResolvedValueOnce({ planCode: 'edu', status: 'past_due' });
    const { result } = renderHook(() => useCanUseOffline(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.locked).toBe(true));
  });
});
