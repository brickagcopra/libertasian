import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRef, type RefObject } from 'react';

import { renderWithProviders, screen, waitFor } from '@/test/test-utils';

import { ReadAlongPanel } from './read-along-panel';

const NDJSON = [
  '{"time":0,"type":"sentence","start":0,"end":40,"value":"Digest Mariano R."}',
  '{"time":62,"type":"word","start":0,"end":6,"value":"Digest"}',
  '{"time":420,"type":"word","start":7,"end":14,"value":"Mariano"}',
  '{"time":800,"type":"word","start":15,"end":17,"value":"R."}',
].join('\n');

function fakeAudioRef(currentTimeSec: number): RefObject<HTMLAudioElement | null> {
  const ref = createRef<HTMLAudioElement>();
  // Only currentTime is read by the sync loop.
  (ref as { current: unknown }).current = { currentTime: currentTimeSec };
  return ref;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ReadAlongPanel', () => {
  it('highlights the word spoken at the current audio time', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(NDJSON) }),
    );
    // Drive the rAF loop deterministically (a few frames, then stop).
    let frames = 0;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frames += 1;
      if (frames <= 4) setTimeout(() => cb(0), 0);
      return frames;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    // currentTime 0.42s -> 420ms -> the "Mariano" word (onset 420).
    renderWithProviders(
      <ReadAlongPanel
        marksUrl="https://signed.example/marks.ndjson"
        audioRef={fakeAudioRef(0.42)}
        isPlaying
      />,
    );

    // Transcript renders once marks are fetched + parsed.
    await waitFor(() =>
      expect(screen.getByTestId('read-along-transcript')).toBeInTheDocument(),
    );
    expect(fetch).toHaveBeenCalledWith(
      'https://signed.example/marks.ndjson',
      expect.objectContaining({ signal: expect.anything() }),
    );

    // The active word carries data-active; it must be "Mariano".
    await waitFor(() => {
      const active = document.querySelector('[data-active="true"]');
      expect(active).not.toBeNull();
      expect(active?.textContent?.trim()).toBe('Mariano');
    });
  });

  it('shows a fallback when the marks fetch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 403, text: () => Promise.resolve('') }),
    );
    vi.stubGlobal('requestAnimationFrame', vi.fn().mockReturnValue(1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    renderWithProviders(
      <ReadAlongPanel
        marksUrl="https://signed.example/marks.ndjson"
        audioRef={fakeAudioRef(0)}
        isPlaying={false}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText(/Couldn't load the transcript/i)).toBeInTheDocument(),
    );
  });
});
