import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders, screen } from '@/test/test-utils';

import { DigestReadAlongBody, type DigestSectionDef } from './digest-read-along-body';
import { activeSegmentIndex } from '../lib/parse-readalong';
import type { ReadAlongSegment } from '../types';

// Mock the read-along context so we can feed published state + an active id
// directly, without driving the rAF loop off a real <audio> element.
const { mockState, mockActive } = vi.hoisted(() => ({
  mockState: vi.fn(),
  mockActive: vi.fn(),
}));

vi.mock('./read-along-context', () => ({
  useReadAlongState: () => mockState(),
  useActiveSegmentId: (...args: unknown[]) => mockActive(...args),
}));

const SEGMENTS: ReadAlongSegment[] = [
  { id: 'seg-0', kind: 'title', sectionKey: 'title', text: 'People v. Cruz', timeMs: 0 },
  { id: 'seg-1', kind: 'heading', sectionKey: 'facts', text: 'Facts', timeMs: 800 },
  { id: 'seg-2', kind: 'sentence', sectionKey: 'facts', text: 'He fled.', timeMs: 1500 },
  { id: 'seg-3', kind: 'sentence', sectionKey: 'facts', text: 'He hid.', timeMs: 2200 },
];

const SECTIONS: DigestSectionDef[] = [
  { key: 'summary', title: 'Summary', content: 'A short summary.' },
  { key: 'facts', title: 'Facts', content: 'He fled. He hid.' },
];

afterEach(() => {
  mockState.mockReset();
  mockActive.mockReset();
});

describe('DigestReadAlongBody', () => {
  it('renders inline spans from the manifest, plain for non-narrated sections', () => {
    mockState.mockReturnValue({
      audioRef: { current: null },
      segments: SEGMENTS,
      isPlaying: true,
    });
    mockActive.mockReturnValue(null);

    const { container } = renderWithProviders(
      <DigestReadAlongBody sections={SECTIONS} />,
    );

    expect(screen.getByTestId('read-along-body')).toBeInTheDocument();
    // Narrated "Facts" body is span-wrapped from the manifest segments.
    expect(container.querySelector('[data-seg-id="seg-2"]')).toHaveTextContent('He fled.');
    expect(container.querySelector('[data-seg-id="seg-3"]')).toHaveTextContent('He hid.');
    // Non-narrated "Summary" has no segments → plain text, not span-wrapped.
    expect(screen.getByText('A short summary.')).toBeInTheDocument();
    // Only the Facts heading (seg-1) + its two sentence spans carry ids.
    expect(container.querySelectorAll('[data-seg-id]')).toHaveLength(3);
  });

  it('highlights the segment matching a mocked currentTime', () => {
    mockState.mockReturnValue({
      audioRef: { current: null },
      segments: SEGMENTS,
      isPlaying: true,
    });
    // At 1500ms the active segment is seg-2 ("He fled.") — derive it via the
    // same binary search the real hook uses, so the highlight follows the clock.
    const activeIdx = activeSegmentIndex(SEGMENTS, 1500);
    mockActive.mockReturnValue(SEGMENTS[activeIdx]?.id ?? null);

    const { container } = renderWithProviders(
      <DigestReadAlongBody sections={SECTIONS} />,
    );

    const active = container.querySelector('[data-seg-id="seg-2"]');
    expect(active).toHaveAttribute('data-active', 'true');
    expect(active?.className).toContain('bg-primary/15');
    // A non-active segment is not highlighted.
    const inactive = container.querySelector('[data-seg-id="seg-3"]');
    expect(inactive?.className).not.toContain('bg-primary/15');
  });

  it('preserves paragraph breaks: two paragraphs render two blocks matching plain', () => {
    const plainContent = 'One. Two.\n\nThree.';
    const segs: ReadAlongSegment[] = [
      { id: 'h', kind: 'heading', sectionKey: 'facts', text: 'Facts', timeMs: 0 },
      { id: 's0', kind: 'sentence', sectionKey: 'facts', text: 'One.', timeMs: 100, paragraphIndex: 0 },
      { id: 's1', kind: 'sentence', sectionKey: 'facts', text: 'Two.', timeMs: 200, paragraphIndex: 0 },
      { id: 's2', kind: 'sentence', sectionKey: 'facts', text: 'Three.', timeMs: 300, paragraphIndex: 1 },
    ];
    mockState.mockReturnValue({
      audioRef: { current: null },
      segments: segs,
      isPlaying: true,
    });
    mockActive.mockReturnValue(null);

    const { container } = renderWithProviders(
      <DigestReadAlongBody
        sections={[{ key: 'facts', title: 'Facts', content: plainContent }]}
      />,
    );

    // Two distinct paragraph blocks (not one run-on block).
    const paragraphs = container.querySelectorAll('[data-paragraph]');
    expect(paragraphs).toHaveLength(2);
    // Sentences inside a paragraph are space-joined.
    expect(paragraphs[0]).toHaveTextContent('One. Two.');
    expect(paragraphs[1]).toHaveTextContent('Three.');
    // Visible text + breaks of the read-along body exactly match the plain
    // render (same whitespace-pre-wrap container, same "\n\n" gap).
    const bodyDiv = container.querySelector('.whitespace-pre-wrap');
    expect(bodyDiv?.textContent).toBe(plainContent);
  });

  it('falls back to plain sections when no manifest is loaded', () => {
    mockState.mockReturnValue({ audioRef: null, segments: null, isPlaying: false });
    mockActive.mockReturnValue(null);

    const { container } = renderWithProviders(
      <DigestReadAlongBody sections={SECTIONS} />,
    );

    expect(screen.queryByTestId('read-along-body')).not.toBeInTheDocument();
    expect(screen.getByText('He fled. He hid.')).toBeInTheDocument();
    expect(container.querySelector('[data-seg-id]')).toBeNull();
  });
});
