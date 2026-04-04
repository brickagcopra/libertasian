import { renderHook, waitFor, act } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import { useUpdatePrivacy } from './use-update-privacy';

jest.mock('../../../lib/api-client', () => ({
  apiClient: { patch: jest.fn() },
}));

const mockPatch = apiClient.patch as jest.MockedFunction<typeof apiClient.patch>;

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => jest.clearAllMocks());

describe('useUpdatePrivacy', () => {
  it('patches to private', async () => {
    mockPatch.mockResolvedValueOnce({ success: true, data: { id: 'u1', privacyLevel: 'private' } });
    const { result } = renderHook(() => useUpdatePrivacy(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate({ uploadId: 'u1', privacyLevel: 'private' as never }); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPatch).toHaveBeenCalledWith('/uploads/u1/privacy', { privacyLevel: 'private' });
  });

  it('patches to editorial_candidate', async () => {
    mockPatch.mockResolvedValueOnce({ success: true, data: { id: 'u1', privacyLevel: 'editorial_candidate' } });
    const { result } = renderHook(() => useUpdatePrivacy(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate({ uploadId: 'u1', privacyLevel: 'editorial_candidate' as never }); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPatch).toHaveBeenCalledWith('/uploads/u1/privacy', { privacyLevel: 'editorial_candidate' });
  });

  it('handles errors', async () => {
    mockPatch.mockRejectedValueOnce(new Error('fail'));
    const { result } = renderHook(() => useUpdatePrivacy(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate({ uploadId: 'u1', privacyLevel: 'private' as never }); });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
