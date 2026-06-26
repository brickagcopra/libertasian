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
});
