import { renderHook, waitFor, act } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import { useNotes, useNote, useCreateNote, useUpdateNote, useDeleteNote } from './use-notes';

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

describe('useNotes', () => {
  it('fetches with default params', async () => {
    mockGet.mockResolvedValueOnce({ data: [{ id: 'n1' }], meta: { hasNext: false } });
    const { result } = renderHook(() => useNotes(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/notes', { params: {} });
  });

  it('passes filters', async () => {
    mockGet.mockResolvedValueOnce({ data: [], meta: { hasNext: false } });
    renderHook(() => useNotes({ matterId: 'm1', visibility: 'private', search: 'test' }), { wrapper: createWrapper() });
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(mockGet).toHaveBeenCalledWith('/notes', { params: { matterId: 'm1', visibility: 'private', search: 'test' } });
  });
});

describe('useNote', () => {
  it('fetches single note', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: { id: 'n1', title: 'Note A' } });
    const { result } = renderHook(() => useNote('n1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/notes/n1');
  });

  it('is disabled when id is null', () => {
    const { result } = renderHook(() => useNote(null), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useCreateNote', () => {
  it('posts correctly', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: { id: 'n2' } });
    const { result } = renderHook(() => useCreateNote(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate({ title: 'New Note', body: {} } as never); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/notes', expect.objectContaining({ title: 'New Note' }));
  });
});

describe('useUpdateNote', () => {
  it('patches correctly', async () => {
    mockPatch.mockResolvedValueOnce({ success: true, data: { id: 'n1' } });
    const { result } = renderHook(() => useUpdateNote(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate({ id: 'n1', title: 'Updated' } as never); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPatch).toHaveBeenCalledWith('/notes/n1', { title: 'Updated' });
  });
});

describe('useDeleteNote', () => {
  it('deletes by id', async () => {
    mockDelete.mockResolvedValueOnce({ success: true });
    const { result } = renderHook(() => useDeleteNote(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate('n1'); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockDelete).toHaveBeenCalledWith('/notes/n1');
  });
});
