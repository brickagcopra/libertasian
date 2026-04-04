import { renderHook, waitFor, act } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import {
  useResearchWorkspaces, useResearchWorkspace,
  useCreateResearchWorkspace, useUpdateResearchWorkspace,
  useDeleteResearchWorkspace, useResearchQueries, useAskResearchQuery,
} from './use-research-workspaces';

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

describe('useResearchWorkspaces', () => {
  it('fetches list', async () => {
    mockGet.mockResolvedValueOnce({ data: [{ id: 'rw1' }], meta: { hasNext: false } });
    const { result } = renderHook(() => useResearchWorkspaces(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/research-workspaces', { params: {} });
  });

  it('passes cursor and limit', async () => {
    mockGet.mockResolvedValueOnce({ data: [], meta: { hasNext: false } });
    renderHook(() => useResearchWorkspaces({ cursor: 'abc', limit: 10 }), { wrapper: createWrapper() });
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(mockGet).toHaveBeenCalledWith('/research-workspaces', { params: { cursor: 'abc', limit: '10' } });
  });
});

describe('useResearchWorkspace', () => {
  it('fetches single workspace', async () => {
    mockGet.mockResolvedValueOnce({ data: { id: 'rw1', name: 'Test' } });
    const { result } = renderHook(() => useResearchWorkspace('rw1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/research-workspaces/rw1');
  });

  it('is disabled when id is empty', () => {
    const { result } = renderHook(() => useResearchWorkspace(''), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('is disabled when enabled is false', () => {
    const { result } = renderHook(() => useResearchWorkspace('rw1', false), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useCreateResearchWorkspace', () => {
  it('posts correctly', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: { id: 'rw2' } });
    const { result } = renderHook(() => useCreateResearchWorkspace(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate({ name: 'New WS' } as never); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/research-workspaces', { name: 'New WS' });
  });
});

describe('useUpdateResearchWorkspace', () => {
  it('patches correctly', async () => {
    mockPatch.mockResolvedValueOnce({ success: true, data: { id: 'rw1' } });
    const { result } = renderHook(() => useUpdateResearchWorkspace('rw1'), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate({ name: 'Updated' } as never); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPatch).toHaveBeenCalledWith('/research-workspaces/rw1', { name: 'Updated' });
  });
});

describe('useDeleteResearchWorkspace', () => {
  it('deletes by id', async () => {
    mockDelete.mockResolvedValueOnce({ success: true });
    const { result } = renderHook(() => useDeleteResearchWorkspace(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate('rw1'); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockDelete).toHaveBeenCalledWith('/research-workspaces/rw1');
  });
});

describe('useResearchQueries', () => {
  it('fetches queries for workspace', async () => {
    mockGet.mockResolvedValueOnce({ data: [{ id: 'q1', responseJson: {} }] });
    const { result } = renderHook(() => useResearchQueries('rw1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/research-workspaces/rw1/queries');
  });

  it('is disabled when workspaceId is empty', () => {
    const { result } = renderHook(() => useResearchQueries(''), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useAskResearchQuery', () => {
  it('posts query', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: { id: 'q2' } });
    const { result } = renderHook(() => useAskResearchQuery('rw1'), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate({ query: 'What is res judicata?' } as never); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/research-workspaces/rw1/queries', { query: 'What is res judicata?' });
  });
});
