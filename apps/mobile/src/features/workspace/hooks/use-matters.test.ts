import { renderHook, waitFor, act } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import {
  useMatters, useMatter, useCreateMatter, useUpdateMatter, useDeleteMatter,
  useMatterDocuments, useAddMatterDocument, useRemoveMatterDocument,
} from './use-matters';

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

describe('useMatters', () => {
  it('fetches with default params', async () => {
    mockGet.mockResolvedValueOnce({ data: [{ id: 'm1' }], meta: { hasNext: false } });
    const { result } = renderHook(() => useMatters(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/matters', { params: {} });
  });

  it('passes filters', async () => {
    mockGet.mockResolvedValueOnce({ data: [], meta: { hasNext: false } });
    renderHook(() => useMatters({ status: 'active', search: 'criminal' }), { wrapper: createWrapper() });
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(mockGet).toHaveBeenCalledWith('/matters', { params: { status: 'active', search: 'criminal' } });
  });
});

describe('useMatter', () => {
  it('fetches single matter', async () => {
    mockGet.mockResolvedValueOnce({ data: { id: 'm1', title: 'Case A' } });
    const { result } = renderHook(() => useMatter('m1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/matters/m1');
  });

  it('is disabled when id is null', () => {
    const { result } = renderHook(() => useMatter(null), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useCreateMatter', () => {
  it('posts correctly', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: { id: 'm2' } });
    const { result } = renderHook(() => useCreateMatter(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate({ title: 'New Matter' } as never); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/matters', expect.objectContaining({ title: 'New Matter' }));
  });
});

describe('useUpdateMatter', () => {
  it('patches correctly', async () => {
    mockPatch.mockResolvedValueOnce({ success: true, data: { id: 'm1' } });
    const { result } = renderHook(() => useUpdateMatter(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate({ id: 'm1', title: 'Updated' } as never); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPatch).toHaveBeenCalledWith('/matters/m1', { title: 'Updated' });
  });
});

describe('useDeleteMatter', () => {
  it('deletes by id', async () => {
    mockDelete.mockResolvedValueOnce({ success: true });
    const { result } = renderHook(() => useDeleteMatter(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate('m1'); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockDelete).toHaveBeenCalledWith('/matters/m1');
  });
});

describe('useMatterDocuments', () => {
  it('fetches documents for a matter', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: [{ id: 'md1' }] });
    const { result } = renderHook(() => useMatterDocuments('m1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/matters/m1/documents');
  });

  it('is disabled when matterId is null', () => {
    const { result } = renderHook(() => useMatterDocuments(null), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useAddMatterDocument', () => {
  it('posts document to matter', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: { id: 'md2' } });
    const { result } = renderHook(() => useAddMatterDocument(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate({ matterId: 'm1', legalDocumentId: 'd1', role: 'reference' }); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/matters/m1/documents', { legalDocumentId: 'd1', role: 'reference' });
  });
});

describe('useRemoveMatterDocument', () => {
  it('removes document from matter', async () => {
    mockDelete.mockResolvedValueOnce({ success: true });
    const { result } = renderHook(() => useRemoveMatterDocument(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate({ matterId: 'm1', docId: 'md1' }); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockDelete).toHaveBeenCalledWith('/matters/m1/documents/md1');
  });
});
