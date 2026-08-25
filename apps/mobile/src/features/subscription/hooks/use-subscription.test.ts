import { renderHook, waitFor } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import { useSubscription } from './use-subscription';

jest.mock('../../../lib/api-client', () => ({
  apiClient: { get: jest.fn() },
}));

const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => jest.clearAllMocks());

describe('useSubscription', () => {
  it('fetches subscription', async () => {
    mockGet.mockResolvedValueOnce({ planCode: 'pro', status: 'active' });
    const { result } = renderHook(() => useSubscription(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/billing/subscription');
  });

  // apiClient strips the { success, data } envelope, so the hook exposes the
  // unwrapped SubscriptionDetail directly (no select).
  it('exposes the unwrapped subscription detail as data', async () => {
    mockGet.mockResolvedValueOnce({ planCode: 'pro', status: 'active' });
    const { result } = renderHook(() => useSubscription(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ planCode: 'pro', status: 'active' });
  });

  // Regression guard: if a `select: (res) => res.data` is ever re-added, a
  // wrapped payload would be drilled into and this as-is assertion would fail.
  it('passes a wrapped { data: {...} } payload through as-is (no select)', async () => {
    const wrapped = { data: { planCode: 'pro', status: 'active' } };
    mockGet.mockResolvedValueOnce(wrapped);
    const { result } = renderHook(() => useSubscription(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(wrapped);
  });

  it('is disabled when enabled is false', () => {
    const { result } = renderHook(() => useSubscription(false), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});
