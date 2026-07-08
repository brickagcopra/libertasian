import { act, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import type { ScrollView } from 'react-native';

import type { DigestSection } from '@/components/screens/DigestDetailScreen';
import { ReadAlongDigestBody } from './ReadAlongDigestBody';
import { readAlongStore } from '../stores/read-along-store';

const SECTIONS: DigestSection[] = [
  { id: 'facts', heading: 'Facts', paragraphs: ['Plain facts paragraph.'] },
  { id: 'ruling', heading: 'Ruling', paragraphs: ['Plain ruling paragraph.'] },
];

const MANIFEST = JSON.stringify({
  version: 2,
  voiceId: 'Matthew',
  durationMs: 5000,
  segments: [
    { id: 'seg-h', kind: 'heading', sectionKey: 'facts', text: 'Facts', timeMs: 0 },
    { id: 'seg-1', kind: 'sentence', sectionKey: 'facts', text: 'First sentence.', timeMs: 500, paragraphIndex: 0 },
    { id: 'seg-2', kind: 'sentence', sectionKey: 'facts', text: 'Second sentence.', timeMs: 2000, paragraphIndex: 1 },
  ],
});

const CONTENT_KEY = 'digest:d1';
const URL = 'https://s3.example.com/readalong.json?sig=abc';

const mockFetch = jest.fn();
const scrollRef = { current: null as ScrollView | null };

function renderBody() {
  return render(
    <ReadAlongDigestBody contentId="d1" sections={SECTIONS} scrollRef={scrollRef} />,
  );
}

/** Text content of the currently highlighted segment span. */
function activeText(): string {
  const { children } = screen.getByTestId('active-segment').props as {
    children: string[];
  };
  return (Array.isArray(children) ? children.join('') : String(children)).trim();
}

function publishStarted(positionMillis = 600) {
  act(() => {
    readAlongStore.setState({
      contentKey: CONTENT_KEY,
      readalongUrl: URL,
      positionMillis,
      isPlaying: true,
      hasStarted: true,
    });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  readAlongStore.reset();
  global.fetch = mockFetch as unknown as typeof fetch;
  mockFetch.mockResolvedValue({ ok: true, text: () => Promise.resolve(MANIFEST) });
});

describe('ReadAlongDigestBody', () => {
  it('renders the plain body (and fetches nothing) before audio is started', () => {
    renderBody();
    expect(screen.getByText('Plain facts paragraph.')).toBeTruthy();
    expect(screen.getByText('Plain ruling paragraph.')).toBeTruthy();
    expect(screen.queryByTestId('read-along-body')).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('stays on the plain body when the manifest fetch fails', async () => {
    mockFetch.mockRejectedValue(new Error('network down'));
    renderBody();
    publishStarted();
    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith(URL));
    // Fetch failed → hook yields null segments → plain fallback, no crash.
    expect(screen.getByText('Plain facts paragraph.')).toBeTruthy();
    expect(screen.queryByTestId('read-along-body')).toBeNull();
  });

  it('stays on the plain body when the manifest is not-ok or unparseable', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 403, text: () => Promise.resolve('') });
    renderBody();
    publishStarted();
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(screen.getByText('Plain facts paragraph.')).toBeTruthy();
    expect(screen.queryByTestId('read-along-body')).toBeNull();
  });

  it('upgrades to read-along spans and highlights the active segment', async () => {
    renderBody();
    publishStarted(600); // inside seg-1 [500, 2000)
    await waitFor(() => expect(screen.getByTestId('read-along-body')).toBeTruthy());

    // Narrated section renders manifest text; non-narrated stays plain.
    expect(screen.getByText('First sentence.')).toBeTruthy();
    expect(screen.getByText('Plain ruling paragraph.')).toBeTruthy();
    expect(screen.queryByText('Plain facts paragraph.')).toBeNull();

    expect(activeText()).toBe('First sentence.');
  });

  it('moves the highlight when playback position crosses a segment boundary (seek)', async () => {
    renderBody();
    publishStarted(600);
    await waitFor(() => expect(screen.getByTestId('read-along-body')).toBeTruthy());
    expect(activeText()).toBe('First sentence.');

    act(() => {
      readAlongStore.setState({ positionMillis: 2500 }); // jump into seg-2
    });
    expect(activeText()).toBe('Second sentence.');
  });

  it('clears the highlight when the player resets the store (unload)', async () => {
    renderBody();
    publishStarted(600);
    await waitFor(() => expect(screen.getByTestId('read-along-body')).toBeTruthy());

    act(() => {
      readAlongStore.reset(CONTENT_KEY);
    });
    expect(screen.queryByTestId('read-along-body')).toBeNull();
    expect(screen.getByText('Plain facts paragraph.')).toBeTruthy();
  });

  it('ignores state published for a different digest', () => {
    renderBody();
    act(() => {
      readAlongStore.setState({
        contentKey: 'digest:other',
        readalongUrl: URL,
        positionMillis: 600,
        isPlaying: true,
        hasStarted: true,
      });
    });
    expect(screen.queryByTestId('read-along-body')).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
