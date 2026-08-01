'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Pause, Play, Sparkles, Volume2, VolumeX } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ApiClientError } from '@/lib/api-client';

import { useAudioRendition } from '../hooks/use-audio-rendition';
import { useReadAlongSegments } from '../hooks/use-readalong-segments';
import type { AudioContentType } from '../types';
import { useReadAlongPublisher } from './read-along-context';

interface AudioPlayerProps {
  contentType: AudioContentType;
  contentId: string;
  title?: string;
  /** Auto-start the Listen flow on mount (used by `?autoplay=1` chaining). */
  autoPlay?: boolean;
  /** Called when narration ends naturally (drives continuous autoplay). */
  onEnded?: () => void;
  /** When provided, renders a "Continue playing" toggle bound to this state. */
  continueToggle?: { enabled: boolean; onChange: (enabled: boolean) => void };
  /** Label on the "Continue playing" toggle. Defaults to the digest wording. */
  continueLabel?: string;
  /**
   * Copy for the 402 upsell. Defaults to the bar-answer wording; the document
   * reader passes its own, because a section 402 means the reader is past their
   * free-document cap, not that narration itself is a Pro feature.
   */
  paywallMessage?: string;
  /**
   * Copy for the terminal `unavailable` state. Defaults to content-neutral
   * wording; the document reader passes section wording.
   */
  unavailableMessage?: string;
}

const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5] as const;

function formatTime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

const DEFAULT_PAYWALL_MESSAGE =
  'Listen with Pro — narrated audio for bar answers.';

const DEFAULT_UNAVAILABLE_MESSAGE = 'Narration isn’t available for this content.';

function PaywallUpsell({ message }: { message: string }) {
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 px-4 py-2.5"
      data-testid="audio-paywall"
    >
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Sparkles className="size-4 text-primary" />
        <span>{message}</span>
      </div>
      <Button variant="outline" size="sm" asChild>
        <Link href="/pricing">See plans</Link>
      </Button>
    </div>
  );
}

/**
 * Compact "Listen" player for a digest or bar answer. Strictly defers the audio
 * fetch until the user clicks Listen (the not-ready call triggers server-side
 * synthesis — a cost guard). While synthesis is pending it shows a spinner and
 * polls; when ready it renders a hidden <audio> + custom transport controls.
 * The inline read-along highlight is rendered by the digest body — this player
 * publishes the manifest segments + playback state via the read-along context.
 */
