import { act, renderHook, waitFor } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { apiClient, ApiClientError } from '../../../lib/api-client';
import { useAudioRendition } from './use-audio-rendition';
import type { AudioRenditionReadModel } from '../types';

jest.mock('../../../lib/api-client', () => {
  const actual = jest.requireActual('../../../lib/api-client');
  return { ...actual, apiClient: { get: jest.fn() } };
});

const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;

const PENDING: AudioRenditionReadModel = {
  status: 'pending',
  audioUrl: null,
  marksUrl: null,
  readalongUrl: null,
  durationMs: null,
  language: 'en',
  voiceId: 'Ruth',
};

const READY: AudioRenditionReadModel = {
  status: 'ready',
  audioUrl: 'https://s3.example.com/audio.mp3?sig=abc',
  marksUrl: 'https://s3.example.com/marks.ndjson?sig=abc',
  readalongUrl: 'https://s3.example.com/readalong.json?sig=abc',
  durationMs: 123_000,
  language: 'en',
  voiceId: 'Ruth',
};

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => jest.clearAllMocks());

afterEach(() => {
  jest.useRealTimers();
});

describe('useAudioRendition', () => {
  it('does NOT fetch when enabled=false (first GET triggers paid TTS synthesis)', () => {
    const { result } = renderHook(
      () =>
        useAudioRendition({
          contentType: 'digest',
          contentId: 'd1',
          enabled: false,
        }),
      { wrapper: createWrapper() },
    );
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('fetches the rendition with language=en once enabled', async () => {
    mockGet.mockResolvedValueOnce(READY);
    const { result } = renderHook(
      () =>
        useAudioRendition({
          contentType: 'digest',
          contentId: 'd1',
          enabled: true,
        }),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/audio/digest/d1', {
      params: { language: 'en' },
    });
    expect(result.current.data?.audioUrl).toBe(READY.audioUrl);
    expect(result.current.isTakingTooLong).toBe(false);
  });

  it('url-encodes the content id', async () => {
    mockGet.mockResolvedValueOnce(READY);
    renderHook(
      () =>
        useAudioRendition({
          contentType: 'bar_exam_answer',
          contentId: 'a/1',
          enabled: true,
        }),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(mockGet).toHaveBeenCalledWith('/audio/bar_exam_answer/a%2F1', {
      params: { language: 'en' },
    });
  });

  it('polls every 3s while pending, then stops once ready', async () => {
    jest.useFakeTimers();
    mockGet.mockResolvedValueOnce(PENDING).mockResolvedValueOnce(READY);

    const { result } = renderHook(
      () =>
        useAudioRendition({
          contentType: 'digest',
          contentId: 'd1',
          enabled: true,
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.data?.status).toBe('pending'));
    expect(mockGet).toHaveBeenCalledTimes(1);

    // First poll tick → second fetch resolves ready.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(3_100);
    });
    await waitFor(() => expect(result.current.data?.status).toBe('ready'));
    expect(mockGet).toHaveBeenCalledTimes(2);

    // Ready → no further polling.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10_000);
    });
    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(result.current.isTakingTooLong).toBe(false);
  });

  it('flags isTakingTooLong after ~60s of pending and stops polling', async () => {
    jest.useFakeTimers();
    mockGet.mockResolvedValue(PENDING);

    const { result } = renderHook(
      () =>
        useAudioRendition({
          contentType: 'digest',
          contentId: 'd1',
          enabled: true,
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.data?.status).toBe('pending'));
    expect(result.current.isTakingTooLong).toBe(false);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(61_000);
    });
    expect(result.current.isTakingTooLong).toBe(true);

    const callsAtTimeout = mockGet.mock.calls.length;
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10_000);
    });
    expect(mockGet.mock.calls.length).toBe(callsAtTimeout);
  });

  it('surfaces a 402 paywall as a terminal error without retrying', async () => {
    mockGet.mockRejectedValueOnce(new ApiClientError(402, 'subscription_required'));
    const { result } = renderHook(
      () =>
        useAudioRendition({
          contentType: 'bar_exam_answer',
          contentId: 'a1',
          enabled: true,
        }),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiClientError);
    expect((result.current.error as ApiClientError).statusCode).toBe(402);
    expect(mockGet).toHaveBeenCalledTimes(1);
  });
});
