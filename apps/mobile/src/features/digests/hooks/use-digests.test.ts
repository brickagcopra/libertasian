import { renderHook, waitFor, act } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import { useDigests, useDigest, useGenerateDigest } from './use-digests';

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

describe('useDigests', () => {
  it('fetches list with no filters', async () => {
    mockGet.mockResolvedValueOnce({ data: [{ id: 'd1' }], meta: { hasNext: false } });
    const { result } = renderHook(() => useDigests(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/digests', { params: {} });
  });

  it('passes filters', async () => {
    mockGet.mockResolvedValueOnce({ data: [], meta: { hasNext: false } });
    renderHook(
      () => useDigests({ digestType: 'full', reviewStatus: 'approved', legalDocumentId: 'ld1' }),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(mockGet).toHaveBeenCalledWith('/digests', {
      params: { digestType: 'full', reviewStatus: 'approved', legalDocumentId: 'ld1' },
    });
  });
});

describe('useDigest', () => {
  it('fetches single digest', async () => {
    mockGet.mockResolvedValueOnce({ id: 'd1', status: 'completed' });
    const { result } = renderHook(() => useDigest('d1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/digests/d1');
  });

  it('is disabled when id is empty', () => {
    const { result } = renderHook(() => useDigest(''), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('is disabled when enabled is false', () => {
    const { result } = renderHook(() => useDigest('d1', false), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useGenerateDigest', () => {
  it('posts correctly', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: { id: 'd2' } });
    const { result } = renderHook(() => useGenerateDigest(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate({ legalDocumentId: 'ld1' }); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/digests/generate', { legalDocumentId: 'ld1' });
  });

  it('includes optional digestType', async () => {
    mockPost.mockResolvedValueOnce({ success: true, data: { id: 'd3' } });
    const { result } = renderHook(() => useGenerateDigest(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate({ legalDocumentId: 'ld1', digestType: 'summary' }); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/digests/generate', { legalDocumentId: 'ld1', digestType: 'summary' });
  });
});
