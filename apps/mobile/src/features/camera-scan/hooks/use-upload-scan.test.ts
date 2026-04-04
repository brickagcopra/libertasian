import { renderHook, waitFor, act } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import { useUploadScan } from './use-upload-scan';

jest.mock('../../../lib/api-client', () => ({
  apiClient: { uploadMultipart: jest.fn() },
}));

jest.mock('../../../lib/constants', () => ({
  IMAGE_UPLOAD: { MAX_SIZE: 20 * 1024 * 1024, ALLOWED_TYPES: ['image/jpeg'] },
}));

const mockUpload = apiClient.uploadMultipart as jest.MockedFunction<typeof apiClient.uploadMultipart>;

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => jest.clearAllMocks());

describe('useUploadScan', () => {
  it('uploads camera scan via multipart', async () => {
    mockUpload.mockResolvedValueOnce({ data: { id: 'u1', processingStatus: 'pending' } });
    const { result } = renderHook(() => useUploadScan(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate({
        pages: [{ id: 'p1', uri: 'file:///scan.jpg' }] as never,
        captureMode: 'single_page' as never,
        privacyLevel: 'private' as never,
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockUpload).toHaveBeenCalledWith('/uploads/camera-scan', expect.any(FormData), expect.anything());
  });

  it('handles upload errors', async () => {
    mockUpload.mockRejectedValueOnce(new Error('Upload failed'));
    const { result } = renderHook(() => useUploadScan(), { wrapper: createWrapper() });

    await act(async () => {
      result.current.mutate({
        pages: [{ id: 'p1', uri: 'file:///scan.jpg' }] as never,
        captureMode: 'single_page' as never,
        privacyLevel: 'private' as never,
      });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
