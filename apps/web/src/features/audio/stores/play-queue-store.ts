'use client';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * Ordered play-queue for continuous digest autoplay. The digest LIST captures its
 * loaded, ordered ids here on navigation; the digest DETAIL page reads it to find
 * the "next" digest when the current narration ends. When the local ids run out
 * but a `cursor` remains, the detail page fetches the next page (the same cursor
 * `useInfiniteDigests` exposes) and appends it via `appendPage`.
 *
 * Persisted to sessionStorage: the queue is tab-scoped, ephemeral, and should not
 * leak across browser sessions. Holds ids only — never digest bodies — so it stays
 * tiny and never duplicates server state owned by TanStack Query.
 */
export interface DigestQueueFilters {
  digestType?: string;
  reviewStatus?: string;
}

interface PlayQueueState {
  /** Ordered digest ids the reader can continuously play through. */
  ids: string[];
  /** Next-page cursor from the source list, or null when exhausted/unknown. */
  cursor: string | null;
  /** Filters the source list used — replays them when extending via the cursor. */
  filters: DigestQueueFilters | null;
  /** Replace the queue (list navigation, or a direct-load fallback of [thatId]). */
  setQueue: (payload: {
    ids: string[];
    cursor: string | null;
    filters: DigestQueueFilters | null;
  }) => void;
  /** Append a freshly fetched page, de-duping ids and advancing the cursor. */
  appendPage: (payload: { ids: string[]; cursor: string | null }) => void;
  clear: () => void;
}

export const usePlayQueueStore = create<PlayQueueState>()(
  persist(
    (set) => ({
      ids: [],
      cursor: null,
      filters: null,
      setQueue: ({ ids, cursor, filters }) => set({ ids, cursor, filters }),
      appendPage: ({ ids, cursor }) =>
        set((prev) => {
          const seen = new Set(prev.ids);
          const merged = [...prev.ids, ...ids.filter((id) => !seen.has(id))];
          return { ids: merged, cursor };
        }),
      clear: () => set({ ids: [], cursor: null, filters: null }),
    }),
    {
      name: 'libertasian-audio-queue',
      storage: createJSONStorage(() => sessionStorage),
    },
  ),
);
