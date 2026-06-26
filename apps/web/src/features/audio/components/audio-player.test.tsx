import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { renderWithProviders, screen, userEvent } from '@/test/test-utils';

import { AudioPlayer } from './audio-player';
import type { AudioRenditionResponse } from '../types';

const { mockHook } = vi.hoisted(() => ({ mockHook: vi.fn() }));

vi.mock('../hooks/use-audio-rendition', () => ({
  useAudioRendition: (opts: { enabled: boolean }) => mockHook(opts),
}));

type HookReturn = {
  data?: AudioRenditionResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  isTakingTooLong: boolean;
  refetch: () => void;
};

function setHook(value: Partial<HookReturn>) {
  mockHook.mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    isTakingTooLong: false,
    refetch: vi.fn(),
    ...value,
  });
}

const READY: AudioRenditionResponse = {
  status: 'ready',
  audioUrl: 'https://signed.example/audio.mp3',
  marksUrl: 'https://signed.example/marks.ndjson',
  readalongUrl: null,
  durationMs: 65000,
  language: 'en',
  voiceId: 'Matthew',
};

beforeAll(() => {
  // happy-dom does not implement media playback — stub so the element is inert.
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  mockHook.mockReset();
});

describe('AudioPlayer', () => {
  it('does not fetch until the Listen button is clicked', async () => {
    setHook({});
    renderWithProviders(<AudioPlayer contentType="digest" contentId="d1" />);

    // Only the Listen button renders; the hook is called with enabled=false.
    expect(screen.getByTestId('listen-button')).toBeInTheDocument();
    expect(mockHook).toHaveBeenCalledWith({
      contentType: 'digest',
      contentId: 'd1',
      enabled: false,
    });
    expect(mockHook).not.toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true }),
    );

    await userEvent.click(screen.getByTestId('listen-button'));

    // After the click the hook is invoked with enabled=true (fetch starts).
    expect(mockHook).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true }),
    );
  });

  it('shows a preparing spinner while synthesis is pending', async () => {
    setHook({
      data: {
        status: 'pending',
        audioUrl: null,
        marksUrl: null,
        readalongUrl: null,
        durationMs: null,
        language: 'en',
        voiceId: 'Matthew',
      },
    });
    renderWithProviders(<AudioPlayer contentType="digest" contentId="d1" />);

    await userEvent.click(screen.getByTestId('listen-button'));

    expect(screen.getByTestId('audio-pending')).toHaveTextContent(
      /Preparing narration/i,
    );
  });

  it('renders transport controls when the rendition is ready', async () => {
    setHook({ data: READY });
    renderWithProviders(<AudioPlayer contentType="digest" contentId="d1" />);

    await userEvent.click(screen.getByTestId('listen-button'));

    expect(screen.getByTestId('audio-player')).toBeInTheDocument();
    expect(screen.getByTestId('audio-play-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('audio-seek')).toBeInTheDocument();
    expect(screen.getByTestId('audio-rate')).toBeInTheDocument();
    // total duration 65000ms -> 1:05
    expect(screen.getByText('1:05')).toBeInTheDocument();
    expect(screen.getByText(/Matthew · neural/)).toBeInTheDocument();
  });

  it('shows the Pro upsell on a 402 paywall response', async () => {
    const { ApiClientError } = await import('@/lib/api-client');
    setHook({
      isError: true,
      error: new ApiClientError('subscription required', 402, {
        error: 'subscription_required',
      }),
    });
    renderWithProviders(
      <AudioPlayer contentType="bar_exam_answer" contentId="a1" />,
    );

    await userEvent.click(screen.getByTestId('listen-button'));

    expect(screen.getByTestId('audio-paywall')).toBeInTheDocument();
  });
});
