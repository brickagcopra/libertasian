import { renderHook, waitFor, act } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import {
  useApiKeys, useApiKey, useCreateApiKey, useUpdateApiKey, useDeleteApiKey,
} from './use-api-keys';

jest.mock('../../../lib/api-client', () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;
const mockPost = apiClient.post as jest.MockedFunction<typeof apiClient.post>;
const mockPatch = (apiClient as Record<string, unknown>).patch as jest.MockedFunction<typeof apiClient.get>;
const mockDelete = apiClient.delete as jest.MockedFunction<typeof apiClient.delete>;

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => jest.clearAllMocks());

describe('useApiKeys', () => {
  it('fetches list with defaults', async () => {
    mockGet.mockResolvedValueOnce({ data: [{ id: 'k1' }], meta: { hasNext: false } });
    const { result } = renderHook(() => useApiKeys(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/api-keys', { params: { limit: '20' } });
  });

  it('passes cursor', async () => {
    mockGet.mockResolvedValueOnce({ data: [], meta: { hasNext: false } });
    renderHook(() => useApiKeys({ cursor: 'c1', limit: 10 }), { wrapper: createWrapper() });
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(mockGet).toHaveBeenCalledWith('/api-keys', { params: { limit: '10', cursor: 'c1' } });
  });
});

describe('useApiKey', () => {
  it('fetches single key', async () => {
    mockGet.mockResolvedValueOnce({ data: { id: 'k1', name: 'Test Key' } });
    const { result } = renderHook(() => useApiKey('k1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/api-keys/k1');
  });

  it('is disabled when id is null', () => {
    const { result } = renderHook(() => useApiKey(null), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useCreateApiKey', () => {
  it('posts correctly', async () => {
    mockPost.mockResolvedValueOnce({ data: { id: 'k2', key: 'sk_live_xxx' } });
    const { result } = renderHook(() => useCreateApiKey(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate({ name: 'New Key' } as never); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/api-keys', { name: 'New Key' });
  });
});

describe('useUpdateApiKey', () => {
  it('patches correctly', async () => {
    mockPatch.mockResolvedValueOnce({ data: { id: 'k1', name: 'Updated' } });
    const { result } = renderHook(() => useUpdateApiKey(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate({ id: 'k1', data: { name: 'Updated' } } as never); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPatch).toHaveBeenCalledWith('/api-keys/k1', { name: 'Updated' });
  });
});

describe('useDeleteApiKey', () => {
  it('deletes by id', async () => {
    mockDelete.mockResolvedValueOnce({ success: true });
    const { result } = renderHook(() => useDeleteApiKey(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate('k1'); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockDelete).toHaveBeenCalledWith('/api-keys/k1');
  });
});
