import { useSyncExternalStore } from 'react';

/**
 * Read-along playback bus between the `AudioPlayerBar` (publisher) and the
 * digest read-along body (subscriber). Plays the role of the web's
 * `ReadAlongProvider` context (apps/web/src/features/audio/components/
 * read-along-context.tsx), but as a module-level external store because the
 * player and the body are wired together per screen, not per React subtree.
 *
 * PERF CONTRACT (mirrors the web's `useActiveSegmentId`): the player publishes
 * `positionMillis` on every 250ms status tick, but subscribers MUST select
 * DERIVED values (e.g. the active segment id) via {@link useReadAlongSelector}
 * — `useSyncExternalStore` only re-renders when the selected snapshot changes,
 * so a position tick that stays within the same segment causes zero re-renders.
 * Never select `positionMillis` itself from a component.
 *
 * Publishing is a safe no-op when nothing subscribes (bar-exam answer screens
 * mount no subscriber; the player additionally skips publishing entirely for
 * non-digest content).
 */
export interface ReadAlongPlaybackState {
  /** `digest:{id}` of the publishing player, or null when idle/cleared. */
  contentKey: string | null;
  /** Presigned read-along manifest URL from the ready rendition (300s TTL). */
  readalongUrl: string | null;
  /** Latest playback position published by the player. */
  positionMillis: number;
  isPlaying: boolean;
  /** True once playback has started at least once for this contentKey. */
  hasStarted: boolean;
}

const INITIAL: ReadAlongPlaybackState = {
  contentKey: null,
  readalongUrl: null,
  positionMillis: 0,
  isPlaying: false,
  hasStarted: false,
};

let state: ReadAlongPlaybackState = INITIAL;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export const readAlongStore = {
  getState(): ReadAlongPlaybackState {
    return state;
  },

  setState(patch: Partial<ReadAlongPlaybackState>): void {
    const next = { ...state, ...patch };
    if (
      next.contentKey === state.contentKey &&
      next.readalongUrl === state.readalongUrl &&
      next.positionMillis === state.positionMillis &&
      next.isPlaying === state.isPlaying &&
      next.hasStarted === state.hasStarted
    ) {
      return;
    }
    state = next;
    notify();
  },

  /**
   * Clear the read-along state (highlight goes away, body reverts to plain).
   * When `contentKey` is given, only resets if that key still owns the store —
   * so a stale unmounting player never clobbers a newer one.
   */
  reset(contentKey?: string): void {
    if (contentKey !== undefined && state.contentKey !== contentKey) return;
    if (state === INITIAL) return;
    state = INITIAL;
    notify();
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

/**
 * Subscribe to a derived slice of the read-along state. Re-renders ONLY when
 * the selected value changes (`Object.is`) — select primitives, not objects.
 */
export function useReadAlongSelector<T>(
  selector: (s: ReadAlongPlaybackState) => T,
): T {
  return useSyncExternalStore(readAlongStore.subscribe, () =>
    selector(readAlongStore.getState()),
  );
}

/** How long auto-follow stays suspended after a manual scroll. */
export const FOLLOW_SUSPEND_MS = 5_000;

let followSuspendedUntil = 0;

/**
 * Suspend auto-follow scrolling (called from the ScrollView's
 * `onScrollBeginDrag`, which fires for user drags but NOT for programmatic
 * `scrollTo`). Read imperatively at scroll time — no re-render involved.
 */
export function suspendAutoFollow(): void {
  followSuspendedUntil = Date.now() + FOLLOW_SUSPEND_MS;
}

export function isAutoFollowSuspended(): boolean {
  return Date.now() < followSuspendedUntil;
}
