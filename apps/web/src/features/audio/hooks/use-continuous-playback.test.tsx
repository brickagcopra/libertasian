import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const { nav } = vi.hoisted(() => ({
  nav: { push: vi.fn(), replace: vi.fn(), search: '' },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  usePathname: () => '/digests/current',
  useSearchParams: () => new URLSearchParams(nav.search),
}));

vi.mock('@/lib/api-client', () => ({
  apiClient: { get: vi.fn() },
}));

import { apiClient } from '@/lib/api-client';
import { useContinuousDigestPlayback } from './use-continuous-playback';
import { usePlayQueueStore } from '../stores/play-queue-store';
import { useAutoplayPrefStore } from '../stores/autoplay-pref-store';

const mockGet = vi.mocked(apiClient.get);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

function renderPlayback() {
  return renderHook(() => useContinuousDigestPlayback('current'), {
    wrapper: createWrapper(),
  });
}

function renderPlaybackWithId(initialId: string) {
  return renderHook(({ id }) => useContinuousDigestPlayback(id), {
    initialProps: { id: initialId },
    wrapper: createWrapper(),
  });
}

describe('useContinuousDigestPlayback', () => {
  beforeEach(() => {
    nav.push.mockReset();
    nav.replace.mockReset();
    nav.search = '';
    mockGet.mockReset();
    usePlayQueueStore.getState().clear();
    useAutoplayPrefStore.getState().setContinueEnabled(false);
  });

  it('advances to the next queued id on ended when Continue is ON', () => {
    useAutoplayPrefStore.getState().setContinueEnabled(true);
    usePlayQueueStore
      .getState()
      .setQueue({ ids: ['current', 'next'], cursor: null, filters: null });

    const { result } = renderPlayback();
    act(() => result.current.handleEnded());

    expect(nav.push).toHaveBeenCalledWith('/digests/next?autoplay=1');
    expect(result.current.atEndOfList).toBe(false);
  });

  it('does NOT advance on ended when Continue is OFF', () => {
    useAutoplayPrefStore.getState().setContinueEnabled(false);
    usePlayQueueStore
      .getState()
      .setQueue({ ids: ['current', 'next'], cursor: null, filters: null });

    const { result } = renderPlayback();
    act(() => result.current.handleEnded());

    expect(nav.push).not.toHaveBeenCalled();
    expect(result.current.atEndOfList).toBe(false);
  });

  it('stops cleanly at the end of an exhausted queue (no cursor)', () => {
    useAutoplayPrefStore.getState().setContinueEnabled(true);
    usePlayQueueStore
      .getState()
      .setQueue({ ids: ['current'], cursor: null, filters: null });

    const { result } = renderPlayback();
    act(() => result.current.handleEnded());

    expect(nav.push).not.toHaveBeenCalled();
    expect(result.current.atEndOfList).toBe(true);
  });

  it('extends via the cursor when local ids run out, then advances', async () => {
    useAutoplayPrefStore.getState().setContinueEnabled(true);
    usePlayQueueStore
      .getState()
      .setQueue({ ids: ['current'], cursor: 'c1', filters: { digestType: 'case_digest' } });
    mockGet.mockResolvedValueOnce({
      success: true,
      data: [{ id: 'p2a' }, { id: 'p2b' }],
      meta: { hasNext: false },
    });

    const { result } = renderPlayback();
    await act(async () => {
      result.current.handleEnded();
    });

    await waitFor(() =>
      expect(nav.push).toHaveBeenCalledWith('/digests/p2a?autoplay=1'),
    );
    expect(mockGet).toHaveBeenCalledWith('/digests', {
      params: { limit: '20', cursor: 'c1', digestType: 'case_digest' },
    });
    expect(usePlayQueueStore.getState().ids).toEqual(['current', 'p2a', 'p2b']);
  });

  it('reads ?autoplay=1 once, then strips it via router.replace', () => {
    nav.search = 'autoplay=1';

    const { result } = renderPlayback();

    expect(result.current.autoStart).toBe(true);
    expect(nav.replace).toHaveBeenCalledWith('/digests/current');
  });

  // FIX 1: the App Router preserves the digests/[id] component instance across
  // /digests/A → /digests/B navigations, so a once-only useState initializer would
  // never re-evaluate and the chain would never auto-play the next hop. autoStart
  // must re-derive per currentId. renderHook-per-case (a fresh mount each time) did
  // NOT catch this; re-rendering the SAME instance with a new id does.
  it('arms autoStart per digest under client-side nav without a remount', () => {
    const { result, rerender } = renderPlaybackWithId('current');

    // Opened from the list with no ?autoplay — the first digest is NOT armed.
    expect(result.current.autoStart).toBe(false);

    // The chain navigates to the next digest with ?autoplay=1, but the page
    // component instance is preserved (no remount) — only the params change.
    nav.search = 'autoplay=1';
    rerender({ id: 'next' });

    expect(result.current.autoStart).toBe(true);
  });

  // FIX 2: cursor pagination over an updatedAt-ordered list can surface the current
  // id again. setQueue de-dupes so the chain can't ping-pong current→next→current.
  it('does not loop when the list re-surfaces the current id (de-dupe terminates)', () => {
    useAutoplayPrefStore.getState().setContinueEnabled(true);
    usePlayQueueStore
      .getState()
      .setQueue({ ids: ['current', 'next', 'current'], cursor: null, filters: null });

    expect(usePlayQueueStore.getState().ids).toEqual(['current', 'next']);

    const { result } = renderPlayback();
    act(() => result.current.handleEnded());

    expect(nav.push).toHaveBeenCalledTimes(1);
    expect(nav.push).toHaveBeenCalledWith('/digests/next?autoplay=1');
  });

  // FIX 3: a cursor-extend fetch can outlast the reader's intent.
  it('does not hijack navigation if Continue is toggled OFF during the cursor fetch', async () => {
    useAutoplayPrefStore.getState().setContinueEnabled(true);
    usePlayQueueStore
      .getState()
      .setQueue({ ids: ['current'], cursor: 'c1', filters: null });
    mockGet.mockImplementationOnce(async () => {
      // Reader flips Continue OFF while the next page is in flight.
      useAutoplayPrefStore.getState().setContinueEnabled(false);
      return { success: true, data: [{ id: 'p2a' }], meta: { hasNext: false } };
    });

    const { result } = renderPlayback();
    await act(async () => {
      result.current.handleEnded();
    });

    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(nav.push).not.toHaveBeenCalled();
  });

  it('does not hijack navigation if the reader navigates away during the cursor fetch', async () => {
    useAutoplayPrefStore.getState().setContinueEnabled(true);
    usePlayQueueStore
      .getState()
      .setQueue({ ids: ['current'], cursor: 'c1', filters: null });
    let resolveFetch: ((value: unknown) => void) | undefined;
    mockGet.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const { result, rerender } = renderPlaybackWithId('current');
    act(() => result.current.handleEnded());

    // Reader navigates to a different digest while the fetch is still pending.
    rerender({ id: 'other' });
    await act(async () => {
      resolveFetch?.({ success: true, data: [{ id: 'p2a' }], meta: { hasNext: false } });
    });

    expect(nav.push).not.toHaveBeenCalledWith('/digests/p2a?autoplay=1');
  });

  // DEEP-LINK SEED: a digest opened via direct link (currentId NOT already in the
  // queue) seeds the queue from the DEFAULT digests browse page, so continuous play
  // can advance past it and paginate onward — as if the reader entered from the list.
  it('seeds the queue from the default feed for a deep-linked digest', async () => {
    useAutoplayPrefStore.getState().setContinueEnabled(true);
    // No list context — the queue starts empty.
    mockGet.mockResolvedValueOnce({
      success: true,
      data: [{ id: 'd1' }, { id: 'd2' }],
      meta: { hasNext: true, nextCursor: 'c2' },
    });

    const { result } = renderPlayback();

    // The default browse page is fetched with no filters/cursor (just limit).
    await waitFor(() =>
      expect(mockGet).toHaveBeenCalledWith('/digests', {
        params: { limit: '20' },
      }),
    );
    await waitFor(() =>
      expect(usePlayQueueStore.getState().ids).toEqual(['current', 'd1', 'd2']),
    );
    expect(usePlayQueueStore.getState().cursor).toBe('c2');

    // handleEnded now advances into the default feed instead of End-of-list.
    act(() => result.current.handleEnded());
    expect(nav.push).toHaveBeenCalledWith('/digests/d1?autoplay=1');
    expect(result.current.atEndOfList).toBe(false);
  });

  // LIST-ORIGINATED: when currentId is already in the queue, the deep-link seed is
  // inert — the default fetch is never called and the queue is left untouched.
  it('does not fetch the default feed when the queue is list-originated', async () => {
    usePlayQueueStore
      .getState()
      .setQueue({ ids: ['a', 'current', 'b'], cursor: 'c9', filters: { digestType: 'case_digest' } });

    renderPlayback();

    // Give any stray async seed a chance to run, then assert it didn't.
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockGet).not.toHaveBeenCalled();
    expect(usePlayQueueStore.getState().ids).toEqual(['a', 'current', 'b']);
    expect(usePlayQueueStore.getState().cursor).toBe('c9');
  });

  // STALE GUARD: if the reader navigates away before the default-feed fetch resolves,
  // the upgrade is dropped — the queue is not clobbered by a resolved stale closure.
  it('does not upgrade the deep-link queue if the reader navigates away mid-fetch', async () => {
    let resolveFetch: ((value: unknown) => void) | undefined;
    mockGet.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const { rerender } = renderPlaybackWithId('current');
    // Reader navigates to a different digest while the default fetch is pending.
    rerender({ id: 'other' });

    await act(async () => {
      resolveFetch?.({
        success: true,
        data: [{ id: 'd1' }, { id: 'd2' }],
        meta: { hasNext: false },
      });
    });

    // The stale 'current' closure must NOT win: the queue is never the
    // 'current'-headed upgrade. (The now-current 'other' digest is the one that
    // legitimately owns the seed — its floor stays at the head.)
    expect(usePlayQueueStore.getState().ids).not.toEqual(['current', 'd1', 'd2']);
    expect(usePlayQueueStore.getState().ids[0]).toBe('other');
  });

  // FETCH ERROR: a failed default-feed fetch leaves the single-item floor in place,
  // so the chain ends cleanly at End-of-list (no throw, no console).
  it('leaves the single-item floor in place when the default-feed fetch fails', async () => {
    useAutoplayPrefStore.getState().setContinueEnabled(true);
    mockGet.mockRejectedValueOnce(new Error('network down'));

    const { result } = renderPlayback();

    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });
    expect(usePlayQueueStore.getState().ids).toEqual(['current']);

    act(() => result.current.handleEnded());
    expect(nav.push).not.toHaveBeenCalled();
    expect(result.current.atEndOfList).toBe(true);
  });
});
