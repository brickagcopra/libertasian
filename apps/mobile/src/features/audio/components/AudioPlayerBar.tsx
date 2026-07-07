import { Ionicons } from '@expo/vector-icons';
import { Audio, type AVPlaybackStatus } from 'expo-av';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useQueryClient } from '@tanstack/react-query';

import { ApiClientError } from '../../../lib/api-client';
import { useTheme } from '@/providers/theme-provider';
import {
  audioRenditionQueryKey,
  useAudioRendition,
} from '../hooks/use-audio-rendition';
import {
  claimAudioFocus,
  ensureAudioMode,
  releaseAudioFocus,
  type AudioFocusHandle,
} from '../lib/audio-session';
import type { AudioContentType } from '../types';

interface AudioPlayerBarProps {
  contentType: AudioContentType;
  contentId: string;
  /** Optional label shown above the seek bar in the ready transport. */
  title?: string;
}

const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5] as const;

/** Auto-recoveries closer together than this are treated as a hard failure. */
const RECOVERY_COOLDOWN_MS = 8_000;

function formatTime(ms: number): string {
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0;
  const totalSeconds = Math.floor(safe / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

interface SeekBarProps {
  positionMs: number;
  durationMs: number;
  onSeek: (ms: number) => void;
  trackColor: string;
  fillColor: string;
}

/**
 * Dependency-free seek slider: a pan-responder track (tap or drag to seek).
 * Avoids pulling in another native module alongside expo-av.
 */
function SeekBar({ positionMs, durationMs, onSeek, trackColor, fillColor }: SeekBarProps) {
  const widthRef = useRef(0);
  const durationRef = useRef(durationMs);
  durationRef.current = durationMs;
  const onSeekRef = useRef(onSeek);
  onSeekRef.current = onSeek;

  const seekFromX = useCallback((x: number) => {
    const width = widthRef.current;
    const duration = durationRef.current;
    if (width <= 0 || duration <= 0) return;
    const ratio = Math.max(0, Math.min(1, x / width));
    onSeekRef.current(Math.round(ratio * duration));
  }, []);

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => seekFromX(evt.nativeEvent.locationX),
      onPanResponderMove: (evt) => seekFromX(evt.nativeEvent.locationX),
    }),
  ).current;

  const ratio = durationMs > 0 ? Math.max(0, Math.min(1, positionMs / durationMs)) : 0;

  return (
    <View
      {...responder.panHandlers}
      onLayout={(e) => {
        widthRef.current = e.nativeEvent.layout.width;
      }}
      accessibilityRole="adjustable"
      accessibilityLabel="Seek"
      testID="audio-seek"
      style={styles.seekHitArea}
    >
      <View style={[styles.seekTrack, { backgroundColor: trackColor }]}>
        <View
          style={[styles.seekFill, { width: `${ratio * 100}%`, backgroundColor: fillColor }]}
        />
      </View>
    </View>
  );
}

/**
 * Mobile "Listen" player for a digest or bar answer. Ports the web player at
 * apps/web/src/features/audio/components/audio-player.tsx (playback only —
 * read-along highlighting is a follow-up).
 *
 * Strictly defers the audio fetch until the user taps Listen: the first
 * not-ready GET enqueues paid TTS synthesis server-side, so fetching on mount
 * would silently spend money. While synthesis is pending it shows a spinner
 * and polls; when ready it streams the presigned S3 URL with expo-av (no auth
 * header — the URL itself is the credential, TTL 300s).
 *
 * Signed-URL expiry recovery: if playback errors mid-stream we remember the
 * position, invalidate + refetch the rendition (fresh URLs), reload the sound
 * at the saved position, and resume if it was playing.
 */
