'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
 * - Derives `autoStart` PER digest from `?autoplay=1`. The App Router preserves the
 *   `digests/[id]` component instance across client-side navigation, so a once-only
 *   `useState` initializer would lock `autoStart` to whatever the FIRST digest saw
 *   and the chain would never auto-play the next hop. Instead we arm per `currentId`
 *   (render-derived so a cached digest's player mounts with the right `autoPlay`),
 *   strip the param via `router.replace`, and a `consumed` guard makes re-visits and
 *   manual refreshes inert. Arming survives the strip because it lives in a ref, not
 *   in the URL. (The detail page also gives `<AudioPlayer key={digest.id}>` so its
 *   internal `enabled`/`autoPlayedRef` reset per digest.)
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

  const [atEndOfList, setAtEndOfList] = useState(false);

  const continueEnabled = useAutoplayPrefStore((s) => s.continueEnabled);
  const setContinueEnabled = useAutoplayPrefStore((s) => s.setContinueEnabled);

  // Ids whose `?autoplay=1` has already been honoured + stripped — re-pasting the
  // same autoplay URL within this instance won't replay, and a stripped URL is inert.
  const consumedRef = useRef<Set<string>>(new Set());
  // The single id currently armed for autoplay. Lives in a ref (not the URL) so it
  // survives the param strip below; moves forward as the chain advances, so an
  // earlier digest revisited later without `?autoplay=1` is NOT re-armed.
  const armedIdRef = useRef<string | null>(null);
  // Latest rendered id — read inside async work to detect the reader navigating away.
  const currentIdRef = useRef(currentId);
  currentIdRef.current = currentId;

  // Render-derived so the FIRST render after navigation already reflects the URL:
  // a cached digest mounts its player with the correct `autoPlay` instead of losing
  // the arming to an effect that only runs post-mount.
  if (
    searchParams?.get('autoplay') === '1' &&
    !consumedRef.current.has(currentId)
  ) {
    armedIdRef.current = currentId;
  }
  const autoStart = armedIdRef.current === currentId;

  // Strip `?autoplay=1` after honouring it so a manual refresh is inert. Marking the
  // id consumed (effect, post-commit) does not disarm the current visit because
  // `armedIdRef` already points at it.
  useEffect(() => {
    if (
      searchParams?.get('autoplay') === '1' &&
      !consumedRef.current.has(currentId) &&
      pathname
    ) {
      consumedRef.current.add(currentId);
      router.replace(pathname);
    }
  }, [currentId, pathname, router, searchParams]);

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
    // `nextId !== currentId` is belt-and-suspenders alongside the `setQueue` de-dupe:
    // with unique ids and a strictly-forward index walk the chain always terminates.
    if (nextId && nextId !== currentId) {
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
          // Stale-async guard: the fetch can outlast the reader's intent. If they
          // toggled Continue OFF or navigated to a different digest while it was in
          // flight, this resolved closure must NOT hijack their navigation.
          if (
            !useAutoplayPrefStore.getState().continueEnabled ||
            currentIdRef.current !== currentId
          ) {
            return;
          }
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
