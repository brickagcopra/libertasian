import { describe, expect, it } from 'vitest';

import { activeSegmentIndex, parseReadAlong } from './parse-readalong';
import type { ReadAlongSegment } from '../types';

const MANIFEST = JSON.stringify({
  version: 2,
  voiceId: 'Matthew',
  durationMs: 4200,
  segments: [
    { id: 'seg-0', kind: 'title', sectionKey: 'title', text: 'People v. Cruz', timeMs: 0 },
    { id: 'seg-1', kind: 'heading', sectionKey: 'facts', text: 'Facts', timeMs: 800 },
    { id: 'seg-2', kind: 'sentence', sectionKey: 'facts', text: 'He fled.', timeMs: 1500, paragraphIndex: 0 },
  ],
});

describe('parseReadAlong', () => {
  it('parses a well-formed manifest', () => {
    const manifest = parseReadAlong(MANIFEST);
    expect(manifest).not.toBeNull();
    expect(manifest?.version).toBe(2);
    expect(manifest?.voiceId).toBe('Matthew');
    expect(manifest?.durationMs).toBe(4200);
    expect(manifest?.segments).toHaveLength(3);
    expect(manifest?.segments[0]).toEqual({
      id: 'seg-0',
      kind: 'title',
      sectionKey: 'title',
      text: 'People v. Cruz',
      timeMs: 0,
    });
    // Title carries no paragraphIndex; the sentence carries the parsed one.
    expect(manifest?.segments[0]?.paragraphIndex).toBeUndefined();
    expect(manifest?.segments[2]?.paragraphIndex).toBe(0);
  });

  it('returns null for invalid JSON or a missing segments array', () => {
    expect(parseReadAlong('not json')).toBeNull();
    expect(parseReadAlong('{"version":2}')).toBeNull();
  });

  it('drops malformed segments and sorts the rest by timeMs', () => {
    const input = JSON.stringify({
      version: 2,
      voiceId: 'Matthew',
      durationMs: null,
      segments: [
        { id: 'seg-2', kind: 'sentence', sectionKey: 'facts', text: 'b', timeMs: 1500 },
        { id: 'seg-1', kind: 'heading', sectionKey: 'facts', text: 'a', timeMs: 800 },
        { id: 'x', kind: 'bogus', sectionKey: 'facts', text: 'nope', timeMs: 1 }, // bad kind
        { id: 'y', kind: 'sentence', sectionKey: 'facts', timeMs: 5 }, // missing text
      ],
    });
    const manifest = parseReadAlong(input);
    expect(manifest?.segments.map((s) => s.id)).toEqual(['seg-1', 'seg-2']);
  });
});

describe('activeSegmentIndex', () => {
  const segments: ReadAlongSegment[] = [
    { id: 'seg-0', kind: 'title', sectionKey: 'title', text: 'T', timeMs: 0 },
    { id: 'seg-1', kind: 'heading', sectionKey: 'facts', text: 'Facts', timeMs: 800 },
    { id: 'seg-2', kind: 'sentence', sectionKey: 'facts', text: 'He fled.', timeMs: 1500 },
  ];

  it('returns 0 at/after the first onset and -1 before any', () => {
    expect(activeSegmentIndex(segments, -1)).toBe(-1);
    expect(activeSegmentIndex(segments, 0)).toBe(0);
    expect(activeSegmentIndex(segments, 799)).toBe(0);
  });

  it('returns -1 for an empty list', () => {
    expect(activeSegmentIndex([], 1000)).toBe(-1);
  });

  it('finds the last segment whose timeMs <= currentMs (binary search)', () => {
    expect(activeSegmentIndex(segments, 800)).toBe(1);
    expect(activeSegmentIndex(segments, 1499)).toBe(1);
    expect(activeSegmentIndex(segments, 1500)).toBe(2);
    expect(activeSegmentIndex(segments, 9999)).toBe(2);
  });
});