export function AudioPlayerBar({ contentType, contentId, title }: AudioPlayerBarProps) {
  const { theme } = useTheme();
  const queryClient = useQueryClient();

  const [enabled, setEnabled] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [soundDurationMs, setSoundDurationMs] = useState(0);
  const [rate, setRate] = useState<number>(1);
  const [playbackError, setPlaybackError] = useState(false);

  const soundRef = useRef<Audio.Sound | null>(null);
  const rateRef = useRef(1);
  const positionRef = useRef(0);
  const isPlayingRef = useRef(false);
  // Resume state carried across a fresh signed-URL fetch (expired-URL recovery).
  const resumeRef = useRef<{ atMs: number; wasPlaying: boolean } | null>(null);
  const recoveringRef = useRef(false);
  const lastRecoveryAtRef = useRef(0);

  const { data, isLoading, isError, error, isTakingTooLong, refetch } = useAudioRendition({
    contentType,
    contentId,
    enabled,
  });

  const isPaywalled = error instanceof ApiClientError && error.statusCode === 402;
  const audioUrl = data?.status === 'ready' ? data.audioUrl : null;
  const durationMs = soundDurationMs || data?.durationMs || 0;

  const focusHandleRef = useRef<AudioFocusHandle | null>(null);
  if (focusHandleRef.current == null) {
    focusHandleRef.current = {
      pause: () => {
        void soundRef.current?.pauseAsync().catch(() => undefined);
      },
    };
  }
  const focusHandle = focusHandleRef.current;

  const recoverFromPlaybackError = useCallback(() => {
    if (recoveringRef.current) return;
    const now = Date.now();
    if (now - lastRecoveryAtRef.current < RECOVERY_COOLDOWN_MS) {
      // Two failures back to back — not an expired URL. Surface a retry UI.
      setPlaybackError(true);
      setIsPlaying(false);
      return;
    }
    lastRecoveryAtRef.current = now;
    recoveringRef.current = true;
    resumeRef.current = {
      atMs: positionRef.current,
      wasPlaying: isPlayingRef.current,
    };
    // Fresh signed URLs; the load effect below reloads + resumes on new data.
    void queryClient.invalidateQueries({
      queryKey: audioRenditionQueryKey(contentType, contentId),
    });
  }, [contentType, contentId, queryClient]);

  const handleStatus = useCallback(
    (status: AVPlaybackStatus) => {
      if (!status.isLoaded) {
        if (status.error) recoverFromPlaybackError();
        return;
      }
      isPlayingRef.current = status.isPlaying;
      positionRef.current = status.positionMillis;
      setIsPlaying(status.isPlaying);
      setPositionMs(status.positionMillis);
      if (typeof status.durationMillis === 'number') {
        setSoundDurationMs(status.durationMillis);
      }
      if (status.didJustFinish) {
        isPlayingRef.current = false;
        setIsPlaying(false);
      }
    },
    [recoverFromPlaybackError],
  );

  // (Re)load the sound whenever a (fresh) signed URL arrives.
  useEffect(() => {
    if (!audioUrl) return;
    let cancelled = false;

    const load = async () => {
      await ensureAudioMode();

      const previous = soundRef.current;
      soundRef.current = null;
      if (previous) {
        previous.setOnPlaybackStatusUpdate(null);
        await previous.unloadAsync().catch(() => undefined);
      }

      const resume = resumeRef.current;
      resumeRef.current = null;

      try {
        const { sound } = await Audio.Sound.createAsync(
          { uri: audioUrl },
          {
            shouldPlay: resume?.wasPlaying ?? false,
            positionMillis: resume?.atMs ?? 0,
            rate: rateRef.current,
            shouldCorrectPitch: true,
            progressUpdateIntervalMillis: 250,
          },
          handleStatus,
        );
        if (cancelled) {
          sound.setOnPlaybackStatusUpdate(null);
          await sound.unloadAsync().catch(() => undefined);
          return;
        }
        soundRef.current = sound;
        setPlaybackError(false);
        if (resume) {
          positionRef.current = resume.atMs;
          setPositionMs(resume.atMs);
        }
        if (resume?.wasPlaying) claimAudioFocus(focusHandle);
      } catch {
        if (!cancelled) {
          // Load itself failed (URL already expired / network) — manual retry.
          resumeRef.current = resume;
          setPlaybackError(true);
          setIsPlaying(false);
        }
      } finally {
        recoveringRef.current = false;
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [audioUrl, focusHandle, handleStatus]);

  // Unload on unmount/navigation; drop the single-player focus claim.
  useEffect(
    () => () => {
      releaseAudioFocus(focusHandle);
      const sound = soundRef.current;
      soundRef.current = null;
      if (sound) {
        sound.setOnPlaybackStatusUpdate(null);
        void sound.unloadAsync().catch(() => undefined);
      }
    },
    [focusHandle],
  );

  const togglePlay = useCallback(() => {
    const sound = soundRef.current;
    if (!sound) return;
    if (isPlayingRef.current) {
      void sound.pauseAsync().catch(() => undefined);
    } else {
      claimAudioFocus(focusHandle);
      void sound.playAsync().catch(() => recoverFromPlaybackError());
    }
  }, [focusHandle, recoverFromPlaybackError]);

  const handleSeek = useCallback((ms: number) => {
    positionRef.current = ms;
    setPositionMs(ms);
    void soundRef.current?.setPositionAsync(ms).catch(() => undefined);
  }, []);

  const cycleRate = useCallback(() => {
    const idx = PLAYBACK_RATES.indexOf(rateRef.current as (typeof PLAYBACK_RATES)[number]);
    const next = PLAYBACK_RATES[(idx + 1) % PLAYBACK_RATES.length] ?? 1;
    rateRef.current = next;
    setRate(next);
    void soundRef.current?.setRateAsync(next, true).catch(() => undefined);
  }, []);

  const handleManualRetry = useCallback(() => {
    setPlaybackError(false);
    void refetch();
  }, [refetch]);

  // --- Render gates ---------------------------------------------------------

  if (!enabled) {
    return (
      <Pressable
        onPress={() => setEnabled(true)}
        accessibilityRole="button"
        accessibilityLabel="Listen"
        testID="listen-button"
        style={[
          styles.listenButton,
          { backgroundColor: theme.surface, borderColor: theme.line },
        ]}
      >
        <Ionicons name="volume-medium-outline" size={16} color={theme.ink} />
        <Text style={[styles.listenLabel, { color: theme.ink }]}>Listen</Text>
      </Pressable>
    );
  }

  if (isPaywalled) {
    return (
      <View
        testID="audio-paywall"
        style={[styles.noticeRow, { backgroundColor: theme.surfaceMuted, borderColor: theme.line }]}
      >
        <View style={styles.noticeTextRow}>
          <Ionicons name="sparkles-outline" size={14} color={theme.accent} />
          <Text style={[styles.noticeText, { color: theme.inkSoft }]}>
            Listen with Pro — narrated audio for bar answers.
          </Text>
        </View>
        <Pressable
          onPress={() => router.push('/subscription')}
          accessibilityRole="button"
          accessibilityLabel="See plans"
          style={[styles.noticeAction, { borderColor: theme.line, backgroundColor: theme.surface }]}
        >
          <Text style={[styles.noticeActionLabel, { color: theme.ink }]}>See plans</Text>
        </Pressable>
      </View>
    );
  }

  if (isTakingTooLong && data?.status === 'pending') {
    return (
      <View
        testID="audio-taking-too-long"
        style={[styles.noticeRow, { backgroundColor: theme.surfaceMuted, borderColor: theme.line }]}
      >
        <Text style={[styles.noticeText, styles.noticeTextFlex, { color: theme.inkSoft }]}>
          Narration is taking longer than expected.
        </Text>
        <Pressable
          onPress={handleManualRetry}
          accessibilityRole="button"
          accessibilityLabel="Retry"
          style={[styles.noticeAction, { borderColor: theme.line, backgroundColor: theme.surface }]}
        >
          <Text style={[styles.noticeActionLabel, { color: theme.ink }]}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (isLoading || data?.status === 'pending') {
    return (
      <View
        testID="audio-pending"
        style={[styles.noticeRow, { backgroundColor: theme.surfaceMuted, borderColor: theme.line }]}
      >
        <View style={styles.noticeTextRow}>
          <ActivityIndicator size="small" color={theme.inkSoft} />
          <Text style={[styles.noticeText, { color: theme.inkSoft }]}>Preparing narration…</Text>
        </View>
      </View>
    );
  }

  if ((isError && !isPaywalled) || playbackError) {
    return (
      <View
        testID="audio-error"
        style={[styles.noticeRow, { backgroundColor: theme.surfaceMuted, borderColor: theme.line }]}
      >
        <Text style={[styles.noticeText, styles.noticeTextFlex, { color: theme.inkSoft }]}>
          Couldn&apos;t load narration.
        </Text>
        <Pressable
          onPress={handleManualRetry}
          accessibilityRole="button"
          accessibilityLabel="Retry"
          style={[styles.noticeAction, { borderColor: theme.line, backgroundColor: theme.surface }]}
        >
          <Text style={[styles.noticeActionLabel, { color: theme.ink }]}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (data?.status !== 'ready' || !audioUrl) {
    return null;
  }

  return (
    <View
      testID="audio-player"
      style={[styles.player, { backgroundColor: theme.surface, borderColor: theme.line }]}
    >
      <View style={styles.transportRow}>
        <Pressable
          onPress={togglePlay}
          accessibilityRole="button"
          accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
          testID="audio-play-toggle"
          style={[styles.playButton, { backgroundColor: theme.pillBg }]}
        >
          <Ionicons name={isPlaying ? 'pause' : 'play'} size={18} color={theme.pillInk} />
        </Pressable>

        <View style={styles.seekColumn}>
          {title ? (
            <Text numberOfLines={1} style={[styles.title, { color: theme.ink }]}>
              {title}
            </Text>
          ) : null}
          <SeekBar
            positionMs={Math.min(positionMs, durationMs || positionMs)}
            durationMs={durationMs}
            onSeek={handleSeek}
            trackColor={theme.surfaceMuted}
            fillColor={theme.accent}
          />
          <View style={styles.timeRow}>
            <Text testID="audio-current-time" style={[styles.timeText, { color: theme.inkSoft }]}>
              {formatTime(positionMs)}
            </Text>
            <Text style={[styles.timeText, { color: theme.inkSoft }]}>
              {formatTime(durationMs)}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.metaRow}>
        <View style={styles.voiceRow}>
          <Ionicons name="volume-medium-outline" size={13} color={theme.inkFaint} />
          <Text style={[styles.voiceText, { color: theme.inkFaint }]}>
            {data.voiceId} · neural
          </Text>
        </View>
        <Pressable
          onPress={cycleRate}
          accessibilityRole="button"
          accessibilityLabel="Playback speed"
          testID="audio-rate"
          style={[styles.rateChip, { backgroundColor: theme.surfaceMuted }]}
        >
          <Text style={[styles.rateText, { color: theme.ink }]}>{rate}×</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  listenButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  listenLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
  },
  noticeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  noticeTextRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  noticeText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 18,
    flexShrink: 1,
  },
  noticeTextFlex: {
    flex: 1,
  },
  noticeAction: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  noticeActionLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
  },
  player: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    gap: 8,
  },
  transportRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  playButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seekColumn: {
    flex: 1,
  },
  title: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    marginBottom: 2,
  },
  seekHitArea: {
    paddingVertical: 10,
    justifyContent: 'center',
  },
  seekTrack: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  seekFill: {
    height: 4,
    borderRadius: 2,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  timeText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  voiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  voiceText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
  },
  rateChip: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    minWidth: 48,
    alignItems: 'center',
  },
  rateText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
});
