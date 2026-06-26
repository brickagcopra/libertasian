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
});
