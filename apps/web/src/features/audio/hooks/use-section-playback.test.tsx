import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

const apiMocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api-client', () => ({
  apiClient: { get: apiMocks.get, post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  ApiClientError: class ApiClientError extends Error {
    constructor(
      message: string,
      public statusCode: number,
    ) {
      super(message);
    }
  },
}));

import { useSectionPlayback } from './use-section-playback';

const SECTIONS = [
  { id: 's1', ordering: 1 },
  { id: 's2', ordering: 2 },
  { id: 's3', ordering: 3 },
];

const READY = {
  status: 'ready' as const,
  audioUrl: 'https://signed/a.mp3',
  marksUrl: null,
  readalongUrl: null,
  durationMs: 1000,
  language: 'en',
  voiceId: 'af_heart',
};

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const setup = (sections = SECTIONS) =>
  renderHook(() => useSectionPlayback(sections), { wrapper });

beforeEach(() => {
  apiMocks.get.mockReset();
  apiMocks.get.mockResolvedValue({ success: true, data: READY });
});

describe('useSectionPlayback', () => {
  it('touches no audio endpoint until a section is explicitly played', () => {
    const { result } = setup();

    expect(result.current.activeSectionId).toBeNull();
    expect(apiMocks.get).not.toHaveBeenCalled();
  });

  it('loads a section into the player on an explicit play', () => {
    const { result } = setup();

    act(() => result.current.playSection('s2'));

    expect(result.current.activeSectionId).toBe('s2');
    expect(result.current.autoStart).toBe(true);
  });

  it('defaults "play whole document" to OFF, like digest autoplay', () => {
    const { result } = setup();
    expect(result.current.continueEnabled).toBe(false);
  });

  it('does not advance when chaining is off', async () => {
    const { result } = setup();
    act(() => result.current.playSection('s1'));

    act(() => result.current.handleEnded());

    await waitFor(() => expect(result.current.activeSectionId).toBe('s1'));
    expect(apiMocks.get).not.toHaveBeenCalled();
  });

  it('chains in `ordering` order and stops after the last section', async () => {
    const { result } = setup();
    act(() => result.current.playWholeDocument());
    expect(result.current.activeSectionId).toBe('s1');
    expect(result.current.continueEnabled).toBe(true);

    act(() => result.current.handleEnded());
    await waitFor(() => expect(result.current.activeSectionId).toBe('s2'));

    act(() => result.current.handleEnded());
    await waitFor(() => expect(result.current.activeSectionId).toBe('s3'));

    // Last section: the chain stops rather than wrapping or hanging.
    act(() => result.current.handleEnded());
    await waitFor(() => expect(result.current.atEndOfDocument).toBe(true));
    expect(result.current.activeSectionId).toBe('s3');
  });

  it('warms the next rendition before swapping the player to it', async () => {
    const { result } = setup();
    act(() => result.current.playWholeDocument());

    act(() => result.current.handleEnded());

    await waitFor(() => expect(result.current.activeSectionId).toBe('s2'));
    // The first not-ready GET is what enqueues synthesis, so the section the
    // chain is about to show is the one that gets warmed.
    expect(apiMocks.get).toHaveBeenCalledWith(
      '/audio/legal_document_section/s2',
      { params: { language: 'en' } },
    );
  });

  it('cannot loop forever on a duplicated section id', async () => {
    const { result } = setup([
      { id: 's1', ordering: 1 },
      { id: 's2', ordering: 2 },
      { id: 's1', ordering: 3 },
    ]);
    act(() => result.current.playWholeDocument());

    act(() => result.current.handleEnded());
    await waitFor(() => expect(result.current.activeSectionId).toBe('s2'));

    // The queue de-duplicates, so s2 is the LAST entry: the repeat of s1 can
    // never send the chain backwards into a 2-cycle.
    act(() => result.current.handleEnded());
    await waitFor(() => expect(result.current.atEndOfDocument).toBe(true));
    expect(result.current.activeSectionId).toBe('s2');
  });

  it('does not advance when chaining is turned off MID-FETCH', async () => {
    let release: (value: unknown) => void = () => undefined;
    apiMocks.get.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );

    const { result } = setup();
    act(() => result.current.playWholeDocument());
    act(() => result.current.handleEnded());

    // The reader changes their mind while the warm-up is in flight.
    act(() => result.current.setContinueEnabled(false));
    await act(async () => {
      release({ success: true, data: READY });
    });

    // A resolved closure must not hijack the reader's decision.
    expect(result.current.activeSectionId).toBe('s1');
  });

  it('does not advance when the reader picks another section MID-FETCH', async () => {
    let release: (value: unknown) => void = () => undefined;
    apiMocks.get.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );

    const { result } = setup();
    act(() => result.current.playWholeDocument());
    act(() => result.current.handleEnded());

    act(() => result.current.playSection('s3'));
    await act(async () => {
      release({ success: true, data: READY });
    });

    expect(result.current.activeSectionId).toBe('s3');
  });

  it('stops the chain when the next section cannot be fetched', async () => {
    apiMocks.get.mockRejectedValue(new Error('402 payment required'));

    const { result } = setup();
    act(() => result.current.playWholeDocument());
    act(() => result.current.handleEnded());

    await waitFor(() => expect(result.current.atEndOfDocument).toBe(true));
    // Rather than marching through the document swapping in players that
    // cannot play.
    expect(result.current.activeSectionId).toBe('s1');
  });

  it('does nothing for a document with no sections', () => {
    const { result } = setup([]);

    act(() => result.current.playWholeDocument());

    expect(result.current.activeSectionId).toBeNull();
    expect(apiMocks.get).not.toHaveBeenCalled();
  });
});
