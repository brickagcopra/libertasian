import { describe, expect, it } from 'vitest';

import { activeWordIndex, parseMarks } from './parse-marks';
import type { WordMark } from '../types';

const NDJSON = [
  '{"time":0,"type":"sentence","start":57,"end":112,"value":"Digest: Mariano R. Cristobal vs. ..."}',
  '{"time":62,"type":"word","start":57,"end":63,"value":"Digest"}',
  '{"time":420,"type":"word","start":65,"end":73,"value":"Mariano"}',
  '{"time":800,"type":"word","start":74,"end":76,"value":"R."}',
].join('\n');

describe('parseMarks', () => {
  it('parses words and sentences from NDJSON', () => {
    const { words, sentences } = parseMarks(NDJSON);
    expect(words).toHaveLength(3);
    expect(sentences).toHaveLength(1);
    expect(words[0]).toEqual({
      time: 62,
      type: 'word',
      start: 57,
      end: 63,
      value: 'Digest',
    });
    expect(sentences[0]?.value).toContain('Cristobal');
  });

  it('skips blank lines and trailing whitespace', () => {
    const input = `\n  \n${NDJSON}\n\n`;
    const { words } = parseMarks(input);
    expect(words).toHaveLength(3);
  });

  it('skips malformed lines without throwing', () => {
    const input = [
      'not json at all',
      '{"time":62,"type":"word","start":57,"end":63,"value":"Digest"}',
      '{"time":"NaN","type":"word","start":1,"end":2,"value":"x"}', // bad time type
      '{"type":"word","start":1,"end":2,"value":"y"}', // missing time
      '{"time":99,"type":"word","start":1,"end":2}', // missing value
      '{"time":120,"type":"viseme","start":1,"end":2,"value":"p"}', // unknown type
      '{"time":200,"type":"word","start":80,"end":85,"value":"vs"}',
    ].join('\n');
    const { words } = parseMarks(input);
    expect(words.map((w) => w.value)).toEqual(['Digest', 'vs']);
  });

  it('returns empty arrays for empty input', () => {
    expect(parseMarks('')).toEqual({ words: [], sentences: [] });
  });
});

describe('activeWordIndex', () => {
  const words: WordMark[] = [
    { time: 62, type: 'word', start: 0, end: 6, value: 'Digest' },
    { time: 420, type: 'word', start: 7, end: 14, value: 'Mariano' },
    { time: 800, type: 'word', start: 15, end: 17, value: 'R.' },
  ];

  it('returns -1 before the first word', () => {
    expect(activeWordIndex(words, 0)).toBe(-1);
    expect(activeWordIndex(words, 61)).toBe(-1);
  });

  it('returns the index at an exact onset', () => {
    expect(activeWordIndex(words, 62)).toBe(0);
    expect(activeWordIndex(words, 420)).toBe(1);
  });

  it('returns the current word between onsets', () => {
    expect(activeWordIndex(words, 300)).toBe(0);
    expect(activeWordIndex(words, 799)).toBe(1);
  });

  it('stays on the last word after the final onset', () => {
    expect(activeWordIndex(words, 5000)).toBe(2);
  });

  it('returns -1 for an empty word list', () => {
    expect(activeWordIndex([], 1000)).toBe(-1);
  });
});
