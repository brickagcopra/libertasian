'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';

import { activeSegmentIndex } from '../lib/parse-readalong';
import type { ReadAlongSegment } from '../types';

/**
 * Shared read-along coordination between the `AudioPlayer` (which owns the
 * `<audio>` element + fetches the manifest) and the inline digest body (which
 * renders the manifest spans and highlights the active one). The player and the
 * body are SIBLINGS in the digest page tree, so they communicate through this
 * context rather than props: the player publishes, the body subscribes.
 */
interface ReadAlongState {
  /** The player's `<audio>` element, read for the playback clock. */
  audioRef: RefObject<HTMLAudioElement | null> | null;
  /** Parsed manifest segments, or null until loaded / when unavailable. */
  segments: ReadAlongSegment[] | null;
  /** Whether the audio is currently playing (gates the rAF loop). */
  isPlaying: boolean;
}

const EMPTY: ReadAlongState = { audioRef: null, segments: null, isPlaying: false };

interface ReadAlongContextValue {
  state: ReadAlongState;
  publish: (patch: Partial<ReadAlongState>) => void;
}

const ReadAlongContext = createContext<ReadAlongContextValue | null>(null);

/** Wrap the digest page region that contains BOTH the player and the body. */
export function ReadAlongProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ReadAlongState>(EMPTY);
  const publish = useCallback(
    (patch: Partial<ReadAlongState>) =>
      setState((prev) => ({ ...prev, ...patch })),
    [],
  );
  const value = useMemo(() => ({ state, publish }), [state, publish]);
  return (
    <ReadAlongContext.Provider value={value}>
      {children}
    </ReadAlongContext.Provider>
  );
}

/**
 * Publisher for the `AudioPlayer`. A no-op when rendered outside a provider
 * (e.g. on a bar-answer page that has no inline read-along), so the player works
 * in both contexts.
 */
export function useReadAlongPublisher(): (patch: Partial<ReadAlongState>) => void {
  return useContext(ReadAlongContext)?.publish ?? noop;
}

/** Read the published read-along state. Null when outside a provider. */
export function useReadAlongState(): ReadAlongState | null {
  return useContext(ReadAlongContext)?.state ?? null;
}

function noop(): void {
  /* no provider mounted — nothing to publish to */
}

/**
 * Active read-along segment id, driven by a requestAnimationFrame loop off the
 * audio element's `currentTime` (only while playing). Updates state ONLY when
 * the active id changes so a 60fps loop does not cause 60 re-renders/sec. The
 * rAF is cancelled on unmount and whenever playback stops.
 */
export function useActiveSegmentId(
  audioRef: RefObject<HTMLAudioElement | null> | null,
  segments: readonly ReadAlongSegment[] | null,
  isPlaying: boolean,
): string | null {
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (!audioRef || !segments || segments.length === 0 || !isPlaying) return;
    const el = audioRef.current;
    if (!el) return;

    let raf = 0;
    const tick = () => {
      const idx = activeSegmentIndex(segments, el.currentTime * 1000);
      const nextId = idx >= 0 ? (segments[idx]?.id ?? null) : null;
      setActiveId((prev) => (prev === nextId ? prev : nextId));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [audioRef, segments, isPlaying]);

  return activeId;
}
