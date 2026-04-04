import { renderHook, waitFor } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import { useSubscription, useCanGenerateDigest } from './use-subscription';

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
    mockGet.mockResolvedValueOnce({ data: { planCode: 'pro', status: 'active' } });
    const { result } = renderHook(() => useSubscription(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/billing/subscription');
  });

  it('selects data from response', async () => {
    mockGet.mockResolvedValueOnce({ data: { planCode: 'pro', status: 'active' } });
    const { result } = renderHook(() => useSubscription(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ planCode: 'pro', status: 'active' });
  });

  it('is disabled when enabled is false', () => {
    const { result } = renderHook(() => useSubscription(false), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useCanGenerateDigest', () => {
  it('returns true for pro plan', async () => {
    mockGet.mockResolvedValueOnce({ data: { planCode: 'pro', status: 'active' } });
    const { result } = renderHook(() => useCanGenerateDigest(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('returns true for edu plan', async () => {
    mockGet.mockResolvedValueOnce({ data: { planCode: 'edu', status: 'active' } });
    const { result } = renderHook(() => useCanGenerateDigest(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('returns false for free plan', async () => {
    mockGet.mockResolvedValueOnce({ data: { planCode: 'free', status: 'active' } });
    const { result } = renderHook(() => useCanGenerateDigest(), { wrapper: createWrapper() });
    // Need to wait for query to settle, then check
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });

  it('returns false when no data yet', () => {
    mockGet.mockReturnValue(new Promise(() => {})); // never resolves
    const { result } = renderHook(() => useCanGenerateDigest(), { wrapper: createWrapper() });
    expect(result.current).toBe(false);
  });
});
