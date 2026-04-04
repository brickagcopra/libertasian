import { renderHook, waitFor } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import { useBarSubjects } from './use-bar-subjects';

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

describe('useBarSubjects', () => {
  it('fetches bar subjects', async () => {
    mockGet.mockResolvedValueOnce([{ id: '1', code: 'criminal_law', name: 'Criminal Law' }]);
    const { result } = renderHook(() => useBarSubjects(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/study/bar-subjects');
  });

  it('returns data on success', async () => {
    const data = [{ id: '1', code: 'civil_law', name: 'Civil Law' }];
    mockGet.mockResolvedValueOnce(data);
    const { result } = renderHook(() => useBarSubjects(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.data).toEqual(data));
  });

  it('handles errors', async () => {
    mockGet.mockRejectedValueOnce(new Error('fail'));
    const { result } = renderHook(() => useBarSubjects(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
