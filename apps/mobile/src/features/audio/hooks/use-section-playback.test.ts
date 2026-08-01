import { act, renderHook, waitFor } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { apiClient } from '../../../lib/api-client';
import { useSectionPlayback } from './use-section-playback';
import type { AudioRenditionReadModel } from '../types';

jest.mock('../../../lib/api-client', () => {
  const actual = jest.requireActual('../../../lib/api-client');
  return { ...actual, apiClient: { get: jest.fn() } };
});

const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;

const SECTIONS = [
  { id: 's1', ordering: 1 },
  { id: 's2', ordering: 2 },
  { id: 's3', ordering: 3 },
];

const READY: AudioRenditionReadModel = {
  status: 'ready',
  audioUrl: 'https://s3.example.com/a.mp3?sig=abc',
  marksUrl: null,
  readalongUrl: null,
  durationMs: 1000,
  language: 'en',
  voiceId: 'Ruth',
};

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

const setup = (sections: Array<{ id: string; ordering?: number; plainText?: string | null }> = SECTIONS) =>
  renderHook(() => useSectionPlayback(sections), { wrapper: createWrapper() });

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockResolvedValue(READY);
});

describe('useSectionPlayback', () => {
  it('touches no audio endpoint until a section is explicitly played', () => {
    const { result } = setup();

    expect(result.current.activeSectionId).toBeNull();
    expect(mockGet).not.toHaveBeenCalled();
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
    expect(mockGet).not.toHaveBeenCalled();
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
    expect(mockGet).toHaveBeenCalledWith('/audio/legal_document_section/s2', {
      params: { language: 'en' },
    });
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

  it('skips sections with no text when chaining', async () => {
    const { result } = setup([
      { id: 's1', ordering: 1, plainText: 'Article 1.' },
      { id: 's2', ordering: 2, plainText: '' },
      { id: 's3', ordering: 3, plainText: 'Article 3.' },
    ]);
    act(() => result.current.playWholeDocument());

    act(() => result.current.handleEnded());

    await waitFor(() => expect(result.current.activeSectionId).toBe('s3'));
    // s2 is never warmed, so its (nonexistent) synthesis is never enqueued.
    expect(mockGet).not.toHaveBeenCalledWith(
      '/audio/legal_document_section/s2',
      expect.anything(),
    );
  });

  it('does not advance when chaining is turned off MID-FETCH', async () => {
    let release: (value: AudioRenditionReadModel) => void = () => undefined;
    mockGet.mockReturnValue(
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
      release(READY);
    });

    // A resolved closure must not hijack the reader's decision.
    expect(result.current.activeSectionId).toBe('s1');
  });

  it('does not advance when the reader picks another section MID-FETCH', async () => {
    let release: (value: AudioRenditionReadModel) => void = () => undefined;
    mockGet.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );

    const { result } = setup();
    act(() => result.current.playWholeDocument());
    act(() => result.current.handleEnded());

    act(() => result.current.playSection('s3'));
    await act(async () => {
      release(READY);
    });

    expect(result.current.activeSectionId).toBe('s3');
  });

  it('stops the chain when the next section cannot be fetched', async () => {
    mockGet.mockRejectedValue(new Error('402 payment required'));

    const { result } = setup();
    act(() => result.current.playWholeDocument());
    act(() => result.current.handleEnded());

    await waitFor(() => expect(result.current.atEndOfDocument).toBe(true));
    // Rather than marching through the document swapping in players that
    // cannot play.
    expect(result.current.activeSectionId).toBe('s1');
  });

  it('caches the warm-up under the player\'s own query key', async () => {
    // Otherwise the bar that mounts next refetches what was just fetched —
    // and on a not-ready section that second GET is another enqueue attempt.
    // Default gcTime here (not the 0 the other cases use): the point is that
    // the entry is still in the cache when the player mounts and reads it.
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useSectionPlayback(SECTIONS), {
      wrapper: ({ children }: { children: React.ReactNode }) =>
        React.createElement(QueryClientProvider, { client: qc }, children),
    });

    act(() => result.current.playWholeDocument());
    act(() => result.current.handleEnded());
    await waitFor(() => expect(result.current.activeSectionId).toBe('s2'));

    expect(
      qc.getQueryData(['audio-rendition', 'legal_document_section', 's2']),
    ).toEqual(READY);
  });

  it('does nothing for a document with no sections', () => {
    const { result } = setup([]);

    act(() => result.current.playWholeDocument());

    expect(result.current.activeSectionId).toBeNull();
    expect(mockGet).not.toHaveBeenCalled();
  });
});
