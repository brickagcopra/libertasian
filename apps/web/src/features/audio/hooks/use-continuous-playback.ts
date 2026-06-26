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
  // Digests whose deep-link default-feed seed has already been attempted — so the
  // seed effect re-running (it depends on `currentId`) never refetches the browse
  // page more than once per digest.
  const deepLinkSeededRef = useRef<Set<string>>(new Set());

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

  // Fetch the DEFAULT digests browse page — the exact call the list page makes on
  // initial load with no filters applied (GET /digests, limit 20, no digestType,
  // no reviewStatus, no cursor) — so a deep link can continue into the default feed.
  const fetchDefaultPage = useCallback(
    () =>
      queryClient.fetchQuery({
        queryKey: ['digests', 'queue-page', null, null],
        queryFn: async () => {
          const res = await apiClient.get<DigestsListResponse>('/digests', {
            params: { limit: '20' },
          });
          return res;
        },
      }),
    [queryClient],
  );

  // Deep link / direct load (currentId is NOT already in the queue — the reader did
  // not enter from the list): seed the queue so continuous play can advance past
  // this digest into the default feed instead of dead-ending at End-of-list.
  //
  //   1. SYNCHRONOUSLY install a single-item floor `[currentId]` so a valid queue
  //      always exists immediately (also the graceful fallback if the fetch fails).
  //   2. ASYNCHRONOUSLY fetch the default browse page and upgrade the queue to
  //      `[currentId, ...pageIds]` with the page cursor.
  //
  // A list-originated queue (currentId already present) is left entirely untouched:
  // the early return means neither the floor nor the fetch fire.
  useEffect(() => {
    const { ids, setQueue } = usePlayQueueStore.getState();
    if (ids.includes(currentId)) return;

    // Floor: install immediately so navigation is always sane.
    setQueue({ ids: [currentId], cursor: null, filters: null });

    // Upgrade the floor from the default feed — at most once per digest.
    if (deepLinkSeededRef.current.has(currentId)) return;
    deepLinkSeededRef.current.add(currentId);

    void (async () => {
      try {
        const page = await fetchDefaultPage();
        // Stale-async guard (same pattern as the cursor-extend below): only upgrade
        // if (a) the reader is still on this digest, AND (b) the queue is still the
        // single-item floor for it — so we never clobber a queue the reader
        // meanwhile populated by entering from the list.
        const live = usePlayQueueStore.getState();
        if (
          currentIdRef.current !== currentId ||
          live.ids.length !== 1 ||
          live.ids[0] !== currentId
        ) {
          return;
        }
        const pageIds = page.data.map((d) => d.id);
        const nextCursor = page.meta?.hasNext
          ? (page.meta.nextCursor ?? null)
          : null;
        // setQueue de-dupes via `[...new Set(ids)]`, so currentId reappearing in the
        // page is handled — currentId stays first, then the chain walks the feed.
        usePlayQueueStore.getState().setQueue({
          ids: [currentId, ...pageIds],
          cursor: nextCursor,
          filters: null,
        });
      } catch {
        // Default-feed fetch failed — leave the single-item floor in place; the
        // chain stops cleanly at End-of-list, exactly as before.
      }
    })();
  }, [currentId, fetchDefaultPage]);

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
