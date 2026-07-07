import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router } from 'expo-router';

import { ApiClientError } from '../../../lib/api-client';
import { AudioPlayerBar } from './AudioPlayerBar';
import type { AudioRenditionReadModel } from '../types';

const mockUseAudioRendition = jest.fn();

jest.mock('../hooks/use-audio-rendition', () => ({
  useAudioRendition: (opts: unknown) => mockUseAudioRendition(opts),
  audioRenditionQueryKey: (t: string, i: string) => ['audio-rendition', t, i],
}));

const READY: AudioRenditionReadModel = {
  status: 'ready',
  audioUrl: 'https://s3.example.com/audio.mp3?sig=abc',
  marksUrl: null,
  readalongUrl: null,
  durationMs: 90_000,
  language: 'en',
  voiceId: 'Ruth',
};

function baseHookResult(overrides: Record<string, unknown> = {}) {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    isTakingTooLong: false,
    refetch: jest.fn(),
    ...overrides,
  };
}

function renderPlayer() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <AudioPlayerBar contentType="bar_exam_answer" contentId="a1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseAudioRendition.mockReturnValue(baseHookResult());
});

describe('AudioPlayerBar', () => {
  it('renders only a Listen button and never fetches until tapped', () => {
    renderPlayer();
    expect(screen.getByTestId('listen-button')).toBeTruthy();
    expect(mockUseAudioRendition).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false }),
    );
  });

  it('enables the rendition fetch on first Listen tap', () => {
    renderPlayer();
    fireEvent.press(screen.getByTestId('listen-button'));
    expect(mockUseAudioRendition).toHaveBeenLastCalledWith(
      expect.objectContaining({
        contentType: 'bar_exam_answer',
        contentId: 'a1',
        enabled: true,
      }),
    );
  });

  it('shows the pending spinner while synthesis is in flight', () => {
    mockUseAudioRendition.mockReturnValue(
      baseHookResult({
        data: { ...READY, status: 'pending', audioUrl: null },
      }),
    );
    renderPlayer();
    fireEvent.press(screen.getByTestId('listen-button'));
    expect(screen.getByTestId('audio-pending')).toBeTruthy();
  });

  it('shows the taking-too-long state with a Retry action', () => {
    const refetch = jest.fn();
    mockUseAudioRendition.mockReturnValue(
      baseHookResult({
        data: { ...READY, status: 'pending', audioUrl: null },
        isTakingTooLong: true,
        refetch,
      }),
    );
    renderPlayer();
    fireEvent.press(screen.getByTestId('listen-button'));
    expect(screen.getByTestId('audio-taking-too-long')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Retry'));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('renders the Pro upsell on a 402 and routes to /subscription', () => {
    mockUseAudioRendition.mockReturnValue(
      baseHookResult({
        isError: true,
        error: new ApiClientError(402, 'subscription_required'),
      }),
    );
    renderPlayer();
    fireEvent.press(screen.getByTestId('listen-button'));
    expect(screen.getByTestId('audio-paywall')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('See plans'));
    expect(router.push).toHaveBeenCalledWith('/subscription');
  });

  it('renders a retryable error state for non-402 failures', () => {
    const refetch = jest.fn();
    mockUseAudioRendition.mockReturnValue(
      baseHookResult({
        isError: true,
        error: new ApiClientError(500, 'boom'),
        refetch,
      }),
    );
    renderPlayer();
    fireEvent.press(screen.getByTestId('listen-button'));
    expect(screen.getByTestId('audio-error')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Retry'));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('renders the transport (play toggle, seek, duration, rate) when ready', async () => {
    mockUseAudioRendition.mockReturnValue(baseHookResult({ data: READY }));
    renderPlayer();
    fireEvent.press(screen.getByTestId('listen-button'));

    await waitFor(() => expect(screen.getByTestId('audio-player')).toBeTruthy());
    expect(screen.getByTestId('audio-play-toggle')).toBeTruthy();
    expect(screen.getByTestId('audio-seek')).toBeTruthy();
    expect(screen.getByText('1:30')).toBeTruthy(); // 90s duration
    expect(screen.getByTestId('audio-rate')).toBeTruthy();

    // Rate selector cycles 1 → 1.25.
    fireEvent.press(screen.getByTestId('audio-rate'));
    expect(screen.getByText('1.25×')).toBeTruthy();
  });
});
