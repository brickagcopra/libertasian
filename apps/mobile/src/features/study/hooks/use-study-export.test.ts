import { renderHook, act, waitFor } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Alert } from 'react-native';
import { apiClient } from '../../../lib/api-client';
import { useExportFlashcardSet, useExportReviewerPack } from './use-study-export';

jest.mock('../../../lib/api-client', () => ({
  apiClient: { getDownloadUrl: jest.fn() },
}));

jest.mock('expo-file-system', () => ({
  cacheDirectory: '/cache/',
  downloadAsync: jest.fn().mockResolvedValue({ status: 200, uri: '/cache/test.pdf' }),
}), { virtual: true });

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn().mockResolvedValue(true),
  shareAsync: jest.fn().mockResolvedValue(undefined),
}), { virtual: true });

jest.spyOn(Alert, 'alert');

const mockGetDownloadUrl = apiClient.getDownloadUrl as jest.MockedFunction<typeof apiClient.getDownloadUrl>;

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => jest.clearAllMocks());

describe('useExportFlashcardSet', () => {
  it('exports as PDF', async () => {
    mockGetDownloadUrl.mockResolvedValueOnce({ url: 'https://api.test/download', headers: {} });
    const { result } = renderHook(() => useExportFlashcardSet(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate({ id: 'fs-1', format: 'pdf' as const, title: 'CrimLaw Set' }); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGetDownloadUrl).toHaveBeenCalledWith('/study/flashcard-sets/fs-1/export', { format: 'pdf' });
  });

  it('exports as DOCX', async () => {
    mockGetDownloadUrl.mockResolvedValueOnce({ url: 'https://api.test/download', headers: {} });
    const { result } = renderHook(() => useExportFlashcardSet(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate({ id: 'fs-1', format: 'docx' as const, title: 'CrimLaw Set' }); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGetDownloadUrl).toHaveBeenCalledWith('/study/flashcard-sets/fs-1/export', { format: 'docx' });
  });

  it('shows alert on error', async () => {
    mockGetDownloadUrl.mockRejectedValueOnce(new Error('Download failed'));
    const { result } = renderHook(() => useExportFlashcardSet(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate({ id: 'fs-1', format: 'pdf' as const, title: 'Test' }); });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(Alert.alert).toHaveBeenCalledWith('Export Failed', 'Download failed');
  });
});

describe('useExportReviewerPack', () => {
  it('exports reviewer pack as PDF', async () => {
    mockGetDownloadUrl.mockResolvedValueOnce({ url: 'https://api.test/download', headers: {} });
    const { result } = renderHook(() => useExportReviewerPack(), { wrapper: createWrapper() });
    await act(async () => { result.current.mutate({ id: 'rp-1', format: 'pdf' as const, title: 'CivLaw Pack' }); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGetDownloadUrl).toHaveBeenCalledWith('/study/reviewer-packs/rp-1/export', { format: 'pdf' });
  });
});
