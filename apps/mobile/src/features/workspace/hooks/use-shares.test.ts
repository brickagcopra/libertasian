import { renderHook, waitFor, act } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import {
  useShares, useCreateShare, useUpdateShare, useRevokeShare,
  useSharedContent, useAccessSharedContentWithPassword,
} from './use-shares';

jest.mock('../../../lib/api-client', () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;
const mockPost = apiClient.post as jest.MockedFunction<typeof apiClient.post>;
const mockPatch = apiClient.patch as jest.MockedFunction<typeof apiClient.patch>;
const mockDelete = apiClient.delete as jest.MockedFunction<typeof apiClient.delete>;

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => jest.clearAllMocks());

describe('useShares', () => {
  it('fetches shares for entity', async () => {
    mockGet.mockResolvedValueOnce({ data: [{ id: 's1' }], meta: { hasNext: false } });
    const { result } = renderHook(() => useShares({ entityType: 'matter', entityId: 'm1' }), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/shares', { params: { entityType: 'matter', entityId: 'm1' } });
  });

  it('is disabled without entityType', () => {
    const { result } = renderHook(() => useShares({ entityId: 'm1' }), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useCreateShare', () => {
  it('posts correctly', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: { id: 's2', token: 'abc' } });
    const { result } = renderHook(() => useCreateShare(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate({ entityType: 'matter', entityId: 'm1', permission: 'view' } as never); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/shares', expect.objectContaining({ entityType: 'matter' }));
  });
});

describe('useUpdateShare', () => {
  it('patches correctly', async () => {
    mockPatch.mockResolvedValueOnce({ success: true, data: { id: 's1' } });
    const { result } = renderHook(() => useUpdateShare(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate({ id: 's1', permission: 'edit' } as never); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPatch).toHaveBeenCalledWith('/shares/s1', { permission: 'edit' });
  });
});

describe('useRevokeShare', () => {
  it('deletes by id', async () => {
    mockDelete.mockResolvedValueOnce({ success: true });
    const { result } = renderHook(() => useRevokeShare(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate('s1'); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockDelete).toHaveBeenCalledWith('/shares/s1');
  });
});

describe('useSharedContent', () => {
  it('fetches shared content by token', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: { title: 'Shared doc' } });
    const { result } = renderHook(() => useSharedContent('abc123'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/shared/abc123', { params: {}, skipAuth: true });
  });

  it('is disabled when token is null', () => {
    const { result } = renderHook(() => useSharedContent(null), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useAccessSharedContentWithPassword', () => {
  it('posts password to shared endpoint', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: { title: 'Protected doc' } });
    const { result } = renderHook(() => useAccessSharedContentWithPassword(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate({ token: 'abc', password: 'secret' }); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/shared/abc', { password: 'secret' }, { skipAuth: true });
  });
});
