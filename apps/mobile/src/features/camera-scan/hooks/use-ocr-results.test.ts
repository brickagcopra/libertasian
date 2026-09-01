import { renderHook, waitFor } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import { useOcrResults } from './use-ocr-results';

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

describe('useOcrResults', () => {
  it('fetches OCR results', async () => {
    // apiClient returns the UNWRAPPED body — unwrapEnvelope already ran.
    mockGet.mockResolvedValueOnce({ ocrStatus: 'completed', text: 'Extracted text' });
    const { result } = renderHook(() => useOcrResults('u1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/uploads/u1/ocr');
    expect(result.current.data?.ocrStatus).toBe('completed');
  });

  it('is disabled when uploadId is null', () => {
    const { result } = renderHook(() => useOcrResults(null), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('is disabled when enabled=false', () => {
    const { result } = renderHook(() => useOcrResults('u1', false), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('handles errors', async () => {
    mockGet.mockRejectedValueOnce(new Error('fail'));
    const { result } = renderHook(() => useOcrResults('u1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
