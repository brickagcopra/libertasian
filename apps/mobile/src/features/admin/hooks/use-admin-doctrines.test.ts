import { renderHook, waitFor, act } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import {
  useAdminDoctrines, useAdminDoctrineDetail,
  useApproveDoctrine, useRejectDoctrine, useExtractDoctrines,
} from './use-admin-doctrines';

jest.mock('../../../lib/api-client', () => ({
  apiClient: { get: jest.fn(), post: jest.fn() },
}));

const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;
const mockPost = apiClient.post as jest.MockedFunction<typeof apiClient.post>;

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => jest.clearAllMocks());

describe('useAdminDoctrines', () => {
  it('fetches list with no filters', async () => {
    mockGet.mockResolvedValueOnce({ data: [{ id: 'dc1' }], meta: { hasNext: false, limit: 20 } });
    const { result } = renderHook(() => useAdminDoctrines(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/admin/doctrines', { params: {} });
  });

  it('passes filters', async () => {
    mockGet.mockResolvedValueOnce({ data: [], meta: { hasNext: false, limit: 20 } });
    renderHook(
      () => useAdminDoctrines({ doctrineType: 'stare_decisis', reviewStatus: 'pending' }),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(mockGet).toHaveBeenCalledWith('/admin/doctrines', {
      params: { doctrineType: 'stare_decisis', reviewStatus: 'pending' },
    });
  });

  it('transforms response', async () => {
    mockGet.mockResolvedValueOnce({ data: [{ id: 'dc1' }], meta: { hasNext: true, nextCursor: 'c1', limit: 20 } });
    const { result } = renderHook(() => useAdminDoctrines(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      items: [{ id: 'dc1' }],
      meta: { hasNext: true, nextCursor: 'c1', limit: 20 },
    });
  });
});

describe('useAdminDoctrineDetail', () => {
  it('fetches single doctrine', async () => {
    mockGet.mockResolvedValueOnce({ success: true, data: { id: 'dc1', name: 'Res Judicata' } });
    const { result } = renderHook(() => useAdminDoctrineDetail('dc1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/admin/doctrines/dc1');
  });

  it('is disabled when id is empty', () => {
    const { result } = renderHook(() => useAdminDoctrineDetail(''), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useApproveDoctrine', () => {
  it('posts approve', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: { id: 'dc1', reviewStatus: 'approved' } });
    const { result } = renderHook(() => useApproveDoctrine(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate('dc1'); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/admin/doctrines/dc1/approve');
  });
});

describe('useRejectDoctrine', () => {
  it('posts reject', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: { id: 'dc1', reviewStatus: 'rejected' } });
    const { result } = renderHook(() => useRejectDoctrine(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate('dc1'); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/admin/doctrines/dc1/reject');
  });
});

describe('useExtractDoctrines', () => {
  it('posts extraction request', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: { documentId: 'ld1', doctrinesExtracted: 5, status: 'queued' } });
    const { result } = renderHook(() => useExtractDoctrines(), { wrapper: createWrapper() });
    await act(async () => {
      result.current.mutate({ legalDocumentId: 'ld1', strategy: 'comprehensive' });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/admin/doctrines/extract', {
      documentId: 'ld1', strategy: 'comprehensive',
    });
  });

  it('works without optional strategy', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: { documentId: 'ld1', doctrinesExtracted: 3, status: 'queued' } });
    const { result } = renderHook(() => useExtractDoctrines(), { wrapper: createWrapper() });
    await act(async () => {
      result.current.mutate({ legalDocumentId: 'ld1' });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/admin/doctrines/extract', {
      documentId: 'ld1', strategy: undefined,
    });
  });
});
