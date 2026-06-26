'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type { Digest, DigestsListMeta } from '@/features/digests/hooks/use-digests';

import {
  usePlayQueueStore,
  type DigestQueueFilters,
} from '../stores/play-queue-store';
import { useAutoplayPrefStore } from '../stores/autoplay-pref-store';

interface DigestsListResponse {
  success: boolean;
  data: Digest[];
  meta: DigestsListMeta;
}

export interface ContinuousPlayback {
  /** True when the page was opened with `?autoplay=1` — auto-start the Listen flow. */
  autoStart: boolean;
  /** The reader's "Continue playing" preference (persisted). */
  continueEnabled: boolean;
  setContinueEnabled: (enabled: boolean) => void;
  /** Call when narration ends naturally — advances the chain if enabled. */
  handleEnded: () => void;
  /** True once the chain reaches the end of the queue with no more to fetch. */
  atEndOfList: boolean;
}

/**
 * Drives Bible.com-style continuous autoplay for the digest detail page.
 *
 * - Reads `?autoplay=1` ONCE on mount (stable across re-renders) and strips it via
 *   `router.replace` so a manual refresh does NOT re-autoplay.
 * - Ensures the current digest is represented in the play queue (direct loads with
 *   no queue collapse to `[currentId]`).
 * - On a natural `ended`, if the reader opted in, advances to the next queued id
 *   (`router.push(.../next?autoplay=1)`). When the local ids are exhausted but a
 *   cursor remains, fetches the next page (the same cursor `useInfiniteDigests`
 *   exposes), appends it, and continues. When there is truly no more, it stops and
 *   surfaces `atEndOfList` — no crash, no infinite loop.
 */
export function useContinuousDigestPlayback(currentId: string): ContinuousPlayback {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  // Capture the autoplay intent exactly once; stripping the param below must not
  // flip this back to false before the player has a chance to auto-start.
  const [autoStart] = useState(() => searchParams?.get('autoplay') === '1');
  const [atEndOfList, setAtEndOfList] = useState(false);

  const continueEnabled = useAutoplayPrefStore((s) => s.continueEnabled);
  const setContinueEnabled = useAutoplayPrefStore((s) => s.setContinueEnabled);

  // Strip `?autoplay=1` after consuming it so a manual refresh is inert.
  useEffect(() => {
    if (autoStart && pathname) router.replace(pathname);
  }, [autoStart, router, pathname]);

  // A fresh digest means a fresh chance to reach the end of the queue.
  useEffect(() => {
    setAtEndOfList(false);
  }, [currentId]);

  // Direct load (or stale queue): seed a single-item queue so navigation is sane.
  useEffect(() => {
    const { ids, setQueue } = usePlayQueueStore.getState();
    if (!ids.includes(currentId)) {
      setQueue({ ids: [currentId], cursor: null, filters: null });
    }
  }, [currentId]);

  const fetchNextPage = useCallback(
    (cursor: string, filters: DigestQueueFilters | null) =>
      queryClient.fetchQuery({
        queryKey: ['digests', 'queue-page', filters, cursor],
        queryFn: async () => {
          const params: Record<string, string> = { limit: '20', cursor };
          if (filters?.digestType) params['digestType'] = filters.digestType;
          if (filters?.reviewStatus) params['reviewStatus'] = filters.reviewStatus;
          const res = await apiClient.get<DigestsListResponse>('/digests', {
            params,
          });
          return res;
        },
      }),
    [queryClient],
  );

  const handleEnded = useCallback(() => {
    // Read the freshest values directly — avoids any stale-closure chain advance.
    if (!useAutoplayPrefStore.getState().continueEnabled) return;

    const state = usePlayQueueStore.getState();
    const i = state.ids.indexOf(currentId);
    const nextId = i >= 0 ? state.ids[i + 1] : undefined;
    if (nextId) {
      router.push(`/digests/${nextId}?autoplay=1`);
      return;
    }

    // Local queue exhausted. Extend via the captured cursor if one remains.
    if (state.cursor) {
      const cursor = state.cursor;
      const filters = state.filters;
      void (async () => {
        try {
          const page = await fetchNextPage(cursor, filters);
          const newIds = page.data.map((d) => d.id);
          const nextCursor = page.meta?.hasNext
            ? (page.meta.nextCursor ?? null)
            : null;
          const firstNew = newIds.find((id) => !state.ids.includes(id));
          if (firstNew) {
            usePlayQueueStore
              .getState()
              .appendPage({ ids: newIds, cursor: nextCursor });
            router.push(`/digests/${firstNew}?autoplay=1`);
            return;
          }
        } catch {
          // Extend failed (network/expired cursor) — stop the chain gracefully.
        }
        setAtEndOfList(true);
      })();
      return;
    }

    setAtEndOfList(true);
  }, [currentId, router, fetchNextPage]);

  return {
    autoStart,
    continueEnabled,
    setContinueEnabled,
    handleEnded,
    atEndOfList,
  };
}
