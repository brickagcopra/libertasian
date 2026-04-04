import { renderHook, waitFor, act } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import {
  useReviewerPacks, useReviewerPack,
  useCreateReviewerPack, useUpdateReviewerPack, useDeleteReviewerPack,
  useAddReviewerPackItem, useUpdateReviewerPackItem, useDeleteReviewerPackItem,
} from './use-reviewer-packs';

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

const mockList = { data: [{ id: 'p1', title: 'Pack A' }], meta: { hasNext: false } };
const mockPack = { id: 'p1', title: 'Pack A', items: [] };

beforeEach(() => jest.clearAllMocks());

describe('useReviewerPacks', () => {
  it('fetches list with default params', async () => {
    mockGet.mockResolvedValueOnce(mockList);
    const { result } = renderHook(() => useReviewerPacks(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/study/reviewer-packs', { params: {} });
  });

  it('passes filter params', async () => {
    mockGet.mockResolvedValueOnce(mockList);
    renderHook(() => useReviewerPacks({ barSubject: 'civil_law', limit: 5 }), { wrapper: createWrapper() });
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(mockGet).toHaveBeenCalledWith('/study/reviewer-packs', { params: { barSubject: 'civil_law', limit: '5' } });
  });
});

describe('useReviewerPack', () => {
  it('fetches single pack', async () => {
    mockGet.mockResolvedValueOnce(mockPack);
    const { result } = renderHook(() => useReviewerPack('p1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/study/reviewer-packs/p1');
  });

  it('is disabled when id is empty', () => {
    const { result } = renderHook(() => useReviewerPack(''), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useCreateReviewerPack', () => {
  it('posts correctly', async () => {
    mockPost.mockResolvedValueOnce({ id: 'p2', title: 'New' });
    const { result } = renderHook(() => useCreateReviewerPack(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate({ title: 'New', barSubject: 'civil_law', visibility: 'private' }); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/study/reviewer-packs', expect.objectContaining({ title: 'New' }));
  });
});

describe('useUpdateReviewerPack', () => {
  it('patches correctly', async () => {
    mockPatch.mockResolvedValueOnce({ id: 'p1', title: 'Updated' });
    const { result } = renderHook(() => useUpdateReviewerPack('p1'), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate({ title: 'Updated' }); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPatch).toHaveBeenCalledWith('/study/reviewer-packs/p1', { title: 'Updated' });
  });
});

describe('useDeleteReviewerPack', () => {
  it('deletes correctly', async () => {
    mockDelete.mockResolvedValueOnce({ success: true });
    const { result } = renderHook(() => useDeleteReviewerPack(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate('p1'); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockDelete).toHaveBeenCalledWith('/study/reviewer-packs/p1');
  });
});

describe('useAddReviewerPackItem', () => {
  it('posts item to pack', async () => {
    mockPost.mockResolvedValueOnce({ id: 'i1', packId: 'p1' });
    const { result } = renderHook(() => useAddReviewerPackItem('p1'), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate({ entityType: 'document', entityId: 'd1' }); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/study/reviewer-packs/p1/items', expect.objectContaining({ entityType: 'document' }));
  });
});

describe('useUpdateReviewerPackItem', () => {
  it('patches item', async () => {
    mockPatch.mockResolvedValueOnce({ id: 'i1' });
    const { result } = renderHook(() => useUpdateReviewerPackItem('p1'), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate({ id: 'i1', input: { notes: 'Updated' } }); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPatch).toHaveBeenCalledWith('/study/reviewer-pack-items/i1', { notes: 'Updated' });
  });
});

describe('useDeleteReviewerPackItem', () => {
  it('deletes item', async () => {
    mockDelete.mockResolvedValueOnce({ success: true });
    const { result } = renderHook(() => useDeleteReviewerPackItem('p1'), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate('i1'); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockDelete).toHaveBeenCalledWith('/study/reviewer-pack-items/i1');
  });
});
