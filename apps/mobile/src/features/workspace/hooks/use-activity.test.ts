import { renderHook, waitFor } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import { useActivity } from './use-activity';

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

describe('useActivity', () => {
  it('fetches with default params', async () => {
    mockGet.mockResolvedValueOnce({ data: [{ id: 'a1' }], meta: { hasNext: false } });
    const { result } = renderHook(() => useActivity(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/activity', { params: {} });
  });

  it('passes filter params', async () => {
    mockGet.mockResolvedValueOnce({ data: [], meta: { hasNext: false } });
    renderHook(() => useActivity({ entityType: 'matter', actorUserId: 'u1', limit: 10 }), { wrapper: createWrapper() });
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(mockGet).toHaveBeenCalledWith('/activity', {
      params: { entityType: 'matter', actorUserId: 'u1', limit: '10' },
    });
  });

  it('handles errors', async () => {
    mockGet.mockRejectedValueOnce(new Error('fail'));
    const { result } = renderHook(() => useActivity(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
