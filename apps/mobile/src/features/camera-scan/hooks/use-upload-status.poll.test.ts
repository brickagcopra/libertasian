import { renderHook, waitFor } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider, type Query } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import { useOcrResults } from './use-ocr-results';
import { useUploadStatus, useUploadDetail } from './use-upload-status';

/**
 * THE POLL MUST STOP. This is the half of the double-unwrap bug the existing
 * tests could not see.
 *
 * `apiClient.get()` strips the `{ success, data }` envelope, so
 * `query.state.data` IS the status payload. The old code read `.data` off it
 * inside `refetchInterval`, compared `undefined` against 'completed'/'failed',
 * and so returned an interval forever: every scan-result screen kept hitting
 * `/uploads/:id/status` (3s), `/uploads/:id` (5s) and `/uploads/:id/ocr` (4s)
 * for as long as it stayed mounted, on an upload that would never change again.
 *
 * Asserting on the returned value alone cannot catch that — `select` and
 * `refetchInterval` read the cache independently, and the old code was wrong in
 * both places. These tests call the hook's real `refetchInterval` with the
 * query as the cache holds it, which is exactly what React Query passes it.
 */

jest.mock('../../../lib/api-client', () => ({
  apiClient: { get: jest.fn() },
}));

const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;

/** Render `hook` against a fresh cache and return the poll decision it makes. */
async function pollDecisionFor(
  hook: () => { isSuccess: boolean },
  queryKey: unknown[],
) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);

  const { result } = renderHook(hook, { wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));

  const query = qc.getQueryCache().find({ queryKey });
  if (!query) throw new Error(`no cached query for ${JSON.stringify(queryKey)}`);

  const refetchInterval = (
    query as Query & {
      options: { refetchInterval?: (q: Query) => number | false };
    }
  ).options.refetchInterval;
  if (!refetchInterval) throw new Error('hook set no refetchInterval');

  return refetchInterval(query as Query);
}

beforeEach(() => jest.clearAllMocks());

describe('camera-scan polls terminate on a finished upload', () => {
  it('useUploadStatus stops once processing is completed', async () => {
    mockGet.mockResolvedValue({
      processingStatus: 'completed',
      ocrStatus: 'completed',
    });
    // Before the fix this was 3000 — forever.
    await expect(
      pollDecisionFor(() => useUploadStatus('u1'), ['upload-status', 'u1']),
    ).resolves.toBe(false);
  });

  it('useUploadStatus keeps polling while still processing', async () => {
    mockGet.mockResolvedValue({
      processingStatus: 'processing',
      ocrStatus: 'pending',
    });
    // The other direction: a genuinely in-flight upload must still refresh, so
    // the fix cannot be "return false unconditionally".
    await expect(
      pollDecisionFor(() => useUploadStatus('u2'), ['upload-status', 'u2']),
    ).resolves.toBe(3000);
  });

  it('useUploadDetail stops once processing has failed', async () => {
    mockGet.mockResolvedValue({ id: 'u1', processingStatus: 'failed' });
    await expect(
      pollDecisionFor(() => useUploadDetail('u1'), ['upload-detail', 'u1']),
    ).resolves.toBe(false);
  });

  it('useOcrResults stops once OCR is completed', async () => {
    mockGet.mockResolvedValue({ ocrStatus: 'completed', text: 'hello' });
    await expect(
      pollDecisionFor(() => useOcrResults('u1'), ['ocr-results', 'u1']),
    ).resolves.toBe(false);
  });

  it('useOcrResults keeps polling while OCR is still running', async () => {
    mockGet.mockResolvedValue({ ocrStatus: 'processing', text: null });
    await expect(
      pollDecisionFor(() => useOcrResults('u2'), ['ocr-results', 'u2']),
    ).resolves.toBe(4000);
  });
});
