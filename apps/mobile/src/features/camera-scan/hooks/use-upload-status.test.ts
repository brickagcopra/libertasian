import { renderHook, waitFor } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import { useUploadStatus, useUploadDetail } from './use-upload-status';

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

describe('useUploadStatus', () => {
  it('fetches upload status', async () => {
    mockGet.mockResolvedValueOnce({ data: { processingStatus: 'completed', ocrStatus: 'completed' } });
    const { result } = renderHook(() => useUploadStatus('u1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/uploads/u1/status');
    expect(result.current.data?.processingStatus).toBe('completed');
  });

  it('is disabled when uploadId is null', () => {
    const { result } = renderHook(() => useUploadStatus(null), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('is disabled when enabled=false', () => {
    const { result } = renderHook(() => useUploadStatus('u1', false), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useUploadDetail', () => {
  it('fetches upload detail', async () => {
    mockGet.mockResolvedValueOnce({ data: { id: 'u1', originalFilename: 'scan.jpg', processingStatus: 'completed' } });
    const { result } = renderHook(() => useUploadDetail('u1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/uploads/u1');
    expect(result.current.data?.id).toBe('u1');
  });

  it('is disabled when uploadId is null', () => {
    const { result } = renderHook(() => useUploadDetail(null), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});