export function AudioPlayer({
  contentType,
  contentId,
  title,
  autoPlay = false,
  onEnded,
  continueToggle,
  continueLabel = 'Continue playing next digest',
  paywallMessage = DEFAULT_PAYWALL_MESSAGE,
  unavailableMessage = DEFAULT_UNAVAILABLE_MESSAGE,
}: AudioPlayerProps) {
  const [enabled, setEnabled] = useState(autoPlay);
  const queryClient = useQueryClient();
  const audioRef = useRef<HTMLAudioElement>(null);
  // Auto-start playback only once, the first time a rendition becomes ready.
  const autoPlayedRef = useRef(false);

  const { data, isLoading, isError, error, isTakingTooLong, refetch } =
    useAudioRendition({ contentType, contentId, enabled });

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [rate, setRate] = useState(1);

  // Resume state across a fresh signed-URL fetch (expired-URL recovery).
  const resumeRef = useRef<{ atMs: number; wasPlaying: boolean } | null>(null);

  const isPaywalled = error instanceof ApiClientError && error.statusCode === 402;
  const audioUrl = data?.status === 'ready' ? data.audioUrl : null;
  const durationMs = data?.durationMs ?? 0;

  // Inline read-along: fetch the manifest and publish it (plus the <audio>
  // element + play state) to the digest body, which renders the highlight.
  const readalongUrl = data?.status === 'ready' ? data.readalongUrl : null;
  const segments = useReadAlongSegments(readalongUrl);
  const publishReadAlong = useReadAlongPublisher();

  useEffect(() => {
    publishReadAlong({ audioRef, segments, isPlaying });
  }, [publishReadAlong, segments, isPlaying, audioUrl]);

  // Stop driving the inline highlight once the player unmounts.
  useEffect(
    () => () => publishReadAlong({ audioRef: null, segments: null, isPlaying: false }),
    [publishReadAlong],
  );

  // Keep the element's playback rate in sync with the chosen rate.
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = rate;
  }, [rate, audioUrl]);

  // Continuous autoplay: when this player was opened via the chain (`?autoplay=1`),
  // start playing as soon as the rendition is ready — without a manual click.
  useEffect(() => {
    if (!autoPlay || !audioUrl || autoPlayedRef.current) return;
    autoPlayedRef.current = true;
    void audioRef.current?.play().catch(() => undefined);
  }, [autoPlay, audioUrl]);

  const handleError = useCallback(() => {
    const el = audioRef.current;
    // Likely an expired 300s signed URL — remember position, refetch fresh URLs.
    resumeRef.current = {
      atMs: el ? el.currentTime * 1000 : currentMs,
      wasPlaying: isPlaying,
    };
    queryClient.invalidateQueries({
      queryKey: ['audio-rendition', contentType, contentId],
    });
  }, [contentType, contentId, currentMs, isPlaying, queryClient]);

  // After a fresh URL loads, restore the prior position and resume if playing.
  const handleLoadedMetadata = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    el.playbackRate = rate;
    const resume = resumeRef.current;
    if (resume) {
      resumeRef.current = null;
      try {
        el.currentTime = resume.atMs / 1000;
      } catch {
        /* element may not be seekable yet — ignore */
      }
      if (resume.wasPlaying) void el.play().catch(() => undefined);
    }
  }, [rate]);

  const togglePlay = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => undefined);
    else el.pause();
  }, []);

  const handleSeek = useCallback((value: number) => {
    const el = audioRef.current;
    if (el) el.currentTime = value / 1000;
    setCurrentMs(value);
  }, []);

  // --- Render gates -------------------------------------------------------

  if (!enabled) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => setEnabled(true)}
        data-testid="listen-button"
      >
        <Volume2 />
        Listen
      </Button>
    );
  }

  if (isPaywalled) {
    return <PaywallUpsell message={paywallMessage} />;
  }

  /*
   * TERMINAL. `unavailable` is the server saying synthesis will never succeed
   * for this content (e.g. `output_too_large`): it answers 200 and does NOT
   * enqueue. Checked ahead of the pending/loading gates so this can never be
   * mistaken for "still preparing" — that state would spin forever, since
   * `useAudioRendition` only polls while the status is `pending`.
   *
   * No Retry button, deliberately: re-requesting cannot change the outcome, and
   * with TTS on-box at concurrency 1 an invited re-request is pure waste.
   */
  if (data?.status === 'unavailable') {
    return (
      <div
        className="flex items-center gap-2 rounded-lg border bg-muted/30 px-4 py-2.5 text-sm text-muted-foreground"
        data-testid="audio-unavailable"
        data-failure-reason={data.failureReason ?? undefined}
      >
        <VolumeX className="size-4 shrink-0" aria-hidden="true" />
        <span>{unavailableMessage}</span>
      </div>
    );
  }

  if (isTakingTooLong && data?.status === 'pending') {
    return (
      <div
        className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 px-4 py-2.5 text-sm text-muted-foreground"
        data-testid="audio-taking-too-long"
      >
        <span>Narration is taking longer than expected.</span>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  if (isLoading || data?.status === 'pending') {
    return (
      <div
        className="flex items-center gap-2 rounded-lg border bg-muted/30 px-4 py-2.5 text-sm text-muted-foreground"
        data-testid="audio-pending"
      >
        <Loader2 className="size-4 animate-spin" />
        Preparing narration…
      </div>
    );
  }

  if (isError && !isPaywalled) {
    return (
      <div
        className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 px-4 py-2.5 text-sm text-muted-foreground"
        data-testid="audio-error"
      >
        <span>Couldn&apos;t load narration.</span>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  if (data?.status !== 'ready' || !audioUrl) {
    return null;
  }

  return (
    <Card data-testid="audio-player">
      <CardContent className="space-y-3 p-4">
        {/* Hidden media element — controls are fully custom. */}
        <audio
          ref={audioRef}
          src={audioUrl}
          preload="metadata"
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => {
            setIsPlaying(false);
            onEnded?.();
          }}
          onTimeUpdate={(e) => setCurrentMs(e.currentTarget.currentTime * 1000)}
          onLoadedMetadata={handleLoadedMetadata}
          onError={handleError}
          className="hidden"
        />

        <div className="flex items-center gap-3">
          <Button
            variant="default"
            size="icon"
            onClick={togglePlay}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            data-testid="audio-play-toggle"
          >
            {isPlaying ? <Pause /> : <Play />}
          </Button>

          <div className="flex-1">
            {title && (
              <p className="mb-0.5 truncate text-xs font-medium text-foreground">
                {title}
              </p>
            )}
            <input
              type="range"
              min={0}
              max={durationMs || 0}
              value={Math.min(currentMs, durationMs || 0)}
              onChange={(e) => handleSeek(Number(e.target.value))}
              aria-label="Seek"
              data-testid="audio-seek"
              className="h-1.5 w-full cursor-pointer accent-primary"
            />
            <div className="mt-0.5 flex justify-between text-[11px] tabular-nums text-muted-foreground">
              <span data-testid="audio-current-time">{formatTime(currentMs)}</span>
              <span>{formatTime(durationMs)}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Volume2 className="size-3.5" />
            <span>{data.voiceId} · neural</span>
          </div>

          <div className="flex items-center gap-4">
            {continueToggle && (
              <label
                className="flex items-center gap-1.5 text-xs text-muted-foreground"
                data-testid="audio-continue-toggle"
              >
                <input
                  type="checkbox"
                  checked={continueToggle.enabled}
                  onChange={(e) => continueToggle.onChange(e.target.checked)}
                  aria-label={continueLabel}
                  data-testid="audio-continue-checkbox"
                  className="size-3.5 cursor-pointer accent-primary"
                />
                Continue playing
              </label>
            )}
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              Speed
              <select
                value={rate}
                onChange={(e) => setRate(Number(e.target.value))}
                aria-label="Playback speed"
                data-testid="audio-rate"
                className="rounded-md border bg-background px-1.5 py-1 text-xs"
              >
                {PLAYBACK_RATES.map((r) => (
                  <option key={r} value={r}>
                    {r}×
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
