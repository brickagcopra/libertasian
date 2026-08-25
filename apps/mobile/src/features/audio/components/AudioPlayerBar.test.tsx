import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Audio } from 'expo-av';
import { router } from 'expo-router';

import { ApiClientError } from '../../../lib/api-client';
import { AudioPlayerBar } from './AudioPlayerBar';
import type { AudioRenditionReadModel } from '../types';

const mockUseAudioRendition = jest.fn();

jest.mock('../hooks/use-audio-rendition', () => ({
  useAudioRendition: (opts: unknown) => mockUseAudioRendition(opts),
  audioRenditionQueryKey: (t: string, i: string) => ['audio-rendition', t, i],
}));

/** The expo-av stub from src/test/setup.ts; its 3rd arg is the status callback. */
const createAsync = Audio.Sound.createAsync as jest.Mock;

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

function renderPlayer(props: Partial<React.ComponentProps<typeof AudioPlayerBar>> = {}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <AudioPlayerBar contentType="bar_exam_answer" contentId="a1" {...props} />
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

  it('states the content is not included on a 402, with no purchase action', () => {
    mockUseAudioRendition.mockReturnValue(
      baseHookResult({
        isError: true,
        error: new ApiClientError(402, 'subscription_required'),
      }),
    );
    renderPlayer();
    fireEvent.press(screen.getByTestId('listen-button'));
    expect(screen.getByTestId('audio-paywall')).toBeTruthy();
    expect(
      screen.getByText("Narration isn't available right now."),
    ).toBeTruthy();

    // The purchase button routed to a screen that sold. A route to a
    // purchase is itself an entry point under Apple 3.1.1 / Play Payments,
    // so the notice now states the fact and offers nothing — and names no
    // tier, since there is nothing to sell at all.
    expect(screen.queryByLabelText('See plans')).toBeNull();
    expect(router.push).not.toHaveBeenCalled();
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

  describe('terminal `unavailable` state', () => {
    const UNAVAILABLE: AudioRenditionReadModel = {
      ...READY,
      status: 'unavailable',
      audioUrl: null,
      durationMs: null,
      failureReason: 'output_too_large',
    };

    it('renders a terminal notice — not the pending state, and with no Retry', () => {
      mockUseAudioRendition.mockReturnValue(baseHookResult({ data: UNAVAILABLE }));
      renderPlayer();
      fireEvent.press(screen.getByTestId('listen-button'));

      expect(screen.getByTestId('audio-unavailable')).toBeTruthy();
      // Before this branch existed, `unavailable` fell through to `return null`
      // and the player silently vanished.
      expect(screen.queryByTestId('audio-pending')).toBeNull();
      // Re-requesting cannot change the outcome, so no Retry is offered.
      expect(screen.queryByLabelText('Retry')).toBeNull();
    });

    it('is checked ahead of the loading gate, which would spin forever', () => {
      // `useAudioRendition` polls only while the status is `pending`.
      mockUseAudioRendition.mockReturnValue(
        baseHookResult({ data: UNAVAILABLE, isLoading: true }),
      );
      renderPlayer();
      fireEvent.press(screen.getByTestId('listen-button'));

      expect(screen.getByTestId('audio-unavailable')).toBeTruthy();
      expect(screen.queryByTestId('audio-pending')).toBeNull();
    });

    it('uses the caller-supplied copy', () => {
      mockUseAudioRendition.mockReturnValue(baseHookResult({ data: UNAVAILABLE }));
      renderPlayer({ unavailableMessage: 'Narration isn’t available for this section.' });
      fireEvent.press(screen.getByTestId('listen-button'));

      expect(screen.getByText('Narration isn’t available for this section.')).toBeTruthy();
    });
  });

  describe('autoStart', () => {
    it('skips the internal Listen gate and fetches immediately', () => {
      mockUseAudioRendition.mockReturnValue(baseHookResult({ data: READY }));
      renderPlayer({ autoStart: true });

      // The section button in the reader is the user intent; a second Listen
      // inside the bar would be a dead end.
      expect(screen.queryByTestId('listen-button')).toBeNull();
      expect(mockUseAudioRendition).toHaveBeenLastCalledWith(
        expect.objectContaining({ enabled: true }),
      );
    });

    it('starts playback on load', async () => {
      mockUseAudioRendition.mockReturnValue(baseHookResult({ data: READY }));
      renderPlayer({ autoStart: true });

      await waitFor(() => expect(createAsync).toHaveBeenCalled());
      expect(createAsync.mock.calls[0][1]).toEqual(
        expect.objectContaining({ shouldPlay: true }),
      );
    });

    it('does not auto-start when the caller did not ask for it', async () => {
      mockUseAudioRendition.mockReturnValue(baseHookResult({ data: READY }));
      renderPlayer();
      fireEvent.press(screen.getByTestId('listen-button'));

      await waitFor(() => expect(createAsync).toHaveBeenCalled());
      expect(createAsync.mock.calls[0][1]).toEqual(
        expect.objectContaining({ shouldPlay: false }),
      );
    });
  });

  it('fires onEnded when narration finishes naturally', async () => {
    const onEnded = jest.fn();
    mockUseAudioRendition.mockReturnValue(baseHookResult({ data: READY }));
    renderPlayer({ autoStart: true, onEnded });

    await waitFor(() => expect(createAsync).toHaveBeenCalled());
    const onStatus = createAsync.mock.calls[0][2] as (s: unknown) => void;

    act(() => {
      onStatus({
        isLoaded: true,
        isPlaying: false,
        positionMillis: 90_000,
        durationMillis: 90_000,
        didJustFinish: true,
      });
    });

    expect(onEnded).toHaveBeenCalledTimes(1);
  });
});
